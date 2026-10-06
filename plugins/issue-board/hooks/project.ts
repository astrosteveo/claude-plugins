import type { Field, Issue, Project, Role, Roles } from '../types'

// The repo's projects with their fields, which needs gh to have the read:project permission. A field's kind and its
// options or iterations are the project's, not each issue's, so reading them costs little.
const PROJECTS =
  'projectsV2(first: 5) { nodes { id number title url closed fields(first: 30) { nodes { ' +
  '... on ProjectV2Field { id name dataType } ' +
  '... on ProjectV2SingleSelectField { id name dataType options { id name } } ' +
  '... on ProjectV2IterationField { id name dataType configuration { iterations { id title } } } } } ' +
  'statusUpdates(last: 1) { nodes { status body createdAt startDate targetDate } } workflows(first: 20) { nodes { name enabled } } } }'
// Each issue's items in those projects, with the Status and Priority set on them.
const ITEMS =
  'projectItems(first: 10) { nodes { id project { id } ' +
  'status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } ' +
  'priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } }'

// The open issues as the board reads them, 100 a page, newest change first; with the project's fields and each issue's
// item when `withProject`, which a token without read:project would have GitHub refuse.
export const issuesQuery = (withProject: boolean): string =>
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
    withProject ? ITEMS : '',
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

// The board's own name for each role: what setup suggests, and what counts for a project setup saved no roles for.
export const ROLE_NAMES: Record<Role, string> = { inbox: 'Inbox', ready: 'Ready', backlog: 'Backlog', started: 'In progress', verification: 'Verification', done: 'Done' }
export const ROLE_ORDER: Role[] = ['inbox', 'ready', 'backlog', 'started', 'verification', 'done']

// Which option has each role by the board's names, whatever their case.
export const rolesByName = (options: readonly { id?: string; name: string }[]): Roles =>
  Object.fromEntries(ROLE_ORDER.flatMap(role => {
    const id = options.find(option => option.name.toLowerCase() === ROLE_NAMES[role].toLowerCase())?.id
    return id ? [[role, id]] : []
  })) as Roles

// The roles the board goes by for a project: the ones setup saved for it, kept to options it still has, or else the
// board's names.
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
