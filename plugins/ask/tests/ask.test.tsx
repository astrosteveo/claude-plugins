import type { OpEventResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { SUGGEST, fit, framed, pendingLine, split } from '../hooks/parse'

const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 }
const PANE = { component: 'Pane', requestId: 'ask', props: { title: 'Ask', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const REPLY = 'Two ideas:\n<prompt>Write tests for the band.</prompt>\nor\n<prompt>Split register.tsx\ninto two files.</prompt>'

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

test('a question asked in the pane is answered there, and its prompt goes to the box', async ($, on) => {
  mock.clock(on, { now: 1_000 })
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

test('suggest asks for next prompts; a failed ask can be retried', async ($, on) => {
  mock.clock(on, { now: 1_000 })
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
