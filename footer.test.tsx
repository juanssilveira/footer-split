import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const HINT = {
  plugin: 'footersplit',
  component: 'PromptHint',
  requestId: 'hint',
  surface: 'terminal',
  props: { isDraft: false, isWorking: false, hint: '(shift+tab to cycle) · ? for shortcuts' },
} as const

type Found = { text: string; props?: { color?: string; dimColor?: boolean } } | undefined

const measure = ({ ctx = 5, '5h': fiveHour = 30, weekly = 0 }) => ({
  context: { window: 200000, percent: ctx },
  rateLimits: [
    { kind: 'five_hour', percentUsed: fiveHour },
    { kind: 'seven_day', percentUsed: weekly },
  ],
  cost: { usd: 1.5 },
  changed: ['context', 'rateLimits', 'cost'] as ('context' | 'rateLimits' | 'cost')[],
})

const cases = [
  { name: 'weekly', label: '📅', key: 'weekly', steps: [[59, null], [60, 'dim'], [80, 'warning'], [90, 'error']] },
  { name: 'context', label: '🧠', key: 'ctx', steps: [[9, null], [10, 'dim'], [40, 'warning'], [60, 'error']] },
  { name: '5h', label: '🕔', key: '5h', steps: [[0, 'dim'], [69, 'dim'], [70, 'warning'], [90, 'error']] },
] as const

for (const c of cases) {
  for (const [pct, color] of c.steps) {
    test(`${c.name} at ${pct}%`, async ($, on) => {
      mock.store(on)
      on('session.measure', (_, e) => ({ changed: e.changed }))
      await $.session.measure(measure({ [c.key]: pct }))

      const ui = await $.ui.mount(HINT)
      const item = (await ui.find({ type: 'Text', text: new RegExp(`^${c.label} ${pct}%$`) })) as Found

      expect(!!item).toBe(color !== null)
      if (color === 'dim') expect(item?.props?.dimColor).toBe(true)
      if (color === 'warning' || color === 'error') expect(item?.props?.color).toBe(color)
      if (c.key !== '5h') expect(await ui.find({ type: 'Text', text: /^🕔 30%$/ })).toBeTruthy()
      expect(await ui.find({ type: 'Text', text: /shift\+tab/ })).toBeFalsy()
      await ui.unmount()
    })
  }
}

test('a gateway spend limit gets its own label', async ($, on) => {
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const m = measure({})
  await $.session.measure({ ...m, rateLimits: [{ kind: 'spend_limit', percentUsed: 40 }] })

  const ui = await $.ui.mount(HINT)
  expect(await ui.find({ type: 'Text', text: /^💳 40%$/ })).toBeTruthy()
  await ui.unmount()
})

test('after /clear the line comes from the engine and the hidden cost stays hidden', async ($, on) => {
  // /clear: no session.start, no session.measure yet, $.state back to its initial values.
  // Stored by 0.1.x, before /toggle.
  on('store.get', (_, e) => ({ value: e.key === 'hideCost' ? true : undefined }))
  on('session.usage', () => ({ value: { ...measure({ ctx: 20 }), startedAt: 0 } }))

  const ui = await $.ui.mount(HINT)
  expect(await ui.find({ type: 'Text', text: /^🧠 20%$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^\$1\.50$/ })).toBeFalsy()
  await ui.unmount()
})

test('/toggle cost hides and shows the cost', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
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
  await $.command.run({ command: 'toggle', args: 'cost' })
  expect(await cost()).toBe(false)
  await $.command.run({ command: 'toggle', args: 'cost' })
  expect(await cost()).toBe(true)
})

test('/toggle cycles an item through auto, hidden and always shown', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const shows = async (ctx: number, text: RegExp) => {
    await $.session.measure(measure({ ctx }))
    const ui = await $.ui.mount(HINT)
    const found = await ui.find({ type: 'Text', text })
    await ui.unmount()
    return !!found
  }
  const toggle = async (args: string) => (await $.command.run({ command: 'toggle', args })).text

  expect(await shows(5, /^🧠 5%$/)).toBe(false)
  expect(await shows(70, /^🧠 70%$/)).toBe(true)

  expect(await toggle('ctx')).toBe('ctx: hidden')
  expect(await shows(70, /^🧠 70%$/)).toBe(false)

  expect(await toggle('ctx')).toBe('ctx: always shown')
  expect(await shows(5, /^🧠 5%$/)).toBe(true)

  expect(await toggle('ctx')).toBe('ctx: auto')
  expect(await shows(5, /^🧠 5%$/)).toBe(false)

  // Items that never hide on auto go straight back from hidden.
  expect(await toggle('5h')).toBe('5h: hidden')
  expect(await shows(20, /^🕔 30%$/)).toBe(false)
  expect(await toggle('5h')).toBe('5h: shown')

  expect(await toggle('ctx')).toBe('ctx: hidden')
  expect(await toggle('nope')).toBe('Usage: /toggle ctx|5h|weekly|spend|cost')
})

test('/toggle with no item lists every mode', async ($, on) => {
  mock.store(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const toggle = async (args: string) => (await $.command.run({ command: 'toggle', args })).text

  expect(await toggle('')).toBe('ctx: auto • 5h: shown • weekly: auto • spend: shown • cost: shown')
  await toggle('ctx')
  await toggle('ctx')
  await toggle('cost')
  expect(await toggle(' ')).toBe('ctx: always shown • 5h: shown • weekly: auto • spend: shown • cost: hidden')
})

const render = async ($: Engine, m: Parameters<typeof measure>[0], label: string, pct: number) => {
  await $.session.measure(measure(m))
  const ui = await $.ui.mount(HINT)
  const item = (await ui.find({ type: 'Text', text: new RegExp(`^${label} ${pct}%$`) })) as Found
  await ui.unmount()
  return !item ? null : item.props?.color ?? (item.props?.dimColor ? 'dim' : undefined)
}

test('thresholds come from the options', { options: { context: '0 20 30', five_hour: '0 90 90', seven_day: '10, 20, 30' } }, async ($, on) => {
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await render($, { ctx: 5 }, '🧠', 5)).toBe('dim')
  expect(await render($, { ctx: 25 }, '🧠', 25)).toBe('warning')
  expect(await render($, { weekly: 9 }, '📅', 9)).toBe(null)
  expect(await render($, { weekly: 35 }, '📅', 35)).toBe('error')
  // A repeated number skips a color.
  expect(await render($, { '5h': 89 }, '🕔', 89)).toBe('dim')
  expect(await render($, { '5h': 90 }, '🕔', 90)).toBe('error')
  // ctx now appears from 0%, so it never hides on auto.
  expect((await $.command.run({ command: 'toggle', args: '' })).text).toBe('ctx: shown • 5h: shown • weekly: auto • spend: shown • cost: shown')
  await $.command.run({ command: 'toggle', args: 'ctx' })
  expect((await $.command.run({ command: 'toggle', args: 'ctx' })).text).toBe('ctx: shown')
})

test('a malformed threshold falls back to the default', { options: { context: '5 10 3', five_hour: 'soon', seven_day: '10 20 120' } }, async ($, on) => {
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))

  expect(await render($, { ctx: 9 }, '🧠', 9)).toBe(null)
  expect(await render($, { ctx: 40 }, '🧠', 40)).toBe('warning')
  expect(await render($, { '5h': 70 }, '🕔', 70)).toBe('warning')
  expect(await render($, { weekly: 59 }, '📅', 59)).toBe(null)
  expect(await render($, { weekly: 90 }, '📅', 90)).toBe('error')
})

const EMOJI: Record<string, string> = { five_hour: '🕔', seven_day: '📅', spend_limit: '💳' }
const H = 3600000
// The mocked clock starts at 0, so a reset ms from now is at new Date(ms).
const at = (ms: number) => new Date(ms).toISOString()

const resets = async ($: Engine, kind: string, pct: number, resetsAt?: string) => {
  await $.session.measure({ ...measure({}), rateLimits: [{ kind, percentUsed: pct, ...(resetsAt && { resetsAt }) }] })
  const ui = await $.ui.mount(HINT)
  const item = await ui.find({ type: 'Text', text: new RegExp(`^${EMOJI[kind]} ${pct}%$`) })
  const found = (await ui.find({ type: 'Text', text: /^ \(.*\)$/ })) as Found
  await ui.unmount()
  expect(!!item).toBe(true)
  if (found) expect(found.props?.dimColor).toBe(true)
  return found?.text ?? null
}

test('a yellow or red rate limit says when it resets', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))

  expect(await resets($, 'seven_day', 92, at(53 * H))).toBe(' (2d)')
  expect(await resets($, 'seven_day', 92, at(47 * H))).toBe(' (1d)')
  expect(await resets($, 'seven_day', 92, at(24 * H))).toBe(' (1d)')
  expect(await resets($, 'five_hour', 85, at(2 * H - 1000))).toBe(' (1h)')
  expect(await resets($, 'five_hour', 95, at(40.5 * 60000))).toBe(' (40m)')
  expect(await resets($, 'five_hour', 95, at(20000))).toBe(' (1m)')
  // Gray items keep the line short.
  expect(await resets($, 'five_hour', 30, at(H))).toBe(null)
  expect(await resets($, 'spend_limit', 40, at(H))).toBe(null)
  expect(await resets($, 'five_hour', 85)).toBe(null)
  expect(await resets($, 'five_hour', 85, at(-H))).toBe(null)
  expect(await resets($, 'five_hour', 85, 'soon')).toBe(null)
})

test('the time left ticks down while nothing is measured', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({ ...measure({}), rateLimits: [{ kind: 'five_hour', percentUsed: 95, resetsAt: at(H + 30000) }] })

  const ui = await $.ui.mount(HINT)
  const shown = async () => ((await ui.find({ type: 'Text', text: /^ \(.*\)$/ })) as Found)?.text ?? null
  expect(await shown()).toBe(' (1h)')
  await clock.advance(30001)
  expect(await shown()).toBe(' (59m)')
  await clock.advance(59 * 60000)
  expect(await shown()).toBe(' (1m)')
  await clock.advance(60000)
  expect(await shown()).toBe(null)
  await ui.unmount()
})
