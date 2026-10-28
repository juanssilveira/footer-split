import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Modes, Usage } from '../types'

const usage = atom({ plugin: 'footersplit', key: 'measured' } as const, null)
// null until read from the store: /clear starts $.state over and no session.start follows it.
const modes = atom({ plugin: 'footersplit', key: 'modes' } as const, null)

const getModes = async ($: EngineInterface): Promise<Modes> =>
  (await read($, modes)) ??
  ((await $.store.get('modes')) as Modes | undefined) ??
  // Up to 0.1.x only the cost could be hidden, under its own key.
  ((await $.store.get('hideCost')) === true ? { cost: 'hidden' } : {})

const setMode = async ($: EngineInterface, kind: string, mode: Modes[string] | undefined) => {
  const { [kind]: _, ...rest } = await getModes($)
  const next: Modes = mode ? { ...rest, [kind]: mode } : rest
  await update($, modes, () => next)
  await $.store.set('modes', next)
}

const LABELS: Record<string, string> = { context: '🧠', five_hour: '🕔', seven_day: '📅', spend_limit: '💳' }
// The names /toggle takes, and the item each stands for.
const NAMES: Record<string, string> = { ctx: 'context', '5h': 'five_hour', weekly: 'seven_day', spend: 'spend_limit', cost: 'cost' }

type Level = 'hidden' | 'normal' | 'warning' | 'error'
// The time left, and how long until that text changes.
type Left = { text: string; ms: number }
type Item = { kind: string; text: string; level: Level; resets?: Left }

type Range = [number, number, number]
type Thresholds = Record<string, Range>

// Percentages at which an item [appears, turns yellow, turns red], unless its option says otherwise.
// Items without an entry are always shown.
const THRESHOLDS: Thresholds = {
  context: [10, 40, 60],
  five_hour: [0, 70, 90],
  seven_day: [60, 80, 90],
}

// An option reads '10 40 60'; anything but three percentages in order keeps the default.
const parse = (value: unknown, fallback: Range): Range => {
  const t = String(value).trim().split(/[\s,]+/).map(Number)
  return t.length === 3 && t.every((n, i) => n >= (t[i - 1] ?? 0) && n <= 100) ? (t as Range) : fallback
}

const thresholds = (options: PluginOptions): Thresholds =>
  Object.fromEntries(Object.entries(THRESHOLDS).map(([kind, t]) => [kind, parse(options[kind], t)]))

// Items that never hide on auto: no thresholds, or one that appears from 0%.
const neverHidden = (th: Thresholds, kind: string) => !th[kind]?.[0]

const level = (t: Range | undefined, pct: number): Level =>
  !t ? 'normal' : pct < t[0] ? 'hidden' : pct < t[1] ? 'normal' : pct < t[2] ? 'warning' : 'error'

const UNITS: [string, number][] = [['d', 86400000], ['h', 3600000], ['m', 60000]]

// Time until a window resets, rounded down: '2d', '3h', '40m', at least '1m'. None once it has passed.
const left = (resetsAt: string | undefined, now: number): Left | undefined => {
  const ms = Date.parse(resetsAt ?? '') - now
  if (!(ms > 0)) return undefined
  const [unit, size] = UNITS.find(([, s]) => ms >= s) ?? UNITS[2]
  return { text: `${Math.max(1, Math.floor(ms / size))}${unit}`, ms: (ms % size) + 1 }
}

const percent = (th: Thresholds, kind: string, pct: number, modes: Modes, resets?: Left): Item => {
  const l = level(th[kind], pct)
  return {
    kind,
    text: `${LABELS[kind] ?? kind} ${Math.round(pct)}%`,
    level: l === 'hidden' && modes[kind] === 'shown' ? 'normal' : l,
    resets: l === 'warning' || l === 'error' ? resets : undefined,
  }
}

const items = (th: Thresholds, u: Usage, modes: Modes, now: number): Item[] =>
  [
    u.context.percent !== undefined && percent(th, 'context', u.context.percent, modes),
    ...u.rateLimits.map(l => percent(th, l.kind, l.percentUsed, modes, left(l.resetsAt, now))),
    u.cost && { kind: 'cost', text: `$${u.cost.usd.toFixed(2)}`, level: 'normal' as const },
  ].filter((i): i is Item => !!i && i.level !== 'hidden' && modes[i.kind] !== 'hidden')

// auto -> hidden -> always shown -> auto. Items that never hide on auto skip that step.
const cycle = (th: Thresholds, kind: string, mode: Modes[string] | undefined) =>
  !mode ? 'hidden' : mode === 'hidden' && !neverHidden(th, kind) ? 'shown' : undefined

const describe = (th: Thresholds, kind: string, mode: Modes[string] | undefined) =>
  mode === 'shown' ? 'always shown' : mode ?? (neverHidden(th, kind) ? 'shown' : 'auto')

export const register: Register = (on, options) => {
  const th = thresholds(options)
  let redraw: Timer | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'toggle',
      description: 'Cycle a footer item: auto, hidden, always shown',
      argumentHint: `[${Object.keys(NAMES).join('|')}]`,
    })
    return next(e)
  })

  on('command.run', { command: 'toggle' }, async ($, e) => {
    const name = e.args.trim()
    const kind = NAMES[name]
    const m = await getModes($)
    if (!name) return { text: Object.entries(NAMES).map(([n, k]) => `${n}: ${describe(th, k, m[k])}`).join(' • ') }
    if (!kind) return { text: `Usage: /toggle ${Object.keys(NAMES).join('|')}` }
    const mode = cycle(th, kind, m[kind])
    await setMode($, kind, mode)
    return { text: `${name}: ${describe(th, kind, mode)}` }
  })

  on('session.measure', async ($, e, next) => {
    const { context, rateLimits, cost } = e
    await update($, usage, () => ({ context, rateLimits, cost }))
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    // After /clear nothing is measured until the next turn; ask the engine meanwhile.
    const u = (await read($, usage)) ?? (await $.session.usage())
    const m = await getModes($)
    // Only a window that says when it resets needs the time.
    const now = u.rateLimits.some(l => l.resetsAt) ? await $.clock.now() : 0
    // The permission-mode label is drawn by Claude Code outside this component; only the hints arrive here.
    const hint = e.props.hint.replace(/\s*\(shift\+tab to cycle\)/i, '').trim()
    const { Box, Text } = $.ui.resolve(e)
    const shown = items(th, u, m, now)
    // Nothing is measured while the session sits idle, so redraw when the time left ticks down.
    const wait = Math.min(...shown.map(i => i.resets?.ms ?? Infinity))
    redraw?.cancel()
    redraw = wait < Infinity ? $.clock.after(wait, () => $.ui.invalidate('ui.render')) : undefined

    return (
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        <Text wrap="truncate-end">
          {shown.flatMap((i, n) => [
            n > 0 && <Text dimColor> • </Text>,
            i.level === 'normal' ? <Text dimColor>{i.text}</Text> : <Text color={i.level}>{i.text}</Text>,
            i.resets && <Text dimColor>{` (${i.resets.text})`}</Text>,
          ])}
        </Text>
        <Text dimColor wrap="truncate-start">{hint}</Text>
      </Box>
    )
  })
}
