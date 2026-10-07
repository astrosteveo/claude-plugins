import type { AgentSpawnInput, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { workerOnLine } from '../hooks/workers'
import { adoptedStore, fakeGitHub, registrations, session } from './github'
import type { Raw } from './graph'
import { COMPOSE, REFRESH, REPO, RUN, band, engineBand, pane } from './ui'

// Background agents: the board's worker on an issue, and agents something else started. Neither makes its issue the
// one Claude is on, and the band leaves agents to Claude Code's own list.

const ISSUE_90: Raw = {
  number: 90,
  title: 'Tell the background agent which issue it is on, in so many words',
  url: 'https://github.com/astrosteveo/void-sector/issues/90',
  labels: [],
  assignees: [{ login: 'astrosteveo' }],
  body: '- [ ] One\n- [ ] Two\n- [ ] Three\n- [ ] Four',
  updatedAt: '2026-10-03T20:00:00Z',
}

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

// GitHub and git as the board reads them, with #90 open, and a background agent at work on it.
const withAgent = (on: On) => {
  const gh = fakeGitHub(on, { issues: [ISSUE_90] })
  session(on)
  registrations(on)
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
  on('agent.list', async () => ({ value: [{ id: 'agent-1', name: 'issue-90', description: '#90', type: 'issue-board:worker', status: 'running' as const }] }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('tool.call', { tool: 'EnterWorktree' }, async () => ({ result: { worktreePath: '/work/void-sector/.claude/worktrees/fix-90' } }) as never)
  engineBand(on)
  return gh
}

test("a background agent's checkout in its own worktree doesn't make its issue the one Claude is on", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = withAgent(on)
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await $.command.run(REFRESH)
  await clock.settle()

  // The agent's checkout is in its worktree; asked, git would name the branch the agent's loop is on.
  gh.branch = 'fix/90-worker-message'
  // `agentId` is what the engine sets on a call in a subagent's loop; `$.tool.call`'s input type leaves it out.
  await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/90-worker-message', agentId: 'agent-1' } as never)
  await $.tool.call({ tool: 'EnterWorktree', name: 'fix-90', agentId: 'agent-1' } as never)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(120, 60) })
  expect(await ui.find({ text: /^▶ $/ })).toBeUndefined()
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro', 'issue-board:capture'])

  // The main session's own checkout still does.
  gh.branch = 'main'
  await $.tool.call({ tool: 'Bash', command: 'git checkout main' })
  gh.branch = 'fix/90-worker-message'
  await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/90-worker-message' })
  await clock.settle()
  expect(await ui.find({ text: /^▶ $/ })).toBeDefined()
  await ui.unmount()
})

test("the band has no line for a background agent, since Claude Code lists them; ▶ marks only the main session's issue", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = withAgent(on)
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
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(120, 60) })
  // The agent has #90, so its row has no ▶: it says it is the agent's.
  expect(await ui.find({ text: /^▶ $/ })).toBeUndefined()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()

  // The band leaves the agent to Claude Code's own list and draws nothing of the board's.
  expect(await wide.find({ key: 'engine' })).toBeDefined()
  expect(await wide.find({ text: /^ #90 $/ })).toBeUndefined()

  await ui.unmount()
  await wide.unmount()
})

// While a background agent is on an issue, its card shows the agent in place of every start button, whoever started
// the agent, and the buttons come back once it ends (#269).

const EPIC = { number: 35, title: 'Make the issue board a full issue tracker', total: 2, completed: 1 }
// Epic #35, whose card starts its ready sub-issue #43, and a plain ready issue, #50.
const ISSUES: Raw[] = [
  { number: 35, title: EPIC.title, labels: [], body: 'The whole.', updatedAt: '2026-10-05T00:00:00Z', subIssues: { total: 2, completed: 1 }, status: 'Ready', priority: 'P1' },
  { number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit\n- [ ] Save', updatedAt: '2026-10-05T00:00:00Z', parent: EPIC, status: 'Ready', priority: 'P1' },
  { number: 50, title: 'Show the worker on the card', labels: [], body: '- [ ] Show it', updatedAt: '2026-10-05T00:00:00Z', status: 'Ready', priority: 'P1' },
]

// Claude's own Agent tool call for the board's worker, which the board follows by the issue its description names.
const dispatched = (number: number): AgentSpawnInput => ({
  tool_use_id: 'toolu_1',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  subagentType: 'issue-board:worker',
  description: `#${number} ${ISSUES.find(one => one.number === number)?.title}`,
  prompt: `Let's start on #${number}.`,
})

const BUTTONS = (number: number) => [`start-${number}`, `background-${number}`, `draft-${number}`, `draft-background-${number}`]

// GitHub with the project, one agent whose status the test moves, and the pane open at the card of issue `open`.
const cardOf = async ($: Engine, on: On, open: number) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  const agent = { status: 'running' as 'running' | 'completed', description: '' }
  fakeGitHub(on, { repo: 'astrosteveo/claude-plugins', issues: ISSUES, project: true })
  session(on)
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('agent.spawn', async (_$, e) => {
    agent.description = e.description
    return { model: 'claude-sonnet-5-5', agentId: 'agent-1' }
  })
  on('agent.list', async () => ({ value: [{ id: 'agent-1', description: agent.description, type: 'issue-board:worker', status: agent.status }] }))
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(110, 60) })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: `issue-${open}` })
  // The agent ends: the board sees it on its next look at the agents.
  const end = async () => {
    agent.status = 'completed'
    await clock.advance(10_000)
  }
  return { ui, clock, end }
}

type Ui = Awaited<ReturnType<typeof cardOf>>['ui']
const buttonsShown = async (ui: Ui, number: number) => (await Promise.all(BUTTONS(number).map(key => ui.find({ key })))).map(Boolean)

test('the line names the agent, its status and its age, and an epic names the sub-issue', () => {
  expect(workerOnLine('running', '4m')).toBe('⚙ Worker on it · working 4m')
  expect(workerOnLine('waiting', 'now', 43)).toBe('⚙ Worker on #43 · waiting now')
  expect(workerOnLine('pending', '')).toBe('⚙ Worker on it · working')
})

test('Start in background: the card shows the agent instead of the start buttons, and they come back when it ends', async ($, on) => {
  const { ui, clock, end } = await cardOf($, on, 50)
  expect(await buttonsShown(ui, 50)).toEqual([true, true, true, true])
  await ui.press({ key: 'background-50' })
  await clock.settle()
  expect(await buttonsShown(ui, 50)).toEqual([false, false, false, false])
  expect(await ui.find({ text: '⚙ Worker on it · working now' })).toBeDefined()
  await end()
  expect(await ui.find({ text: /^⚙ Worker on / })).toBeUndefined()
  expect(await buttonsShown(ui, 50)).toEqual([true, true, true, true])
  await ui.unmount()
})

test('a worker Claude dispatched: the card shows it instead of the start buttons, and they come back when it ends', async ($, on) => {
  const { ui, clock, end } = await cardOf($, on, 50)
  await $.agent.spawn(dispatched(50))
  await clock.settle()
  expect(await buttonsShown(ui, 50)).toEqual([false, false, false, false])
  expect(await ui.find({ text: '⚙ Worker on it · working now' })).toBeDefined()
  await end()
  expect(await ui.find({ text: /^⚙ Worker on / })).toBeUndefined()
  expect(await buttonsShown(ui, 50)).toEqual([true, true, true, true])
  await ui.unmount()
})

test("an epic's card follows the sub-issue its Start starts, from either kind of start", async ($, on) => {
  const { ui, clock, end } = await cardOf($, on, 35)
  expect(await ui.find({ key: 'start-35' })).toMatchObject({ text: '▶ Start #43' })
  // Claude dispatches a worker on #43: the epic's card names it in place of its buttons.
  await $.agent.spawn(dispatched(43))
  await clock.settle()
  expect(await buttonsShown(ui, 35)).toEqual([false, false, false, false])
  expect(await ui.find({ text: '⚙ Worker on #43 · working now' })).toBeDefined()
  await end()
  expect(await buttonsShown(ui, 35)).toEqual([true, true, true, true])
  await ui.unmount()
})

test("an epic's Start in background hides its buttons until the sub-issue's agent ends", async ($, on) => {
  const { ui, clock, end } = await cardOf($, on, 35)
  await ui.press({ key: 'background-35' })
  await clock.settle()
  expect(await buttonsShown(ui, 35)).toEqual([false, false, false, false])
  expect(await ui.find({ text: '⚙ Worker on #43 · working now' })).toBeDefined()
  await end()
  expect(await buttonsShown(ui, 35)).toEqual([true, true, true, true])
  await ui.unmount()
})
