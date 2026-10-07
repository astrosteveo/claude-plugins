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
  // Its values in other project fields, by field name, for the views that filter or group by them.
  fields?: Record<string, string>
  // Its item's place in the project's own order, 0 first. An issue with one is in the project.
  position?: number
}

// A project view as GitHub answers it, and the project's extra fields a test adds for its views.
export type RawView = { name: string; number: number; layout: 'TABLE_LAYOUT' | 'BOARD_LAYOUT' | 'ROADMAP_LAYOUT'; filter: string | null; groupBy?: string; columns?: string }
export type Views = { views?: RawView[]; fields?: { id: string; name: string; dataType: string; options?: { id: string; name: string }[] }[] }

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

// The board writes only to a project the writeProjects setting lists. A test that has it write to the fake project
// uses this store in place of `mock.store`: the person's own settings list the fake project, until the board writes the
// setting, after which they hold what it wrote, as Claude Code's would. A test's fake world and the test itself may both
// ask for it; the second call adds its entries to the first's store.
export const ADOPTED = { id: PROJECT.id, title: PROJECT.title, owner: 'astrosteveo' }
const ADOPTED_KEY = 'astrosteveo/8'

// Every `$.config.set` the board made, answered as written, as Claude Code's settings would.
const logs = new WeakMap<On, { key: string; value: unknown }[]>()
export const settingsLog = (on: On): { key: string; value: unknown }[] => {
  const had = logs.get(on)
  if (had) return had
  const log: { key: string; value: unknown }[] = []
  logs.set(on, log)
  on('config.set', async (_$, e) => {
    log.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  return log
}

const stores = new WeakMap<On, Map<string, unknown>>()
export const adoptedStore = (on: On, entries: Readonly<Record<string, unknown>> = {}): Map<string, unknown> => {
  const had = stores.get(on)
  if (had) {
    for (const [key, value] of Object.entries(entries)) had.set(key, value)
    return had
  }
  const kept = new Map<string, unknown>(Object.entries(entries))
  stores.set(on, kept)
  const set = settingsLog(on)
  on('settings.read', async (_$, e) => {
    if (e.source !== 'user') return { value: {} }
    const written = set.filter(one => one.key === 'issue-board.writeProjects').at(-1)?.value
    return { value: { pluginConfigs: { 'issue-board@astrosteveo-plugins': { options: { writeProjects: written ?? ADOPTED_KEY } } } } }
  })
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
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
