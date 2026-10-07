import type { Board, Issue } from '../types'
import { checksOf, subIssuesBoxOf } from './boxes'
import { epicChanges, leftForDone, leftForVerification } from './epics'
import { isRole, roleOf } from './project'

// The board's automatic Status moves after a read. One planner answers "which Status does this issue move to after
// this read, and why", so two rules that pick the same issue can't both write it, in whatever order they finish.
//
// The rules:
// - `epic`: an open epic's last open sub-issue closed. Its "Every sub-issue is closed" box is ticked. With every box then
//   ticked, it closes as completed and moves to Done; with other boxes open, it moves to Verification.
// - `closed`: an issue left the board because it closed as completed. It moves to Done.
// - `refs`: a pull request that refers to an open issue without closing it merged. The issue moves to Verification.
export type Rule = 'epic' | 'closed' | 'refs'

// The precedence, in one place:
// - An issue with sub-issues is moved only by its sub-issues or by its own closing. Its Status belongs to its
//   sub-issues, so a pull request that refers to it never moves it: `refs` doesn't apply to epics.
// - Done beats Verification: when two rules pick the same issue, the move that takes it furthest wins.
// - Between two moves to the same Status, the rule first in this list wins, and the first pull request of two.
// - No move goes backwards: an issue at Done stays there, and one at Verification moves only to Done.
export const RULES: readonly { rule: Rule; epics: boolean; plain: boolean }[] = [
  { rule: 'epic', epics: true, plain: false },
  { rule: 'closed', epics: true, plain: true },
  { rule: 'refs', epics: false, plain: true },
]

// An issue with sub-issues.
export const isEpic = (issue: Pick<Issue, 'subIssues'> | undefined): boolean => (issue?.subIssues?.total ?? 0) > 0

// What a rule picked before GitHub has answered: the issue, its project item, and the pull request for `refs`.
export type Candidate = { rule: 'epic'; number: number } | { rule: 'closed'; number: number; item: string } | { rule: 'refs'; number: number; item: string; pr: number }

// What each rule picks between two reads. `write` says the board may write the project's Status: without it, only the
// epic rule picks, since ticking and closing an epic are the issue's own.
export const candidatesOf = (before: Board | null, next: Board, write: boolean): Candidate[] => {
  const was = new Map((before?.issues ?? []).map(one => [one.number, one]))
  const now = new Map(next.issues.map(one => [one.number, one]))
  const allowed = (rule: Rule, number: number): boolean => {
    const spec = RULES.find(one => one.rule === rule)
    return !!spec && (isEpic(now.get(number) ?? was.get(number)) ? spec.epics : spec.plain)
  }
  const picked: Candidate[] = [
    ...epicChanges(before, next).finished.filter(number => now.has(number)).map(number => ({ rule: 'epic' as const, number })),
    ...(write ? leftForDone(before, next).map(one => ({ rule: 'closed' as const, ...one })) : []),
    ...(write ? leftForVerification(before, next).map(one => ({ rule: 'refs' as const, ...one })) : []),
  ]
  return picked.filter(one => allowed(one.rule, one.number))
}

// What the planner needs GitHub to say, asked once each: whether each pull request merged, how each issue that left
// closed, and each finished epic's body as it is now.
export type Questions = { prs: number[]; closed: number[]; bodies: number[] }
export const questionsOf = (candidates: Candidate[]): Questions => {
  const unique = (list: number[]) => [...new Set(list)]
  return {
    prs: unique(candidates.flatMap(one => (one.rule === 'refs' ? [one.pr] : []))),
    closed: unique(candidates.flatMap(one => (one.rule === 'closed' ? [one.number] : []))),
    bodies: unique(candidates.flatMap(one => (one.rule === 'epic' ? [one.number] : []))),
  }
}

// GitHub's answers, or the error asking got. `closed` holds the reason an issue closed, null while it is open.
export type Answer<T> = { value: T } | { error: string }
export type Answers = {
  merged: Partial<Record<number, Answer<boolean>>>
  closed: Partial<Record<number, Answer<string | null>>>
  bodies: Partial<Record<number, Answer<string>>>
}

// One planned move. `to` is the Status it moves to; an epic's is null when it stays where it is but is still ticked or
// closed. For an epic: `tick` is the box to tick (0 for none), `close` whether it closes, `open` how many other boxes are
// still open, `done` the Done Status it reaches by closing when the board may write the project, and `body` the body the
// tick starts from.
export type Move =
  | { rule: 'epic'; number: number; title: string; to: string | null; tick: number; close: boolean; open: number; done: string | null; body: string }
  | { rule: 'closed'; number: number; item: string; to: string }
  | { rule: 'refs'; number: number; item: string; pr: number; to: string }

// A move the board couldn't plan because asking GitHub failed, said only when no other rule moves the issue.
export type Unmoved = { rule: Rule; number: number; to: string | null; message: string }
export type Plan = { moves: Move[]; failed: Unmoved[] }

// How far along a Status is, so no move goes backwards: Done, then Verification, then anything else.
const reach = (board: Board, status: string | null | undefined): number =>
  isRole(board.project, status, 'done') ? 2 : isRole(board.project, status, 'verification') ? 1 : 0

// The plan for one read: at most one move per issue, by the precedence above, in the order of RULES.
export const planMoves = (before: Board | null, next: Board, write: boolean, answers: Answers): Plan => {
  const project = next.project
  const done = roleOf(project, 'done')
  const verify = roleOf(project, 'verification')
  const was = new Map((before?.issues ?? []).map(one => [one.number, one]))
  const now = new Map(next.issues.map(one => [one.number, one]))
  const statusOf = (number: number) => (now.get(number) ?? was.get(number))?.status
  const moves: Move[] = []
  const failed: Unmoved[] = []
  for (const one of candidatesOf(before, next, write)) {
    if (one.rule === 'epic') {
      const epic = now.get(one.number)
      const answer = answers.bodies[one.number]
      if (!epic || !answer) continue
      if ('error' in answer) {
        failed.push({ rule: 'epic', number: one.number, to: null, message: answer.error })
        continue
      }
      const checks = checksOf(answer.value)
      const box = subIssuesBoxOf(checks)
      const open = checks.filter((check, index) => !check.done && index !== box - 1).length
      const target = open === 0 ? done : verify
      const to = write && target && reach(next, epic.status) < reach(next, target.name) ? target.name : null
      const tick = box > 0 && !checks[box - 1]?.done ? box : 0
      moves.push({ rule: 'epic', number: one.number, title: epic.title, to, tick, close: open === 0, open, done: write ? (done?.name ?? null) : null, body: answer.value })
      continue
    }
    const target = one.rule === 'closed' ? done : verify
    const answer = one.rule === 'closed' ? answers.closed[one.number] : answers.merged[one.pr]
    if (!target || !answer) continue
    if ('error' in answer) {
      failed.push({ rule: one.rule, number: one.number, to: target.name, message: answer.error })
      continue
    }
    const yes = one.rule === 'closed' ? answer.value === 'completed' : answer.value === true
    if (!yes || reach(next, statusOf(one.number)) >= reach(next, target.name)) continue
    moves.push(one.rule === 'closed' ? { rule: 'closed', number: one.number, item: one.item, to: target.name } : { rule: 'refs', number: one.number, item: one.item, pr: one.pr, to: target.name })
  }
  // One move per issue: the one that takes it furthest, then the rule first in RULES, then the first picked.
  const rank = (move: Move) => [reach(next, move.to ?? (move.rule === 'epic' && move.close ? done?.name : undefined)), -RULES.findIndex(spec => spec.rule === move.rule)] as const
  const best = new Map<number, Move>()
  for (const move of moves) {
    const held = best.get(move.number)
    const [a, b] = rank(move)
    const [c, d] = held ? rank(held) : [-1, 0]
    if (!held || a > c || (a === c && b > d)) best.set(move.number, move)
  }
  const order = (move: Move) => RULES.findIndex(spec => spec.rule === move.rule)
  const kept = [...best.values()].sort((x, y) => order(x) - order(y))
  const unmoved = failed.filter((one, index) => !best.has(one.number) && failed.findIndex(other => other.number === one.number) === index)
  return { moves: kept, failed: unmoved }
}
