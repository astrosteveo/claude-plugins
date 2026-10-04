import type { Check, Ci, Filter, Issue, PullRequest } from '../types'

type RawLabel = { name: string }
type RawIssue = { number: number; title: string; labels: RawLabel[]; body: string | null; updatedAt: string }
type RawCheck = { status?: string; conclusion?: string; state?: string }
type RawPr = {
  number: number
  title: string
  headRefName: string
  isDraft: boolean
  statusCheckRollup: RawCheck[] | null
  reviewDecision: string | null
}

const BOX = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])

// The task-list boxes of an issue's body, in order.
export const checksOf = (body: string | null): Check[] =>
  (body ?? '').split('\n').flatMap(line => {
    const match = BOX.exec(line)
    return match ? [{ done: match[1] !== ' ', text: (match[2] ?? '').trim() }] : []
  })

export const parseIssues = (json: string): Issue[] =>
  (JSON.parse(json) as RawIssue[]).map(raw => ({
    number: raw.number,
    title: raw.title,
    labels: raw.labels.map(label => label.name),
    checks: checksOf(raw.body),
    updatedAt: raw.updatedAt,
  }))

export const ciOf = (rollup: RawCheck[] | null): Ci => {
  const checks = rollup ?? []
  if (checks.length === 0) return 'none'
  if (checks.some(check => FAILED.has(check.conclusion ?? check.state ?? ''))) return 'fail'
  if (checks.some(check => (check.status !== undefined && check.status !== 'COMPLETED') || check.state === 'PENDING' || check.state === 'EXPECTED')) {
    return 'pending'
  }
  return 'pass'
}

export const parsePrs = (json: string): PullRequest[] =>
  (JSON.parse(json) as RawPr[]).map(raw => ({
    number: raw.number,
    title: raw.title,
    branch: raw.headRefName,
    isDraft: raw.isDraft,
    ci: ciOf(raw.statusCheckRollup),
    review: raw.reviewDecision ?? '',
  }))

export const isBug = (issue: Issue): boolean => issue.labels.includes('bug')
export const isFuture = (issue: Issue): boolean => issue.labels.includes('future')

export const areaOf = (issue: Issue): string => {
  const label = issue.labels.find(name => name.startsWith('area:'))
  return label ? label.slice('area:'.length) : 'other'
}

export const matches = (filter: Filter, issue: Issue): boolean => {
  switch (filter) {
    case 'active':
      return !isFuture(issue)
    case 'future':
      return isFuture(issue)
    case 'bugs':
      return isBug(issue)
    case 'all':
      return true
  }
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
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, list]) => [area, [...list].sort((a, b) => rank(a) - rank(b) || b.number - a.number)])
}

export const progressOf = (checks: Check[]): string => {
  if (checks.length === 0) return '  -  '
  const done = checks.filter(check => check.done).length
  return `${String(done).padStart(2)}/${String(checks.length).padEnd(2)}`
}

export const ciMark: Record<Ci, string> = { pass: '✓', fail: '✗', pending: '…', none: '·' }

export const clockTime = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export const summary = (issues: Issue[], prs: PullRequest[]): string => {
  const bugs = issues.filter(isBug).length
  const parts = [`${issues.length} issues`]
  if (bugs > 0) parts.push(`${bugs} bug${bugs === 1 ? '' : 's'}`)
  if (prs.length > 0) parts.push(`PR ${prs.map(pr => `#${pr.number}${ciMark[pr.ci]}`).join(' ')}`)
  return parts.join(' · ')
}

// The message the Start and Draft buttons hand Claude for an issue.
export const startPrompt = (issue: Issue): string => {
  const open = issue.checks.filter(check => !check.done)
  const boxes = open.length > 0 ? `\n\nIts open acceptance boxes:\n${open.map(check => `- ${check.text}`).join('\n')}` : ''
  return `Let's start on #${issue.number}: ${issue.title}. Read it with \`gh issue view ${issue.number}\` first.${boxes}`
}
