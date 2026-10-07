import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { FINISH, FINISH_SHORT, prRowRoom } from '../hooks/parse'
import type { Board, EpicNote, Plan, Worker } from '../types'
import { graphPage, isIssuesQuery } from './graph'
import { assertNoSplitAtoms, breaks, splitAtoms } from './narrow'

// One board with every kind of row the pane and the band draw, so a new kind of row is covered by adding it here.

const REPO = 'astrosteveo/void-sector'
const LONG = 'Keep the hangar doors and the docking ring in step when a save loads mid-flight'

const ISSUES = [
  // An epic with sub-issues.
  {
    number: 301,
    title: 'Ship the hangar overhaul across saves, menus and the docking ring',
    url: `https://github.com/${REPO}/issues/301`,
    labels: [{ name: 'enhancement', color: 'a2eeef' }, { name: 'area:ui', color: '0e8a16' }],
    assignees: [{ login: 'astrosteveo' }],
    body: 'The overhaul.\n\n## Acceptance\n\n- [x] Planned\n- [ ] Shipped',
    updatedAt: '2026-10-03T20:00:00Z',
    status: 'In progress',
    priority: 'P1',
    subIssues: { total: 3, completed: 1 },
    position: 0,
  },
  // A bug under the epic, blocked, with labels, an assignee, a pull request, and long boxes.
  {
    number: 302,
    title: LONG,
    url: `https://github.com/${REPO}/issues/302`,
    labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'area:simulation', color: '0e8a16' }, { name: 'future', color: 'c5def5' }],
    assignees: [{ login: 'astrosteveo' }],
    body: `Doors drift.\n\n## Acceptance\n\n- [x] ${LONG}, and the ring keeps its place in the dock after a reload\n- [ ] The save menu names the hangar it loads, the ring's state and the time it was saved, without wrapping into the row below`,
    updatedAt: '2026-10-02T20:00:00Z',
    status: 'Ready',
    priority: 'P0',
    parent: { number: 301, title: 'Ship the hangar overhaul across saves, menus and the docking ring', total: 3, completed: 1 },
    blockedBy: [{ number: 303, state: 'OPEN' }, { number: 304, state: 'OPEN' }],
    prs: [252],
    position: 1,
  },
  {
    number: 303,
    title: 'The map key hides the legend on small screens when the overlay is open',
    url: `https://github.com/${REPO}/issues/303`,
    labels: [{ name: 'enhancement', color: 'a2eeef' }, { name: 'area:art-audio', color: 'fbca04' }],
    assignees: [{ login: 'alice' }],
    body: '- [ ] Legend shows\n- [ ] Key moves aside',
    updatedAt: '2026-10-01T20:00:00Z',
    status: 'Backlog',
    priority: 'P2',
    parent: { number: 301, title: 'Ship the hangar overhaul across saves, menus and the docking ring', total: 3, completed: 1 },
    position: 2,
  },
  {
    number: 1234,
    title: 'Asteroids draw a frame late after a jump',
    url: `https://github.com/${REPO}/issues/1234`,
    labels: [],
    assignees: [],
    body: null,
    updatedAt: '2026-09-01T20:00:00Z',
    status: 'Inbox',
    position: 3,
  },
]

const pr = (number: number, title: string, conclusion: string | null, more: Record<string, unknown> = {}) => ({
  number,
  title,
  url: `https://github.com/${REPO}/pull/${number}`,
  headRefName: `fix/${number}-a-branch-name-that-runs-long`,
  isDraft: false,
  statusCheckRollup: conclusion ? [{ name: 'test', status: 'COMPLETED', conclusion }] : [{ name: 'test', status: 'IN_PROGRESS' }],
  reviewDecision: null,
  additions: 1104,
  deletions: 11,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-03T20:00:00Z',
  ...more,
})

// CI pending, passing and failing; each names an issue, with diff counts. One can't merge and asks for a review.
const PRS = [
  pr(252, 'Fold the decide mod into ask: remembered answers and the decisions pane', null, { body: 'Closes #302', mergeStateStatus: 'DIRTY', reviewRequests: [{ login: 'alice' }] }),
  pr(251, 'Check that the pane shows a plan in its new order after Apply', 'SUCCESS', { body: 'Refs #303', reviewDecision: 'APPROVED' }),
  pr(249, 'Keep links and box marks on screen in a narrow pane', 'FAILURE', { body: 'Refs #1234', additions: 12, deletions: 3 }),
]

const VIEWS = { views: [{ name: 'Bugs this sprint', number: 2, layout: 'TABLE_LAYOUT' as const, filter: 'label:bug' }, { name: 'Roadmap', number: 3, layout: 'ROADMAP_LAYOUT' as const, filter: null }] }

const pane = (width: number) => ({ component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: width, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} } }) as const
const band = (width: number) => ({ component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: width, scroll: { offset: 0, bodyRows: 20 }, view: {} } }) as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const WIDTHS = [40, 60, 80, 120]

test('a word wrap breaks at spaces, and mid-word only where a word is wider than the line', () => {
  expect(breaks('ab cd ef', 5)).toEqual([5])
  expect(breaks('abcdef', 4)).toEqual([4])
  // A PR row squeezed as in #254: its number to three cells, its link to one.
  const squeezed = { type: 'Box', props: { flexDirection: 'row', width: 20 }, children: [{ type: 'Text', props: {}, children: ['#252'] }, { type: 'Text', props: {}, children: ['a title that runs on'] }] }
  expect(splitAtoms(squeezed, 20).map(one => one.atom)).toEqual(['#252'])
  // The same row with the number held at its width and the title cut instead.
  const held = { type: 'Box', props: { flexDirection: 'row', width: 20 }, children: [{ type: 'Box', props: { flexShrink: 0 }, children: [{ type: 'Text', props: {}, children: ['#252'] }] }, { type: 'Text', props: { wrap: 'truncate-end' }, children: ['a title that runs on'] }] }
  expect(splitAtoms(held, 20)).toEqual([])
})

// The fake GitHub and session behind the board, read once, with what a session would have gathered on top: weekly
// counts for the sparklines, a background agent, an epic note, a plan waiting on the person and issues captured to the
// Inbox. The pane shows every
// issue grouped by epic, with #302's card open.
const world = async ($: Engine, on: On) => {
  // No project adopted: the pane and the band ask about it.
  mock.store(on)
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer('main\n')
    if (isIssuesQuery(argv)) return answer(graphPage(ISSUES, argv, true, [], VIEWS))
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: REPO, hasIssuesEnabled: true }))
    if (argv[1] === 'pr' && argv[2] === 'list') return answer(argv.includes('merged') ? '[]' : JSON.stringify(PRS))
    if (argv[1] === 'api' && argv[2] === 'graphql') return answer(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }))
    if (argv[1] === 'api' && argv[2]?.includes('/milestones')) return answer(JSON.stringify([{ number: 3, title: 'Launch day', state: 'open', due_on: null, open_issues: 4, closed_issues: 2 }]))
    if (argv[1] === 'api') return answer('astrosteveo\n')
    return answer('[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  // The board's state, held here as the host holds it, so the test can add what a session would have gathered.
  const held = new Map<string, { value: unknown; version: number }>()
  on('state.get', async (_$, e) => ({ value: held.get(`${e.plugin}/${e.key}`) ?? { value: undefined, version: 0 } }))
  on('state.set', async (_$, e) => {
    const version = (held.get(`${e.plugin}/${e.key}`)?.version ?? 0) + 1
    held.set(`${e.plugin}/${e.key}`, { value: e.value, version })
    return { value: { isSet: true as const, version } }
  })
  const put = (key: string, value: unknown) => held.set(`issue-board/${key}`, { value, version: (held.get(`issue-board/${key}`)?.version ?? 0) + 1 })
  await $.command.run(REFRESH)

  // The sparklines read closed and merged counts by week; a board with some draws them.
  const now = held.get('issue-board/board')?.value as Board
  expect(now.prs.map(one => one.number)).toEqual([252, 251, 249])
  put('board', { ...now, velocity: { closed: [1, 4, 2, 6, 3, 5, 2, 8], merged: [0, 2, 3, 1, 4, 2, 6, 3] } })
  // Background agents at work, one on #302 so its open card shows the agent in place of its start buttons, an epic
  // note, and a plan waiting on the person.
  const agent: Worker = { number: 303, title: ISSUES[2]?.title, agentId: 'agent-1', status: 'running', startedAt: Date.now(), answer: null }
  const onCard: Worker = { number: 302, title: LONG, agentId: 'agent-2', status: 'running', startedAt: Date.now() - 4 * 60_000, answer: null }
  put('workers', [agent, onCard])
  const note: EpicNote = { key: 'verify-301', kind: 'verify', epic: 301, title: ISSUES[0]?.title ?? '', text: 'every sub-issue is closed, so it moved to Verification', at: Date.now() }
  put('epicNotes', [note])
  const plan: Plan = {
    id: 1,
    applying: false,
    note: null,
    rows: [
      { id: 'r1', change: { kind: 'status', number: 1234, value: 'Ready' }, reason: 'It blocks the jump work that #302 waits on.', picked: true, failed: null },
      { id: 'r2', change: { kind: 'labels', number: 303, add: ['bug'], remove: ['area:art-audio'] }, reason: 'It is a bug.', picked: true, failed: null },
      { id: 'r3', change: { kind: 'parent', number: 1234, value: 301 }, reason: 'Part of the overhaul.', picked: false, failed: 'GitHub refused the change' },
      { id: 'r4', change: { kind: 'order', number: 303, after: 302 }, reason: 'Next after #302.', picked: true, failed: null },
      // The repo's labels and the project's views have rows of their own, a label first and a view last.
      { id: 'label-5', change: { kind: 'label', action: 'delete', name: 'area:art-audio', uses: { open: 12, closed: 1234 }, markers: ['later'] }, reason: 'Nobody files under it.', picked: true, failed: null },
      {
        id: 'view-6',
        change: {
          kind: 'view',
          view: { name: 'Hangar overhaul', number: 12, layout: 'table', filter: 'label:area:hangar', groupBy: null },
          to: { name: 'Hangar and docking ring', layout: 'board', filter: 'label:area:hangar,area:docking status:Ready sprint:@current' },
          partial: ['sprint:@current'],
        },
        reason: 'One view for the whole overhaul.',
        picked: true,
        failed: null,
      },
    ],
  }
  put('plan', plan)
  // Issues captured to the Inbox, which the band counts.
  put('captured', 3)

  // The state is held here rather than by the host, so a drawing isn't drawn again when it changes: each press gets a
  // fresh one.
  for (const key of ['filter-all', 'group-epic', 'issue-302']) {
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(120) })
    await ui.press({ key })
    await ui.unmount()
  }
  const setup = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(120) })
  for (const key of ['pr-row-252', 'filter-view:2', 'filter-all', 'plan-card', 'plan-pick-label-5', 'plan-pick-view-6', 'adopt-card', 'card-302', 'next-301', 'box-row-302-2'])
    expect(await setup.find({ key }), key).toBeDefined()
  expect(await setup.find({ text: /^⚠ The board can't apply sprint:@current/ })).toBeDefined()
  expect(await setup.find({ text: /last \d+ weeks/ })).toBeDefined()
  expect(await setup.find({ text: /^⚙ Worker on it · working \d+m$/ })).toBeDefined()
  await setup.unmount()
}

test('no number, link, count, badge or key hint splits across lines in the pane or the band, from 40 to 120 columns', async ($, on) => {
  await world($, on)
  const checks: string[] = []
  const check = async (what: string, mount: () => Promise<{ drawn: () => Promise<unknown>; unmount: () => Promise<void> }>, width: number) => {
    const ui = await mount()
    try {
      assertNoSplitAtoms(await ui.drawn(), width)
    } catch (cause) {
      checks.push(`${what}: ${(cause as Error).message}`)
    }
    await ui.unmount()
  }

  for (const width of WIDTHS) {
    await check('pane', () => $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(width) }), width)
    await check('band', () => $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...band(width) }), width)
  }
  // Each kind of band line was drawn.
  const wide = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...band(120) })
  for (const text of [/ ✗ CI /, / ◆ EPIC /, / ⚠ PROJECT /, / ✦ PLAN /, / ✚ INBOX /]) expect(await wide.find({ text })).toBeDefined()
  expect(await wide.find({ key: 'agent-row-agent-1' })).toBeDefined()
  await wide.unmount()
  expect(checks).toEqual([])
})

test("a pull request's row drops its parts in a set order, then shortens Finish & merge, so the title keeps its room", () => {
  const parts = { asked: 12, threads: 15, size: 10, issue: 7, merge: 12, review: 2 }
  // Room for everything: the title has the rest.
  expect(prRowRoom(160, 16, parts)).toEqual({ shown: { asked: true, threads: true, size: true, issue: true, merge: true, review: true }, finish: FINISH, title: 160 - 16 - 21 - 58 })
  // Narrower: the reviewers go first, then the threads, then the counts, then the linked issue.
  expect(prRowRoom(100, 16, parts).shown).toEqual({ asked: false, threads: true, size: true, issue: true, merge: true, review: true })
  expect(prRowRoom(90, 16, parts).shown).toEqual({ asked: false, threads: false, size: true, issue: true, merge: true, review: true })
  expect(prRowRoom(70, 16, parts).shown).toEqual({ asked: false, threads: false, size: false, issue: false, merge: true, review: true })
  // Narrowest: every part gone, and Finish & merge shortened to Merge.
  const narrow = prRowRoom(40, 16, parts)
  expect(narrow).toEqual({ shown: { asked: false, threads: false, size: false, issue: false, merge: false, review: false }, finish: FINISH_SHORT, title: 40 - 16 - 12 })
})

// The row Box of a PR's line, its two sides, and the parts on its left, as drawn.
type Drawn = { type: string; props: Record<string, unknown>; children?: unknown[] }
const kids = (node: unknown): Drawn[] => ((node as Drawn).children ?? []).filter((child): child is Drawn => typeof child === 'object' && child !== null)
const shown = (node: Drawn): string =>
  node.type === 'Button' ? String(node.props.label) : (node.children ?? []).map(child => (typeof child === 'string' ? child : shown(child as Drawn))).join('')

test("a pull request's row keeps its number, badge, linked issue and counts whole, and cuts the title, narrow and wide", async ($, on) => {
  await world($, on)
  const row = async (width: number) => {
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(width) })
    const line = kids(await ui.find({ key: 'pr-row-252' }))[0] as Drawn
    await ui.unmount()
    const [left, right] = kids(line) as [Drawn, Drawn]
    return { line, left, right, parts: kids(left), ends: kids(right) }
  }
  for (const width of [40, 120]) {
    const { line, left, right, parts, ends } = await row(width)
    // The left side gives way and the right keeps its width, with a cell between them.
    expect([line.props.gap, left.props.flexShrink, right.props.flexShrink]).toEqual([1, 1, 0])
    // Every part on the left but the title sits in a Box that doesn't shrink.
    expect(parts.map(part => (part.type === 'Box' ? `${shown(kids(part)[0] as Drawn)}:${String(part.props.flexShrink)}` : part.type))).toEqual(
      width === 40 ? [' ◷ CI :0', '#252:0', 'Button'] : [' ◷ CI :0', '#252:0', 'Button', '→ #302:0', '⚠ conflicts:0', 'asks @alice:0'],
    )
    // The title is cut with an ellipsis to the room the row leaves it.
    const title = String(parts[2]?.props.label)
    expect(title.endsWith('…')).toBe(true)
    expect(ends.map(shown)).toEqual(width === 40 ? [FINISH_SHORT] : ['+1104 −11', FINISH])
  }
})
