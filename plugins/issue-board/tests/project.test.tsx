import { expect, test } from 'claude-code/testing'

import { groupsOf, matches, nextPageOf, parseGraph } from '../hooks/parse'
import { issuesQuery, priorityRank, startedOf } from '../hooks/project'
import { graphPage } from './graph'

const ASKED = ['gh', 'api', 'graphql', `query=${issuesQuery(true)}`]

test('one query reads each issue with its Status, Priority, epic, sub-issues, blockers, pull requests and milestone', () => {
  expect(issuesQuery(true)).toMatch(/projectsV2.*issues\(first: 100.*milestone.*parent.*subIssuesSummary.*blockedBy.*closedByPullRequestsReferences.*projectItems/s)
  expect(issuesQuery(false)).not.toMatch(/projectsV2|projectItems/)

  const page = graphPage(
    [
      {
        number: 301,
        title: 'Cruise between local spaces',
        labels: [{ name: 'area:simulation', color: '0e8a16' }],
        body: '- [ ] Cruise drive',
        updatedAt: '2026-10-03T20:00:00Z',
        status: 'Backlog',
        priority: 'P2',
        milestone: 'Launch',
        parent: { number: 299, title: 'Make space feel vast', total: 8, completed: 2 },
        blockedBy: [
          { number: 300, state: 'OPEN' },
          { number: 298, state: 'CLOSED' },
        ],
        prs: [345],
      },
      { number: 302, title: 'Pirates in cruise', labels: [], body: null, updatedAt: '2026-10-03T20:00:00Z' },
    ],
    ASKED,
    true,
  )
  const { issues, project } = parseGraph([page])
  expect(nextPageOf(page)).toBeNull()
  expect(project).toMatchObject({ id: 'PVT_8', number: 8, title: 'Void Sector', status: { id: 'F_status' }, priority: { id: 'F_priority' } })
  expect(startedOf(project)).toEqual({ id: 'S3', name: 'In progress' })
  expect(issues[0]).toMatchObject({
    id: 'I_301',
    item: 'PVTI_301',
    status: 'Backlog',
    priority: 'P2',
    milestone: 'Launch',
    parent: { number: 299, title: 'Make space feel vast', total: 8, completed: 2 },
    // Only the blockers still open.
    blockedBy: [300],
    prs: [345],
    checks: [{ done: false, text: 'Cruise drive' }],
  })
  // An issue not in the project has no item to set fields on yet.
  expect(issues[1]).toMatchObject({ item: null, status: null, priority: null, parent: null })

  // Later is P2 and on; Now is P0 and P1; an issue without a priority is neither.
  expect(matches('future', issues[0]!, null, project)).toBe(true)
  expect(matches('active', issues[1]!, null, project)).toBe(false)
  expect(matches('future', issues[1]!, null, project)).toBe(false)
  expect([priorityRank(project, 'P0'), priorityRank(project, 'P2'), priorityRank(null, 'P1'), priorityRank(project, null)]).toEqual([0, 2, 1, Number.POSITIVE_INFINITY])

  // Epic groups sub-issues under their parent with its count of closed sub-issues; the rest under No epic.
  expect(groupsOf(issues, 'epic', project).map(group => [group.title, group.epic, group.issues.map(issue => issue.number)])).toEqual([
    ['#299 Make space feel vast', { total: 8, completed: 2 }, [301]],
    ['No epic', undefined, [302]],
  ])
  // Status groups in the project's order, Backlog folded, the unplanned under No status.
  expect(groupsOf(issues, 'status', project).map(group => [group.title, group.folded])).toEqual([
    ['Backlog', true],
    ['No status', false],
  ])
})

test('read without the project, the issues have no Status or Priority and the board works from labels', () => {
  const { issues, project } = parseGraph([graphPage([{ number: 301, title: 'Cruise', labels: [{ name: 'future', color: '' }], body: null, updatedAt: '' }], ['gh', 'api', 'graphql', `query=${issuesQuery(false)}`], true)])
  expect(project).toBeNull()
  expect(issues[0]).toMatchObject({ item: null, status: null, priority: null })
  expect(matches('future', issues[0]!, null, project)).toBe(true)
  expect(groupsOf(issues, 'status', project).map(group => group.title)).toEqual(['other'])
})

test('with several projects linked, the board reads the one setup saved while it is still open', () => {
  const page = (closed: boolean) =>
    JSON.stringify({
      data: {
        repository: {
          projectsV2: {
            nodes: [
              { id: 'PVT_8', number: 8, title: 'Void Sector', url: '', closed: false, fields: { nodes: [] } },
              { id: 'PVT_9', number: 9, title: 'Roadmap', url: '', closed, fields: { nodes: [] } },
            ],
          },
          issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
        },
      },
    })
  expect(parseGraph([page(false)]).project?.number).toBe(8)
  expect(parseGraph([page(false)], 'PVT_9').project?.number).toBe(9)
  expect(parseGraph([page(true)], 'PVT_9').project?.number).toBe(8)
})
