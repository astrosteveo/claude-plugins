import type { ThemeKey } from 'claude-code'
import type { Alert, Board, BoxTask, Check, Ci, Comment, Draft, Field, Filter, Found, GroupBy, Issue, Known, Label, Milestone, ProjectField, StatusUpdate, Project, PullRequest, Role, RunWatch, Suggestion, Worker, Working } from '../types'
import { ROLE_NAMES, isLater, isNow, isRole, nowCountOf, priorityRank, roleOf } from './project'

type RawLabel = { name: string; color?: string }
type RawUser = { login: string }
type RawIssue = {
  number: number
  title: string
  url?: string
  labels: RawLabel[]
  assignees?: RawUser[] | null
  body: string | null
  updatedAt: string
}
type RawCheck = { status?: string; conclusion?: string; state?: string; name?: string; context?: string; detailsUrl?: string; targetUrl?: string }
type RawPr = {
  number: number
  title: string
  url?: string
  author?: RawUser | null
  headRefName: string
  headRefOid?: string
  isDraft: boolean
  statusCheckRollup: RawCheck[] | null
  reviewDecision: string | null
  additions?: number
  deletions?: number
  updatedAt?: string
  body?: string | null
  closingIssuesReferences?: { number: number }[] | null
  mergeStateStatus?: string | null
  reviewRequests?: ({ login?: string; name?: string; slug?: string } | null)[] | null
}

const BOX = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])

// The task-list boxes of an issue's body, in order.
export const checksOf = (body: string | null): Check[] =>
  (body ?? '').split(/\r?\n/).flatMap(line => {
    const match = BOX.exec(line)
    return match ? [{ done: match[1] !== ' ', text: (match[2] ?? '').trim() }] : []
  })

export const parseIssues = (json: string): Issue[] =>
  (JSON.parse(json) as RawIssue[]).map(raw => ({
    number: raw.number,
    title: raw.title,
    url: raw.url ?? '',
    labels: raw.labels.map(label => ({ name: label.name, color: label.color ?? '' })),
    assignees: (raw.assignees ?? []).map(user => user.login),
    checks: checksOf(raw.body),
    updatedAt: raw.updatedAt,
    body: raw.body ?? '',
  }))

const HEADING = /^\s{0,3}#{1,6}\s/
const MARKDOWN_LIMIT = 10_000

// The body as the card shows it: without its task-list boxes, which the card lists as buttons of their own, and
// without a heading left with nothing under it, such as `## Acceptance` once its boxes are gone.
export const proseOf = (body: string): string => {
  const lines = body.split(/\r?\n/).filter(line => !BOX.test(line))
  const kept = lines.filter((line, index) => {
    if (!HEADING.test(line)) return true
    const rest = lines.slice(index + 1)
    const end = rest.findIndex(next => HEADING.test(next))
    return (end < 0 ? rest : rest.slice(0, end)).some(next => next.trim() !== '')
  })
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return text.length <= MARKDOWN_LIMIT ? text : `${text.slice(0, MARKDOWN_LIMIT - 1)}…`
}

export const ciOf = (rollup: RawCheck[] | null): Ci => {
  const checks = rollup ?? []
  if (checks.length === 0) return 'none'
  if (checks.some(isFailed)) return 'fail'
  if (checks.some(check => (check.status !== undefined && check.status !== 'COMPLETED') || check.state === 'PENDING' || check.state === 'EXPECTED')) {
    return 'pending'
  }
  return 'pass'
}

const isFailed = (check: RawCheck): boolean => FAILED.has(check.conclusion ?? check.state ?? '')

// The Actions run a check belongs to, read from its link (`.../actions/runs/<id>/job/<id>`).
const RUN = /\/actions\/runs\/(\d+)/

export const failingOf = (rollup: RawCheck[] | null): { failing: string[]; runs: number[] } => {
  const failed = (rollup ?? []).filter(isFailed)
  const runs = failed.flatMap(check => {
    const match = RUN.exec(check.detailsUrl ?? check.targetUrl ?? '')
    return match ? [Number(match[1])] : []
  })
  return { failing: [...new Set(failed.map(check => check.name ?? check.context ?? '').filter(Boolean))], runs: [...new Set(runs)] }
}

export const parsePrs = (json: string): PullRequest[] =>
  (JSON.parse(json) as RawPr[]).map(raw => ({
    number: raw.number,
    title: raw.title,
    url: raw.url ?? '',
    author: raw.author?.login ?? '',
    branch: raw.headRefName,
    isDraft: raw.isDraft,
    ci: ciOf(raw.statusCheckRollup),
    review: raw.reviewDecision ?? '',
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    updatedAt: raw.updatedAt ?? '',
    sha: raw.headRefOid ?? '',
    ...failingOf(raw.statusCheckRollup),
    issues: issuesOf(raw.closingIssuesReferences ?? [], raw.body ?? ''),
    mergeState: raw.mergeStateStatus ?? '',
    reviewers: (raw.reviewRequests ?? []).flatMap(one => (one ? [one.login ? `@${one.login}` : (one.name ?? one.slug ?? '')] : [])).filter(Boolean),
    openThreads: 0,
  }))

// The open pull requests' review threads, to count the ones still open; gh pr list can't give them.
export const THREADS_QUERY =
  'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequests(states: OPEN, first: 50) { nodes { number reviewThreads(first: 100) { nodes { isResolved } } } } } }'

// How many review threads are open on each pull request, by number; none known from an answer that isn't the query's.
export const threadsOf = (json: string): Map<number, number> => {
  type Raw = { data?: { repository?: { pullRequests?: { nodes?: ({ number: number; reviewThreads?: { nodes?: ({ isResolved: boolean } | null)[] } } | null)[] } } } }
  try {
    const nodes = (JSON.parse(json) as Raw | null)?.data?.repository?.pullRequests?.nodes ?? []
    return new Map(nodes.flatMap(pr => (pr ? [[pr.number, (pr.reviewThreads?.nodes ?? []).filter(thread => thread && !thread.isResolved).length] as const] : [])))
  } catch {
    return new Map()
  }
}

// Why a pull request can't merge as it stands, from GitHub's merge state: conflicts with its base, or behind it.
export const mergeNoteOf = (pr: PullRequest): { text: string; color: ThemeKey } | null =>
  pr.mergeState === 'DIRTY' ? { text: '⚠ conflicts', color: 'error' } : pr.mergeState === 'BEHIND' ? { text: '↓ behind', color: 'warning' } : null

type RawComment = { author?: { login?: string } | null; body?: string | null; createdAt?: string }

// An issue's comments from `gh issue view --json comments`, oldest first.
export const commentsOf = (json: string): Comment[] =>
  ((JSON.parse(json) as { comments?: RawComment[] | null }).comments ?? []).map(one => ({ author: one.author?.login ?? 'ghost', body: (one.body ?? '').trim(), at: one.createdAt ?? '' }))

// An issue's comments as GitHub's REST answers them, oldest first.
export const restCommentsOf = (items: unknown[]): Comment[] =>
  (items as { user?: { login?: string } | null; body?: string | null; created_at?: string }[]).map(one => ({
    author: one.user?.login ?? 'ghost',
    body: (one.body ?? '').trim(),
    at: one.created_at ?? '',
  }))

// How many comments the issues tool shows, the latest, and how much of each.
export const TOOL_COMMENTS = 10
const TOOL_COMMENT_TEXT = 1500

// An issue's latest comments for Claude, newest last, each with who wrote it and when; and how many earlier ones are
// left out of `total`.
export const commentsText = (comments: Comment[], total: number, now: number): string => {
  if (total === 0) return 'No comments.'
  const shown = comments.slice(-TOOL_COMMENTS)
  const left = total - shown.length
  return [
    left > 0 ? `Comments (the latest ${shown.length} of ${total}; ${left} earlier left out):` : `Comments (${total}):`,
    ...shown.map(one => {
      const when = one.at ? ago(one.at, now) : ''
      const text = one.body.length > TOOL_COMMENT_TEXT ? `${one.body.slice(0, TOOL_COMMENT_TEXT - 1)}…` : one.body
      return `— @${one.author}${when ? `, ${when === 'now' ? 'just now' : `${when} ago`}` : ''}:\n${text.replace(/^/gm, '  ')}`
    }),
  ].join('\n')
}

// What Ask Claude to answer hands Claude: the issue, the comment to answer, and how to reply.
export const answerPrompt = (issue: Issue, comment: Comment): string => {
  const quoted = comment.body.length > 400 ? `${comment.body.slice(0, 399)}…` : comment.body
  return (
    `Answer the latest comment on #${issue.number}: ${issue.title}. @${comment.author} wrote:\n\n${quoted.replace(/^/gm, '> ')}\n\n` +
    `Read the whole thread with \`gh issue view ${issue.number} --comments\` first. Then reply on the issue with the mcp__issue-board__issue_update tool's comment.`
  )
}

// `Closes #N` and its kin, and `Refs #N`: a pull request saying which issue it is for, closing it or not.
const REFERENCE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\b:?\s+#(\d+)/gi

// The issues a pull request is for: the ones GitHub links as closing, then the ones its body refers to.
export const issuesOf = (closing: { number: number }[], body: string): number[] => [
  ...new Set([...closing.map(one => one.number), ...[...body.matchAll(REFERENCE)].map(match => Number(match[1]))]),
]

const hasLabel = (issue: Issue, name: string): boolean => issue.labels.some(label => label.name === name)

export const isBug = (issue: Issue): boolean => hasLabel(issue, 'bug')
export const isFuture = (issue: Issue): boolean => hasLabel(issue, 'future')

export const areaOf = (issue: Issue): string => {
  const label = issue.labels.find(one => one.name.startsWith('area:'))
  return label ? label.name.slice('area:'.length) : 'other'
}

// The labels worth a chip on a row: not the area it is grouped under, not bug (a badge of its own).
export const chipsOf = (issue: Issue): Label[] => issue.labels.filter(one => !one.name.startsWith('area:') && one.name !== 'bug')

// A label's color as a surface draws it: GitHub's hex, or nothing for a label without one.
export const hex = (label: Label): string | undefined => (/^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : undefined)

// Whether the issue belongs under the filter; `viewer` is the login Mine means. With a project, Active is Now (P0 and
// P1) and Future is Later (P2); without one they read the `future` label.
export const matches = (filter: Filter, issue: Issue, viewer: string | null = null, project: Project | null = null): boolean => {
  switch (filter) {
    case 'active':
      return project ? isNow(project, issue) : !isFuture(issue)
    case 'future':
      return project ? isLater(project, issue) : isFuture(issue)
    case 'bugs':
      return isBug(issue)
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

// The Status an issue moves to out of the Inbox when Claude didn't say: Ready for Now's priorities, Backlog otherwise.
export const statusFor = (project: Project | null, priority: string | null): 'Ready' | 'Backlog' => (priorityRank(project, priority) < nowCountOf(project) ? 'Ready' : 'Backlog')

// How much of an issue's text Claude reads to triage it.
const TRIAGE_TEXT = 1500

// What the Inbox asks Claude: a Priority, an area and a Status for each issue, as JSON.
export const triagePrompt = (repo: string, issues: Issue[], priorities: { name: string; description: string }[], areas: string[]): string =>
  [
    `Triage these new GitHub issues of ${repo}. For each, suggest:`,
    priorities.length > 0
      ? `- priority: one of ${priorities.map(one => (one.description ? `${one.name} (${one.description})` : one.name)).join(', ')};`
      : '- priority: null, as the project has no Priority field;',
    areas.length > 0 ? `- area: the part of the repository it is about, one of ${areas.join(', ')}, or null when none fits;` : '- area: null, as the repository has no area labels;',
    '- status: "Ready" when it is clear enough to start on now, "Backlog" when it should wait;',
    '- reason: one short, plain sentence saying why.',
    'Keep a Priority or area the issue already has unless it is clearly wrong.',
    'Answer with one JSON array and nothing else: [{"number": 1, "priority": "P1", "area": "...", "status": "Ready", "reason": "..."}].',
    ...issues.flatMap(issue => {
      const text = issue.body.trim()
      return [
        '',
        `#${issue.number} ${issue.title}`,
        `Labels: ${issue.labels.map(label => label.name).join(', ') || 'none'}. Priority: ${issue.priority ?? 'none'}.`,
        ...(text ? [text.length > TRIAGE_TEXT ? `${text.slice(0, TRIAGE_TEXT - 1)}…` : text] : []),
      ]
    }),
  ].join('\n')

// Claude's suggestions read back from its answer, one per issue asked about, keeping only the priorities and areas
// offered; a Status it didn't give follows the priority.
export const parseTriage = (text: string, issues: Issue[], priorities: string[], areas: string[], project: Project | null = null): Suggestion[] => {
  const json = /\[[\s\S]*\]/.exec(text)?.[0]
  let raw: unknown
  try {
    raw = json ? JSON.parse(json) : null
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const named = (list: string[], value: unknown) => (typeof value === 'string' ? (list.find(one => one.toLowerCase() === value.replace(/^area:/i, '').trim().toLowerCase()) ?? null) : null)
  const made: Suggestion[] = []
  for (const one of raw as Record<string, unknown>[]) {
    const issue = issues.find(each => each.number === one?.number)
    if (!issue || made.some(each => each.number === issue.number)) continue
    const priority = named(priorities, one.priority)
    const status = typeof one.status === 'string' && /^backlog$/i.test(one.status.trim()) ? 'Backlog' : typeof one.status === 'string' && /^ready$/i.test(one.status.trim()) ? 'Ready' : statusFor(project, priority)
    const reason = typeof one.reason === 'string' ? fit(one.reason.replace(/\s+/g, ' ').trim(), 200) : ''
    made.push({ number: issue.number, priority, area: named(areas, one.area), status, reason, updatedAt: issue.updatedAt })
  }
  return made
}

// Whether the issue matches what was typed in the search field: words of its title, `#42` or `42`, or a label.
export const searched = (query: string, issue: Issue): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = `#${issue.number} ${issue.title} ${issue.labels.map(label => label.name).join(' ')}`.toLowerCase()
  return words.every(word => haystack.includes(word))
}

// Bugs first, then issues under way (some boxes ticked), then the newest.
const rank = (issue: Issue): number => {
  if (isBug(issue)) return 0
  const done = issue.checks.filter(check => check.done).length
  return done > 0 && done < issue.checks.length ? 1 : 2
}

export const byArea = (issues: Issue[]): [string, Issue[]][] => {
  const groups = new Map<string, Issue[]>()
  for (const issue of issues) {
    const area = areaOf(issue)
    groups.set(area, [...(groups.get(area) ?? []), issue])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)))
    .map(([area, list]) => [area, [...list].sort((a, b) => rank(a) - rank(b) || b.number - a.number)])
}

// Whether an issue waits on another that is still open.
export const isBlocked = (issue: Issue): boolean => (issue.blockedBy ?? []).length > 0

// The most pressing first: by priority when there is a project, then bugs, issues under way and the newest. With
// `readyFirst`, as within an epic, the ones nothing blocks come before the ones that wait, and the oldest before the
// newest: an epic's sub-issues are mostly written in the order they're meant to be done.
export const sortIssues = (issues: Issue[], project: Project | null = null, readyFirst = false, order?: number[]): Issue[] => {
  // GitHub's order of an epic's sub-issues settles what the board has no reason to: one it doesn't list goes last.
  const at = (issue: Issue) => {
    const index = order?.indexOf(issue.number) ?? -1
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  return [...issues].sort(
    (a, b) =>
      (readyFirst ? Number(isBlocked(a)) - Number(isBlocked(b)) : 0) ||
      priorityRank(project, a.priority) - priorityRank(project, b.priority) ||
      rank(a) - rank(b) ||
      (order ? at(a) - at(b) : 0) ||
      (readyFirst ? a.number - b.number : b.number - a.number),
  )
}

// The sub-issue an epic's Next starts: the first open one nothing blocks, in the order the epic lists them.
export const nextOf = (issues: Issue[], epic: number, project: Project | null = null): Issue | undefined =>
  sortIssues(
    issues.filter(issue => issue.parent?.number === epic),
    project,
    true,
    issues.find(issue => issue.number === epic)?.subOrder,
  ).find(issue => !isBlocked(issue))

// What Start on an issue starts. An epic is worked one sub-issue at a time, so Start on one starts its next ready
// sub-issue, as Next does; null when none is ready. Any other issue starts itself.
export const startTargetOf = (issues: Issue[], issue: Issue, project: Project | null = null): Issue | null =>
  (issue.subIssues?.total ?? 0) > 0 ? (nextOf(issues, issue.number, project) ?? null) : issue

// What Start on an epic says when it has no sub-issue to start.
export const noReadyText = (epic: number): string => `Epic #${epic} has no ready sub-issue to start: each open one is blocked, or none is open.`

// A heading of the issue list and the issues under it. `folded`: drawn shut until the person opens it, as the Backlog
// option is.
// `epic`: the parent the group is for, so its row isn't drawn again beneath it.
export type Group = { key: string; title: string; issues: Issue[]; folded: boolean; epic?: { number: number; total: number; completed: number } }

// The issues in groups: by the project's Status in the project's order, by the epic they are sub-issues of, or by
// `area:` label. Issues that don't fit a group come last, under No status, No epic or other.
export const groupsOf = (issues: Issue[], by: GroupBy, project: Project | null = null): Group[] => {
  if (by === 'status' && project) {
    const named = (project.status?.options ?? []).map(option => ({
      key: `status:${option.name}`,
      title: option.name,
      issues: sortIssues(issues.filter(issue => issue.status === option.name), project),
      folded: isRole(project, option.name, 'backlog'),
    }))
    const known = new Set(named.map(group => group.title))
    const rest = sortIssues(issues.filter(issue => !issue.status || !known.has(issue.status)), project)
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
        ),
        folded: false,
        epic: { number: parent.number, total: parent.total, completed: parent.completed },
      }))
    // An open epic is its group's heading, so it isn't listed again under No epic.
    const rest = sortIssues(issues.filter(issue => !issue.parent && !parents.has(issue.number)), project)
    return [...epics, { key: 'epic:none', title: 'No epic', issues: rest, folded: false }].filter(group => group.issues.length > 0)
  }
  return byArea(issues).map(([area, list]) => ({ key: `area:${area}`, title: area, issues: project ? sortIssues(list, project) : list, folded: false }))
}

type RawNodes<T> = { nodes?: (T | null)[] | null } | null | undefined
type RawField = { id?: string; name?: string; dataType?: string; options?: { id: string; name: string }[]; configuration?: { iterations?: { id: string; title: string }[] } | null }

// The kind of each field the board can set, by GitHub's data type; the rest, such as Assignees or Labels, are the issue's.
const KINDS: Record<string, ProjectField['kind']> = { TEXT: 'text', NUMBER: 'number', DATE: 'date', ITERATION: 'iteration', SINGLE_SELECT: 'select' }
const fieldsOf = (project: RawProject): ProjectField[] =>
  nodesOf(project.fields).flatMap(one => {
    const kind = one.dataType ? KINDS[one.dataType] : one.options ? 'select' : undefined
    if (!one.id || !one.name || !kind) return []
    const options = kind === 'iteration' ? (one.configuration?.iterations ?? []).map(it => ({ id: it.id, name: it.title })) : one.options
    return [{ id: one.id, name: one.name, kind, ...(options ? { options } : {}) }]
  })
type RawUpdate = { status?: string | null; body?: string | null; createdAt: string; startDate?: string | null; targetDate?: string | null }
type RawProject = {
  id: string
  number: number
  title: string
  url: string
  closed?: boolean
  fields?: RawNodes<RawField>
  statusUpdates?: RawNodes<RawUpdate>
  workflows?: RawNodes<{ name: string; enabled: boolean }>
}
type RawValue = { name?: string } | null | undefined
type RawItem = { id: string; project?: { id: string } | null; status?: RawValue; priority?: RawValue }
type RawGraphIssue = {
  id: string
  number: number
  title: string
  url?: string
  body?: string | null
  updatedAt: string
  labels?: RawNodes<RawLabel>
  assignees?: RawNodes<RawUser>
  milestone?: { title: string } | null
  parent?: { number: number; title: string; subIssuesSummary?: { total: number; completed: number } | null } | null
  subIssuesSummary?: { total: number; completed: number } | null
  blockedBy?: RawNodes<{ number: number; state: string }>
  closedByPullRequestsReferences?: RawNodes<{ number: number }>
  projectItems?: RawNodes<RawItem>
  comments?: { totalCount?: number } | null
  issueType?: { name: string } | null
}
type RawPage = { data?: { repository?: { issueTypes?: RawNodes<{ name: string }>; projectsV2?: RawNodes<RawProject>; issues?: { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes?: (RawGraphIssue | null)[] } } } }

const nodesOf = <T>(list: RawNodes<T>): T[] => (list?.nodes ?? []).filter((one): one is T => one !== null && one !== undefined)

const fieldOf = (project: RawProject, name: string): Field | null => {
  const field = nodesOf(project.fields).find(one => one.id && one.name?.toLowerCase() === name.toLowerCase() && one.options)
  return field?.id && field.options ? { id: field.id, options: field.options } : null
}

// GitHub's status of a project update in words, and back.
const STATUS_WORDS: Record<string, string> = { ON_TRACK: 'On track', AT_RISK: 'At risk', OFF_TRACK: 'Off track', COMPLETE: 'Complete', INACTIVE: 'Inactive' }
export const statusEnumOf = (words: string): string | undefined => Object.entries(STATUS_WORDS).find(([, said]) => said.toLowerCase() === words.trim().toLowerCase())?.[0]
export const updateWords = (status: string): string => STATUS_WORDS[status] ?? status

const updateOf = (raw: RawUpdate | undefined): StatusUpdate | null =>
  raw ? { status: updateWords(raw.status ?? ''), body: (raw.body ?? '').trim(), at: raw.createdAt, start: raw.startDate ?? null, target: raw.targetDate ?? null } : null

// A status update in a line: how the project stands, the note's first line, and when.
export const updateLine = (update: StatusUpdate, now: number): string => {
  const when = ago(update.at, now)
  const note = update.body.split('\n')[0]?.trim() ?? ''
  return [update.status, note, update.target ? `target ${update.target}` : '', when === 'now' ? 'just now' : when ? `${when} ago` : ''].filter(Boolean).join(' · ')
}

// Where the next page of issues starts, or null after the last.
export const nextPageOf = (json: string): string | null => {
  const info = (JSON.parse(json) as RawPage).data?.repository?.issues?.pageInfo
  return info?.hasNextPage && info.endCursor ? info.endCursor : null
}

// The issues of every page, and the repo's project, read from the first page: the one `/issues setup` saved when it's
// still linked and open, else the first open one linked to the repo.
export const parseGraph = (pages: string[], preferred?: string): { issues: Issue[]; project: Project | null; types: string[] } => {
  const parsed = pages.map(page => JSON.parse(page) as RawPage)
  const open = nodesOf(parsed[0]?.data?.repository?.projectsV2).filter(one => !one.closed)
  const linked = open.find(one => one.id === preferred) ?? open[0]
  const project: Project | null = linked
    ? {
        id: linked.id,
        number: linked.number,
        title: linked.title,
        url: linked.url,
        status: fieldOf(linked, 'Status'),
        priority: fieldOf(linked, 'Priority'),
        fields: fieldsOf(linked),
        update: updateOf(nodesOf(linked.statusUpdates).at(-1)),
        closesToDone: nodesOf(linked.workflows).some(one => one.name === 'Item closed' && one.enabled),
      }
    : null
  const issues = parsed.flatMap(page => (page.data?.repository?.issues?.nodes ?? []).filter((one): one is RawGraphIssue => one !== null))
  return {
    types: nodesOf(parsed[0]?.data?.repository?.issueTypes).map(one => one.name),
    project,
    issues: issues.map(raw => {
      const item = project ? nodesOf(raw.projectItems).find(one => one.project?.id === project.id) : undefined
      const parent = raw.parent
      return {
        number: raw.number,
        title: raw.title,
        url: raw.url ?? '',
        labels: nodesOf(raw.labels).map(label => ({ name: label.name, color: label.color ?? '' })),
        assignees: nodesOf(raw.assignees).map(user => user.login),
        checks: checksOf(raw.body ?? null),
        updatedAt: raw.updatedAt,
        body: raw.body ?? '',
        id: raw.id,
        item: item?.id ?? null,
        status: item?.status?.name ?? null,
        priority: item?.priority?.name ?? null,
        milestone: raw.milestone?.title ?? null,
        parent: parent ? { number: parent.number, title: parent.title, total: parent.subIssuesSummary?.total ?? 0, completed: parent.subIssuesSummary?.completed ?? 0 } : null,
        subIssues: { total: raw.subIssuesSummary?.total ?? 0, completed: raw.subIssuesSummary?.completed ?? 0 },
        blockedBy: nodesOf(raw.blockedBy).filter(one => one.state === 'OPEN').map(one => one.number),
        prs: nodesOf(raw.closedByPullRequestsReferences).map(one => one.number),
        ...(typeof raw.comments?.totalCount === 'number' ? { comments: raw.comments.totalCount } : {}),
        ...(raw.issueType ? { type: raw.issueType.name } : {}),
      }
    }),
  }
}

// The open pull requests for an issue: the ones GitHub says close it, and the ones that say they are for it.
export const prsFor = (issue: Issue, prs: PullRequest[]): PullRequest[] =>
  prs.filter(pr => (issue.prs ?? []).includes(pr.number) || (pr.issues ?? []).includes(issue.number))

export type Progress = { done: number; total: number }

// The lines a wrapping row of items takes, each item its width in cells and `gap` cells between two on a line.
export const wrappedLines = (widths: number[], width: number, gap = 1): number => {
  let lines = 1
  let used = 0
  for (const one of widths) {
    if (used > 0 && used + gap + one > width) {
      lines += 1
      used = 0
    }
    used += (used > 0 ? gap : 0) + one
  }
  return lines
}

// What a row's hover card holds, given the lines free above the row: the title and how far along, then up to four open
// boxes, "+N more" for the rest, and the hint line. Short of room, it drops the hint and lists the boxes that fit. Null
// when not even the title and how far along fit. The card only ever goes above its row: a floating box paints over what
// is drawn before it, and the rows after it would paint over a card below.
export type PeekPlace = { listed: number; more: boolean; hint: boolean }
export const peekPlace = (above: number, todo: number): PeekPlace | null => {
  const listed = Math.min(todo, 4)
  const more = todo > listed
  // Two lines of border, the title, how far along and the hint.
  if (above >= 5 + listed + (more ? 1 : 0)) return { listed, more, hint: true }
  const spare = above - 4
  if (spare < 0) return null
  if (spare >= listed + (more ? 1 : 0)) return { listed, more, hint: false }
  const fits = Math.max(0, spare - 1)
  return { listed: fits, more: spare > fits, hint: false }
}

export const progress = (checks: Check[]): Progress => ({ done: checks.filter(check => check.done).length, total: checks.length })

export const sumProgress = (issues: Issue[]): Progress =>
  issues.reduce((sum, issue) => {
    const one = progress(issue.checks)
    return { done: sum.done + one.done, total: sum.total + one.total }
  }, { done: 0, total: 0 })

export const progressOf = (checks: Check[]): string => {
  const { done, total } = progress(checks)
  if (total === 0) return '  -  '
  return `${String(done).padStart(2)}/${String(total).padEnd(2)}`
}

// A bar of `width` cells, filled in proportion: the filled and the empty run, drawn in two colors.
export const bar = ({ done, total }: Progress, width: number): [string, string] => {
  if (total === 0) return ['', '╌'.repeat(width)]
  const filled = done === total ? width : Math.min(width - 1, Math.round((done / total) * width))
  return ['━'.repeat(filled), '━'.repeat(width - filled)]
}

// How far along, as the color the bar is drawn in.
export const tone = ({ done, total }: Progress): ThemeKey => (total > 0 && done === total ? 'success' : done > 0 ? 'warning' : 'inactive')

export const ciMark: Record<Ci, string> = { pass: '✓', fail: '✗', pending: '…', none: '·' }

export const ciBadge: Record<Ci, { text: string; color: ThemeKey }> = {
  pass: { text: ' ✓ PASS ', color: 'success' },
  fail: { text: ' ✗ FAIL ', color: 'error' },
  pending: { text: ' ◷ CI ', color: 'warning' },
  none: { text: ' · NO CI ', color: 'inactive' },
}

export const reviewBadge = (pr: PullRequest): { text: string; color: ThemeKey } | undefined => {
  if (pr.isDraft) return { text: 'draft', color: 'inactive' }
  switch (pr.review) {
    case 'APPROVED':
      return { text: '● approved', color: 'success' }
    case 'CHANGES_REQUESTED':
      return { text: '● changes requested', color: 'error' }
    case 'REVIEW_REQUIRED':
      return { text: '○ review required', color: 'warning' }
    default:
      return undefined
  }
}

export const clockTime = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// How long ago, the way GitHub's lists say it: now, 5m, 3h, 2d, 6w, 1y.
export const ago = (iso: string, now: number): string => {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  if (days < 365) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 365)}y`
}

// Characters a terminal draws two cells wide: emoji shown as emoji, such as ⛔, and East Asian wide characters.
const WIDE = /\p{Emoji_Presentation}|[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]/u
// Characters drawn on the one before them, taking no cell: combining marks, variation selectors, the emoji joiner.
const ZERO = /\p{Mn}|\p{Me}|[​-‍︀-️]/u

const cellsOf = (char: string): number => (ZERO.test(char) ? 0 : WIDE.test(char) ? 2 : 1)

// How many terminal cells `text` takes, which isn't its length when it holds emoji or wide characters.
export const cells = (text: string): number => [...text].reduce((sum, char) => sum + cellsOf(char), 0)

// `text` cut to `width` cells, an ellipsis standing in for what was cut. Counted in cells, so a line holding ⛔ isn't a
// cell wider than it should be and doesn't wrap.
export const fit = (text: string, width: number): string => {
  if (width <= 0) return ''
  if (cells(text) <= width) return text
  let kept = ''
  let used = 0
  for (const char of text) {
    const size = cellsOf(char)
    if (used + size > width - 1) break
    kept += char
    used += size
  }
  return `${kept}…`
}

// What an issue's row has room for. `left` is the cells before the title; each right-hand part is its width in cells,
// 0 when the row has none, and `rest` the parts that always stay. A narrow pane drops the label chips first, then the
// progress bar, then the age, until the title has `floor` cells. The title gets whatever is left, so the row stays on
// one line.
export const rowRoom = (
  width: number,
  left: number,
  parts: { chips: number; bar: number; age: number; rest: number },
  floor = 24,
): { chips: boolean; bar: boolean; age: boolean; title: number } => {
  const shown = { chips: parts.chips > 0, bar: parts.bar > 0, age: parts.age > 0 }
  const room = () => width - left - parts.rest - (shown.chips ? parts.chips : 0) - (shown.bar ? parts.bar : 0) - (shown.age ? parts.age : 0)
  for (const part of ['chips', 'bar', 'age'] as const) {
    if (room() >= floor) break
    shown[part] = false
  }
  return { ...shown, title: Math.max(1, room()) }
}

// `text` padded with spaces to `width` cells.
export const pad = (text: string, width: number): string => `${text}${' '.repeat(Math.max(0, width - cells(text)))}`

// The board in a line, such as `35 issues · 1 bug · PR #335✓`; undefined with nothing open, so nothing shows.
export const summary = (issues: Issue[], prs: PullRequest[]): string | undefined => {
  const bugs = issues.filter(isBug).length
  const parts: string[] = []
  if (issues.length > 0) parts.push(`${issues.length} issue${issues.length === 1 ? '' : 's'}`)
  if (bugs > 0) parts.push(`${bugs} bug${bugs === 1 ? '' : 's'}`)
  if (prs.length > 0) parts.push(`PR ${prs.map(pr => `#${pr.number}${ciMark[pr.ci]}`).join(' ')}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

// The message the Start and Draft buttons hand Claude for an issue. `tasks`: Start made a task for each open box.
export const startPrompt = (issue: Issue, tasks = false): string => {
  const open = issue.checks.filter(check => !check.done)
  const listed = tasks ? '\n\nEach is a task in your task list too: mark it completed when it is done.' : ''
  const boxes = open.length > 0 ? `\n\nIts open acceptance boxes:\n${open.map(check => `- ${check.text}`).join('\n')}${listed}` : ''
  return `Let's start on #${issue.number}: ${issue.title}. Read it with \`gh issue view ${issue.number}\` first.${boxes}`
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const WEEKS = 12

// The day `weeks` weeks before `now`, as GitHub's search reads a date.
export const since = (now: number, weeks = WEEKS): string => new Date(now - weeks * WEEK_MS).toISOString().slice(0, 10)

// How many of the times fall in each of the last `weeks` weeks, oldest first.
export const weekly = (times: string[], now: number, weeks = WEEKS): number[] => {
  const counts = Array.from({ length: weeks }, () => 0)
  for (const iso of times) {
    const back = Math.floor((now - Date.parse(iso)) / WEEK_MS)
    if (back >= 0 && back < weeks) counts[weeks - 1 - back] = (counts[weeks - 1 - back] ?? 0) + 1
  }
  return counts
}

// The times under `field` in gh's JSON list, such as each issue's closedAt.
export const timesOf = (json: string, field: string): string[] =>
  (JSON.parse(json) as Record<string, unknown>[]).flatMap(raw => (typeof raw[field] === 'string' ? [raw[field] as string] : []))

const BLOCKS = '▁▂▃▄▅▆▇█'

// One block a week, as tall as that week against the busiest.
export const spark = (counts: number[]): string => {
  const top = Math.max(0, ...counts)
  return counts.map(count => (top === 0 ? BLOCKS[0] : BLOCKS[Math.round((count / top) * (BLOCKS.length - 1))])).join('')
}

// What the band above the prompt raises, minus what the person waved off: failing CI, CI that went green while the board
// watched, then the issue Claude is on.
export const alertsOf = (board: Board, working: Working | null, dismissed: string[], greened: string[] = []): Alert[] => {
  const alerts: Alert[] = [
    ...board.prs.filter(pr => pr.ci === 'fail').map(pr => ({ kind: 'ci' as const, key: `ci-${pr.number}-${pr.updatedAt}`, pr })),
    ...board.prs
      .filter(pr => pr.ci === 'pass' && greened.includes(greenKey(pr)))
      .map(pr => ({ kind: 'pass' as const, key: `pass-${greenKey(pr)}`, pr })),
  ]
  if (working) {
    const issue = board.issues.find(one => one.number === working.number)
    if (!issue) alerts.push({ kind: 'closed', key: `closed-${working.number}`, working })
    else if (issue.updatedAt > working.updatedAt) alerts.push({ kind: 'activity', key: `activity-${issue.number}-${issue.updatedAt}`, issue })
  }
  return alerts.filter(alert => !dismissed.includes(alert.key))
}

// How `greened` names one CI run of a pull request.
export const greenKey = (pr: PullRequest): string => `${pr.number}-${pr.sha}`

// The pull requests whose CI was running on the last board and passes on this one.
export const wentGreen = (before: Board | null, after: Board): PullRequest[] =>
  after.prs.filter(pr => pr.ci === 'pass' && before?.prs.some(old => old.number === pr.number && old.ci === 'pending'))

// The message the band's Fix button hands Claude for a pull request whose CI failed.
export const fixPrompt = (pr: PullRequest): string => {
  const names = pr.failing ?? []
  const runs = pr.runs ?? []
  const which = names.length > 0 ? ` The failing ${names.length === 1 ? 'check is' : 'checks are'} ${names.join(', ')}.` : ''
  const logs =
    runs.length > 0
      ? `Read the failure with ${runs.map(run => `\`gh run view ${run} --log-failed\``).join(' and ')}`
      : `Look at \`gh pr checks ${pr.number}\` and the failing run's log`
  return `CI is failing on PR #${pr.number}: ${pr.title} (branch \`${pr.branch}\`).${which} ${logs}, then fix it.`
}

const CLOSE_OUT_RULES =
  "Follow the repository's contributing guidelines, merge only once its required checks pass, and don't bypass branch protection or force-push. If it can't be merged, say what's blocking it."

// One pull request handed to Claude to see through: CI green, review answered, merged.
export const closeOutPrompt = (pr: PullRequest): string => {
  const draft = pr.isDraft ? ' It is a draft: finish it and mark it ready first.' : ''
  return (
    `Close out PR #${pr.number}: ${pr.title} (branch \`${pr.branch}\`). Read it with \`gh pr view ${pr.number}\` and \`gh pr checks ${pr.number}\`, ` +
    `fix any failing CI and answer any review on its branch, then merge it.${draft} ${CLOSE_OUT_RULES}`
  )
}

// Every open pull request, merged one at a time, oldest first, each brought up to date with what merged before it.
export const closeOutAllPrompt = (prs: PullRequest[]): string => {
  const list = [...prs]
    .sort((a, b) => a.number - b.number)
    .map(pr => `- #${pr.number}: ${pr.title} (\`${pr.branch}\`, CI ${pr.ci}${pr.isDraft ? ', draft' : ''})`)
    .join('\n')
  return (
    `Merge all ${prs.length} open pull ${prs.length === 1 ? 'request' : 'requests'}:\n${list}\n\n` +
    'Take them one at a time, oldest first. For each, read it with `gh pr view` and `gh pr checks`, fix any failing CI and answer any review, ' +
    'bring its branch up to date with what merged before it, and merge it once its checks pass. Finish a draft and mark it ready first. ' +
    `${CLOSE_OUT_RULES} Then move on to the next, and end with which merged and which didn't.`
  )
}

// The body with the task-list boxes at `boxes` (counted from 1, in the body's order) set to `done`; `changed` the boxes
// that flipped, `missing` the numbers past the last box.
export const tickBody = (body: string, boxes: number[], done: boolean): { body: string; changed: number[]; missing: number[] } => {
  const changed: number[] = []
  let seen = 0
  // Split on \n alone and match without a trailing \r, so a body the web editor saved with \r\n keeps its line endings.
  const lines = body.split('\n').map(line => {
    const match = BOX.exec(line.endsWith('\r') ? line.slice(0, -1) : line)
    if (!match) return line
    seen += 1
    if (!boxes.includes(seen) || (match[1] !== ' ') === done) return line
    changed.push(seen)
    return line.replace(/\[[ xX]\]/, done ? '[x]' : '[ ]')
  })
  return { body: lines.join('\n'), changed, missing: boxes.filter(box => box < 1 || box > seen) }
}

// Adds boxes to a body's acceptance list, after its last box, or under a new `## Acceptance` heading at the end when it
// has none. The rest stays as written, \r\n endings included.
export const addBoxes = (body: string, texts: string[]): string => {
  const crlf = body.includes('\r\n')
  const eol = crlf ? '\r\n' : '\n'
  const lines = body.split('\n')
  const last = lines.findLastIndex(line => BOX.test(line.endsWith('\r') ? line.slice(0, -1) : line))
  const boxes = texts.map(text => `- [ ] ${text.trim()}`)
  if (last >= 0) {
    // Each new box takes the line ending of the box before it.
    const ending = lines[last]?.endsWith('\r') ? '\r' : ''
    lines.splice(last + 1, 0, ...boxes.map(box => `${box}${ending}`))
    return lines.join('\n')
  }
  const kept = body.replace(/\s+$/, '')
  return `${kept}${kept ? `${eol}${eol}` : ''}## Acceptance${eol}${boxes.join(eol)}${eol}`
}

// Rewords boxes by number, counted as the tick tool counts them, keeping whether each is ticked. Answers the body and
// the numbers it has no box for.
export const rewordBoxes = (body: string, edits: { box: number; text: string }[]): { body: string; missing: number[] } => {
  let seen = 0
  const lines = body.split('\n').map(line => {
    const end = line.endsWith('\r') ? '\r' : ''
    const bare = end ? line.slice(0, -1) : line
    if (!BOX.test(bare)) return line
    seen += 1
    const edit = edits.find(one => one.box === seen)
    return edit ? `${bare.replace(/(\[[ xX]\]\s+).*$/, `$1${edit.text.trim()}`)}${end}` : line
  })
  return { body: lines.join('\n'), missing: edits.map(one => one.box).filter(box => box < 1 || box > seen) }
}

// What the board knows of one issue, a fact a line, its boxes numbered as the tick tool counts them.
const issueLines = (issue: Issue): string[] => {
  const step = progress(issue.checks)
  return [
    `#${issue.number} ${issue.title}`,
    issue.url,
    `Labels: ${issue.labels.map(label => label.name).join(', ') || 'none'}`,
    `Assignees: ${issue.assignees.join(', ') || 'none'}`,
    issue.status || issue.priority ? `Status: ${issue.status ?? 'none'}. Priority: ${issue.priority ?? 'none'}.` : '',
    issue.milestone ? `Milestone: ${issue.milestone}` : '',
    issue.type ? `Type: ${issue.type}` : '',
    issue.parent ? `Sub-issue of #${issue.parent.number}: ${issue.parent.title}` : '',
    (issue.subIssues?.total ?? 0) > 0 ? `Sub-issues: ${issue.subIssues?.completed}/${issue.subIssues?.total} closed` : '',
    (issue.blockedBy ?? []).length > 0 ? `Blocked by: ${issue.blockedBy?.map(number => `#${number}`).join(', ')}` : '',
    `Updated: ${issue.updatedAt}`,
    step.total > 0 ? `Boxes (${step.done}/${step.total} ticked):` : 'Boxes: none',
    ...issue.checks.map((check, index) => `${index + 1}. [${check.done ? 'x' : ' '}] ${check.text}`),
  ].filter(line => line !== '')
}

// One issue as the issues tool answers it.
export const issueText = (issue: Issue): string =>
  [...issueLines(issue), `This is the board's copy, without the body's other text. Read the whole issue with \`gh issue view ${issue.number}\`.`].join('\n')

// Issues as GitHub's REST answers them, a list or search results; pull requests, which the same endpoints mix in, left out.
export const foundOf = (items: unknown[]): Found[] =>
  (items as {
    number: number
    title: string
    html_url?: string
    state: string
    state_reason?: string | null
    closed_at?: string | null
    labels?: ({ name?: string } | string)[]
    pull_request?: unknown
  }[])
    .filter(raw => !raw.pull_request)
    .map(raw => ({
      number: raw.number,
      title: raw.title,
      url: raw.html_url ?? '',
      state: raw.state === 'closed' ? 'closed' : 'open',
      reason: raw.state_reason ?? null,
      closedAt: raw.closed_at ?? null,
      labels: (raw.labels ?? []).map(label => (typeof label === 'string' ? label : (label.name ?? ''))).filter(Boolean),
    }))

// How an issue stands, in a few words: open, or closed, how and when.
export const standing = (found: Found, now: number): string => {
  if (found.state === 'open') return 'open'
  const when = found.closedAt ? ago(found.closedAt, now) : ''
  return `closed${found.reason ? ` as ${found.reason.replace('_', ' ')}` : ''}${when ? ` ${when === 'now' ? 'just now' : `${when} ago`}` : ''}`
}

// One line a found issue, as the issues tool lists it.
export const foundLine = (found: Found, now: number): string =>
  `#${found.number} ${found.title} · ${standing(found, now)}${found.labels.length > 0 ? ` · ${found.labels.join(', ')}` : ''}`

// GitHub's search terms for the repo's issues: a state, words, and a label, assignee or milestone.
export const searchTerms = (repo: string, ask: { state?: string; search?: string; label?: string; assignee?: string; milestone?: string }): string => {
  const quoted = (value: string) => (/\s/.test(value) ? `"${value}"` : value)
  return [
    `repo:${repo}`,
    'is:issue',
    ask.state === 'open' || ask.state === 'closed' ? `state:${ask.state}` : '',
    ask.label ? `label:${quoted(ask.label)}` : '',
    ask.assignee ? `assignee:${ask.assignee}` : '',
    ask.milestone ? `milestone:${quoted(ask.milestone)}` : '',
    ask.search?.trim() ?? '',
  ]
    .filter(Boolean)
    .join(' ')
}

// One pull request as the issues tool answers it.
export const prText = (pr: PullRequest): string => {
  const review = reviewBadge(pr)
  const parts = [`branch ${pr.branch}`, `CI ${pr.ci}`, ...(review ? [review.text.replace(/^[●○] /, '')] : []), `+${pr.additions} −${pr.deletions}`]
  const failing = pr.ci === 'fail' && (pr.failing ?? []).length > 0 ? ` Failing: ${pr.failing.join(', ')}.` : ''
  return `#${pr.number} ${pr.title} [${parts.join(', ')}]${failing}`
}

const LISTED = 150

// The board as the issues tool answers it: its pull requests, then the issues the filter keeps, one line each.
export const boardText = (board: Board, issues: Issue[], label: string, clock: number): string => {
  const line = (issue: Issue) => {
    const step = progress(issue.checks)
    const labels = issue.labels.map(one => one.name).join(', ')
    const planned = [issue.status, issue.priority].filter(Boolean).join(' ')
    const parts = [planned, labels, step.total > 0 ? `${step.done}/${step.total} boxes` : ''].filter(Boolean)
    return `#${issue.number} ${issue.title}${parts.length > 0 ? ` [${parts.join('; ')}]` : ''}`
  }
  const listed = issues.slice(0, LISTED)
  const age = ago(new Date(board.fetchedAt).toISOString(), clock)
  return [
    `${board.repo}: ${board.issues.length} open issues, ${board.prs.length} open pull requests (synced ${age === 'now' || age === '' ? 'just now' : `${age} ago`}).`,
    '',
    'Pull requests:',
    ...(board.prs.length > 0 ? board.prs.map(prText) : ['none']),
    '',
    `Issues (${label}, ${issues.length}):`,
    ...(listed.length > 0 ? listed.map(line) : ['none']),
    ...(issues.length > listed.length ? [`…and ${issues.length - listed.length} more; narrow with filter, area or query.`] : []),
  ].join('\n')
}

// How the board tells Claude to name the issue in a pull request: `Closes` only when every box is ticked, always
// `Closes`, or nothing, which leaves it to the repository's own rules.
export type PrRule = 'closes-when-ticked' | 'always-closes' | 'none'
export const PR_RULES: readonly PrRule[] = ['closes-when-ticked', 'always-closes', 'none']

// The PR rule's sentences for an issue; none for `none`.
const prRuleText = (number: number, rule: PrRule): string[] =>
  rule === 'closes-when-ticked'
    ? [
        `When you open a pull request for #${number}, write \`Closes #${number}\` in its body only if every acceptance box of #${number} is ticked by then.`,
        `Otherwise write \`Refs #${number}\`, so the issue stays open for what is left. If the repository's contributing guidelines say otherwise, follow them.`,
      ]
    : rule === 'always-closes'
      ? [`When you open a pull request for #${number}, write \`Closes #${number}\` in its body. If the repository's contributing guidelines say otherwise, follow them.`]
      : []

// The system prompt's section while Claude works on an issue the person started this session. It names the issue and
// nothing that changes as the work goes on, so the prompt cache holds until the person starts another. `Closes` only
// when the pull request finishes the issue: some repos keep an issue open for verification, and say `Refs` until then.
export const workingSection = (working: Working, rule: PrRule): string =>
  [
    `The person is working on GitHub issue #${working.number}: ${working.title}. They handed it to you from the issue board.`,
    `When you finish and check an acceptance box of #${working.number}, tick it with the mcp__issue-board__tick tool. The mcp__issue-board__issues tool with number ${working.number} lists its boxes.`,
    `Change its Status, labels, assignee, parent or milestone, comment on it or close it with the mcp__issue-board__issue_update tool; moving its Status needs no permission.`,
    ...prRuleText(working.number, rule),
  ].join(' ')

// What `/issues new` asks Claude for, over the conversation so far. With `epic`, a parent issue and its sub-issues.
export const draftPrompt = (what: string, labels: string[], epic = false): string =>
  [
    epic
      ? `Draft an epic for this repository${what ? ` about: ${what}` : ' from what we have discussed'}: a parent GitHub issue and the sub-issues that, closed, finish it.`
      : `Draft a GitHub issue for this repository${what ? ` about: ${what}` : ' from what we have discussed'}.`,
    epic
      ? 'Answer with one JSON object and nothing else: {"title": "...", "body": "...", "labels": ["..."], "children": [{"title": "...", "body": "...", "labels": ["..."]}]}.'
      : 'Answer with one JSON object and nothing else: {"title": "...", "body": "...", "labels": ["..."]}.',
    'Write each title as a short, plain sentence. In each body, say what is wrong or wanted and why, in plain sentences.',
    epic
      ? 'The parent body says what the whole is for and the order to do the parts in. Each sub-issue is one piece of work, and its body ends with a "## Acceptance" section of task-list boxes ("- [ ] ..."), one checkable outcome each.'
      : 'End the body with a "## Acceptance" section of task-list boxes ("- [ ] ..."), one checkable outcome each.',
    labels.length > 0 ? `Choose labels only from this list, or none: ${labels.join(', ')}.` : 'Leave labels empty.',
  ].join(' ')

type RawDraft = { title?: unknown; body?: unknown; labels?: unknown }

// One issue of a draft, its labels kept to the ones the repository has; null when it has no title or body.
const draftOf = (raw: RawDraft, labels: string[]): Omit<Draft, 'children'> | null => {
  if (typeof raw.title !== 'string' || raw.title.trim() === '' || typeof raw.body !== 'string') return null
  const picked = Array.isArray(raw.labels) ? raw.labels.filter((one): one is string => typeof one === 'string' && labels.includes(one)) : []
  return { title: raw.title.trim(), body: raw.body.trim(), labels: [...new Set(picked)] }
}

// The draft in Claude's reply; null when the reply holds none. An epic's sub-issues come as `children`.
export const parseDraft = (text: string, labels: string[]): Draft | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as RawDraft & { children?: unknown }
    const parent = draftOf(raw, labels)
    if (!parent) return null
    const children = Array.isArray(raw.children) ? raw.children.flatMap(child => (child && typeof child === 'object' ? [draftOf(child as RawDraft, labels)] : [])).filter(one => one !== null) : []
    return children.length > 0 ? { ...parent, children } : parent
  } catch {
    return null
  }
}

// Every label the board's issues carry, sorted: the ones a draft may use.
export const labelsOf = (issues: Issue[]): string[] => [...new Set(issues.flatMap(issue => issue.labels.map(label => label.name)))].sort()

// A draft's body as the editor shows it: one field a line, and null for each blank line between them.
export const draftLines = (body: string): (string | null)[] => (body === '' ? [''] : body.split(/\r?\n/).map(line => (line.trim() === '' ? null : line)))

// The body the editor's lines make. A line left empty is dropped, and the blank lines that leaves side by side, or at
// the start or end, become one or none. A body nobody changed comes back as it was, save for spaces at line ends and
// runs of blank lines.
export const draftBody = (lines: (string | null)[]): string => {
  const kept: string[] = []
  for (const line of lines) {
    if (line === null) {
      if (kept.length > 0 && kept.at(-1) !== '') kept.push('')
    } else if (line.trim() !== '') kept.push(line.trimEnd())
  }
  while (kept.at(-1) === '') kept.pop()
  return kept.join('\n')
}

// A change to an issue, from its card or from Claude's issue_update tool. `parent` and `milestone` set as null remove
// them; `assign` and `unassign` take logins, or `@me` for the signed-in user.
export type IssueChanges = {
  status?: string
  priority?: string
  addLabels?: string[]
  removeLabels?: string[]
  assign?: string[]
  unassign?: string[]
  parent?: number | null
  milestone?: string | null
  comment?: string
  close?: 'completed' | 'not planned'
  reopen?: boolean
  // Blocked-by links to make and to take away, by the blocking issue's number.
  addBlockedBy?: number[]
  removeBlockedBy?: number[]
  // A new title; a whole new body; boxes to add to the acceptance list; boxes to reword, by number.
  title?: string
  body?: string
  addBoxes?: string[]
  rewordBoxes?: { box: number; text: string }[]
  // Close it as a duplicate of this issue, which GitHub then links.
  duplicateOf?: number
  // Its issue type, by name; null takes it off.
  type?: string | null
  // A place among its epic's sub-issues: just before or just after a sibling, by number.
  moveBefore?: number
  moveAfter?: number
  // Pinned to the top of the repo's issues, or not; its conversation locked, with GitHub's reason or none, or unlocked;
  // and the repo it moves to, `owner/name`, the same owner's.
  pin?: boolean
  lock?: boolean | 'off_topic' | 'resolved' | 'spam' | 'too_heated'
  transferTo?: string
  // Moves it even where GitHub won't move it back, from a public repo to a private one.
  confirmTransfer?: boolean
  // The project's other fields to set, by name; null clears one.
  fields?: Record<string, string | number | null>
}

const listed = (values: string[] | undefined): string => (values ?? []).filter(Boolean).join(',')

// The gh commands a change takes, in order: the edit, then the comment, then the close or reopen, so a comment made
// with a close lands before it. Status and Priority are the project's, set apart from these.
export const commandsOf = (number: number, changes: IssueChanges): { argv: string[]; stdin?: string }[] => {
  const id = String(number)
  const edit = [
    ...(listed(changes.addLabels) ? ['--add-label', listed(changes.addLabels)] : []),
    ...(listed(changes.removeLabels) ? ['--remove-label', listed(changes.removeLabels)] : []),
    ...(listed(changes.assign) ? ['--add-assignee', listed(changes.assign)] : []),
    ...(listed(changes.unassign) ? ['--remove-assignee', listed(changes.unassign)] : []),
    ...(changes.parent === null ? ['--remove-parent'] : changes.parent !== undefined ? ['--parent', String(changes.parent)] : []),
    ...(changes.milestone === null ? ['--remove-milestone'] : changes.milestone !== undefined ? ['--milestone', changes.milestone] : []),
  ]
  return [
    ...(edit.length > 0 ? [{ argv: ['issue', 'edit', id, ...edit] }] : []),
    ...(changes.comment?.trim() ? [{ argv: ['issue', 'comment', id, '--body-file', '-'], stdin: changes.comment.trim() }] : []),
    ...(changes.close ? [{ argv: ['issue', 'close', id, '--reason', changes.close] }] : []),
    ...(changes.reopen && !changes.close ? [{ argv: ['issue', 'reopen', id] }] : []),
    ...(changes.pin === true ? [{ argv: ['issue', 'pin', id] }] : changes.pin === false ? [{ argv: ['issue', 'unpin', id] }] : []),
    ...(changes.lock === false
      ? [{ argv: ['issue', 'unlock', id] }]
      : changes.lock
        ? [{ argv: ['issue', 'lock', id, ...(typeof changes.lock === 'string' ? ['--reason', changes.lock] : [])] }]
        : []),
    // Last: once moved, the issue is no longer this repo's.
    ...(changes.transferTo ? [{ argv: ['issue', 'transfer', id, changes.transferTo] }] : []),
  ]
}

// What a change did, in a sentence each, for a toast and for Claude.
export const changesText = (number: number, changes: IssueChanges): string => {
  const said = [
    changes.status ? `moved to ${changes.status}` : '',
    changes.priority ? `set to ${changes.priority}` : '',
    listed(changes.addLabels) ? `labelled ${listed(changes.addLabels).replace(/,/g, ', ')}` : '',
    listed(changes.removeLabels) ? `unlabelled ${listed(changes.removeLabels).replace(/,/g, ', ')}` : '',
    listed(changes.assign) ? `assigned ${listed(changes.assign).replace(/,/g, ', ')}` : '',
    listed(changes.unassign) ? `unassigned ${listed(changes.unassign).replace(/,/g, ', ')}` : '',
    changes.parent === null ? 'taken out of its epic' : changes.parent !== undefined ? `put under #${changes.parent}` : '',
    changes.title ? `retitled “${changes.title}”` : '',
    changes.body !== undefined ? 'its body rewritten' : '',
    changes.rewordBoxes?.length ? `${changes.rewordBoxes.length === 1 ? 'box' : 'boxes'} ${changes.rewordBoxes.map(one => one.box).join(', ')} reworded` : '',
    changes.addBoxes?.length ? `${changes.addBoxes.length} ${changes.addBoxes.length === 1 ? 'box' : 'boxes'} added` : '',
    changes.addBlockedBy?.length ? `blocked by ${changes.addBlockedBy.map(one => `#${one}`).join(', ')}` : '',
    changes.removeBlockedBy?.length ? `no longer blocked by ${changes.removeBlockedBy.map(one => `#${one}`).join(', ')}` : '',
    changes.milestone === null ? 'taken off its milestone' : changes.milestone !== undefined ? `put on the milestone ${changes.milestone}` : '',
    changes.comment?.trim() ? 'commented on' : '',
    changes.close ? `closed as ${changes.close}` : '',
    changes.duplicateOf ? `closed as a duplicate of #${changes.duplicateOf}` : '',
    changes.type === null ? 'its type taken off' : changes.type ? `typed ${changes.type}` : '',
    changes.moveBefore ? `moved before #${changes.moveBefore}` : changes.moveAfter ? `moved after #${changes.moveAfter}` : '',
    changes.pin === true ? 'pinned' : changes.pin === false ? 'unpinned' : '',
    changes.lock === false ? 'unlocked' : changes.lock ? `locked${typeof changes.lock === 'string' ? ` as ${changes.lock.replace('_', ' ')}` : ''}` : '',
    changes.transferTo ? `moved to ${changes.transferTo}` : '',
    ...Object.entries(changes.fields ?? {}).map(([name, value]) => (value === null ? `${name} cleared` : `${name} set to ${value}`)),
    changes.reopen && !changes.close ? 'reopened' : '',
  ].filter(Boolean)
  return said.length > 0 ? `#${number} ${said.join(', ')}.` : `Nothing to change on #${number}.`
}

// The issues that left the board between two reads and may need moving to Done: each had an item in the project and
// wasn't at Done yet. Whether it closed as completed is GitHub's to say. None when the project has no Done option.
export const leftForDone = (before: Board | null, next: Board): { number: number; item: string }[] => {
  const done = roleOf(next.project, 'done')
  if (!before || !done) return []
  const still = new Set(next.issues.map(one => one.number))
  return before.issues.flatMap(one => (one.item && !still.has(one.number) && one.status !== done.name ? [{ number: one.number, item: one.item }] : []))
}

// The issues that pull requests which left the board between two reads refer to, and that may need moving to
// Verification: each still open (an issue a merge closed has left the board too), with an item in the project, and not
// at Verification or Done yet. Whether the pull request merged is GitHub's to say.
export const leftForVerification = (before: Board | null, next: Board): { pr: number; number: number; item: string }[] => {
  const verify = roleOf(next.project, 'verification')
  if (!before || !verify) return []
  const still = new Set(next.prs.map(pr => pr.number))
  return before.prs
    .filter(pr => !still.has(pr.number))
    .flatMap(pr =>
      (pr.issues ?? []).flatMap(number => {
        const issue = next.issues.find(one => one.number === number)
        return issue?.item && issue.status !== verify.name && !isRole(next.project, issue.status, 'done') ? [{ pr: pr.number, number, item: issue.item }] : []
      }),
    )
}

// The box an epic's last sub-issue closing ticks. Every epic is filed with it, so its acceptance says the parts are done.
export const SUB_ISSUES_BOX = 'Every sub-issue is closed'
const SUB_ISSUES = /^every sub-issue is closed\b/i

// The number of an epic's "Every sub-issue is closed" box, counted from 1 as the tick tool counts; 0 when it has none.
export const subIssuesBoxOf = (checks: Check[]): number => checks.findIndex(check => SUB_ISSUES.test(check.text)) + 1

// An epic's body with the "Every sub-issue is closed" box, added to its acceptance list when it hasn't one.
export const withSubIssuesBox = (body: string): string => (subIssuesBoxOf(checksOf(body)) > 0 ? body : addBoxes(body, [SUB_ISSUES_BOX]))

// Where Start leaves an issue's epic: the epic to move to In progress, when the issue is a sub-issue of an open epic on
// the board that is still in the Inbox, Backlog or Ready, or has no Status yet. An epic further along stays.
export const epicToStart = (issues: Issue[], issue: Issue, project: Project | null | undefined): Issue | undefined => {
  const epic = issue.parent ? issues.find(one => one.number === issue.parent?.number) : undefined
  if (!epic || !project?.status || !roleOf(project, 'started')) return undefined
  const waiting = !epic.status || (['inbox', 'backlog', 'ready'] as const).some(role => isRole(project, epic.status, role))
  return waiting ? epic : undefined
}

// What changed for epics between two reads. `finished`: open epics whose last open sub-issue closed. `reopened`: a
// sub-issue back on the board under an open epic whose closed count dropped. `orphaned`: a sub-issue new to the board
// whose epic is closed, reopened or filed under it.
export type EpicChanges = { finished: number[]; reopened: { number: number; epic: number }[]; orphaned: { number: number; epic: number }[] }
export const epicChanges = (before: Board | null, next: Board): EpicChanges => {
  const changes: EpicChanges = { finished: [], reopened: [], orphaned: [] }
  if (!before) return changes
  const was = new Map(before.issues.map(one => [one.number, one]))
  const open = new Set(next.issues.map(one => one.number))
  for (const epic of next.issues) {
    const now = epic.subIssues
    const then = was.get(epic.number)?.subIssues
    if (!now || !then || now.total === 0) continue
    if (then.completed < then.total && now.completed === now.total) changes.finished.push(epic.number)
  }
  for (const issue of next.issues) {
    const epic = issue.parent?.number
    if (!epic || was.has(issue.number)) continue
    if (!open.has(epic)) {
      changes.orphaned.push({ number: issue.number, epic })
      continue
    }
    const then = was.get(epic)?.subIssues
    const now = next.issues.find(one => one.number === epic)?.subIssues
    if (then && now && now.completed < then.completed) changes.reopened.push({ number: issue.number, epic })
  }
  return changes
}

// Where GitHub's REST API keeps a project, from the project's page: `users/<login>/projectsV2/<n>` or the `orgs/` one.
export const projectPathOf = (url: string): string | null => {
  const found = /github\.com\/(users|orgs)\/([^/]+)\/projects\/(\d+)/.exec(url)
  return found ? `${found[1]}/${found[2]}/projectsV2/${found[3]}` : null
}

// The project's issues at a Status, open or closed, from its items as REST answers them with the Status field; a closed
// one only when it closed on or after `since`, a date.
export const itemsAt = (items: unknown[], status: string, since?: string): Found[] =>
  (items as { content_type?: string; content?: Record<string, unknown> | null; fields?: { name?: string; value?: { name?: { raw?: string } | string } | null }[] }[])
    .filter(item => item.content_type === 'Issue' && item.content)
    .filter(item => {
      const value = item.fields?.find(field => field.name === 'Status')?.value?.name
      const name = typeof value === 'string' ? value : value?.raw
      return name?.toLowerCase() === status.toLowerCase()
    })
    .flatMap(item => foundOf([item.content]))
    .filter(found => !since || found.state === 'open' || (found.closedAt ?? '') >= since)

// The project's items an archive takes, as REST lists them with the Status field: one issue's, by number, or every issue
// at Done that closed before a date, `done` naming the project's Done option. Archived ones are left out.
export const toArchive = (items: unknown[], ask: { number?: number; doneBefore?: string }, done?: string): { number: number; title: string; node: string }[] =>
  (
    items as {
      node_id?: string
      archived_at?: string | null
      content_type?: string
      content?: { number?: number; title?: string; state?: string; closed_at?: string | null } | null
      fields?: { name?: string; value?: { name?: { raw?: string } | string } | null }[]
    }[]
  )
    .filter(item => item.content_type === 'Issue' && item.content && item.node_id && !item.archived_at)
    .filter(item => {
      if (ask.number !== undefined) return item.content?.number === ask.number
      const value = item.fields?.find(field => field.name === 'Status')?.value?.name
      const status = typeof value === 'string' ? value : value?.raw
      return done !== undefined && status === done && item.content?.state === 'closed' && (item.content.closed_at ?? '') < (ask.doneBefore ?? '')
    })
    .map(item => ({ number: item.content?.number ?? 0, title: item.content?.title ?? '', node: item.node_id ?? '' }))

// Milestones as GitHub's REST answers them.
export const milestonesOf = (items: unknown[]): Milestone[] =>
  (items as { number: number; title: string; due_on?: string | null; description?: string | null; open_issues?: number; closed_issues?: number }[]).map(raw => ({
    number: raw.number,
    title: raw.title,
    due: raw.due_on ? raw.due_on.slice(0, 10) : null,
    description: raw.description ?? '',
    open: raw.open_issues ?? 0,
    closed: raw.closed_issues ?? 0,
  }))

// One milestone in a line: how many of its issues are closed, and when it is due, or how long since it was.
export const milestoneLine = (milestone: Milestone, today: string): string => {
  const total = milestone.open + milestone.closed
  const due = milestone.due ? (milestone.due < today && milestone.open > 0 ? `was due ${milestone.due}` : `due ${milestone.due}`) : 'no due date'
  return `${milestone.title} · ${milestone.closed}/${total} closed · ${due}`
}

// An item's field values, by field name, from the ITEM_VALUES query: each as text, as the card and Claude read it.
export const itemValuesOf = (answer: unknown): Record<string, string> => {
  const nodes =
    (answer as { node?: { fieldValues?: { nodes?: ({ text?: string; number?: number; date?: string; title?: string; name?: string; field?: { name?: string } } | null)[] } } })?.node?.fieldValues
      ?.nodes ?? []
  return Object.fromEntries(
    nodes.flatMap(one => {
      const value = one?.text ?? (one?.number !== undefined ? String(one.number) : undefined) ?? one?.date ?? one?.title ?? one?.name
      return one?.field?.name && value !== undefined ? [[one.field.name, value]] : []
    }),
  )
}

// A value for a field, as GitHub's mutation takes it, from what Claude or the person gave; or why it doesn't fit.
export const fieldValueOf = (field: ProjectField, given: unknown): { value: Record<string, string | number> } | string => {
  const text = typeof given === 'number' ? String(given) : typeof given === 'string' ? given.trim() : ''
  if (!text) return `give ${field.name} a value, or null to clear it`
  switch (field.kind) {
    case 'text':
      return { value: { text } }
    case 'number':
      return Number.isFinite(Number(text)) ? { value: { number: Number(text) } } : `${field.name} takes a number, not ${text}`
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { value: { date: text } } : `${field.name} takes a date, YYYY-MM-DD, not ${text}`
    case 'iteration':
    case 'select': {
      const option = field.options?.find(one => one.name.toLowerCase() === text.toLowerCase())
      const names = (field.options ?? []).map(one => one.name).join(', ')
      if (!option) return `${field.name} has no ${field.kind === 'iteration' ? 'iteration' : 'option'} called ${text}${names ? `; it has ${names}` : ''}`
      return { value: field.kind === 'iteration' ? { iterationId: option.id } : { singleSelectOptionId: option.id } }
    }
  }
}

// An epic's order with one sub-issue moved just before or just after a sibling; one the order didn't list is added.
export const reordered = (order: number[], number: number, beside: number, before: boolean): number[] => {
  const rest = order.filter(one => one !== number)
  const at = rest.indexOf(beside)
  if (at < 0) return [...rest, number]
  return [...rest.slice(0, before ? at : at + 1), number, ...rest.slice(before ? at : at + 1)]
}

// The labels asked for that the repo hasn't got, by name, ignoring case, each once.
export const missingLabels = (wanted: string[], existing: { name: string }[]): string[] => {
  const have = new Set(existing.map(one => one.name.toLowerCase()))
  return [...new Map(wanted.filter(name => !have.has(name.toLowerCase())).map(name => [name.toLowerCase(), name])).values()]
}

// The color a new label gets: an `area:` label takes the color the repo's other areas have, so they read as one set.
export const labelColorFor = (name: string, existing: { name: string; color?: string }[]): string =>
  (name.startsWith('area:') ? existing.find(one => one.name.startsWith('area:') && one.color)?.color : undefined) ?? 'ededed'

// A hint line that fits `width`: its parts in order of use. All of them in their long form when that fits; otherwise
// the short forms, such as `1-7 filter` for every filter key, and the last parts dropped until it fits, never wrapped.
export const hintFit = (parts: (string | [string, string])[], width: number, gap = ' · '): string => {
  const long = parts.map(part => (Array.isArray(part) ? part[0] : part))
  if (cells(long.join(gap)) <= width) return long.join(gap)
  const kept: string[] = []
  for (const part of parts.map(one => (Array.isArray(one) ? one[1] : one))) {
    if (cells([...kept, part].join(gap)) <= width) kept.push(part)
  }
  return kept.join(gap)
}

// The filter keys, all of them, such as `1 now · 2 later`, and in short, `1-7 filter`.
export const filterKeys = (filters: { hotkey: string; name: string }[]): [string, string] => {
  const keys = filters.map(one => one.hotkey)
  return [filters.map(one => `${one.hotkey} ${one.name.toLowerCase()}`).join(' · '), `${keys[0]}-${keys.at(-1)} filter`]
}

// What opening the pane says: the keys that matter most, from the board's own lists, and the subcommands.
export const openedText = (filters: { hotkey: string; name: string }[]): string =>
  [
    'Issues pane opened.',
    `Filters: ${filters.map(one => `${one.hotkey} ${one.name}`).join(', ')}.`,
    'Enter opens an issue: Start hands it to Claude, Change edits it, and Esc folds it. r refreshes.',
    'Also: /issues new [epic] drafts an issue, /issues setup links a project, /issues check says what is missing. /issues help lists everything.',
  ].join(' ')

// The subcommands of /issues, what each does: the argument hint and /issues help both come from here.
export const SUBCOMMANDS: { name: string; what: string }[] = [
  { name: 'refresh', what: 'reads GitHub again and answers with the summary' },
  { name: 'new <what>', what: 'drafts an issue from the conversation, to check before it is filed' },
  { name: 'new epic <what>', what: 'drafts an epic and its sub-issues' },
  { name: 'setup', what: 'links or makes a project with Status and Priority, and says what it would change first' },
  { name: 'check', what: 'says what the board is missing, such as a gh permission, and how to fix it' },
  { name: 'help', what: 'this list' },
]

// The board's tools for Claude, each in a line: /issues help lists them. A test holds it to the tools registered.
export const TOOLS: { name: string; what: string }[] = [
  { name: 'issues', what: 'lists the board, one issue in full with its comments and fields, searches every issue, and lists by Status or milestones' },
  { name: 'tick', what: 'ticks or unticks acceptance boxes' },
  { name: 'issue_update', what: 'changes an issue: Status, Priority, title, body, boxes, labels, epic, fields, type, links, closing, and starting work on it' },
  { name: 'issue_create', what: 'files an issue, or an epic with its sub-issues, into the project' },
  { name: 'milestone', what: 'makes or changes a milestone' },
  { name: 'project_status', what: "reads or posts the project's status update" },
  { name: 'project_archive', what: 'archives Done items in the project' },
]

// /issues help: the pane and its keys, the card, the band and hint, the subcommands, and Claude's tools.
export const helpText = (filters: { hotkey: string; name: string }[], off: { feature: string; why: string }[] = []): string =>
  [
    'The issue board',
    '',
    'The pane (/issues)',
    `- Filters: ${filters.map(one => `${one.hotkey} ${one.name}`).join(', ')}. Type in the search field to narrow the list.`,
    '- Group by Status, Epic or Area with the buttons after the search.',
    '- r refreshes. m merges every open pull request, after asking. Hover a row to preview its boxes.',
    '- Enter, or a click, opens an issue.',
    '',
    'An open issue',
    '- s Start hands it to Claude here; b Start in background hands it to an agent in its own worktree. On an epic, both start its first ready sub-issue.',
    '- e Edit first puts the message in the prompt box. x or Esc folds it. Press a box to tick it.',
    '- Change opens the editor: title, boxes, labels, assignee, epic, milestone, type, project fields, and closing.',
    '',
    'Under the prompt',
    `- The band above the prompt shows what needs you: failing CI, news on your issue, pull requests to merge, background agents.${off.some(one => one.feature === 'The band above the prompt') ? ' (off)' : ''}`,
    `- The hint line sums up what is open.${off.some(one => one.feature === 'The summary under the prompt') ? ' (off)' : ''}`,
    '',
    'Subcommands',
    ...SUBCOMMANDS.map(one => `- /issues ${one.name}: ${one.what}.`),
    '',
    "Claude's tools",
    ...TOOLS.map(one => `- ${one.name}: ${one.what}.`),
    ...(off.length > 0 ? ['', ...offText(off)] : []),
  ].join('\n')

// The settings that turn a feature off, by their key: true where the feature is on. `refresh` is false when the board
// reads GitHub only when asked, and `prRule` when the working note has no pull request rule.
export type Switches = Record<
  'moveToDone' | 'moveToVerification' | 'advanceEpics' | 'claimOnStart' | 'workingNote' | 'prRule' | 'issueCopies' | 'suggestNextStep' | 'followBranch' | 'band' | 'hintSummary' | 'refresh',
  boolean
>

// The board's features that a setting or a Status role can turn off: the setting's key and its name in /config, and
// the role the feature needs.
const FEATURES: { feature: string; setting?: [keyof Switches, string]; role?: Role }[] = [
  { feature: 'Moving closed issues to Done', setting: ['moveToDone', 'Move closed issues to Done'], role: 'done' },
  { feature: 'Moving an issue a Refs merge touched to Verification', setting: ['moveToVerification', 'Move to Verification on a Refs merge'], role: 'verification' },
  { feature: 'Moving an epic along with its sub-issues', setting: ['advanceEpics', 'Move epics with their sub-issues'] },
  { feature: "Start moving the issue's Status", setting: ['claimOnStart', 'Start assigns and moves the issue'], role: 'started' },
  { feature: 'The Inbox filter, its triage, and new issues landing in the Inbox', role: 'inbox' },
  { feature: "Triage's Accept moving issues to Ready", role: 'ready' },
  { feature: "The Backlog folding, and triage's Accept moving issues to it", role: 'backlog' },
  { feature: 'project_archive by doneBefore', role: 'done' },
  { feature: 'The working note in the system prompt', setting: ['workingNote', 'Working note in the system prompt'] },
  { feature: "The working note's pull request rule", setting: ['prRule', "Working note's pull request rule"] },
  { feature: 'Copies of the issues a prompt names', setting: ['issueCopies', 'Copies of issues a prompt names'] },
  { feature: 'The next step suggested in the prompt box', setting: ['suggestNextStep', 'Suggest the next step'] },
  { feature: 'Following the branch to the issue Claude is on', setting: ['followBranch', 'Follow the branch'] },
  { feature: 'The band above the prompt', setting: ['band', 'Band above the prompt'] },
  { feature: 'The summary under the prompt', setting: ['hintSummary', 'Summary under the prompt'] },
  { feature: 'Reading GitHub by itself', setting: ['refresh', 'How often the board reads GitHub'] },
]

// The features that are off, each with why: the setting that turned it off, or the Status role the project has no
// option for. A role counts only with a project that has a Status field.
export const featuresOff = (switches: Switches, project: Project | null | undefined): { feature: string; why: string }[] =>
  FEATURES.flatMap(({ feature, setting, role }) => {
    if (setting && !switches[setting[0]]) return [{ feature, why: `turned off in /config by ${setting[1]} (${setting[0]})` }]
    if (role && project?.status && !roleOf(project, role)) {
      return [{ feature, why: `${project.title} has no Status option as the ${ROLE_NAMES[role]}; pick one in /issues setup` }]
    }
    return []
  })

// The features that are off, as lines for /issues check and /issues help; none when all are on.
export const offText = (off: { feature: string; why: string }[]): string[] => (off.length > 0 ? ['Off:', ...off.map(one => `- ${one.feature}: ${one.why}.`)] : [])

// What the board did on its own in one read, in a line for a toast: the issues it moved to a Status and why, many at
// once in one line. `why` reads for one issue; `whyMany` for several.
export const movedText = (to: string, moved: number[], why: string, whyMany: string): string =>
  moved.length === 1 ? `Moved #${moved[0]} to ${to}: ${why}.` : `Moved ${moved.length} issues to ${to} (${moved.map(one => `#${one}`).join(', ')}): ${whyMany}.`

// And the ones it couldn't move, with the first reason and where to look.
export const unmovedText = (to: string, failed: { number: number; message: string }[]): string => {
  const [first] = failed
  const which = failed.length === 1 ? `#${first?.number}` : `${failed.length} issues (${failed.map(one => `#${one.number}`).join(', ')})`
  return `Couldn't move ${which} to ${to}: ${first?.message ?? 'GitHub refused'}. /issues check may say why.`
}

// Issue numbers from a tool's input: whole and positive, each once.
export const numbersOf = (value: unknown): number[] =>
  Array.isArray(value) ? [...new Set(value.filter((one): one is number => typeof one === 'number' && Number.isInteger(one) && one > 0))] : []

// An issue for Claude's issue_create tool to file: its title and body, and what it starts with.
export type NewIssue = {
  title: string
  body: string
  labels?: string[]
  assign?: string[]
  milestone?: string
  parent?: number
  status?: string
  priority?: string
  type?: string
  // The issues it is blocked by, by number.
  blockedBy?: number[]
  // Sub-issues to file under it, in order: an epic and its parts in one call. They have none of their own.
  subIssues?: NewIssue[]
}

// The issue_create tool's input as a new issue, or why it can't be one. `nested`: a sub-issue, which takes no
// sub-issues of its own.
export const newIssueOf = (input: unknown, nested = false): NewIssue | string => {
  const raw = (input ?? {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map(one => one.trim()) : [])
  const title = text(raw.title)
  if (!title) return 'Give the issue a title.'
  const made: NewIssue = { title, body: typeof raw.body === 'string' ? raw.body : '' }
  const labels = list(raw.labels)
  const assign = list(raw.assign)
  if (labels.length > 0) made.labels = labels
  if (assign.length > 0) made.assign = assign
  const milestone = text(raw.milestone)
  if (milestone) made.milestone = milestone
  if (typeof raw.parent === 'number' && Number.isInteger(raw.parent) && raw.parent > 0) made.parent = raw.parent
  const status = text(raw.status)
  const priority = text(raw.priority)
  if (status) made.status = status
  if (priority) made.priority = priority
  const type = text(raw.type)
  if (type) made.type = type
  const blockers = numbersOf(raw.blockedBy)
  if (blockers.length > 0) made.blockedBy = blockers
  if (Array.isArray(raw.subIssues) && raw.subIssues.length > 0) {
    if (nested) return 'A sub-issue takes no sub-issues of its own.'
    const parts = raw.subIssues.map(part => newIssueOf(part, true))
    const wrong = parts.findIndex(part => typeof part === 'string')
    if (wrong >= 0) return `Sub-issue ${wrong + 1}: ${parts[wrong]}`
    made.subIssues = parts as NewIssue[]
  }
  return made
}

// What filing an issue did, for Claude: what it was filed with, and each later step that failed, by what it was for.
export const filedText = (number: number, did: string[], failed: string[]): string =>
  [
    `Filed #${number}${did.length > 0 ? `: ${did.join(', ')}` : ''}.`,
    ...(failed.length > 0 ? [`The issue exists, but the board couldn't ${failed.join('; nor ')}.`] : []),
  ].join(' ')

// Whether a change only moves an issue's Status, which the issue Claude is on may do without asking.
export const statusOnly = (changes: IssueChanges): boolean =>
  Boolean(changes.status) &&
  commandsOf(0, changes).length === 0 &&
  !changes.priority &&
  !changes.addBlockedBy?.length &&
  !changes.removeBlockedBy?.length &&
  !changes.title &&
  changes.body === undefined &&
  !changes.addBoxes?.length &&
  !changes.rewordBoxes?.length &&
  !changes.duplicateOf &&
  changes.type === undefined &&
  !changes.moveBefore &&
  !changes.moveAfter &&
  Object.keys(changes.fields ?? {}).length === 0

// An issue's or pull request's page on GitHub: the URL gh gave, or one made from the repo for a board saved without it.
export const pageOf = (repo: string, kind: 'issues' | 'pull', item: { number: number; url: string }): string =>
  item.url || `https://github.com/${repo}/${kind}/${item.number}`

// The issues and pull requests a prompt names as `#123`, each once, in order, up to `limit`. Not `&#123;`, a URL's
// `/#123` or a word run into it.
export const mentionsOf = (text: string, limit = 3): number[] =>
  [...new Set([...text.matchAll(/(?<![\w&/#])#(\d{1,7})\b/g)].map(match => Number(match[1])))].slice(0, limit)

// How much of an issue's text a prompt that names it carries.
const MENTION_TEXT = 2000

// What a prompt that names `#number` carries for Claude, unseen by the person: the board's copy of that issue, with the
// pull requests for it and its text, or of that pull request. Null when the board has neither open.
export const mentionText = (board: Board, number: number, clock: number): string | null => {
  const age = ago(new Date(board.fetchedAt).toISOString(), clock)
  const as = `the issue board's copy, synced ${age === 'now' || age === '' ? 'just now' : `${age} ago`}`
  const issue = board.issues.find(one => one.number === number)
  if (issue) {
    const prs = prsFor(issue, board.prs)
    const prose = proseOf(issue.body)
    const text = prose.length > MENTION_TEXT ? `${prose.slice(0, MENTION_TEXT - 1)}…` : prose
    return [
      `The prompt names #${number}. This is ${as}:`,
      ...issueLines(issue),
      ...(prs.length > 0 ? ['Pull requests for it:', ...prs.map(prText)] : []),
      ...(text ? ['Text, without the boxes:', text] : []),
      prose.length > MENTION_TEXT || !issue.body
        ? `Read the whole issue with \`gh issue view ${number}\`.`
        : `Its comments aren't here: the issues tool shows them with its \`number\`.`,
    ].join('\n')
  }
  const pr = board.prs.find(one => one.number === number)
  return pr ? `The prompt names pull request #${number}. This is ${as}:\n${prText(pr)}\nRead it in full with \`gh pr view ${number}\`.` : null
}

// What Claude knows of an issue as the board has it now; `issue` undefined once it's closed, as it leaves the board.
export const knownOf = (issue: Issue | undefined, prs: PullRequest[]): Known => ({
  checks: issue?.checks ?? [],
  comments: issue?.comments ?? null,
  prs: issue ? prsFor(issue, prs).map(pr => ({ number: pr.number, ci: pr.ci, sha: pr.sha })) : [],
  closed: issue === undefined,
})

// What Claude knows once its own action changed the issue: what changed from `before` to `after` while the action ran
// goes into `known`, so it isn't noted, and what changed earlier stays to be noted. CI runs on its own, so a pull
// request keeps the CI Claude knew; one opened or closed during the action is taken as it is now.
export const absorbed = (known: Known, before: Known, after: Known): Known => {
  const has = (list: Check[], check: Check) => list.some(one => one.text === check.text)
  let checks = known.checks.filter(check => !has(before.checks, check) || has(after.checks, check))
  for (const check of after.checks) {
    const old = before.checks.find(one => one.text === check.text)
    if (old && old.done === check.done) continue
    checks = has(checks, check) ? checks.map(one => (one.text === check.text ? check : one)) : [...checks, check]
  }
  const opened = (pr: { number: number }, list: Known['prs']) => list.some(one => one.number === pr.number)
  const added = after.comments !== null && before.comments !== null ? after.comments - before.comments : 0
  return {
    checks,
    comments: known.comments === null ? after.comments : known.comments + added,
    prs: [
      ...known.prs.filter(pr => !opened(pr, before.prs) || opened(pr, after.prs)),
      ...after.prs.filter(pr => !opened(pr, before.prs) && !opened(pr, known.prs)),
    ],
    closed: before.closed === after.closed ? known.closed : after.closed,
  }
}

const COMMENT_TEXT = 300

// The note a prompt carries when the issue Claude is on changed on GitHub since its last prompt: boxes ticked, added or
// gone, new comments (with `comments`, the newest, when gh could read them), CI that failed or passed, the issue closed.
// Null when nothing it tracks changed.
export const newsOf = (number: number, was: Known, now: Known, comments: Comment[] = []): string | null => {
  const lines: string[] = []
  if (now.closed && !was.closed) lines.push(`#${number} is closed.`)
  if (!now.closed) {
    now.checks.forEach((check, index) => {
      const old = was.checks.find(one => one.text === check.text)
      if (!old) lines.push(`Box ${index + 1} is new: ${check.text}`)
      else if (old.done !== check.done) lines.push(`Box ${index + 1} was ${check.done ? 'ticked' : 'unticked'}: ${check.text}`)
    })
    for (const old of was.checks) if (!now.checks.some(check => check.text === old.text)) lines.push(`A box was taken out: ${old.text}`)
    const added = now.comments !== null && was.comments !== null ? now.comments - was.comments : 0
    if (added > 0) {
      const shown = comments.slice(-Math.min(added, 3))
      lines.push(`${added === 1 ? 'A new comment' : `${added} new comments`}${shown.length > 0 ? ':' : `. Read ${added === 1 ? 'it' : 'them'} with \`gh issue view ${number} --comments\`.`}`)
      for (const comment of shown) lines.push(`  @${comment.author}: ${fit(comment.body.replace(/\s+/g, ' ').trim(), COMMENT_TEXT)}`)
    }
    // A closed issue leaves the board, and the board then knows none of its pull requests.
    for (const pr of now.prs) {
      const old = was.prs.find(one => one.number === pr.number)
      if (old && old.ci === pr.ci && old.sha === pr.sha) continue
      if (pr.ci === 'fail') lines.push(`CI fails on PR #${pr.number}. \`gh pr checks ${pr.number}\` says where.`)
      else if (pr.ci === 'pass') lines.push(`CI passes on PR #${pr.number}.`)
    }
    for (const old of was.prs) if (!now.prs.some(pr => pr.number === old.number)) lines.push(`PR #${old.number} isn't open any more: it merged or closed.`)
  }
  if (lines.length === 0) return null
  return [`#${number}, the issue you're working on, changed on GitHub since the last prompt:`, ...lines.map(line => (line.startsWith('  ') ? line : `- ${line}`))].join('\n')
}

// What the prompt box suggests after a turn, for the issue Claude is on: fix CI that fails on its pull request; once
// every box is ticked, open a pull request for it, or merge the one whose CI passes. Null when nothing is due.
export const nextStepOf = (board: Board, working: Working | null): string | null => {
  const issue = working && board.issues.find(one => one.number === working.number)
  if (!issue) return null
  const prs = prsFor(issue, board.prs)
  const failing = prs.find(pr => pr.ci === 'fail')
  if (failing) return `Fix the failing CI on PR #${failing.number}`
  const { done, total } = progress(issue.checks)
  if (total === 0 || done < total) return null
  if (prs.length === 0) return `Open a PR for #${issue.number}`
  const ready = prs.find(pr => pr.ci === 'pass' && !pr.isDraft)
  return ready ? `Finish and merge PR #${ready.number}` : null
}

// The issue a branch is for, by the number a part of its name starts with, such as `fix/315-glide`, `315-glide`,
// `issue-315` or the worktree branch `worktree-fix+315-glide`. Null when it names none.
export const issueOfBranch = (name: string | null): number | null => {
  const match = /(?:^|[/+])(?:issue[-_]?|gh[-_]?)?(\d{1,7})(?=[-_/+]|$)/i.exec(name ?? '')
  return match ? Number(match[1]) : null
}

// Commands that change something on GitHub, so the board reads it again: gh issue and pr writes, project item edits,
// a push, and gh api calls that write. gh sends a POST when fields are given with no method.
const GH_WRITE = /\bgh\s+(issue|pr)\s+(create|edit|close|reopen|merge|comment|ready|review|develop)\b|\bgh\s+project\s+item-(add|create|edit|archive|delete)\b|\bgit\s+push\b/
const API_CALL = /\bgh\s+api\b[^;&|]*/g
export const writesGitHub = (command: string): boolean =>
  GH_WRITE.test(command) ||
  [...command.matchAll(API_CALL)].some(([call]) => {
    if (/\bgraphql\b/.test(call)) return /\bmutation\b/.test(call)
    const method = /(?:^|\s)(?:-X|--method)[\s=]*['"]?([A-Za-z]+)/.exec(call)?.[1]
    if (method) return method.toUpperCase() !== 'GET'
    return /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?=[\s=])/.test(call)
  })

// Where a task Start made for a box stands now: the box by its text, or by its place should the text have changed.
// Null when the issue has no such box any more.
export const boxOf = (issue: Issue, task: BoxTask): { box: number; done: boolean } | null => {
  const index = issue.checks.findIndex(check => check.text === task.text)
  const at = index >= 0 ? index : task.box - 1
  const check = issue.checks[at]
  return check ? { box: at + 1, done: check.done } : null
}

// The repository a GitHub relay event is about, from the `owner/name#12` it names its pull request by, or its repo
// field; null when it names none.
export const eventRepoOf = (data: Record<string, unknown>): string | null => {
  for (const key of ['pr', 'pull_request', 'repo', 'repository']) {
    const value = data[key]
    const named = typeof value === 'string' ? /^([\w.-]+\/[\w.-]+?)(?:#\d+)?$/.exec(value.trim())?.[1] : undefined
    if (named) return named
  }
  return null
}

// The runs `gh run list --json databaseId,status,workflowName` lists that haven't completed.
export const liveRunsOf = (json: string): { id: number; workflow: string }[] =>
  (JSON.parse(json) as { databaseId?: unknown; status?: unknown; workflowName?: unknown }[]).flatMap(run =>
    typeof run.databaseId === 'number' && typeof run.status === 'string' && run.status !== 'completed'
      ? [{ id: run.databaseId, workflow: typeof run.workflowName === 'string' ? run.workflowName : 'CI' }]
      : [],
  )

// How far a run has got, from what `gh run watch` has written so far: it draws the run again every few seconds, so
// the last drawing's JOBS list counts. Each job is a line, `✓ build in 32s (ID 1)`, its steps indented under it; `✓`
// passed, `X` failed, `-` skipped, `*` still running. Null before it has drawn a job.
export const runProgressOf = (output: string): Pick<RunWatch, 'done' | 'total' | 'failed' | 'running' | 'step'> | null => {
  const text = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
  const at = text.lastIndexOf('JOBS\n')
  if (at < 0) return null
  const jobs: { mark: string; name: string; step: string | null }[] = []
  for (const line of text.slice(at + 'JOBS\n'.length).split('\n')) {
    if (/^(ANNOTATIONS|Refreshing run status)/.test(line)) break
    const job = /^([✓X*\-!]) (.+?)(?: in \S+)? \(ID \d+\)\s*$/.exec(line)
    if (job) {
      jobs.push({ mark: job[1] ?? '', name: job[2] ?? '', step: null })
      continue
    }
    const step = /^\s+\* (.+?)\s*$/.exec(line)
    const last = jobs.at(-1)
    if (step && last && last.mark === '*' && !last.step) last.step = step[1] ?? null
  }
  if (jobs.length === 0) return null
  const running = jobs.find(job => job.mark === '*')
  return {
    done: jobs.filter(job => job.mark !== '*').length,
    total: jobs.length,
    failed: jobs.filter(job => job.mark === 'X').length,
    running: running?.name ?? null,
    step: running?.step ?? null,
  }
}

// The system prompt of the agent Start in background sets on an issue: it works alone, in a worktree of its own, and
// leaves a pull request for the person. The pull request names the issue by the same rule as the working note.
export const workerPrompt = (rule: PrRule): string =>
  [
    'You work on one GitHub issue of this repository, in the background, in a git worktree of your own. The person is not watching.',
    "Don't ask the person anything. When something needs their decision, stop and say what it is.",
    '1. Read the issue and its comments with `gh issue view <number> --comments`.',
    '2. Make a branch for it from the default branch, named for the issue, such as `fix/<number>-short-name` or `feat/<number>-short-name`.',
    "3. Do the work. Follow the repository's CLAUDE.md and contributing guidelines, and run its tests and checks.",
    '4. When you finish an acceptance box and have checked it, tick it with the mcp__issue-board__tick tool.',
    rule === 'closes-when-ticked'
      ? '5. Commit, push the branch and open a pull request. Write `Closes #<number>` in its body only if every acceptance box is ticked by then, and `Refs #<number>` otherwise.'
      : rule === 'always-closes'
        ? '5. Commit, push the branch and open a pull request. Write `Closes #<number>` in its body.'
        : '5. Commit, push the branch and open a pull request.',
    "Don't merge, don't force-push, and don't push to the default branch.",
    'End with a short report in plain sentences: the pull request, what you did, and what is left.',
  ].join('\n')

// The agent type Start in background runs, as `$.agent.register` names it.
export const WORKER = 'issue-board:worker'

// What Start in background sends Claude: dispatch the board's agent on the issue, and leave the work to it.
export const backgroundPrompt = (issue: Issue): string =>
  [
    `Dispatch a background agent to work on #${issue.number}: ${issue.title}. Don't work on the issue yourself.`,
    `Use the Agent tool with subagent_type \`${WORKER}\`, description \`#${issue.number} ${issue.title}\`, and this prompt:`,
    '',
    startPrompt(issue),
  ].join('\n')

// The issue a spawn of the board's agent works on: by the `#<n>` its description starts with, else the first its prompt
// names. A name `issue-<n>` names it too, for a call that gives one; Start in background asks for none, as the Agent
// tool may take none.
export const workerIssueOf = (spawn: { name?: string; description: string; prompt: string }): number | undefined => {
  const found = /^issue-(\d+)$/.exec(spawn.name ?? '') ?? /^#(\d+)\b/.exec(spawn.description.trim()) ?? /#(\d+)\b/.exec(spawn.prompt)
  return found ? Number(found[1]) : undefined
}

// Whether Claude's own Agent tool call started an agent: the engine raised the spawn, not a plugin's `$.agent.spawn`,
// in the main session's loop, not another agent's. Claude Code then hands Claude the agent's result itself.
export const startedByClaude = (origin: { plugin: string }, spawn: { parentAgentId?: string }): boolean => origin.plugin === 'engine' && spawn.parentAgentId === undefined

// A background agent's status on an issue's row.
export const workerBadge = (status: Worker['status']): { text: string; color: ThemeKey } =>
  status === 'completed'
    ? { text: '⚙ done', color: 'success' }
    : status === 'failed'
      ? { text: '⚙ failed', color: 'error' }
      : status === 'killed'
        ? { text: '⚙ stopped', color: 'inactive' }
        : status === 'waiting' || status === 'idle'
          ? { text: '⚙ waiting', color: 'warning' }
          : { text: '⚙ working', color: 'claude' }

// How a background agent's loop may end.
export type Ended = 'completed' | 'failed' | 'killed'

const ENDED: Record<Ended, string> = { completed: 'is done', failed: 'failed', killed: 'was stopped' }

// An issue as a line in the conversation names it: its number, and its title when it has one.
export const named = (issue: { number: number; title?: string }): string => {
  const title = issue.title?.trim()
  return title ? `#${issue.number} "${title}"` : `#${issue.number}`
}

const PULL_LINK = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g

// The pull request a background agent left on its issue: of the open ones for the issue, the one its answer names, or
// else the newest; failing those, the first one its answer links to. Null when nothing says.
export const workerPrOf = (number: number, prs: PullRequest[], answer: string): { number: number; url: string } | null => {
  const mentioned = new Set([...answer.matchAll(PULL_LINK)].map(match => Number(match[1])))
  for (const match of answer.matchAll(/#(\d+)\b/g)) mentioned.add(Number(match[1]))
  const linked = prs.filter(pr => (pr.issues ?? []).includes(number)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const pr = linked.find(one => mentioned.has(one.number)) ?? linked[0]
  if (pr) return { number: pr.number, url: pr.url }
  const link = [...answer.matchAll(PULL_LINK)][0]
  return link ? { number: Number(link[1]), url: link[0] } : null
}

// The line in the conversation when a background agent ends: how, on which issue, what it said and its pull request.
// One line, its pull request's address last, so a long answer is cut and the link isn't.
export const endedLine = (issue: { number: number; title?: string }, status: Ended, answer: string | null, pr: { number: number; url: string } | null): string => {
  const said = answer?.replace(/\s+/g, ' ').trim()
  const link = pr ? ` Pull request #${pr.number}${pr.url ? `: ${pr.url}` : ''}` : ''
  return `The background agent on ${named(issue)} ${ENDED[status]}.${said ? ` ${fit(said, 600)}` : ''}${link}`
}

// What Claude reads when a background agent ends, so it can follow up without the person passing anything on.
export const handoffPrompt = (issue: { number: number; title?: string }, status: Ended, answer: string | null, pr: { number: number; url: string } | null): string =>
  [
    `The background agent that Start in background set on ${named(issue)} ${ENDED[status]}.`,
    pr ? `Its pull request: #${pr.number}${pr.url ? ` ${pr.url}` : ''}` : 'The board sees no pull request for the issue.',
    answer?.trim() ? `Its last answer:\n${fit(answer.trim(), 4000)}` : 'It gave no answer.',
    status === 'completed'
      ? 'Tell the person in a few sentences what it did and what is left, such as a review of the pull request.'
      : 'Tell the person in a sentence or two, and say what they could do next.',
  ].join('\n\n')
