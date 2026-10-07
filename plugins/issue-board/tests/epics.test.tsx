import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { Board, EpicNote } from '../types'
import { draftPrompt, liveEpicNotes, nextOf, parseDraft, parseGraph, sortIssues } from '../hooks/parse'
import { STATUSES, graphPage, isIssuesQuery, adoptedStore } from './graph'
import { letThrough } from './engine'

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 }, command: 'issues' } as const

const EPIC = { number: 35, title: 'Make the issue board a full issue tracker', total: 12, completed: 6 }
// Epic #35, open, with two open sub-issues: #42 waits on #41, #43 is ready. #44 is in no epic.
const ISSUES = [
  { number: 35, title: EPIC.title, labels: [], body: 'The whole.', updatedAt: '2026-10-05T00:00:00Z', subIssues: { total: 12, completed: 6 } },
  { number: 42, title: 'Show epics', labels: [], body: '- [ ] Epics', updatedAt: '2026-10-05T00:00:00Z', parent: EPIC, blockedBy: [{ number: 41, state: 'OPEN' }] },
  { number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit', updatedAt: '2026-10-05T00:00:00Z', parent: EPIC, blockedBy: [{ number: 40, state: 'CLOSED' }] },
  { number: 44, title: 'Show comments', labels: [], body: null, updatedAt: '2026-10-05T00:00:00Z' },
]

test('within an epic the ready sub-issues come first, and Next is the first of them', () => {
  const { issues } = parseGraph([graphPage(ISSUES)])
  expect(sortIssues(issues.filter(issue => issue.parent), null, true).map(issue => issue.number)).toEqual([43, 42])
  expect(nextOf(issues, 35)?.number).toBe(43)
  // Nothing ready: no Next.
  expect(nextOf(issues.filter(issue => issue.number !== 43), 35)).toBeUndefined()
})

test('an epic draft asks for sub-issues and reads them back', () => {
  expect(draftPrompt('saves', ['bug'], true)).toMatch(/^Draft an epic for this repository about: saves: a parent GitHub issue and the sub-issues that, closed, finish it\..*"children"/)
  const reply = JSON.stringify({
    title: 'Saves survive a crash',
    body: 'Why.',
    labels: ['bug', 'nope'],
    children: [{ title: 'Write saves atomically', body: '## Acceptance\n- [ ] Temp file then rename', labels: ['bug'] }, { title: '' }, 'junk', { title: 'Check saves on load', body: '- [ ] Checksums' }],
  })
  expect(parseDraft(reply, ['bug'])).toEqual({
    title: 'Saves survive a crash',
    body: 'Why.',
    labels: ['bug'],
    children: [
      { title: 'Write saves atomically', body: '## Acceptance\n- [ ] Temp file then rename', labels: ['bug'] },
      { title: 'Check saves on load', body: '- [ ] Checksums', labels: [] },
    ],
  })
})

// GitHub with those issues, the issues filed over REST, and the sub-issue links made, as [epic, the sub-issue's id].
const github = (on: On, issues: Raw[] = ISSUES) => {
  // These tests have the board write to the project, which the person let it do.
  adoptedStore(on)
  on('session.root', async () => ({ value: '/work/void-sector' }))
  const state = { filed: [] as { title: string; body: string }[], linked: [] as [number, string][], next: 50 }
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = e.argv
    if (argv[0] === 'git') return answer('main\n')
    if (isIssuesQuery(argv)) return answer(graphPage(issues))
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }))
    if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'POST' && /\/issues$/.test(argv[4] ?? '')) {
      const fields = JSON.parse(e.init?.stdin ?? '{}') as { title: string; body: string }
      state.filed.push({ title: fields.title, body: fields.body })
      const number = state.next++
      return answer(JSON.stringify({ number, id: 9000 + number, node_id: `I_${number}`, html_url: '', updated_at: '2026-10-05T03:00:00Z', labels: [], assignees: [] }))
    }
    if (argv[1] === 'api' && argv[2]?.includes('/issues?state=closed')) return answer('[]')
    if (argv[1] === 'api' && argv[2] === '-X' && /\/sub_issues$/.test(argv[4] ?? '')) {
      state.linked.push([Number(/issues\/(\d+)\//.exec(argv[4] ?? '')?.[1]), argv.at(-1)?.split('=')[1] ?? ''])
      return answer('{}')
    }
    if (argv[1] === 'issue' && argv[2] === 'view') return answer(JSON.stringify({ number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit', updatedAt: '2026-10-05T00:00:00Z' }))
    return answer(argv[1] === 'api' ? 'astrosteveo\n' : '[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  letThrough(on)
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  return state
}

test("grouped by epic, the heading has the epic's progress and Next, and a blocked sub-issue says what it waits on", async ($, on) => {
  adoptedStore(on)
  github(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'group-epic' })

  expect(await ui.find({ text: /^#35 Make the issue board a full issue tracker$/ })).toBeDefined()
  expect(await ui.find({ text: /^6\/12 closed$/ })).toBeDefined()
  expect(await ui.find({ text: /^No epic$/ })).toBeDefined()
  // #42 waits on #41, which is open; #43's blocker is closed, so it's ready.
  expect(await ui.find({ text: /^⛔ #41$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text' })).filter(text => text.text.startsWith('⛔')).length).toBe(1)

  // Next starts the first ready sub-issue, #43, not #42.
  await ui.press({ key: 'next-35' })
  expect(sent.at(-1)).toMatch(/^Let's start on #43: Edit issues from the board\./)

  // The epic's own card has no Next of its own: its Start does the same.
  await ui.press({ key: 'group-area' })
  await ui.press({ key: 'issue-35' })
  expect(await ui.find({ text: /^epic · 6\/12 sub-issues closed$/ })).toBeDefined()
  expect(await ui.find({ key: 'next-35' })).toBeUndefined()
  await ui.unmount()
})

// The board with epic #35's card open, the prompts sent to Claude and the toasts shown.
const epicCard = async ($: Engine, on: On, issues: Raw[] = ISSUES) => {
  adoptedStore(on)
  github(on, issues)
  const sent: string[] = []
  const toasts: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text))
    return { value: undefined }
  })
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-35' })
  return { ui, sent, toasts }
}

test("Start on an epic's card names its first ready sub-issue and starts that, not the epic", async ($, on) => {
  const { ui, sent } = await epicCard($, on)
  expect(await ui.find({ key: 'start-35' })).toMatchObject({ text: '▶ Start #43' })
  await ui.press({ key: 'start-35' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/^Let's start on #43: Edit issues from the board\./)
  await ui.unmount()
})

test('Start in background on an epic starts the worker on its first ready sub-issue', async ($, on) => {
  const spawned: { description?: string; prompt: string }[] = []
  on('agent.spawn', async (_$, e) => {
    spawned.push({ description: e.description, prompt: e.prompt })
    return { model: 'claude-sonnet-5-5', agentId: 'agent-1' }
  })
  const { ui, sent } = await epicCard($, on)
  expect(await ui.find({ key: 'background-35' })).toMatchObject({ text: '⚙ Start #43 in background' })
  await ui.press({ key: 'background-35' })
  expect(spawned).toEqual([{ description: '#43 Edit issues from the board', prompt: expect.stringMatching(/^Let's start on #43: Edit issues from the board\./) }])
  expect(sent).toEqual([])
  await ui.unmount()
})

test('Start on an epic with no ready sub-issue says so in a toast and sends nothing', async ($, on) => {
  // #42 waits on #41, and #43 is gone: nothing under #35 is ready.
  const { ui, sent, toasts } = await epicCard($, on, ISSUES.filter(issue => issue.number !== 43))
  expect(await ui.find({ key: 'start-35' })).toMatchObject({ text: '▶ Start' })
  await ui.press({ key: 'start-35' })
  await ui.press({ key: 'background-35' })
  expect(sent).toEqual([])
  expect(toasts.filter(text => text.startsWith('Epic #35 has no ready sub-issue'))).toHaveLength(2)
  await ui.unmount()
})

test('an epic whose sub-issues are all closed starts itself, from the card and from issue_update', async ($, on) => {
  // #35 with every sub-issue closed and its own boxes still open, as an epic moved to Verification is.
  const done = [{ ...ISSUES[0]!, subIssues: { total: 12, completed: 12 } }, ISSUES[3]!]
  const { ui, sent, toasts } = await epicCard($, on, done)
  expect(await ui.find({ key: 'start-35' })).toMatchObject({ text: '▶ Start' })
  await ui.press({ key: 'start-35' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/^Let's start on #35: Make the issue board a full issue tracker\./)
  expect(toasts.filter(text => text.includes('no ready sub-issue'))).toEqual([])
  await ui.unmount()
  const answer = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 35, start: true })
  expect(JSON.stringify(answer)).toContain('Started #35: it is')
})

test('issue_update start on an epic starts its next ready sub-issue and says which one', async ($, on) => {
  adoptedStore(on)
  github(on)
  await $.command.run({ ...RUN, args: 'refresh' })
  const answer = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 35, start: true })
  expect(JSON.stringify(answer)).toContain('Started #43, the next ready sub-issue of epic #35')
})

test('issue_update start on an epic with no ready sub-issue refuses and says why', async ($, on) => {
  adoptedStore(on)
  github(on, ISSUES.filter(issue => issue.number !== 43))
  await $.command.run({ ...RUN, args: 'refresh' })
  const answer = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 35, start: true })
  expect(JSON.stringify(answer)).toContain('Epic #35 has no ready sub-issue to start')
})

test('/issues new epic captures a parent and its sub-issues to the Inbox, each sub-issue under the parent', async ($, on) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T03:00:00Z') })
  const gh = github(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const asked: string[] = []
  on('model.fork', async (_$, e) => {
    asked.push(e.prompt)
    const text = JSON.stringify({
      title: 'Saves survive a crash',
      body: 'Why.',
      labels: [],
      children: [
        { title: 'Write saves atomically', body: '- [ ] Temp file then rename', labels: [] },
        { title: 'Check saves on load', body: '- [ ] Checksums\n- [ ] Fallback', labels: [] },
      ],
    })
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.command.run({ ...RUN, args: 'refresh' })
  const reply = await $.command.run({ ...RUN, args: 'new epic saves that survive a crash' })
  expect(reply.text).toMatch(/^Capturing an epic and its sub-issues from the conversation to the Inbox\./)
  await clock.settle()
  expect(asked.at(-1)).toMatch(/^Draft an epic for this repository about: saves that survive a crash:/)

  // The epic is filed with the box its last sub-issue closing ticks, then each sub-issue as written, under it.
  expect(gh.filed).toEqual([
    { title: 'Saves survive a crash', body: 'Why.\n\n## Acceptance\n- [ ] Every sub-issue is closed\n' },
    { title: 'Write saves atomically', body: '- [ ] Temp file then rename' },
    { title: 'Check saves on load', body: '- [ ] Checksums\n- [ ] Fallback' },
  ])
  expect(gh.linked).toEqual([
    [50, '9051'],
    [50, '9052'],
  ])
  expect(toasts).toContain('Captured epic #50 and 2 sub-issues to the Inbox')
  // No card waits in the pane.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /draft/ })).toBeUndefined()
  await ui.unmount()
})

test('closing an epic that has open sub-issues asks first, whatever the rules allow', async ($, on) => {
  adoptedStore(on)
  github(on)
  // The engine's own verdict, beneath the board: the person's rules allow the command.
  on('tool.check', async () => ({ decision: 'allow' as const }))
  await $.command.run({ ...RUN, args: 'refresh' })

  const epic = await $.tool.check({ tool: 'Bash', input: { command: 'gh issue close 35 --reason completed' } })
  expect(epic).toMatchObject({ decision: 'ask', reason: '#35 is an epic with 6 open sub-issues. Closing it leaves them open under a closed epic.' })
  const plain = await $.tool.check({ tool: 'Bash', input: { command: 'gh issue close 44' } })
  expect(plain.decision).toBe('allow')
  const other = await $.tool.check({ tool: 'Bash', input: { command: 'git status' } })
  expect(other.decision).toBe('allow')

  // A subagent, such as a background agent, may have nobody watching for the prompt: it is refused, and told why.
  const agent = await $.tool.check({ tool: 'Bash', input: { command: 'gh issue close 35' }, agentId: 'a-1' })
  expect(agent).toMatchObject({
    decision: 'deny',
    reason: '#35 is an epic with 6 open sub-issues. Closing it leaves them open under a closed epic. Close or move the sub-issues first, or leave the epic open and say so in your answer.',
  })
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'gh issue close 44' }, agentId: 'a-1' })).decision).toBe('allow')
})

test('a rule that denies closing an epic still stands, in the main session and in a subagent', async ($, on) => {
  adoptedStore(on)
  github(on)
  on('tool.check', async () => ({ decision: 'deny' as const, reason: 'Denied by a rule.' }))
  await $.command.run({ ...RUN, args: 'refresh' })

  for (const agentId of [undefined, 'a-1']) {
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'gh issue close 35' }, ...(agentId ? { agentId } : {}) })
    expect(verdict).toMatchObject({ decision: 'deny', reason: 'Denied by a rule.' })
  }
})

// GitHub for the epic lifecycle: open issues with their project Status, each issue's body, and the writes the board
// makes, one line each: `status #N <Status>`, `body #N`, `close #N <reason>` and `assign #N`. `created` holds what was
// filed, title and body.
type Raw = Parameters<typeof graphPage>[0][number]
const lifecycle = (on: On, open: Raw[]) => {
  // These tests have the board write to the project, which the person let it do.
  adoptedStore(on)
  on('session.root', async () => ({ value: '/work/void-sector' }))
  const state = { issues: open, writes: [] as string[], bodies: {} as Record<number, string>, created: [] as { title: string; body: string }[] }
  for (const raw of open) state.bodies[raw.number] = raw.body ?? ''
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = [...e.argv]
    if (argv[0] === 'git') return answer('main\n')
    if (isIssuesQuery(argv)) return answer(graphPage(state.issues.map(raw => ({ ...raw, body: state.bodies[raw.number] ?? raw.body })), argv, true))
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }))
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv.some(arg => arg.includes('updateProjectV2ItemFieldValue'))) {
      const item = argv.find(arg => arg.startsWith('item='))?.slice('item=PVTI_'.length) ?? ''
      const status = STATUSES[Number(argv.find(arg => arg.startsWith('option='))?.slice('option=S'.length))]
      state.writes.push(`status #${item} ${status}`)
      state.issues = state.issues.map(raw => (String(raw.number) === item ? { ...raw, status } : raw))
      return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: item } } } }))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql') return answer(JSON.stringify({ data: { addProjectV2ItemById: { item: { id: 'PVTI_new' } } } }))
    if (argv[1] === 'issue' && argv[2] === 'edit' && argv.includes('--body-file')) {
      state.writes.push(`body #${argv[3]}`)
      state.bodies[Number(argv[3])] = e.init?.stdin ?? ''
      return answer('')
    }
    if (argv[1] === 'issue' && argv[2] === 'edit' && argv.includes('--add-assignee')) {
      state.writes.push(`assign #${argv[3]}`)
      return answer('')
    }
    if (argv[1] === 'issue' && argv[2] === 'close') {
      state.writes.push(`close #${argv[3]} ${argv[argv.indexOf('--reason') + 1]}`)
      state.issues = state.issues.filter(raw => String(raw.number) !== argv[3])
      return answer('')
    }
    if (argv[1] === 'issue' && argv[2] === 'view') {
      const number = Number(argv[3])
      const raw = state.issues.find(one => one.number === number)
      return answer(JSON.stringify({ number, title: raw?.title ?? '', labels: [], assignees: [], body: state.bodies[number] ?? '', updatedAt: raw?.updatedAt ?? '2026-10-05T00:00:00Z', id: `I_${number}` }))
    }
    if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'POST' && /\/issues$/.test(argv[4] ?? '')) {
      const fields = JSON.parse(e.init?.stdin ?? '{}') as { title: string; body: string }
      state.created.push({ title: fields.title, body: fields.body })
      const number = 60 + state.created.length
      return answer(JSON.stringify({ number, id: 9000 + number, node_id: `I_${number}`, html_url: '', updated_at: '2026-10-05T00:00:00Z', labels: [], assignees: [] }))
    }
    if (argv[1] === 'api' && argv[2] === 'user') return answer('astrosteveo\n')
    return answer('[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  letThrough(on)
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', async () => ({ value: undefined }))
  // What the engine draws in the band when no plugin has anything to say.
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  return state
}

const epic = (status: string, body = '## Acceptance\n- [ ] Every sub-issue is closed', subIssues = { total: 2, completed: 1 }): Raw => ({
  number: 35,
  title: EPIC.title,
  labels: [],
  body,
  updatedAt: '2026-10-05T00:00:00Z',
  subIssues,
  status,
  priority: 'P1',
})
const sub = (number: number, status: string, parent = { ...EPIC, total: 2, completed: 1 }): Raw => ({
  number,
  title: `Part ${number}`,
  labels: [],
  body: '- [ ] Done',
  updatedAt: '2026-10-05T00:00:00Z',
  parent,
  status,
  priority: 'P1',
})
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const ON = { options: { advanceEpics: true } }

for (const status of ['Inbox', 'Backlog', 'Ready']) {
  test(`starting a sub-issue moves its epic from ${status} to In progress`, ON, async ($, on) => {
    adoptedStore(on)
    const gh = lifecycle(on, [epic(status), sub(43, 'Ready')])
    await $.command.run({ ...RUN, args: 'refresh' })
    await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, start: true })
    expect(gh.writes.filter(line => line.startsWith('status'))).toEqual(['status #43 In progress', 'status #35 In progress'])
  })
}

// Beside it, a second epic at Ready that does move, so the test sees the board moving epics at all.
for (const status of ['In progress', 'Verification', 'Done']) {
  test(`starting a sub-issue leaves an epic at ${status} where it is`, ON, async ($, on) => {
    adoptedStore(on)
    const other = { number: 36, title: 'Stations', total: 1, completed: 0 }
    const gh = lifecycle(on, [epic(status), sub(43, 'Ready'), { ...epic('Ready'), number: 36, title: other.title, subIssues: { total: 1, completed: 0 } }, sub(45, 'Ready', other)])
    await $.command.run({ ...RUN, args: 'refresh' })
    await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, start: true })
    await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 45, start: true })
    expect(gh.writes.filter(line => line.startsWith('status'))).toEqual(['status #43 In progress', 'status #45 In progress', 'status #36 In progress'])
  })
}

test("when the last sub-issue closes, the epic's box is ticked, and with every box ticked it closes and moves to Done", ON, async ($, on) => {
  adoptedStore(on)
  const gh = lifecycle(on, [epic('In progress', '## Acceptance\n- [x] Designed\n- [ ] Every sub-issue is closed'), sub(43, 'In progress')])
  const prompts: (readonly string[])[] = []
  on('prompt.submit', async (_$, e) => {
    prompts.push(e.context ?? [])
    return { text: e.text }
  })
  await $.command.run({ ...RUN, args: 'refresh' })
  expect(gh.writes).toEqual([])

  // #43 closes on GitHub: the epic's count reads 2/2.
  gh.issues = [epic('In progress', gh.bodies[35], { total: 2, completed: 2 })]
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.command.run({ ...RUN, args: 'refresh' })
  expect(gh.writes).toEqual(['body #35', 'close #35 completed', 'status #35 Done'])
  expect(gh.bodies[35]).toBe('## Acceptance\n- [x] Designed\n- [x] Every sub-issue is closed')

  await $.prompt.submit({ text: 'What next?', wait: false, origin: { kind: 'composer' } })
  expect(prompts.at(-1)).toContain('#35 closed as completed and moved to Done: every sub-issue is closed and every box is ticked.')
})

test('an epic with other open boxes moves to Verification instead, and the band and the next prompt say why', ON, async ($, on) => {
  adoptedStore(on)
  const gh = lifecycle(on, [epic('In progress', '## Acceptance\n- [ ] Every sub-issue is closed\n- [ ] Played it through'), sub(43, 'In progress')])
  const prompts: (readonly string[])[] = []
  on('prompt.submit', async (_$, e) => {
    prompts.push(e.context ?? [])
    return { text: e.text }
  })
  await $.command.run({ ...RUN, args: 'refresh' })
  gh.issues = [epic('In progress', gh.bodies[35], { total: 2, completed: 2 })]
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.command.run({ ...RUN, args: 'refresh' })
  expect(gh.writes).toEqual(['body #35', 'status #35 Verification'])
  expect(gh.bodies[35]).toBe('## Acceptance\n- [x] Every sub-issue is closed\n- [ ] Played it through')

  await $.prompt.submit({ text: 'What next?', wait: false, origin: { kind: 'composer' } })
  expect(prompts.at(-1)).toContain('#35 moved to Verification: every sub-issue is closed, but 1 box is still open.')
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /every sub-issue is closed, but 1 box is still open/ })).toBeDefined()
  await band.press({ key: 'dismiss-epic-verify-35' })
  expect(await band.find({ text: /every sub-issue is closed/ })).toBeUndefined()
  await band.unmount()
})

test('a reopened sub-issue, or a new one under a closed epic, shows in the band and writes nothing', ON, async ($, on) => {
  adoptedStore(on)
  const gh = lifecycle(on, [epic('Verification', '- [x] Every sub-issue is closed\n- [ ] Played', { total: 2, completed: 1 }), sub(43, 'In progress')])
  await $.command.run({ ...RUN, args: 'refresh' })

  // #44 reopens under #35, whose count drops; #47 opens under #38, which is closed.
  gh.issues = [
    epic('Verification', gh.bodies[35], { total: 2, completed: 0 }),
    sub(43, 'In progress', { ...EPIC, total: 2, completed: 0 }),
    sub(44, 'Done', { ...EPIC, total: 2, completed: 0 }),
    sub(47, 'Inbox', { number: 38, title: 'Stations', total: 3, completed: 2 }),
  ]
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.command.run({ ...RUN, args: 'refresh' })
  expect(gh.writes).toEqual([])
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /#44 reopened under it/ })).toBeDefined()
  expect(await band.find({ text: /#47 is open under it, and it is closed/ })).toBeDefined()
  await band.unmount()
})

// The keys of the band's epic lines, read off a mounted band.
const epicLines = async ($: Engine) => {
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  const keys = (await band.findAll({ type: 'Box' })).map(box => String(box.key ?? '')).filter(key => key.startsWith('epic-row-'))
  await band.unmount()
  return keys.map(key => key.slice('epic-row-'.length))
}
const refreshTwice = async ($: Engine) => {
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.command.run({ ...RUN, args: 'refresh' })
}

// Epic #35 moved to Verification with one box open, and its line in the band.
const verifying = async ($: Engine, on: On) => {
  const gh = lifecycle(on, [epic('In progress', '## Acceptance\n- [ ] Every sub-issue is closed\n- [ ] Played it through'), sub(43, 'In progress')])
  await $.command.run({ ...RUN, args: 'refresh' })
  gh.issues = [epic('In progress', gh.bodies[35], { total: 2, completed: 2 })]
  await refreshTwice($)
  expect(await epicLines($)).toEqual(['epic-verify-35'])
  return gh
}

test('a Verification line clears when its epic closes', ON, async ($, on) => {
  adoptedStore(on)
  const gh = await verifying($, on)
  gh.issues = []
  await refreshTwice($)
  expect(await epicLines($)).toEqual([])
})

test('a Verification line clears when every box of its epic is ticked', ON, async ($, on) => {
  adoptedStore(on)
  const gh = await verifying($, on)
  gh.bodies[35] = '## Acceptance\n- [x] Every sub-issue is closed\n- [x] Played it through'
  await refreshTwice($)
  expect(await epicLines($)).toEqual([])
})

// #44 reopened under open epic #35, and #47 opened under closed epic #38, each with its line in the band.
const PARENT_35 = { ...EPIC, total: 2, completed: 0 }
const PARENT_38 = { number: 38, title: 'Stations', total: 3, completed: 2 }
const STATIONS: Raw = { number: 38, title: 'Stations', labels: [], body: '- [ ] Every sub-issue is closed', updatedAt: '2026-10-05T00:00:00Z', subIssues: { total: 3, completed: 2 }, status: 'In progress', priority: 'P1' }
const reopening = async ($: Engine, on: On) => {
  const gh = lifecycle(on, [epic('Verification', '- [x] Every sub-issue is closed\n- [ ] Played', { total: 2, completed: 1 }), sub(43, 'In progress')])
  await $.command.run({ ...RUN, args: 'refresh' })
  gh.issues = [epic('Verification', gh.bodies[35], { total: 2, completed: 0 }), sub(43, 'In progress', PARENT_35), sub(44, 'Done', PARENT_35), sub(47, 'Inbox', PARENT_38)]
  await refreshTwice($)
  expect((await epicLines($)).sort()).toEqual(['epic-orphaned-38-47', 'epic-reopened-35-44'])
  return gh
}

// An issue taken out of its epic.
const unparented = ({ parent: _parent, ...rest }: Raw): Raw => rest

const REOPENED: [string, (issues: Raw[]) => Raw[]][] = [
  ['the sub-issue closes', issues => issues.filter(one => one.number !== 44)],
  ['the sub-issue leaves the epic', issues => issues.map(one => (one.number === 44 ? unparented(one) : one))],
  ['the epic closes', issues => issues.filter(one => one.number !== 35)],
]
for (const [when, change] of REOPENED) {
  test(`a reopened line clears when ${when}`, ON, async ($, on) => {
    adoptedStore(on)
    const gh = await reopening($, on)
    gh.issues = change(gh.issues)
    await refreshTwice($)
    expect(await epicLines($)).toEqual(['epic-orphaned-38-47'])
  })
}

const ORPHANED: [string, (issues: Raw[]) => Raw[]][] = [
  ['the sub-issue closes', issues => issues.filter(one => one.number !== 47)],
  ['the sub-issue leaves the epic', issues => issues.map(one => (one.number === 47 ? unparented(one) : one))],
  ['the epic reopens', issues => [...issues, STATIONS]],
]
for (const [when, change] of ORPHANED) {
  test(`an orphaned line clears when ${when}`, ON, async ($, on) => {
    adoptedStore(on)
    const gh = await reopening($, on)
    gh.issues = change(gh.issues)
    await refreshTwice($)
    expect(await epicLines($)).toEqual(['epic-reopened-35-44'])
  })
}

// The age limit is checked when the band draws, so the board needn't read GitHub through the day; reading every 5
// minutes made the test too slow for CI.
test('an epic line is dropped after 24 hours', { options: { ...ON.options, refresh: 'manual' } }, async ($, on) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  await reopening($, on)
  await clock.advance(23 * 60 * 60 * 1000)
  expect(await epicLines($)).toHaveLength(2)
  await clock.advance(60 * 60 * 1000)
  expect(await epicLines($)).toEqual([])
})

test('epic lines draw after every other band line', ON, async ($, on) => {
  adoptedStore(on)
  on('tool.call', { tool: 'TaskCreate' }, async () => ({ result: { task: { id: '1', subject: 'Done' } } }))
  on('tool.call', { tool: 'TaskUpdate' }, async (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  await reopening($, on)
  // Start #43, whose one box becomes a task; Claude completes it, so the band offers to tick the box.
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'issue-43' })
  await pane.press({ key: 'start-43' })
  await pane.unmount()
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  const rows = (await band.findAll({ type: 'Box' })).map(box => String(box.key ?? '')).filter(key => /^(offer|epic-row)-/.test(key))
  await band.unmount()
  expect(rows[0]).toBe('offer-1')
  expect(rows.slice(1).every(key => key.startsWith('epic-row-'))).toBe(true)
  expect(rows).toHaveLength(3)
})

test('liveEpicNotes keeps a line only while what it reports holds, and for a day at most', () => {
  const at = Date.parse('2026-10-05T10:00:00Z')
  const parent = (number: number) => ({ number, title: '', total: 1, completed: 0 })
  const issue = (number: number, extra: Partial<Raw> = {}): Raw => ({ number, title: `#${number}`, labels: [], body: '- [ ] Open', updatedAt: '2026-10-05T00:00:00Z', ...extra })
  const verify: EpicNote = { key: 'v', kind: 'verify', epic: 35, title: '', text: '', at }
  const reopened: EpicNote = { key: 'r', kind: 'reopened', epic: 35, number: 44, title: '', text: '', at }
  const orphaned: EpicNote = { key: 'o', kind: 'orphaned', epic: 38, number: 47, title: '', text: '', at }
  const live = (issues: Raw[], now = at) => liveEpicNotes([verify, reopened, orphaned], { ...parseGraph([graphPage(issues)]), repo: 'a/b', prs: [] } as unknown as Board, now).map(note => note.key)

  expect(live([issue(35), issue(44, { parent: parent(35) }), issue(47, { parent: parent(38) })])).toEqual(['v', 'r', 'o'])
  // The epic closes: its Verification and reopened lines go.
  expect(live([issue(44, { parent: parent(35) }), issue(47, { parent: parent(38) })])).toEqual(['o'])
  // Every box ticked: the Verification line goes.
  expect(live([issue(35, { body: '- [x] Open' }), issue(44, { parent: parent(35) })])).toEqual(['r'])
  // The sub-issues leave their epics.
  expect(live([issue(35), issue(44), issue(47)])).toEqual(['v'])
  // Epic #38 reopens.
  expect(live([issue(35), issue(38), issue(44, { parent: parent(35) }), issue(47, { parent: parent(38) })])).toEqual(['v', 'r'])
  // A day on, nothing.
  expect(live([issue(35), issue(44, { parent: parent(35) }), issue(47, { parent: parent(38) })], at + 24 * 60 * 60 * 1000)).toEqual([])
})

test('issue_create files an epic with the "Every sub-issue is closed" box, and keeps one already there', async ($, on) => {
  adoptedStore(on)
  const gh = lifecycle(on, [])
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Stations', body: 'Docking and trade.', subIssues: [{ title: 'Dock', body: '- [ ] Docks' }] })
  expect(gh.created.map(one => one.body)).toEqual(['Docking and trade.\n\n## Acceptance\n- [ ] Every sub-issue is closed\n', '- [ ] Docks'])
  await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Trade', body: '## Acceptance\n- [ ] Every sub-issue is closed', subIssues: [{ title: 'Sell', body: '' }] })
  expect(gh.created[2]?.body).toBe('## Acceptance\n- [ ] Every sub-issue is closed')
  // A plain issue gets no such box.
  await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Fuel', body: 'Refuel.' })
  expect(gh.created.at(-1)?.body).toBe('Refuel.')
})

test('by default the board moves no epic, and /issues help says the feature is off', async ($, on) => {
  adoptedStore(on)
  const gh = lifecycle(on, [epic('Ready', '- [ ] Every sub-issue is closed'), sub(43, 'Ready')])
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, start: true })
  gh.issues = [epic('Ready', gh.bodies[35], { total: 2, completed: 2 })]
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.command.run({ ...RUN, args: 'refresh' })
  expect(gh.writes.filter(line => line.includes('#35'))).toEqual([])

  const help = String((await $.command.run({ ...RUN, args: 'help' })).text)
  expect(help).toContain('- Moving an epic along with its sub-issues: turned off in /config by Move epics with their sub-issues (advanceEpics).')
})
