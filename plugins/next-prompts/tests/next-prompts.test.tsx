import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { ClientKeyEvent, PromptEditInput, PromptEditResult, PromptOrigin } from 'claude-code'

import { choiceFor, condense, parseSuggestions } from '../hooks/register'

type $ = Parameters<TestBody>[0]

const REPLY = 'The cache is in. Should I add tests for expiry next?'
const ITEMS = ['Yes, add the expiry tests', 'Show me the diff first', 'Use Redis instead of a Map']
const SURFACES = ['terminal', 'desktop'] as const

const band = (surface: (typeof SURFACES)[number]) =>
  ({
    plugin: 'next-prompts',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

type Setup = { reply?: string; box?: string; gate?: Promise<void> }

function setup(on: Parameters<TestBody>[1], { reply = ITEMS.join('\n'), box = '', gate }: Setup = {}) {
  const sent = { asks: [] as string[], submitted: [] as { text: string; origin: PromptOrigin }[], reachedCore: [] as string[] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Add a cache.', toolUses: [] },
      { role: 'assistant', text: REPLY, toolUses: [] },
    ],
  }))
  on('model.complete', async ($, e) => {
    sent.asks.push(e.prompt)
    if (gate) await gate
    return { value: { isAnswered: true, text: reply, usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.submit', ($, e) => {
    sent.submitted.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  // Stands for the editor: applies the splice, so a pass shows here.
  on('prompt.edit', ($, e) => {
    sent.reachedCore.push(e.inputText)
    return { text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }
  })
  // Stands for another mod's band, which must still show.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  const clock = mock.clock(on)
  return { ...sent, settle: () => clock.settle() }
}

const start = ($: $) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

/** Ends a turn, then lets the unawaited Haiku call finish. */
async function reply($: $, s: { settle: () => Promise<void> }, more: { agentId?: string; reason?: 'answer' | 'aborted' } = {}) {
  await $.turn.complete({ answer: REPLY, durationMs: 1000, isAborted: more.reason === 'aborted', turnId: 't1', reason: more.reason ?? 'answer', ...(more.agentId ? { agentId: more.agentId } : {}) })
  await s.settle()
}

// The test engine raises prompt.edit, though its types leave the call out.
type EditCall = (e: PromptEditInput) => Promise<PromptEditResult>
function edit($: $, inputText: string, { text = '', key }: { text?: string; key?: ClientKeyEvent | null } = {}) {
  const pressed = key === null ? {} : { key: key ?? { key: inputText } }
  const at = text.length
  return ($.prompt as unknown as { edit: EditCall }).edit({ origin: { kind: 'composer' }, ...pressed, text, cursor: at, start: at, end: at, inputText })
}

async function shownItems($: $) {
  const ui = await $.ui.mount(band('terminal'))
  const found: string[] = []
  for (const item of ITEMS) if (await ui.find({ type: 'Text', text: item })) found.push(item)
  await ui.unmount()
  return found
}

test('the list of 3 shows above the prompt after a reply, over the band beneath', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)

  expect(sent.asks.length).toBe(1)
  expect(sent.asks[0]).toContain(REPLY)
  expect(sent.asks[0]).toContain('Add a cache.')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    for (const [i, item] of ITEMS.entries()) {
      expect(await ui.find({ type: 'Text', text: String(i + 1) })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: item })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /Type 1-3 to send, 0 to dismiss/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await ui.unmount()
  }
})

for (const n of [1, 2, 3]) {
  test(`typing ${n} sends suggestion ${n} as your prompt and clears the list`, async ($, on) => {
    const sent = setup(on)
    await start($)
    await reply($, sent)

    const box = await edit($, String(n))
    // The digit is consumed: the box stays empty and the editor never saw it.
    expect(box).toEqual({ text: '', cursor: 0 })
    expect(sent.reachedCore).toEqual([])
    expect(sent.submitted.map(s => s.text)).toEqual([ITEMS[n - 1]])
    expect(sent.submitted[0]?.origin).toEqual({ kind: 'plugin', name: 'next-prompts', asUser: true })
    expect(await shownItems($)).toEqual([])
  })
}

test('0 dismisses the list, sends nothing, and the next keys type as normal', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)

  expect(await edit($, '0')).toEqual({ text: '', cursor: 0 })
  expect(sent.submitted).toEqual([])
  expect(sent.reachedCore).toEqual([])
  expect(await shownItems($)).toEqual([])
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
  await ui.unmount()

  expect(await edit($, '1')).toEqual({ text: '1', cursor: 1 })
  expect(sent.reachedCore).toEqual(['1'])
  expect(sent.submitted).toEqual([])
})

test('any other key types as normal, clears the list and sends nothing', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)

  expect(await edit($, 'h')).toEqual({ text: 'h', cursor: 1 })
  expect(sent.reachedCore).toEqual(['h'])
  expect(await shownItems($)).toEqual([])
  // A digit after that is part of your own prompt.
  expect(await edit($, '2', { text: 'h' })).toEqual({ text: 'h2', cursor: 2 })
  expect(sent.submitted).toEqual([])
})

test('a paste or a burst of keys that holds a digit types as normal', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)

  // A paste and a burst arrive with no single key.
  expect(await edit($, '1a', { key: null })).toEqual({ text: '1a', cursor: 2 })
  expect(sent.reachedCore).toEqual(['1a'])
  expect(sent.submitted).toEqual([])
  expect(await shownItems($)).toEqual([])
})

test('a list that arrives after you started typing never shows', async ($, on) => {
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  const sent = setup(on, { gate })
  await start($)
  await $.turn.complete({ answer: REPLY, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await sent.settle()
  expect(sent.asks.length).toBe(1)

  await edit($, 'h')
  release()
  await sent.settle()

  expect(sent.asks.length).toBe(1)
  expect(await shownItems($)).toEqual([])
  expect(await edit($, '1')).toEqual({ text: '1', cursor: 1 })
  expect(sent.submitted).toEqual([])
})

test('no list shows when the box already holds a draft', async ($, on) => {
  const sent = setup(on, { box: 'my own draft' })
  await start($)
  await reply($, sent)
  expect(await shownItems($)).toEqual([])
})

test('subagent turns and interrupted turns ask for no list', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent, { agentId: 'a1' })
  await reply($, sent, { reason: 'aborted' })
  expect(sent.asks).toEqual([])
  expect(await shownItems($)).toEqual([])
})

test('a reply with fewer than 3 usable lines shows no list', async ($, on) => {
  const sent = setup(on, { reply: 'Only one idea' })
  await start($)
  await reply($, sent)
  expect(await shownItems($)).toEqual([])
})

test('a new prompt or a new turn clears the list', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)
  expect(await shownItems($)).toEqual(ITEMS)
  await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
  expect(await shownItems($)).toEqual([])

  await reply($, sent)
  expect(await shownItems($)).toEqual(ITEMS)
  await $.turn.start({ text: '', turnId: 't2' })
  expect(await shownItems($)).toEqual([])
})

test('the band yields to a survey, a running turn and an agent view', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)
  const base = band('terminal')
  for (const props of [{ hasSurvey: true }, { isWorking: true }, { view: { agentId: 'a1' } }]) {
    const ui = await $.ui.mount({ ...base, props: { ...base.props, ...props } })
    expect(await ui.find({ type: 'Text', text: ITEMS[0]! })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await ui.unmount()
  }
})

const key = (inputText: string, more: Partial<PromptEditInput> = {}): PromptEditInput => ({
  origin: { kind: 'composer' },
  key: { key: inputText },
  text: '',
  cursor: 0,
  start: 0,
  end: 0,
  inputText,
  ...more,
})

test('only a lone digit key into an empty box picks', () => {
  expect(choiceFor(key('1'), 3)).toBe(0)
  expect(choiceFor(key('3'), 3)).toBe(2)
  expect(choiceFor(key('0'), 3)).toBe('dismiss')
  expect(choiceFor(key('4'), 3)).toBeNull()
  expect(choiceFor(key('a'), 3)).toBeNull()
  expect(choiceFor(key('1', { text: 'x', cursor: 1, start: 1, end: 1 }), 3)).toBeNull()
  expect(choiceFor(key('1', { key: { key: '1', ctrl: true } }), 3)).toBeNull()
  expect(choiceFor(key('1', { key: { key: '1', meta: true } }), 3)).toBeNull()
  const { key: _, ...pasted } = key('1')
  expect(choiceFor(pasted, 3)).toBeNull()
})

test('suggestions lose numbering, bullets and quotes, and stay one short line', () => {
  expect(parseSuggestions('1. Run the tests\n2) "Show the diff"\n- Ship it\n• extra')).toEqual(['Run the tests', 'Show the diff', 'Ship it'])
  expect(parseSuggestions('\n\n  A  \n\nB\n')).toEqual(['A', 'B'])
  // A quote that belongs to the prompt stays: the live bug cut `'active'` to `'active`.
  expect(parseSuggestions("SELECT * FROM users WHERE status = 'active'\n“Use Redis”\n'Run it'")).toEqual([
    "SELECT * FROM users WHERE status = 'active'",
    'Use Redis',
    'Run it',
  ])
  expect(parseSuggestions('x'.repeat(200))[0]).toHaveLength(121)
})

test('the conversation sent to Haiku keeps the newest messages and the last reply', () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({ role: 'user' as const, text: `message ${i} ${'x'.repeat(100)}`, toolUses: [] }))
  const text = condense(messages, 'The final answer.', 1000)
  expect(text).toContain('Claude: The final answer.')
  expect(text).toContain('message 39')
  expect(text).not.toContain('message 0 ')
})
