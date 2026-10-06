import type { AgentSpawnInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { graphPage, isIssuesQuery } from './graph'

const issue = (body: string) => ({
  number: 90,
  title: 'Tell the background agent which issue it is on, in so many words',
  url: 'https://github.com/astrosteveo/void-sector/issues/90',
  labels: [],
  assignees: [{ login: 'astrosteveo' }],
  body,
  updatedAt: '2026-10-03T20:00:00Z',
})

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
const band = (bodyColumns: number) => ({ component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} } }) as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }

const spawn = (): AgentSpawnInput => ({
  tool_use_id: 'toolu_1',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  subagentType: 'issue-board:worker',
  name: 'issue-90',
  description: '#90 Tell the background agent which issue it is on',
  prompt: "Let's start on #90.",
})

// GitHub and git as the board reads them, one issue whose body a test can change, and a background agent's status.
const world = (on: On) => {
  const state = { body: '- [ ] One\n- [ ] Two\n- [ ] Three\n- [ ] Four', status: 'running', branch: 'main' }
  on('process.run', async (_$, e) => {
    const argv = e.argv
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer(`${state.branch}\n`)
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (isIssuesQuery(argv)) return answer(graphPage([issue(state.body)]))
    if (argv[1] === 'api' && argv[2] === 'graphql') return answer(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }))
    if (argv[1] === 'api') return answer('astrosteveo\n')
    return answer('[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
  on('agent.list', async () => ({ value: [{ id: 'agent-1', name: 'issue-90', description: '#90', type: 'issue-board:worker', status: state.status as 'running' }] }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('tool.call', { tool: 'EnterWorktree' }, async () => ({ result: { worktreePath: '/work/void-sector/.claude/worktrees/fix-90' } }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  return state
}

test("a background agent's checkout in its own worktree doesn't make its issue the one Claude is on", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()

  // The agent's checkout is in its worktree; asked, git would name the branch the agent's loop is on.
  gh.branch = 'fix/90-worker-message'
  // `agentId` is what the engine sets on a call in a subagent's loop; `$.tool.call`'s input type leaves it out.
  await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/90-worker-message', agentId: 'agent-1' } as never)
  await $.tool.call({ tool: 'EnterWorktree', name: 'fix-90', agentId: 'agent-1' } as never)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /^▶ $/ })).toBeUndefined()
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])

  // The main session's own checkout still does.
  gh.branch = 'main'
  await $.tool.call({ tool: 'Bash', command: 'git checkout main' })
  gh.branch = 'fix/90-worker-message'
  await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/90-worker-message' })
  await clock.settle()
  expect(await pane.find({ text: /^▶ $/ })).toBeDefined()
  await pane.unmount()
})

test('the band has a line for each background agent at work, which goes when it ends; ▶ marks only the main session\'s issue', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()

  const wide = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...band(120) })
  expect(await wide.find({ key: 'engine' })).toBeDefined()

  // The main session moves to #90's branch, then Claude hands #90 to a background agent.
  gh.branch = 'fix/90-worker-message'
  await $.tool.call({ tool: 'Bash', command: 'git checkout fix/90-worker-message' })
  await $.agent.spawn(spawn())
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  // The agent has #90, so its row has no ▶: it says it is the agent's.
  expect(await pane.find({ text: /^▶ $/ })).toBeUndefined()
  expect(await pane.find({ text: /^⚙ working$/ })).toBeDefined()

  expect(await wide.find({ key: 'engine' })).toBeUndefined()
  expect(await wide.find({ key: 'agent-row-agent-1' })).toBeDefined()
  expect(await wide.find({ text: /^ #90 $/ })).toBeDefined()
  expect(await wide.find({ text: /^working$/ })).toBeDefined()
  expect(await wide.find({ text: /^ 0\/4$/ })).toBeDefined()
  expect(await wide.find({ text: /^Tell the background agent which issue it is on, in so many words$/ })).toBeDefined()

  // One row at any width: a narrow band cuts the title to fit.
  const narrow = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...band(44) })
  const title = await narrow.find({ text: /^Tell/ })
  expect(title?.text).toMatch(/…$/)
  expect([...(title?.text ?? '')].length).toBeLessThan(20)
  await narrow.unmount()

  // Waiting on something: the line says so.
  gh.status = 'waiting'
  await clock.advance(10_000)
  expect(await wide.find({ text: /^waiting$/ })).toBeDefined()

  // An issue with no boxes has no bar.
  gh.body = 'No list here.'
  await $.command.run(REFRESH)
  await clock.settle()
  expect(await wide.find({ text: /\d\/\d/ })).toBeUndefined()
  expect(await wide.find({ key: 'agent-row-agent-1' })).toBeDefined()

  // It ends: the conversation is told, and the band has nothing more to say.
  await $.turn.complete({ answer: 'Opened PR #91.', durationMs: 1, isAborted: false, turnId: 't', agentId: 'agent-1', reason: 'answer' })
  await clock.settle()
  expect(await wide.find({ key: 'agent-row-agent-1' })).toBeUndefined()
  expect(await wide.find({ key: 'engine' })).toBeDefined()

  await pane.unmount()
  await wide.unmount()
})
