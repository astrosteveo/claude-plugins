import type { On, OpEventResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Ask } from '../types'
import { SUGGEST, earlier, fit, framed, pendingLine, split } from '../hooks/parse'

const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 }
const PANE = { component: 'Pane', requestId: 'ask', props: { title: 'Ask', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const REPLY = 'Two ideas:\n<prompt>Write tests for the band.</prompt>\nor\n<prompt>Split register.tsx\ninto two files.</prompt>'

// Counts the plugin's moves to the end of its pane. The kit has no ui.scroll
// of its own, so a move the hook below never sees lands in the debug log as a
// failure; either way it was asked for, and the ask went on.
function scrolls(on: On) {
  const moves: string[] = []
  on('ui.scroll', async (_$, e) => {
    moves.push(e.requestId)
    return {}
  })
  on('ui.log', async (_$, e) => {
    if (e.text.startsWith('ask: scroll to end: ')) moves.push('ask')
    return { value: undefined }
  })
  return moves
}

// Each button row's flexWrap, by its key.
function wrapsOf(node: unknown, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(node)) for (const child of node) wrapsOf(child, out)
  else if (node !== null && typeof node === 'object') {
    const { props, children } = node as { props?: { key?: unknown; flexWrap?: unknown }; children?: unknown }
    const key = props?.key
    if (typeof key === 'string' && (key === 'controls' || key.startsWith('actions-'))) out[key] = props?.flexWrap
    wrapsOf(children ?? [], out)
  }
  return out
}

// The drawn tree as a flat list in drawing order: each text, and each key as `#key`.
function order(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const child of node) order(child, out)
  else if (node !== null && typeof node === 'object') {
    const { props, children } = node as { props?: { key?: unknown }; children?: unknown }
    if (typeof props?.key === 'string') out.push(`#${props.key}`)
    order(children ?? [], out)
  }
  return out
}

test('replies give up their prompts, quoted and numbered in place', () => {
  const { answer, prompts } = split(REPLY)
  expect(prompts).toEqual(['Write tests for the band.', 'Split register.tsx\ninto two files.'])
  expect(answer).toBe('Two ideas:\n\n> **1.** Write tests for the band.\n\nor\n\n> **2.** Split register.tsx\n> into two files.')
  expect(split('No prompts here.')).toEqual({ answer: 'No prompts here.', prompts: [] })
  expect(split('<prompt>  </prompt>Plain.').prompts).toEqual([])
  expect(split('x'.repeat(12000)).answer.length).toBe(9001)
})

test('the question is framed as an aside and asks for tagged prompts', () => {
  const asked = framed('  What next?  ')
  expect(asked).toMatch(/never enters the main conversation/)
  expect(asked).toMatch(/<prompt><\/prompt>/)
  expect(asked.endsWith('\nWhat next?')).toBe(true)
  expect(fit('a  long\nquestion here', 10)).toBe('a long qu…')
  expect(pendingLine(0)).toBeUndefined()
  expect(pendingLine(2)).toBe('ask: 2 thinking…')
})

test('a question carries the last few answered asks, oldest first, within the caps', () => {
  const ask = (id: string, status: Ask['status'], answer?: string): Ask => ({ id, question: `Q${id}?`, status, answer, prompts: [], askedAt: 0 })
  const list = [ask('1', 'answered', 'A1'), ask('2', 'answered', 'A2'), ask('3', 'failed'), ask('4', 'answered', 'A4'), ask('5', 'pending'), ask('6', 'answered', 'A6'), ask('7', 'pending')]
  expect(earlier(list, '7')).toEqual([
    { question: 'Q2?', answer: 'A2' },
    { question: 'Q4?', answer: 'A4' },
    { question: 'Q6?', answer: 'A6' },
  ])
  // A retried ask leaves itself out.
  expect(earlier(list, '6').map(one => one.question)).toEqual(['Q1?', 'Q2?', 'Q4?'])
  expect(earlier([ask('1', 'pending')], '1')).toEqual([])
  // Each answer is cut, and the oldest dropped until the rest fit.
  const long = [ask('1', 'answered', 'x'.repeat(3000)), ask('2', 'answered', 'y'.repeat(3000)), ask('3', 'answered', 'z'.repeat(3000))]
  const kept = earlier(long, 'new')
  expect(kept.map(one => one.question)).toEqual(['Q2?', 'Q3?'])
  expect(kept[0]?.answer.length).toBe(1500)

  const asked = framed('Any others?', [{ question: 'Ideas?', answer: 'Write tests.' }])
  expect(asked).toMatch(/<earlier>\nQ: Ideas\?\nA: Write tests\.\n\n<\/earlier>\n\nAny others\?$/)
  expect(framed('Any others?')).not.toMatch(/<earlier>/)
})

test('a question asked in the pane is answered there, and its prompt goes to the box', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  scrolls(on)
  const forked: string[] = []
  on('model.fork', async (_$, e) => {
    forked.push(e.prompt)
    return { value: { isAnswered: true, text: REPLY, usage: USAGE } } as const
  })
  const filled: string[] = []
  on('prompt.fill', async (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const appended: unknown[] = []
  on('session.append', async (_$, e) => {
    appended.push(e)
    return { message: e.message, uuid: e.uuid }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ask', surface, ...PANE })
    expect(await ui.find({ text: /Nothing asked yet/ })).toBeDefined()

    await ui.input({ key: 'question', text: 'What should I do next?' })
    expect(forked.at(-1)).toMatch(/What should I do next\?$/)
    expect(await ui.find({ text: /› What should I do next\?/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown' })).toMatchObject({ props: { text: expect.stringMatching(/> \*\*2\.\*\* Split/) } })
    expect(toasts.at(-1)).toBe('Answer ready: What should I do next?')

    const second = await ui.find({ type: 'Button', text: /Use 2/ })
    await ui.press({ key: second?.key ?? '' })
    expect(filled.at(-1)).toBe('Split register.tsx\ninto two files.')

    const remove = await ui.find({ type: 'Button', text: /Remove/ })
    await ui.press({ key: remove?.key ?? '' })
    expect(await ui.find({ text: /Nothing asked yet/ })).toBeDefined()
    await ui.unmount()
  }
  // Nothing reached the conversation.
  expect(appended).toEqual([])
})

test('the pane reads like a chat: oldest ask first, the question box and its buttons at the bottom', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  const moves = scrolls(on)
  const forked: string[] = []
  on('model.fork', async (_$, e) => {
    forked.push(e.prompt)
    return { value: { isAnswered: true, text: `Re: ${e.prompt.split('\n').at(-1)}`, usage: USAGE } } as const
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ask', surface, ...PANE })
    // The tree fills the body, so the box sits at the bottom even with few asks.
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { minHeight: 40 } })

    moves.length = 0
    await ui.input({ key: 'question', text: 'First?' })
    await ui.input({ key: 'question', text: 'Second?' })
    // The follow-up carries the first exchange; the first carries none.
    expect(forked.at(-2)).not.toMatch(/<earlier>/)
    expect(forked.at(-1)).toMatch(/<earlier>\nQ: First\?\nA: Re: First\?\n/)
    // Each ask scrolls to the end twice: once asked, once answered.
    expect(moves).toEqual(['ask', 'ask', 'ask', 'ask'])

    const drawn = order(await ui.drawn())
    const at = (item: string) => {
      const index = drawn.indexOf(item)
      expect(index).toBeGreaterThan(-1)
      return index
    }
    expect(at('First?')).toBeLessThan(at('Second?'))
    expect(at('Second?')).toBeLessThan(at('#question'))
    expect(at('#question')).toBeLessThan(at('#suggest'))
    expect(at('#suggest')).toBeLessThan(at('#clear'))

    // Button rows wrap rather than run past a narrow pane.
    const rows = wrapsOf(await ui.drawn())
    expect(Object.keys(rows).filter(key => key.startsWith('actions-')).length).toBe(2)
    expect(Object.values(rows).every(wrap => wrap === 'wrap')).toBe(true)
    expect(rows.controls).toBe('wrap')

    await ui.press({ key: 'clear' })
    await ui.unmount()
  }
})

test('suggest asks for next prompts; a failed ask can be retried', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  scrolls(on)
  let fails = true
  on('model.fork', async (): Promise<OpEventResult<'model.fork'>> => ({
    value: fails
      ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
      : { isAnswered: true, text: '<prompt>Ship it.</prompt>', usage: USAGE },
  }))
  const ui = await $.ui.mount({ plugin: 'ask', surface: 'terminal', ...PANE })

  await ui.press({ key: 'suggest' })
  expect(await ui.find({ text: new RegExp(`› ${SUGGEST}`) })).toBeDefined()
  expect(await ui.find({ text: /The API answered 529 \(overloaded\)\./ })).toBeDefined()

  fails = false
  const retry = await ui.find({ type: 'Button', text: /Retry/ })
  await ui.press({ key: retry?.key ?? '' })
  expect(await ui.find({ type: 'Button', text: /Use prompt/ })).toBeDefined()
  expect(await ui.find({ text: /529/ })).toBeUndefined()

  await ui.press({ key: 'clear' })
  expect(await ui.find({ text: /Nothing asked yet/ })).toBeDefined()
  await ui.unmount()
})

test('with nothing to fork yet, the question goes to a plain completion', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  scrolls(on)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as const)
  const completed: string[] = []
  on('model.complete', async (_$, e) => {
    completed.push(e.prompt)
    return { value: { isAnswered: true, text: 'Fresh answer.', usage: USAGE } } as const
  })
  const ui = await $.ui.mount({ plugin: 'ask', surface: 'terminal', ...PANE })
  await ui.input({ key: 'question', text: 'Hello?' })
  expect(completed.at(-1)).toMatch(/Hello\?$/)
  expect(await ui.find({ type: 'Markdown' })).toMatchObject({ props: { text: 'Fresh answer.' } })
  await ui.unmount()
})

test('/ask with a question opens the pane and prints nothing', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  scrolls(on)
  on('model.fork', async () => ({ value: { isAnswered: true, text: 'Sure.', usage: USAGE } }) as const)
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as const
  })
  const reply = await $.command.run({ command: 'ask', args: 'Is this fine?', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(reply.text).toBeUndefined()
  expect(reply.context).toBeUndefined()
  expect(opened).toEqual(['ask'])
  const ui = await $.ui.mount({ plugin: 'ask', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /› Is this fine\?/ })).toBeDefined()
  await ui.unmount()
})
