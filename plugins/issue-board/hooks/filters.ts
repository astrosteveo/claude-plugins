import type { Board, BuiltInFilter, Ci, Filter, GroupBy, Issue, Markers, Project, ProjectField, ProjectView, Role } from '../types'
import { DEFAULT_MARKERS, isBug, isFuture, same } from './markers'
import { isLater, isNow, isRole, priorityRank, roleOf } from './project'

export const areaOf = (issue: Issue): string => {
  const label = issue.labels.find(one => one.name.startsWith('area:'))
  return label ? label.name.slice('area:'.length) : 'other'
}

// Whether the issue belongs under the filter; `viewer` is the login Mine means. With a project, Active is Now (P0 and
// P1) and Future is Later (P2); without one they read the repo's later label. `markers` are the bug and later labels
// the board goes by.
export const matches = (filter: BuiltInFilter, issue: Issue, viewer: string | null = null, project: Project | null = null, markers: Markers = DEFAULT_MARKERS): boolean => {
  switch (filter) {
    case 'active':
      return project ? isNow(project, issue) : !isFuture(issue, markers)
    case 'future':
      return project ? isLater(project, issue) : isFuture(issue, markers)
    case 'bugs':
      return isBug(issue, markers)
    case 'mine':
      return viewer !== null && issue.assignees.includes(viewer)
    case 'all':
      return true
    case 'inbox':
      return isInbox(issue, project)
    case 'closed':
      return false
  }
}

// Whether an issue waits in the project's Inbox: its Status is the Inbox option, or it has none, as an issue not in the
// project. A project with no Inbox option has no Inbox.
export const isInbox = (issue: Issue, project: Project | null | undefined): boolean =>
  roleOf(project, 'inbox') !== undefined && (!issue.status || isRole(project, issue.status, 'inbox'))

// Whether the issue matches what was typed in the search field: words of its title, `#42` or `42`, or a label.
export const searched = (query: string, issue: Issue): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = `#${issue.number} ${issue.title} ${issue.labels.map(label => label.name).join(' ')}`.toLowerCase()
  return words.every(word => haystack.includes(word))
}

// How many rows `#` offers in the prompt box at most: more would push the engine's own rows off the screen.
export const HASH_ROWS = 8

// One row of the prompt box's typeahead, as `prompt.autocomplete` takes it.
export type HashRow = { text: string; label: string; description: string }

const CI_WORDS: Record<Ci, string> = { pass: 'CI passing', fail: 'CI failing', pending: 'CI running', none: 'no CI' }

// Where a row stands among the others: issues in progress first, then open pull requests, which are work under way
// too, then Ready, Verification, Backlog and Inbox. An issue with no Status, or another one, comes last.
const HASH_ORDER: Role[] = ['started', 'ready', 'verification', 'backlog', 'inbox']
const hashRank = (project: Project | null | undefined, status: string | null | undefined): number => {
  const at = HASH_ORDER.findIndex(role => isRole(project, status, role))
  return at < 0 ? HASH_ORDER.length + 1 : at === 0 ? 0 : at + 1
}

// Whether a number or title matches what follows `#`: digits match the start of the number, anything else a part of
// the title, ignoring case. A bare `#` matches everything.
const hashMatches = (typed: string, number: number, title: string): boolean =>
  /^\d+$/.test(typed) ? String(number).startsWith(typed) : title.toLowerCase().includes(typed.toLowerCase())

// The rows `#` offers for the token at the cursor: the board's open issues and pull requests that match it, in order
// of Status, then Priority, then newest, at most HASH_ROWS. An issue's dim line is its Status, Priority and labels; a
// pull request's is its CI.
export const hashRows = (board: Board, token: string): HashRow[] => {
  const typed = token.replace(/^#/, '')
  const project = board.project
  const issues = board.issues
    .filter(issue => hashMatches(typed, issue.number, issue.title))
    .map(issue => ({
      rank: hashRank(project, issue.status),
      priority: priorityRank(project, issue.priority),
      number: issue.number,
      row: {
        text: `#${issue.number}`,
        label: `#${issue.number} ${issue.title}`,
        description: [issue.status, issue.priority, issue.labels.map(label => label.name).join(', ')].filter(Boolean).join(' · '),
      },
    }))
  const prs = board.prs
    .filter(pr => hashMatches(typed, pr.number, pr.title))
    .map(pr => ({
      rank: 1,
      priority: Number.POSITIVE_INFINITY,
      number: pr.number,
      row: { text: `#${pr.number}`, label: `#${pr.number} ${pr.title}`, description: ['pull request', pr.isDraft ? 'draft' : '', CI_WORDS[pr.ci]].filter(Boolean).join(' · ') },
    }))
  return [...issues, ...prs]
    .sort((a, b) => a.rank - b.rank || (a.priority === b.priority ? 0 : a.priority < b.priority ? -1 : 1) || b.number - a.number)
    .slice(0, HASH_ROWS)
    .map(one => one.row)
}

// Bugs first, then issues under way (some boxes ticked), then the newest.
const rank = (issue: Issue, markers: Markers = DEFAULT_MARKERS): number => {
  if (isBug(issue, markers)) return 0
  const done = issue.checks.filter(check => check.done).length
  return done > 0 && done < issue.checks.length ? 1 : 2
}

export const byArea = (issues: Issue[], markers: Markers = DEFAULT_MARKERS): [string, Issue[]][] => {
  const groups = new Map<string, Issue[]>()
  for (const issue of issues) {
    const area = areaOf(issue)
    groups.set(area, [...(groups.get(area) ?? []), issue])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)))
    .map(([area, list]) => [area, [...list].sort((a, b) => rank(a, markers) - rank(b, markers) || b.number - a.number)])
}

// Whether an issue waits on another that is still open.
export const isBlocked = (issue: Issue): boolean => (issue.blockedBy ?? []).length > 0

// The most pressing first: by priority when there is a project, then bugs, issues under way and the newest. With
// `readyFirst`, as within an epic, the ones nothing blocks come before the ones that wait, and the oldest before the
// newest: an epic's sub-issues are mostly written in the order they're meant to be done.
export const sortIssues = (issues: Issue[], project: Project | null = null, readyFirst = false, order?: number[], markers: Markers = DEFAULT_MARKERS): Issue[] => {
  // GitHub's order of an epic's sub-issues settles what the board has no reason to: one it doesn't list goes last.
  const at = (issue: Issue) => {
    const index = order?.indexOf(issue.number) ?? -1
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  return [...issues].sort(
    (a, b) =>
      (readyFirst ? Number(isBlocked(a)) - Number(isBlocked(b)) : 0) ||
      priorityRank(project, a.priority) - priorityRank(project, b.priority) ||
      rank(a, markers) - rank(b, markers) ||
      (order ? at(a) - at(b) : 0) ||
      (readyFirst ? a.number - b.number : b.number - a.number),
  )
}

// A group's rows: the issues the project holds in the project's own order, the order a person sets by dragging rows on
// GitHub, then the rest in the board's order. A board read without the project's order has no positions, and is all in
// the board's order.
export const projectOrder = (issues: Issue[], project: Project | null = null, markers: Markers = DEFAULT_MARKERS): Issue[] => {
  const placed = issues.filter(issue => issue.position !== undefined).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  return [...placed, ...sortIssues(issues.filter(issue => issue.position === undefined), project, false, undefined, markers)]
}

// The sub-issue an epic's Next starts: the first open one nothing blocks, in the order the epic lists them.
export const nextOf = (issues: Issue[], epic: number, project: Project | null = null, markers: Markers = DEFAULT_MARKERS): Issue | undefined =>
  sortIssues(
    issues.filter(issue => issue.parent?.number === epic),
    project,
    true,
    issues.find(issue => issue.number === epic)?.subOrder,
    markers,
  ).find(issue => !isBlocked(issue))

// What Start on an issue starts. An epic is worked one sub-issue at a time, so Start on one starts its next ready
// sub-issue, as Next does; null when its open sub-issues are all blocked. An epic whose sub-issues are all closed
// starts itself, so its own open boxes can be finished. Any other issue starts itself.
export const startTargetOf = (issues: Issue[], issue: Issue, project: Project | null = null, markers: Markers = DEFAULT_MARKERS): Issue | null => {
  const subs = issue.subIssues
  if (!subs || subs.total === 0 || subs.completed >= subs.total) return issue
  return nextOf(issues, issue.number, project, markers) ?? null
}

// What Start on an epic says when every open sub-issue is blocked.
export const noReadyText = (epic: number): string => `Epic #${epic} has no ready sub-issue to start: each open one is blocked.`

// A heading of the issue list and the issues under it. `folded`: drawn shut until the person opens it, as the Backlog
// option is.
// `epic`: the parent the group is for, so its row isn't drawn again beneath it.
export type Group = { key: string; title: string; issues: Issue[]; folded: boolean; epic?: { number: number; total: number; completed: number } }

// The issues in groups: by the project's Status in the project's order, by the epic they are sub-issues of, or by
// `area:` label. Issues that don't fit a group come last, under No status, No epic or other. Rows follow the project's
// own order, except an epic's sub-issues, which keep the epic's order.
export const groupsOf = (issues: Issue[], by: GroupBy, project: Project | null = null, field: string | null = null, markers: Markers = DEFAULT_MARKERS): Group[] => {
  if (by === 'view' && field) return groupsByField(issues, field, project, markers)
  if (by === 'status' && project) {
    const named = (project.status?.options ?? []).map(option => ({
      key: `status:${option.name}`,
      title: option.name,
      issues: projectOrder(issues.filter(issue => issue.status === option.name), project, markers),
      folded: isRole(project, option.name, 'backlog'),
    }))
    const known = new Set(named.map(group => group.title))
    const rest = projectOrder(issues.filter(issue => !issue.status || !known.has(issue.status)), project, markers)
    return [...named, { key: 'status:none', title: 'No status', issues: rest, folded: false }].filter(group => group.issues.length > 0)
  }
  if (by === 'epic') {
    const parents = new Map<number, NonNullable<Issue['parent']>>()
    for (const issue of issues) if (issue.parent) parents.set(issue.parent.number, issue.parent)
    const epics = [...parents.values()]
      .sort((a, b) => a.number - b.number)
      .map(parent => ({
        key: `epic:${parent.number}`,
        title: `#${parent.number} ${parent.title}`,
        issues: sortIssues(
          issues.filter(issue => issue.parent?.number === parent.number),
          project,
          true,
          issues.find(issue => issue.number === parent.number)?.subOrder,
          markers,
        ),
        folded: false,
        epic: { number: parent.number, total: parent.total, completed: parent.completed },
      }))
    // An open epic is its group's heading, so it isn't listed again under No epic.
    const rest = projectOrder(issues.filter(issue => !issue.parent && !parents.has(issue.number)), project, markers)
    return [...epics, { key: 'epic:none', title: 'No epic', issues: rest, folded: false }].filter(group => group.issues.length > 0)
  }
  return byArea(issues, markers).map(([area, list]) => ({ key: `area:${area}`, title: area, issues: project ? projectOrder(list, project, markers) : list, folded: false }))
}

// The issues grouped by a field a project view groups by, such as Area or Sprint: the field's options in the project's
// order, then any other value an issue has, then the issues with none.
const groupsByField = (issues: Issue[], name: string, project: Project | null, markers: Markers): Group[] => {
  const options = projectFieldOf(name, project)?.options?.map(option => option.name) ?? []
  const valueOf = (issue: Issue) => fieldValuesOf(issue, name, project)[0] ?? ''
  const others = [...new Set(issues.map(valueOf).filter(value => value !== '' && !options.some(option => same(option, value))))].sort()
  const named = [...options, ...others].map(value => ({
    key: `field:${name}:${value}`,
    title: value,
    issues: projectOrder(
      issues.filter(issue => same(valueOf(issue), value)),
      project,
      markers,
    ),
    folded: false,
  }))
  const rest = projectOrder(
    issues.filter(issue => valueOf(issue) === ''),
    project,
    markers,
  )
  return [...named, { key: `field:${name}:none`, title: `No ${name}`, issues: rest, folded: false }].filter(group => group.issues.length > 0)
}

// A field named the way a filter writes it: any case, and a hyphen for a space, so `story-points` is Story Points.
const sameField = (written: string, name: string): boolean => same(written.replace(/-/g, ' '), name.replace(/-/g, ' '))

// The issue's own qualifiers, which a filter writes by these names, and the values each gives.
const ISSUE_VALUES: Record<string, (issue: Issue) => string[]> = {
  status: issue => (issue.status ? [issue.status] : []),
  priority: issue => (issue.priority ? [issue.priority] : []),
  label: issue => issue.labels.map(label => label.name),
  assignee: issue => issue.assignees,
  milestone: issue => (issue.milestone ? [issue.milestone] : []),
  type: issue => (issue.type ? [issue.type] : []),
}
const ISSUE_ALIASES: Record<string, string> = { labels: 'label', assignees: 'assignee', 'issue type': 'type', 'issue-type': 'type' }
const issueKeyOf = (written: string): string | undefined => {
  const key = written.trim().toLowerCase()
  return ISSUE_VALUES[key] ? key : ISSUE_ALIASES[key]
}

// The project field a filter or grouping names, beyond the issue's own qualifiers.
const projectFieldOf = (written: string, project: Project | null | undefined): ProjectField | undefined =>
  (project?.fields ?? []).find(field => sameField(written, field.name))

// The values an issue has in a field, by the name a view uses: the issue's own (Status, Labels, Milestone…), or a
// project field the board read for the views. Unknown or unset, none.
export const fieldValuesOf = (issue: Issue, name: string, project: Project | null | undefined): string[] => {
  const own = issueKeyOf(name)
  if (own) return ISSUE_VALUES[own]?.(issue) ?? []
  const field = projectFieldOf(name, project)
  const value = field ? issue.fields?.[field.name] : undefined
  return value ? [value] : []
}

// One term of a project view's filter: `label:bug,docs` is the key `label` and two values, `-status:Done` a negated
// term, and a plain word has no key. `raw` is the term as written, for the note about a term the board can't apply.
export type FilterTerm = { key: string | null; values: string[]; negate: boolean; raw: string }

// Splits on `at` (a space, or a comma) wherever it is outside double quotes.
const splitOutside = (text: string, at: RegExp): string[] => {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    if (!quoted && at.test(char)) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.filter(part => part.trim() !== '')
}
const unquoted = (text: string): string => text.replace(/"/g, '').trim()

// A view's filter as GitHub writes it, term by term. A quoted value or key may hold spaces, and a comma list means any.
export const parseFilter = (text: string): FilterTerm[] =>
  splitOutside(text.trim(), /\s/).map(raw => {
    const negate = raw.length > 1 && raw.startsWith('-')
    const body = negate ? raw.slice(1) : raw
    let colon = -1
    let quoted = false
    for (let index = 0; index < body.length; index += 1) {
      if (body[index] === '"') quoted = !quoted
      else if (body[index] === ':' && !quoted) {
        colon = index
        break
      }
    }
    if (colon <= 0) return { key: null, values: [unquoted(body)], negate, raw }
    return {
      key: unquoted(body.slice(0, colon)).toLowerCase(),
      values: splitOutside(body.slice(colon + 1), /,/)
        .map(unquoted)
        .filter(Boolean),
      negate,
      raw,
    }
  })

// A value the board compares as text. Ranges, comparisons, wildcards and `@` dates or iterations need more than the
// board knows, so a term holding one is named as one it can't apply. `@me` is the person, for assignee.
const plainValue = (value: string, key: string | undefined): boolean =>
  value.startsWith('@') ? value.toLowerCase() === '@me' && key === 'assignee' : !/^[<>]|\.\.|\*/.test(value)

// A test of one issue against a filter, with the login `@me` means.
type IssueTest = (issue: Issue, viewer: string | null) => boolean

// The board holds open issues only, so `is:open` and `is:issue` keep each of them, `is:closed` and `is:pr` none.
const IS_KINDS: Record<string, boolean> = { open: true, closed: false, issue: true, pr: false }

// The test for one term, or null for a term the board can't apply.
const termTest = (term: FilterTerm, project: Project | null | undefined): IssueTest | null => {
  if (term.key === null) {
    const word = term.values[0] ?? ''
    if (word === '') return null
    const number = /^#?(\d+)$/.exec(word)?.[1]
    return issue => (number !== undefined && String(issue.number) === number) || issue.title.toLowerCase().includes(word.toLowerCase())
  }
  if (term.values.length === 0) return null
  if (term.key === 'is') {
    if (!term.values.every(value => value.toLowerCase() in IS_KINDS)) return null
    const kept = term.values.some(value => IS_KINDS[value.toLowerCase()])
    return () => kept
  }
  if (term.key === 'no' || term.key === 'has') {
    if (!term.values.every(name => issueKeyOf(name) !== undefined || projectFieldOf(name, project) !== undefined)) return null
    const empty = term.key === 'no'
    return issue => term.values.some(name => (fieldValuesOf(issue, name, project).length === 0) === empty)
  }
  const key = term.key
  const own = issueKeyOf(key)
  if (!own && !projectFieldOf(key, project)) return null
  if (!term.values.every(value => plainValue(value, own))) return null
  return (issue, viewer) => {
    const has = fieldValuesOf(issue, key, project)
    return term.values.some(value => {
      const wanted = value.toLowerCase() === '@me' ? viewer : value
      return wanted !== null && has.some(one => same(one, wanted))
    })
  }
}

// What a view's filter keeps, as a test on one issue, with the terms the board can't apply. Those are left out of the
// test, so the tab shows every issue the rest of the filter keeps: more than GitHub would, never fewer.
export type ViewMatch = { test: IssueTest; unknown: string[] }

export const viewMatchOf = (filter: string, project: Project | null | undefined): ViewMatch => {
  const tests: IssueTest[] = []
  const unknown: string[] = []
  for (const term of parseFilter(filter)) {
    const test = termTest(term, project)
    if (!test) unknown.push(term.raw)
    else tests.push(term.negate ? (issue, viewer) => !test(issue, viewer) : test)
  }
  return { test: (issue, viewer) => tests.every(test => test(issue, viewer)), unknown }
}

// The project fields the views filter or group by, beyond the issue's own qualifiers, Status and Priority, which the
// board reads anyway: the extra values the issues query asks each item for.
export const viewFieldsOf = (project: Project | null | undefined): string[] => {
  const names = new Set<string>()
  const add = (written: string) => {
    const field = issueKeyOf(written) ? undefined : projectFieldOf(written, project)
    if (field) names.add(field.name)
  }
  for (const view of viewTabsOf(project)) {
    for (const term of parseFilter(view.filter)) {
      if (term.key === 'no' || term.key === 'has') term.values.forEach(add)
      else if (term.key && term.key !== 'is') add(term.key)
    }
    if (view.groupBy) add(view.groupBy)
  }
  return [...names].sort()
}

// The built-in filters; with a project, the first two read Priority and say so.
export const BUILT_IN_FILTERS: { id: BuiltInFilter; label: string; planned: string; hotkey: string }[] = [
  { id: 'active', label: 'Active', planned: 'Now', hotkey: '1' },
  { id: 'future', label: 'Future', planned: 'Later', hotkey: '2' },
  { id: 'bugs', label: 'Bugs', planned: 'Bugs', hotkey: '3' },
  { id: 'mine', label: 'Mine', planned: 'Mine', hotkey: '4' },
  { id: 'all', label: 'All', planned: 'All', hotkey: '5' },
  { id: 'inbox', label: 'Inbox', planned: 'Inbox', hotkey: '6' },
  { id: 'closed', label: 'Closed', planned: 'Closed', hotkey: '7' },
]

// A tab of the pane: a built-in filter, or a project view.
export type Tab = { id: Filter; name: string; hotkey: string; view?: ProjectView }

// How many views become tabs at most, so they, All and Closed fit on the keys 1 to 9.
export const VIEW_TABS = 7

// The views that become tabs: the table and board views with a filter, in GitHub's order. A view with no filter shows
// every issue, which All already does, so it is left out. So is a roadmap, which lays issues out by date.
export const viewTabsOf = (project: Project | null | undefined): ProjectView[] =>
  (project?.views ?? []).filter(view => view.layout !== 'roadmap' && view.filter.trim() !== '').slice(0, VIEW_TABS)

// The pane's tabs, on the keys 1 to 9 in order. With views that have filters: those views, then the built-in Inbox
// when the project has an Inbox and no view keeps just it, then All and Closed. Without any: the built-in ones, Inbox
// only with a project that has one.
export const tabsOf = (project: Project | null | undefined): Tab[] => {
  const hasInbox = roleOf(project, 'inbox') !== undefined
  const found = viewTabsOf(project)
  if (found.length === 0) {
    return BUILT_IN_FILTERS.filter(one => one.id !== 'inbox' || hasInbox).map(one => ({
      id: one.id,
      name: project ? one.planned : one.label,
      hotkey: one.hotkey,
    }))
  }
  // The Inbox takes a key of its own, so one view fewer fits.
  const inbox = hasInbox && !found.some(view => isInboxFilter(view.filter, project))
  const views = inbox ? found.slice(0, VIEW_TABS - 1) : found
  const after: { id: BuiltInFilter; name: string }[] = [...(inbox ? [{ id: 'inbox' as const, name: 'Inbox' }] : []), { id: 'all', name: 'All' }, { id: 'closed', name: 'Closed' }]
  return [
    ...views.map((view, index): Tab => ({ id: `view:${view.number}`, name: view.name, hotkey: String(index + 1), view })),
    ...after.map((tab, index): Tab => ({ ...tab, hotkey: String(views.length + index + 1) })),
  ]
}

// The tab a chosen filter is: the one it names, or else the first tab. A built-in filter chosen before the project's
// views became the tabs, or a view since removed, lands there.
export const tabOf = (tabs: Tab[], chosen: Filter): Tab => tabs.find(tab => tab.id === chosen) ?? tabs[0] ?? { id: 'all', name: 'All', hotkey: '5' }

// Whether an issue belongs under a tab: its view's filter, or its built-in filter. Made once a tab, then used per issue.
export const tabTest = (tab: Tab, project: Project | null | undefined, markers: Markers = DEFAULT_MARKERS): IssueTest => {
  if (tab.view) return viewMatchOf(tab.view.filter, project).test
  const id = tab.id as BuiltInFilter
  return (issue, viewer) => matches(id, issue, viewer, project ?? null, markers)
}

// What the issues group by: the one the person picked, while it still applies, else the view's own, else Status with
// a project and area without one. The view's field grouping applies only while its tab shows, and Status only with a
// project.
export const groupingOf = (picked: GroupBy | null, view: { by: GroupBy; field: string } | null, hasProject: boolean): GroupBy => {
  const field = view?.by === 'view' ? view.field : null
  const fallback: GroupBy = hasProject ? 'status' : 'area'
  if (picked === 'view') return field ? 'view' : fallback
  return picked && (picked !== 'status' || hasProject) ? picked : (view?.by ?? fallback)
}

// How a view's tab groups its issues: by Status or by epic as the pane does, by another field the board read, or not
// at all (null) for a field it can't group by, such as Labels, of which an issue may have several.
export const viewGroupingOf = (view: ProjectView | undefined, project: Project | null | undefined): { by: GroupBy; field: string } | null => {
  const name = view?.groupBy
  if (!name) return null
  if (same(name, 'Status')) return project?.status ? { by: 'status', field: name } : null
  if (same(name, 'Parent issue')) return { by: 'epic', field: name }
  const own = issueKeyOf(name)
  if (own === 'label' || own === 'assignee') return null
  return own || projectFieldOf(name, project) ? { by: 'view', field: name } : null
}

// A view's page on GitHub.
export const viewUrl = (project: { url: string }, view: { number: number }): string => `${project.url}/views/${view.number}`

// Whether a view's filter keeps just the Inbox: Status at the Inbox option, or no Status, and nothing narrower save
// `is:open` or `is:issue`.
export const isInboxFilter = (filter: string, project: Project | null | undefined): boolean => {
  const inbox = roleOf(project, 'inbox')?.name
  const terms = parseFilter(filter)
  const inboxTerm = (term: FilterTerm) =>
    !term.negate &&
    term.key !== null &&
    ((same(term.key, 'status') && inbox !== undefined && term.values.length > 0 && term.values.every(value => same(value, inbox))) ||
      (same(term.key, 'no') && term.values.length === 1 && same(term.values[0] ?? '', 'status')))
  const harmless = (term: FilterTerm) => !term.negate && term.key !== null && same(term.key, 'is') && term.values.every(value => ['open', 'issue'].includes(value.toLowerCase()))
  return terms.some(inboxTerm) && terms.every(term => inboxTerm(term) || harmless(term))
}

// The pane's Inbox tab: the built-in one, or a project view whose filter is the Inbox; undefined when there is none.
export const inboxTabOf = (tabs: Tab[], project: Project | null | undefined): Tab | undefined =>
  tabs.find(tab => tab.id === 'inbox') ?? tabs.find(tab => tab.view !== undefined && isInboxFilter(tab.view.filter, project))
