
// The board reads open issues over GraphQL. The tests keep their issues the way `gh issue list --json` gives them; this
// turns them into the answer the board's query gets, with the repo's project when the test gives one.

export type Raw = {
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
  // Its values in other project fields, by field name, for the views that filter or group by them.
  fields?: Record<string, string>
  // Its item's place in the project's own order, 0 first. An issue with one is in the project.
  position?: number
}

// A project view as GitHub answers it, and the project's extra fields a test adds for its views.
export type RawView = { name: string; number: number; layout: 'TABLE_LAYOUT' | 'BOARD_LAYOUT' | 'ROADMAP_LAYOUT'; filter: string | null; groupBy?: string; columns?: string }
export type Views = { views?: RawView[]; fields?: { id: string; name: string; dataType: string; options?: { id: string; name: string }[]; configuration?: { iterations?: RawIteration[]; completedIterations?: RawIteration[] } }[] }
// An iteration as GitHub answers it, with the day it starts and how many days it lasts.
export type RawIteration = { id: string; title: string; startDate: string; duration: number }

// The extra field values the query asks each item for, by alias: `f0` is the first field named, and so on.
const aliasesOf = (argv: readonly string[]): [string, string][] => {
  const query = argv.find(arg => arg.startsWith('query=')) ?? ''
  return [...query.matchAll(/(f\d+): fieldValueByName\(name: ("(?:[^"\\]|\\.)*")\)/g)].map(found => [found[1] ?? '', JSON.parse(found[2] ?? '""') as string])
}

const viewNode = (view: RawView) => ({
  name: view.name,
  number: view.number,
  layout: view.layout,
  filter: view.filter,
  groupByFields: { nodes: view.groupBy ? [{ name: view.groupBy }] : [] },
  verticalGroupByFields: { nodes: view.columns ? [{ name: view.columns }] : [] },
})

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

const node = (raw: Raw, project: boolean, aliases: [string, string][] = []) => ({
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
            raw.status || raw.priority || raw.fields || raw.position !== undefined
              ? [
                  {
                    id: `PVTI_${raw.number}`,
                    project: { id: PROJECT.id },
                    status: raw.status ? { name: raw.status } : null,
                    priority: raw.priority ? { name: raw.priority } : null,
                    ...Object.fromEntries(aliases.map(([alias, name]) => [alias, raw.fields?.[name] ? { name: raw.fields[name] } : null])),
                  },
                ]
              : [],
        },
      }
    : {}),
})

// Whether a gh call is the board's GraphQL read of the open issues, and whether it asks for the project.
export const isIssuesQuery = (argv: readonly string[]): boolean => argv[1] === 'api' && argv[2] === 'graphql' && argv.some(arg => arg.includes('issues(first: 100'))
export const asksProject = (argv: readonly string[]): boolean => argv.some(arg => arg.includes('projectsV2'))

// What a GraphQL call asks: its query and its variables by name, each as text. The board sends a query with variables
// as JSON on stdin; its fixed reads, the issues pages and the review threads, go as gh's `-f name=value` fields.
export const graphArgs = (argv: readonly string[], stdin?: string): Record<string, string> => {
  const fields = Object.fromEntries(argv.flatMap((arg, index) => (argv[index - 1] === '-f' ? [arg.split(/=(.*)/s).slice(0, 2) as [string, string]] : [])))
  if (!argv.includes('--input') || !stdin) return fields
  const asked = JSON.parse(stdin) as { query?: string; variables?: Record<string, unknown> }
  const variables = Object.entries(asked.variables ?? {}).map(([name, value]) => [name, typeof value === 'string' ? value : JSON.stringify(value)] as const)
  return { ...fields, query: asked.query ?? '', ...Object.fromEntries(variables) }
}

// Whether a gh call is GraphQL whose query or variables hold `text`, as fields or on stdin.
export const graphHas = (argv: readonly string[], stdin: string | undefined, text: string): boolean =>
  argv.includes('graphql') && (argv.some(arg => arg.includes(text)) || (stdin ?? '').includes(text))

// One variable of a GraphQL call a test kept, as `name=value`, the way a list of what was sent shows it.
export const graphArg = (call: { argv: readonly string[]; stdin?: string }, name: string): string | undefined => {
  const value = graphArgs(call.argv, call.stdin)[name]
  return value === undefined ? undefined : `${name}=${value}`
}

// Whether a gh call adds an item to the project or sets a single-select option, Status or Priority: the writes the
// tests answer by their variables, apart from the board's other GraphQL.
export const isItemWrite = (argv: readonly string[], stdin?: string): boolean =>
  graphHas(argv, stdin, 'singleSelectOptionId') || graphHas(argv, stdin, 'addProjectV2ItemById')

// Whether a gh call a test kept is a GraphQL mutation.
export const isGraphMutation = (call: { argv: readonly string[]; stdin?: string }): boolean =>
  call.argv.includes('graphql') && /^\s*mutation\b/.test(graphArgs(call.argv, call.stdin).query ?? '')

// One page of the answer; the project only when the query asked for it and the test gives one.
// `labels` are the repo's labels; left out, the answer has none, as before the board read them.
export const graphPage = (issues: Raw[], argv: readonly string[] = [], project = false, types: string[] = [], views: Views = {}, labels?: string[]): string => {
  const withProject = project && asksProject(argv)
  const aliases = aliasesOf(argv)
  // The project's open issues in its own order, when the query asks for the order.
  const ordered = issues.filter(raw => raw.position !== undefined).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const order = argv.some(arg => arg.includes('order: items(')) ? { order: { nodes: ordered.map(raw => ({ id: `PVTI_${raw.number}` })) } } : {}
  const linked = { ...PROJECT, fields: { nodes: [...PROJECT.fields.nodes, ...(views.fields ?? [])] }, views: { nodes: (views.views ?? []).map(viewNode) }, ...order }
  return JSON.stringify({
    data: {
      rateLimit: { cost: 1, remaining: 4999, resetAt: '2026-10-04T11:00:00Z' },
      repository: {
        issueTypes: types.length > 0 ? { nodes: types.map(name => ({ name })) } : null,
        ...(labels ? { labels: { nodes: labels.map(name => ({ name })) } } : {}),
        ...(withProject ? { projectsV2: { nodes: [linked] } } : {}),
        issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: issues.map(raw => node(raw, withProject, aliases)) },
      },
    },
  })
}

