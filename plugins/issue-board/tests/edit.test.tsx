import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { changesText, commandsOf, statusOnly } from '../hooks/parse'
import { asksProject, graphPage, isIssuesQuery, optionId } from './graph'

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const RUN = { command: 'issues', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

test('a change becomes gh commands in order: the edit, then the comment, then the close', () => {
  expect(commandsOf(43, { addLabels: ['bug'], removeLabels: ['future'], assign: ['@me'], parent: 35, milestone: null, comment: ' Done here. ', close: 'not planned' })).toEqual([
    { argv: ['issue', 'edit', '43', '--add-label', 'bug', '--remove-label', 'future', '--add-assignee', '@me', '--parent', '35', '--remove-milestone'] },
    { argv: ['issue', 'comment', '43', '--body-file', '-'], stdin: 'Done here.' },
    { argv: ['issue', 'close', '43', '--reason', 'not planned'] },
  ])
  expect(commandsOf(43, { parent: null, milestone: 'Launch', reopen: true })).toEqual([
    { argv: ['issue', 'edit', '43', '--remove-parent', '--milestone', 'Launch'] },
    { argv: ['issue', 'reopen', '43'] },
  ])
  // Status and Priority are the project's, not gh issue edit's.
  expect(commandsOf(43, { status: 'Verification', priority: 'P1' })).toEqual([])
  expect(changesText(43, { status: 'Verification', addLabels: ['bug'], close: 'completed' })).toBe('#43 moved to Verification, labelled bug, closed as completed.')
  expect(changesText(43, {})).toBe('Nothing to change on #43.')
  expect([statusOnly({ status: 'Done' }), statusOnly({ status: 'Done', comment: 'x' }), statusOnly({ priority: 'P0' }), statusOnly({})]).toEqual([true, false, false, false])
})

const EPIC = { number: 35, title: 'Make the issue board a full issue tracker', total: 12, completed: 6 }

// GitHub for claude-plugins with its project: every gh command asked for, its stdin, and how often the issues were read.
const github = (on: On) => {
  const state = { calls: [] as { argv: string[]; stdin?: string }[], reads: 0 }
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = [...e.argv]
    if (argv[0] === 'git') return answer('main\n')
    if (isIssuesQuery(argv)) {
      state.reads += 1
      return answer(
        graphPage(
          [
            { number: 35, title: EPIC.title, labels: [], body: 'The whole.', updatedAt: '2026-10-05T00:00:00Z', subIssues: { total: 12, completed: 6 }, status: 'In progress', priority: 'P1' },
            { number: 43, title: 'Edit issues from the board', labels: [{ name: 'enhancement' }], body: '- [ ] Edit', updatedAt: '2026-10-05T00:00:00Z', parent: EPIC, status: 'Ready', priority: 'P1' },
          ],
          argv,
          asksProject(argv),
        ),
      )
    }
    state.calls.push({ argv: argv.slice(1), ...(e.init?.stdin !== undefined ? { stdin: e.init.stdin } : {}) })
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }))
    if (argv[1] === 'label' && argv[2] === 'list') return answer(JSON.stringify([{ name: 'bug' }, { name: 'enhancement' }, { name: 'area:issue-board' }]))
    if (argv[1] === 'api' && argv[2]?.startsWith('repos/')) return answer(JSON.stringify([{ title: 'Launch' }]))
    if (argv[1] === 'issue' && argv[2] === 'view') return answer(JSON.stringify({ number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit', updatedAt: '2026-10-05T00:00:00Z' }))
    if (argv[1] === 'api' && argv[2] === 'graphql') return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'x' } } } }))
    return answer(argv[1] === 'api' ? 'astrosteveo\n' : '[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  return state
}

// The gh commands that change an issue, without the board's reads.
const writes = (calls: { argv: string[]; stdin?: string }[]) =>
  calls.filter(call => ['edit', 'comment', 'close', 'reopen'].includes(call.argv[1] ?? '') || (call.argv[0] === 'api' && call.argv.some(arg => arg.startsWith('query=mutation'))))

test("Claude's issue_update tool makes the changes in order and the board reads GitHub straight after", async ($, on) => {
  mock.store(on)
  const gh = github(on)
  await $.command.run({ ...RUN, args: 'refresh' })
  const before = gh.reads

  const done = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, status: 'Verification', addLabels: ['bug'], assign: ['@me'], comment: 'Built; checking it live.', close: 'completed' })
  expect(String(done.result)).toBe('#43 moved to Verification, labelled bug, assigned @me, commented on, closed as completed.')
  expect(writes(gh.calls).map(call => (call.argv[0] === 'api' ? `project ${call.argv.find(arg => arg.startsWith('option='))}` : call.argv.join(' ')))).toEqual([
    `project option=${optionId('Verification')}`,
    'issue edit 43 --add-label bug --add-assignee @me',
    'issue comment 43 --body-file -',
    'issue close 43 --reason completed',
  ])
  expect(writes(gh.calls)[2]?.stdin).toBe('Built; checking it live.')
  expect(gh.reads).toBeGreaterThan(before)

  // An issue the board doesn't hold can't have its Status set, and says why.
  const missing = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 99, status: 'Done' })
  expect(missing.deny).toMatch(/^Couldn't change #99: #99 isn't open on the board/)
  const empty = await $.tool.call({ tool: 'mcp__issue-board__issue_update', status: 'Done' })
  expect(empty.deny).toBe('Give the issue number, and what to change on it.')
})

test("moving the Status of the issue Claude is on doesn't ask; any other change does", async ($, on) => {
  mock.store(on)
  github(on)
  // Beneath the board, Claude Code asks before a tool that changes something.
  on('tool.check', async () => ({ decision: 'ask' as const }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'start-43' })

  const check = (input: Record<string, unknown>) => $.tool.check({ tool: 'mcp__issue-board__issue_update', input })
  expect((await check({ number: 43, status: 'Verification' })).decision).toBe('allow')
  expect((await check({ number: 35, status: 'Verification' })).decision).toBe('ask')
  expect((await check({ number: 43, status: 'Done', comment: 'Done.' })).decision).toBe('ask')
  expect((await check({ number: 43, addLabels: ['bug'] })).decision).toBe('ask')
  await ui.unmount()
})

test("the card's editor changes labels, assignee and milestone, comments, and asks twice to close an epic with open sub-issues", async ($, on) => {
  mock.store(on)
  const gh = github(on)
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'edit-43' })

  // The repo's labels, the one it has drawn as set; the repo's milestones.
  expect(await ui.find({ key: 'label-43-enhancement' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'label-43-bug' })).toBeDefined()
  expect(await ui.find({ key: 'milestone-43-Launch' })).toBeDefined()
  expect(await ui.find({ text: /^#35 Make the issue board/ })).toBeDefined()

  await ui.press({ key: 'label-43-bug' })
  await ui.press({ key: 'label-43-enhancement' })
  await ui.press({ key: 'assign-43' })
  await ui.press({ key: 'milestone-43-Launch' })
  await ui.press({ key: 'unparent-43' })
  await ui.input({ key: 'reply-43', text: 'Looks right.', kind: 'change' })
  await ui.input({ key: 'reply-43', text: 'Looks right.', kind: 'submit' })
  await ui.input({ key: 'parent-43', text: '#35', kind: 'submit' })
  expect(writes(gh.calls).map(call => call.argv.join(' '))).toEqual([
    'issue edit 43 --add-label bug',
    'issue edit 43 --remove-label enhancement',
    'issue edit 43 --add-assignee @me',
    'issue edit 43 --milestone Launch',
    'issue edit 43 --remove-parent',
    'issue comment 43 --body-file -',
    'issue edit 43 --parent 35',
  ])
  await ui.press({ key: 'close-not-planned-43' })
  expect(writes(gh.calls).at(-1)?.argv.join(' ')).toBe('issue close 43 --reason not planned')

  // The epic: the first press of Close says what's open; the second closes it.
  const count = writes(gh.calls).length
  await ui.press({ key: 'issue-35' })
  await ui.press({ key: 'edit-35' })
  await ui.press({ key: 'close-completed-35' })
  expect(await ui.find({ text: /^#35 is an epic with 6 open sub-issues\. .*Press again to close it anyway\.$/ })).toBeDefined()
  expect(writes(gh.calls).length).toBe(count)
  await ui.press({ key: 'close-completed-35' })
  expect(writes(gh.calls).at(-1)?.argv.join(' ')).toBe('issue close 35 --reason completed')
  await ui.unmount()
})
