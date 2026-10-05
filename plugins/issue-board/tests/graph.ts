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
      { id: 'F_status', name: 'Status', options: STATUSES.map(option('S')) },
      { id: 'F_priority', name: 'Priority', options: PRIORITIES.map(option('P')) },
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
export const graphPage = (issues: Raw[], argv: readonly string[] = [], project = false): string => {
  const withProject = project && asksProject(argv)
  return JSON.stringify({
    data: {
      repository: {
        ...(withProject ? { projectsV2: { nodes: [PROJECT] } } : {}),
        issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: issues.map(raw => node(raw, withProject)) },
      },
    },
  })
}
