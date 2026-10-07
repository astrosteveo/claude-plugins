import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { Decision, Question, Remembered } from '../types'
import {
  WHY_CHARS,
  agreement,
  agreementLines,
  decorate,
  keyOf,
  logMarkdown,
  matches,
  meter,
  parseTakes,
  rowsOf,
  takeLines,
  takePrompt,
  textOf,
  weekOf,
} from '../hooks/decide'
import type { TakeLine } from '../hooks/decide'

const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 }
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const PANE = { component: 'Pane', requestId: 'decisions', props: { title: 'Decisions', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const AUTH: Question = {
  question: 'Which auth method?',
  header: 'Auth',
  multiSelect: false,
  options: [
    { label: 'JWT', description: 'Signed tokens' },
    { label: 'Sessions', description: 'Server-side sessions' },
  ],
}
const DB: Question = {
  question: 'Which database?',
  header: 'Database',
  multiSelect: false,
  options: [
    { label: 'Postgres', description: 'A server' },
    { label: 'SQLite', description: 'A file' },
  ],
}
const TAKE = JSON.stringify({
  takes: [{ pick: 'JWT', confidence: 82, why: 'Your API is stateless.', plain: 'How users stay logged in.', notes: { JWT: 'The browser holds a signed pass.', Sessions: 'The server remembers who is logged in.' } }],
})
const DAY = 24 * 60 * 60 * 1000

const sum = (lines: TakeLine[]) => lines.reduce((n, l) => n + rowsOf(textOf(l)), 0)

// A store the test can write behind the plugin's back, as another session would.
function sharedStore(on: On, entries: Record<string, unknown> = {}) {
  const stored: Record<string, unknown> = { ...entries }
  on('store.get', async (_$, e) => ({ value: stored[e.key] }))
  on('store.set', async (_$, e) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  return stored
}

// The engine's own dialog beneath the plugin: answers each question with the
// given label after drawing it once Claude's take is in.
function answering(on: On, $: Engine, answers: Record<string, string>, drawn: string[] = []) {
  on('ui.render', { component: 'AskUserQuestion' }, async () => ({ type: 'engine', ref: 0 }) as const)
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const ui = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'AskUserQuestion', requestId: e.tool_use_id, props: { tool: 'AskUserQuestion', questions: e.questions as never } })
    for (let i = 0; i < 50 && (await ui.find({ text: /%/ })) === undefined; i++) await ui.drawn()
    for (const one of await ui.findAll({ type: 'Text' })) drawn.push(one.text ?? '')
    await ui.unmount()
    const asked = e.questions as Question[]
    return { result: { questions: e.questions, answers: Object.fromEntries(asked.map(q => [q.question, answers[q.question] ?? ''])) } as never }
  })
}

test('a question is the same decision whatever its case, spacing or option order', () => {
  const shuffled = { ...AUTH, question: '  which AUTH   method? ', options: [...AUTH.options].reverse() }
  expect(keyOf('/p', shuffled)).toBe(keyOf('/p', AUTH))
  expect(keyOf('/other', AUTH)).not.toBe(keyOf('/p', AUTH))
})

test("Claude's take is read from the reply, and anything that doesn't fit is dropped", () => {
  const [take] = parseTakes(`Sure:\n${TAKE}`, [AUTH])
  expect(take).toMatchObject({ pick: 'JWT', confidence: 82, why: 'Your API is stateless.' })
  expect(parseTakes('{"takes":[{"pick":"OAuth","confidence":90}]}', [AUTH])).toEqual([null])
  expect(parseTakes('not json', [AUTH])).toEqual([null])
  expect(parseTakes('{"takes":[{"pick":"JWT","confidence":400}]}', [AUTH])[0]?.confidence).toBe(100)
  const multi = { ...AUTH, multiSelect: true }
  expect(parseTakes('{"takes":[{"pick":"JWT, Sessions, Nope","confidence":50}]}', [multi])[0]?.pick).toBe('JWT, Sessions')
  expect(takePrompt([AUTH])).toMatch(/Question 1: Which auth method\?\n  - JWT: Signed tokens/)
})

test('the fork is asked for whys short enough for the take box', () => {
  expect(takePrompt([AUTH])).toMatch(new RegExp(`at most ${WHY_CHARS} characters`))
  const why = 'Your API is stateless already, so tokens fit it with nothing new to run.'.slice(0, WHY_CHARS)
  const plain = 'How people stay signed in between one request and the next.'
  const take = { pick: 'JWT', confidence: 82, why, plain, notes: {} }
  // One question: the why and the plain words show whole.
  const one = takeLines([AUTH], [take], 9)
  expect(one.map(textOf)).toContain(`Why: ${why}`)
  expect(one.map(textOf)).toContain(`In plain words: ${plain}`)
  // Two questions: each why shows whole too.
  const two = takeLines([AUTH, DB], [take, { ...take, pick: 'SQLite' }], 9)
  expect(two.filter(l => l.kind === 'note').map(textOf)).toEqual([why, why])
  // When a line must be cut, it ends on a whole word.
  const cut = takeLines([AUTH], [{ ...take, why: 'word '.repeat(40).trim() }], 9).map(textOf)
  expect(cut.find(t => t.startsWith('Why:'))).toMatch(/word…$/)
})

test('decorating keeps every label and puts the take in the descriptions', () => {
  const takes = parseTakes(TAKE, [AUTH])
  const [q] = decorate([AUTH], takes)
  expect(q?.options.map(o => o.label)).toEqual(['JWT', 'Sessions'])
  expect(q?.options[0]?.description).toBe("★ Claude's pick (82%). Signed tokens In plain words: The browser holds a signed pass.")
  expect(q?.options[1]?.description).toBe('Server-side sessions In plain words: The server remembers who is logged in.')
  expect(decorate([AUTH], [null])).toEqual([AUTH])
  expect(meter(82)).toBe('▰▰▰▰▰▰▰▰▱▱')
})

test('the log as markdown says when Claude would have picked otherwise', () => {
  const text = logMarkdown([{ root: '/p', header: 'Auth', question: 'Which?', answer: 'Sessions', pick: 'JWT', confidence: 82, source: 'you', at: 0 }])
  expect(text).toMatch(/→ Sessions \(Claude would have picked JWT, 82%\)/)
})

test('search matches every word, ignoring case', () => {
  expect(matches('', 'anything')).toBe(true)
  expect(matches('AUTH jwt', 'Which auth method?', 'JWT')).toBe(true)
  expect(matches('auth postgres', 'Which auth method?', 'JWT')).toBe(false)
})

test('agreement counts in total, over the last 20, and per week', () => {
  // Noon on a Wednesday, so the week doesn't hang on the time zone.
  const wed = weekOf(new Date(2026, 8, 30, 12).getTime()) + 2 * DAY + 12 * 60 * 60 * 1000
  const one = (at: number, agree: boolean): Decision => ({ root: '/p', header: 'H', question: 'Q', answer: agree ? 'A' : 'B', pick: 'A', confidence: 70, source: 'you', at })
  const log: Decision[] = [
    // The week before: 25 answers, 5 with Claude.
    ...Array.from({ length: 25 }, (_, i) => one(wed - 7 * DAY + i, i < 5)),
    // This week: 4 answers, all with Claude.
    ...Array.from({ length: 4 }, (_, i) => one(wed + i, true)),
    // Remembered answers had no take and don't count.
    { root: '/p', header: 'H', question: 'Q', answer: 'A', source: 'remembered', at: wed + 10 },
  ]
  const a = agreement(log)
  expect(a.total).toEqual({ agreed: 9, of: 29 })
  expect(a.recent).toEqual({ agreed: 4, of: 20 })
  expect(a.weeks.map(w => w.tally)).toEqual([
    { agreed: 4, of: 4 },
    { agreed: 5, of: 25 },
  ])
  const lines = agreementLines(a)
  expect(lines[0]).toBe("You went with Claude's pick 9 of 29 (31%) · last 20: 4 of 20 (20%)")
  expect(lines[1]).toMatch(/^By week: \w{3} \d+ 4\/4 · \w{3} \d+ 5\/25$/)
  expect(agreementLines(agreement([]))).toEqual([])
})

test('an answer is logged with Claude’s take, remembered on request, then given without asking', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.root', async () => ({ value: '/proj' }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('model.fork', async () => ({ value: { isAnswered: true, text: TAKE, usage: USAGE } }) as const)
  // The engine's own dialog beneath the plugin: it records the questions it was handed.
  const handed: Question[][] = []
  on('ui.render', { component: 'AskUserQuestion' }, async (_$, e) => {
    handed.push(e.props.questions as Question[])
    return { type: 'engine', ref: 0 } as const
  })
  on('ui.render', { component: 'AbovePrompt' }, async (_$, e) => {
    const { Box } = _$.ui.resolve(e)
    return <Box key="engine" />
  })

  let dialogs = 0
  const drawn: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    dialogs += 1
    const ui = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'AskUserQuestion', requestId: e.tool_use_id, props: { tool: 'AskUserQuestion', questions: e.questions as never } })
    // The person reads the dialog once Claude's take is in.
    for (let i = 0; i < 50 && (await ui.find({ text: /82%/ })) === undefined; i++) await ui.drawn()
    for (const one of await ui.findAll({ type: 'Text' })) drawn.push(one.text ?? '')
    await ui.unmount()
    return { result: { questions: e.questions, answers: { [AUTH.question]: 'Sessions' } } as never }
  })

  const first = await $.tool.call({ tool: 'AskUserQuestion', questions: [AUTH] })
  expect(dialogs).toBe(1)
  expect((first.result as { answers: Record<string, string> }).answers).toEqual({ [AUTH.question]: 'Sessions' })
  expect(drawn.join('\n')).toMatch(/Claude's take/)
  expect(drawn.join('\n')).toMatch(/In plain words: How users stay logged in\./)
  expect(drawn.join('\n')).toMatch(/82%/)
  expect(handed.at(-1)?.[0]?.options[0]).toEqual({ label: 'JWT', description: "★ Claude's pick (82%). Signed tokens In plain words: The browser holds a signed pass." })

  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /Claude would have picked JWT \(82%\)/ })).toBeDefined()
  expect(await pane.find({ text: /None yet/ })).toBeDefined()
  expect(await pane.find({ text: /You went with Claude's pick 0 of 1 \(0%\)/ })).toBeDefined()

  const band = await $.ui.mount({ plugin: 'ask', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /Remember "Which auth method\?" → Sessions/ })).toBeDefined()
  await band.press({ key: 'remember' })
  expect(await band.find({ key: 'remember' })).toBeUndefined()
  await band.unmount()

  const again = await $.tool.call({ tool: 'AskUserQuestion', questions: [AUTH] })
  expect(dialogs).toBe(1)
  expect((again.result as { answers: Record<string, string> }).answers).toEqual({ [AUTH.question]: 'Sessions' })
  expect(await pane.find({ text: /2 answered in this project/ })).toBeDefined()
  expect(await pane.find({ text: /\(remembered\)/ })).toBeDefined()
  expect(await pane.find({ text: /→ Sessions/ })).toBeDefined()
  await pane.press({ key: (await pane.find({ type: 'Button', text: /Forget/ }))?.key ?? '' })
  expect(await pane.find({ text: /None yet/ })).toBeDefined()
  await pane.unmount()
})

test('a dismissed dialog is left as it was, and nothing is logged', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.root', async () => ({ value: '/proj' }))
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }) as const)
  on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'The user dismissed the question.' }))
  on('ui.render', { component: 'AbovePrompt' }, async (_$, e) => {
    const { Box } = _$.ui.resolve(e)
    return <Box key="engine" />
  })
  const ran = await $.tool.call({ tool: 'AskUserQuestion', questions: [AUTH] })
  expect(ran.deny).toBe('The user dismissed the question.')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /Nothing yet/ })).toBeDefined()
  const band = await $.ui.mount({ plugin: 'ask', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'remember' })).toBeUndefined()
})

test('the take box stays within the rows Claude Code allows around the dialog', async ($, on) => {
  const long = 'a very long sentence that goes on and on '.repeat(6)
  const four: Question[] = [1, 2, 3, 4].map(n => ({ ...AUTH, question: `Q${n} ${long}?`, header: `Header ${n}` }))
  const takes = four.map(() => ({ pick: 'JWT', confidence: 70, why: long, plain: long, notes: { JWT: long } }))
  expect(sum(takeLines(four, takes, 9))).toBeLessThanOrEqual(9)
  expect(takeLines(four, takes, 9).filter(l => l.kind === 'pick').length).toBe(4)
  expect(takeLines([AUTH], takes, 9).map(l => l.kind)).toEqual(['note', 'pick', 'note'])
  expect(sum(takeLines([AUTH], takes, 9))).toBeLessThanOrEqual(9)

  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('session.root', async () => ({ value: '/proj' }))
  on('model.fork', async () => ({ value: { isAnswered: true, text: JSON.stringify({ takes }), usage: USAGE } }) as const)
  on('ui.render', { component: 'AskUserQuestion' }, async () => ({ type: 'engine', ref: 0 }) as const)
  let rows = 0
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    for (const columns of [200, 60]) {
      const ui = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'AskUserQuestion', requestId: e.tool_use_id, viewport: { columns, rows: 40 }, props: { tool: 'AskUserQuestion', questions: e.questions as never } })
      for (let i = 0; i < 50 && (await ui.find({ text: /70%/ })) === undefined; i++) await ui.drawn()
      rows = Math.max(rows, (await ui.findAll({ text: /70%/ })).length)
      await ui.unmount()
    }
    return { result: { questions: e.questions, answers: {} } as never }
  })
  await $.tool.call({ tool: 'AskUserQuestion', questions: four })
  expect(rows).toBeGreaterThan(0)
})

test('store writes keep what another session wrote in between', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  const stored = sharedStore(on)
  on('session.root', async () => ({ value: '/proj' }))
  on('ui.toast', async () => ({ value: undefined }))
  on('model.fork', async () => ({ value: { isAnswered: true, text: TAKE, usage: USAGE } }) as const)
  on('ui.render', { component: 'AbovePrompt' }, async (_$, e) => {
    const { Box } = _$.ui.resolve(e)
    return <Box key="engine" />
  })
  answering(on, $, { [AUTH.question]: 'JWT', [DB.question]: 'SQLite' })

  await $.tool.call({ tool: 'AskUserQuestion', questions: [AUTH] })
  expect((stored.log as Decision[]).map(d => d.question)).toEqual([AUTH.question])

  // Another session answers and remembers a question of its own.
  const theirs: Decision = { root: '/proj', header: 'Deploy', question: 'Where to deploy?', answer: 'Fly', source: 'you', at: 500 }
  const theirKey: Remembered = { key: 'their-key', root: '/proj', question: 'Where to deploy?', answer: 'Fly', at: 500 }
  stored.log = [...(stored.log as Decision[]), theirs]
  stored.remembered = [theirKey]

  // This session remembers its answer, and answers another question.
  const band = await $.ui.mount({ plugin: 'ask', surface: 'terminal', ...BAND })
  await band.press({ key: 'remember' })
  await band.unmount()
  await $.tool.call({ tool: 'AskUserQuestion', questions: [DB] })

  expect((stored.log as Decision[]).map(d => d.question).sort()).toEqual([AUTH.question, DB.question, theirs.question].sort())
  expect((stored.remembered as Remembered[]).map(one => one.question).sort()).toEqual([AUTH.question, theirs.question].sort())

  // Forgetting one keeps the other session's.
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', ...PANE })
  const forget = (await pane.findAll({ type: 'Button', text: /Forget/ })).find(one => String(one.key).includes(AUTH.question))
  await pane.press({ key: forget?.key ?? '' })
  expect((stored.remembered as Remembered[]).map(one => one.question)).toEqual([theirs.question])
  await pane.unmount()
})

test('search filters the log and the remembered answers, and the log copies as markdown', async ($, on) => {
  const log: Decision[] = [
    { root: '/proj', header: 'Auth', question: AUTH.question, answer: 'JWT', pick: 'JWT', confidence: 80, source: 'you', at: 1 },
    { root: '/proj', header: 'Database', question: DB.question, answer: 'SQLite', pick: 'Postgres', confidence: 60, source: 'you', at: 2 },
    { root: '/elsewhere', header: 'Auth', question: AUTH.question, answer: 'Sessions', source: 'you', at: 3 },
  ]
  const remembered: Remembered[] = [
    { key: keyOf('/proj', AUTH), root: '/proj', question: AUTH.question, answer: 'JWT', at: 1 },
    { key: keyOf('/proj', DB), root: '/proj', question: DB.question, answer: 'SQLite', at: 2 },
  ]
  mock.clock(on, { now: 1_000 })
  mock.store(on, { log, remembered })
  on('session.root', async () => ({ value: '/proj' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as const)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const copied: string[] = []
  on('ui.copy', async (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } } as const
  })
  await $.command.run({ command: 'decisions', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'ask', surface, ...PANE })
    expect(await pane.find({ text: /2 answered in this project/ })).toBeDefined()
    expect(await pane.find({ text: /You went with Claude's pick 1 of 2 \(50%\)/ })).toBeDefined()
    expect((await pane.findAll({ type: 'Button', text: /Forget/ })).length).toBe(2)

    await pane.input({ key: 'search', text: 'database', kind: 'change' })
    expect(await pane.find({ text: /1 match the search/ })).toBeDefined()
    expect((await pane.findAll({ type: 'Button', text: /Forget/ })).length).toBe(1)
    expect(await pane.find({ text: /Which auth method/ })).toBeUndefined()
    expect(await pane.find({ text: /Which database/ })).toBeDefined()

    await pane.input({ key: 'search', text: 'nothing like this', kind: 'change' })
    expect(await pane.find({ text: /None match the search/ })).toBeDefined()
    await pane.input({ key: 'search', text: '', kind: 'change' })

    await pane.press({ key: 'copy' })
    expect(copied.at(-1)).toMatch(/^# Decisions/)
    expect(copied.at(-1)).toMatch(/→ SQLite \(Claude would have picked Postgres, 60%\)/)
    expect(copied.at(-1)).not.toMatch(/Sessions/)
    expect(toasts.at(-1)).toBe('Copied 2 decisions as Markdown')
    await pane.unmount()
  }
})
