import { expect, test } from 'claude-code/testing'

import type { Measure, Turn } from '../types'
import { KEEP, bandParts, cents, columns, crossings, duration, hitRate, levelOf, resetIn, rowCells, tokens, totals, turnFigures, turnOf, usd, withCost, withTurn } from '../hooks/format'

const TURN: Turn = { turnId: 't1', at: 0, model: 'claude-opus-5-5', input: 200, cacheRead: 8000, cacheWrite: 1800, output: 1234, ms: 12_400, isAborted: false }
const MEASURE: Measure = {
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  limits: [
    { kind: 'five_hour', percentUsed: 81 },
    { kind: 'seven_day', percentUsed: 12.5 },
  ],
  usd: 1.234,
}

test('figures read short', () => {
  expect([tokens(950), tokens(1000), tokens(12_400), tokens(123_456), tokens(1_250_000)]).toEqual(['950', '1k', '12.4k', '123k', '1.3M'])
  expect([usd(0.4), usd(12.345), usd(123.4)]).toEqual(['$0.40', '$12.35', '$123'])
  expect([duration(4_400), duration(60_000), duration(125_000)]).toEqual(['4s', '1m', '2m 5s'])
})

test('a figure warns from 80% and is high from 90%', () => {
  expect([levelOf(undefined), levelOf(79.9), levelOf(80), levelOf(89.9), levelOf(90)]).toEqual(['ok', 'ok', 'warn', 'warn', 'high'])
})

test('a reset reads in minutes, hours or days, and not at all once past', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  expect(resetIn('2026-10-07T12:30:00Z', now)).toBe('30m')
  expect(resetIn('2026-10-07T14:10:00Z', now)).toBe('2h 10m')
  expect(resetIn('2026-10-11T15:00:00Z', now)).toBe('4d 3h')
  expect(resetIn('2026-10-07T11:00:00Z', now)).toBeNull()
  expect(resetIn(undefined, now)).toBeNull()
})

test('the hit rate is the share of input the cache served', () => {
  expect(hitRate(TURN)).toBe(80)
  expect(hitRate({ ...TURN, input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull()
})

test('the band shows context, cost and each window, and leaves the last turn to its closing line', () => {
  expect(bandParts(MEASURE)).toEqual([
    { key: 'context', text: 'context 42%', level: 'ok' },
    { key: 'cost', text: '$1.23', level: 'ok' },
    { key: 'limit-five_hour', text: '5h 81%', level: 'warn' },
    { key: 'limit-seven_day', text: '7d 12.5%', level: 'ok' },
  ])
  expect(bandParts(null)).toEqual([])
})

test('a closing line shows the turn it belongs to, with its cost once priced', () => {
  expect(turnFigures(TURN).map(figure => figure.text)).toEqual(['10k in', '1.2k out', '80% cached'])
  expect(turnFigures({ ...TURN, usd: 0.004 }).at(-1)?.text).toBe('<$0.01')
  expect([cents(0), cents(0.004), cents(0.042)]).toEqual(['$0.00', '<$0.01', '$0.04'])

  const older = { ...TURN, turnId: 't0', ms: 5000 }
  expect(turnOf([older, TURN], 12_400)).toBe(TURN)
  expect(turnOf([older, TURN], 5000)).toBe(older)
  expect(turnOf([older, TURN], 1)).toBeUndefined()
})

test('the first measurement after a turn prices that turn alone', () => {
  const start = { turnId: 't1', usd: 1.2 }
  expect(withCost([TURN], start, 1.45)?.at(-1)?.usd).toBe(0.25)
  // A measurement for another turn, or a turn already priced, changes nothing.
  expect(withCost([TURN], { ...start, turnId: 't0' }, 1.25)).toBeNull()
  expect(withCost([{ ...TURN, usd: 0.05 }], start, 1.3)).toBeNull()
  expect(withCost([TURN], null, 1.25)).toBeNull()
  expect(withCost([TURN], start, undefined)).toBeNull()
})

test('the pane keeps the last turns and sums them', () => {
  let list: Turn[] = []
  for (let i = 0; i < KEEP + 5; i += 1) list = withTurn(list, { ...TURN, at: i })
  expect(list).toHaveLength(KEEP)
  expect(list[0]?.at).toBe(5)
  expect(totals([TURN, TURN])).toEqual({ turns: 2, input: 400, cacheRead: 16_000, cacheWrite: 3600, output: 2468, hit: 80 })
  expect(columns(rowCells({ ...TURN, usd: 0.042 }))).toBe('opus-5-5             200      8k    1.8k    1.2k   80%   $0.04      12s')
  expect(rowCells({ ...TURN, isAborted: true }).at(-1)).toBe('stopped')
})

test('each crossing toasts once, and again after falling back', () => {
  const high: Measure = { ...MEASURE, context: { window: 200_000, percent: 86 }, limits: [{ kind: 'five_hour', percentUsed: 91 }] }
  const first = crossings(high, [])
  expect(first.warned).toEqual(['context', 'limit-five_hour'])
  expect(first.toasts).toEqual(['Context is 86% full. Consider /compact.', '5h rate limit is 91% used.'])

  expect(crossings({ ...high, context: { window: 200_000, percent: 88 } }, first.warned).toasts).toEqual([])

  const fell = crossings({ ...high, context: { window: 200_000, percent: 30 } }, first.warned)
  expect(fell.warned).toEqual(['limit-five_hour'])
  expect(crossings(high, fell.warned).toasts).toEqual(['Context is 86% full. Consider /compact.'])
})
