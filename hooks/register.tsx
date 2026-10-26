import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'footer-split', key: 'measured' } as const, null)
// null until read from the store: /clear starts $.state over and no session.start follows it.
const hideCost = atom({ plugin: 'footer-split', key: 'hideCost' } as const, null)

const isCostHidden = async ($: Engine) => (await read($, hideCost)) ?? (await $.store.get('hideCost')) === true

const LABELS: Record<string, string> = { context: '🧠', five_hour: '🕔', seven_day: '📅', spend_limit: '💳' }

type Level = 'hidden' | 'normal' | 'warning' | 'error'
type Item = { text: string; level: Level }

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

const percent = (kind: string, pct: number): Item => ({
  text: `${LABELS[kind] ?? kind} ${Math.round(pct)}%`,
  level: level(kind, pct),
})

const items = (u: Usage, isCostHidden: boolean): Item[] =>
  [
    u.context.percent !== undefined && percent('context', u.context.percent),
    ...u.rateLimits.map(l => percent(l.kind, l.percentUsed)),
    u.cost && !isCostHidden && { text: `$${u.cost.usd.toFixed(2)}`, level: 'normal' as const },
  ].filter((i): i is Item => !!i && i.level !== 'hidden')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'toggle-cost', description: 'Show or hide the session cost in the prompt footer' })
    return next(e)
  })

  on('command.run', { command: 'toggle-cost' }, async $ => {
    const isHidden = !(await isCostHidden($))
    await update($, hideCost, () => isHidden)
    await $.store.set('hideCost', isHidden)
    return { text: isHidden ? 'Cost hidden.' : 'Cost shown.' }
  })

  on('session.measure', async ($, e, next) => {
    const { context, rateLimits, cost } = e
    await update($, usage, () => ({ context, rateLimits, cost }))
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    // After /clear nothing is measured until the next turn; ask the engine meanwhile.
    const u = (await read($, usage)) ?? (await $.session.usage())
    const isHidden = await isCostHidden($)
    // The permission-mode label is drawn by Claude Code outside this component; only the hints arrive here.
    const hint = e.props.hint.replace(/\s*\(shift\+tab to cycle\)/i, '').trim()
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        <Text wrap="truncate-end">
          {items(u, isHidden).flatMap((i, n) => [
            n > 0 && <Text dimColor> • </Text>,
            i.level === 'normal' ? <Text dimColor>{i.text}</Text> : <Text color={i.level}>{i.text}</Text>,
          ])}
        </Text>
        <Text dimColor wrap="truncate-start">{hint}</Text>
      </Box>
    )
  })
}
