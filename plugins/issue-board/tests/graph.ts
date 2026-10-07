import type { On } from 'claude-code'

// The board reads open issues over GraphQL. The tests keep their issues the way `gh issue list --json` gives them; this
// turns them into the answer the board's query gets, with the repo's project when the test gives one.

type Raw = {
  number: number
  title: string
  url?: string
  labels: { name: string; color?: string }[]
  assignees?: { login: string }[] | null
  body: string | null
  updatedAt: string
  // What the project and GitHub hold beyond `gh issue list`.
  status?: string
  priority?: string
  parent?: { number: number; title: string; total: number; completed: number }
  blockedBy?: { number: number; state: string }[]
  prs?: number[]
  milestone?: string
  subIssues?: { total: number; completed: number }
  comments?: number
  // Its issue type, in a repo that has types.
  type?: string
}

const option = (prefix: string) => (name: string, index: number) => ({ id: `${prefix}${index}`, name })

export const STATUSES = ['Inbox', 'Backlog', 'Ready', 'In progress', 'Verification', 'Done']
export const PRIORITIES = ['P0', 'P1', 'P2']

// The Void Sector project's shape: Status and Priority, their options in the project's order.
export const PROJECT = {
  id: 'PVT_8',
  number: 8,
  title: 'Void Sector',
  url: 'https://github.com/users/astrosteveo/projects/8',
  closed: false,
  fields: {
    nodes: [
      { id: 'F_status', name: 'Status', dataType: 'SINGLE_SELECT', options: STATUSES.map(option('S')) },
      { id: 'F_priority', name: 'Priority', dataType: 'SINGLE_SELECT', options: PRIORITIES.map(option('P')) },
      // The fields beyond Status and Priority, one of each kind the board sets, and one it leaves to the issue.
      { id: 'F_estimate', name: 'Estimate', dataType: 'NUMBER' },
      { id: 'F_sprint', name: 'Sprint', dataType: 'ITERATION', configuration: { iterations: [{ id: 'IT1', title: 'Iteration 1' }, { id: 'IT2', title: 'Iteration 2' }] } },
      { id: 'F_due', name: 'Due', dataType: 'DATE' },
      { id: 'F_notes', name: 'Notes', dataType: 'TEXT' },
      { id: 'F_labels', name: 'Labels', dataType: 'LABELS' },
      {},
    ],
  },
}

// The option id the fake project gives a Status or Priority name.
export const optionId = (name: string): string => {
  const status = STATUSES.indexOf(name)
  return status >= 0 ? `S${status}` : `P${PRIORITIES.indexOf(name)}`
}

const node = (raw: Raw, project: boolean) => ({
  id: `I_${raw.number}`,
  number: raw.number,
  title: raw.title,
  url: raw.url ?? '',
  body: raw.body,
  updatedAt: raw.updatedAt,
  labels: { nodes: raw.labels },
  assignees: { nodes: raw.assignees ?? [] },
  milestone: raw.milestone ? { title: raw.milestone } : null,
  parent: raw.parent ? { number: raw.parent.number, title: raw.parent.title, subIssuesSummary: { total: raw.parent.total, completed: raw.parent.completed } } : null,
  subIssuesSummary: raw.subIssues ?? { total: 0, completed: 0 },
  blockedBy: { nodes: raw.blockedBy ?? [] },
  closedByPullRequestsReferences: { nodes: (raw.prs ?? []).map(number => ({ number })) },
  comments: { totalCount: raw.comments ?? 0 },
  issueType: raw.type ? { name: raw.type } : null,
  ...(project
    ? {
        projectItems: {
          nodes:
            raw.status || raw.priority
              ? [{ id: `PVTI_${raw.number}`, project: { id: PROJECT.id }, status: raw.status ? { name: raw.status } : null, priority: raw.priority ? { name: raw.priority } : null }]
              : [],
        },
      }
    : {}),
})

// Whether a gh call is the board's GraphQL read of the open issues, and whether it asks for the project.
export const isIssuesQuery = (argv: readonly string[]): boolean => argv[1] === 'api' && argv[2] === 'graphql' && argv.some(arg => arg.includes('issues(first: 100'))
export const asksProject = (argv: readonly string[]): boolean => argv.some(arg => arg.includes('projectsV2'))

// One page of the answer; the project only when the query asked for it and the test gives one.
export const graphPage = (issues: Raw[], argv: readonly string[] = [], project = false, types: string[] = []): string => {
  const withProject = project && asksProject(argv)
  return JSON.stringify({
    data: {
      rateLimit: { cost: 1, remaining: 4999, resetAt: '2026-10-04T11:00:00Z' },
      repository: {
        issueTypes: types.length > 0 ? { nodes: types.map(name => ({ name })) } : null,
        ...(withProject ? { projectsV2: { nodes: [PROJECT] } } : {}),
        issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: issues.map(raw => node(raw, withProject)) },
      },
    },
  })
}

// The board writes only to a project the person let it write to. A test that has it write to the fake project uses
// this store in place of `mock.store`: every repo's entry holds the adoption, unless the entry makes a choice of its own.
// The choices key is kept as set, so the board moves the repo entry's adoption across the first time it looks.
// A test's fake world and the test itself may both ask for it; the second call adds its entries to the first's store.
export const ADOPTED = { id: PROJECT.id, title: PROJECT.title, owner: 'astrosteveo' }
const stores = new WeakMap<On, Map<string, unknown>>()
export const adoptedStore = (on: On, entries: Readonly<Record<string, unknown>> = {}): Map<string, unknown> => {
  const had = stores.get(on)
  if (had) {
    for (const [key, value] of Object.entries(entries)) had.set(key, value)
    return had
  }
  const kept = new Map<string, unknown>(Object.entries(entries))
  stores.set(on, kept)
  on('store.get', async (_$, e) => {
    const value = kept.get(e.key)
    if (e.key.startsWith('choices:')) return { value }
    return { value: { adopted: ADOPTED, ...(value && typeof value === 'object' ? value : {}) } }
  })
  on('store.set', async (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', async (_$, e) => {
    kept.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', async () => ({ value: [...kept.keys()] }))
  return kept
}
