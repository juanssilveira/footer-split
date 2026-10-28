import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Align, Modes, Usage } from '../types'

const usage = atom({ plugin: 'footersplit', key: 'measured' } as const, null)
// null until read from the store: /clear starts $.state over and no session.start follows it.
const modes = atom({ plugin: 'footersplit', key: 'modes' } as const, null)
const align = atom({ plugin: 'footersplit', key: 'align' } as const, null)

const getAlign = async ($: EngineInterface): Promise<Align> =>
  (await read($, align)) ?? ((await $.store.get('align')) as Align | undefined) ?? 'left'

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
  // Colored by the number it shows: 69.5% reads 70% and is yellow at 70.
  const p = Math.round(pct)
  const l = level(th[kind], p)
  return {
    kind,
    text: `${LABELS[kind] ?? kind} ${p}%`,
    level: l === 'hidden' && modes[kind] === 'shown' ? 'normal' : l,
    resets: l === 'warning' || l === 'error' ? resets : undefined,
  }
}

const items = (th: Thresholds, u: Usage, modes: Modes, now: number): Item[] =>
  [
    u.context.percent !== undefined && percent(th, 'context', u.context.percent, modes),
    // A window past its reset starts over, though nothing has measured it since.
    ...u.rateLimits.map(l =>
      percent(th, l.kind, Date.parse(l.resetsAt ?? '') <= now ? 0 : l.percentUsed, modes, left(l.resetsAt, now)),
    ),
    u.cost && { kind: 'cost', text: `$${u.cost.usd.toFixed(2)}`, level: 'normal' as const },
  ].filter((i): i is Item => !!i && i.level !== 'hidden' && modes[i.kind] !== 'hidden')

// Terminal cells: the emoji labels take two, everything else this line draws takes one.
const cells = (s: string) => [...s].reduce((n, c) => n + ((c.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0)

// Each item, its time left as ' (2d)', and a ' • ' between items.
const width = (shown: Item[]) =>
  shown.reduce((n, i) => n + cells(i.text) + (i.resets ? cells(i.resets.text) + 3 : 0), 3 * (shown.length - 1))

// The engine adds this hint only beside the permission-mode label.
const CYCLE = /\s*\(shift\+tab to cycle\)/i
// That label and a space: '⏵⏵ bypass permissions on' is the longest.
const LABEL = 25

const RANK: Level[] = ['normal', 'warning', 'error']

// Drops items until the line fits: gray first, then yellow, then red, rightmost first.
// The last one left is cut instead.
const fit = (shown: Item[], room: number): Item[] => {
  if (shown.length < 2 || width(shown) <= room) return shown
  const drop = shown.reduce((d, i, n) => (RANK.indexOf(i.level) <= RANK.indexOf(shown[d].level) ? n : d), 0)
  return fit(shown.filter((_, n) => n !== drop), room)
}

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
    await $.command.register({
      name: 'align',
      description: 'Put the usage on the left or the right of the footer',
      argumentHint: '[left|right]',
    })
    return next(e)
  })

  on('command.run', { command: 'align' }, async ($, e) => {
    const side = e.args.trim()
    if (!side) return { text: `align: ${await getAlign($)}` }
    if (side !== 'left' && side !== 'right') return { text: 'Usage: /align [left|right]' }
    await update($, align, () => side)
    await $.store.set('align', side)
    return { text: `align: ${side}` }
  })

  on('command.run', { command: 'toggle' }, async ($, e) => {
    const name = e.args.trim()
    const kind = NAMES[name]
    const m = await getModes($)
    if (!name) return { text: Object.entries(NAMES).map(([n, k]) => `${n}: ${describe(th, k, m[k])}`).join(' • ') }
    if (!kind) return { text: `Usage: /toggle [${Object.keys(NAMES).join('|')}]` }
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
    const hint = e.props.hint.replace(CYCLE, '').trim()
    const { Box, Text } = $.ui.resolve(e)
    const all = items(th, u, m, now)
    // The hint, the gap of 2 before it and the permission-mode label take their share of the row.
    const taken = cells(hint) + 2 + (CYCLE.test(e.props.hint) ? LABEL : 0)
    const shown = e.viewport ? fit(all, e.viewport.columns - taken) : all
    // Nothing is measured while the session sits idle, so redraw when the time left ticks down.
    const wait = Math.min(...all.map(i => i.resets?.ms ?? Infinity))
    redraw?.cancel()
    redraw = wait < Infinity ? $.clock.after(wait, () => $.ui.invalidate('ui.render')) : undefined

    const line = (
      <Text wrap="truncate-end">
        {shown.flatMap((i, n) => [
          n > 0 && <Text dimColor> • </Text>,
          i.level === 'normal' ? <Text dimColor>{i.text}</Text> : <Text color={i.level}>{i.text}</Text>,
          i.resets && <Text dimColor>{` (${i.resets.text})`}</Text>,
        ])}
      </Text>
    )

    // Both always drawn, so the usage keeps its side while the hint is empty.
    return (await getAlign($)) === 'right' ? (
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        <Text dimColor wrap="truncate-end">{hint}</Text>
        {line}
      </Box>
    ) : (
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        {line}
        <Text dimColor wrap="truncate-start">{hint}</Text>
      </Box>
    )
  })
}
