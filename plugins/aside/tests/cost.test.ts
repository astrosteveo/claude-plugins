import { expect, test } from 'claude-code/testing'

import * as cost from '../hooks/cost'

const model = (name: string) => cost.resolve(name) as cost.Model
// Dollars to the millionth, so float noise does not count.
const near = (a: number, b: number) => expect(Math.round(a * 1e6)).toBe(Math.round(b * 1e6))

test('a model name resolves by id, provider id, display name or alias', () => {
  expect(model('claude-opus-5-5').name).toBe('Opus 5.5')
  expect(model('claude-opus-5-5[1m]').name).toBe('Opus 5.5')
  expect(model('opus').name).toBe('Opus 5.5')
  expect(model('Haiku 5.5').id).toBe('claude-haiku-5-5')
  expect(model('us.anthropic.claude-sonnet-4-6').name).toBe('Sonnet 4.6')
  expect(model('claude-opus-4-5-20251101').name).toBe('Opus 4.5')
  expect(model('claude-sonnet-5').name).toBe('Sonnet 5')
  expect(model('fable').name).toBe('Fable 5.1')
  expect(cost.resolve('gpt-5')).toBeUndefined()
})

test('a request is priced by its four token counts', () => {
  const opus = model('opus')
  near(cost.usd(opus, { input: 0, output: 0, read: 1_000_000, write: 0 }), 0.2)
  near(cost.usd(opus, { input: 0, output: 0, read: 0, write: 1_000_000 }), 5)
  near(cost.usd(opus, { input: 0, output: 0, read: 0, write: 1_000_000 }, '1h'), 8)
  near(cost.usd(opus, { input: 1_000_000, output: 1_000_000, read: 0, write: 0 }), 24)
})

test('Haiku 5.5 costs five times as much once a prompt passes 100k tokens', () => {
  const haiku = model('haiku')
  near(cost.usd(haiku, { input: 100_000, output: 0, read: 0, write: 0 }), 0.01)
  near(cost.usd(haiku, { input: 150_000, output: 0, read: 0, write: 0 }), 0.075)
})

const situation = (over: Partial<cost.Situation> = {}): cost.Situation => ({
  session: model('opus'),
  contextTokens: 150_000,
  isMainWarm: true,
  ttl: '5m',
  transcriptTokens: 150_000,
  cached: {},
  askTokens: 500,
  scale: {},
  answers: {},
  runs: {},
  ...over,
})

test('a cheaper model costs more than a warm cache on a long conversation', () => {
  const s = situation()
  const stay = cost.estimate({ route: 'fork', model: s.session }, s)
  const haiku = cost.estimate({ route: 'model', model: model('haiku') }, s)
  expect(haiku).toBeGreaterThan(stay)
  expect(cost.warning({ route: 'model', model: model('haiku') }, haiku, stay, s)).toBe(
    'Haiku 5.5 costs about $0.098: a request of its own reads 150k tokens of this conversation cold. ' +
      "Opus 5.5, the session's model, reads its whole 150k-token context from cache for about $0.062.",
  )
})

test('a cheaper model is cheaper on a short conversation, and says nothing', () => {
  const s = situation({ contextTokens: 30_000, transcriptTokens: 20_000 })
  const stay = cost.estimate({ route: 'fork', model: s.session }, s)
  const haiku = cost.estimate({ route: 'model', model: model('haiku') }, s)
  expect(haiku).toBeLessThan(stay)
  expect(cost.warning({ route: 'model', model: model('haiku') }, haiku, stay, s)).toBeUndefined()
})

test('a cold session cache costs the fork a cache write', () => {
  const warm = cost.estimate({ route: 'fork', model: model('opus') }, situation())
  const cold = cost.estimate({ route: 'fork', model: model('opus') }, situation({ isMainWarm: false }))
  near(cold - warm, (150_000 * (5 - 0.2)) / 1e6)
})

test('a transcript another model already holds in its cache is read, not written', () => {
  const fresh = cost.estimate({ route: 'model', model: model('sonnet') }, situation())
  const held = cost.estimate({ route: 'model', model: model('sonnet') }, situation({ cached: { 'claude-sonnet-5-5': 150_000 } }))
  expect(held).toBeLessThan(fresh / 5)
})

test('money reads to the tenth of a cent under ten cents', () => {
  expect([0.0004, 0.0312, 0.25, 3.456].map(cost.money)).toEqual(['<$0.001', '$0.031', '$0.25', '$3.46'])
  expect([950, 4_560, 142_400, 1_250_000].map(cost.tokens)).toEqual(['950', '4.6k', '142k', '1.3M'])
})

test('estimates scale by what earlier answers on the model really counted', () => {
  const scale = cost.rescale(cost.rescale({}, 'claude-sonnet-5-5', 140_000, 100_000), 'claude-sonnet-5-5', 160_000, 100_000)
  expect(scale).toEqual({ 'claude-sonnet-5-5': 1.5, '*': 1.5 })
  // A count far off is held to three times the estimate.
  expect(cost.rescale({}, 'x', 1_000_000, 1_000)).toEqual({ x: 3, '*': 3 })

  const plain = cost.estimate({ route: 'model', model: model('sonnet') }, situation())
  const scaled = cost.estimate({ route: 'model', model: model('sonnet') }, situation({ scale }))
  expect(scaled).toBeGreaterThan(plain * 1.4)
  // A model with no count of its own takes the count across models.
  expect(cost.scaleFor({ scale }, 'claude-fable-5-1')).toBe(1.5)
  expect(cost.warning({ route: 'model', model: model('fable') }, 2, 0.06, situation({ scale }))).toMatch(/reads 225k tokens of this conversation cold/)
})

test("an estimate counts each model's answers at the length they have run", () => {
  const answers = cost.lengthen(cost.lengthen({}, 'claude-fable-5-1', 4_000), 'claude-fable-5-1', 6_000)
  expect(answers).toEqual({ 'claude-fable-5-1': 5_000 })
  const usual = cost.estimate({ route: 'model', model: model('fable') }, situation())
  const long = cost.estimate({ route: 'model', model: model('fable') }, situation({ answers }))
  near(long - usual, ((5_000 - cost.ANSWER_TOKENS) * 50) / 1e6)
})

test('a subagent run is estimated by what earlier runs cost against their estimate', () => {
  const s = situation()
  const fable = { route: 'agent' as const, model: model('fable') }
  const first = cost.estimate(fable, s)
  // The run cost 1.6 times its estimate: the next estimate moves to it.
  const runs = cost.rerun({}, 'agent', 'claude-fable-5-1', first * 1.6, first)
  expect(runs).toEqual({ 'agent:claude-fable-5-1': 1.6, agent: 1.6 })
  near(cost.estimate(fable, situation({ runs })), first * 1.6)
  // A run that then matches its scaled estimate leaves the factor where it is.
  expect(cost.rerun(runs, 'agent', 'claude-fable-5-1', 2, 2)['agent:claude-fable-5-1']).toBe(1.6)
  // A request of its own is not a run.
  near(cost.estimate({ route: 'model', model: model('fable') }, situation({ runs })), cost.estimate({ route: 'model', model: model('fable') }, s))
})
