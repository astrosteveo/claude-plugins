import type { Ci, Comment, Issue, Project, ProjectField, ProjectView, PullRequest, StatusUpdate } from '../types'
import { BOX, checksOf } from './boxes'
import { agoText } from './layout'

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

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])

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

// What a GraphQL answer holds. GitHub answers some failures with an `errors` list beside the data rather than with a
// failed call, so the first error is thrown here, on every path, instead of being read as an empty answer.
export const graphqlData = (out: string): Record<string, any> => {
  const answer = JSON.parse(out) as { data?: Record<string, any> | null; errors?: { message?: string }[] } | null
  if (answer?.errors?.length) throw new Error(answer.errors[0]?.message || 'GitHub answered with an error')
  return answer?.data ?? {}
}

type RawComment = { author?: { login?: string } | null; body?: string | null; createdAt?: string }

// An issue's comments from `gh issue view --json comments`, oldest first.
export const commentsOf = (json: string): Comment[] =>
  ((JSON.parse(json) as { comments?: RawComment[] | null }).comments ?? []).map(one => ({ author: one.author?.login ?? 'ghost', body: (one.body ?? '').trim(), at: one.createdAt ?? '' }))

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
      const when = one.at ? agoText(one.at, now) : ''
      const text = one.body.length > TOOL_COMMENT_TEXT ? `${one.body.slice(0, TOOL_COMMENT_TEXT - 1)}…` : one.body
      return `— @${one.author}${when ? `, ${when}` : ''}:\n${text.replace(/^/gm, '  ')}`
    }),
  ].join('\n')
}

// `Closes #N` and its kin, and `Refs #N`: a pull request saying which issue it is for, closing it or not.
const REFERENCE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\b:?\s+#(\d+)/gi

// The issues a pull request is for: the ones GitHub links as closing, then the ones its body refers to.
export const issuesOf = (closing: { number: number }[], body: string): number[] => [
  ...new Set([...closing.map(one => one.number), ...[...body.matchAll(REFERENCE)].map(match => Number(match[1]))]),
]

// A GraphQL connection as GitHub answers it, any level of which may be missing; the board's read and setup's share it.
export type RawNodes<T> = { nodes?: (T | null)[] | null } | null | undefined
// A project field as a GraphQL fragment answers it. `options` are a single-select field's; setup reads them with their
// colors and descriptions, the board with only their ids and names.
export type RawField<O = { id: string; name: string }> = { id?: string; name?: string; dataType?: string; options?: O[]; configuration?: { iterations?: { id: string; title: string }[] } | null }
// What the board's read and setup both ask of a project.
export type RawProjectBase<O = { id: string; name: string }> = {
  id: string
  number: number
  title: string
  url: string
  closed?: boolean
  fields?: RawNodes<RawField<O>>
  workflows?: RawNodes<{ name: string; enabled: boolean }>
}

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
type RawProject = RawProjectBase & {
  statusUpdates?: RawNodes<RawUpdate>
  views?: RawNodes<RawView>
  order?: RawNodes<{ id: string }>
}
type RawGroup = RawNodes<{ name?: string }>
type RawView = { name: string; number: number; layout?: string; filter?: string | null; groupByFields?: RawGroup; verticalGroupByFields?: RawGroup }
type RawValue = { name?: string } | null | undefined
type RawAny = { name?: string; title?: string; text?: string; number?: number | null; date?: string } | null | undefined
type RawItem = { id: string; project?: { id: string } | null; status?: RawValue; priority?: RawValue; [alias: `f${number}`]: RawAny }

const LAYOUTS: Record<string, ProjectView['layout']> = { TABLE_LAYOUT: 'table', BOARD_LAYOUT: 'board', ROADMAP_LAYOUT: 'roadmap' }

// A project's views as the board keeps them. A table groups rows by its group-by field; a board's columns are its
// vertical group-by field.
const viewsOf = (project: RawProject): ProjectView[] =>
  nodesOf(project.views).map(view => {
    const layout = LAYOUTS[view.layout ?? ''] ?? 'table'
    const group = nodesOf(view.groupByFields)[0]?.name ?? (layout === 'board' ? nodesOf(view.verticalGroupByFields)[0]?.name : undefined)
    return { name: view.name, number: view.number, layout, filter: (view.filter ?? '').trim(), groupBy: group ?? null }
  })

// A field value as text, whatever the field's kind.
const anyValueOf = (raw: RawAny): string | undefined =>
  raw ? (raw.name ?? raw.title ?? raw.text ?? (typeof raw.number === 'number' ? String(raw.number) : undefined) ?? raw.date) : undefined
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
type RawPage = { data?: { repository?: { issueTypes?: RawNodes<{ name: string }>; labels?: RawNodes<{ name: string }>; projectsV2?: RawNodes<RawProject>; issues?: { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes?: (RawGraphIssue | null)[] } } } }

// A connection's nodes, without the missing ones.
export const nodesOf = <T>(list: RawNodes<T>): T[] => (list?.nodes ?? []).filter((one): one is T => one !== null && one !== undefined)

// A project's single-select field by name, whatever its case, with its options.
export const fieldOf = <O>(project: { fields?: RawNodes<RawField<O>> }, name: string): { id: string; options: O[] } | null => {
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
  const when = agoText(update.at, now)
  const note = update.body.split('\n')[0]?.trim() ?? ''
  return [update.status, note, update.target ? `target ${update.target}` : '', when].filter(Boolean).join(' · ')
}

// Where the next page of issues starts, or null after the last.
export const nextPageOf = (json: string): string | null => {
  const info = (JSON.parse(json) as RawPage).data?.repository?.issues?.pageInfo
  return info?.hasNextPage && info.endCursor ? info.endCursor : null
}

// The issues of every page, and the repo's project, read from the first page: the one `/issues setup` saved when it's
// still linked and open, else the first open one linked to the repo. `fields` are the extra field values the query
// asked each item for, in its order.
export const parseGraph = (
  pages: string[],
  preferred?: string,
  fields: readonly string[] = [],
): { issues: Issue[]; project: Project | null; types: string[]; labels?: string[] } => {
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
        views: viewsOf(linked),
      }
    : null
  const issues = parsed.flatMap(page => (page.data?.repository?.issues?.nodes ?? []).filter((one): one is RawGraphIssue => one !== null))
  // The repo's labels, for the Bugs and Later guess; left out when the answer has none, so the guess goes by the labels
  // the issues carry.
  const labels = parsed[0]?.data?.repository?.labels ? nodesOf(parsed[0].data.repository.labels).map(one => one.name) : undefined
  // Each item's place in the project's own order, by item id.
  const positions = new Map(nodesOf(linked?.order).map((one, index) => [one.id, index]))
  return {
    types: nodesOf(parsed[0]?.data?.repository?.issueTypes).map(one => one.name),
    ...(labels ? { labels } : {}),
    project,
    issues: issues.map(raw => {
      const item = project ? nodesOf(raw.projectItems).find(one => one.project?.id === project.id) : undefined
      const parent = raw.parent
      const values = item
        ? fields.flatMap((name, index) => {
            const value = anyValueOf(item[`f${index}`])
            return value === undefined ? [] : [[name, value] as const]
          })
        : []
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
        ...(values.length > 0 ? { fields: Object.fromEntries(values) } : {}),
        ...(item && positions.has(item.id) ? { position: positions.get(item.id) } : {}),
      }
    }),
  }
}

// The open pull requests for an issue: the ones GitHub says close it, and the ones that say they are for it.
export const prsFor = (issue: Issue, prs: PullRequest[]): PullRequest[] =>
  prs.filter(pr => (issue.prs ?? []).includes(pr.number) || (pr.issues ?? []).includes(issue.number))

// The times under `field` in gh's JSON list, such as each issue's closedAt.
export const timesOf = (json: string, field: string): string[] =>
  (JSON.parse(json) as Record<string, unknown>[]).flatMap(raw => (typeof raw[field] === 'string' ? [raw[field] as string] : []))
