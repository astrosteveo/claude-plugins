import type { Alert, Board, BoxTask, Check, Ci, Comment, Draft, Field, Filter, GroupBy, Issue, Known, Label, Project, PullRequest, RunWatch, Suggestion, Worker, Working } from '../types'
import { isLater, isNow, priorityRank } from './project'

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
export const mergeNoteOf = (pr: PullRequest): { text: string; color: string } | null =>
  pr.mergeState === 'DIRTY' ? { text: '⚠ conflicts', color: 'error' } : pr.mergeState === 'BEHIND' ? { text: '↓ behind', color: 'warning' } : null

type RawComment = { author?: { login?: string } | null; body?: string | null; createdAt?: string }

// An issue's comments from `gh issue view --json comments`, oldest first.
export const commentsOf = (json: string): Comment[] =>
  ((JSON.parse(json) as { comments?: RawComment[] | null }).comments ?? []).map(one => ({ author: one.author?.login ?? 'ghost', body: (one.body ?? '').trim(), at: one.createdAt ?? '' }))

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
      return project !== null && isInbox(issue)
  }
}

// Whether an issue waits in the project's Inbox: its Status is Inbox, or it has none, as an issue not in the project.
export const isInbox = (issue: Issue): boolean => !issue.status || issue.status.toLowerCase() === 'inbox'

// The Status an issue moves to out of the Inbox when Claude didn't say: Ready for Now's priorities, Backlog otherwise.
export const statusFor = (project: Project | null, priority: string | null): 'Ready' | 'Backlog' => (priorityRank(project, priority) < 2 ? 'Ready' : 'Backlog')

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
export const sortIssues = (issues: Issue[], project: Project | null = null, readyFirst = false): Issue[] =>
  [...issues].sort(
    (a, b) =>
      (readyFirst ? Number(isBlocked(a)) - Number(isBlocked(b)) : 0) ||
      priorityRank(project, a.priority) - priorityRank(project, b.priority) ||
      rank(a) - rank(b) ||
      (readyFirst ? a.number - b.number : b.number - a.number),
  )

// The sub-issue an epic's Next starts: the first open one nothing blocks, in the order the epic lists them.
export const nextOf = (issues: Issue[], epic: number, project: Project | null = null): Issue | undefined =>
  sortIssues(
    issues.filter(issue => issue.parent?.number === epic),
    project,
    true,
  ).find(issue => !isBlocked(issue))

// A heading of the issue list and the issues under it. `folded`: drawn shut until the person opens it, as Backlog is.
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
      folded: /^backlog$/i.test(option.name),
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
type RawField = { id?: string; name?: string; options?: { id: string; name: string }[] }
type RawProject = { id: string; number: number; title: string; url: string; closed?: boolean; fields?: RawNodes<RawField> }
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
}
type RawPage = { data?: { repository?: { projectsV2?: RawNodes<RawProject>; issues?: { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes?: (RawGraphIssue | null)[] } } } }

const nodesOf = <T>(list: RawNodes<T>): T[] => (list?.nodes ?? []).filter((one): one is T => one !== null && one !== undefined)

const fieldOf = (project: RawProject, name: string): Field | null => {
  const field = nodesOf(project.fields).find(one => one.id && one.name?.toLowerCase() === name.toLowerCase() && one.options)
  return field?.id && field.options ? { id: field.id, options: field.options } : null
}

// Where the next page of issues starts, or null after the last.
export const nextPageOf = (json: string): string | null => {
  const info = (JSON.parse(json) as RawPage).data?.repository?.issues?.pageInfo
  return info?.hasNextPage && info.endCursor ? info.endCursor : null
}

// The issues of every page, and the repo's project, read from the first page: the one `/issues setup` saved when it's
// still linked and open, else the first open one linked to the repo.
export const parseGraph = (pages: string[], preferred?: string): { issues: Issue[]; project: Project | null } => {
  const parsed = pages.map(page => JSON.parse(page) as RawPage)
  const open = nodesOf(parsed[0]?.data?.repository?.projectsV2).filter(one => !one.closed)
  const linked = open.find(one => one.id === preferred) ?? open[0]
  const project: Project | null = linked
    ? { id: linked.id, number: linked.number, title: linked.title, url: linked.url, status: fieldOf(linked, 'Status'), priority: fieldOf(linked, 'Priority') }
    : null
  const issues = parsed.flatMap(page => (page.data?.repository?.issues?.nodes ?? []).filter((one): one is RawGraphIssue => one !== null))
  return {
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
      }
    }),
  }
}

// The open pull requests for an issue: the ones GitHub says close it, and the ones that say they are for it.
export const prsFor = (issue: Issue, prs: PullRequest[]): PullRequest[] =>
  prs.filter(pr => (issue.prs ?? []).includes(pr.number) || (pr.issues ?? []).includes(issue.number))

export type Progress = { done: number; total: number }

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
export const tone = ({ done, total }: Progress): string => (total > 0 && done === total ? 'success' : done > 0 ? 'warning' : 'inactive')

export const ciMark: Record<Ci, string> = { pass: '✓', fail: '✗', pending: '…', none: '·' }

export const ciBadge: Record<Ci, { text: string; color: string }> = {
  pass: { text: ' ✓ PASS ', color: 'success' },
  fail: { text: ' ✗ FAIL ', color: 'error' },
  pending: { text: ' ◷ CI ', color: 'warning' },
  none: { text: ' · NO CI ', color: 'inactive' },
}

export const reviewBadge = (pr: PullRequest): { text: string; color: string } | undefined => {
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

// The system prompt's section while Claude works on an issue the person started this session. It names the issue and
// nothing that changes as the work goes on, so the prompt cache holds until the person starts another. `Closes` only
// when the pull request finishes the issue: some repos keep an issue open for verification, and say `Refs` until then.
export const workingSection = (working: Working): string =>
  [
    `The person is working on GitHub issue #${working.number}: ${working.title}. They handed it to you from the issue board.`,
    `When you finish and check an acceptance box of #${working.number}, tick it with the mcp__issue-board__tick tool. The mcp__issue-board__issues tool with number ${working.number} lists its boxes.`,
    `Change its Status, labels, assignee, parent or milestone, comment on it or close it with the mcp__issue-board__issue_update tool; moving its Status needs no permission.`,
    `When you open a pull request for #${working.number}, write \`Closes #${working.number}\` in its body only if every acceptance box of #${working.number} is ticked by then.`,
    `Otherwise write \`Refs #${working.number}\`, so the issue stays open for what is left. If the repository's contributing guidelines say otherwise, follow them.`,
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
    changes.milestone === null ? 'taken off its milestone' : changes.milestone !== undefined ? `put on the milestone ${changes.milestone}` : '',
    changes.comment?.trim() ? 'commented on' : '',
    changes.close ? `closed as ${changes.close}` : '',
    changes.reopen && !changes.close ? 'reopened' : '',
  ].filter(Boolean)
  return said.length > 0 ? `#${number} ${said.join(', ')}.` : `Nothing to change on #${number}.`
}

// Whether a change only moves an issue's Status, which the issue Claude is on may do without asking.
export const statusOnly = (changes: IssueChanges): boolean =>
  Boolean(changes.status) && commandsOf(0, changes).length === 0 && !changes.priority

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
        : `Its comments aren't here: read them with \`gh issue view ${number} --comments\`.`,
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
// leaves a pull request for the person.
export const WORKER_PROMPT = [
  'You work on one GitHub issue of this repository, in the background, in a git worktree of your own. The person is not watching.',
  "Don't ask the person anything. When something needs their decision, stop and say what it is.",
  '1. Read the issue and its comments with `gh issue view <number> --comments`.',
  '2. Make a branch for it from the default branch, named for the issue, such as `fix/<number>-short-name` or `feat/<number>-short-name`.',
  "3. Do the work. Follow the repository's CLAUDE.md and contributing guidelines, and run its tests and checks.",
  '4. When you finish an acceptance box and have checked it, tick it with the mcp__issue-board__tick tool.',
  '5. Commit, push the branch and open a pull request. Write `Closes #<number>` in its body only if every acceptance box is ticked by then, and `Refs #<number>` otherwise.',
  "Don't merge, don't force-push, and don't push to the default branch.",
  'End with a short report in plain sentences: the pull request, what you did, and what is left.',
].join('\n')

// A background agent's status on an issue's row.
export const workerBadge = (status: Worker['status']): { text: string; color: string } =>
  status === 'completed'
    ? { text: '⚙ done', color: 'success' }
    : status === 'failed'
      ? { text: '⚙ failed', color: 'error' }
      : status === 'killed'
        ? { text: '⚙ stopped', color: 'inactive' }
        : status === 'waiting' || status === 'idle'
          ? { text: '⚙ waiting', color: 'warning' }
          : { text: '⚙ working', color: 'claude' }
