import type { BoxTask, Check, Issue } from '../types'

export const BOX = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/

// The task-list boxes of an issue's body, in order.
export const checksOf = (body: string | null): Check[] =>
  (body ?? '').split(/\r?\n/).flatMap(line => {
    const match = BOX.exec(line)
    return match ? [{ done: match[1] !== ' ', text: (match[2] ?? '').trim() }] : []
  })

// Why a box an issue hasn't got can't be ticked or reworded: how many it has, and the numbers asked for that it lacks.
export const noBoxText = (number: number, count: number, missing: readonly number[]): string =>
  `#${number} has ${count} ${count === 1 ? 'box' : 'boxes'}, so there is no box ${missing.join(', ')}`

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

// The box an epic's last sub-issue closing ticks. Every epic is filed with it, so its acceptance says the parts are done.
export const SUB_ISSUES_BOX = 'Every sub-issue is closed'
const SUB_ISSUES = /^every sub-issue is closed\b/i

// The number of an epic's "Every sub-issue is closed" box, counted from 1 as the tick tool counts; 0 when it has none.
export const subIssuesBoxOf = (checks: Check[]): number => checks.findIndex(check => SUB_ISSUES.test(check.text)) + 1

// An epic's body with the "Every sub-issue is closed" box, added to its acceptance list when it hasn't one.
export const withSubIssuesBox = (body: string): string => (subIssuesBoxOf(checksOf(body)) > 0 ? body : addBoxes(body, [SUB_ISSUES_BOX]))

// Where a task Start made for a box stands now: the box by its text, or by its place should the text have changed.
// Null when the issue has no such box any more.
export const boxOf = (issue: Issue, task: BoxTask): { box: number; done: boolean } | null => {
  const index = issue.checks.findIndex(check => check.text === task.text)
  const at = index >= 0 ? index : task.box - 1
  const check = issue.checks[at]
  return check ? { box: at + 1, done: check.done } : null
}
