import type { Issue, LabelChange, Markers, Milestone, PlanChange, PlanRow, Project } from '../types'
import type { IssueChanges } from './parse'
import { fieldValueOf, projectMoveOf } from './parse'
import { optionOf } from './project'

// A plan Claude proposes with project_plan: the changes it lists, checked against the board, each with its reason.

// The most changes one plan holds, so a runaway call can't fill the pane.
export const PLAN_LIMIT = 100

// What one entry of the tool's `issues` list may change. Anything else is issue_update's.
const ISSUE_KEYS = new Set(['number', 'reason', 'status', 'priority', 'fields', 'addLabels', 'removeLabels', 'assign', 'unassign', 'milestone', 'parent', 'projectAfter'])

// What one entry of the tool's `labels` list may say.
const LABEL_KEYS = new Set(['name', 'reason', 'create', 'rename', 'color', 'description', 'delete'])

// What the checks need of the board: its open issues, its project and its open milestones, why the project can't be
// written to, if it can't, the repo's labels when the board has read them, and the Bugs and Later markers the person
// saved.
export type PlanContext = {
  issues: readonly Issue[]
  project: Project | null | undefined
  milestones?: readonly Milestone[]
  refusal: string | null
  labels?: readonly string[]
  markers?: Partial<Markers>
}

// A change to an issue, as opposed to one to the repo's labels.
export type IssueChange = Exclude<PlanChange, LabelChange>

// The issue a change is on; null for a change to the repo's labels.
export const issueOf = (change: PlanChange): number | null => (change.kind === 'label' ? null : change.number)

// GitHub keeps label names unique whatever their case.
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export type Planned = { changes: { change: PlanChange; reason: string }[] } | { problems: string[] }

const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map(one => one.trim()) : []

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

// The name a kind goes by in the card, the prompt and the problems.
const KIND_NAMES: Record<PlanChange['kind'], string> = { status: 'Status', priority: 'Priority', field: 'fields', labels: 'labels', assignees: 'assignees', milestone: 'milestone', parent: 'parent', order: 'order', label: 'repo labels' }

// What a change touches, so the same thing changed twice for one issue is caught.
const slotOf = (change: PlanChange): string =>
  change.kind === 'label' ? `label ${change.name.toLowerCase()}` : `${change.number} ${change.kind}${change.kind === 'field' ? ` ${change.field.toLowerCase()}` : ''}`

// The label changes of project_plan's input, one row each. Their problems go on `problems`.
const labelChangesOf = (entries: unknown[], context: PlanContext, problems: string[]): { change: LabelChange; reason: string }[] => {
  const changes: { change: LabelChange; reason: string }[] = []
  const repo = context.labels
  const known = (name: string) => repo?.find(one => same(one, name))
  entries.forEach((entry, index) => {
    const one = (entry ?? {}) as Record<string, unknown>
    const given = text(one.name)
    if (!given) {
      problems.push(`Label ${index + 1} has no name.`)
      return
    }
    const name = known(given) ?? given
    const at = `Label ${name}`
    const reason = text(one.reason)
    if (!reason) problems.push(`${at} has no reason.`)
    const unknown = Object.keys(one).filter(key => !LABEL_KEYS.has(key))
    if (unknown.length > 0) problems.push(`${at}: a plan can't change its ${unknown.join(', ')}.`)
    const rename = text(one.rename)
    const description = typeof one.description === 'string' ? one.description.trim() : undefined
    let color: string | undefined
    if (one.color !== undefined) {
      color = typeof one.color === 'string' ? one.color.trim().replace(/^#/, '').toLowerCase() : ''
      if (!/^[0-9a-f]{6}$/.test(color)) problems.push(`${at}: color takes six hex digits, such as d73a4a, not ${String(one.color)}.`)
    }
    const action = one.create === true ? 'create' : one.delete === true ? 'delete' : 'edit'
    if (one.create === true && one.delete === true) problems.push(`${at} can't be made and deleted at once.`)
    else if (action === 'create') {
      if (known(given)) problems.push(`The repo already has a label called ${name}.`)
      if (rename) problems.push(`${at}: name a new label as you want it, without rename.`)
    } else if (repo && !known(given)) problems.push(`The repo has no label called ${given}.`)
    else if (action === 'delete' && (rename || color !== undefined || description !== undefined)) problems.push(`${at}: a delete changes nothing else.`)
    else if (action === 'edit' && !rename && color === undefined && description === undefined) problems.push(`${at} changes nothing.`)
    const taken = action === 'edit' && rename && !same(rename, name) ? known(rename) : undefined
    if (taken) problems.push(`The repo already has a label called ${taken}.`)
    // The saved markers that go by the label: a rename moves them and a delete clears them.
    const saved = context.markers ?? {}
    const moves = action === 'delete' || (action === 'edit' && !!rename)
    const markers = moves
      ? ([saved.bug && 'label' in saved.bug && same(saved.bug.label, name) ? 'bug' : null, saved.later && same(saved.later, name) ? 'later' : null].filter(Boolean) as ('bug' | 'later')[])
      : []
    changes.push({
      change: {
        kind: 'label',
        action,
        name,
        ...(rename && action === 'edit' ? { rename } : {}),
        ...(color !== undefined && action !== 'delete' ? { color } : {}),
        ...(description !== undefined && action !== 'delete' ? { description } : {}),
        ...(markers.length > 0 ? { markers } : {}),
      },
      reason: reason ?? '',
    })
  })
  return changes
}

// The changes project_plan's input asks for, checked against the board as a whole: every problem is listed at once, and
// a plan with any problem is refused. Each entry may change several things on its issue; each becomes a row of its own,
// with the entry's reason. Changes to the repo's labels come first, so an issue can take a label the plan makes; then
// the rows are grouped by issue, in the order the issues first come. They apply in that order.
export const planOf = (input: unknown, context: PlanContext): Planned => {
  const raw = (input ?? {}) as { issues?: unknown; labels?: unknown }
  const entries = Array.isArray(raw.issues) ? raw.issues : []
  const labelEntries = Array.isArray(raw.labels) ? raw.labels : []
  if (entries.length === 0 && labelEntries.length === 0) return { problems: ['Give issues or labels: lists of changes, each with a reason.'] }
  const problems: string[] = []
  const changes: { change: PlanChange; reason: string }[] = labelChangesOf(labelEntries, context, problems)
  const { project } = context
  const open = new Set(context.issues.map(one => one.number))
  entries.forEach((entry, index) => {
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
    if (typeof one.projectAfter === 'number' && Number.isInteger(one.projectAfter) && one.projectAfter >= 0) {
      // An issue the project doesn't hold yet joins it when the plan sets one of its fields first, so it can move then.
      const joins = made.some(touchesProject)
      const issues = context.issues.map(issue => (issue.number === number && joins && !issue.item ? { ...issue, item: 'joining' } : issue))
      const move = project ? projectMoveOf(issues, number, one.projectAfter > 0 ? one.projectAfter : null, false) : null
      if (!project) problems.push(`${at}: the board reads no project, so it can't move it in the project's order.`)
      else if (typeof move === 'string') {
        if (open.has(number)) problems.push(`${at}: ${move.replace(`#${number} `, '')}.`)
      } else made.push({ kind: 'order', number, after: one.projectAfter > 0 ? one.projectAfter : null })
    }
    // An entry that asks for nothing a plan changes; one whose changes were refused already says why.
    const asked = Object.keys(one).some(key => ISSUE_KEYS.has(key) && key !== 'number' && key !== 'reason')
    if (made.length === 0 && !asked && unknown.length === 0) problems.push(`${at} changes nothing.`)
    for (const change of made) changes.push({ change, reason: reason ?? '' })
  })
  const seen = new Set<string>()
  for (const { change } of changes) {
    const slot = slotOf(change)
    if (seen.has(slot)) problems.push(change.kind === 'label' ? `Label ${change.name} is in the plan twice.` : `#${change.number}'s ${change.kind === 'field' ? change.field : KIND_NAMES[change.kind]} is in the plan twice.`)
    seen.add(slot)
  }
  if (changes.length > PLAN_LIMIT) problems.push(`A plan holds at most ${PLAN_LIMIT} changes; this one has ${changes.length}. Split it.`)
  if (context.refusal && changes.some(({ change }) => touchesProject(change))) problems.unshift(context.refusal)
  if (problems.length > 0) return { problems: [...new Set(problems)] }
  const order = [...new Set(changes.map(({ change }) => issueOf(change)))]
  return { changes: order.flatMap(number => changes.filter(({ change }) => issueOf(change) === number)) }
}

// Whether a change writes to the project rather than to the issue.
export const touchesProject = (change: PlanChange): boolean => change.kind === 'status' || change.kind === 'priority' || change.kind === 'field' || change.kind === 'order'

// The change as issue_update makes it.
export const issueChangesOf = (change: IssueChange): IssueChanges => {
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
    case 'order':
      return { projectAfter: change.after ?? 0 }
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
    case 'order':
      return change.after === null ? "top of the project's order" : `after #${change.after} in the order`
    case 'label':
      return labelText(change)
  }
}

// A label change in a few words: `new label area:net #1d76db`, `label bug → defect`, `delete label wontfix · on 3 open
// and 2 closed issues`, with what it does to a saved marker.
const labelText = (change: LabelChange): string => {
  const looks = [change.color ? `#${change.color}` : '', change.description !== undefined ? `“${change.description}”` : ''].filter(Boolean).join(' ')
  const markers = (change.markers ?? []).map(one => (one === 'bug' ? 'Bugs' : 'Later')).join(' and ')
  const marker = markers ? ` · ${change.action === 'delete' ? `clears the saved ${markers} marker` : `the saved ${markers} marker follows`}` : ''
  if (change.action === 'create') return `new label ${change.name}${looks ? ` ${looks}` : ''}`
  if (change.action === 'edit') return `label ${change.name}${change.rename ? ` → ${change.rename}` : ''}${looks ? ` ${looks}` : ''}${marker}`
  const count = change.uses ? change.uses.open + change.uses.closed : 0
  const uses = change.uses === null ? " · couldn't count its issues" : change.uses ? ` · on ${change.uses.open} open and ${change.uses.closed} closed ${count === 1 ? 'issue' : 'issues'}` : ''
  return `delete label ${change.name}${uses}${marker}`
}

// The plan's rows, each ticked, with an id that stays the row's own through an Apply.
export const rowsOf = (changes: { change: PlanChange; reason: string }[]): PlanRow[] =>
  changes.map(({ change, reason }, index) => ({ id: `${issueOf(change) ?? 'label'}-${index + 1}`, change, reason, picked: true, failed: null }))

// How many changes to how many issues and labels: `5 changes to 3 issues`, `4 changes to 2 issues and 2 labels`.
export const sizeText = (changes: readonly PlanChange[]): string => {
  const issues = new Set(changes.map(issueOf).filter(one => one !== null)).size
  const labels = changes.filter(change => change.kind === 'label').length
  const what = [issues > 0 || labels === 0 ? `${issues} ${issues === 1 ? 'issue' : 'issues'}` : '', labels > 0 ? `${labels} ${labels === 1 ? 'label' : 'labels'}` : '']
  return `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} to ${what.filter(Boolean).join(' and ')}`
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
  return [head, ...done, ...failed.map(({ row, message }) => `Failed: ${row.change.kind === 'label' ? '' : `#${row.change.number} `}${changeText(row.change)}: ${message}`)].join('\n')
}
