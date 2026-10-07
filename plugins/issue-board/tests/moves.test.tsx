import { expect, test } from 'claude-code/testing'

import type { Board, Issue } from '../types'
import { movedText, unmovedText } from '../hooks/changes'
import { leftForDone, leftForVerification } from '../hooks/epics'
import { EPIC, PANE, github, writeLine, writes } from './claude-plugins'
import { graphArg, optionId } from './graph'
import { adoptedStore } from './github'
import { REFRESH } from './ui'

// Moving issues: Start's own Status move and assignment, the moves the board makes on its own when issues close or a
// Refs pull request merges, and an epic's sub-issues in GitHub's order.

test('Claude starting on an issue in the conversation marks it as Start does, and a pull request starts the issue it is for', async ($, on) => {
  adoptedStore(on)
  const pr = {
    number: 50,
    title: 'Let the board edit issues',
    url: 'https://github.com/astrosteveo/claude-plugins/pull/50',
    headRefName: 'feat/edit',
    isDraft: false,
    body: 'Refs #43',
    statusCheckRollup: [],
    reviewDecision: null,
    additions: 1,
    deletions: 1,
    author: { login: 'astrosteveo' },
    updatedAt: '2026-10-05T00:00:00Z',
  }
  const gh = github(on, [pr])
  // Beneath the board, Claude Code asks before a tool that changes something.
  on('tool.check', async () => ({ decision: 'ask' as const }))
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)

  // Starting, alone, needs no permission, as pressing Start doesn't; with another change it asks as before.
  const check = (input: Record<string, unknown>) => $.tool.check({ tool: 'mcp__issue-board__issue_update', input })
  expect((await check({ number: 43, start: true })).decision).toBe('allow')
  expect((await check({ number: 43, start: true, comment: 'On it.' })).decision).toBe('ask')

  const started = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, start: true })
  expect(String(started.result)).toBe('Started #43: it is the issue this session is on, In progress and assigned.')
  expect(writes(gh.calls).map(writeLine)).toEqual([
    `project option=${optionId('In progress')}`,
    'issue edit 43 --add-assignee @me',
  ])

  // The row has the ▶ of the issue this session is on, and the card says Started, with no Start in background.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  expect(await ui.find({ text: /^▶ $/ })).toBeDefined()
  expect(await ui.find({ text: /^▶ Started$/ })).toBeDefined()
  expect(await ui.find({ key: 'start-43' })).toBeUndefined()
  expect(await ui.find({ key: 'background-43' })).toBeUndefined()
  await ui.unmount()

  // A pull request's number starts the issue it is for; one that names no open issue says so.
  const viaPr = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 50, start: true })
  expect(String(viaPr.result)).toBe('Started #43, the issue pull request #50 is for: it is the issue this session is on, In progress and assigned.')
  const missing = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 77, start: true })
  expect(missing.deny).toMatch(/^Couldn't change #77: #77 isn't open on the board/)
})

test('an issue that closes as completed moves to Done in the project; one closed as not planned stays', { options: { autoMove: true } }, async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)
  const before = writes(gh.calls).length

  // On GitHub, #43 closes as completed and #35 as not planned; both leave the board at its next read.
  gh.closed = { 43: 'completed', 35: 'not planned' }
  await $.command.run(REFRESH)
  await $.command.run(REFRESH)
  const moved = writes(gh.calls).slice(before)
  expect(moved.map(call => [graphArg(call, 'item'), graphArg(call, 'option')])).toEqual([[expect.stringMatching(/43/), `option=${optionId('Done')}`]])
  // The person sees it once: what moved, and why.
  expect(toasts.filter(text => text.startsWith('Moved'))).toEqual(['Moved #43 to Done: it closed as completed.'])
})

test("a move the board makes on its own that GitHub refuses says so once, with where to look", { options: { autoMove: true } }, async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)
  gh.refuseFields = true
  gh.closed = { 43: 'completed', 35: 'completed' }
  await $.command.run(REFRESH)
  await $.command.run(REFRESH)
  expect(toasts.filter(text => text.startsWith("Couldn't move"))).toEqual([
    "Couldn't move 2 issues (#35, #43) to Done: gh: Resource not accessible by integration. /issues check may say why.",
  ])
})

test('by default the board moves nothing on its own, and asks GitHub nothing for it', async ($, on) => {
  adoptedStore(on)
  const gh = github(on, [
    {
      number: 50,
      title: 'Part of the work',
      url: 'https://github.com/astrosteveo/claude-plugins/pull/50',
      headRefName: 'feat/50',
      isDraft: false,
      body: 'Refs #35',
      statusCheckRollup: [],
      reviewDecision: null,
      additions: 1,
      deletions: 1,
      author: { login: 'astrosteveo' },
      updatedAt: '2026-10-05T00:00:00Z',
    },
  ])
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)
  const before = gh.ran.length
  // #43 closes as completed and pull request #50, which refers to #35, merges and leaves.
  gh.closed = { 43: 'completed' }
  gh.merged = { 50: true }
  await $.command.run(REFRESH)
  await $.command.run(REFRESH)
  const asked = gh.ran.slice(before)
  expect(asked.filter(line => line.includes('state_reason') || line.includes('/pulls/') || line.includes('updateProjectV2ItemFieldValue'))).toEqual([])
  expect(toasts.filter(text => text.startsWith('Moved'))).toEqual([])
})

test("with Start's own changes turned off, Claude starting on an issue leaves its assignees and Status alone", { options: { claimOnStart: false } }, async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const started = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, start: true })
  expect(String(started.result)).toBe('Started #43: it is the issue this session is on.')
  expect(writes(gh.calls)).toEqual([])
})

test('many moves at once read as one line', () => {
  expect(movedText('Done', [41, 42, 43], 'it closed as completed', 'they closed as completed')).toBe('Moved 3 issues to Done (#41, #42, #43): they closed as completed.')
  expect(unmovedText('Verification', [{ number: 7, message: 'nope' }])).toBe("Couldn't move #7 to Verification: nope. /issues check may say why.")
})

test("only an issue that had an item and wasn't at Done yet is looked at, and nothing without a Done", () => {
  const issue = (number: number, status: string | null, item: string | null): Issue => ({ number, title: '', url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '', item, status })
  const field = (names: string[]) => ({ id: 'F', options: names.map(name => ({ id: name, name })) })
  const board = (issues: Issue[], statuses: string[]): Board => ({
    repo: 'o/r',
    issues,
    prs: [],
    velocity: { closed: [], merged: [] },
    fetchedAt: 0,
    project: { id: 'P', number: 1, title: 'P', url: '', status: field(statuses), priority: null },
  })
  const before = board([issue(1, 'Ready', 'I1'), issue(2, 'Done', 'I2'), issue(3, 'Ready', null), issue(4, 'Ready', 'I4')], ['Ready', 'Done'])
  expect(leftForDone(before, board([issue(4, 'Ready', 'I4')], ['Ready', 'Done']))).toEqual([{ number: 1, item: 'I1' }])
  expect(leftForDone(before, board([], ['Ready', 'Finished']))).toEqual([])
  // Shipped is a common name for Done, so a project that says it moves closed issues there without setup.
  expect(leftForDone(before, board([], ['Ready', 'Shipped'])).map(one => one.number)).toEqual([1, 2, 4])
  expect(leftForDone(null, board([], ['Ready', 'Done']))).toEqual([])

  // A pull request that left: the open issues it refers to, unless at Verification or Done, or without Verification.
  const pr = { number: 9, title: '', url: '', author: '', branch: '', ci: 'none' as const, review: null, isDraft: false, additions: 0, deletions: 0, updatedAt: '', sha: '', failing: [], issues: [1, 2, 4, 7] }
  const open = [issue(1, 'In progress', 'I1'), issue(2, 'Verification', 'I2'), issue(4, 'Done', 'I4')]
  const had = { ...board(open, ['In progress', 'Verification', 'Done']), prs: [pr] as unknown as Board['prs'] }
  expect(leftForVerification(had, board(open, ['In progress', 'Verification', 'Done']))).toEqual([{ pr: 9, number: 1, item: 'I1' }])
  expect(leftForVerification(had, board(open, ['In progress', 'Done']))).toEqual([])
})

test('an issue a merged pull request refers to with Refs moves to Verification, and the next prompt says so', { options: { autoMove: true } }, async ($, on) => {
  adoptedStore(on)
  const pr = (number: number, body: string) => ({
    number,
    title: `Part of the work, ${number}`,
    url: `https://github.com/astrosteveo/claude-plugins/pull/${number}`,
    headRefName: `feat/${number}`,
    isDraft: false,
    body,
    statusCheckRollup: [],
    reviewDecision: null,
    additions: 1,
    deletions: 1,
    author: { login: 'astrosteveo' },
    updatedAt: '2026-10-05T00:00:00Z',
  })
  const prs = [pr(50, 'Refs #43'), pr(51, 'Refs #35')]
  const gh = github(on, prs)
  const prompts: (readonly string[])[] = []
  on('prompt.submit', async (_$, e) => {
    prompts.push(e.context ?? [])
    return { text: e.text }
  })
  await $.command.run(REFRESH)
  const before = writes(gh.calls).length

  // #50 merges; #51 is closed without merging. Both leave the board.
  gh.merged = { 50: true }
  prs.length = 0
  await $.command.run(REFRESH)
  await $.command.run(REFRESH)
  const moved = writes(gh.calls).slice(before)
  expect(moved.map(call => [graphArg(call, 'item'), graphArg(call, 'option')])).toEqual([[expect.stringMatching(/43/), `option=${optionId('Verification')}`]])

  await $.prompt.submit({ text: 'What next?', wait: false, origin: { kind: 'composer' } })
  expect(prompts.at(-1)).toContain('#43 moved to Verification: pull request #50, which refers to it without closing it, merged.')
  await $.prompt.submit({ text: 'And then?', wait: false, origin: { kind: 'composer' } })
  expect(prompts.at(-1)?.join('\n') ?? '').not.toMatch(/Verification/)
})

// Epic #319 went to Verification while two of its sub-issues were open, because pull requests that each said
// `Refs #319` merged. An epic's Status belongs to its sub-issues.
test('a merged pull request that refers to an epic with open sub-issues leaves the epic alone, and moves the plain issue beside it', { options: { autoMove: true } }, async ($, on) => {
  adoptedStore(on)
  const prs = [
    {
      number: 52,
      title: 'Part of the epic',
      url: 'https://github.com/astrosteveo/claude-plugins/pull/52',
      headRefName: 'feat/52',
      isDraft: false,
      body: 'Refs #35\nRefs #43',
      statusCheckRollup: [],
      reviewDecision: null,
      additions: 1,
      deletions: 1,
      author: { login: 'astrosteveo' },
      updatedAt: '2026-10-05T00:00:00Z',
    },
  ]
  const gh = github(on, prs)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const before = writes(gh.calls).length

  // #52 merges and leaves the board. #35 is an epic with open sub-issues; #43 is one of them.
  gh.merged = { 52: true }
  prs.length = 0
  await $.command.run(REFRESH)
  await $.command.run(REFRESH)
  const moved = writes(gh.calls).slice(before)
  expect(moved.map(call => [graphArg(call, 'item'), graphArg(call, 'option')])).toEqual([[expect.stringMatching(/43/), `option=${optionId('Verification')}`]])
})

test("an epic's sub-issues follow GitHub's order where the board has no reason to change it, and move before or after a sibling", async ($, on) => {
  adoptedStore(on)
  const sub = (number: number) => ({ number, title: `Part ${number}`, labels: [], body: '', updatedAt: '2026-10-05T00:00:00Z', parent: EPIC, status: 'Ready', priority: 'P1' })
  const gh = github(on, [], [sub(44), sub(45)])
  gh.order = [45, 43, 44]
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'group-epic' })
  const rows = async () => (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => /^issue-4[345]$/.test(key))
  expect(await rows()).toEqual(['issue-45', 'issue-43', 'issue-44'])

  const moved = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 44, moveBefore: 45 })
  expect(String(moved.result)).toBe('#44 moved before #45.')
  expect(gh.moves).toEqual(['9044 before_id=9045'])
  expect(await rows()).toEqual(['issue-44', 'issue-45', 'issue-43'])
  await ui.unmount()

  // A sibling outside the epic can't be the place.
  expect((await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, moveAfter: 35 })).deny).toBe("Couldn't change #43: #35 isn't a sub-issue of #35, as #43 is")

  // A sibling the board still holds but GitHub has deleted is named, not left to gh's own words.
  gh.gone = [45]
  expect((await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 44, moveAfter: 45 })).deny).toBe("Couldn't change #44: #45 doesn't exist in astrosteveo/claude-plugins")
  expect(gh.moves).toEqual(['9044 before_id=9045'])
})
