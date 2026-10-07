import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Issue } from '../types'
import { groupsOf } from '../hooks/filters'
import { parseGraph } from '../hooks/github'
import { placedAfter, projectMoveOf } from '../hooks/rest'
import { issuesQuery, orderFilter } from '../hooks/project'
import { letThrough } from './engine'
import { adoptedStore, fakeGitHub, json } from './github'
import { graphHas, graphPage, isIssuesQuery } from './graph'
import type { Raw } from './graph'
import { REFRESH, pane } from './ui'

const PANE = pane(120, 80)
const ASKED = ['gh', 'api', 'graphql', `query=${issuesQuery(true)}`]

const raw = (number: number, more: Partial<Raw> = {}): Raw => ({ number, title: `Issue ${number}`, labels: [], body: '', updatedAt: '2026-10-05T00:00:00Z', ...more })
const numbers = (issues: Issue[]) => issues.map(issue => issue.number)

test("the issues query reads the project's open issues from this repo in the project's own order", () => {
  const query = issuesQuery(true)
  expect(query).toContain('$order: String!')
  expect(query).toContain('order: items(first: 100, query: $order, orderBy: {field: POSITION, direction: ASC}) { nodes { id } }')
  // Without the project there is no order to read, and no variable for it.
  expect(issuesQuery(false)).not.toMatch(/\$order|order: items/)
  expect(orderFilter('astrosteveo', 'claude-plugins')).toBe('is:open is:issue repo:astrosteveo/claude-plugins')
})

test("rows in each group follow the project's order, ahead of priority and the board's own rules", () => {
  const page = graphPage(
    [
      raw(10, { status: 'Ready', priority: 'P0', position: 2 }),
      raw(11, { status: 'Ready', priority: 'P2', position: 0, labels: [{ name: 'area:board' }] }),
      raw(12, { status: 'Ready', priority: 'P1', position: 1, labels: [{ name: 'area:board' }] }),
      raw(13, { status: 'Backlog', position: 4 }),
      raw(14, { status: 'Backlog', position: 3 }),
    ],
    ASKED,
    true,
  )
  const { issues, project } = parseGraph([page])
  expect(issues.map(issue => [issue.number, issue.position])).toEqual([
    [10, 2],
    [11, 0],
    [12, 1],
    [13, 4],
    [14, 3],
  ])
  expect(groupsOf(issues, 'status', project).map(group => [group.title, numbers(group.issues)])).toEqual([
    ['Backlog', [14, 13]],
    ['Ready', [11, 12, 10]],
  ])
  expect(groupsOf(issues, 'area', project).map(group => [group.title, numbers(group.issues)])).toEqual([
    ['board', [11, 12]],
    ['other', [10, 14, 13]],
  ])
})

test("issues the project doesn't hold fall back to the board's order, after the ones it does", () => {
  const page = graphPage(
    [
      raw(20, { status: 'Ready', position: 1 }),
      raw(21, { status: 'Ready', position: 0 }),
      // Not in the project: the newest first, a bug before that.
      raw(22),
      raw(23),
      raw(24, { labels: [{ name: 'bug' }] }),
    ],
    ASKED,
    true,
  )
  const { issues, project } = parseGraph([page])
  expect(issues.filter(issue => issue.position === undefined).map(issue => issue.number)).toEqual([22, 23, 24])
  expect(groupsOf(issues, 'status', project).map(group => [group.title, numbers(group.issues)])).toEqual([
    ['Ready', [21, 20]],
    ['No status', [24, 23, 22]],
  ])
  expect(groupsOf(issues, 'epic', project).map(group => numbers(group.issues))).toEqual([[21, 20, 24, 23, 22]])

  // A board read without the project's order, as an older one or a token without read:project, keeps its own order.
  const unordered = parseGraph([graphPage([raw(20, { status: 'Ready', priority: 'P2', position: 1 }), raw(21, { status: 'Ready', priority: 'P0', position: 0 })], ['gh', 'api', 'graphql', 'query=projectsV2'], true)])
  expect(unordered.issues.map(issue => issue.position)).toEqual([undefined, undefined])
  expect(groupsOf(unordered.issues, 'status', unordered.project).map(group => numbers(group.issues))).toEqual([[21, 20]])
})

test("an epic's sub-issues keep the epic's order, not the project's", () => {
  const epic = { number: 30, title: 'Epic', total: 3, completed: 0 }
  const page = graphPage(
    [raw(30, { status: 'Ready', position: 0 }), raw(31, { status: 'Ready', parent: epic, position: 3 }), raw(32, { status: 'Ready', parent: epic, position: 2 }), raw(33, { status: 'Ready', parent: epic, position: 1 })],
    ASKED,
    true,
  )
  const { issues, project } = parseGraph([page])
  const subOrder = [31, 32, 33]
  const withOrder = issues.map(issue => (issue.number === 30 ? { ...issue, subOrder } : issue))
  expect(groupsOf(withOrder, 'epic', project).map(group => [group.title, numbers(group.issues)])).toEqual([['#30 Epic', [31, 32, 33]]])
})

test("a move in the project's order goes after an item; before one is after the item above it, and before the first is the top", () => {
  const issues = parseGraph([graphPage([raw(40, { status: 'Ready', position: 0 }), raw(41, { status: 'Ready', position: 1 }), raw(42, { status: 'Ready', position: 2 }), raw(43)], ASKED, true)]).issues
  expect(projectMoveOf(issues, 40, 42, false)).toEqual({ item: 'PVTI_40', after: { number: 42, item: 'PVTI_42' } })
  expect(projectMoveOf(issues, 42, 41, true)).toEqual({ item: 'PVTI_42', after: { number: 40, item: 'PVTI_40' } })
  expect(projectMoveOf(issues, 42, 40, true)).toEqual({ item: 'PVTI_42', after: null })
  expect(projectMoveOf(issues, 41, null, false)).toEqual({ item: 'PVTI_41', after: null })
  expect(projectMoveOf(issues, 43, 40, false)).toBe("#43 isn't in the project yet; set its Status first")
  expect(projectMoveOf(issues, 40, 43, false)).toBe("#43 isn't an open issue the board has in the project's order")
  expect(projectMoveOf(issues, 40, 40, false)).toBe("#40 can't move beside itself")
  expect(projectMoveOf(issues, 99, 40, false)).toBe("#99 isn't an open issue on the board")

  expect(placedAfter(issues, 40, 42).map(issue => [issue.number, issue.position])).toEqual([
    [40, 2],
    [41, 0],
    [42, 1],
    [43, undefined],
  ])
  expect(placedAfter(issues, 42, null).map(issue => issue.position)).toEqual([1, 2, 0, undefined])
})

// GitHub with the project, whose order a move changes: the mutations sent, and the order the next read answers.
const github = (on: On) => {
  adoptedStore(on)
  letThrough(on)
  on('session.root', async () => ({ value: '/work/void-sector' }))
  // Ready issues #50 to #52, at their places in `order`.
  const inOrder = (order: number[]) => [50, 51, 52].map(number => raw(number, { status: 'Ready', priority: 'P1', position: order.indexOf(number) }))
  const state = { order: [50, 51, 52], mutations: [] as Record<string, unknown>[] }
  const gh = fakeGitHub(on, {
    repo: 'astrosteveo/claude-plugins',
    issues: inOrder(state.order),
    project: true,
    routes: [
      ({ argv, stdin }) => {
        if (!graphHas(argv, stdin, 'updateProjectV2ItemPosition')) return undefined
        const sent = JSON.parse(stdin ?? '{}') as { variables: { item: string; after: string | null } }
        state.mutations.push(sent.variables)
        const moved = Number(sent.variables.item.replace('PVTI_', ''))
        const rest = state.order.filter(one => one !== moved)
        const at = sent.variables.after === null ? 0 : rest.indexOf(Number(sent.variables.after.replace('PVTI_', ''))) + 1
        state.order = [...rest.slice(0, at), moved, ...rest.slice(at)]
        gh.issues = inOrder(state.order)
        return json({ data: { updateProjectV2ItemPosition: { clientMutationId: null } } })
      },
    ],
  })
  // The filter each issues query read the project's order with.
  const filters = () => gh.ran.filter(call => isIssuesQuery(call.argv)).flatMap(call => call.argv.filter(arg => arg.startsWith('order=')).map(arg => arg.slice('order='.length)))
  return Object.assign(state, { filters })
}

test("moving an issue in the project's order writes the move and the pane shows the new order", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') })
  const gh = github(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  expect(gh.filters().at(-1)).toBe('is:open is:issue repo:astrosteveo/claude-plugins')
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'group-status' })
  const rows = async () => (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => /^issue-5\d$/.test(key))
  expect(await rows()).toEqual(['issue-50', 'issue-51', 'issue-52'])

  const moved = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 50, projectAfter: 52 })
  expect(String(moved.result)).toBe("#50 moved after #52 in the project's order.")
  expect(gh.mutations).toEqual([{ project: 'PVT_8', item: 'PVTI_50', after: 'PVTI_52' }])
  await clock.settle()
  expect(await rows()).toEqual(['issue-51', 'issue-52', 'issue-50'])

  const top = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 52, projectAfter: 0 })
  expect(String(top.result)).toBe("#52 moved to the top of the project's order.")
  expect(gh.mutations.at(-1)).toEqual({ project: 'PVT_8', item: 'PVTI_52', after: null })
  await clock.settle()
  expect(await rows()).toEqual(['issue-52', 'issue-51', 'issue-50'])
  await ui.unmount()
})
