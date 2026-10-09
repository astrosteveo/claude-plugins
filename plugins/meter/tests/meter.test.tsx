import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { STUCK_AFTER, activityOf, ago, closingHead, closingParts, emptyMeter, finished, label, span, started, summarize, summaryOf, withSummary } from '../hooks/meter'

// The engine beneath the plugin: Bash fails, every other call answers, and
// the turn events and the spinner answer as the engine would.
function engine(on: On, drawn: Array<Record<string, unknown>> = [], { closing = true } = {}) {
  // The engine draws its own closing line, which a plugin gets as a node.
  if (closing) on('ui.render', { component: 'TurnDuration' }, async () => ({ type: 'engine', ref: 0 }) as never)
  on('ui.render', { component: 'Spinner' }, async ($, e) => {
    drawn.push(e.props)
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.message ?? e.props.word}</Text>
  })
  on('tool.call', async (_$, e) => (e.tool === 'Bash' ? { isError: true, result: 'exit 1', text: 'exit 1' } : { result: {} }) as never)
  let clock = 0
  on('clock.now', async () => ({ value: (clock += 1000) }))
  // A refused period ends the interval, so the tick never runs on its own here.
  on('clock.every', async () => {
    throw new Error('no ticking in tests')
  })
  on('ui.log', async () => ({ value: undefined }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
}

const SPINNER = { component: 'Spinner', requestId: 'main', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' } } as const

test('each tool reads as a phase and a target', () => {
  expect(activityOf('a', 'Edit', { file_path: '/repo/src/register.tsx' })).toMatchObject({ id: 'a', phase: 'Editing', target: 'register.tsx' })
  expect(activityOf('a', 'Read', { file_path: '/repo/README.md' }).phase).toBe('Reading')
  expect(activityOf('a', 'Grep', { pattern: 'TODO' })).toMatchObject({ phase: 'Searching', target: 'TODO' })
  expect(activityOf('a', 'Bash', { command: 'npm test' })).toMatchObject({ phase: 'Testing', target: '' })
  expect(activityOf('a', 'Bash', { command: 'cd x && git status' }).phase).toBe('Using git')
  expect(activityOf('a', 'Bash', { command: 'ls -la' }).phase).toBe('Running')
  expect(activityOf('a', 'mcp__backlog__propose', {}).target).toBe('backlog propose')
  expect(activityOf('a', 'Grep', { pattern: 'x'.repeat(80) }).target.length).toBe(32)
})

test('a change counts each file once, and a success ends a failure streak', () => {
  let m = finished(started(null, activityOf('1', 'Edit', { file_path: '/a.ts' }), 0), '1', { isFailed: false, file: '/a.ts', at: 1000 })
  m = finished(m, '2', { isFailed: false, file: '/a.ts', at: 2000 })
  expect(m).toMatchObject({ running: [], changed: ['/a.ts'], lastChangeAt: 2000, failStreak: 0 })
  m = finished(m, '3', { isFailed: true, file: '/b.ts', at: 3000 })
  expect(m).toMatchObject({ changed: ['/a.ts'], lastChangeAt: 2000, failStreak: 1 })
  expect(finished(m, '4', { isFailed: false, file: null, at: 4000 }).failStreak).toBe(0)
})

test('the label names the newest call, the files changed, and a stuck turn', () => {
  expect(label(null, 'thinking', 0)).toBeNull()
  expect(label(emptyMeter(), 'thinking', 0)).toBe('Thinking…')
  let m = started(emptyMeter(), activityOf('1', 'Read', { file_path: '/a.ts' }), 0)
  m = started(m, activityOf('2', 'Grep', { pattern: 'foo' }), 0)
  expect(label(m, 'tool-use', 0)).toBe('Searching foo +1…')
  m = { ...m, changed: ['/a.ts', '/b.ts'], lastChangeAt: 1000 }
  expect(label(m, 'tool-use', 43_000)).toBe('Searching foo +1… · 2 files changed, last 42s ago')
  expect(label({ ...m, failStreak: STUCK_AFTER }, 'tool-use', 43_000)).toMatch(/^Stuck\? 3 failures in a row/)
  // A clipped target carries its own ellipsis, so none is added after it.
  expect(label(started(emptyMeter(), activityOf('3', 'Grep', { pattern: 'y'.repeat(80) }), 0), 'tool-use', 0)).toMatch(/y…$/)
  expect([ago(5000), ago(90_000), ago(3_600_000), ago(3_900_000)]).toEqual(['5s', '1m', '1h', '1h 5m'])
})

test('a finished turn sums its calls, its failures and where its time went', () => {
  let m = started(null, activityOf('1', 'Bash', { command: 'npm test' }), 0)
  m = finished(m, '1', { isFailed: true, file: null, at: 100_000 })
  m = finished(started(m, activityOf('2', 'Edit', { file_path: '/a.ts' }), 100_000), '2', { isFailed: false, file: '/a.ts', at: 102_000 })
  const summary = summarize(m, 130_000, 0)
  expect(summary).toEqual({ durationMs: 130_000, doneAt: 0, files: 1, calls: 2, failed: 1, top: { phase: 'Testing', ms: 100_000 } })
  expect(closingParts(summary)).toEqual(['1 file changed', '2 tools, 1 failed', 'mostly Testing (1m 40s)'])
  expect(closingParts(summarize(null, 5000, 0))).toEqual([])
  expect(closingHead('Brewed', 15_000, Date.now())).toMatch(/^✻ Brewed for 15s · done \d{1,2}:\d{2} [AP]M$/)
  expect([span(42_000), span(120_000), span(7_500_000)]).toEqual(['42s', '2m', '2h 5m'])
  // The newest turn of a length is the one its line closes.
  const list = withSummary(withSummary(null, { ...summary, calls: 9 }), summary)
  expect(summaryOf(list, 130_000)?.calls).toBe(2)
  expect(summaryOf(list, 1)).toBeUndefined()
})

test('the spinner follows the turn and lets go when it ends', async ($, on) => {
  const drawn: Array<Record<string, unknown>> = []
  engine(on, drawn)
  const spin = async () => (await $.ui.mount({ plugin: 'meter', surface: 'terminal', ...SPINNER })).unmount()

  await $.turn.start({ text: 'go', turnId: 't1' })
  await spin()
  expect(drawn.at(-1)).toMatchObject({ message: 'Working…', suffix: '' })

  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  for (const command of ['make', 'make', 'make']) await $.tool.call({ tool: 'Bash', command } as never)
  await spin()
  expect(String(drawn.at(-1)!.message)).toMatch(/^Stuck\? 3 failures in a row… · 1 file changed/)

  await $.turn.complete({ answer: '', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await spin()
  expect(drawn.at(-1)).toMatchObject({ message: null, suffix: '…' })

  // The closing line keeps the engine's words and adds what the turn did.
  const closing = await $.ui.mount({ plugin: 'meter', surface: 'terminal', component: 'TurnDuration', requestId: 't1', props: { word: 'Cooked', durationMs: 4000 } })
  expect(await closing.find({ type: 'Text', text: /^✻ Cooked for 4s · done .+ · 1 file changed · 4 tools, 3 failed/ })).toBeDefined()
  await closing.unmount()
})

test('a closing line another plugin drew as a row gets the summary at its end', async ($, on) => {
  engine(on, [], { closing: false })
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="usage-turn" flexDirection="row">
        <Text>✻ Cooked for 4s</Text>
        <Text> · 12k in</Text>
      </Box>
    )
  })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
  await $.turn.complete({ answer: '', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  const closing = await $.ui.mount({ plugin: 'meter', surface: 'terminal', component: 'TurnDuration', requestId: 't1', props: { word: 'Cooked', durationMs: 4000 } })
  const texts = await closing.findAll({ type: 'Text' })
  expect(texts.map(t => (t as { children?: unknown[] }).children?.join(''))).toEqual(['✻ Cooked for 4s', ' · 12k in', ' · 1 tool · mostly Reading (1s)'])
  await closing.unmount()
})

test("the engine's own message is left alone", async ($, on) => {
  const drawn: Array<Record<string, unknown>> = []
  engine(on, drawn)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.ui.mount({ plugin: 'meter', surface: 'desktop', ...SPINNER, props: { ...SPINNER.props, message: 'Compacting' } })
  expect(drawn.at(-1)!.message).toBe('Compacting')
})
