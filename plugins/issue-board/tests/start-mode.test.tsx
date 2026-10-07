import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { HANDOFF_ANSWER, handoffPrompt, orchestratorSection } from '../hooks/parse'
import { graphPage, isIssuesQuery } from './graph'

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 }, command: 'issues' } as const
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

type Raw = Parameters<typeof graphPage>[0][number]
const ISSUES: Raw[] = [{ number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit\n- [ ] Save', updatedAt: '2026-10-05T00:00:00Z', status: 'Ready', priority: 'P1' }]

// GitHub with one ready issue, and the prompts the board sends.
const world = (on: On) => {
  const state = { sent: [] as string[], filled: [] as string[] }
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = [...e.argv]
    if (argv[0] === 'git') return answer('main\n')
    if (isIssuesQuery(argv)) return answer(graphPage(ISSUES, argv, true))
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }))
    if (argv[1] === 'api' && argv[2] === 'user') return answer('astrosteveo\n')
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv.some(arg => arg.includes('updateProjectV2ItemFieldValue'))) {
      return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_43' } } } }))
    }
    if (argv[1] === 'issue' && argv[2] === 'view') {
      const raw = ISSUES[0]
      return answer(JSON.stringify({ number: raw?.number, title: raw?.title, labels: [], assignees: [], body: raw?.body, updatedAt: raw?.updatedAt }))
    }
    return answer('[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => {
    state.sent.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', async (_$, e) => {
    state.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('tool.call', { tool: 'TaskCreate' }, async (_$, e) => ({ result: { task: { id: '1', subject: e.subject } } }))
  return state
}

// The board with #43's card open.
const card = async ($: Engine, on: On) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  const gh = world(on)
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  return { ui, gh }
}

// The card's start buttons in order, with their hotkeys.
const starts = async (ui: Awaited<ReturnType<typeof card>>['ui']) =>
  (await ui.findAll({ type: 'Button' }))
    .filter(one => /^(start|background|draft|draft-background)-43$/.test(one.key ?? ''))
    .map(one => [one.key, one.props.hotkey, one.props.variant ?? null])

test('in main start mode, Start comes first on s and starts here, and the system prompt has no orchestrator note', async ($, on) => {
  const { ui, gh } = await card($, on)
  expect(await starts(ui)).toEqual([
    ['start-43', 's', 'primary'],
    ['background-43', 'b', null],
    ['draft-43', 'e', null],
    ['draft-background-43', undefined, null],
  ])
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro', 'issue-board:capture'])
  await ui.press({ key: 'start-43' })
  expect(gh.sent).toHaveLength(1)
  expect(gh.sent[0]).toMatch(/^Let's start on #43: Edit issues from the board\./)
  // Started here, the system prompt names the issue and nothing else of the board.
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro', 'issue-board:capture', 'issue-board:working'])
  await ui.unmount()
})

test('in background start mode, Start in background comes first on s, and the main-chat Start is on b', { options: { startMode: 'background' } }, async ($, on) => {
  const spawned: string[] = []
  on('agent.spawn', async (_$, e) => {
    spawned.push(e.description ?? '')
    return { model: 'claude-sonnet-5-5', agentId: 'agent-1' }
  })
  const { ui, gh } = await card($, on)
  expect(await starts(ui)).toEqual([
    ['background-43', 's', 'primary'],
    ['start-43', 'b', null],
    ['draft-background-43', 'e', null],
    ['draft-43', undefined, null],
  ])
  // Start in background starts the worker itself and sends Claude nothing.
  await ui.press({ key: 'background-43' })
  expect(spawned).toEqual(['#43 Edit issues from the board'])
  expect(gh.sent).toEqual([])

  // Edit first fills the background message.
  await ui.press({ key: 'draft-background-43' })
  expect(gh.filled[0]).toMatch(/^Dispatch a background agent to work on #43/)
  await ui.unmount()
})

test('in background start mode, the system prompt tells Claude to orchestrate', { options: { startMode: 'background' } }, async ($, on) => {
  const { ui } = await card($, on)
  const sections = (await $.prompt.compose(COMPOSE)).sections
  expect(sections.map(section => section.id)).toEqual(['intro', 'issue-board:capture', 'issue-board:orchestrator'])
  expect(sections.at(-1)?.text).toBe(orchestratorSection())
  await ui.unmount()
})

test('with the working note and capture off, background start mode adds nothing to the system prompt', { options: { startMode: 'background', workingNote: false, capture: false } }, async ($, on) => {
  const { ui } = await card($, on)
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])
  await ui.unmount()
})

test("the orchestrator note hands work to workers, keeps small changes, and sees a worker's pull request through", () => {
  const note = orchestratorSection()
  expect(note).toMatch(/^The person wants you to work as an orchestrator\. Hand each GitHub issue of this repository to a background worker/)
  expect(note).toContain('subagent_type `issue-board:worker`')
  expect(note).toContain('Do only small changes yourself, such as a one-line fix or a typo in the docs.')
  expect(note).toMatch(/When a worker ends, review its pull request, run the repository's tests and checks on its branch, and watch its CI\. Then merge it, if the person's rules let you merge, or tell the person what is left\.$/)
})

test('when a worker ends, background start mode asks Claude to review, check and merge or report its pull request', () => {
  const issue = { number: 43, title: 'Edit issues' }
  const pr = { number: 50, url: 'https://github.com/astrosteveo/claude-plugins/pull/50' }
  const main = handoffPrompt(issue, 'completed', 'Done.', pr)
  expect(main).toBe(handoffPrompt(issue, 'completed', 'Done.', pr, 'main'))
  expect(main).toMatch(/Tell the person in a few sentences what it did and what is left/)
  const background = handoffPrompt(issue, 'completed', 'Done.', pr, 'background')
  expect(background).toMatch(/Review pull request #50, run the repository's tests and checks on its branch, and watch its CI\. Then merge it, if the person's rules let you merge, or tell the person in a few sentences what is left\.$/)
  // With no pull request, or a failed agent, there is nothing to review.
  expect(handoffPrompt(issue, 'completed', 'Done.', null, 'background')).toBe(handoffPrompt(issue, 'completed', 'Done.', null))
  expect(handoffPrompt(issue, 'failed', null, pr, 'background')).toBe(handoffPrompt(issue, 'failed', null, pr))
})

// Claude Code sends no task notification for an agent a plugin spawned, so the hand-off is where Claude reads the
// answer. It keeps the start, and the pull request holds the rest.
test("a hand-off keeps a short excerpt of a long answer, and still names the issue, the result, the pull request and the next step", () => {
  const issue = { number: 43, title: 'Edit issues' }
  const pr = { number: 50, url: 'https://github.com/astrosteveo/claude-plugins/pull/50' }
  const report = `Opened PR #50. ${'All boxes are ticked and the tests pass. '.repeat(120)}`.trim()
  const done = handoffPrompt(issue, 'completed', report, pr)
  expect(done).toMatch(/^The background agent that Start in background set on #43 "Edit issues" is done\./)
  expect(done).toContain('Its pull request: #50 https://github.com/astrosteveo/claude-plugins/pull/50')
  expect(done).toContain('Its last answer, cut short:\nOpened PR #50. All boxes')
  expect(done).toMatch(/Tell the person in a few sentences what it did and what is left/)
  expect(done).not.toContain(report)
  // The answer took up to 4,000 characters before; a report this long now costs about 3,000 fewer.
  const excerpt = done.split('\n\n').find(part => part.startsWith('Its last answer'))!
  expect(excerpt.length).toBeLessThanOrEqual(HANDOFF_ANSWER + 30)
  expect(report.length - excerpt.length).toBeGreaterThan(3000)

  // A short answer is kept whole, and a failed agent's last words still come through.
  expect(handoffPrompt(issue, 'completed', 'Done.', pr)).toContain('Its last answer:\nDone.')
  const failed = handoffPrompt(issue, 'failed', 'The tests would not build.', null)
  expect(failed).toMatch(/^The background agent that Start in background set on #43 "Edit issues" failed\./)
  expect(failed).toContain('Its last answer:\nThe tests would not build.')
  expect(failed).toContain('The board sees no pull request for the issue.')
  expect(failed).toMatch(/say what they could do next\.$/)
  expect(handoffPrompt(issue, 'failed', null, null)).toContain('It gave no answer.')
})
