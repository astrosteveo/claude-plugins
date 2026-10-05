import type { SavedSetup, SetupFacts, SetupOption, SetupProject, SetupStep } from '../types'

// The board's Status options, in its order, with the color and description a new one gets.
export const STATUSES: SetupOption[] = [
  { name: 'Inbox', color: 'GRAY', description: 'New, not looked at yet' },
  { name: 'Backlog', color: 'BLUE', description: 'Scoped, for later' },
  { name: 'Ready', color: 'GREEN', description: 'Ready to start' },
  { name: 'In progress', color: 'YELLOW', description: 'Being worked on' },
  { name: 'Verification', color: 'ORANGE', description: 'Built; a check or sign-off remains' },
  { name: 'Done', color: 'PURPLE', description: 'Acceptance met' },
]

export const PRIORITIES: SetupOption[] = [
  { name: 'P0', color: 'RED', description: 'Blocks the release' },
  { name: 'P1', color: 'ORANGE', description: 'Planned work' },
  { name: 'P2', color: 'GRAY', description: 'Future or optional' },
]

// The project automations the board relies on. GitHub's API can read them but not turn them on.
export const AUTOMATIONS = ['Item closed', 'Auto-add to project', 'Auto-add sub-issues to project']

const OPTION = 'options { id name color description }'

// The repo, its labels, and its linked projects with their single-select fields and automations.
export const FACTS_QUERY =
  'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id nameWithOwner hasIssuesEnabled viewerPermission owner { id } ' +
  'labels(first: 100) { nodes { name } } ' +
  `projectsV2(first: 10) { nodes { id number title url closed fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name ${OPTION} } } } ` +
  'workflows(first: 20) { nodes { name enabled } } } } } }'

// The open issues, 100 a page, with their item and Status in each project.
export const ITEMS_QUERY =
  'query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { issues(first: 100, states: OPEN, after: $after) { ' +
  'pageInfo { hasNextPage endCursor } nodes { id number projectItems(first: 10) { nodes { id project { id } ' +
  'status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } } }'

// One project's fields again, after setup created it or changed them.
export const PROJECT_QUERY = `query($id: ID!) { node(id: $id) { ... on ProjectV2 { id number title url fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name ${OPTION} } } } workflows(first: 20) { nodes { name enabled } } } } }`

export const CREATE_PROJECT =
  'mutation($owner: ID!, $title: String!, $repo: ID!) { createProjectV2(input: {ownerId: $owner, title: $title, repositoryId: $repo}) { projectV2 { id number title url } } }'
export const UPDATE_FIELD =
  'mutation($field: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]) { updateProjectV2Field(input: {fieldId: $field, singleSelectOptions: $options}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }'
export const CREATE_FIELD =
  'mutation($project: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]) { createProjectV2Field(input: {projectId: $project, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $options}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }'

type Nodes<T> = { nodes?: (T | null)[] | null } | null | undefined
type RawField = { id?: string; name?: string; options?: SetupOption[] }
type RawProject = { id: string; number: number; title: string; url: string; closed?: boolean; fields?: Nodes<RawField>; workflows?: Nodes<{ name: string; enabled: boolean }> }

const nodesOf = <T>(list: Nodes<T>): T[] => (list?.nodes ?? []).filter((one): one is T => one !== null && one !== undefined)
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const fieldOf = (project: RawProject, name: string) => {
  const field = nodesOf(project.fields).find(one => one.id && one.name && same(one.name, name) && one.options)
  return field?.id && field.options ? { id: field.id, options: field.options } : null
}

// A project as setup reads it, from the facts query or the one-project query.
export const projectOf = (raw: RawProject): SetupProject => ({
  id: raw.id,
  number: raw.number,
  title: raw.title,
  url: raw.url,
  status: fieldOf(raw, 'Status'),
  priority: fieldOf(raw, 'Priority'),
  workflows: nodesOf(raw.workflows),
})

type RawFacts = {
  data?: {
    repository?: {
      id: string
      nameWithOwner: string
      hasIssuesEnabled: boolean
      viewerPermission?: string | null
      owner: { id: string }
      labels?: Nodes<{ name: string }>
      projectsV2?: Nodes<RawProject>
    }
  }
}
type RawItems = {
  data?: {
    repository?: {
      issues?: {
        pageInfo?: { hasNextPage: boolean; endCursor: string | null }
        nodes?: ({ id: string; number: number; projectItems?: Nodes<{ id: string; project?: { id: string } | null; status?: { name?: string } | null }> } | null)[]
      }
    }
  }
}

// The facts from the facts query and the pages of the items query; `suggested` and `hasTemplate` come from the folder.
export const factsOf = (json: string, pages: string[], suggested: string[], hasTemplate: boolean): SetupFacts => {
  const repo = (JSON.parse(json) as RawFacts).data?.repository
  if (!repo) throw new Error("GitHub didn't answer with the repository")
  const issues = pages.flatMap(page => ((JSON.parse(page) as RawItems).data?.repository?.issues?.nodes ?? []).filter(one => one !== null))
  return {
    repo: { id: repo.id, name: repo.nameWithOwner, ownerId: repo.owner.id, hasIssues: repo.hasIssuesEnabled, permission: repo.viewerPermission ?? null },
    projects: nodesOf(repo.projectsV2)
      .filter(one => !one.closed)
      .map(projectOf),
    labels: nodesOf(repo.labels).map(label => label.name),
    issues: issues.map(issue => ({
      id: issue.id,
      number: issue.number,
      items: nodesOf(issue.projectItems).flatMap(item => (item.project ? [{ project: item.project.id, item: item.id, status: item.status?.name ?? null }] : [])),
    })),
    suggested,
    hasTemplate,
  }
}

// Where the next page of issues starts, or null after the last.
export const nextItemsOf = (json: string): string | null => {
  const info = (JSON.parse(json) as RawItems).data?.repository?.issues?.pageInfo
  return info?.hasNextPage && info.endCursor ? info.endCursor : null
}

// The Status options with the board's missing ones added. The existing ones stay as they are, ids and all, so issues keep
// their Status, and where they are. A new one goes in before the next of the board's options the project has, or last.
// A name matches whatever its case, so a project's `In Progress` stands for `In progress`.
export const mergeStatuses = (existing: SetupOption[]): { options: SetupOption[]; added: string[] } => {
  const options = [...existing]
  const added: string[] = []
  STATUSES.forEach((wanted, index) => {
    if (options.some(one => same(one.name, wanted.name))) return
    const next = STATUSES.slice(index + 1).find(later => options.some(one => same(one.name, later.name)))
    const at = next ? options.findIndex(one => same(one.name, next.name)) : options.length
    options.splice(at, 0, { ...wanted })
    added.push(wanted.name)
  })
  return { options, added }
}

// A new project's Status before setup changes it: GitHub's own three.
const DEFAULT_STATUS: SetupOption[] = [
  { name: 'Todo', color: 'GREEN', description: '' },
  { name: 'In Progress', color: 'YELLOW', description: '' },
  { name: 'Done', color: 'PURPLE', description: '' },
]

const AREA = /^area:/

// The `area:` labels to create: the ones typed in the field, without `area:` or the ones the repo has.
export const areasOf = (typed: string, labels: string[]): string[] => [
  ...new Set(
    typed
      .split(/[,\s]+/)
      .map(one => one.trim().replace(AREA, '').toLowerCase())
      .filter(one => /^[a-z0-9][a-z0-9._-]*$/.test(one) && !labels.includes(`area:${one}`)),
  ),
]

// The area labels setup offers: none when the repo has some, else the repo's own parts, read from its folders.
export const suggestAreas = (labels: string[], folders: { top: string[]; nested: Record<string, string[]> }): string[] => {
  if (labels.some(label => AREA.test(label))) return []
  const grouped = ['plugins', 'packages', 'apps', 'services', 'src']
  const parts = grouped.flatMap(group => folders.nested[group] ?? [])
  const names = parts.length > 0 ? parts : folders.top.filter(one => !grouped.includes(one))
  const skip = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', 'tests', 'test', 'docs', 'scripts', 'bin'])
  return [...new Set(names.map(one => one.toLowerCase()).filter(one => !one.startsWith('.') && !skip.has(one) && /^[a-z0-9][a-z0-9._-]*$/.test(one)))].slice(0, 8)
}

// What setup will change: each step only when something is missing. `chosen` is the project picked (null: create one).
export const stepsOf = (facts: SetupFacts, chosen: string | null, typed: string): SetupStep[] => {
  const steps: SetupStep[] = []
  const project = facts.projects.find(one => one.id === chosen)
  const name = facts.repo.name.split('/')[1] ?? facts.repo.name
  if (!facts.repo.hasIssues) steps.push({ id: 'issues', title: `Turn on issues for ${facts.repo.name}` })
  if (!project) steps.push({ id: 'project', title: `Create the project "${name}" and link it to ${facts.repo.name}` })
  const status = mergeStatuses(project ? (project.status?.options ?? []) : DEFAULT_STATUS)
  if (project && !project.status) steps.push({ id: 'status', title: 'The project has no Status field; add it in the project, then run setup again' })
  else if (status.added.length > 0) steps.push({ id: 'status', title: `Add Status options: ${status.added.join(', ')}` })
  if (!project?.priority) steps.push({ id: 'priority', title: 'Create a Priority field: P0, P1, P2' })
  if (!facts.labels.includes('bug')) steps.push({ id: 'bug', title: 'Create the label bug' })
  const areas = areasOf(typed, facts.labels)
  if (areas.length > 0) steps.push({ id: 'areas', title: `Create the labels ${areas.map(one => `area:${one}`).join(', ')}` })
  const missing = facts.issues.filter(issue => !project || !issue.items.some(item => item.project === project.id))
  if (missing.length > 0) steps.push({ id: 'items', title: `Add ${missing.length} open ${missing.length === 1 ? 'issue' : 'issues'} to the project` })
  const unset = facts.issues.filter(issue => !project || !issue.items.some(item => item.project === project.id && item.status))
  if (unset.length > 0) steps.push({ id: 'inbox', title: `Set Status to Inbox on ${unset.length} ${unset.length === 1 ? 'issue' : 'issues'} that have none` })
  return steps
}

// The automations that are off in a project, which only its settings page can turn on.
export const automationsOff = (project: SetupProject | undefined): string[] =>
  project ? AUTOMATIONS.filter(name => project.workflows.some(one => one.name === name && !one.enabled)) : AUTOMATIONS

// Whether the project still has GitHub's own Todo, which its "Item added to project" automation sets on new issues
// unless told otherwise. The API can't read or change what it sets, so setup asks the person to set it to Inbox.
export const addsAsTodo = (project: SetupProject | undefined): boolean =>
  (project?.status?.options ?? [{ name: 'Todo' }]).some(option => option.name.toLowerCase() === 'todo')

// Which Status option means what, for the board to save: the board's names matched whatever their case.
export const rolesOf = (options: SetupOption[]): NonNullable<SavedSetup['status']>['roles'] => {
  const find = (name: string) => options.find(one => same(one.name, name))?.id
  const roles = { inbox: find('Inbox'), backlog: find('Backlog'), ready: find('Ready'), started: find('In progress'), verification: find('Verification'), done: find('Done') }
  return Object.fromEntries(Object.entries(roles).filter(([, id]) => id !== undefined)) as NonNullable<SavedSetup['status']>['roles']
}

// What the template button hands Claude: a normal change to the repo, for the person to review.
export const templatePrompt = (repo: string): string =>
  [
    `Add an issue template to ${repo} at \`.github/ISSUE_TEMPLATE/task.yml\`, as a GitHub issue form.`,
    'It asks for what is wrong or wanted and why, then an "Acceptance" list written as task-list boxes ("- [ ] ..."), one checkable outcome each,',
    'so the issue board can show and tick them. Keep the wording short and plain.',
    'Make the change on a branch and open a pull request for me to review; don\'t merge it.',
  ].join(' ')
