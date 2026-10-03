import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { DEFAULT_TTL, MARK, buildPrompt, condense, learnCache, parseArgs, pickRoute, splitReply } from '../hooks/register'

const ASKED = 'Should the cache live in Redis or in memory?'
const NOW = 1_000_000_000
const pane = {
  component: 'Pane',
  requestId: 'consult',
  props: { title: 'Consult', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const run = (args: string) =>
  ({ command: 'consult', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } }) as const
const usage = (read: number, fresh: number) => ({
  input_tokens: fresh,
  output_tokens: 100,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: 0,
})

type Setup = { replies: string[]; box?: string; noFork?: true }

function setup(on: Parameters<TestBody>[1], { replies, box = '', noFork }: Setup) {
  const sent = { forks: [] as string[], completes: [] as string[], fills: [] as string[] }
  let draft = box
  const next = () => replies.shift() ?? 'nothing'
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Add a cache.', toolUses: [] },
      {
        role: 'assistant',
        text: ASKED,
        toolUses: [{ tool_use_id: 't1', tool: 'Read', input: { file_path: 'src/cache.ts' }, text: 'export const cache = new Map()' }],
      },
    ],
  }))
  on('model.fork', ($, e) => {
    sent.forks.push(e.prompt)
    if (noFork) return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
    return { value: { isAnswered: true, text: next(), usage: usage(100_000, 900) } }
  })
  on('model.complete', ($, e) => {
    sent.completes.push(e.prompt)
    return { value: { isAnswered: true, text: next(), usage: usage(0, 12_000) } }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', ($, e) => {
    sent.fills.push(e.text)
    draft = e.text
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  const clock = mock.clock(on, { now: NOW })
  return { sent, clock, type: (text: string) => (draft = text) }
}

const start = ($: Parameters<TestBody>[0]) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
const finishTurn = ($: Parameters<TestBody>[0]) =>
  $.turn.complete({ answer: ASKED, durationMs: 1000, isAborted: false, turnId: 'turn-1', reason: 'answer' })

test('the default route forks while the main cache is warm, with no command output', async ($, on) => {
  const { sent, clock } = setup(on, { replies: [`Memory is simpler.\n${MARK}\nUse memory for now.`] })
  await start($)
  await finishTurn($)
  await clock.advance(10 * 60_000)

  const out = await $.command.run(run('what do you mean?'))
  await clock.settle()

  expect(out.text).toBeUndefined()
  expect(out.context).toBeUndefined()
  expect(sent.forks.length).toBe(1)
  expect(sent.completes.length).toBe(0)
  expect(sent.forks[0]).toContain(ASKED)
  expect(sent.forks[0]).toContain('what do you mean?')
  expect(sent.fills).toEqual(['Use memory for now.'])

  const ui = await $.ui.mount({ plugin: 'consult', surface: 'terminal', ...pane })
  expect(await ui.find({ type: 'Text', text: /Memory is simpler/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /via fork · 100K cached/ })).toBeDefined()
  await ui.unmount()
})

test('the default route uses Sonnet with a condensed transcript once the cache is cold', async ($, on) => {
  const { sent, clock } = setup(on, { replies: [`Cold answer.\n${MARK}\nUse memory.`] })
  await start($)
  await finishTurn($)
  await clock.advance(DEFAULT_TTL + 1)

  await $.command.run(run('what do you mean?'))
  await clock.settle()

  expect(sent.forks.length).toBe(0)
  expect(sent.completes.length).toBe(1)
  expect(sent.completes[0]).toContain('<session_transcript>')
  expect(sent.completes[0]).toContain('[Read]')
  expect(sent.completes[0]).toContain(ASKED)
  expect(sent.fills).toEqual(['Use memory.'])
})

test('with no main turn seen yet, Sonnet answers', async ($, on) => {
  const { sent, clock } = setup(on, { replies: [`A.\n${MARK}\nB.`] })
  await start($)
  await $.command.run(run('prompt add tests'))
  await clock.settle()
  expect(sent.forks.length).toBe(0)
  expect(sent.completes.length).toBe(1)
  expect(sent.completes[0]).toContain('add tests')
})

test('a fork with nothing to fork falls back to Sonnet', async ($, on) => {
  const { sent, clock } = setup(on, { replies: [`A.\n${MARK}\nB.`], noFork: true })
  await start($)
  await finishTurn($)
  await $.command.run(run(''))
  await clock.settle()
  expect(sent.forks.length).toBe(1)
  expect(sent.completes.length).toBe(1)
  expect(sent.fills).toEqual(['B.'])
})

test('follow-ups typed in the pane carry the thread and show in it', async ($, on) => {
  const { sent, clock, type } = setup(on, {
    replies: [
      `Memory is simpler.\n${MARK}\nUse memory for now.`,
      `Redis survives restarts.\n${MARK}\nUse Redis.`,
      `About a day of work.\n${MARK}\nUse Redis, and plan a day for it.`,
    ],
  })
  await start($)
  await finishTurn($)
  await $.command.run(run('what do you mean?'))
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'consult', surface: 'terminal', ...pane })
  await ui.input({ key: 'followup-2', text: 'what about restarts?' })
  await clock.settle()

  expect(sent.forks[1]).toContain('what do you mean?')
  expect(sent.forks[1]).toContain('Memory is simpler.')
  expect(sent.forks[1]).toContain('what about restarts?')
  // The box still held our own fill, so the new draft replaces it.
  expect(sent.fills).toEqual(['Use memory for now.', 'Use Redis.'])

  // An edited box is the user's: the draft stays in the pane.
  type('Use Redis, but ask me first')
  await ui.input({ key: 'followup-4', text: 'how long will it take?' })
  await clock.settle()

  expect(sent.forks[2]).toContain('Redis survives restarts.')
  expect(sent.forks[2]).toContain('what about restarts?')
  expect(sent.forks[2]).toContain('how long will it take?')
  expect(sent.fills.length).toBe(2)

  for (const text of [/what about restarts\?/, /Redis survives restarts/, /how long will it take\?/, /About a day/, /kept your edits/]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  await ui.unmount()
})

test('routes follow the cache mark', () => {
  expect(pickRoute(null, NOW)).toBe('sonnet')
  expect(pickRoute({ at: NOW - 60_000, ttlMs: DEFAULT_TTL }, NOW)).toBe('fork')
  expect(pickRoute({ at: NOW - DEFAULT_TTL, ttlMs: DEFAULT_TTL }, NOW)).toBe('sonnet')
})

test('a warm fork refreshes the mark and a cold one shortens the TTL', () => {
  const mark = { at: NOW - 20 * 60_000, ttlMs: DEFAULT_TTL }
  expect(learnCache(mark, usage(100_000, 900), NOW)).toEqual({ at: NOW, ttlMs: DEFAULT_TTL })
  expect(learnCache(mark, usage(0, 100_000), NOW)).toEqual({ at: mark.at, ttlMs: 18 * 60_000 })
  expect(learnCache({ at: NOW - 60_000, ttlMs: DEFAULT_TTL }, usage(0, 9), NOW)?.ttlMs).toBe(4 * 60_000)
  expect(learnCache(null, usage(1, 1), NOW)).toBeNull()
})

test('the condensed transcript keeps the newest messages within its budget', () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({ role: 'user' as const, text: `message ${i} ${'x'.repeat(100)}`, toolUses: [] }))
  const text = condense(messages, 1000)
  expect(text).toContain('message 49')
  expect(text).not.toContain('message 0 ')
  expect(text.startsWith('(earlier messages left out)')).toBe(true)
})

test('arguments pick the mode', () => {
  expect(parseArgs('')).toEqual({ mode: 'advice', ask: '' })
  expect(parseArgs(' why? ')).toEqual({ mode: 'advice', ask: 'why?' })
  expect(parseArgs('prompt fix the login bug')).toEqual({ mode: 'prompt', ask: 'fix the login bug' })
  expect(parseArgs('promptly answer')).toEqual({ mode: 'advice', ask: 'promptly answer' })
  expect(parseArgs('close')).toBe('close')
})

test('the reply splits at the line holding the mark', () => {
  expect(splitReply(`advice\n${MARK}\ndraft`)).toEqual({ advice: 'advice', draft: 'draft' })
  expect(splitReply('advice only')).toEqual({ advice: 'advice only', draft: '' })
  expect(splitReply(`it says ${MARK} inline`)).toEqual({ advice: `it says ${MARK} inline`, draft: '' })
})

test('a draft that quotes the mark inline arrives whole', () => {
  // The live bug: a prompt about this mod quoted the mark, and the draft lost everything before it.
  const draft = `Enhance the consultant. Keep the \`${MARK}\` part.\n\nCheck these before you build.`
  const reply = `Scoped to the consult mod; the reply format uses \`${MARK}\`.\n${MARK}\n${draft}`
  expect(splitReply(reply)).toEqual({ advice: `Scoped to the consult mod; the reply format uses \`${MARK}\`.`, draft })
  expect(splitReply(`note\n  ${MARK}  \nbody`)).toEqual({ advice: 'note', draft: 'body' })
  expect(buildPrompt('advice', [{ who: 'you', text: '' }], '')).toContain('not sent the user a message yet')
})
