import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Timing } from '../types'
import { clock, duration, groupBadge, keyOf, timingBadge } from '../hooks/format'

const TOOL = { tool_use_id: 'tu1', tool: 'Bash', input: { command: 'npm test' }, isRunning: false, isErrored: false, isInterrupted: false } as const
const ORIGIN = { kind: 'composer' } as const
const call = (id: string) => ({ tool_use_id: id, tool: 'Read', input: { file_path: `/${id}` }, isRunning: false, isErrored: false, isInterrupted: false })

// The engine beneath the plugin: each row draws one Text, so a test can see
// the plugin kept it; the classic hooks and prompt.submit answer as it would.
function engine(on: On) {
  on('ui.render', async (_$, e) => {
    const { Text } = _$.ui.resolve(e)
    return <Text>engine row</Text>
  })
  on('classic.PostToolUse', async () => ({}))
  on('classic.PostToolUseFailure', async () => ({}))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('clock.now', async () => ({ value: Date.parse('2026-10-07T14:05:30') }))
}

test('figures read short', () => {
  expect([duration(1000), duration(3_270), duration(12_400), duration(65_000), duration(3_600_000), duration(3_960_000)]).toEqual(['1.0s', '3.2s', '12s', '1m 5s', '1h', '1h 6m'])
  expect(clock(Date.parse('2026-10-07T09:03:00'))).toBe('09:03')
  expect(keyOf('hello')).toBe(keyOf('hello'))
  expect(keyOf('hello')).not.toBe(keyOf('hellp'))
})

test('a badge marks a call of a second or more, yellow from 30s and red when it failed', () => {
  expect(timingBadge(null)).toBeNull()
  expect(timingBadge({ ms: 999, isErrored: false })).toBeNull()
  expect(timingBadge({ ms: 3_200, isErrored: false })).toEqual({ text: '3.2s', tone: 'quiet' })
  expect(timingBadge({ ms: 30_000, isErrored: false })).toEqual({ text: '30s', tone: 'slow' })
  expect(timingBadge({ ms: 2_000, isErrored: true })).toEqual({ text: '2.0s', tone: 'failed' })
})

test('a group sums its calls once every call is timed', () => {
  const done: Timing[] = [
    { ms: 600, isErrored: false },
    { ms: 900, isErrored: false },
  ]
  expect(groupBadge(done)).toEqual({ text: '1.5s', tone: 'quiet' })
  expect(groupBadge([...done, null])).toBeNull()
  expect(groupBadge([])).toBeNull()
})

test('a tool row shows its run time in the gutter, beside the engine row', async ($, on) => {
  engine(on)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'tu1', duration_ms: 3_270 } as never)
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'tu2', error: 'exit 1', duration_ms: 45_000 } as never)
  await $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 'tu3', duration_ms: 12 } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'gutter', surface, component: 'ToolUse', requestId: 'tu1', props: TOOL })
    expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '3.2s' })).toMatchObject({ props: { color: 'subtle', dimColor: true } })
    await ui.unmount()

    const failed = await $.ui.mount({ plugin: 'gutter', surface, component: 'ToolUse', requestId: 'tu2', props: { ...TOOL, tool_use_id: 'tu2', isErrored: true } })
    expect(await failed.find({ type: 'Text', text: '45s' })).toMatchObject({ props: { color: 'error' } })
    await failed.unmount()

    // A quick read gets no mark, and the engine's row is drawn as it was.
    const quick = await $.ui.mount({ plugin: 'gutter', surface, component: 'ToolUse', requestId: 'tu3', props: { ...TOOL, tool_use_id: 'tu3' } })
    expect(await quick.findAll({ type: 'Text' })).toHaveLength(1)
    await quick.unmount()
  }
})

test('a folded group shows its total, an unfolded or live one leaves it to its rows', async ($, on) => {
  engine(on)
  for (const [id, ms] of [['a', 700], ['b', 800]] as const) {
    await $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: id, duration_ms: ms } as never)
  }
  const props = { calls: [call('a'), call('b')], isActive: false, isExpanded: false }

  const folded = await $.ui.mount({ plugin: 'gutter', surface: 'terminal', component: 'ToolGroup', requestId: 'g1', props })
  expect(await folded.find({ type: 'Text', text: '1.5s' })).toBeDefined()
  await folded.unmount()

  for (const other of [{ isExpanded: true }, { isActive: true }]) {
    const ui = await $.ui.mount({ plugin: 'gutter', surface: 'terminal', component: 'ToolGroup', requestId: 'g1', props: { ...props, ...other } })
    expect(await ui.find({ type: 'Text', text: '1.5s' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a prompt shows when it was sent, and not in the expanded view', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: 'Fix the band', wait: false, origin: ORIGIN })

  const ui = await $.ui.mount({ plugin: 'gutter', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: { text: 'Fix the band', origin: ORIGIN, isExpanded: false } })
  expect(await ui.find({ type: 'Text', text: '14:05' })).toBeDefined()
  await ui.unmount()

  const expanded = await $.ui.mount({ plugin: 'gutter', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: { text: 'Fix the band', origin: ORIGIN, isExpanded: true } })
  expect(await expanded.find({ type: 'Text', text: '14:05' })).toBeUndefined()
  await expanded.unmount()

  // A prompt from before this session has no time to show.
  const older = await $.ui.mount({ plugin: 'gutter', surface: 'terminal', component: 'UserMessage', requestId: 'm0', props: { text: 'Earlier', origin: ORIGIN, isExpanded: false } })
  expect(await older.find({ type: 'Text', text: /\d\d:\d\d/ })).toBeUndefined()
  await older.unmount()
})
