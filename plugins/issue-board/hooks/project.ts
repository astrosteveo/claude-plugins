import type { Field, Issue, Project } from '../types'

// The repo's projects with their single-select fields, which needs gh to have the read:project permission.
const PROJECTS = 'projectsV2(first: 5) { nodes { id number title url closed fields(first: 30) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } }'
// Each issue's items in those projects, with the Status and Priority set on them.
const ITEMS =
  'projectItems(first: 10) { nodes { id project { id } ' +
  'status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } ' +
  'priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } }'

// The open issues as the board reads them, 100 a page, newest change first; with the project's fields and each issue's
// item when `withProject`, which a token without read:project would have GitHub refuse.
export const issuesQuery = (withProject: boolean): string =>
  [
    'query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) {',
    withProject ? PROJECTS : '',
    'issues(first: 100, states: OPEN, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {',
    'pageInfo { hasNextPage endCursor }',
    'nodes { id number title url body updatedAt',
    'labels(first: 20) { nodes { name color } } assignees(first: 10) { nodes { login } } milestone { title }',
    'parent { number title subIssuesSummary { total completed } } subIssuesSummary { total completed }',
    'blockedBy(first: 10) { nodes { number state } }',
    'closedByPullRequestsReferences(first: 5, includeClosedPrs: false) { nodes { number } }',
    'comments { totalCount }',
    withProject ? ITEMS : '',
    '} } } }',
  ]
    .filter(Boolean)
    .join(' ')

// Sets a single-select field, such as Status, on an issue's item in a project.
export const SET_FIELD =
  'mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: ' +
  '{projectId: $project, itemId: $item, fieldId: $field, value: {singleSelectOptionId: $option}}) { projectV2Item { id } } }'

// Adds an issue to a project, for an issue the project doesn't hold yet; answers the new item's id.
export const ADD_ITEM = 'mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: {projectId: $project, contentId: $content}) { item { id } } }'

// A field's option by name, ignoring case: what a pick or Start sets.
export const optionOf = (field: Field | null | undefined, name: string): { id: string; name: string } | undefined =>
  field?.options.find(option => option.name.toLowerCase() === name.toLowerCase())

// The Status option Start moves an issue to.
export const startedOf = (project: Project | null | undefined): { id: string; name: string } | undefined =>
  project?.status?.options.find(option => /^in progress$/i.test(option.name))

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

// Now is the first two priorities (P0 and P1), Later the rest; an issue with none is neither.
export const isNow = (project: Project | null | undefined, issue: Issue): boolean => priorityRank(project, issue.priority) < 2
export const isLater = (project: Project | null | undefined, issue: Issue): boolean => {
  const rank = priorityRank(project, issue.priority)
  return rank >= 2 && rank !== UNSET
}
