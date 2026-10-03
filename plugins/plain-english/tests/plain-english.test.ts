import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { extraPatterns, findPhrases, flagLine } from '../hooks/phrases'
import { OLD_STYLE_NOTICE, SECTION, responseText } from '../hooks/register'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const FLOWERY = "Once PR #223 lands that's our cue to transition to preparing #227 for flight."
const PLAIN = 'PR #223 is complete and merged. PR #227 is next highest priority.'

test('finds the phrases in the example from the request', () => {
  expect(findPhrases(FLOWERY)).toEqual(['Once PR #223 lands', 'our cue', 'for flight'])
})

test('leaves plain status updates alone', () => {
  expect(findPhrases(PLAIN)).toEqual([])
  expect(findPhrases('PR #223 is not merged yet. After it merges, PR #227 is next.')).toEqual([])
  expect(findPhrases('The landing page now loads. In-flight requests retry. The next update ships Monday.')).toEqual([])
})

test('flags "land" for merges and leaves a literal landing alone', () => {
  expect(findPhrases('Once this lands, I will start #227.')).toEqual(['Once this lands'])
  expect(findPhrases('The fix for #12 has landed.')).toEqual(['#12 has landed'])
  expect(findPhrases('I will land PR #223 first.')).toEqual(['land PR #223'])

  expect(findPhrases('When the player lands on the platform, reset the jump count.')).toEqual([])
  expect(findPhrases('The player has landed.')).toEqual([])
  expect(findPhrases('Land the jump to score. When it lands, play the dust effect.')).toEqual([])
})

test('skips code, links, block quotes and quoted text', () => {
  const text = [
    'Run `kick off --now` to start it.',
    '```',
    'once deploy lands, set flag',
    '```',
    '> That said, the ball is in your court.',
    'You wrote "that is our cue" in the issue.',
    'See https://example.com/home-stretch for the docs.',
  ].join('\n')
  expect(findPhrases(text)).toEqual([])
})

test('names each phrase once', () => {
  expect(findPhrases('Moving on. Next up is the parser. Moving on again.')).toEqual(['Moving on', 'Next up'])
})

test('extra phrases are matched literally, and a phrase inside a longer one is not named again', () => {
  const extra = extraPatterns(' all hands on deck? , ship it ,')
  expect(findPhrases('Time to ship it. All hands on deck?', extra)).toEqual(['ship it', 'All hands on deck?'])
  expect(findPhrases('Shipping it later.', extra)).toEqual([])
})

test('reads the text blocks of a response row and skips the rest', () => {
  const content = [
    { type: 'thinking', thinking: 'Plan the fix.' },
    { type: 'text', text: 'With that in place, I will run the tests.' },
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
    { type: 'text', text: 'Running them now.' },
  ]
  expect(responseText(content)).toBe('With that in place, I will run the tests.\nRunning them now.')
})

// The kit has no engine beneath session.append, so these tests drive a turn
// through its final answer. The test above covers what that hook reads.
function engine(on: On) {
  const toasts: string[] = []
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'You are Claude.', scope: 'shared' },
      { id: 'tone', text: '# Tone', scope: 'shared' },
    ],
  }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  return { toasts }
}

type Style = { name: string; isKeepingCodingInstructions: boolean } | null

const compose = ($: $, outputStyle: Style = null, traits: ('bare' | 'print')[] = []) =>
  $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle, traits })

const start = ($: $) => $.turn.start({ text: 'What is next?', turnId: 'turn-1' })

const finish = ($: $, answer: string, agentId?: string) =>
  $.turn.complete({
    answer,
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    ...(agentId ? { agentId } : {}),
  })

/** Submits a prompt and returns the context the model reads beside it. */
const submit = async ($: $, text: string) => {
  const result = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  return result.drop === undefined ? (result.context ?? []) : []
}

test('adds the rules as the last section of the system prompt', async ($, on) => {
  const { toasts } = engine(on)
  const { sections } = await compose($)
  expect(sections.map(s => s.id)).toEqual(['intro', 'tone', SECTION])
  expect(sections.at(-1)?.scope).toBe('session')
  expect(sections.at(-1)?.text).toContain('PR #223 is complete and merged. PR #227 is next highest priority.')
  expect(toasts).toEqual([])
})

test('leaves a --bare prompt alone', async ($, on) => {
  engine(on)
  const { sections } = await compose($, null, ['bare'])
  expect(sections.map(s => s.id)).toEqual(['intro', 'tone'])
})

test('says once when the old output style is still on', async ($, on) => {
  const { toasts } = engine(on)
  const style = { name: 'Plain Language', isKeepingCodingInstructions: true }
  await compose($, style)
  await compose($, style)
  expect(toasts).toEqual([OLD_STYLE_NOTICE])
})

test('flags the reply and names the phrases in the next reminder only', async ($, on) => {
  engine(on)
  await start($)
  const done = await finish($, FLOWERY)
  expect(done.text).toBe(flagLine(['Once PR #223 lands', 'our cue', 'for flight']))

  const first = await submit($, 'Go ahead.')
  expect(first.length).toBe(1)
  expect(first[0]).toContain('Plain English: write short, literal sentences.')
  expect(first[0]).toContain('Your last reply used figurative wording: "Once PR #223 lands", "our cue", "for flight".')

  const second = await submit($, 'Thanks.')
  expect(second[0]).toContain('Plain English: write short, literal sentences.')
  expect(second[0]).not.toContain('Your last reply used')
})

test('a plain reply shows nothing extra', async ($, on) => {
  engine(on)
  await start($)
  const done = await finish($, PLAIN)
  expect(done.text).toBe(PLAIN)
  expect((await submit($, 'Ok.'))[0]).not.toContain('Your last reply used')
})

test('a subagent turn is not checked', async ($, on) => {
  engine(on)
  const sub = await finish($, FLOWERY, 'agent-1')
  expect(sub.text).toBe(FLOWERY)
  expect((await submit($, 'Ok.'))[0]).not.toContain('Your last reply used')
})

test('an interrupted turn is not checked', async ($, on) => {
  engine(on)
  await start($)
  const done = await $.turn.complete({ answer: FLOWERY, durationMs: 1000, isAborted: true, turnId: 'turn-1', reason: 'aborted' })
  expect(done.text).toBe(FLOWERY)
})

test('with showFlags off, the reply shows nothing but the reminder still names the phrases', { options: { showFlags: false } }, async ($, on) => {
  engine(on)
  await start($)
  const done = await finish($, FLOWERY)
  expect(done.text).toBe(FLOWERY)
  expect((await submit($, 'Ok.'))[0]).toContain('"our cue"')
})

test('phrases from the extraPhrases option are flagged too', { options: { extraPhrases: 'ship it' } }, async ($, on) => {
  engine(on)
  await start($)
  const done = await finish($, 'The fix is ready. Time to ship it.')
  expect(done.text).toBe(flagLine(['ship it']))
})
