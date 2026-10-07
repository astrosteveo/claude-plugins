import type { Adopted, Field, Issue, Project, Role, Roles } from '../types'

// A view's grouping field: the rows' groups on a table, the columns on a board.
const GROUP_FIELD = '(first: 1) { nodes { ... on ProjectV2FieldCommon { name } } }'
// The project's views in the order GitHub shows them, which become the pane's tabs.
const VIEWS = `views(first: 20, orderBy: {field: POSITION, direction: ASC}) { nodes { name number layout filter groupByFields${GROUP_FIELD} verticalGroupByFields${GROUP_FIELD} } }`

// The repo's projects with their fields and views, which needs gh to have the read:project permission. A field's kind
// and its options or iterations are the project's, not each issue's, so reading them costs little; so do the views.
const PROJECTS =
  'projectsV2(first: 5) { nodes { id number title url closed fields(first: 30) { nodes { ' +
  '... on ProjectV2Field { id name dataType } ' +
  '... on ProjectV2SingleSelectField { id name dataType options { id name } } ' +
  '... on ProjectV2IterationField { id name dataType configuration { iterations { id title } } } } } ' +
  `statusUpdates(last: 1) { nodes { status body createdAt startDate targetDate } } workflows(first: 20) { nodes { name enabled } } ${VIEWS} } }`
// A field's value on an item, whatever the field's kind.
const ANY_VALUE =
  '{ ... on ProjectV2ItemFieldSingleSelectValue { name } ... on ProjectV2ItemFieldIterationValue { title } ... on ProjectV2ItemFieldTextValue { text } ' +
  '... on ProjectV2ItemFieldNumberValue { number } ... on ProjectV2ItemFieldDateValue { date } }'
// Each issue's items in those projects, with the Status and Priority set on them, and the other fields named in
// `fields` as `f0`, `f1`…: the fields the project's views filter or group by. One value by name costs no more than
// Status does, where reading every field of every item would multiply the read's cost.
const itemsOf = (fields: readonly string[]): string =>
  'projectItems(first: 10) { nodes { id project { id } ' +
  'status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } ' +
  'priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } } ' +
  fields.map((name, index) => `f${index}: fieldValueByName(name: ${JSON.stringify(name)}) ${ANY_VALUE} `).join('') +
  '} }'

// The open issues as the board reads them, 100 a page, newest change first; with the project's fields and views and each
// issue's item when `withProject`, which a token without read:project would have GitHub refuse. `fields` are the extra
// field values to read on each item, in the order the answer's `f0`, `f1`… follow.
export const issuesQuery = (withProject: boolean, fields: readonly string[] = []): string =>
  [
    'query($owner: String!, $name: String!, $after: String) { rateLimit { cost remaining resetAt } repository(owner: $owner, name: $name) {',
    'issueTypes(first: 20) { nodes { name } }',
    withProject ? PROJECTS : '',
    'issues(first: 100, states: OPEN, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {',
    'pageInfo { hasNextPage endCursor }',
    'nodes { id number title url body updatedAt',
    'labels(first: 20) { nodes { name color } } assignees(first: 10) { nodes { login } } milestone { title }',
    'parent { number title subIssuesSummary { total completed } } subIssuesSummary { total completed } issueType { name }',
    'blockedBy(first: 10) { nodes { number state } }',
    'closedByPullRequestsReferences(first: 5, includeClosedPrs: false) { nodes { number } }',
    'comments { totalCount }',
    withProject ? itemsOf(fields) : '',
    '} } } }',
  ]
    .filter(Boolean)
    .join(' ')

// One item's values for every field, read when an issue's card opens or a tool asks: reading them for every issue on
// each read would multiply the board's cost.
export const ITEM_VALUES =
  'query($item: ID!) { node(id: $item) { ... on ProjectV2Item { fieldValues(first: 30) { nodes { ' +
  '... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } } ' +
  '... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } } ' +
  '... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } } ' +
  '... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } } ' +
  '... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } } } }'

// Sets any field on an item, with the value as the field's kind takes it; and clears one.
export const SET_VALUE =
  'mutation($project: ID!, $item: ID!, $field: ID!, $value: ProjectV2FieldValue!) { updateProjectV2ItemFieldValue(input: ' +
  '{projectId: $project, itemId: $item, fieldId: $field, value: $value}) { projectV2Item { id } } }'
export const CLEAR_VALUE =
  'mutation($project: ID!, $item: ID!, $field: ID!) { clearProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field}) { projectV2Item { id } } }'

// Posts a status update on a project.
export const POST_STATUS =
  'mutation($project: ID!, $status: ProjectV2StatusUpdateStatus!, $body: String, $start: Date, $target: Date) { createProjectV2StatusUpdate(input: ' +
  '{projectId: $project, status: $status, body: $body, startDate: $start, targetDate: $target}) { statusUpdate { id createdAt } } }'

// An issue's items in the projects it is in, to find the one a project's own auto-add made.
export const ISSUE_ITEMS = 'query($issue: ID!) { node(id: $issue) { ... on Issue { projectItems(first: 20) { nodes { id project { id } } } } } }'

// Archives an item: it leaves the project's views, and the issue stays as it is.
export const ARCHIVE_ITEM = 'mutation($project: ID!, $item: ID!) { archiveProjectV2Item(input: {projectId: $project, itemId: $item}) { item { id } } }'

// Sets a single-select field, such as Status, on an issue's item in a project.
export const SET_FIELD =
  'mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: ' +
  '{projectId: $project, itemId: $item, fieldId: $field, value: {singleSelectOptionId: $option}}) { projectV2Item { id } } }'

// Adds an issue to a project, for an issue the project doesn't hold yet; answers the new item's id.
export const ADD_ITEM = 'mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: {projectId: $project, contentId: $content}) { item { id } } }'

// A field's option by name, ignoring case: what a pick or Start sets.
export const optionOf = (field: Field | null | undefined, name: string): { id: string; name: string } | undefined =>
  field?.options.find(option => option.name.toLowerCase() === name.toLowerCase())

// The board's own name for each role: what setup suggests, and the first name each role goes by.
export const ROLE_NAMES: Record<Role, string> = { inbox: 'Inbox', ready: 'Ready', backlog: 'Backlog', started: 'In progress', verification: 'Verification', done: 'Done' }
export const ROLE_ORDER: Role[] = ['inbox', 'ready', 'backlog', 'started', 'verification', 'done']

// The names each role goes by in projects the board didn't set up, the board's own first, then the most common. A
// project that says `Todo`, `Doing` and `Shipped` works without setup.
export const COMMON_NAMES: Record<Role, string[]> = {
  inbox: ['Inbox', 'Triage', 'New'],
  ready: ['Ready', 'Todo', 'To do', 'Up next'],
  backlog: ['Backlog', 'Icebox', 'Later'],
  started: ['In progress', 'Doing', 'Active', 'Started'],
  verification: ['Verification', 'In review', 'Review', 'QA', 'Testing'],
  done: ['Done', 'Shipped', 'Closed', 'Complete', 'Completed'],
}

const named = (option: { name: string }, name: string): boolean => option.name.trim().toLowerCase() === name.toLowerCase()

// Which option has each role by its name, whatever its case. Every role tries the board's own name before any role
// tries a common one, then the common names go in the list's order, so `Ready` beats `Todo`, and `Todo` beats `Up
// next`. An option that took a role is out for the rest: no option plays two parts.
export const rolesByName = (options: readonly { id?: string; name: string }[]): Roles => {
  const roles: Roles = {}
  const taken = new Set<string>()
  const longest = Math.max(...ROLE_ORDER.map(role => COMMON_NAMES[role].length))
  for (let rank = 0; rank < longest; rank += 1) {
    for (const role of ROLE_ORDER) {
      const name = COMMON_NAMES[role][rank]
      if (roles[role] || name === undefined) continue
      const option = options.find(one => one.id && !taken.has(one.id) && named(one, name))
      if (!option?.id) continue
      roles[role] = option.id
      taken.add(option.id)
    }
  }
  return roles
}

// The roles the board goes by for a project: the ones saved for it, by setup or /issues statuses, kept to options it
// still has, or else the names.
export const rolesFor = (status: Field | null, saved: Roles | undefined): Roles => {
  if (!status) return {}
  if (!saved) return rolesByName(status.options)
  return Object.fromEntries(Object.entries(saved).filter(([, id]) => status.options.some(option => option.id === id))) as Roles
}

// The Status option that has a role in the project, if one does. An older board without roles goes by the names.
export const roleOf = (project: Project | null | undefined, role: Role): { id: string; name: string } | undefined => {
  const status = project?.status
  if (!status) return undefined
  const id = (project.roles ?? rolesByName(status.options))[role]
  return id ? status.options.find(option => option.id === id) : undefined
}

// The roles the board guessed from a common name rather than its own, for a project with no saved mapping: what the
// band asks the person to confirm. Empty when nothing is a guess.
export const guessOf = (project: Project | null | undefined): { role: Role; name: string }[] => {
  if (!project?.guessed) return []
  return ROLE_ORDER.flatMap(role => {
    const option = roleOf(project, role)
    return option && !named(option, ROLE_NAMES[role]) ? [{ role, name: option.name }] : []
  })
}

// The guess as a line: `Status: Todo is Ready, Doing is In progress, Shipped is Done`.
export const guessText = (guess: readonly { role: Role; name: string }[]): string => `Status: ${guess.map(one => `${one.name} is ${ROLE_NAMES[one.role]}`).join(', ')}`

// What tells one guess from another, so a guess the person answered stays answered, and a new one asks again.
export const guessKey = (project: { id: string }, guess: readonly { role: Role; name: string }[]): string => `${project.id}:${guess.map(one => `${one.role}=${one.name}`).join(',')}`

// The mapping saved for a project: setup's when setup saved one for it, else the one /issues statuses or Looks right
// saved. Undefined when neither did, and the names count.
export const savedRolesOf = (
  saved: { setup?: { project: { id: string }; status: { roles: Roles } | null }; statuses?: Record<string, Roles> } | null | undefined,
  project: string,
): Roles | undefined => {
  if (saved?.setup?.status && saved.setup.project.id === project) return saved.setup.status.roles
  return saved?.statuses?.[project]
}

// Whether a Status name is the option with a role.
export const isRole = (project: Project | null | undefined, status: string | null | undefined, role: Role): boolean =>
  !!status && roleOf(project, role)?.name === status

// The Status option Start moves an issue to.
export const startedOf = (project: Project | null | undefined): { id: string; name: string } | undefined => roleOf(project, 'started')

const UNSET = Number.POSITIVE_INFINITY

// How pressing an issue's priority is: its place among the project's Priority options, 0 first; for a name the
// project doesn't list, the number in `P2`; unset sorts last.
export const priorityRank = (project: Project | null | undefined, priority: string | null | undefined): number => {
  if (!priority) return UNSET
  const index = project?.priority?.options.findIndex(option => option.name === priority) ?? -1
  if (index >= 0) return index
  const named = /^P(\d+)$/i.exec(priority)
  return named ? Number(named[1]) : 2
}

// How many of the first priorities are Now: the setting, or two (P0 and P1).
export const nowCountOf = (project: Project | null | undefined): number => project?.nowCount ?? 2

// The Priority options that are Now and the ones that are Later, by name.
export const nowNames = (project: Project | null | undefined): { now: string[]; later: string[] } => {
  const names = project?.priority?.options.map(option => option.name) ?? []
  return { now: names.slice(0, nowCountOf(project)), later: names.slice(nowCountOf(project)) }
}

// Now is the first priorities, two unless set otherwise, Later the rest; an issue with none is neither.
export const isNow = (project: Project | null | undefined, issue: Issue): boolean => priorityRank(project, issue.priority) < nowCountOf(project)
export const isLater = (project: Project | null | undefined, issue: Issue): boolean => {
  const rank = priorityRank(project, issue.priority)
  return rank >= nowCountOf(project) && rank !== UNSET
}

// The login or organization a project belongs to, from its page: `github.com/users/<login>/projects/8` or the `orgs/` one.
export const ownerOf = (url: string): string | null => /github\.com\/(?:users|orgs)\/([^/]+)\/projects\//.exec(url)?.[1] ?? null

// A project as the writeProjects setting names it: owner/number, such as astrosteveo/9, the same in every repo. GitHub
// logins aren't case sensitive, so the owner is kept in lower case.
export const projectKey = (owner: string, number: number): string => `${owner.toLowerCase()}/${number}`

// A project's key, from its page; null when the page doesn't say who owns it.
export const projectKeyOf = (project: { number: number; url: string }): string | null => {
  const owner = ownerOf(project.url)
  return owner ? projectKey(owner, project.number) : null
}

// The writeProjects setting as project keys, each once. An entry that isn't owner/number is left out. A plain string,
// as a hand-written setting might hold, is read as entries split by commas or spaces.
export const projectKeysOf = (value: unknown): string[] => {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : []
  const keys = entries.flatMap(entry => {
    const found = typeof entry === 'string' ? /^([A-Za-z0-9][A-Za-z0-9-]*)\/([1-9]\d*)$/.exec(entry.trim()) : null
    return found ? [projectKey(found[1] ?? '', Number(found[2]))] : []
  })
  return keys.filter((key, index) => keys.indexOf(key) === index)
}

// The project an adoption an earlier board kept in the store stands for, as a key to add to writeProjects once. The
// store kept the project's id, so the owner and number come from the projects the board has read (`known`). null:
// there is nothing to move (a release, nothing saved, or none of the projects read is it). undefined: the board can't
// tell until it has read a project. A repo saved before adopting existed, whose setup names a project, has that project
// adopted: the person picked it in setup and pressed Apply.
export const savedAdoptionOf = (
  saved: { adopted?: { id: string } | null; setup?: { project: { id: string } } },
  known: readonly { id: string; number: number; url: string }[],
): string | null | undefined => {
  if (saved.adopted === null) return null
  const id = saved.adopted?.id ?? saved.setup?.project.id
  if (id === undefined) return null
  const found = known.find(one => one.id === id)
  if (found) return projectKeyOf(found)
  return known.length > 0 ? null : undefined
}

// How to let the board write to a project, for a refusal to say.
const HOW_TO_ADOPT = 'press Let it write where the issues pane or the band asks, or run /issues setup, pick the project and press Apply'

// Why the board won't write to a project, or null when it may: the one rule every project write is held to. The board
// writes only to a project the writeProjects setting lists, by owner/number. Every target is the project the board
// reads for the repo or one linked to it, so a project listed for another repo gets nothing here unless this repo uses
// it too. `new` is setup creating a project, which can't touch one the person already has; setup adopts the new one
// straight after.
export const writeRefusal = (allowed: readonly string[], target: { number: number; title: string; url: string } | 'new'): string | null => {
  if (target === 'new') return null
  const key = projectKeyOf(target)
  if (key && allowed.includes(key)) return null
  return `The issue board only reads ${target.title}: nobody has let it write there. To let it, ${HOW_TO_ADOPT}.`
}

// Whether a gh call is a GraphQL mutation: the query given as a field, or in the JSON sent on stdin. Every project write
// is one, and the board sends none but through its project write check.
export const isMutation = (args: readonly string[], stdin?: string): boolean => {
  if (!args.includes('graphql')) return false
  const mutation = (query: unknown) => typeof query === 'string' && /^\s*mutation\b/.test(query)
  if (args.some(arg => arg.startsWith('query=') && mutation(arg.slice('query='.length)))) return true
  if (stdin === undefined) return false
  try {
    return mutation((JSON.parse(stdin) as { query?: unknown }).query)
  } catch {
    return /\bmutation\b/.test(stdin)
  }
}

// What the board asks before it writes to a project: the project and its owner, what it would write, and what that
// costs. `refresh` is how often the board reads GitHub, in minutes; null when it reads only when asked.
export const adoptText = (project: { title: string; url: string }, refresh: number | null): { title: string; lines: string[] } => {
  const owner = ownerOf(project.url)
  return {
    title: `Let the board write to ${project.title}${owner ? `, owned by ${owner}` : ''}?`,
    lines: [
      'Until you say yes, the board only reads it.',
      'Once you do, it sets Status and Priority, adds issues as items, archives items when asked, and posts status updates, as your settings and presses call for.',
      `Each write is a GitHub API call made with your gh token. The board reads GitHub ${refresh === null ? 'only when you refresh' : `every ${refresh} minutes`} (the refresh setting).`,
    ],
  }
}

// The repo's linked projects, for the project_adopt tool to find one named by number.
export const LINKED_QUERY =
  'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { projectsV2(first: 20) { nodes { id number title url closed } } } }'

// A project as project_adopt picks it: enough to adopt it and to word the warning.
export type Linked = { id: string; number: number; title: string; url: string }

// The open projects in the linked-projects query's answer.
export const linkedOf = (data: unknown): Linked[] => {
  type Raw = Linked & { closed?: boolean }
  const nodes = (data as { repository?: { projectsV2?: { nodes?: (Raw | null)[] | null } | null } | null } | null)?.repository?.projectsV2?.nodes ?? []
  return nodes.filter((one): one is Raw => !!one && !one.closed).map(({ id, number, title, url }) => ({ id, number, title, url }))
}

// The project project_adopt may adopt, or why not: the one the board reads for the repo, or one linked to the repo and
// named by number. Any other is refused, so Claude can't point the board at a project the repo has nothing to do with.
// `linked` is only needed for a number the board's own project doesn't have.
export const adoptTarget = (reads: Linked | null, linked: Linked[], number: number | undefined, repo: string): Linked | string => {
  if (number === undefined) return reads ?? `The board reads no project for ${repo}. Name a project linked to the repo by its number, or run /issues setup.`
  if (reads?.number === number) return reads
  return linked.find(one => one.number === number) ?? `Project ${number} isn't linked to ${repo}, so the board won't write to it. Link it to the repo on GitHub first, or run /issues setup.`
}

// What the permission prompt for project_adopt says: the same warning the pane shows.
export const adoptReason = (project: { title: string; url: string }, refresh: number | null): string => {
  const text = adoptText(project, refresh)
  return [text.title, ...text.lines].join('\n')
}

// Whether a board tool's call got past the permission check, read from what its `next(e)` came back with. A plugin's
// tool has no core behind it, so once the check lets the call through the engine answers that no hook served it. A
// refused or unanswered prompt comes back as a different error. Anything but that one answer counts as no, so if the
// engine words it differently one day, the tool refuses rather than changing something unasked.
const NOBODY_ANSWERED = /no tool\.call hook answered/
export const approvedOf = (answer: { deny?: string; isError?: boolean; text?: string; result?: unknown }): boolean =>
  answer.deny === undefined && answer.isError === true && NOBODY_ANSWERED.test(`${answer.text ?? ''} ${typeof answer.result === 'string' ? answer.result : ''}`)

// What the permission prompt for releasing says.
export const releaseReason = (adopted: Adopted): string =>
  `Stop the board writing to ${adopted.title}${adopted.owner ? `, owned by ${adopted.owner}` : ''}?\nIt only reads the project again until someone lets it write.`
