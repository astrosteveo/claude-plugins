import { expect, test } from 'claude-code/testing'

import type { Board, Issue, Milestone, Project, Roles, Setup, SetupFacts, SetupProject } from '../types'
import { changedText, sameOwner, settledOf, transferRefusal } from '../hooks/changes'
import type { NewIssue } from '../hooks/changes'
import { assigneesOf, filedIssueOf, filedSaid, issueFieldsOf, milestoneNamed, parentAfter, projectStepOf, withFiled } from '../hooks/filing'
import type { Filed } from '../hooks/filing'
import { OPEN_PRS, boardOf, rateLimitTexts, velocityKept } from '../hooks/github'
import { areaLabelArgs, bugLabelArgs, choicesAfterSetup, inboxOf, itemsIn, markStep, setupDone, statusFieldOf } from '../hooks/setup'

// The decisions the four biggest `$` functions in register.tsx make, tested without faking gh: readGitHub's board,
// fileOne's filing, applySetup's steps and applyChanges' answer.

const issue = (number: number, more: Partial<Issue> = {}): Issue => ({
  number,
  title: `Issue ${number}`,
  url: '',
  labels: [],
  assignees: [],
  checks: [],
  updatedAt: '',
  body: '',
  ...more,
})
const board = (more: Partial<Board> = {}): Board => ({ repo: 'o/r', issues: [], prs: [], velocity: { closed: [], merged: [] }, fetchedAt: 0, ...more })
const project: Project = {
  id: 'P',
  number: 1,
  title: 'Plan',
  url: '',
  status: { id: 'S', options: ['Inbox', 'Ready', 'Done'].map(name => ({ id: name, name })) },
  priority: null,
}
const milestone = (number: number, title: string): Milestone => ({ number, title, due: null, description: '', open: 0, closed: 0 })
const filed: Filed = { number: 9, id: 900, node_id: 'N9', html_url: 'https://x/9', updated_at: 'T', labels: [{ name: 'bug' }], assignees: [{ login: 'me' }] }

// readGitHub

test('a read keeps the weekly counts of the same repo for an hour, and reads them again after', () => {
  const before = board({ velocityAt: 1_000 })
  expect(velocityKept(before, 'o/r', 1_000 + 59, 60)).toBe(before)
  expect(velocityKept(before, 'o/r', 1_000 + 60, 60)).toBeNull()
  expect(velocityKept(before, 'o/other', 1_000, 60)).toBeNull()
  expect(velocityKept(board(), 'o/r', 1_000, 60)).toBeNull()
  expect(velocityKept(null, 'o/r', 1_000, 60)).toBeNull()
})

test('a read makes the board from what it gathered, with kept counts when it read none', () => {
  const kept = board({ velocity: { closed: [1], merged: [2] }, velocityAt: 5 })
  const prs = JSON.stringify([{ number: 4, title: 'PR', url: '', author: { login: 'a' }, headRefName: 'b', headRefOid: 's', isDraft: false, statusCheckRollup: [], reviewDecision: '', additions: 1, deletions: 0, updatedAt: '', body: '', closingIssuesReferences: [] }])
  const made = boardOf({
    repo: 'o/r',
    graph: { issues: [issue(1)], project, types: ['Bug'], labels: ['bug'] },
    issues: [issue(1, { subOrder: [2] })],
    prs,
    threads: new Map([[4, 3]]),
    closed: null,
    merged: null,
    milestones: [milestone(1, 'v1')],
    kept,
    fetchedAt: 10,
  })
  expect(made.velocity).toEqual({ closed: [1], merged: [2] })
  expect(made.velocityAt).toBe(5)
  expect(made.issues[0]?.subOrder).toEqual([2])
  expect(made.prs.map(pr => [pr.number, pr.openThreads])).toEqual([[4, 3]])
  expect(made.issueTypes).toEqual(['Bug'])
  expect(made.labels).toEqual(['bug'])
  expect(made.project).toBe(project)
  const fresh = boardOf({ repo: 'o/r', graph: { issues: [], project: null, types: [] }, issues: [], prs: '[]', threads: new Map(), closed: '[]', merged: '[]', milestones: [], kept: null, fetchedAt: 10 })
  expect(fresh.velocityAt).toBe(10)
  expect(fresh.velocity.closed.every(count => count === 0)).toBe(true)
  expect('labels' in fresh).toBe(false)
})

test('a read lists the open pull requests with the fields the board shows', () => {
  expect(OPEN_PRS.slice(0, 6)).toEqual(['pr', 'list', '--state', 'open', '--limit', '50'])
  expect(OPEN_PRS.at(-1)).toContain('closingIssuesReferences')
})

test('a rate limit says when the board reads again', () => {
  const until = new Date(2026, 9, 7, 14, 5).getTime()
  expect(rateLimitTexts(until)).toEqual({
    error: "GitHub's rate limit for this account ran out. The board reads again at 14:05.",
    toast: "GitHub's rate limit ran out; the issue board waits until 14:05",
  })
})

// fileOne

test('filing finds a milestone by name, ignoring case', () => {
  expect(milestoneNamed([milestone(1, 'v1'), milestone(2, 'Next')], 'next')?.number).toBe(2)
  expect(milestoneNamed([milestone(1, 'v1')], 'v2')).toBeUndefined()
})

test('filing assigns @me to the person, and to no one while the board does not know who that is', () => {
  expect(assigneesOf(['@me', 'other'], 'me')).toEqual(['me', 'other'])
  expect(assigneesOf(['@me', 'other'], null)).toEqual(['other'])
  expect(assigneesOf(undefined, 'me')).toEqual([])
})

test('filing sends the fields asked for, and only those', () => {
  const spec: NewIssue = { title: 'T', body: 'B' }
  expect(issueFieldsOf(spec, [], undefined, undefined)).toEqual({ title: 'T', body: 'B', labels: [], assignees: [] })
  expect(JSON.stringify(issueFieldsOf({ ...spec, labels: ['bug'] }, ['me'], milestone(3, 'v1'), 'Bug'))).toBe('{"title":"T","body":"B","labels":["bug"],"assignees":["me"],"milestone":3,"type":"Bug"}')
})

test('filing says what GitHub made', () => {
  expect(filedSaid({ title: 'T', body: '' }, filed, milestone(1, 'v1'), 'Bug', ['area:x'])).toEqual(['“T”', 'labelled bug', 'assigned me', 'on v1', 'typed Bug', 'with the new label area:x'])
  expect(filedSaid({ title: 'T', body: '' }, { ...filed, labels: [], assignees: [] }, undefined, undefined, [])).toEqual(['“T”'])
})

test('a new sub-issue counts one more on its epic', () => {
  const epic = issue(1, { title: 'Epic', subIssues: { total: 2, completed: 1 } })
  expect(parentAfter([epic], 1)).toEqual({ number: 1, title: 'Epic', total: 3, completed: 1 })
  expect(parentAfter([], 5)).toEqual({ number: 5, title: '', total: 1, completed: 0 })
})

test('filing puts the issue in the project at the Status asked for, or the Inbox, unless the board may not write there', () => {
  expect(projectStepOf({ title: 'T', body: '' }, project, null)).toEqual({ add: [['status', 'Inbox']] })
  expect(projectStepOf({ title: 'T', body: '', status: 'Ready', priority: 'P1' }, project, null)).toEqual({ add: [['status', 'Ready'], ['priority', 'P1']] })
  expect(projectStepOf({ title: 'T', body: '' }, project, 'not allowed')).toEqual({ did: 'not added to Plan, which the board only reads' })
  expect(projectStepOf({ title: 'T', body: '', status: 'Ready' }, project, 'not allowed')).toEqual({ failed: 'set its Status or Priority: not allowed' })
  expect(projectStepOf({ title: 'T', body: '', priority: 'P1' }, null, null)).toEqual({ failed: 'set its Status or Priority: the board reads no project for this repo' })
  expect(projectStepOf({ title: 'T', body: '' }, null, null)).toBeNull()
})

test('a filed issue shows blocked only once the links were made, and only by issues the board holds', () => {
  const spec: NewIssue = { title: 'T', body: '- [ ] one', blockedBy: [2, 3] }
  const made = { item: 'I', set: { status: 'Inbox' }, milestone: milestone(1, 'v1'), type: 'Bug', parent: null, held: [issue(2)] }
  const linked = filedIssueOf(spec, filed, { ...made, did: ['“T”', 'blocked by #2, #3'] })
  expect(linked.blockedBy).toEqual([2])
  expect(linked.checks.length).toBe(1)
  expect([linked.item, linked.status, linked.priority, linked.milestone, linked.type]).toEqual(['I', 'Inbox', null, 'v1', 'Bug'])
  expect(linked.labels).toEqual([{ name: 'bug', color: '' }])
  expect(filedIssueOf(spec, filed, { ...made, did: ['“T”'] }).blockedBy).toEqual([])
})

test('a filed issue goes first on the board, with its epic count on the epic and its other sub-issues', () => {
  const parent = { number: 1, title: 'Epic', total: 3, completed: 1 }
  const before = board({ issues: [issue(1, { subIssues: { total: 2, completed: 1 } }), issue(2, { parent: { number: 1, title: 'Epic', total: 2, completed: 1 } }), issue(3)] })
  const after = withFiled(before, issue(9, { parent }), parent)
  expect(after.issues.map(one => one.number)).toEqual([9, 1, 2, 3])
  expect(after.issues[1]?.subIssues).toEqual({ total: 3, completed: 1 })
  expect(after.issues[2]?.parent?.total).toBe(3)
  expect(withFiled(before, issue(9), null).issues.slice(1)).toEqual(before.issues)
})

// applySetup

const setupProject = (options: string[]): SetupProject => ({
  id: 'P',
  number: 1,
  title: 'Plan',
  url: '',
  status: { id: 'S', options: options.map(name => ({ id: `o-${name}`, name, color: 'GRAY', description: '' })) },
  priority: null,
  workflows: [],
})
const picks = { inbox: 'Inbox', ready: 'Ready', backlog: null, started: null, verification: null, done: 'Done' }
const facts: SetupFacts = {
  repo: { id: 'R', name: 'o/r', ownerId: 'O', hasIssues: true, permission: 'ADMIN' },
  projects: [],
  labels: ['area:ui'],
  issues: [
    { id: 'I1', number: 1, items: [{ project: 'P', item: 'T1', status: 'Ready' }] },
    { id: 'I2', number: 2, items: [{ project: 'Q', item: 'T2', status: null }] },
  ],
  suggested: [],
  hasTemplate: false,
}
const ready: Setup = { phase: 'applying', facts, chosen: 'P', areas: 'ui, api', roles: picks, steps: [{ id: 'bug', title: 'Bug' }, { id: 'areas', title: 'Areas' }] }

test('Apply marks one step at a time, and leaves setup alone before it has steps', () => {
  const marked = markStep(ready, 'areas', 'failed', 'no')
  expect(marked && 'steps' in marked ? marked.steps : []).toEqual([{ id: 'bug', title: 'Bug' }, { id: 'areas', title: 'Areas', state: 'failed', message: 'no' }])
  expect(markStep({ phase: 'reading' }, 'bug', 'done')).toEqual({ phase: 'reading' })
  expect(markStep(null, 'bug', 'done')).toBeNull()
})

test('Apply writes the Status options with the ones the roles picked added', () => {
  const options = statusFieldOf(setupProject(['Ready']).status?.options ?? [], picks)
  expect(options.map(one => one.name)).toEqual(['Inbox', 'Ready', 'Done'])
  expect(options[1]).toEqual({ id: 'o-Ready', name: 'Ready', color: 'GRAY', description: '' })
  expect(options.filter(one => 'id' in one).length).toBe(1)
})

test("Apply knows each issue's item in the project it works in", () => {
  expect([...itemsIn(facts, 'P').entries()]).toEqual([[1, { project: 'P', item: 'T1', status: 'Ready' }]])
})

test('Apply puts items with no Status in the Inbox picked, or says the project has none', () => {
  expect(inboxOf(setupProject(['Inbox', 'Done']), picks)).toEqual({ field: 'S', option: 'o-Inbox' })
  expect(inboxOf(setupProject(['Done']), picks)).toBe('the project has no Inbox status')
  expect(inboxOf(setupProject(['Inbox']), { ...picks, inbox: null })).toBe('the project has no Inbox status')
  expect(inboxOf({ ...setupProject([]), status: null }, { ...picks, inbox: 'Triage' })).toBe('the project has no Triage status')
})

test('Apply makes the bug label and an area label for each area typed', () => {
  expect(bugLabelArgs('o/r')).toEqual(['label', 'create', 'bug', '-R', 'o/r', '--color', 'd73a4a', '--description', "Something isn't working"])
  expect(areaLabelArgs('o/r', 'ui, api', ['area:ui']).map(args => args[2])).toEqual(['area:api'])
})

test('Apply leaves the board reading the project it ended with, with its roles saved', () => {
  const ended = setupProject(['Inbox', 'Ready', 'Done'])
  const was: { declined?: string[]; preferred?: string; statuses?: Record<string, Roles> } = { declined: ['X'], statuses: { Q: {} } }
  const choices = choicesAfterSetup(was, ended, picks)
  expect(choices.preferred).toBe('P')
  expect(choices.declined).toEqual(['X'])
  expect(Object.keys(choices.statuses ?? {})).toEqual(['Q', 'P'])
  expect(choices.statuses?.P?.inbox).toBe('o-Inbox')
  expect(choicesAfterSetup({}, { ...ended, status: null }, picks)).toEqual({ preferred: 'P' })
})

test('Apply ends with the project as it now is in the pane', () => {
  const ended = setupProject(['Inbox'])
  const done = setupDone({ ...ready, facts: { ...facts, projects: [{ ...ended, title: 'Old' }] } }, ended, 'P', picks)
  expect(done && 'facts' in done ? [done.phase, done.chosen, done.facts.projects.map(one => one.title), done.facts.adopted, done.facts.saved?.project] : []).toEqual(['done', 'P', ['Plan'], 'P', 'P'])
  expect(setupDone(ready, null, null, picks)).toEqual({ ...ready, phase: 'done' })
  expect(setupDone({ ...ready, phase: 'ready' }, ended, 'P', picks)).toEqual({ ...ready, phase: 'ready' })
})

// applyChanges

test('a change says a Status or Priority the issue already has, and writes only the rest', () => {
  expect(settledOf(5, { status: 'done', priority: 'P1' }, { Status: 'Done' })).toEqual({ already: ["#5's Status is already Done."], skipped: ['status'], set: [['priority', 'P1']] })
  expect(settledOf(5, { status: 'Done' }, {})).toEqual({ already: [], skipped: [], set: [['status', 'Done']] })
})

test('a move stays with the same owner', () => {
  expect(sameOwner('o/r', 'other')).toBe('o/other')
  expect(sameOwner('o/r', 'O/other')).toBe('O/other')
  expect(() => sameOwner('o/r', 'x/other')).toThrow("an issue moves only to another of o's repos, not to x/other")
  expect(() => sameOwner('o/r', 'r')).toThrow('the issue is in o/r already')
})

test('a move from a public repo to a private one waits for a second, confirmed call', () => {
  expect(transferRefusal(5, 'o/r', 'o/p', { from: false, to: true }, false)).toContain("o/p is private and o/r is public, so GitHub won't move #5 back")
  expect(transferRefusal(5, 'o/r', 'o/p', { from: false, to: true }, true)).toBeNull()
  expect(transferRefusal(5, 'o/r', 'o/p', { from: true, to: true }, false)).toBeNull()
  expect(transferRefusal(5, 'o/r', 'o/p', { from: false, to: false }, false)).toBeNull()
})

test("a change's answer says what was already so, what changed, and the labels made", () => {
  expect(changedText(5, { status: 'Done' }, { already: ["#5's Status is already Done."], skipped: ['status'] }, [])).toBe("#5's Status is already Done.")
  expect(changedText(5, { status: 'Done', priority: 'P1' }, { already: ["#5's Status is already Done."], skipped: ['status'] }, [])).toBe("#5's Status is already Done. #5 set to P1.")
  expect(changedText(5, { addLabels: ['a', 'b'] }, { already: [], skipped: [] }, ['a', 'b'])).toBe('#5 labelled a, b. Created the labels a, b, new to the repo.')
  expect(changedText(5, {}, { already: [], skipped: [] }, [])).toBe('Nothing to change on #5.')
})
