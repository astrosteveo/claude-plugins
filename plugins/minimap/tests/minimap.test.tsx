import type { On } from 'claude-code'
import type { Segment } from '../types'
import { expect, test } from 'claude-code/testing'

import { MAX_TURNS, closeTurn, emptyDraft, kindOf, mainKind, weightOf, withCall, withCompaction, withTurn } from '../hooks/turns'
import { ABORTED_GLYPH, COLOR, DEFAULT, DIVIDER_GLYPH, ERROR, FLOOR, TURN_GLYPH, bucketsFor, decode, encode, scale, stripOf } from '../hooks/paint'

const USAGE = { model: 'claude-opus-5-5', input_tokens: 200, output_tokens: 1000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 800 }
const TURN = { answer: 'Done.', durationMs: 12_400, isAborted: false, turnId: 't1', reason: 'answer' } as const

// The engine beneath the plugin: each tool call answers, Bash fails, and the
// end of a turn and a compaction answer as the engine would.
function engine(on: On) {
  on('tool.call', async (_$, e) => (e.tool === 'Bash' ? { isError: true, result: 'exit 1', text: 'exit 1' } : { result: {} }))
  on('turn.complete', async () => ({ text: '' }))
  on('session.compact', async (_$, e) => ({ messages: e.messages }) as never)
  on('ui.log', async () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, async (_$, e) => {
    const { Box } = _$.ui.resolve(e)
    return <Box key="engine" />
  })
}

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const strip = async (ui: { find: (q: object) => Promise<unknown> }) => {
  const raster = (await ui.find({ type: 'Raster' })) as { props: { columns: number; cells: string } } | undefined
  return raster === undefined ? undefined : { columns: raster.props.columns, cells: decode(raster.props.cells) }
}

test('tools sort into kinds, and a turn takes the kind it called most', () => {
  expect([kindOf('Edit'), kindOf('Grep'), kindOf('Bash'), kindOf('Agent'), kindOf('WebFetch'), kindOf('mcp__x__y')]).toEqual(['edit', 'read', 'bash', 'agent', 'web', 'other'])
  expect(mainKind({})).toBe('talk')
  expect(mainKind({ read: 6, edit: 3 })).toBe('read')
  // A tie goes to the kind that changes more.
  expect(mainKind({ read: 3, edit: 3 })).toBe('edit')
})

test('a turn of mostly edits is an edit, and a failed call counts as an error', () => {
  let draft = withCall(null, 'Read', false)
  draft = withCall(draft, 'Edit', false)
  draft = withCall(draft, 'Edit', false)
  draft = withCall(draft, 'Bash', true)
  expect(closeTurn(draft, { turnId: 't1', reason: 'answer', usage: USAGE })).toEqual({
    turnId: 't1',
    kind: 'edit',
    errors: 1,
    weight: weightOf(USAGE),
    isCompacted: false,
    isAborted: false,
  })
})

test('a compaction marks its turn, and an error or refusal ending counts as an error', () => {
  expect(closeTurn(withCompaction(null), { turnId: 't2', reason: 'answer' })).toMatchObject({ isCompacted: true, kind: 'talk', weight: 0 })
  expect(closeTurn(emptyDraft(), { turnId: 't3', reason: 'error' })).toMatchObject({ errors: 1 })
  expect(closeTurn(emptyDraft(), { turnId: 't4', reason: 'refusal' })).toMatchObject({ errors: 1 })
  expect(closeTurn(emptyDraft(), { turnId: 't5', reason: 'aborted' })).toMatchObject({ errors: 0, isAborted: true })
})

test('output weighs more than input, and cache reads weigh least', () => {
  expect(weightOf({ input_tokens: 0, output_tokens: 100 })).toBeGreaterThan(weightOf({ input_tokens: 100, output_tokens: 0 }))
  expect(weightOf({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100 })).toBeLessThan(weightOf({ input_tokens: 100, output_tokens: 0 }))
  expect(weightOf(undefined)).toBe(0)
})

test('the oldest turns go once the list is full', () => {
  const one = closeTurn(null, { turnId: 'x', reason: 'answer' })
  const full = Array.from({ length: MAX_TURNS }, (_, i) => ({ ...one, turnId: `t${i}` }))
  const next = withTurn(full, { ...one, turnId: 'last' })
  expect(next).toHaveLength(MAX_TURNS)
  expect(next[0]!.turnId).toBe('t1')
  expect(next.at(-1)!.turnId).toBe('last')
})

const seg = (turnId: string, over: Partial<Segment> = {}): Segment => ({ turnId, kind: 'edit', errors: 0, weight: 100, isCompacted: false, isAborted: false, ...over })

test('cells survive the trip through the Raster encoding', () => {
  const cells = [{ glyph: TURN_GLYPH, fg: 0xff8800, bg: DEFAULT }, { glyph: DIVIDER_GLYPH, fg: 0x123456, bg: ERROR }]
  expect(decode(encode(cells))).toEqual(cells)
  // One orange cell, as the Raster docs pack it.
  expect(encode([{ glyph: 0x2588, fg: 0xff8800, bg: DEFAULT }])).toBe('iCUAAACI/wAAAAAB')
})

test('each kind has its color, the costliest turn is brightest and the cheapest at the floor', () => {
  const cells = stripOf([seg('a', { kind: 'read', weight: 10 }), seg('b', { kind: 'bash', weight: 50 }), seg('c', { kind: 'edit', weight: 900 })], 80)
  expect(cells.map(c => c.fg)).toEqual([scale(COLOR.read, FLOOR), scale(COLOR.bash, (1 + FLOOR) / 2), COLOR.edit])
  expect(cells.every(c => c.glyph === TURN_GLYPH && c.bg === DEFAULT)).toBe(true)
})

test('a failed turn has a red top, an aborted one is low, and a compaction draws a divider before its turn', () => {
  const cells = stripOf([seg('a'), seg('b', { errors: 2 }), seg('c', { isCompacted: true }), seg('d', { isAborted: true, weight: 0 })], 80)
  expect(cells.map(c => c.glyph)).toEqual([TURN_GLYPH, TURN_GLYPH, DIVIDER_GLYPH, TURN_GLYPH, ABORTED_GLYPH])
  expect(cells[1]!.bg).toBe(ERROR)
  expect(cells[4]!.fg).toBe(scale(COLOR.edit, FLOOR))
})

test('past the band width, turns share cells so the strip still covers the whole session', () => {
  const turns = Array.from({ length: 250 }, (_, i) => seg(`t${i}`, { weight: i, errors: i === 7 ? 1 : 0 }))
  const buckets = bucketsFor(turns, 100)
  expect(buckets).toHaveLength(84)
  expect(buckets[0]).toMatchObject({ turnId: 't0', weight: 0 + 1 + 2, errors: 0 })
  expect(buckets[2]).toMatchObject({ turnId: 't6', errors: 1 })
  expect(stripOf(turns, 100).length).toBeLessThanOrEqual(100)
  // A compaction's divider takes a column too.
  const compacted = turns.map((t, i) => (i % 50 === 0 ? { ...t, isCompacted: true } : t))
  expect(stripOf(compacted, 100).length).toBeLessThanOrEqual(100)
})

test('a main-loop turn draws a cell above the band, and a subagent turn adds none', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/b', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'Fix it', toolUses: [] }] } as never)
  await $.turn.complete({ ...TURN, usage: USAGE })
  // A subagent's turn is part of its Agent call, so it is not a turn here.
  await $.turn.complete({ ...TURN, turnId: 'sub', agentId: 'a1', usage: USAGE })
  await $.turn.complete({ ...TURN, turnId: 't2', usage: { ...USAGE, output_tokens: 10 } })

  const ui = await $.ui.mount({ plugin: 'minimap', surface: 'terminal', ...BAND })
  // A compaction before the first turn has nothing to divide it from.
  expect(await strip(ui)).toEqual({
    columns: 2,
    cells: [
      { glyph: TURN_GLYPH, fg: COLOR.edit, bg: ERROR },
      { glyph: TURN_GLYPH, fg: scale(COLOR.talk, FLOOR), bg: DEFAULT },
    ],
  })
  expect(await ui.find({ type: 'Box', key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'minimap' })).toMatchObject({ props: { flexDirection: 'column' } })
  await ui.unmount()
})

test('the band is left to the engine before the first turn, on desktop, and under a survey', async ($, on) => {
  engine(on)
  const empty = await $.ui.mount({ plugin: 'minimap', surface: 'terminal', ...BAND })
  expect(await strip(empty)).toBeUndefined()
  await empty.unmount()

  await $.turn.complete({ ...TURN, usage: USAGE })
  const desktop = await $.ui.mount({ plugin: 'minimap', surface: 'desktop', ...BAND })
  expect(await desktop.find({ type: 'Box', key: 'minimap' })).toBeUndefined()
  expect(await desktop.find({ type: 'Box', key: 'engine' })).toBeDefined()
  await desktop.unmount()

  const survey = await $.ui.mount({ plugin: 'minimap', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await strip(survey)).toBeUndefined()
  await survey.unmount()
})
