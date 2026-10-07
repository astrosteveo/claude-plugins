import { expect, test } from 'claude-code/testing'

import type { Board, Issue, PullRequest } from '../types'
import { candidatesOf, planMoves, questionsOf } from '../hooks/moves'
import type { Answers } from '../hooks/moves'

// The planner of the board's automatic Status moves, over every pair of issue kind and event, and two events on the
// same issue in one read. Issue #1 is the one each case is about: a plain issue, or an epic with two sub-issues, one
// closed. #3 is the epic's other sub-issue.

const STATUSES = ['Inbox', 'Ready', 'In progress', 'Verification', 'Done']
const project: Board['project'] = { id: 'P', number: 1, title: 'P', url: '', status: { id: 'F', options: STATUSES.map(name => ({ id: name, name })) }, priority: null }

type Kind = 'plain' | 'epic'
const issue = (number: number, status: string, more: Partial<Issue> = {}): Issue => ({
  number,
  title: `Issue ${number}`,
  url: '',
  labels: [],
  assignees: [],
  checks: [],
  updatedAt: '',
  body: '',
  item: `I${number}`,
  status,
  ...more,
})
const one = (kind: Kind, status: string, completed = 1): Issue =>
  issue(1, status, kind === 'epic' ? { subIssues: { total: 2, completed } } : {})
const pr = (number: number, issues: number[]): PullRequest => ({
  number,
  title: '',
  url: '',
  author: '',
  branch: '',
  isDraft: false,
  ci: 'none',
  review: '',
  additions: 0,
  deletions: 0,
  updatedAt: '',
  sha: '',
  failing: [],
  runs: [],
  issues,
})
const board = (issues: Issue[], prs: PullRequest[] = []): Board => ({ repo: 'o/r', issues, prs, velocity: { closed: [], merged: [] }, fetchedAt: 0, project })

// The events, each as the two reads that show it and what GitHub answers. They compose, so two can happen at once.
type Read = { before: Issue[]; next: Issue[]; prsBefore: PullRequest[]; answers: Answers }
const read = (kind: Kind, status: string): Read => ({
  before: [one(kind, status), issue(3, 'In progress', { parent: { number: 1, title: 'Issue 1', total: 2, completed: 1 } })],
  next: [one(kind, status), issue(3, 'In progress', { parent: { number: 1, title: 'Issue 1', total: 2, completed: 1 } })],
  prsBefore: [],
  answers: { merged: {}, closed: {}, bodies: {} },
})
type Event = (r: Read) => Read
const EVENTS: Record<string, Event> = {
  // Pull request #9 says `Refs #1` and merged; #1 stays open.
  'Refs merge': r => ({ ...r, prsBefore: [...r.prsBefore, pr(9, [1])], answers: { ...r.answers, merged: { ...r.answers.merged, 9: { value: true } } } }),
  // A second pull request, #10, that also says `Refs #1`, merged in the same read.
  'second Refs merge': r => ({ ...r, prsBefore: [...r.prsBefore, pr(10, [1])], answers: { ...r.answers, merged: { ...r.answers.merged, 10: { value: true } } } }),
  // Pull request #11 says `Closes #1` and merged, which closed #1 as completed.
  'Closes merge': r => ({
    ...r,
    next: r.next.filter(x => x.number !== 1),
    prsBefore: [...r.prsBefore, pr(11, [1])],
    answers: { ...r.answers, merged: { ...r.answers.merged, 11: { value: true } }, closed: { ...r.answers.closed, 1: { value: 'completed' } } },
  }),
  'closed as completed': r => ({ ...r, next: r.next.filter(x => x.number !== 1), answers: { ...r.answers, closed: { ...r.answers.closed, 1: { value: 'completed' } } } }),
  'closed as not planned': r => ({ ...r, next: r.next.filter(x => x.number !== 1), answers: { ...r.answers, closed: { ...r.answers.closed, 1: { value: 'not_planned' } } } }),
  // #3 closes, so the epic's count reads 2/2. Its body has one more box open.
  'last sub-issue closed': r => ({
    ...r,
    next: r.next.filter(x => x.number !== 3).map(x => (x.number === 1 && x.subIssues ? { ...x, subIssues: { total: 2, completed: 2 } } : x)),
    answers: { ...r.answers, bodies: { 1: { value: '- [ ] Every sub-issue is closed\n- [ ] Played it through' } } },
  }),
  // The same, with every other box ticked already.
  'last sub-issue closed, every box ticked': r => ({
    ...r,
    next: r.next.filter(x => x.number !== 3).map(x => (x.number === 1 && x.subIssues ? { ...x, subIssues: { total: 2, completed: 2 } } : x)),
    answers: { ...r.answers, bodies: { 1: { value: '- [x] Played it through\n- [ ] Every sub-issue is closed' } } },
  }),
  // #2, closed before, is open again under the epic, whose count drops.
  'sub-issue reopened': r => ({
    ...r,
    next: [
      ...r.next.map(x => (x.number === 1 && x.subIssues ? { ...x, subIssues: { total: 2, completed: 0 } } : x)),
      issue(2, 'Done', { parent: { number: 1, title: 'Issue 1', total: 2, completed: 0 } }),
    ],
  }),
}

// What the planner does with #1, as `rule to`, for each kind and events, from In progress. `-` is no move.
const CASES: [Kind, string[], string][] = [
  ['plain', ['Refs merge'], 'refs Verification'],
  ['plain', ['Closes merge'], 'closed Done'],
  ['plain', ['closed as completed'], 'closed Done'],
  ['plain', ['closed as not planned'], '-'],
  ['plain', ['sub-issue reopened'], '-'],
  ['epic', ['Refs merge'], '-'],
  ['epic', ['Closes merge'], 'closed Done'],
  ['epic', ['closed as completed'], 'closed Done'],
  ['epic', ['closed as not planned'], '-'],
  ['epic', ['last sub-issue closed'], 'epic Verification'],
  ['epic', ['last sub-issue closed, every box ticked'], 'epic Done'],
  ['epic', ['sub-issue reopened'], '-'],
  // Two events on the same issue in one read: one move, by the precedence.
  ['plain', ['Refs merge', 'second Refs merge'], 'refs Verification'],
  ['plain', ['Refs merge', 'Closes merge'], 'closed Done'],
  ['epic', ['Refs merge', 'last sub-issue closed'], 'epic Verification'],
  ['epic', ['Refs merge', 'last sub-issue closed, every box ticked'], 'epic Done'],
  ['epic', ['Refs merge', 'sub-issue reopened'], '-'],
  ['epic', ['Refs merge', 'Closes merge'], 'closed Done'],
]

const plan = (kind: Kind, events: string[], status = 'In progress', write = true) => {
  const r = events.reduce((acc, name) => (EVENTS[name] ?? (x => x))(acc), read(kind, status))
  const before = board(r.before, r.prsBefore)
  const next = board(r.next)
  return { before, next, plan: planMoves(before, next, write, r.answers) }
}
const shown = (moves: ReturnType<typeof planMoves>['moves']) => moves.filter(move => move.number === 1).map(move => `${move.rule} ${move.to ?? '-'}`)

for (const [kind, events, expected] of CASES) {
  test(`the planner moves ${kind === 'epic' ? 'an epic' : 'a plain issue'} on ${events.join(' and ')}: ${expected}`, () => {
    const { plan: made } = plan(kind, events)
    const mine = made.moves.filter(move => move.number === 1)
    expect(mine.length).toBeLessThanOrEqual(1)
    expect(shown(made.moves)[0] ?? '-').toBe(expected)
    expect(made.failed).toEqual([])
  })
}

test('a merged pull request that refers to an epic is never a question for GitHub, so it costs nothing', () => {
  const { before, next } = plan('epic', ['Refs merge'])
  expect(questionsOf(candidatesOf(before, next, true))).toEqual({ prs: [], closed: [], bodies: [] })
  const plain = plan('plain', ['Refs merge'])
  expect(questionsOf(candidatesOf(plain.before, plain.next, true))).toEqual({ prs: [9], closed: [], bodies: [] })
})

test('two merged pull requests that refer to the same issue move it once, naming the first', () => {
  const { plan: made } = plan('plain', ['Refs merge', 'second Refs merge'])
  expect(made.moves).toEqual([{ rule: 'refs', number: 1, item: 'I1', pr: 9, to: 'Verification' }])
})

test('an epic whose last sub-issue closes is ticked and closed, and no move goes backwards', () => {
  const ticked = plan('epic', ['last sub-issue closed, every box ticked']).plan.moves[0]
  expect(ticked).toMatchObject({ rule: 'epic', tick: 2, close: true, open: 0, to: 'Done', done: 'Done' })
  // At Done already, it still closes but doesn't move; at Verification or Done with a box open, it stays.
  expect(plan('epic', ['last sub-issue closed, every box ticked'], 'Done').plan.moves[0]).toMatchObject({ close: true, to: null })
  for (const status of ['Verification', 'Done']) {
    expect(plan('epic', ['last sub-issue closed'], status).plan.moves[0]).toMatchObject({ rule: 'epic', close: false, open: 1, to: null })
    expect(plan('plain', ['Refs merge'], status).plan.moves).toEqual([])
  }
  expect(plan('plain', ['closed as completed'], 'Done').plan.moves).toEqual([])
})

test('without leave to write the project, only an epic is planned, to be ticked and closed with no move', () => {
  for (const events of [['Refs merge'], ['closed as completed']]) expect(plan('plain', events, 'In progress', false).plan.moves).toEqual([])
  expect(plan('epic', ['last sub-issue closed, every box ticked'], 'In progress', false).plan.moves[0]).toMatchObject({ close: true, to: null, done: null })
})

test("a question GitHub couldn't answer is said once, unless another rule moves the issue", () => {
  const failing = (kind: Kind, events: string[]) => {
    const r = events.reduce((acc, name) => (EVENTS[name] ?? (x => x))(acc), read(kind, 'In progress'))
    const answers: Answers = { ...r.answers, merged: { 9: { error: 'nope' }, 10: { error: 'nope' } } }
    return planMoves(board(r.before, r.prsBefore), board(r.next), true, answers)
  }
  expect(failing('plain', ['Refs merge', 'second Refs merge'])).toEqual({ moves: [], failed: [{ rule: 'refs', number: 1, to: 'Verification', message: 'nope' }] })
  const body = plan('epic', ['last sub-issue closed'])
  const broken = planMoves(body.before, body.next, true, { merged: {}, closed: {}, bodies: { 1: { error: 'gone' } } })
  expect(broken).toEqual({ moves: [], failed: [{ rule: 'epic', number: 1, to: null, message: 'gone' }] })
})
