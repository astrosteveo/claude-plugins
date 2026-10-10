import type { ModelUsage, On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = new Date(2026, 9, 9, 12).getTime()
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const PANE = {
  component: 'Pane',
  requestId: 'aside',
  props: { title: 'Aside', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const USAGE: ModelUsage = { input_tokens: 400, output_tokens: 900, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 0 }

// A long conversation: about 150k tokens as a transcript.
const LONG: SessionMessage[] = Array.from({ length: 30 }, (_, i) => ({
  role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
  text: `${i}`.padEnd(17_500, '.'),
  toolUses: [],
}))

// What the engine answers beneath the plugin, and what the plugin asked of it.
function engine(on: On, { messages = LONG, contextTokens = 150_000 } = {}) {
  const seen = {
    forks: [] as string[],
    completes: [] as { model: string; blocks: number }[],
    spawns: [] as { subagentType?: string; model?: string }[],
    fills: [] as string[],
    submits: [] as string[],
    appends: 0,
    toasts: [] as string[],
  }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `aside:${e.name}` } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: contextTokens }, rateLimits: [] } }))
  on('session.messages', async () => ({ value: messages }))
  on('session.append', async () => {
    seen.appends++
    return { deny: 'no rows in a test' }
  })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('model.fork', async (_$, e) => {
    seen.forks.push(e.prompt)
    return { value: { isAnswered: true as const, text: 'Keep the cache.', usage: USAGE } }
  })
  on('model.complete', async (_$, e) => {
    seen.completes.push({ model: e.model, blocks: e.promptBlocks?.length ?? 1 })
    return { value: { isAnswered: true as const, text: `${e.model} says hi.`, usage: { ...USAGE, cache_read_input_tokens: 0, cache_creation_input_tokens: 150_000 } } }
  })
  on('agent.spawn', async (_$, e) => {
    // The kit hands the spawn on in the Agent tool's own words.
    const call = e as typeof e & { subagent_type?: string }
    seen.spawns.push({ subagentType: call.subagentType ?? call.subagent_type, model: e.model })
    return { model: e.model ?? 'claude-opus-5-5', agentId: 'agent-1' }
  })
  on('prompt.fill', async (_$, e) => {
    seen.fills.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', async (_$, e) => {
    seen.submits.push(e.text)
    return { text: e.text }
  })
  on('tool.call', async () => ({ result: 'ran', text: 'ran' }))

  return { seen, clock }
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]

async function start($: Engine, clock: { advance: (ms: number) => Promise<void> }) {
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  // A main turn just ended, so the session's cache is warm.
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: 'done', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(0)
}

// Fable's price in the model picker of a drawn pane.
const fable = (drawn: string) => Number(/Fable 5\.1 ≈\$(\d+\.\d+)/.exec(drawn)?.[1])

// The pane as drawn on the terminal, as text to search.
async function view($: Engine): Promise<string> {
  const pane = await $.ui.mount({ plugin: 'aside', surface: 'terminal', ...PANE })
  const drawn = JSON.stringify(await pane.drawn())
  await pane.unmount()

  return drawn
}

test('an aside on the session model forks the session and leaves its transcript alone', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($, clock)

  const ran = await $.command.run({ command: 'aside', args: 'should we cache this?', ...RUN })
  await clock.advance(0)
  expect(ran.text).toBeUndefined()
  expect(ran.context).toBeUndefined()
  expect(seen.forks).toHaveLength(1)
  expect(seen.forks[0]).toContain('The question:\nshould we cache this?')
  expect(seen.appends).toBe(0)
  // 400 uncached at $4, 150k cache reads at $0.20 and 900 out at $20 a million.
  expect(await view($)).toContain('Opus 5.5 · session cache · 0s · $0.050 · 150k in (150k cached) · 900 out')
  expect(await view($)).toContain('Keep the cache.')

  // The next question carries the first.
  await $.command.run({ command: 'aside', args: 'and then?', ...RUN })
  await clock.advance(0)
  expect(seen.forks[1]).toContain('Q: should we cache this?\nA: Keep the cache.')
})

test('a model that would cost more than the warm cache is held until the person picks', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($, clock)

  await $.command.run({ command: 'aside', args: '-m sonnet quick check?', ...RUN })
  await clock.advance(0)
  expect(seen.completes).toHaveLength(0)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'aside', surface, ...PANE })
    const why = await pane.find({ type: 'Text', text: /^Sonnet 5.5 costs about \$0\.\d+: a request of its own reads \d+k tokens of this conversation cold\./ })
    expect(JSON.stringify(why)).toMatch(/Opus 5.5, the session's model, reads its whole 150k-token context from cache for about \$0\.\d+\./)
    expect(await pane.find({ type: 'Text', text: 'Held: quick check?' })).toBeDefined()
    expect(await pane.find({ key: 'anyway' })).toBeDefined()
    expect(await pane.find({ key: 'stay' })).toBeDefined()
    await pane.unmount()
  }

  const before = await view($)
  const pane = await $.ui.mount({ plugin: 'aside', surface: 'terminal', ...PANE })
  await pane.press({ key: 'anyway' })
  await clock.advance(0)
  await pane.unmount()
  expect(seen.completes).toEqual([{ model: 'sonnet', blocks: 3 }])
  const after = await view($)
  expect(after).not.toContain('Held:')
  expect(after).toMatch(/est\. ≈\$0\.\d+ vs ≈\$0\.\d+ staying · asked anyway after a hold/)
  // Sonnet counted 150k tokens where about 95k were estimated, so every
  // model's next estimate scales up by about that much: Fable's, for one.
  expect(fable(after)).toBeGreaterThan(fable(before) * 1.4)
  expect(after).toContain('sonnet says hi.')
})

test('on a short conversation the cheaper model goes ahead without asking', async ($, on) => {
  const { seen, clock } = engine(on, { messages: LONG.slice(0, 2), contextTokens: 30_000 })
  await start($, clock)

  await $.command.run({ command: 'aside', args: '-m haiku quick check?', ...RUN })
  await clock.advance(0)
  expect(seen.completes).toHaveLength(1)
  expect(await view($)).not.toContain('Held:')
})

test('with tools, an aside asks for a fork of the session, then an advisor on its model', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($, clock)

  await $.command.run({ command: 'aside', args: '-t does the build pass?', ...RUN })
  await clock.advance(0)
  // The kit starts no subagent, so neither spawn comes back with an id.
  expect(seen.spawns).toEqual([
    { subagentType: 'fork', model: undefined },
    { subagentType: 'aside:advisor', model: 'claude-opus-5-5' },
  ])
  expect(await view($)).toContain('The subagent did not start.')

  // Calls of a subagent the aside did not start are none of its business.
  expect(await $.tool.call({ tool: 'Edit', tool_use_id: 'u1', agentId: 'other', file_path: 'a', old_string: 'a', new_string: 'b' } as never)).toMatchObject({ result: 'ran' })
  const note = await $.prompt.submit({ text: '<task-notification><task-id>other</task-id></task-notification>', wait: false, origin: { kind: 'task-notification' } } as never)
  expect(note).toMatchObject({ text: expect.stringContaining('other') })
})

test('an answer goes to the session only when the person hands it over', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($, clock)
  await $.command.run({ command: 'aside', args: 'should we cache this?', ...RUN })
  await clock.advance(0)
  expect(seen.fills).toHaveLength(0)
  expect(seen.submits).toHaveLength(0)

  await $.command.run({ command: 'aside', args: 'edit', ...RUN })
  expect(seen.fills).toEqual(['I asked Opus 5.5 on the side: should we cache this?\n\nIts answer:\n\nKeep the cache.'])

  const pane = await $.ui.mount({ plugin: 'aside', surface: 'terminal', ...PANE })
  const send = await pane.find({ type: 'Button', text: 'Send to session' })
  await pane.press({ key: String(send?.key) })
  await clock.advance(0)
  await pane.unmount()
  expect(seen.submits).toHaveLength(1)
  expect(await view($)).toContain('sent to the session')
})

test('the pane asks from its own field and picks the model from a list that prices each', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($, clock)

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'aside', surface, ...PANE })
    expect(await pane.find({ type: 'Text', text: /Nothing asked yet/ })).toBeDefined()
    const model = await pane.find({ key: 'model' })
    expect(JSON.stringify(model)).toMatch(/Session \(Opus 5\.5\) ≈\$0\.\d{3}/)
    await pane.unmount()
  }

  const pane = await $.ui.mount({ plugin: 'aside', surface: 'terminal', ...PANE })
  await pane.input({ key: 'ask', text: 'from the pane?' })
  await clock.advance(0)
  await pane.unmount()
  expect(seen.forks[0]).toContain('from the pane?')
})

// A transcript whose last cache write was to the hour-long cache.
const HOUR_CACHE = JSON.stringify({ type: 'assistant', message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 1_387, ephemeral_5m_input_tokens: 0 } } } })

test('the session cache lifetime comes from the transcript, so a ten-minute pause is still warm', async ($, on) => {
  const { seen, clock } = engine(on)
  on('fs.read', async () => ({ value: `${HOUR_CACHE}\n` }))
  on('classic.Stop', async () => ({}))
  await start($, clock)
  await $.classic.Stop({ transcript_path: '/t.jsonl', stop_hook_active: false } as never)
  await clock.advance(10 * 60_000)

  await $.command.run({ command: 'aside', args: '-m sonnet hi', ...RUN })
  await clock.advance(0)
  expect(seen.completes).toHaveLength(0)
  const drawn = await view($)
  expect(drawn).toContain('cache warm (1h cache)')
  expect(drawn).toContain('Ask Sonnet 5.5 anyway')
})

test('on a five-minute cache, a ten-minute pause makes re-caching dearer than another model', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($, clock)
  await clock.advance(10 * 60_000)

  await $.command.run({ command: 'aside', args: '-m sonnet hi', ...RUN })
  await clock.advance(0)
  expect(seen.completes).toHaveLength(1)
  expect(await view($)).not.toContain('asked anyway')
})

test('only the newest answer has buttons; older ones say how to send them', async ($, on) => {
  const { clock } = engine(on)
  await start($, clock)
  await $.command.run({ command: 'aside', args: 'first?', ...RUN })
  await $.command.run({ command: 'aside', args: 'second?', ...RUN })
  await clock.advance(0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'aside', surface, ...PANE })
    expect(await pane.findAll({ type: 'Button', text: 'Send to session' })).toHaveLength(1)
    expect(await pane.find({ type: 'Text', text: '/aside send 1 · /aside edit 1' })).toBeDefined()
    await pane.unmount()
  }
})
