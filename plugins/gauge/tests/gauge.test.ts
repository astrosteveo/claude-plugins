import type { On, SessionMeasureInput, SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = new Date(2026, 9, 9, 12).getTime()
const USAGE = { model: 'claude-opus-5-5', input_tokens: 200, output_tokens: 1_234, cache_read_input_tokens: 8_000, cache_creation_input_tokens: 1_800 }
const TURN = { answer: 'Done.', durationMs: 12_400, isAborted: false, turnId: 't1', reason: 'answer' } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

// What the engine answers beneath the plugin, and what the plugin showed.
function engine(on: On, { usage = { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 1 } } as SessionUsage } = {}) {
  const seen = { toasts: [] as string[], status: [] as (string | undefined)[], compacts: 0, registered: [] as string[] }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', async (_$, e) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('session.compact', async () => {
    seen.compacts++
    return { skip: 'mocked' }
  })
  on('command.register', async (_$, e) => {
    seen.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.root', async () => ({ value: '/work/app' }))
  on('session.usage', async () => ({ value: usage }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))

  return { seen, clock }
}

function context(tokens: number, window = 1_000_000): SessionMeasureInput {
  return { context: { tokens, window, percent: Math.round((tokens / window) * 100) }, rateLimits: [], changed: ['context'] }
}

test('the status line shows the figures and the token warning fires once per crossing', async ($, on) => {
  const { seen } = engine(on)
  await $.session.measure({ ...context(150_000), rateLimits: [{ kind: 'five_hour', percentUsed: 31 }], cost: { usd: 1 }, changed: ['context', 'cost', 'rateLimits'] })
  expect(seen.status.at(-1)).toBe('ctx 150k/1M 15% · $1.00 · 5h 31%')
  expect(seen.toasts).toEqual([])

  await $.session.measure(context(205_000))
  expect(seen.toasts).toEqual(['Context is 205k tokens. Run /compact to free it.'])
  await $.session.measure(context(210_000))
  expect(seen.toasts).toHaveLength(1)

  // A compaction brings it back under; the next crossing warns again.
  await $.session.measure(context(40_000))
  await $.session.measure(context(220_000))
  expect(seen.toasts).toHaveLength(2)
  expect(seen.compacts).toBe(0)
})

test('each threshold is configurable', { options: { warnTokens: 100_000, compact: 'off', limitPercent: 80 } }, async ($, on) => {
  const { seen } = engine(on)
  await $.session.measure({ ...context(120_000, 140_000), rateLimits: [{ kind: 'seven_day', percentUsed: 82 }], changed: ['context', 'rateLimits'] })
  expect(seen.toasts).toEqual(['Context passed 100k tokens: now 120k.', 'Context is 86% full.', '7d rate limit is 82% used.'])
})

test('auto compaction waits for the turn to end', { options: { compact: 'auto', compactTokens: 150_000 } }, async ($, on) => {
  const { seen, clock } = engine(on)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.session.measure(context(160_000))
  expect(seen.toasts).toEqual(['Context is 160k tokens: compacting.'])
  expect(seen.compacts).toBe(0)
  await $.turn.complete({ ...TURN, usage: USAGE })
  await clock.advance(0)
  expect(seen.compacts).toBe(1)

  // Staying over the line compacts no more.
  await $.session.measure(context(170_000))
  await clock.advance(0)
  expect(seen.compacts).toBe(1)
})

test('/gauge lists each turn with its tokens and cost, and history keeps the day', async ($, on) => {
  const { seen } = engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  expect(seen.registered).toEqual(['gauge'])

  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.turn.complete({ ...TURN, usage: USAGE })
  // A subagent's turn stays out of the table.
  await $.turn.complete({ ...TURN, turnId: 'a1', agentId: 'agent-1', usage: { ...USAGE, model: 'claude-haiku-5-5' } })
  await $.session.measure({ ...context(10_000), cost: { usd: 1.25 }, changed: ['context', 'cost'] })

  const ran = await $.command.run({ command: 'gauge', args: '', ...RUN })
  expect(ran.text).toMatch(/Context +10k of 1M/)
  expect(ran.text).toMatch(/Cost +\$1\.25/)
  expect(ran.text).toMatch(/opus-5-5 .* \$0\.25/)
  expect(ran.text).not.toMatch(/haiku/)

  const history = await $.command.run({ command: 'gauge', args: 'history', ...RUN })
  expect(history.text).toMatch(/2026-10-09 +app +\$0\.25 +1 +20k +2\.5k/)
})

test('/gauge context breaks the window down by category', async ($, on) => {
  const breakdown = {
    totalTokens: 30_000,
    rawMaxTokens: 200_000,
    categories: [
      { name: 'System prompt', tokens: 4_000, kind: 'used' },
      { name: 'Messages', tokens: 26_000, kind: 'used' },
      { name: 'Free space', tokens: 170_000, kind: 'free' },
      { name: 'MCP tools', tokens: 9_000, kind: 'deferred' },
    ],
  }
  engine(on, { usage: { startedAt: 0, context: { window: 200_000, breakdown }, rateLimits: [] } as unknown as SessionUsage })
  const ran = await $.command.run({ command: 'gauge', args: 'context', ...RUN })
  const lines = (ran.text ?? '').split('\n')
  expect(lines[0]).toBe('Context 30k of 200k (15%)')
  expect(lines[2]).toMatch(/^Messages +26k +13%$/)
  expect(lines[3]).toMatch(/^System prompt +4k +2%$/)
  expect(ran.text).toMatch(/Loaded on demand, outside the window: MCP tools 9k/)
})
