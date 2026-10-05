import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { draftPrompt, nextOf, parseDraft, parseGraph, sortIssues } from '../hooks/parse'
import { graphPage, isIssuesQuery } from './graph'

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

// GitHub with those issues, and the issues gh was asked to create.
const github = (on: On) => {
  const state = { created: [] as string[][], next: 50 }
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = e.argv
    if (argv[0] === 'git') return answer('main\n')
    if (isIssuesQuery(argv)) return answer(graphPage(ISSUES))
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }))
    if (argv[1] === 'issue' && argv[2] === 'create') {
      state.created.push(argv.slice(3))
      return answer(`https://github.com/astrosteveo/claude-plugins/issues/${state.next++}\n`)
    }
    if (argv[1] === 'issue' && argv[2] === 'view') return answer(JSON.stringify({ number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit', updatedAt: '2026-10-05T00:00:00Z' }))
    return answer(argv[1] === 'api' ? 'astrosteveo\n' : '[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  return state
}

test("grouped by epic, the heading has the epic's progress and Next, and a blocked sub-issue says what it waits on", async ($, on) => {
  mock.store(on)
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

  // The epic's own card has Next too.
  await ui.press({ key: 'group-area' })
  await ui.press({ key: 'issue-35' })
  expect(await ui.find({ text: /^epic · 6\/12 sub-issues closed$/ })).toBeDefined()
  expect(await ui.find({ key: 'next-35' })).toMatchObject({ text: '▶ Next: #43' })
  await ui.unmount()
})

test('/issues new epic drafts a parent and its sub-issues, and creates each one under the parent', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T03:00:00Z') })
  const gh = github(on)
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
  expect(reply.text).toMatch(/^Drafting an epic and its sub-issues/)
  await clock.settle()
  expect(asked.at(-1)).toMatch(/^Draft an epic for this repository about: saves that survive a crash:/)

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^New epic · draft · 2 sub-issues$/ })).toBeDefined()
  expect(await ui.find({ text: /^Check saves on load$/ })).toBeDefined()
  expect(await ui.find({ key: 'draft-file' })).toMatchObject({ text: '✚ Create the epic and 2 sub-issues' })

  await ui.press({ key: 'draft-file' })
  await clock.settle()
  expect(gh.created.map(args => [args[1], args.includes('--parent') ? args[args.indexOf('--parent') + 1] : null])).toEqual([
    ['Saves survive a crash', null],
    ['Write saves atomically', '50'],
    ['Check saves on load', '50'],
  ])
  expect(await ui.find({ text: /^New epic · draft/ })).toBeUndefined()
  await ui.unmount()
})

test('closing an epic that has open sub-issues asks first, whatever the rules allow', async ($, on) => {
  mock.store(on)
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
})
