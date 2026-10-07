import type { Board, Issue, Milestone, Project } from '../types'
import { checksOf } from './boxes'
import type { NewIssue } from './changes'
import { roleOf } from './project'

// Filing one issue, for issue_create and capture: what the board decides around the REST call that makes it. The calls
// themselves are fileOne's, in register.tsx.

// What GitHub answers to the REST call that files an issue, as far as the board reads it.
export type Filed = {
  number: number
  id: number
  node_id: string
  html_url: string
  updated_at: string
  labels: { name: string; color?: string }[]
  assignees: { login: string }[]
}

// The milestone a name stands for, ignoring case.
export const milestoneNamed = (list: readonly Milestone[], name: string): Milestone | undefined => list.find(one => one.title.toLowerCase() === name.toLowerCase())

// The logins to assign: `@me` is the person, and is left out while the board doesn't know who that is.
export const assigneesOf = (assign: readonly string[] | undefined, me: string | null): string[] =>
  (assign ?? []).flatMap(login => (login === '@me' ? (me ? [me] : []) : [login]))

// What the REST call that files the issue sends.
export const issueFieldsOf = (spec: NewIssue, assignees: string[], milestone: Milestone | undefined, type: string | undefined) => ({
  title: spec.title,
  body: spec.body,
  labels: spec.labels ?? [],
  assignees,
  ...(milestone ? { milestone: milestone.number } : {}),
  ...(type ? { type } : {}),
})

// What the answer says was done once the issue exists: its title, then its labels, assignees, milestone, type and the
// labels made for it.
export const filedSaid = (spec: NewIssue, raw: Filed, milestone: Milestone | undefined, type: string | undefined, made: string[]): string[] => {
  const did = [`“${spec.title}”`]
  if (raw.labels.length > 0) did.push(`labelled ${raw.labels.map(label => label.name).join(', ')}`)
  if (raw.assignees.length > 0) did.push(`assigned ${raw.assignees.map(user => user.login).join(', ')}`)
  if (milestone) did.push(`on ${milestone.title}`)
  if (type) did.push(`typed ${type}`)
  if (made.length > 0) did.push(`with the new ${made.length === 1 ? 'label' : 'labels'} ${made.join(', ')}`)
  return did
}

// The epic a new sub-issue went under, with its count as it is now: one more sub-issue, none more of them closed.
export const parentAfter = (issues: readonly Issue[], parent: number): NonNullable<Issue['parent']> => {
  const above = issues.find(one => one.number === parent)
  return { number: parent, title: above?.title ?? '', total: (above?.subIssues?.total ?? 0) + 1, completed: above?.subIssues?.completed ?? 0 }
}

// What filing does in the board's project: add the issue and set these fields, at the Status asked for or else the
// Inbox, where the project has one, to be triaged. A project the board may not write to gets nothing, and the answer
// says why. Null when there is no project and nothing was asked of one.
export type ProjectStep = { add: ['status' | 'priority', string][] } | { failed: string } | { did: string } | null
export const projectStepOf = (spec: NewIssue, project: Project | null | undefined, refusal: string | null): ProjectStep => {
  if (project && refusal) return spec.status || spec.priority ? { failed: `set its Status or Priority: ${refusal}` } : { did: `not added to ${project.title}, which the board only reads` }
  if (project) {
    const wanted = [
      ['status', spec.status ?? roleOf(project, 'inbox')?.name],
      ['priority', spec.priority],
    ] as const
    return { add: wanted.flatMap(([field, name]): ['status' | 'priority', string][] => (name ? [[field, name]] : [])) }
  }
  if (spec.status || spec.priority) return { failed: 'set its Status or Priority: the board reads no project for this repo' }
  return null
}

// The new issue as the board holds it, before any read. It shows blocked by the issues it was linked to that the board
// holds, once the links were made.
export const filedIssueOf = (
  spec: NewIssue,
  raw: Filed,
  made: {
    item: string | null
    set: { status?: string; priority?: string }
    milestone: Milestone | undefined
    type: string | undefined
    parent: Issue['parent']
    did: readonly string[]
    held: readonly Issue[]
  },
): Issue => ({
  number: raw.number,
  title: spec.title,
  url: raw.html_url,
  labels: raw.labels.map(label => ({ name: label.name, color: label.color ?? '' })),
  assignees: raw.assignees.map(user => user.login),
  checks: checksOf(spec.body),
  updatedAt: raw.updated_at,
  body: spec.body,
  id: raw.node_id,
  item: made.item,
  status: made.set.status ?? null,
  priority: made.set.priority ?? null,
  milestone: made.milestone?.title ?? null,
  ...(made.type ? { type: made.type } : {}),
  parent: made.parent,
  blockedBy: made.did.some(said => said.startsWith('blocked by')) ? (spec.blockedBy ?? []).filter(one => made.held.some(issue => issue.number === one)) : [],
})

// The board with a new issue first, and the count of the epic it went under on the epic and on each of its sub-issues,
// which carry it too.
export const withFiled = (board: Board, issue: Issue, parent: Issue['parent']): Board => {
  const counted = (one: Issue): Issue =>
    !parent
      ? one
      : one.number === parent.number
        ? { ...one, subIssues: { total: parent.total, completed: parent.completed } }
        : one.parent?.number === parent.number
          ? { ...one, parent: { ...one.parent, total: parent.total, completed: parent.completed } }
          : one
  const issues = board.issues.map(counted)
  return { ...board, issues: [issue, ...issues.filter(one => one.number !== issue.number)] }
}
