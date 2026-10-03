import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { ClientKeyEvent, ModelForkResult, PromptEditInput, PromptEditResult, PromptOrigin } from 'claude-code'

import { ASK, isHotkey, parseSuggestions } from '../hooks/register'

type $ = Parameters<TestBody>[0]

const REPLY = 'The cache is in. Should I add tests for expiry next?'
const ITEMS = ['Yes, add the expiry tests', 'Show me the diff first', 'Use Redis instead of a Map']
const SURFACES = ['terminal', 'desktop'] as const
const USAGE = { input_tokens: 230, output_tokens: 40, cache_read_input_tokens: 29000, cache_creation_input_tokens: 0 }

const band = (surface: (typeof SURFACES)[number], bodyColumns = 100) =>
  ({
    plugin: 'next-prompts',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

type Setup = { reply?: string; fork?: ModelForkResult; box?: string; gate?: Promise<void> }

function setup(on: Parameters<TestBody>[1], { reply = ITEMS.join('\n'), fork, box = '', gate }: Setup = {}) {
  const sent = { asks: [] as string[], submitted: [] as { text: string; origin: PromptOrigin }[], reachedCore: [] as string[] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.fork', async ($, e) => {
    sent.asks.push(e.prompt)
    if (gate) await gate
    return { value: fork ?? { isAnswered: true, text: reply, usage: USAGE } }
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

/** Ends a turn, then lets the unawaited fork finish. */
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

/** The labels of the list's send Buttons as drawn, in order. */
async function shownItems($: $) {
  const ui = await $.ui.mount(band('terminal'))
  const found: string[] = []
  for (const n of [1, 2, 3]) {
    const button = await ui.find({ type: 'Button', key: `send-${n}` })
    if (button) found.push(String(button.props.label))
  }
  await ui.unmount()
  return found
}

test('after a reply, the list shows as Buttons on hotkeys 1-3 and 0, over the band beneath', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)

  // The fork reads the conversation from the cache, so only the request is sent.
  expect(sent.asks).toEqual([ASK])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    for (const [i, item] of ITEMS.entries()) {
      const button = await ui.find({ type: 'Button', key: `send-${i + 1}` })
      expect(button?.props).toMatchObject({ label: item, hotkey: String(i + 1), plain: true })
    }
    expect((await ui.find({ type: 'Button', key: 'dismiss' }))?.props).toMatchObject({ hotkey: '0', role: 'dismiss' })
    expect(await ui.find({ type: 'Text', text: /type your own prompt/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await ui.unmount()
  }
})

for (const n of [1, 2, 3]) {
  test(`pressing ${n} sends suggestion ${n} as your prompt and clears the list`, async ($, on) => {
    const sent = setup(on)
    await start($)
    await reply($, sent)

    const ui = await $.ui.mount(band('terminal'))
    await ui.press({ key: `send-${n}` })
    await ui.unmount()
    await sent.settle()

    expect(sent.submitted.map(s => s.text)).toEqual([ITEMS[n - 1]])
    expect(sent.submitted[0]?.origin).toEqual({ kind: 'plugin', name: 'next-prompts', asUser: true })
    expect(await shownItems($)).toEqual([])
  })
}

test('pressing 0 dismisses the list and sends nothing', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)

  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
  await ui.unmount()
  expect(sent.submitted).toEqual([])
})

test('a hotkey digit keeps the list for the engine to press, and the next key drops it', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)

  // The digit reaches the box as typed: the engine presses the Button from there.
  expect(await edit($, '2')).toEqual({ text: '2', cursor: 1 })
  expect(await shownItems($)).toEqual(ITEMS)
  // A key after it makes the box your own prompt.
  expect(await edit($, ' ', { text: '2' })).toEqual({ text: '2 ', cursor: 2 })
  expect(await shownItems($)).toEqual([])
  expect(sent.reachedCore).toEqual(['2', ' '])
  expect(sent.submitted).toEqual([])
})

test('typing your own prompt drops the list, and keys type as normal', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)

  expect(await edit($, 'h')).toEqual({ text: 'h', cursor: 1 })
  expect(await shownItems($)).toEqual([])
  expect(await edit($, '1', { text: 'h' })).toEqual({ text: 'h1', cursor: 2 })
  expect(sent.reachedCore).toEqual(['h', '1'])
  expect(sent.submitted).toEqual([])
})

test('a paste that holds a digit drops the list', async ($, on) => {
  const sent = setup(on)
  await start($)
  await reply($, sent)

  // A paste arrives with no single key.
  expect(await edit($, '1', { key: null })).toEqual({ text: '1', cursor: 1 })
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

  expect(await shownItems($)).toEqual([])
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

const UNANSWERED: ModelForkResult[] = [
  { isAnswered: false, reason: 'nothing-to-fork' },
  { isAnswered: false, reason: 'empty-reply', usage: USAGE },
]
for (const fork of UNANSWERED) {
  test(`a fork that ends in ${fork.isAnswered ? '' : fork.reason} shows no list`, async ($, on) => {
    const sent = setup(on, { fork })
    await start($)
    await reply($, sent)
    expect(sent.asks.length).toBe(1)
    expect(await shownItems($)).toEqual([])
  })
}

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
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await ui.unmount()
  }
})

test('a long suggestion is cut to fit the band, and sends whole', async ($, on) => {
  const long = 'Rename every cache helper to match the new naming scheme in the docs'
  const sent = setup(on, { reply: [long, ...ITEMS.slice(1)].join('\n') })
  await start($)
  await reply($, sent)

  const ui = await $.ui.mount(band('terminal', 30))
  const label = String((await ui.find({ type: 'Button', key: 'send-1' }))?.props.label)
  // `1: ` and the label fill the band's 30 cells and no more.
  expect(3 + label.length).toBeLessThanOrEqual(30)
  expect(label.endsWith('…')).toBe(true)
  await ui.press({ key: 'send-1' })
  await ui.unmount()
  await sent.settle()
  expect(sent.submitted.map(s => s.text)).toEqual([long])
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

test('only a lone digit key from 0 to 3 into an empty box is a hotkey', () => {
  expect(isHotkey(key('0'))).toBe(true)
  expect(isHotkey(key('1'))).toBe(true)
  expect(isHotkey(key('3'))).toBe(true)
  expect(isHotkey(key('4'))).toBe(false)
  expect(isHotkey(key('a'))).toBe(false)
  expect(isHotkey(key('1', { text: 'x', cursor: 1, start: 1, end: 1 }))).toBe(false)
  expect(isHotkey(key('1', { key: { key: '1', ctrl: true } }))).toBe(false)
  expect(isHotkey(key('1', { key: { key: '1', meta: true } }))).toBe(false)
  const { key: _, ...pasted } = key('1')
  expect(isHotkey(pasted)).toBe(false)
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
