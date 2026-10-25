import { expect, mock, test } from 'claude-code/testing'

const HINT = {
  plugin: 'footer-split',
  component: 'PromptHint',
  requestId: 'hint',
  surface: 'terminal',
  props: { isDraft: false, isWorking: false, hint: '(shift+tab to cycle) · ? for shortcuts' },
} as const

type Found = { text: string; props?: { color?: string; dimColor?: boolean } } | undefined

const measure = ({ ctx = 5, weekly = 0 }) => ({
  context: { window: 200000, percent: ctx },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 30 },
    { kind: 'seven_day', percentUsed: weekly },
  ],
  cost: { usd: 1.5 },
  changed: ['context', 'rateLimits', 'cost'] as ('context' | 'rateLimits' | 'cost')[],
})

const cases = [
  { name: 'weekly', label: '📅', key: 'weekly', steps: [[59, null], [60, 'dim'], [80, 'warning'], [90, 'error']] },
  { name: 'context', label: 'ctx', key: 'ctx', steps: [[9, null], [10, 'dim'], [40, 'warning'], [60, 'error']] },
] as const

for (const c of cases) {
  for (const [pct, color] of c.steps) {
    test(`${c.name} at ${pct}%`, async ($, on) => {
      on('session.measure', (_, e) => ({ changed: e.changed }))
      await $.session.measure(measure({ [c.key]: pct }))

      const ui = await $.ui.mount(HINT)
      const item = (await ui.find({ type: 'Text', text: new RegExp(`^${c.label} ${pct}%$`) })) as Found

      expect(!!item).toBe(color !== null)
      if (color === 'dim') expect(item?.props?.dimColor).toBe(true)
      if (color === 'warning' || color === 'error') expect(item?.props?.color).toBe(color)
      expect(await ui.find({ type: 'Text', text: /^🕔 30%$/ })).toBeTruthy()
      expect(await ui.find({ type: 'Text', text: /shift\+tab/ })).toBeFalsy()
      await ui.unmount()
    })
  }
}

test('a gateway spend limit gets its own label', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const m = measure({})
  await $.session.measure({ ...m, rateLimits: [{ kind: 'spend_limit', percentUsed: 40 }] })

  const ui = await $.ui.mount(HINT)
  expect(await ui.find({ type: 'Text', text: /^💳 40%$/ })).toBeTruthy()
  await ui.unmount()
})

test('toggle-cost hides and shows the cost', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('command.register', () => ({ value: { command: 'toggle-cost' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure({}))

  const cost = async () => {
    const ui = await $.ui.mount(HINT)
    const found = await ui.find({ type: 'Text', text: /^\$1\.50$/ })
    await ui.unmount()
    return !!found
  }

  expect(await cost()).toBe(true)
  await $.command.run({ command: 'toggle-cost', args: '' })
  expect(await cost()).toBe(false)
  await $.command.run({ command: 'toggle-cost', args: '' })
  expect(await cost()).toBe(true)
})
