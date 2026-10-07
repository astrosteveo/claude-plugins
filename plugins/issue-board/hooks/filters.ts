import type { Board, BuiltInFilter, Ci, Filter, GroupBy, Issue, Iteration, Markers, Project, ProjectField, ProjectView, Role } from '../types'
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

// The project's option for Ready or Backlog, by name, if it has one.
export const triageTarget = (project: Project | null | undefined, status: 'Ready' | 'Backlog'): string | undefined => roleOf(project, status === 'Ready' ? 'ready' : 'backlog')?.name

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

// A value the board compares as text. Ranges, comparisons, wildcards and `@` dates need more than text, so a term
// holding one is named as one it can't apply, unless rangeTestOf takes it on a date or number field. `@me` is the
// person, for assignee. An iteration field's `@` terms are iterationTitlesOf's.
const plainValue = (value: string, key: string | undefined): boolean =>
  value.startsWith('@') ? value.toLowerCase() === '@me' && key === 'assignee' : !/^[<>]|\.\.|\*/.test(value)

// An iteration with the times it runs over: from the local midnight it starts at to the one after its last day. The
// person's own calendar decides the day, as GitHub's page does in their browser.
type Span = { title: string; from: number; to: number }
const spanOf = (iteration: Iteration): Span | null => {
  const [year, month, day] = iteration.start.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined || [year, month, day].some(Number.isNaN)) return null
  return { title: iteration.title, from: new Date(year, month - 1, day).getTime(), to: new Date(year, month - 1, day + iteration.days).getTime() }
}

// The current, next and previous iterations of a field at `clock`. The current one runs over the clock; the next is the
// first to start after it, and the previous the last to end before it. Between two iterations there is no current one,
// and the next and previous are the ones either side of the gap.
export const iterationsAt = (field: ProjectField | undefined, clock: number): { current?: Span; next?: Span; previous?: Span } => {
  const spans = (field?.iterations ?? []).flatMap(one => spanOf(one) ?? []).sort((a, b) => a.from - b.from)
  return {
    current: spans.find(span => span.from <= clock && clock < span.to),
    next: spans.find(span => span.from > clock),
    previous: spans.filter(span => span.to <= clock).at(-1),
  }
}

const ITERATION_TERM = /^@(current|next|previous)$/i

// The titles of the iterations an iteration field's `@current`, `@next` or `@previous` names at `clock`, or a range
// of them such as `@current..@next`; null for a value that isn't one. A term with no such iteration names none, so it
// keeps no issue. A range keeps the iterations that start from its first end to its last. An end with no iteration is
// the clock for `@current`, so `@current..@next` between two iterations keeps the next one, and is open for the others.
export const iterationTitlesOf = (value: string, field: ProjectField | undefined, clock: number): string[] | null => {
  const ends = value.split('..')
  if (ends.length > 2 || !ends.every(end => ITERATION_TERM.test(end))) return null
  const spans = (field?.iterations ?? []).flatMap(one => spanOf(one) ?? [])
  const at = iterationsAt(field, clock)
  const which = (end: string) => end.slice(1).toLowerCase() as 'current' | 'next' | 'previous'
  if (ends.length === 1) {
    const one = at[which(value)]
    return one ? [one.title] : []
  }
  const point = (end: string, missing: number) => {
    const name = which(end)
    return at[name]?.from ?? (name === 'current' ? clock : missing)
  }
  const from = point(ends[0] ?? '', Number.NEGATIVE_INFINITY)
  const to = point(ends[1] ?? '', Number.POSITIVE_INFINITY)
  return spans.filter(span => span.from >= from && span.from <= to).map(span => span.title)
}

// The current iteration and the days left in it, such as `Sprint 14 · 3d left`, for the pane's header: the first
// iteration field's that has one. Null when no iteration field has a current iteration. The last day counts as one left.
export const currentIterationText = (project: Project | null | undefined, clock: number): string | null => {
  for (const field of project?.fields ?? []) {
    if (field.kind !== 'iteration') continue
    const current = iterationsAt(field, clock).current
    if (!current) continue
    const now = new Date(clock)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return `${current.title} · ${Math.round((current.to - today) / 86_400_000)}d left`
  }
  return null
}

const DAY_MS = 86_400_000

// A day as a count of days, so days compare as numbers: a project date field's `YYYY-MM-DD` is that day, and a time
// such as an issue's `updatedAt` is the day it falls on in the person's own calendar, as GitHub's page has it in their
// browser. Null for anything else.
export const dayOf = (text: string): number | null => {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (plain) return Date.UTC(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) / DAY_MS
  const time = /^\d{4}-\d{2}-\d{2}T/.test(text) ? Date.parse(text) : Number.NaN
  if (Number.isNaN(time)) return null
  const at = new Date(time)
  return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / DAY_MS
}

// The kinds of value a filter can compare and take a range of.
type Scale = 'date' | 'number'

const TODAY = /^@today(?:([+-])(\d+)([dw])?)?$/i

// One end of a comparison or range: a number on a number field; on a date field a day, `@today`, or `@today` moved
// by days or weeks, such as `@today-7d` or `@today+2w`, on the board's clock. Null for a value that isn't one.
const pointOf = (text: string, scale: Scale, clock: number): number | null => {
  if (scale === 'number') return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null
  const today = TODAY.exec(text)
  if (!today) return /^\d{4}-\d{2}-\d{2}$/.test(text) ? dayOf(text) : null
  const now = new Date(clock)
  const day = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS
  const by = Number(today[2] ?? 0) * (today[3]?.toLowerCase() === 'w' ? 7 : 1)
  return today[1] === '-' ? day - by : day + by
}

// A field's value on the scale a term compares it on, or null when it has none there.
const measureOf = (value: string, scale: Scale): number | null => {
  if (scale === 'date') return dayOf(value)
  const number = value.trim() === '' ? Number.NaN : Number(value)
  return Number.isFinite(number) ? number : null
}

// The test one value of a date or number term puts to a field's value: `>`, `>=`, `<` or `<=` a point, a range `a..b`
// that holds both ends, with `*` for an open end, or one point alone. Null for a value that isn't one of these.
export const rangeTestOf = (value: string, scale: Scale, clock: number): ((had: string) => boolean) | null => {
  const on = (keep: (had: number) => boolean) => (had: string) => {
    const measure = measureOf(had, scale)
    return measure !== null && keep(measure)
  }
  const compared = /^(>=|<=|>|<)(.+)$/.exec(value)
  if (compared) {
    const point = pointOf(compared[2] ?? '', scale, clock)
    if (point === null) return null
    if (compared[1] === '>') return on(had => had > point)
    if (compared[1] === '>=') return on(had => had >= point)
    if (compared[1] === '<') return on(had => had < point)
    return on(had => had <= point)
  }
  const ends = value.split('..')
  if (ends.length > 2) return null
  if (ends.length === 2) {
    const end = (text: string, open: number) => (text === '*' ? open : pointOf(text, scale, clock))
    const from = end(ends[0] ?? '', Number.NEGATIVE_INFINITY)
    const to = end(ends[1] ?? '', Number.POSITIVE_INFINITY)
    if (from === null || to === null) return null
    return on(had => had >= from && had <= to)
  }
  const point = pointOf(value, scale, clock)
  return point === null ? null : on(had => had === point)
}

// The issue's own dates, which a filter writes as `created:`, `updated:` and `closed:`. The board holds open issues,
// so none has a closed date.
const ISSUE_DATES: Record<string, (issue: Issue) => string[]> = {
  created: issue => (issue.createdAt ? [issue.createdAt] : []),
  updated: issue => (issue.updatedAt ? [issue.updatedAt] : []),
  closed: () => [],
}

// A test of one issue against a filter, with the login `@me` means.
type IssueTest = (issue: Issue, viewer: string | null) => boolean

// The board holds open issues only, so `is:open` and `is:issue` keep each of them, `is:closed` and `is:pr` none.
const IS_KINDS: Record<string, boolean> = { open: true, closed: false, issue: true, pr: false }

// The test for one term, or null for a term the board can't apply. `clock` places an iteration field's `@` terms and
// `@today`.
const termTest = (term: FilterTerm, project: Project | null | undefined, clock: number): IssueTest | null => {
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
  const dates = ISSUE_DATES[key]
  const own = dates ? undefined : issueKeyOf(key)
  const field = own || dates ? undefined : projectFieldOf(key, project)
  if (!own && !field && !dates) return null
  // An iteration field's `@current`, `@next` and `@previous` are the titles of the iterations they name now.
  const iteration = field?.kind === 'iteration' ? field : undefined
  const named = term.values.map(value => (iteration ? iterationTitlesOf(value, iteration, clock) : null))
  // The issue's dates and a date or number field take comparisons and ranges. Their other values compare as text,
  // except on the issue's dates, which hold nothing else.
  const scale: Scale | null = dates || field?.kind === 'date' ? 'date' : field?.kind === 'number' ? 'number' : null
  const ranges = term.values.map(value => (scale ? rangeTestOf(value, scale, clock) : null))
  if (!term.values.every((value, index) => named[index] !== null || ranges[index] !== null || (!dates && plainValue(value, own)))) return null
  return (issue, viewer) => {
    const has = dates ? dates(issue) : fieldValuesOf(issue, key, project)
    return term.values.some((value, index) => {
      const range = ranges[index]
      if (range) return has.some(range)
      const wanted = named[index] ?? [value.toLowerCase() === '@me' ? viewer : value]
      return wanted.some(one => one !== null && has.some(had => same(had, one)))
    })
  }
}

// What a view's filter keeps, as a test on one issue, with the terms the board can't apply. Those are left out of the
// test, so the tab shows every issue the rest of the filter keeps: more than GitHub would, never fewer.
export type ViewMatch = { test: IssueTest; unknown: string[] }

// `clock` is the board's, for an iteration field's `@current`, `@next` and `@previous`, and for `@today`. What the
// board can't apply doesn't depend on it.
export const viewMatchOf = (filter: string, project: Project | null | undefined, clock: number = Date.now()): ViewMatch => {
  const tests: IssueTest[] = []
  const unknown: string[] = []
  for (const term of parseFilter(filter)) {
    const test = termTest(term, project, clock)
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
export const tabTest = (tab: Tab, project: Project | null | undefined, markers: Markers = DEFAULT_MARKERS, clock: number = Date.now()): IssueTest => {
  if (tab.view) return viewMatchOf(tab.view.filter, project, clock).test
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

const GROUPINGS: { id: GroupBy; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'epic', label: 'Epic' },
  { id: 'area', label: 'Area' },
]

// What the pane lists under the Issues heading: the tab shown, how it groups, and the issues under it.
// `clock` is the board's, which places a view's `@current` iteration.
export const listOf = ({
  now,
  chosen,
  picked,
  typed,
  who,
  open,
  marks,
  clock,
}: {
  now: Board
  chosen: Filter
  picked: GroupBy | null
  typed: string
  who: string | null
  open: number | null
  marks: Markers
  clock: number
}) => {
  // Without a project the board works from labels: Active and Future, grouped by area.
  const project = now.project ?? null
  // The tabs: the project's views with filters, then All and Closed; or the built-in filters. A tab chosen that is no
  // longer there, such as Now once the views are the tabs, gives way to the first.
  const tabs = tabsOf(project)
  const tab = tabOf(tabs, chosen)
  const tabTests = new Map(tabs.map(one => [one.id, tabTest(one, project, marks, clock)] as const))
  const inTab = (one: Tab, issue: Issue) => tabTests.get(one.id)?.(issue, who) ?? false
  // A view's tab groups as the view does, when the board can: Status, epic, or another field it read. The grouping
  // named for the view's field shows among the others while its tab does.
  const viewGrouping = viewGroupingOf(tab.view, project)
  const viewField = viewGrouping?.by === 'view' ? viewGrouping.field : null
  const grouping = groupingOf(picked, viewGrouping, Boolean(project))
  // Whether an issue is under the filter and the search. The open card stays in the list whether or not, until it is
  // collapsed, so setting its Priority or Status doesn't take it away while it's being changed.
  const kept = (issue: Issue) => inTab(tab, issue) && searched(typed, issue)
  const shown = now.issues.filter(issue => open === issue.number || kept(issue))
  // The Inbox lists each issue with what Claude suggests for it, rather than in groups.
  const triaging = tab.id === 'inbox' && project !== null
  // The groupings offered. With a project the grouping can be Status.
  const groupings = [...GROUPINGS.filter(one => one.id !== 'status' || project), ...(viewField ? [{ id: 'view' as const, label: viewField }] : [])]
  // A tab's label: its name and how many open issues it holds; Closed's count isn't known until it is read.
  const tabLabel = (one: Tab) => (one.id === 'closed' ? one.name : `${one.name} ${now.issues.filter(issue => inTab(one, issue)).length}`)
  const groups = triaging ? [] : groupsOf(shown, grouping, project, viewField, marks)
  // The terms of the view's filter the board can't apply, for the note under the heading.
  const unknownTerms = tab.view ? viewMatchOf(tab.view.filter, project, clock).unknown : []
  return { project, tabs, tab, kept, shown, triaging, grouping, groupings, tabLabel, groups, unknownTerms }
}
