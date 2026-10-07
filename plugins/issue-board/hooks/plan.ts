import type { Issue, Milestone, PlanChange, PlanRow, Project } from '../types'
import type { IssueChanges } from './parse'
import { fieldValueOf } from './parse'
import { optionOf } from './project'

// A plan Claude proposes with project_plan: the changes it lists, checked against the board, each with its reason.

// The most changes one plan holds, so a runaway call can't fill the pane.
export const PLAN_LIMIT = 100

// What one entry of the tool's `issues` list may change. Anything else is issue_update's.
const ISSUE_KEYS = new Set(['number', 'reason', 'status', 'priority', 'fields', 'addLabels', 'removeLabels', 'assign', 'unassign', 'milestone', 'parent'])

// What the checks need of the board: its open issues, its project and its open milestones, and why the project can't be
// written to, if it can't.
export type PlanContext = { issues: readonly Issue[]; project: Project | null | undefined; milestones?: readonly Milestone[]; refusal: string | null }

export type Planned = { changes: { change: PlanChange; reason: string }[] } | { problems: string[] }

const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map(one => one.trim()) : []

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

// The name a kind goes by in the card, the prompt and the problems.
const KIND_NAMES: Record<PlanChange['kind'], string> = { status: 'Status', priority: 'Priority', field: 'fields', labels: 'labels', assignees: 'assignees', milestone: 'milestone', parent: 'parent' }

// What a change touches, so the same thing changed twice for one issue is caught.
const slotOf = (change: PlanChange): string => `${change.number} ${change.kind}${change.kind === 'field' ? ` ${change.field.toLowerCase()}` : ''}`

// The changes project_plan's input asks for, checked against the board as a whole: every problem is listed at once, and
// a plan with any problem is refused. Each entry may change several things on its issue; each becomes a row of its own,
// with the entry's reason. Rows are grouped by issue, in the order the issues first come, and apply in that order.
export const planOf = (input: unknown, context: PlanContext): Planned => {
  const raw = (input ?? {}) as { issues?: unknown }
  if (!Array.isArray(raw.issues) || raw.issues.length === 0) return { problems: ['Give issues: a list of changes, each with an issue number and a reason.'] }
  const problems: string[] = []
  const changes: { change: PlanChange; reason: string }[] = []
  const { project } = context
  const open = new Set(context.issues.map(one => one.number))
  raw.issues.forEach((entry, index) => {
    const one = (entry ?? {}) as Record<string, unknown>
    const number = one.number
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
      problems.push(`Entry ${index + 1} has no issue number.`)
      return
    }
    const at = `#${number}`
    if (!open.has(number)) problems.push(`${at} isn't an open issue on the board.`)
    const reason = text(one.reason)
    if (!reason) problems.push(`${at} has no reason.`)
    const unknown = Object.keys(one).filter(key => !ISSUE_KEYS.has(key))
    if (unknown.length > 0) problems.push(`${at}: a plan can't change ${unknown.join(', ')}; use issue_update for that.`)
    const made: PlanChange[] = []
    for (const kind of ['status', 'priority'] as const) {
      const value = text(one[kind])
      if (!value) continue
      const field = kind === 'status' ? project?.status : project?.priority
      const option = optionOf(field, value)
      if (!project) problems.push(`${at}: the board reads no project, so it can't set ${KIND_NAMES[kind]}.`)
      else if (!option) problems.push(`${at}: ${project.title} has no ${KIND_NAMES[kind]} called ${value}${field?.options.length ? `; it has ${field.options.map(o => o.name).join(', ')}` : ''}.`)
      else made.push({ kind, number, value: option.name })
    }
    if (one.fields && typeof one.fields === 'object' && !Array.isArray(one.fields)) {
      for (const [name, value] of Object.entries(one.fields as Record<string, unknown>)) {
        if (/^(status|priority)$/i.test(name.trim())) {
          problems.push(`${at}: set ${name.trim()} with ${name.trim().toLowerCase()}, not fields.`)
          continue
        }
        if (!project) {
          problems.push(`${at}: the board reads no project, so it can't set ${name}.`)
          continue
        }
        const field = project.fields?.find(known => known.name.toLowerCase() === name.trim().toLowerCase())
        if (!field) {
          problems.push(`${at}: ${project.title} has no field called ${name}.`)
          continue
        }
        if (value !== null) {
          const fits = fieldValueOf(field, value)
          if (typeof fits === 'string') {
            problems.push(`${at}: ${fits}.`)
            continue
          }
        }
        made.push({ kind: 'field', number, field: field.name, value: value === null ? null : typeof value === 'number' ? value : String(value).trim() })
      }
    }
    for (const [kind, add, remove] of [
      ['labels', names(one.addLabels), names(one.removeLabels)],
      ['assignees', names(one.assign), names(one.unassign)],
    ] as const) {
      if (add.length > 0 || remove.length > 0) made.push({ kind, number, add, remove })
    }
    if (typeof one.milestone === 'string') {
      const title = one.milestone.trim()
      const known = context.milestones?.find(milestone => milestone.title.toLowerCase() === title.toLowerCase())
      if (title && context.milestones && !known) problems.push(`${at}: the repo has no open milestone called ${title}.`)
      else made.push({ kind: 'milestone', number, value: title ? (known?.title ?? title) : null })
    }
    if (typeof one.parent === 'number' && Number.isInteger(one.parent) && one.parent >= 0) {
      if (one.parent === number) problems.push(`${at} can't be its own parent.`)
      else if (one.parent > 0 && !open.has(one.parent)) problems.push(`${at}: its parent #${one.parent} isn't an open issue on the board.`)
      else made.push({ kind: 'parent', number, value: one.parent > 0 ? one.parent : null })
    }
    // An entry that asks for nothing a plan changes; one whose changes were refused already says why.
    const asked = Object.keys(one).some(key => ISSUE_KEYS.has(key) && key !== 'number' && key !== 'reason')
    if (made.length === 0 && !asked && unknown.length === 0) problems.push(`${at} changes nothing.`)
    for (const change of made) changes.push({ change, reason: reason ?? '' })
  })
  const seen = new Set<string>()
  for (const { change } of changes) {
    const slot = slotOf(change)
    if (seen.has(slot)) problems.push(`#${change.number}'s ${change.kind === 'field' ? change.field : KIND_NAMES[change.kind]} is in the plan twice.`)
    seen.add(slot)
  }
  if (changes.length > PLAN_LIMIT) problems.push(`A plan holds at most ${PLAN_LIMIT} changes; this one has ${changes.length}. Split it.`)
  if (context.refusal && changes.some(({ change }) => touchesProject(change))) problems.unshift(context.refusal)
  if (problems.length > 0) return { problems: [...new Set(problems)] }
  const order = [...new Set(changes.map(({ change }) => change.number))]
  return { changes: order.flatMap(number => changes.filter(({ change }) => change.number === number)) }
}

// Whether a change writes to the project rather than to the issue.
export const touchesProject = (change: PlanChange): boolean => change.kind === 'status' || change.kind === 'priority' || change.kind === 'field'

// The change as issue_update makes it.
export const issueChangesOf = (change: PlanChange): IssueChanges => {
  switch (change.kind) {
    case 'status':
      return { status: change.value }
    case 'priority':
      return { priority: change.value }
    case 'field':
      return { fields: { [change.field]: change.value } }
    case 'labels':
      return { ...(change.add.length > 0 ? { addLabels: change.add } : {}), ...(change.remove.length > 0 ? { removeLabels: change.remove } : {}) }
    case 'assignees':
      return { ...(change.add.length > 0 ? { assign: change.add } : {}), ...(change.remove.length > 0 ? { unassign: change.remove } : {}) }
    case 'milestone':
      return { milestone: change.value }
    case 'parent':
      return { parent: change.value }
  }
}

// A change in a few words, for its row on the card: `Status → Ready`, `labels +bug −area:ui`, `under #35`.
export const changeText = (change: PlanChange): string => {
  const both = (add: string[], remove: string[]) => [...add.map(one => `+${one}`), ...remove.map(one => `−${one}`)].join(' ')
  switch (change.kind) {
    case 'status':
    case 'priority':
      return `${KIND_NAMES[change.kind]} → ${change.value}`
    case 'field':
      return change.value === null ? `${change.field} cleared` : `${change.field} → ${change.value}`
    case 'labels':
    case 'assignees':
      return `${change.kind} ${both(change.add, change.remove)}`
    case 'milestone':
      return change.value === null ? 'off its milestone' : `milestone → ${change.value}`
    case 'parent':
      return change.value === null ? 'out of its epic' : `under #${change.value}`
  }
}

// The plan's rows, each ticked, with an id that stays the row's own through an Apply.
export const rowsOf = (changes: { change: PlanChange; reason: string }[]): PlanRow[] =>
  changes.map(({ change, reason }, index) => ({ id: `${change.number}-${index + 1}`, change, reason, picked: true, failed: null }))

// How many changes to how many issues: `5 changes to 3 issues`.
export const sizeText = (changes: readonly PlanChange[]): string => {
  const issues = new Set(changes.map(change => change.number)).size
  return `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} to ${issues} ${issues === 1 ? 'issue' : 'issues'}`
}

// The changes counted by kind, in the order kinds first come: `Status 3 · Priority 2 · labels 1`.
export const kindsText = (changes: readonly PlanChange[]): string => {
  const counts = new Map<string, number>()
  for (const change of changes) counts.set(KIND_NAMES[change.kind], (counts.get(KIND_NAMES[change.kind]) ?? 0) + 1)
  return [...counts].map(([name, count]) => `${name} ${count}`).join(' · ')
}

// What the permission prompt for project_plan says: the plan's size and its changes by kind.
export const planAsk = (changes: readonly PlanChange[]): string =>
  `Apply Claude's plan: ${sizeText(changes)}?\n${kindsText(changes)}\nThe /issues pane shows it row by row, to apply only some.`

// What a refused plan tells Claude: every problem, one a line.
export const problemsOfPlan = (problems: readonly string[]): string =>
  `The plan wasn't made. Fix ${problems.length === 1 ? 'this' : 'these'} and call again:\n${problems.map(one => `- ${one}`).join('\n')}`

// What an Apply answers: how many changes went through, each one's text, and each failure with why. The failed rows stay
// on the card.
export const appliedText = (done: readonly string[], failed: readonly { row: PlanRow; message: string }[]): string => {
  const total = done.length + failed.length
  const head =
    failed.length === 0
      ? `Applied the plan: ${total} ${total === 1 ? 'change' : 'changes'}.`
      : `Applied ${done.length} of ${total} changes. ${failed.length} failed and ${failed.length === 1 ? 'stays' : 'stay'} on the plan card in /issues.`
  return [head, ...done, ...failed.map(({ row, message }) => `Failed: #${row.change.number} ${changeText(row.change)}: ${message}`)].join('\n')
}
