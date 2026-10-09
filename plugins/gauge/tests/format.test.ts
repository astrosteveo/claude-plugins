import { expect, test } from 'claude-code/testing'

import * as fmt from '../hooks/format'

test('token counts read short', () => {
  expect([950, 1_000, 12_340, 142_400, 1_000_000, 1_250_000].map(fmt.tokens)).toEqual(['950', '1k', '12k', '142k', '1M', '1.3M'])
  expect(fmt.tokens(4_560)).toBe('4.6k')
})

test('dollars round to the cent and show under a cent as <$0.01', () => {
  expect(fmt.usd(1.234)).toBe('$1.23')
  expect(fmt.usd(0.001)).toBe('<$0.01')
  expect(fmt.usd(0)).toBe('$0.00')
})

test('durations read short', () => {
  expect([3_200, 48_000, 125_000, 4_200_000].map(fmt.duration)).toEqual(['3.2s', '48s', '2m 5s', '1h 10m'])
})

test('the status line leaves out figures it has no reading for', () => {
  const full = { tokens: 142_000, window: 200_000, percent: 71, usd: 1.23, limits: [{ kind: 'five_hour', percentUsed: 31 }, { kind: 'seven_day', percentUsed: 12.4 }] }
  expect(fmt.statusLine(full)).toBe('ctx 142k/200k 71% · $1.23 · 5h 31% · 7d 12%')
  expect(fmt.statusLine({ window: 200_000, limits: [] })).toBe('')
})

test('the cache hit rate is the share of input the cache served', () => {
  expect(fmt.hitRate(200, 8_000, 1_800)).toBe(80)
  expect(fmt.hitRate(0, 0, 0)).toBe(0)
})

test('the turn table lists newest first with a totals row', () => {
  const turn = { turnId: 't1', at: 0, model: 'claude-opus-5-5', input: 200, cacheRead: 8_000, cacheWrite: 1_800, output: 1_234, ms: 12_400, isAborted: false, usd: 0.04 }
  const text = fmt.turnTable([turn, { ...turn, turnId: 't2', model: 'claude-sonnet-5-5', isAborted: true, usd: undefined }], 60_000)
  const lines = text.split('\n')
  expect(lines[1]).toMatch(/^sonnet-5-5 .* stopped/)
  expect(lines[2]).toMatch(/^opus-5-5 .* \$0\.04 +12s/)
  expect(lines[3]).toMatch(/^2 turns +400 +16k +3\.6k +2\.5k +80% +\$0\.04/)
})
