import type { AgentSpawnInput, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { backgroundPrompt, namesIssue, startPrompt } from '../hooks/parse'
import { STATUSES, graphPage, isIssuesQuery, adoptedStore } from './graph'

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 }, command: 'issues' } as const

type Raw = Parameters<typeof graphPage>[0][number]
const EPIC = { number: 35, title: 'Make the issue board a full issue tracker', total: 2, completed: 1 }
// Epic #35 in the project, with one open sub-issue, #43, which is ready: its card's Start starts #43.
const ISSUES: Raw[] = [
  { number: 35, title: EPIC.title, labels: [], body: 'The whole.', updatedAt: '2026-10-05T00:00:00Z', subIssues: { total: 2, completed: 1 }, status: 'Ready', priority: 'P1' },
  { number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit\n- [ ] Save', updatedAt: '2026-10-05T00:00:00Z', parent: EPIC, status: 'Ready', priority: 'P1' },
]

const worker = (number: number): AgentSpawnInput => ({
  tool_use_id: 'toolu_1',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  subagentType: 'issue-board:worker',
  description: `#${number} Edit issues from the board`,
  prompt: `Let's start on #${number}.`,
})

// GitHub with the project, the writes Start makes (`status #N <Status>`, `assign #N`), the prompts sent with what they
// carried for Claude, what Edit first filled, the tasks made, and the agents spawned.
const world = (on: On) => {
  // These tests have the board write to the project, which the person let it do.
  adoptedStore(on)
  on('session.root', async () => ({ value: '/work/void-sector' }))
  const state = { writes: [] as string[], sent: [] as { text: string; context: readonly string[] }[], filled: [] as string[], tasks: [] as string[], spawned: [] as { description: string; prompt: string }[] }
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = [...e.argv]
    if (argv[0] === 'git') return answer('main\n')
    if (isIssuesQuery(argv)) return answer(graphPage(ISSUES, argv, true))
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }))
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv.some(arg => arg.includes('updateProjectV2ItemFieldValue'))) {
      const item = argv.find(arg => arg.startsWith('item='))?.slice('item=PVTI_'.length) ?? ''
      state.writes.push(`status #${item} ${STATUSES[Number(argv.find(arg => arg.startsWith('option='))?.slice('option=S'.length))]}`)
      return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: item } } } }))
    }
    if (argv[1] === 'issue' && argv[2] === 'edit' && argv.includes('--add-assignee')) {
      state.writes.push(`assign #${argv[3]}`)
      return answer('')
    }
    if (argv[1] === 'issue' && argv[2] === 'view') {
      const raw = ISSUES.find(one => one.number === Number(argv[3]))
      return answer(JSON.stringify({ number: raw?.number, title: raw?.title, labels: [], assignees: [{ login: 'astrosteveo' }], body: raw?.body, updatedAt: raw?.updatedAt }))
    }
    if (argv[1] === 'api' && argv[2] === 'user') return answer('astrosteveo\n')
    return answer('[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => {
    state.sent.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text }
  })
  on('prompt.fill', async (_$, e) => {
    state.filled.push(e.text)
    return { isFilled: true }
  })
  on('tool.call', { tool: 'TaskCreate' }, async (_$, e) => {
    state.tasks.push(e.subject)
    return { result: { task: { id: String(state.tasks.length), subject: e.subject } } }
  })
  on('agent.spawn', async (_$, e) => {
    state.spawned.push({ description: e.description, prompt: e.prompt })
    return { model: 'claude-sonnet-5-5', agentId: 'agent-1' }
  })
  on('agent.list', async () => ({ value: [{ id: 'agent-1', description: '#43 Edit issues from the board', type: 'issue-board:worker', status: 'running' as const }] }))
  return state
}

// The board with epic #35's card open.
const epicCard = async ($: Engine, on: On) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  const gh = world(on)
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-35' })
  return { ui, gh, clock }
}

test('the start messages end with the open boxes, and a prompt names an issue only by its own number', () => {
  const issue = { number: 43, title: 'Edit issues', checks: [{ text: 'Edit', done: false }], labels: [], assignees: [], updatedAt: '' } as unknown as Parameters<typeof startPrompt>[0]
  expect(startPrompt(issue, true)).toMatch(/\n\nIts open acceptance boxes:\n- Edit\n\nEach is a task in your task list too: mark it completed when it is done\.$/)
  expect(backgroundPrompt(issue)).toMatch(/and this prompt:\n\nLet's start on #43[^]*\n- Edit$/)
  expect(namesIssue("Let's start on #43: Edit issues.", 43)).toBe(true)
  expect(namesIssue('Look at #430 and https://x/#43 instead.', 43)).toBe(false)
})

test("the card has no note box, and Start sends its target's message as it was", async ($, on) => {
  const { ui, gh } = await epicCard($, on)
  expect(await ui.find({ key: 'note-35' })).toBeUndefined()
  await ui.press({ key: 'start-35' })
  expect(gh.sent).toHaveLength(1)
  expect(gh.sent[0]?.text).toMatch(/^Let's start on #43: Edit issues from the board\./)
  expect(gh.sent[0]?.text).toMatch(/mark it completed when it is done\.$/)
  await ui.unmount()
})

test("Start in background starts the worker with its target's start message, and sends Claude nothing", async ($, on) => {
  const { ui, gh, clock } = await epicCard($, on)
  await ui.press({ key: 'background-35' })
  await clock.settle()
  expect(gh.spawned).toEqual([{ description: '#43 Edit issues from the board', prompt: expect.stringMatching(/^Let's start on #43[^]*\n- Save$/) }])
  expect(gh.sent).toEqual([])
  // The board claims the issue it started, as Start does.
  expect(gh.writes).toEqual(['status #43 In progress', 'assign #43'])
  await ui.unmount()
})

test("Edit first fills its target's message; sent still naming the issue, it starts it as Start does", async ($, on) => {
  const { ui, gh, clock } = await epicCard($, on)
  await ui.press({ key: 'draft-35' })
  expect(gh.filled).toEqual([startPrompt({ ...ISSUES[1]!, checks: [{ text: 'Edit', done: false }, { text: 'Save', done: false }], assignees: [] } as never)])
  // Nothing has started yet: the message is only in the prompt box.
  expect(gh.writes).toEqual([])
  expect(gh.sent).toEqual([])

  // The person adds a line and sends it.
  await $.prompt.submit({ text: `${gh.filled[0]}\nRun the tests first.`, wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(gh.tasks).toEqual(['Edit', 'Save'])
  expect(gh.sent[0]?.context.some(line => line.includes('Each open acceptance box of #43 is a task in your task list too'))).toBe(true)
  expect(gh.writes).toEqual(['status #43 In progress', 'assign #43'])
  expect(await ui.find({ text: /^▶ Started$/ })).toBeDefined()

  // The next prompt that names #43 is a plain one.
  await $.prompt.submit({ text: 'How is #43 going?', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(gh.tasks).toHaveLength(2)
  expect(gh.writes).toHaveLength(2)
  await ui.unmount()
})

test('an Edit-first message rewritten so it no longer names the issue is sent as a plain prompt', async ($, on) => {
  const { ui, gh, clock } = await epicCard($, on)
  await ui.press({ key: 'draft-35' })
  await $.prompt.submit({ text: 'Actually, tell me what the board does first.', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(gh.sent.map(one => one.text)).toEqual(['Actually, tell me what the board does first.'])
  expect(gh.tasks).toEqual([])
  expect(gh.writes).toEqual([])
  expect(await ui.find({ key: 'start-35' })).toMatchObject({ text: '▶ Start #43' })
  await ui.unmount()
})

test('Edit first in background fills the dispatch message; sent, Claude dispatches the worker and the board follows it', async ($, on) => {
  const { ui, gh, clock } = await epicCard($, on)
  await ui.press({ key: 'draft-background-35' })
  expect(gh.filled).toHaveLength(1)
  expect(gh.filled[0]).toMatch(/^Dispatch a background agent to work on #43/)

  // Sending it makes the issue no foreground start: the worker takes it.
  await $.prompt.submit({ text: gh.filled[0] ?? '', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(gh.tasks).toEqual([])
  expect(gh.writes).toEqual([])

  // Claude dispatches the worker: the board follows it and claims the issue.
  await $.agent.spawn(worker(43))
  await clock.settle()
  expect(await ui.find({ text: /^⚙ working$/ })).toBeDefined()
  expect(gh.writes).toEqual(['status #43 In progress', 'assign #43'])
  await ui.unmount()
})
