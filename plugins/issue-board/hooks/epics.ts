import type { Board, EpicNote, Issue, Project } from '../types'
import { isRole, roleOf } from './project'

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

// How long an epic line may stay in the band, whatever else holds: a backstop for a line nothing else clears.
export const EPIC_NOTE_MS = 24 * 60 * 60 * 1000

// The epic lines that still apply on this read of the board, which holds only open issues. A Verification line goes
// once its epic closes or every box is ticked. A reopened line goes once the sub-issue closes or leaves the epic, or the
// epic closes. An orphaned line goes once the sub-issue closes or leaves the epic, or the epic reopens. Any line goes
// after a day.
export const liveEpicNotes = (notes: EpicNote[], board: Board, now: number): EpicNote[] => {
  const open = new Map(board.issues.map(one => [one.number, one]))
  return notes.filter(note => {
    if (now - note.at >= EPIC_NOTE_MS) return false
    const epic = open.get(note.epic)
    if (note.kind === 'verify') return !!epic && epic.checks.some(check => !check.done)
    const sub = note.number === undefined ? undefined : open.get(note.number)
    if (!sub || sub.parent?.number !== note.epic) return false
    return note.kind === 'reopened' ? !!epic : !epic
  })
}
