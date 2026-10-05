import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { eventRepoOf, liveRunsOf, runProgressOf, workerBadge } from '../hooks/parse'
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
  'Refreshing run status every 5 seconds. Press Ctrl+C to quit.',
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
  'Refreshing run status every 5 seconds. Press Ctrl+C to quit.',
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
const world = (on: On) => {
  const state = { prs: [pr('pending')] as unknown[], runs: [] as unknown[], reads: 0, watched: [] as string[][] }
  on('process.run', async (_$, e) => {
    const argv = e.argv
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer('fix/315-glide\n')
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (isIssuesQuery(argv)) {
      state.reads += 1
      return answer(graphPage([issue]))
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

  expect(runProgressOf('Refreshing run status every 5 seconds.\n')).toBeNull()
  expect(runProgressOf(RUNNING)).toEqual({ done: 1, total: 2, failed: 0, running: 'validate', step: 'Install Claude Code' })
  // The last drawing counts.
  expect(runProgressOf(`${RUNNING}${ENDED}`)).toEqual({ done: 2, total: 2, failed: 1, running: null, step: null })
  expect(runProgressOf(`\x1b[1mJOBS\x1b[0m\n\x1b[32m✓\x1b[0m build (ID 1)\n`)).toEqual({ done: 1, total: 1, failed: 0, running: null, step: null })

  // What gh 2.102 wrote watching this repo's own CI: no line between one drawing and the next.
  const real = [
    'Refreshing run status every 5 seconds. Press Ctrl+C to quit.',
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

test("while the branch's CI runs, the band and the pane show its progress from gh run watch, and its end reads GitHub", async ($, on) => {
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
  expect(gh.watched).toEqual([['gh', 'run', 'watch', '987', '--interval', '5']])
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: / ◷ CI / })).toBeDefined()
  expect(await band.find({ text: / 1\/2 jobs/ })).toBeDefined()
  expect(await band.find({ text: /^validate › Install Claude Code$/ })).toBeDefined()
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'run-987' })).toBeDefined()

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

test('Start in background runs the registered agent on the issue, the row shows how it goes, and its end comes back to the conversation and Claude', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  world(on)
  const registered: { name: string; isolation?: string; background?: boolean }[] = []
  const spawned: { type?: unknown; background?: unknown; prompt: string; name?: string }[] = []
  let status = 'running'
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => {
    registered.push({ name: e.name, ...(e.isolation ? { isolation: e.isolation } : {}), ...(e.background ? { background: e.background } : {}) })
    return { value: { agent: `issue-board:${e.name}` } }
  })
  // Beneath the plugins, the spawn arrives as the Agent tool's call spells it.
  on('agent.spawn', async (_$, e) => {
    const call = e as unknown as { subagent_type?: unknown; run_in_background?: unknown }
    spawned.push({ type: call.subagent_type, background: call.run_in_background, prompt: e.prompt, ...(e.name ? { name: e.name } : {}) })
    order.push('spawn')
    return { model: 'claude-sonnet-5-5', agentId: 'agent-1' }
  })
  on('agent.list', async () => ({ value: [{ id: 'agent-1', name: 'issue-315', description: '#315', type: 'issue-board:worker', status: status as 'running' }] }))
  on('turn.complete', async (_$, e) => {
    if (e.agentId) order.push('answer')
    return { text: e.answer }
  })
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text))
    return { value: undefined }
  })
  // What the board hands Claude, and as whose words.
  const handed: { text: string; origin: unknown }[] = []
  on('prompt.submit', async (_$, e) => {
    handed.push({ text: e.text, origin: e.origin })
    order.push('prompt')
    return { text: e.text }
  })
  // The lines the board adds to the conversation, and when, beside the spawn and the agent's answer.
  const order: string[] = []
  const lines: string[] = []
  on('ui.log', async (_$, e) => {
    if (e.to === 'debug') return { value: undefined }
    lines.push(e.text)
    order.push('line')
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
  expect(spawned).toEqual([{ type: 'issue-board:worker', background: true, prompt: expect.stringMatching(/^Let's start on #315: Lay Kessik out for play\./), name: 'issue-315' }])
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  expect(toasts).toContain('Started a background agent on #315')
  // The conversation says so at once, naming the issue, in a line the model doesn't read.
  expect(lines).toEqual(['Started a background agent on #315 "Lay Kessik out for play". It is working on the issue in the background now.'])
  expect(order).toEqual(['spawn', 'line'])
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
  // GitHub again; then Claude gets the same, in the board's name, to follow up on.
  expect(lines.at(-1)).toBe(
    'The background agent on #315 "Lay Kessik out for play" is done. Opened PR #335. Box 1 is ticked. Pull request #335: https://github.com/astrosteveo/void-sector/pull/335',
  )
  expect(handed).toEqual([{ text: expect.stringMatching(/^The background agent that Start in background set on #315 "Lay Kessik out for play" is done\./), origin: { kind: 'plugin', name: 'issue-board' } }])
  expect(handed[0]?.text).toContain('Its pull request: #335 https://github.com/astrosteveo/void-sector/pull/335')
  expect(handed[0]?.text).toContain('Its last answer:\nOpened PR #335.\n\nBox 1 is ticked.')
  expect(handed[0]?.text).toMatch(/Tell the person in a few sentences what it did and what is left/)
  expect(toasts).toContain('The background agent on #315 finished')
  expect(order).toEqual(['spawn', 'line', 'answer', 'line', 'prompt'])

  // The list then says it ended too: nothing is told twice.
  status = 'completed'
  await clock.advance(20_000)
  expect(lines.length).toBe(2)
  expect(handed.length).toBe(1)
  await ui.unmount()
})

test('Start in background says in the conversation when no agent starts; Start itself adds nothing there', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  world(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  // Core refuses the spawn, then starts none the session lists, then one it lists by the name the board gave.
  let spawn: 'deny' | 'nameless' | 'start' = 'deny'
  on('agent.spawn', async () => (spawn === 'deny' ? { deny: 'Background tasks are turned off' } : { model: 'claude-sonnet-5-5' }))
  on('agent.list', async () => ({
    value: spawn === 'start' ? [{ id: 'agent-1', name: 'issue-315', description: '#315', type: 'issue-board:worker', status: 'running' as const }] : [],
  }))
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('tool.call', { tool: 'TaskCreate' }, async (_$, e) => ({ result: { task: { id: '1', subject: e.subject } } }))
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

  // Start sends Claude the issue as it did, and adds no line to the conversation itself.
  await ui.press({ key: 'start-315' })
  expect(sent.at(-1)).toMatch(/^Let's start on #315: Lay Kessik out for play\./)
  expect(lines).toEqual([])

  // A refused spawn: the conversation says why, and that nothing started.
  await ui.press({ key: 'background-315' })
  expect(lines).toEqual(['Couldn\'t start a background agent on #315 "Lay Kessik out for play": Background tasks are turned off'])
  expect(toasts).toContain("Couldn't start a background agent on #315: Background tasks are turned off")
  expect(await ui.find({ text: /^⚙ working$/ })).toBeUndefined()
  expect(await ui.find({ key: 'background-315' })).toBeDefined()

  // A spawn that names no agent the session lists is no start either.
  spawn = 'nameless'
  await ui.press({ key: 'background-315' })
  expect(lines.at(-1)).toBe('Couldn\'t start a background agent on #315 "Lay Kessik out for play": no agent started')
  expect(lines.some(line => line.startsWith('Started'))).toBe(false)
  expect(await ui.find({ text: /^⚙ working$/ })).toBeUndefined()

  // Then it starts: the line says so, once.
  spawn = 'start'
  await ui.press({ key: 'background-315' })
  expect(lines.filter(line => line.startsWith('Started'))).toEqual(['Started a background agent on #315 "Lay Kessik out for play". It is working on the issue in the background now.'])
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  await ui.unmount()
})

test('a background agent that fails or is stopped says so in the conversation and to Claude, once, with or without an answer', async ($, on) => {
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

  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })

  // An API error ends the first: the line says it failed, with its last words, and no pull request.
  await ui.press({ key: 'background-315' })
  await $.turn.complete({ answer: 'The tests would not build.', durationMs: 1, isAborted: false, turnId: 't', agentId: 'agent-1', reason: 'error' })
  await clock.settle()
  expect(await ui.find({ text: /^⚙ failed$/ })).toBeDefined()
  expect(lines.at(-1)).toBe('The background agent on #315 "Lay Kessik out for play" failed. The tests would not build.')
  expect(lines.some(line => line.includes('is done'))).toBe(false)
  expect(handed.at(-1)).toMatch(/^The background agent that Start in background set on #315 "Lay Kessik out for play" failed\./)
  expect(handed.at(-1)).toContain('The board sees no pull request for the issue.')
  expect(handed.at(-1)).toMatch(/say what they could do next/)

  // The second is stopped and never answers: the list says so, and 10 seconds on the line does.
  await ui.press({ key: 'background-315' })
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
  // The spawn and the prompt each wait until the test lets them go.
  let spawns = 0
  let spawned = (): void => {}
  on('agent.spawn', async () => {
    spawns += 1
    await new Promise<void>(go => (spawned = go))
    return { model: 'claude-sonnet-5-5', agentId: 'agent-1' }
  })
  on('agent.list', async () => ({ value: [{ id: 'agent-1', name: 'issue-315', description: '#315', type: 'issue-board:worker', status: 'running' as const }] }))
  const sent: string[] = []
  let entered = (): void => {}
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    await new Promise<void>(go => (entered = go))
    return { text: e.text }
  })

  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })

  // Start in background: while the agent starts, its button says so, and there's none to press again. Two presses that
  // land before it is drawn again start one agent.
  await Promise.all([ui.press({ key: 'background-315' }), ui.press({ key: 'background-315' })])
  expect(spawns).toBe(1)
  expect(await ui.find({ text: /^⚙ Starting in background…$/ })).toBeDefined()
  expect(await ui.find({ key: 'background-315' })).toBeUndefined()
  await expect(ui.press({ key: 'background-315' })).rejects.toThrow(/no Button of issue-board keyed "background-315"/)
  spawned()
  await clock.settle()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  expect(await ui.find({ text: /^⚙ Starting in background…$/ })).toBeUndefined()
  expect(await ui.find({ key: 'background-315' })).toBeUndefined()
  expect(spawns).toBe(1)

  // Start: while Claude is being sent the issue, its button says so; once sent, it says it started, and stays that way.
  await Promise.all([ui.press({ key: 'start-315' }), ui.press({ key: 'start-315' })])
  expect(sent).toHaveLength(1)
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
