import type { AgentSpawnInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { eventRepoOf, liveRunsOf, runProgressOf, startedByClaude, workerBadge } from '../hooks/parse'
import { graphPage, isIssuesQuery } from './graph'

const issue = {
  number: 315,
  title: 'Lay Kessik out for play',
  url: 'https://github.com/astrosteveo/void-sector/issues/315',
  labels: [],
  assignees: [{ login: 'astrosteveo' }],
  body: '- [ ] Layout in place',
  updatedAt: '2026-10-03T20:00:00Z',
}

const pr = (ci: 'pending' | 'pass') => ({
  number: 335,
  title: 'Glide in to a planet',
  url: 'https://github.com/astrosteveo/void-sector/pull/335',
  headRefName: 'fix/315-glide',
  headRefOid: 'abc123',
  isDraft: false,
  statusCheckRollup: ci === 'pass' ? [{ name: 'validate', status: 'COMPLETED', conclusion: 'SUCCESS' }] : [{ name: 'validate', status: 'IN_PROGRESS' }],
  reviewDecision: null,
  additions: 1,
  deletions: 1,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-03T20:00:00Z',
  body: 'Refs #315.',
  closingIssuesReferences: [],
})

// Two drawings `gh run watch` makes, a few seconds apart: one job done and one running, then both ended.
const RUNNING = [
  'Refreshing run status every 15 seconds. Press Ctrl+C to quit.',
  '',
  '* fix/315-glide Validate plugins · 987',
  'Triggered via pull_request less than a minute ago',
  '',
  'JOBS',
  '✓ lint in 12s (ID 1001)',
  '* validate (ID 1002)',
  '  ✓ Set up job',
  '  ✓ Run actions/checkout@v4',
  '  * Install Claude Code',
  '  * Validate marketplace and plugins',
  '',
].join('\n')
const ENDED = [
  'Refreshing run status every 15 seconds. Press Ctrl+C to quit.',
  '',
  'X fix/315-glide Validate plugins · 987',
  '',
  'JOBS',
  '✓ lint in 12s (ID 1001)',
  'X validate in 1m3s (ID 1002)',
  '  ✓ Set up job',
  '  X Validate marketplace and plugins',
  '',
  'ANNOTATIONS',
  'X Process completed with exit code 1.',
  '',
].join('\n')

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }

// GitHub and git as the board reads them; how often it read the issues, and what it ran.
const world = (on: On, shown: typeof issue = issue) => {
  const state = { prs: [pr('pending')] as unknown[], runs: [] as unknown[], reads: 0, watched: [] as string[][], ran: [] as string[] }
  on('process.run', async (_$, e) => {
    const argv = e.argv
    state.ran.push(argv.join(' '))
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer('fix/315-glide\n')
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (isIssuesQuery(argv)) {
      state.reads += 1
      return answer(graphPage([shown]))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql') return answer(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }))
    if (argv[1] === 'api') return answer('astrosteveo\n')
    if (argv[1] === 'run' && argv[2] === 'list') return answer(JSON.stringify(state.runs))
    if (argv[1] === 'pr' && argv[2] === 'list' && !argv.includes('merged')) return answer(JSON.stringify(state.prs))
    return answer('[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.receive', async (_$, e) => ({ text: e.text }))
  return state
}

test('what an event, a run list and a watch drawing say', () => {
  expect(eventRepoOf({ pr: 'astrosteveo/void-sector#335', outcome: 'merged' })).toBe('astrosteveo/void-sector')
  expect(eventRepoOf({ repository: 'acme/app' })).toBe('acme/app')
  expect(eventRepoOf({ outcome: 'merged' })).toBeNull()

  expect(liveRunsOf(JSON.stringify([{ databaseId: 987, status: 'in_progress', workflowName: 'Validate plugins' }, { databaseId: 986, status: 'completed' }, { number: 5 }]))).toEqual([
    { id: 987, workflow: 'Validate plugins' },
  ])

  expect(runProgressOf('Refreshing run status every 15 seconds.\n')).toBeNull()
  expect(runProgressOf(RUNNING)).toEqual({ done: 1, total: 2, failed: 0, running: 'validate', step: 'Install Claude Code' })
  // The last drawing counts.
  expect(runProgressOf(`${RUNNING}${ENDED}`)).toEqual({ done: 2, total: 2, failed: 1, running: null, step: null })
  expect(runProgressOf(`\x1b[1mJOBS\x1b[0m\n\x1b[32m✓\x1b[0m build (ID 1)\n`)).toEqual({ done: 1, total: 1, failed: 0, running: null, step: null })

  // What gh 2.102 wrote watching this repo's own CI: no line between one drawing and the next.
  const real = [
    'Refreshing run status every 15 seconds. Press Ctrl+C to quit.',
    '',
    '* feat/47-live-board Validate plugins astrosteveo/claude-plugins#75 · 37261969398',
    'Triggered via pull_request less than a minute ago',
    '',
    'JOBS',
    '* validate (ID 111610885572)',
    '  ✓ Set up job',
    '  ✓ Install Claude Code',
    '  * Validate marketplace and plugins',
    '  * Post Run actions/checkout@v4',
  ]
  const after = [
    '✓ feat/47-live-board Validate plugins astrosteveo/claude-plugins#75 · 37261969398',
    'Triggered via pull_request less than a minute ago',
    '',
    'JOBS',
    '✓ validate in 11s (ID 111610885572)',
    '  ✓ Set up job',
    '  ✓ Complete job',
    '',
    'ANNOTATIONS',
    '! Node.js 20 is deprecated.',
    'validate: .github#2',
    '',
  ]
  expect(runProgressOf(real.join('\n'))).toEqual({ done: 0, total: 1, failed: 0, running: 'validate', step: 'Validate marketplace and plugins' })
  expect(runProgressOf([...real, ...after].join('\n'))).toEqual({ done: 1, total: 1, failed: 0, running: null, step: null })

  expect(workerBadge('running')).toEqual({ text: '⚙ working', color: 'claude' })
  expect(workerBadge('completed')).toEqual({ text: '⚙ done', color: 'success' })
})

test("a GitHub event for this repo's pull request reads GitHub at once; another repo's doesn't", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.prs = [pr('pass')]
  await $.command.run(REFRESH)
  const reads = gh.reads

  const event = (repo: string) => ({
    origin: { kind: 'task-notification' as const },
    text: `${repo}#335 merged`,
    event: { source: 'github', kind: 'pull_request.closed', data: { pr: `${repo}#335`, outcome: 'merged' }, untrustedKeys: [] },
  })
  const received = await $.session.receive(event('astrosteveo/void-sector'))
  // The event still goes on to Claude.
  expect(received.text).toBe('astrosteveo/void-sector#335 merged')
  await clock.settle()
  expect(gh.reads).toBe(reads + 1)

  await $.session.receive(event('acme/app'))
  await clock.settle()
  expect(gh.reads).toBe(reads + 1)
})

test("while the branch's CI runs, the pane shows its progress from gh run watch, the band stays quiet, and its end reads GitHub", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.runs = [{ databaseId: 987, status: 'in_progress', workflowName: 'Validate plugins' }]
  let finish = () => undefined as void
  const finished = new Promise<void>(resolve => {
    finish = resolve
  })
  on('process.spawn', async function* (_$, e) {
    gh.watched.push([...e.argv])
    yield { stream: 'stdout' as const, text: RUNNING }
    await finished
    yield { stream: 'stdout' as const, text: ENDED }
    return { value: { code: 1, signal: null } }
  })

  await $.command.run(REFRESH)
  await clock.settle()
  expect(gh.watched).toEqual([['gh', 'run', 'watch', '987', '--interval', '15']])
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: / ◷ CI / })).toBeUndefined()
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'run-987' })).toBeDefined()
  expect(await pane.find({ text: / 1\/2 jobs/ })).toBeDefined()
  expect(await pane.find({ text: /^validate › Install Claude Code$/ })).toBeDefined()

  // A refresh while it runs doesn't watch it twice.
  await $.command.run(REFRESH)
  await clock.settle()
  expect(gh.watched.length).toBe(1)

  const reads = gh.reads
  gh.prs = [pr('pass')]
  finish()
  await clock.settle()
  expect(await band.find({ text: / ◷ CI / })).toBeUndefined()
  expect(await pane.find({ key: 'run-987' })).toBeUndefined()
  expect(gh.reads).toBe(reads + 1)
  await band.unmount()
  await pane.unmount()
})

// The Agent tool's spawn of an agent, as Claude's call makes it.
const agentCall = (args: { subagentType: string; name?: string; description: string; prompt: string }): AgentSpawnInput => ({
  tool_use_id: 'toolu_1',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  ...args,
})

test("only Claude's own Agent tool call in the main session counts as Claude starting an agent", () => {
  // The model's call: Claude Code gives Claude the agent's result.
  expect(startedByClaude({ plugin: 'engine' }, {})).toBe(true)
  // A plugin's `$.agent.spawn`, or another agent's Agent tool call: Claude gets no result of its own.
  expect(startedByClaude({ plugin: 'dispatcher' }, {})).toBe(false)
  expect(startedByClaude({ plugin: 'engine' }, { parentAgentId: 'agent-0' })).toBe(false)
})

test('Start in background starts the board\'s agent itself and sends Claude nothing; the row follows it, and its end comes back to the conversation and to Claude', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  world(on)
  const registered: { name: string; isolation?: string; background?: boolean }[] = []
  const spawned: { type?: unknown; description?: string; prompt: string; name?: string }[] = []
  let status = 'running'
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => {
    registered.push({ name: e.name, ...(e.isolation ? { isolation: e.isolation } : {}), ...(e.background ? { background: e.background } : {}) })
    return { value: { agent: `issue-board:${e.name}` } }
  })
  // Beneath the plugins: the spawns that reach core. A plugin's own spawn reaches the test as the Agent tool's input,
  // which spells the type `subagent_type`.
  on('agent.spawn', async (_$, e) => {
    spawned.push({ type: e.subagentType ?? (e as unknown as { subagent_type?: string }).subagent_type, description: e.description, prompt: e.prompt, ...(e.name ? { name: e.name } : {}) })
    return { model: 'claude-sonnet-5-5', agentId: 'agent-1' }
  })
  on('agent.list', async () => ({ value: [{ id: 'agent-1', description: '#315 Lay Kessik out for play', type: 'issue-board:worker', status: status as 'running' }] }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  // What the board hands Claude, and as whose words.
  const sent: string[] = []
  const handed: { text: string; origin: unknown }[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    handed.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text))
    return { value: undefined }
  })
  const lines: string[] = []
  on('ui.log', async (_$, e) => {
    if (e.to !== 'debug') lines.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  expect(registered).toEqual([{ name: 'worker', isolation: 'worktree', background: true }])
  await $.command.run(REFRESH)
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  await ui.press({ key: 'background-315' })
  await clock.settle()
  // The board starts the agent itself, with its type, a description that names the issue, and Start's message as its
  // prompt. It gives no name. Claude is sent nothing.
  expect(spawned).toEqual([{ type: 'issue-board:worker', description: '#315 Lay Kessik out for play', prompt: expect.stringMatching(/^Let's start on #315: Lay Kessik out for play\./) }])
  expect(sent).toEqual([])
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  // The board follows it once, from the spawn's result, not again from its own agent.spawn hook.
  expect(toasts.filter(text => text === 'Started a background agent on #315')).toHaveLength(1)
  expect(toasts.some(text => /Asked Claude/.test(text))).toBe(false)
  // One agent an issue at a time.
  expect(await ui.find({ key: 'background-315' })).toBeUndefined()

  // It waits on something: the board sees it within 10 seconds.
  status = 'waiting'
  await clock.advance(10_000)
  expect(await ui.find({ text: /^⚙ waiting$/ })).toBeDefined()

  // Its answer ends it: done, with what it said on the card.
  await $.turn.complete({ answer: 'Opened PR #335.\n\nBox 1 is ticked.', durationMs: 1, isAborted: false, turnId: 't', agentId: 'agent-1', reason: 'answer' })
  await clock.settle()
  expect(await ui.find({ text: /^⚙ done$/ })).toBeDefined()
  expect(await ui.find({ text: /^Opened PR #335\.\n\nBox 1 is ticked\.$/ })).toBeDefined()
  expect(await ui.find({ key: 'background-315' })).toBeDefined()
  // The conversation says it is done, naming the issue, with what it said and its pull request, after the board read
  // GitHub again. Claude didn't start it, so Claude Code gives Claude no result of its own: the board hands it over, in
  // the board's name.
  expect(lines).toEqual([
    'The background agent on #315 "Lay Kessik out for play" is done. Opened PR #335. Box 1 is ticked. Pull request #335: https://github.com/astrosteveo/void-sector/pull/335',
  ])
  expect(handed.length).toBe(1)
  expect(handed[0]?.origin).toEqual({ kind: 'plugin', name: 'issue-board' })
  expect(handed[0]?.text).toMatch(/#315/)
  expect(toasts).toContain('The background agent on #315 finished')

  // The list then says it ended too: nothing is told twice.
  status = 'completed'
  await clock.advance(20_000)
  expect(lines.length).toBe(1)
  expect(handed.length).toBe(1)
  await ui.unmount()
})

test('A spawn of the board\'s agent that is refused or names no agent shows none on the row; one with no name is found by its description; other agents are left alone', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  world(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  // Core refuses the spawn, then starts none the session lists, then one it lists by the name it was given.
  // Last, one started with no name, listed by its description beside an earlier agent on the issue that has ended.
  let spawn: 'deny' | 'nameless' | 'start' | 'unnamed' = 'deny'
  on('agent.spawn', async () => (spawn === 'deny' ? { deny: 'Background tasks are turned off' } : { model: 'claude-sonnet-5-5' }))
  on('agent.list', async () => ({
    value:
      spawn === 'start'
        ? [{ id: 'agent-1', name: 'issue-315', description: '#315', type: 'issue-board:worker', status: 'running' as const }]
        : spawn === 'unnamed'
          ? [
              { id: 'agent-1', name: 'issue-315', description: '#315', type: 'issue-board:worker', status: 'running' as const },
              { id: 'agent-2', description: '#315 Lay Kessik out for play', type: 'issue-board:worker', status: 'completed' as const },
              { id: 'agent-3', description: '#315 Lay Kessik out for play', type: 'issue-board:worker', status: 'running' as const },
              { id: 'agent-4', description: '#315 Lay Kessik out for play', type: 'general-purpose', status: 'running' as const },
            ]
          : [],
  }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const lines: string[] = []
  on('ui.log', async (_$, e) => {
    if (e.to !== 'debug') lines.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  const worker = agentCall({ subagentType: 'issue-board:worker', name: 'issue-315', description: '#315 Lay Kessik out for play', prompt: "Let's start on #315." })

  // A refused spawn: Claude sees the error; the board says so in a toast and shows no agent.
  expect(await $.agent.spawn(worker)).toEqual({ deny: 'Background tasks are turned off' })
  expect(toasts).toContain("Couldn't start a background agent on #315: Background tasks are turned off")
  expect(await ui.find({ text: /^⚙ working$/ })).toBeUndefined()

  // A spawn that names no agent the session lists has nothing to follow.
  spawn = 'nameless'
  await $.agent.spawn(worker)
  expect(toasts.at(-1)).toBe("Started a background agent on #315, but the board couldn't follow it: no agent id")
  expect(await ui.find({ text: /^⚙ working$/ })).toBeUndefined()

  // Another type of agent is none of the board's.
  spawn = 'start'
  await $.agent.spawn({ ...worker, subagentType: 'general-purpose' })
  expect(await ui.find({ text: /^⚙ working$/ })).toBeUndefined()

  // Then it starts, found by its name in the session's list.
  await $.agent.spawn(worker)
  await clock.settle()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()

  // The board adds no line to the conversation: Claude's own Agent call shows there.
  expect(lines).toEqual([])

  // One started with no name, as Start in background asks, is found by its description: the one that hasn't ended.
  spawn = 'unnamed'
  const { name: _, ...unnamed } = worker
  await $.agent.spawn(unnamed)
  await clock.settle()
  await $.turn.complete({ answer: 'Opened PR #335.', durationMs: 1, isAborted: false, turnId: 't', agentId: 'agent-1', reason: 'answer' })
  await clock.settle()
  expect(await ui.find({ text: /^⚙ done$/ })).toBeUndefined()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  await $.turn.complete({ answer: 'Opened PR #336.', durationMs: 1, isAborted: false, turnId: 't', agentId: 'agent-3', reason: 'answer' })
  await clock.settle()
  expect(await ui.find({ text: /^⚙ done$/ })).toBeDefined()
  await ui.unmount()
})

test("Claude dispatching the board's agent from the conversation claims the issue as Start in background does", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  // Nobody is assigned to it yet.
  const gh = world(on, { ...issue, assignees: [] })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
  on('agent.list', async () => ({ value: [{ id: 'agent-1', description: '#315 Lay Kessik out for play', type: 'issue-board:worker', status: 'running' as const }] }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('ui.toast', async () => ({ value: undefined }))

  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  expect(await ui.find({ key: 'background-315' })).toBeDefined()

  // Nobody pressed Start in background: Claude dispatched the agent because the person asked in the conversation.
  await $.agent.spawn(agentCall({ subagentType: 'issue-board:worker', description: '#315 Lay Kessik out for play', prompt: 'Work #315.' }))
  await clock.settle()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  expect(await ui.find({ key: 'background-315' })).toBeUndefined()
  expect(gh.ran.filter(line => line.startsWith('gh issue edit 315'))).toEqual(['gh issue edit 315 --add-assignee @me'])
  await ui.unmount()
})

// The Agent tool's spawn of an agent as another agent's call makes it, in that agent's loop: that agent gets the result,
// and Claude gets none of its own.
const nestedCall = (args: { subagentType: string; name?: string; description: string; prompt: string }): AgentSpawnInput => ({ ...agentCall(args), parentAgentId: 'agent-0' })

test('an agent that something other than Claude started tells Claude it ended, in the board\'s name, with its answer and pull request', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  world(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  let spawns = 0
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: `agent-${++spawns}` }))
  on('agent.list', async () => ({ value: [] }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  const handed: { text: string; origin: unknown }[] = []
  on('prompt.submit', async (_$, e) => {
    handed.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  const lines: string[] = []
  on('ui.log', async (_$, e) => {
    if (e.to !== 'debug') lines.push(e.text)
    return { value: undefined }
  })
  const worker = { subagentType: 'issue-board:worker', description: '#315 Lay Kessik out for play', prompt: "Let's start on #315." }

  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })

  // Another agent starts it: when it ends, the line says so, and Claude gets the same in the board's name to follow up on.
  await $.agent.spawn(nestedCall(worker))
  await clock.settle()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  await $.turn.complete({ answer: 'Opened PR #335.\n\nBox 1 is ticked.', durationMs: 1, isAborted: false, turnId: 't', agentId: 'agent-1', reason: 'answer' })
  await clock.settle()
  expect(await ui.find({ text: /^⚙ done$/ })).toBeDefined()
  expect(lines).toEqual([
    'The background agent on #315 "Lay Kessik out for play" is done. Opened PR #335. Box 1 is ticked. Pull request #335: https://github.com/astrosteveo/void-sector/pull/335',
  ])
  expect(handed).toEqual([{ text: expect.stringMatching(/^The background agent that Start in background set on #315 "Lay Kessik out for play" is done\./), origin: { kind: 'plugin', name: 'issue-board' } }])
  expect(handed[0]?.text).toContain('Its pull request: #335 https://github.com/astrosteveo/void-sector/pull/335')
  expect(handed[0]?.text).toContain('Its last answer:\nOpened PR #335.\n\nBox 1 is ticked.')
  expect(handed[0]?.text).toMatch(/Tell the person in a few sentences what it did and what is left/)
  await ui.unmount()
})

test('a background agent something other than Claude started that fails or is stopped says so in the conversation and to Claude, once, with or without an answer', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.prs = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  let spawns = 0
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: `agent-${++spawns}` }))
  let status = 'running'
  on('agent.list', async () => ({ value: [{ id: `agent-${spawns}`, name: 'issue-315', description: '#315', type: 'issue-board:worker', status: status as 'running' }] }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  const handed: string[] = []
  on('prompt.submit', async (_$, e) => {
    handed.push(e.text)
    return { text: e.text }
  })
  const lines: string[] = []
  on('ui.log', async (_$, e) => {
    if (e.to !== 'debug') lines.push(e.text)
    return { value: undefined }
  })
  const worker = nestedCall({ subagentType: 'issue-board:worker', name: 'issue-315', description: '#315 Lay Kessik out for play', prompt: "Let's start on #315." })

  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })

  // An API error ends the first: the line says it failed, with its last words, and no pull request.
  await $.agent.spawn(worker)
  await $.turn.complete({ answer: 'The tests would not build.', durationMs: 1, isAborted: false, turnId: 't', agentId: 'agent-1', reason: 'error' })
  await clock.settle()
  expect(await ui.find({ text: /^⚙ failed$/ })).toBeDefined()
  expect(lines.at(-1)).toBe('The background agent on #315 "Lay Kessik out for play" failed. The tests would not build.')
  expect(lines.some(line => line.includes('is done'))).toBe(false)
  expect(handed.at(-1)).toMatch(/^The background agent that Start in background set on #315 "Lay Kessik out for play" failed\./)
  expect(handed.at(-1)).toContain('The board sees no pull request for the issue.')
  expect(handed.at(-1)).toMatch(/say what they could do next/)

  // The second is stopped and never answers: the list says so, and 10 seconds on the line does.
  await $.agent.spawn(worker)
  await clock.settle()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  const told = lines.length
  status = 'killed'
  await clock.advance(10_000)
  expect(await ui.find({ text: /^⚙ stopped$/ })).toBeDefined()
  expect(lines.length).toBe(told)
  await clock.advance(10_000)
  await clock.settle()
  expect(lines.at(-1)).toBe('The background agent on #315 "Lay Kessik out for play" was stopped.')
  expect(handed.at(-1)).toMatch(/^The background agent that Start in background set on #315 "Lay Kessik out for play" was stopped\./)
  expect(handed.at(-1)).toContain('It gave no answer.')

  // An answer that comes after that tells nothing again.
  const count = handed.length
  await $.turn.complete({ answer: 'Stopped.', durationMs: 1, isAborted: true, turnId: 't', agentId: 'agent-2', reason: 'aborted' })
  await clock.settle()
  expect(lines.length).toBe(told + 1)
  expect(handed.length).toBe(count)
  await ui.unmount()
})

test('Start and Start in background change once pressed, and a second press starts nothing', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  world(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  on('tool.call', { tool: 'TaskCreate' }, async (_$, e) => ({ result: { task: { id: '1', subject: e.subject } } }))
  on('ui.log', async () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text))
    return { value: undefined }
  })
  // Core refuses the spawn, fails it, or starts the agent once the test lets it go.
  let answer: 'refuse' | 'fail' | 'start' = 'refuse'
  let spawns = 0
  let started = (): void => {}
  on('agent.spawn', async () => {
    spawns += 1
    if (answer === 'refuse') return { deny: 'Background tasks are turned off' }
    if (answer === 'fail') throw new Error('The agent could not start')
    await new Promise<void>(go => (started = go))
    return { model: 'claude-sonnet-5-5', agentId: 'agent-1' }
  })
  on('agent.list', async () => ({ value: [{ id: 'agent-1', description: '#315 Lay Kessik out for play', type: 'issue-board:worker', status: 'running' as const }] }))
  // Start's message waits until the test lets it go.
  const sent: string[] = []
  let entered = (): void => {}
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    if (e.text.startsWith("Let's start")) await new Promise<void>(go => (entered = go))
    return { text: e.text }
  })

  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })

  // The spawn is refused: a toast says why, and the button comes back. Claude is sent nothing.
  await ui.press({ key: 'background-315' })
  await clock.settle()
  expect(spawns).toBe(1)
  expect(toasts).toContain("Couldn't start a background agent on #315: Background tasks are turned off")
  expect(await ui.find({ text: /^⚙ Starting in background…$/ })).toBeUndefined()
  expect(await ui.find({ key: 'background-315' })).toBeDefined()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeUndefined()

  // The spawn fails: the same.
  answer = 'fail'
  await ui.press({ key: 'background-315' })
  await clock.settle()
  expect(spawns).toBe(2)
  expect(toasts.at(-1)).toMatch(/^Couldn't start a background agent on #315: /)
  expect(await ui.find({ key: 'background-315' })).toBeDefined()

  // Until the agent starts, the button says so, and there's none to press again. Two presses that land before it is
  // drawn again start one agent.
  answer = 'start'
  await Promise.all([ui.press({ key: 'background-315' }), ui.press({ key: 'background-315' })])
  expect(spawns).toBe(3)
  expect(await ui.find({ text: /^⚙ Starting in background…$/ })).toBeDefined()
  await expect(ui.press({ key: 'background-315' })).rejects.toThrow(/no Button of issue-board keyed "background-315"/)

  // It starts: the row shows it working, and there's no button while it works.
  started()
  await clock.settle()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  expect(await ui.find({ text: /^⚙ Starting in background…$/ })).toBeUndefined()
  expect(await ui.find({ key: 'background-315' })).toBeUndefined()
  expect(spawns).toBe(3)
  expect(sent).toEqual([])

  // Start: while Claude is being sent the issue, its button says so; once sent, it says it started, and stays that way.
  await Promise.all([ui.press({ key: 'start-315' }), ui.press({ key: 'start-315' })])
  expect(sent.filter(text => text.startsWith("Let's start on #315"))).toHaveLength(1)
  expect(await ui.find({ text: /^▶ Starting…$/ })).toBeDefined()
  expect(await ui.find({ key: 'start-315' })).toBeUndefined()
  await expect(ui.press({ key: 'start-315' })).rejects.toThrow(/no Button of issue-board keyed "start-315"/)
  entered()
  await clock.settle()
  expect(await ui.find({ text: /^▶ Started$/ })).toBeDefined()
  expect(await ui.find({ key: 'start-315' })).toBeUndefined()
  expect(sent.filter(text => text.startsWith("Let's start on #315"))).toHaveLength(1)
  await ui.unmount()
})
