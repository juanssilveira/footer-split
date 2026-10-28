import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

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
type Item = { kind: string; text: string; level: Level }

// Percentages at which an item [appears, turns yellow, turns red]. Items without an entry are always shown.
const THRESHOLDS: Record<string, [number, number, number]> = {
  context: [10, 40, 60],
  seven_day: [60, 80, 90],
}

const level = (kind: string, pct: number): Level => {
  const t = THRESHOLDS[kind]
  if (!t) return 'normal'
  return pct < t[0] ? 'hidden' : pct < t[1] ? 'normal' : pct < t[2] ? 'warning' : 'error'
}

const percent = (kind: string, pct: number, modes: Modes): Item => {
  const l = level(kind, pct)
  return { kind, text: `${LABELS[kind] ?? kind} ${Math.round(pct)}%`, level: l === 'hidden' && modes[kind] === 'shown' ? 'normal' : l }
}

const items = (u: Usage, modes: Modes): Item[] =>
  [
    u.context.percent !== undefined && percent('context', u.context.percent, modes),
    ...u.rateLimits.map(l => percent(l.kind, l.percentUsed, modes)),
    u.cost && { kind: 'cost', text: `$${u.cost.usd.toFixed(2)}`, level: 'normal' as const },
  ].filter((i): i is Item => !!i && i.level !== 'hidden' && modes[i.kind] !== 'hidden')

// auto -> hidden -> always shown -> auto. Items without thresholds are always shown on auto, so they skip that step.
const cycle = (kind: string, mode: Modes[string] | undefined) =>
  !mode ? 'hidden' : mode === 'hidden' && THRESHOLDS[kind] ? 'shown' : undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'toggle',
      description: 'Cycle a footer item: auto, hidden, always shown',
      argumentHint: Object.keys(NAMES).join('|'),
    })
    return next(e)
  })

  on('command.run', { command: 'toggle' }, async ($, e) => {
    const name = e.args.trim()
    const kind = NAMES[name]
    if (!kind) return { text: `Usage: /toggle ${Object.keys(NAMES).join('|')}` }
    const mode = cycle(kind, (await getModes($))[kind])
    await setMode($, kind, mode)
    return { text: `${name}: ${mode === 'shown' ? 'always shown' : mode ?? (THRESHOLDS[kind] ? 'auto' : 'shown')}` }
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
    // The permission-mode label is drawn by Claude Code outside this component; only the hints arrive here.
    const hint = e.props.hint.replace(/\s*\(shift\+tab to cycle\)/i, '').trim()
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        <Text wrap="truncate-end">
          {items(u, m).flatMap((i, n) => [
            n > 0 && <Text dimColor> • </Text>,
            i.level === 'normal' ? <Text dimColor>{i.text}</Text> : <Text color={i.level}>{i.text}</Text>,
          ])}
        </Text>
        <Text dimColor wrap="truncate-start">{hint}</Text>
      </Box>
    )
  })
}
