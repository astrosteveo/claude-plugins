import type { ThemeKey } from 'claude-code'
import type { Board, Check, Ci, Issue, Label, Markers, PullRequest } from '../types'
import type { Group } from './filters'
import { DEFAULT_MARKERS, isBug, isBugLabel } from './markers'

// Why a pull request can't merge as it stands, from GitHub's merge state: conflicts with its base, or behind it.
export const mergeNoteOf = (pr: PullRequest): { text: string; color: ThemeKey } | null =>
  pr.mergeState === 'DIRTY' ? { text: '⚠ conflicts', color: 'error' } : pr.mergeState === 'BEHIND' ? { text: '↓ behind', color: 'warning' } : null

// The labels worth a chip on a row: not the area it is grouped under, not the bug label (a badge of its own).
export const chipsOf = (issue: Issue, markers: Markers = DEFAULT_MARKERS): Label[] => issue.labels.filter(one => !one.name.startsWith('area:') && !isBugLabel(one, markers))

// A label's color as a surface draws it: GitHub's hex, or nothing for a label without one.
export const hex = (label: Label): string | undefined => (/^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : undefined)

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

// A card above a row too near the pane's top would be pushed down over the row, so each row knows the lines free
// above it in the window. They are at least these: each line of the board above the list, each heading and row one
// line, an open card none. Counting short leaves a card smaller than its room, never bigger.
export const roomAbove = (pane: {
  now: Board
  width: number
  // The labels of the Issues heading's tabs and groupings.
  tabs: string[]
  groupings: string[]
  // Whether the sparklines show, and the last refresh's failure.
  trends: boolean
  failure: string | null
  sectionOpen: (key: string) => boolean
  arming: boolean
  runs: number
  unknownTerms: number
  triaging: boolean
  triageFailed: boolean
  shown: Issue[]
  groups: Group[]
  opened: string[]
  offset: number
}): ((number: number) => number) => {
  const { now, width, sectionOpen, triaging, shown, groups, opened } = pane
  const listed$ = triaging
    ? shown.map(issue => issue.number)
    : groups.flatMap(group => [null, ...(group.folded && !opened.includes(group.key) ? [] : group.issues.map(issue => issue.number))])
  // The Issues heading wraps its buttons, each its label and four cells of brackets; the search field, of no known
  // width, isn't counted.
  const heading$ = wrappedLines(
    [
      cells('Issues'),
      ...pane.tabs.map(label => cells(label) + 4),
      cells('by'),
      ...pane.groupings.map(label => cells(label) + 4),
    ],
    width,
  )
  const above$ =
    1 +
    heading$ +
    (pane.trends ? 1 : 0) +
    (pane.failure ? 1 : 0) +
    (now.project?.update ? 1 : 0) +
    (now.prs.length > 0 ? 1 + (sectionOpen('prs') ? now.prs.length : 0) : 0) +
    ((now.milestones ?? []).length > 0 ? 1 + (sectionOpen('milestones') ? (now.milestones ?? []).length : 0) : 0) +
    (pane.arming && now.prs.length > 0 ? 1 : 0) +
    pane.runs +
    (pane.unknownTerms > 0 ? 1 : 0) +
    (triaging ? 1 + (pane.triageFailed ? 1 : 0) : 0)
  return number => Math.max(0, above$ + listed$.indexOf(number) - pane.offset)
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

// A CI state's mark alone, as a row or a count shows it beside a pull request.
export const ciGlyph = (ci: Ci): string => ciBadge[ci].text.trim().split(' ')[0] ?? ''

// The folded Pull requests heading: how many are open, then how many pass, fail and are running, each that has any.
export const prCountsText = (prs: PullRequest[]): string =>
  [
    `${prs.length} open`,
    ...(['pass', 'fail', 'pending'] as const).flatMap(ci => {
      const count = prs.filter(pr => pr.ci === ci).length
      return count > 0 ? [`${ciGlyph(ci)} ${count}`] : []
    }),
  ].join(' · ')

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

// How long ago, the way GitHub's lists say it: now, 5m, 3h, 2d, 6w, 1y. It takes a time in milliseconds or an ISO
// string, and gives '' for one it can't read.
export const ago = (when: number | string, now: number): string => {
  const at = typeof when === 'number' ? when : Date.parse(when)
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

// How long ago as words for a sentence: "just now" under a minute, else "5m ago". Bare `ago` says "now" then, which
// reads wrong with " ago" after it. Gives '' for a time it can't read.
export const agoText = (when: number | string, now: number): string => {
  const age = ago(when, now)
  return age === 'now' ? 'just now' : age ? `${age} ago` : ''
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

// What a pull request's row has room for. `fixed` is the cells that always stay: the CI badge, the number, the ◆ and
// the gaps around the title. Each part is its width in cells with the gap before it, 0 when the row has none. Short of
// room for a title of `floor` cells, the row drops the reviewers it asks, then the open threads, the diff counts, the
// linked issue, the merge note and the review mark, in that order, and last shortens Finish & merge to Merge. The
// title gets what is left, so the row stays on one line.
export const PR_PARTS = ['asked', 'threads', 'size', 'issue', 'merge', 'review'] as const
export type PrPart = (typeof PR_PARTS)[number]
export const FINISH = '⇲ Finish & merge'
export const FINISH_SHORT = '⇲ Merge'
export const prRowRoom = (
  width: number,
  fixed: number,
  parts: Record<PrPart, number>,
  floor = 16,
): { shown: Record<PrPart, boolean>; finish: string; title: number } => {
  const shown = Object.fromEntries(PR_PARTS.map(part => [part, parts[part] > 0])) as Record<PrPart, boolean>
  let finish = FINISH
  // A framed button is its label and four cells of brackets, with a cell between it and the title's side.
  const room = () => width - fixed - (cells(finish) + 4 + 1) - PR_PARTS.reduce((sum, part) => sum + (shown[part] ? parts[part] : 0), 0)
  for (const part of PR_PARTS) {
    if (room() >= floor) break
    shown[part] = false
  }
  if (room() < floor) finish = FINISH_SHORT
  return { shown, finish, title: Math.max(1, room()) }
}

// `text` padded with spaces to `width` cells.
export const pad = (text: string, width: number): string => `${text}${' '.repeat(Math.max(0, width - cells(text)))}`

// The board in a line, such as `35 issues · 1 bug · PR #335✓`; undefined with nothing open, so nothing shows.
// `footer`: the branch whose pull request Claude Code's own PR footer already shows in the same row. That pull request
// is left out of the list, so the row doesn't name it twice.
export const summary = (issues: Issue[], prs: PullRequest[], markers: Markers = DEFAULT_MARKERS, footer: string | null = null): string | undefined => {
  const bugs = issues.filter(issue => isBug(issue, markers)).length
  const listed = footer === null ? prs : prs.filter(pr => pr.branch !== footer)
  const parts: string[] = []
  if (issues.length > 0) parts.push(`${issues.length} issue${issues.length === 1 ? '' : 's'}`)
  if (bugs > 0) parts.push(`${bugs} bug${bugs === 1 ? '' : 's'}`)
  if (listed.length > 0) parts.push(`PR ${listed.map(pr => `#${pr.number}${ciMark[pr.ci]}`).join(' ')}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
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

const BLOCKS = '▁▂▃▄▅▆▇█'

// One block a week, as tall as that week against the busiest.
export const spark = (counts: number[]): string => {
  const top = Math.max(0, ...counts)
  return counts.map(count => (top === 0 ? BLOCKS[0] : BLOCKS[Math.round((count / top) * (BLOCKS.length - 1))])).join('')
}

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

// An issue as a line in the conversation names it: its number, and its title when it has one.
export const named = (issue: { number: number; title?: string }): string => {
  const title = issue.title?.trim()
  return title ? `#${issue.number} "${title}"` : `#${issue.number}`
}
