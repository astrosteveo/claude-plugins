import type { Alert, Board, Check, Ci, Draft, Field, Filter, GroupBy, Issue, Label, Project, PullRequest, Working } from '../types'
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
  }))

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
  }
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

// The most pressing first: by priority when there is a project, then bugs, issues under way and the newest.
export const sortIssues = (issues: Issue[], project: Project | null = null): Issue[] =>
  [...issues].sort((a, b) => priorityRank(project, a.priority) - priorityRank(project, b.priority) || rank(a) - rank(b) || b.number - a.number)

// A heading of the issue list and the issues under it. `folded`: drawn shut until the person opens it, as Backlog is.
// `epic`: the parent the group is for, so its row isn't drawn again beneath it.
export type Group = { key: string; title: string; issues: Issue[]; folded: boolean; epic?: { total: number; completed: number } }

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
        issues: sortIssues(issues.filter(issue => issue.parent?.number === parent.number), project),
        folded: false,
        epic: { total: parent.total, completed: parent.completed },
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

// The issues of every page, and the repo's project: the first open one linked to it, read from the first page.
export const parseGraph = (pages: string[]): { issues: Issue[]; project: Project | null } => {
  const parsed = pages.map(page => JSON.parse(page) as RawPage)
  const linked = nodesOf(parsed[0]?.data?.repository?.projectsV2).find(one => !one.closed)
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

// `text` cut to `width` cells, an ellipsis standing in for what was cut.
export const fit = (text: string, width: number): string => {
  const chars = [...text]
  if (width <= 0) return ''
  return chars.length <= width ? text : `${chars.slice(0, Math.max(0, width - 1)).join('')}…`
}

// The board in a line, such as `35 issues · 1 bug · PR #335✓`; undefined with nothing open, so nothing shows.
export const summary = (issues: Issue[], prs: PullRequest[]): string | undefined => {
  const bugs = issues.filter(isBug).length
  const parts: string[] = []
  if (issues.length > 0) parts.push(`${issues.length} issue${issues.length === 1 ? '' : 's'}`)
  if (bugs > 0) parts.push(`${bugs} bug${bugs === 1 ? '' : 's'}`)
  if (prs.length > 0) parts.push(`PR ${prs.map(pr => `#${pr.number}${ciMark[pr.ci]}`).join(' ')}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

// The message the Start and Draft buttons hand Claude for an issue.
export const startPrompt = (issue: Issue): string => {
  const open = issue.checks.filter(check => !check.done)
  const boxes = open.length > 0 ? `\n\nIts open acceptance boxes:\n${open.map(check => `- ${check.text}`).join('\n')}` : ''
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

// One issue as the issues tool answers it: what the board knows, its boxes numbered as the tick tool counts them.
export const issueText = (issue: Issue): string => {
  const step = progress(issue.checks)
  const lines = [
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
    `This is the board's copy, without the body's other text. Read the whole issue with \`gh issue view ${issue.number}\`.`,
  ]
  return lines.filter(line => line !== '').join('\n')
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

// The system prompt's section while Claude works on an issue the person started this session. It names the issue and
// nothing that changes as the work goes on, so the prompt cache holds until the person starts another. `Closes` only
// when the pull request finishes the issue: some repos keep an issue open for verification, and say `Refs` until then.
export const workingSection = (working: Working): string =>
  [
    `The person is working on GitHub issue #${working.number}: ${working.title}. They handed it to you from the issue board.`,
    `When you finish and check an acceptance box of #${working.number}, tick it with the mcp__issue-board__tick tool. The mcp__issue-board__issues tool with number ${working.number} lists its boxes.`,
    `When you open a pull request for #${working.number}, write \`Closes #${working.number}\` in its body only if every acceptance box of #${working.number} is ticked by then.`,
    `Otherwise write \`Refs #${working.number}\`, so the issue stays open for what is left. If the repository's contributing guidelines say otherwise, follow them.`,
  ].join(' ')

// What `/issues new` asks Claude for, over the conversation so far.
export const draftPrompt = (what: string, labels: string[]): string =>
  [
    `Draft a GitHub issue for this repository${what ? ` about: ${what}` : ' from what we have discussed'}.`,
    'Answer with one JSON object and nothing else: {"title": "...", "body": "...", "labels": ["..."]}.',
    'Write the title as a short, plain sentence. In the body, say what is wrong or wanted and why, in plain sentences.',
    'End the body with a "## Acceptance" section of task-list boxes ("- [ ] ..."), one checkable outcome each.',
    labels.length > 0 ? `Choose labels only from this list, or none: ${labels.join(', ')}.` : 'Leave labels empty.',
  ].join(' ')

// The draft in Claude's reply, its labels kept to the ones the repository has; null when the reply holds none.
export const parseDraft = (text: string, labels: string[]): Draft | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as { title?: unknown; body?: unknown; labels?: unknown }
    if (typeof raw.title !== 'string' || raw.title.trim() === '' || typeof raw.body !== 'string') return null
    const picked = Array.isArray(raw.labels) ? raw.labels.filter((one): one is string => typeof one === 'string' && labels.includes(one)) : []
    return { title: raw.title.trim(), body: raw.body.trim(), labels: [...new Set(picked)] }
  } catch {
    return null
  }
}

// Every label the board's issues carry, sorted: the ones a draft may use.
export const labelsOf = (issues: Issue[]): string[] => [...new Set(issues.flatMap(issue => issue.labels.map(label => label.name)))].sort()

// An issue's or pull request's page on GitHub: the URL gh gave, or one made from the repo for a board saved without it.
export const pageOf = (repo: string, kind: 'issues' | 'pull', item: { number: number; url: string }): string =>
  item.url || `https://github.com/${repo}/${kind}/${item.number}`
