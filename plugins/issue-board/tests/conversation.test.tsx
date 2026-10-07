import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { absorbed, issueOfBranch, knownOf, mentionsOf, newsOf, nextStepOf, parseIssues, parsePrs, writesGitHub } from '../hooks/parse'
import { graphPage, isIssuesQuery } from './graph'
import { letThrough } from './engine'

const BODY = '## Acceptance\n\n- [x] Layout in place\n- [ ] Old saves load\n- [ ] Goldens regenerated\n'

const issue = (body: string, comments = 0) => ({
  number: 315,
  title: 'Lay Kessik out for play',
  url: 'https://github.com/astrosteveo/void-sector/issues/315',
  labels: [{ name: 'area:simulation', color: '0e8a16' }],
  assignees: [{ login: 'astrosteveo' }],
  body: `Kessik needs a layout.\n\n${body}`,
  updatedAt: '2026-10-03T20:00:00Z',
  comments,
})

const other = {
  number: 289,
  title: "Asteroids didn't draw",
  url: 'https://github.com/astrosteveo/void-sector/issues/289',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: [],
  body: '- [ ] Asteroids draw',
  updatedAt: '2026-10-02T20:00:00Z',
}

const pr = (ci: 'pass' | 'pending' | 'fail', sha = 'abc123') => ({
  number: 335,
  title: 'Glide in to a planet',
  url: 'https://github.com/astrosteveo/void-sector/pull/335',
  headRefName: 'fix/315-glide',
  headRefOid: sha,
  isDraft: false,
  statusCheckRollup:
    ci === 'pass' ? [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }] : ci === 'pending' ? [{ name: 'build', status: 'IN_PROGRESS' }] : [{ name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' }],
  reviewDecision: null,
  additions: 1,
  deletions: 1,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-03T20:00:00Z',
  body: 'Refs #315.',
  closingIssuesReferences: [],
})

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const
const TURN = { answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

// GitHub, git and the session as the board and Claude see them: what the tests change, and what was asked of each.
const world = (on: On) => {
  const state = {
    body: BODY,
    comments: [] as { author: { login: string }; body: string; createdAt: string }[],
    prs: [] as unknown[],
    branch: 'main',
    edits: [] as string[],
    issueReads: 0,
    tasks: [] as { subject: string; description: string }[],
    prompts: [] as { text: string; context: readonly string[] }[],
    suggested: [] as string[],
    commands: [] as string[],
  }
  on('process.run', async (_$, e) => {
    const argv = e.argv
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer(`${state.branch}\n`)
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (isIssuesQuery(argv)) {
      state.issueReads += 1
      return answer(graphPage([issue(state.body, state.comments.length), other]))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql') return answer(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }))
    if (argv[1] === 'api') return answer('astrosteveo\n')
    if (argv[1] === 'issue' && argv[2] === 'edit' && argv.includes('--body-file')) {
      state.body = (e.init?.stdin ?? '').replace(/^Kessik needs a layout\.\n\n/, '')
      state.edits.push(state.body)
      return answer('')
    }
    if (argv[1] === 'issue' && argv[2] === 'edit') return answer('')
    if (argv[1] === 'issue' && argv[2] === 'view') {
      const fields = argv[argv.indexOf('--json') + 1]
      if (fields === 'comments') return answer(JSON.stringify({ comments: state.comments }))
      return answer(JSON.stringify(fields === 'body' ? { body: issue(state.body).body } : issue(state.body)))
    }
    if (argv.includes('closed') || argv.includes('merged')) return answer('[]')
    return answer(JSON.stringify(state.prs))
  })
  on('session.id', async () => ({ value: 'session-1' }))
  letThrough(on)
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  on('prompt.submit', async (_$, e) => {
    state.prompts.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, ...(e.context ? { context: e.context } : {}) }
  })
  on('prompt.suggest', async (_$, e) => {
    state.suggested.push(e.text)
    return { isShown: true }
  })
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('tool.call', { tool: 'TaskCreate' }, async (_$, e) => {
    state.tasks.push({ subject: e.subject, description: e.description })
    return { result: { task: { id: String(state.tasks.length), subject: e.subject } } }
  })
  on('tool.call', { tool: 'TaskUpdate' }, async (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  // Claude's shell: a checkout moves the branch the folder has.
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    state.commands.push(e.command)
    const moved = /git checkout -b (\S+)/.exec(e.command)
    if (moved?.[1]) state.branch = moved[1]
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return state
}

// What the last prompt carried for Claude beside its text.
const lastContext = (state: ReturnType<typeof world>): string => state.prompts.at(-1)?.context.join('\n---\n') ?? ''

test('a prompt names issues and pull requests by #number; a branch names its issue; some commands write to GitHub', () => {
  expect(mentionsOf('Look at #315 and #335, then #315 again')).toEqual([315, 335])
  expect(mentionsOf('Not &#123; or https://x.dev/#12 or a#7 or ##8')).toEqual([])
  expect(mentionsOf('#1 #2 #3 #4')).toEqual([1, 2, 3])

  expect(issueOfBranch('fix/315-glide')).toBe(315)
  expect(issueOfBranch('315-glide')).toBe(315)
  expect(issueOfBranch('feat/issue-315')).toBe(315)
  expect(issueOfBranch('worktree-fix+315-glide')).toBe(315)
  expect(issueOfBranch('feat/issue-board-conversation')).toBeNull()
  expect(issueOfBranch('release/2.1')).toBeNull()
  expect(issueOfBranch('dependabot/npm_and_yarn/lodash-4.17.21')).toBeNull()
  expect(issueOfBranch(null)).toBeNull()

  expect(writesGitHub('git push -u origin fix/315-glide')).toBe(true)
  expect(writesGitHub('gh project item-edit --id PVTI_1 --field-id F --single-select-option-id S')).toBe(true)
  expect(writesGitHub('gh api -X PATCH repos/o/r/issues/1 -f title=x')).toBe(true)
  expect(writesGitHub('gh api --method=DELETE repos/o/r/labels/x')).toBe(true)
  expect(writesGitHub('gh api repos/o/r/issues/1/comments -f body=hi')).toBe(true)
  expect(writesGitHub("gh api graphql -f query='mutation { addStar(input: {}) { clientMutationId } }'")).toBe(true)
  expect(writesGitHub("gh api graphql -f query='query { viewer { login } }'")).toBe(false)
  expect(writesGitHub('gh api repos/o/r/pulls --jq ".[] | .number"')).toBe(false)
  expect(writesGitHub('gh api -X GET search/issues -f q=bug')).toBe(false)
  expect(writesGitHub('git status && gh pr list')).toBe(false)
  expect(writesGitHub('gh issue comment 315 --body done')).toBe(true)
})

test('the note says what changed on the issue, and the next step follows its boxes and pull request', () => {
  const [before] = parseIssues(JSON.stringify([issue(BODY, 1)]))
  const [after] = parseIssues(JSON.stringify([issue('- [x] Layout in place\n- [x] Old saves load\n- [ ] Goldens look right\n', 3)]))
  const was = { ...knownOf(before, parsePrs(JSON.stringify([pr('pending')]))), comments: 1 }
  const now = { ...knownOf(after, parsePrs(JSON.stringify([pr('fail', 'def456')]))), comments: 3 }
  expect(newsOf(315, was, now, [{ author: 'alice', body: 'Looks\ngood', at: '' }, { author: 'bob', body: 'One more thing', at: '' }])).toBe(
    [
      "#315, the issue you're working on, changed on GitHub since the last prompt:",
      '- Box 2 was ticked: Old saves load',
      '- Box 3 is new: Goldens look right',
      '- A box was taken out: Goldens regenerated',
      '- 2 new comments:',
      '  @alice: Looks good',
      '  @bob: One more thing',
      '- CI fails on PR #335. `gh pr checks 335` says where.',
    ].join('\n'),
  )
  expect(newsOf(315, now, now)).toBeNull()
  expect(newsOf(315, now, knownOf(undefined, []))).toBe("#315, the issue you're working on, changed on GitHub since the last prompt:\n- #315 is closed.")
  expect(newsOf(315, now, { ...now, prs: [] })).toBe("#315, the issue you're working on, changed on GitHub since the last prompt:\n- PR #335 isn't open any more: it merged or closed.")

  // Claude's own action: what changed while it ran is known, what changed before it is still news.
  const all = knownOf(parseIssues(JSON.stringify([issue('- [x] Layout in place\n- [x] Old saves load\n- [x] Goldens regenerated\n', 1)]))[0], [])
  const fresh = knownOf(parseIssues(JSON.stringify([issue('- [x] Layout in place\n- [x] Old saves load\n- [ ] Goldens regenerated\n', 1)]))[0], [])
  const known = absorbed(was, fresh, all)
  expect(known.checks.map(check => check.done)).toEqual([true, false, true])
  expect(newsOf(315, known, all)).toBe("#315, the issue you're working on, changed on GitHub since the last prompt:\n- Box 2 was ticked: Old saves load\n- PR #335 isn't open any more: it merged or closed.")

  const board = (body: string, prs: unknown[]) => ({ repo: 'r', issues: parseIssues(JSON.stringify([issue(body)])), prs: parsePrs(JSON.stringify(prs)), velocity: { closed: [], merged: [] }, fetchedAt: 0 })
  const working = { number: 315, title: '', updatedAt: '' }
  const ticked = '- [x] One\n- [x] Two\n'
  expect(nextStepOf(board(BODY, []), working)).toBeNull()
  expect(nextStepOf(board(ticked, []), working)).toBe('Open a PR for #315')
  expect(nextStepOf(board(ticked, [pr('pending')]), working)).toBeNull()
  expect(nextStepOf(board(ticked, [pr('pass')]), working)).toBe('Finish and merge PR #335')
  expect(nextStepOf(board(BODY, [pr('fail')]), working)).toBe('Fix the failing CI on PR #335')
  expect(nextStepOf(board(ticked, []), null)).toBeNull()
})

test("a prompt that names #315 carries the board's copy of it, unseen; one the board doesn't have carries nothing", async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.prs = [pr('pass')]
  await $.command.run(REFRESH)

  await $.prompt.submit({ text: "What's left on #315? See also #335 and #999.", wait: false, origin: { kind: 'composer' } })
  const [copy, prCopy, ...rest] = gh.prompts.at(-1)?.context ?? []
  expect(copy).toMatch(/^The prompt names #315\. This is the issue board's copy, synced .*:\n#315 Lay Kessik out for play\n/)
  expect(copy).toMatch(/Boxes \(1\/3 ticked\):\n1\. \[x\] Layout in place\n2\. \[ \] Old saves load\n3\. \[ \] Goldens regenerated\n/)
  expect(copy).toMatch(/Pull requests for it:\n#335 Glide in to a planet \[branch fix\/315-glide, CI pass/)
  expect(copy).toMatch(/Text, without the boxes:\nKessik needs a layout\./)
  expect(prCopy).toMatch(/^The prompt names pull request #335\. .*\n#335 Glide in to a planet \[branch fix\/315-glide, CI pass/)
  expect(rest).toEqual([])

  await $.prompt.submit({ text: 'Nothing named here.', wait: false, origin: { kind: 'composer' } })
  expect(gh.prompts.at(-1)?.context).toEqual([])
})

test('Start makes a task per open box; a task Claude completes has the band ask to tick its box', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  await $.command.run(REFRESH)
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  expect(gh.tasks).toEqual([
    { subject: 'Old saves load', description: 'Box 2 of #315, Lay Kessik out for play: Old saves load' },
    { subject: 'Goldens regenerated', description: 'Box 3 of #315, Lay Kessik out for play: Goldens regenerated' },
  ])
  expect(gh.prompts.find(prompt => prompt.text.startsWith("Let's start on #315"))?.text).toMatch(/Each is a task in your task list too/)

  // Start isn't offered again: its button says it started, and there's no second set.
  expect(await pane.find({ key: 'start-315' })).toBeUndefined()
  expect(await pane.find({ text: /^▶ Started$/ })).toBeDefined()
  expect(gh.tasks.length).toBe(2)

  // Claude completes the task for box 3: the band asks, and Tick ticks it on GitHub.
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
  expect(await band.find({ key: 'tick-task-2' })).toBeUndefined()
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' })
  expect(await band.find({ text: / ☑ TICK\? / })).toBeDefined()
  expect(await band.find({ key: 'tick-task-2' })).toMatchObject({ text: 'Tick box 3' })
  await band.press({ key: 'tick-task-2' })
  expect(gh.edits.at(-1)).toMatch(/- \[x\] Goldens regenerated/)
  expect(await band.find({ key: 'tick-task-2' })).toBeUndefined()

  // Claude ticks box 2 itself before completing its task: nothing to ask.
  await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [2] })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  expect(await band.find({ key: 'tick-task-1' })).toBeUndefined()

  // A task waved off goes.
  await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [2], done: false })
  expect(await band.find({ key: 'tick-task-1' })).toBeDefined()
  await band.press({ key: 'skip-task-1' })
  expect(await band.find({ key: 'tick-task-1' })).toBeUndefined()
  await pane.unmount()
  await band.unmount()
})

test("the next prompt notes what changed on the issue Claude is on, but not Claude's own changes; the system prompt stays", async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.prs = [pr('pending')]
  await $.command.run(REFRESH)
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  await pane.unmount()
  const system = (await $.prompt.compose(COMPOSE)).sections.map(section => section.text).join('\n')

  await $.prompt.submit({ text: 'Go on.', wait: false, origin: { kind: 'composer' } })
  expect(lastContext(gh)).toBe('')

  // Someone else ticks box 2 and comments, and CI fails.
  gh.body = BODY.replace('- [ ] Old saves load', '- [x] Old saves load')
  gh.comments = [{ author: { login: 'alice' }, body: 'Saves from 0.3 still fail for me.', createdAt: '2026-10-04T09:00:00Z' }]
  gh.prs = [pr('fail')]
  await $.command.run(REFRESH)
  await $.prompt.submit({ text: 'Go on.', wait: false, origin: { kind: 'composer' } })
  expect(lastContext(gh)).toBe(
    [
      "#315, the issue you're working on, changed on GitHub since the last prompt:",
      '- Box 2 was ticked: Old saves load',
      '- A new comment:',
      '  @alice: Saves from 0.3 still fail for me.',
      '- CI fails on PR #335. `gh pr checks 335` says where.',
    ].join('\n'),
  )
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.text).join('\n')).toBe(system)

  // Said once.
  await $.prompt.submit({ text: 'Go on.', wait: false, origin: { kind: 'composer' } })
  expect(lastContext(gh)).toBe('')

  // Claude's own tick isn't news to it, but box 2 unticked on GitHub just before is; so is a push that brings CI back.
  gh.body = BODY
  await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [3] })
  gh.prs = [pr('pass', 'def456')]
  await $.command.run(REFRESH)
  await $.prompt.submit({ text: 'Go on.', wait: false, origin: { kind: 'composer' } })
  expect(lastContext(gh)).toBe("#315, the issue you're working on, changed on GitHub since the last prompt:\n- Box 2 was unticked: Old saves load\n- CI passes on PR #335.")

  // A comment Claude posts with issue_update isn't news either.
  gh.comments = [...gh.comments, { author: { login: 'astrosteveo' }, body: 'Box 3 is done.', createdAt: '2026-10-04T10:00:00Z' }]
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, comment: 'Box 3 is done.' })
  await $.prompt.submit({ text: 'Go on.', wait: false, origin: { kind: 'composer' } })
  expect(lastContext(gh)).toBe('')
})

test('a turn that ran git reads GitHub again and suggests the next step; a checkout of fix/289-… makes #289 the issue', { options: { suggestNextStep: true, followBranch: true } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.body = '- [x] Layout in place\n- [x] Old saves load\n'
  await $.command.run(REFRESH)
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  await pane.unmount()
  const reads = gh.issueReads

  // A turn without git or gh reads nothing, but still suggests the step due.
  await $.turn.complete(TURN)
  await clock.settle()
  expect(gh.issueReads).toBe(reads)
  expect(gh.suggested.at(-1)).toBe('Open a PR for #315')

  // The engine's own guess gives way to it.
  const guessed = await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  expect(guessed.isShown).toBe(true)
  expect(gh.suggested.at(-1)).toBe('Open a PR for #315')

  await $.tool.call({ tool: 'Bash', command: 'git commit -am "Lay Kessik out"' })
  await clock.settle()
  expect(gh.issueReads).toBe(reads)
  await $.turn.complete(TURN)
  await clock.settle()
  expect(gh.issueReads).toBe(reads + 1)

  // A push reads GitHub straight away, so the turn's end needn't.
  gh.prs = [pr('pending')]
  await $.tool.call({ tool: 'Bash', command: 'git push -u origin fix/315-glide' })
  await clock.settle()
  expect(gh.issueReads).toBe(reads + 2)
  await $.turn.complete(TURN)
  await clock.settle()
  expect(gh.issueReads).toBe(reads + 2)
  await $.tool.call({ tool: 'Bash', command: 'gh project item-edit --id PVTI_315 --field-id F --single-select-option-id S' })
  await clock.settle()
  expect(gh.issueReads).toBe(reads + 3)
  await $.tool.call({ tool: 'Bash', command: 'gh api repos/astrosteveo/void-sector/pulls' })
  await clock.settle()
  expect(gh.issueReads).toBe(reads + 3)

  // A branch named for #289 makes it the issue Claude is on, in the system prompt too.
  await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/289-asteroids' })
  await clock.settle()
  const sections = (await $.prompt.compose(COMPOSE)).sections
  expect(sections.at(-1)?.text).toMatch(/^The person is working on GitHub issue #289: Asteroids didn't draw\./)
  const working = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await working.find({ key: 'stop-289' })).toBeDefined()
  await working.unmount()
})

test("by default the note names the issue with no PR rule, the prompt box keeps Claude Code's suggestion, and a branch names no issue", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.body = '- [x] Layout in place\n- [x] Old saves load\n'
  await $.command.run(REFRESH)
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  await pane.unmount()
  const note = (await $.prompt.compose(COMPOSE)).sections.at(-1)?.text
  expect(note).toMatch(/^The person is working on GitHub issue #315: Lay Kessik out for play\./)
  expect(note).not.toMatch(/Closes|Refs/)

  // Every box is ticked, but the box gets no step of the board's, and the engine's own guess stands.
  await $.turn.complete(TURN)
  await clock.settle()
  expect(gh.suggested).toEqual([])
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  expect(gh.suggested).toEqual(['run the tests'])

  // A branch named for #289 leaves #315 the issue Claude is on.
  await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/289-asteroids' })
  await clock.settle()
  expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toBe(note)
})

test('with its PR rule set, the note says Closes only when every box is ticked', { options: { prRule: 'closes-when-ticked' } }, async ($, on) => {
  mock.store(on)
  world(on)
  await $.command.run(REFRESH)
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  await pane.unmount()
  expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toMatch(/write `Closes #315` in its body only if every acceptance box of #315 is ticked by then\. Otherwise write `Refs #315`/)
})

test('with the working note and issue copies turned off, the system prompt and a prompt naming #315 carry nothing of the board', { options: { workingNote: false, issueCopies: false } }, async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.prs = [pr('pass')]
  await $.command.run(REFRESH)
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  await pane.unmount()
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])

  await $.prompt.submit({ text: "What's left on #315? See also #335.", wait: false, origin: { kind: 'composer' } })
  expect(gh.prompts.at(-1)?.context).toEqual([])
})
