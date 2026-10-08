import type { On, SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const PANE = { component: 'Pane', requestId: 'usage', props: { title: 'Usage', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const USAGE = { model: 'claude-opus-5-5', input_tokens: 200, output_tokens: 1234, cache_read_input_tokens: 8000, cache_creation_input_tokens: 1800 }
// What the engine answers beneath the plugin: its own band, the end of a turn
// and a measurement, a clock, and a session start with its command.
// `registered` collects the commands the plugin registers; `refuse` makes
// each registration throw, as a clash with a built-in does.
function engine(on: On, { registered = [] as string[], refuse = false, usage = { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } as SessionUsage } = {}) {
  mock.clock(on, { now: 1_000 })
  on('ui.render', { component: 'AbovePrompt' }, async (_$, e) => {
    const { Box } = _$.ui.resolve(e)
    return <Box key="engine" />
  })
  on('turn.complete', async () => ({ text: '' }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => {
    if (refuse) throw new Error(`"/${e.name}" refused`)
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.usage', async () => ({ value: usage }))
  on('ui.log', async () => ({ value: undefined }))
}

const TURN = { answer: 'Done.', durationMs: 12_400, isAborted: false, turnId: 't1', reason: 'answer', category: null, explanation: null } as const

test('the band shows the measurement and colors what is near its limit', async ($, on) => {
  engine(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const quiet = await $.ui.mount({ plugin: 'usage', surface, ...BAND })
    expect(await quiet.find({ type: 'Text' })).toBeUndefined()
    await quiet.unmount()
  }

  await $.session.measure({
    context: { tokens: 172_000, window: 200_000, percent: 86 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: '2099-01-01T00:00:00Z' }],
    cost: { usd: 2.5 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  await $.turn.complete({ ...TURN, usage: USAGE })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'usage', surface, ...BAND })
    expect(await band.find({ type: 'Text', text: 'context 86%' })).toMatchObject({ props: { color: 'warning' } })
    expect(await band.find({ type: 'Text', text: '5h 91%' })).toMatchObject({ props: { color: 'error' } })
    expect(await band.find({ text: /\$2\.50/ })).toBeDefined()
    expect(await band.find({ text: /last turn 10k in, 1\.2k out, 80% cached/ })).toBeDefined()
    await band.unmount()
  }
  expect(toasts).toEqual(['Context is 86% full. Consider /compact.', '5h rate limit is 91% used.'])

  // The same figures again raise no second toast.
  await $.session.measure({ context: { window: 200_000, percent: 87 }, rateLimits: [{ kind: 'five_hour', percentUsed: 91 }], changed: ['context'] })
  expect(toasts).toHaveLength(2)
})

test('the pane lists main-loop turns, newest first, with totals', async ($, on) => {
  engine(on)
  await $.turn.complete({ ...TURN, usage: USAGE })
  await $.turn.complete({ ...TURN, turnId: 't2', usage: { ...USAGE, model: 'claude-sonnet-5-5' } })
  // A subagent's turn stays out of the history.
  await $.turn.complete({ ...TURN, turnId: 't3', agentId: 'a1', usage: { ...USAGE, model: 'claude-haiku-5-5' } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'usage', surface, ...PANE })
    const rows = await pane.findAll({ type: 'Text', text: /^(opus|sonnet|haiku)/ })
    expect(rows.map(row => row.text.split(' ')[0])).toEqual(['sonnet-5-5', 'opus-5-5'])
    expect(await pane.find({ type: 'Text', text: /^2 turns +400 +16k +3\.6k +2\.5k +80%/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /No measurement yet/ })).toBeDefined()
    await pane.unmount()
  }
})

test('/spend opens the pane', async ($, on) => {
  const registered: string[] = []
  engine(on, { registered })
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['spend'])
  const ran = await $.command.run({ command: 'spend', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(opened).toEqual(['usage'])
  expect(ran).toMatchObject({ text: 'Usage pane opened.' })
})

test('a refused command still lets the start read the figures', async ($, on) => {
  engine(on, { refuse: true, usage: { startedAt: 0, context: { window: 200_000, percent: 42 }, rateLimits: [] } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'usage', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: 'context 42%' })).toBeDefined()
})
