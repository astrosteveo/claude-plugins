import type { Issue, Milestone, PlanChange, PlanRow, Project, ProjectView, ViewShape } from '../types'
import type { IssueChanges } from './parse'
import { fieldValueOf, projectMoveOf, viewMatchOf } from './parse'
import { optionOf } from './project'

// A plan Claude proposes with project_plan: the changes it lists, checked against the board, each with its reason.

// The most changes one plan holds, so a runaway call can't fill the pane.
export const PLAN_LIMIT = 100

// What one entry of the tool's `issues` list may change. Anything else is issue_update's.
const ISSUE_KEYS = new Set(['number', 'reason', 'status', 'priority', 'fields', 'addLabels', 'removeLabels', 'assign', 'unassign', 'milestone', 'parent', 'projectAfter'])

// What one entry of the tool's `views` list may hold: the view it changes (none to create one), and what it becomes.
const VIEW_KEYS = new Set(['view', 'reason', 'name', 'layout', 'filter', 'delete'])
const LAYOUTS: readonly ProjectView['layout'][] = ['table', 'board', 'roadmap']

// A change to an issue, as against one to the project's views.
export type IssueChange = Exclude<PlanChange, { kind: 'view' }>
export type ViewChange = Extract<PlanChange, { kind: 'view' }>

// What the checks need of the board: its open issues, its project and its open milestones, and why the project can't be
// written to, if it can't.
export type PlanContext = { issues: readonly Issue[]; project: Project | null | undefined; milestones?: readonly Milestone[]; refusal: string | null }

export type Planned = { changes: { change: PlanChange; reason: string }[] } | { problems: string[] }

const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map(one => one.trim()) : []

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

// The name a kind goes by in the card, the prompt and the problems.
const KIND_NAMES: Record<PlanChange['kind'], string> = { status: 'Status', priority: 'Priority', field: 'fields', labels: 'labels', assignees: 'assignees', milestone: 'milestone', parent: 'parent', order: 'order', view: 'views' }

// The issue a change is to, or null for a change to the project's views.
export const issueOf = (change: PlanChange): number | null => (change.kind === 'view' ? null : change.number)

// The name of the view a change is to: the view's own, or the new one's.
const viewNameOf = (change: ViewChange): string => change.view?.name ?? change.to?.name ?? ''

// What a change touches, so the same thing changed twice for one issue, or one view changed twice, is caught.
const slotOf = (change: PlanChange): string =>
  change.kind === 'view'
    ? change.view
      ? `view ${change.view.number}`
      : `new view ${viewNameOf(change).toLowerCase()}`
    : `${change.number} ${change.kind}${change.kind === 'field' ? ` ${change.field.toLowerCase()}` : ''}`

// One entry of the tool's `views` list as a change, or null with its problems added. An entry without `view` creates
// one; with `view`, named by number or by name, it changes that view, or deletes it with `delete: true`. Filters are
// checked with the tabs' own parser: a term the board can't apply is allowed, and kept to say so on the row.
const viewChangeOf = (entry: unknown, index: number, context: PlanContext, problems: string[]): ViewChange | null => {
  const one = (entry ?? {}) as Record<string, unknown>
  const { project } = context
  const named = typeof one.view === 'number' || typeof one.view === 'string' ? one.view : undefined
  const name = text(one.name)
  const at = named !== undefined ? `View ${named}` : `New view ${name ?? `(entry ${index + 1})`}`
  const before = problems.length
  if (!project) {
    problems.push(`${at}: the board reads no project, so it can't change its views.`)
    return null
  }
  if (!text(one.reason)) problems.push(`${at} has no reason.`)
  const unknown = Object.keys(one).filter(key => !VIEW_KEYS.has(key))
  if (unknown.length > 0) problems.push(`${at}: a view entry can't hold ${unknown.join(', ')}.`)
  const written = text(one.layout)?.toLowerCase()
  const layout = LAYOUTS.find(known => known === written)
  if (written !== undefined && !layout) problems.push(`${at}: a layout is table, board or roadmap, not ${written}.`)
  if (one.filter !== undefined && typeof one.filter !== 'string') problems.push(`${at}: give its filter as text.`)
  const filter = typeof one.filter === 'string' ? one.filter.trim() : undefined
  let view: ProjectView | null = null
  if (named !== undefined) {
    const views = project.views
    const found = views?.filter(known => (typeof named === 'number' ? known.number === named : known.name.toLowerCase() === named.trim().toLowerCase())) ?? []
    if (!views) problems.push(`${at}: the board hasn't read ${project.title}'s views; refresh it and try again.`)
    else if (found.length > 1) problems.push(`${at}: ${project.title} has ${found.length} views called ${named}; name it by number.`)
    else if (!found[0]) problems.push(`${at}: ${project.title} has no such view${views.length > 0 ? `; it has ${views.map(known => `${known.name} (${known.number})`).join(', ')}` : ''}.`)
    else view = found[0]
  }
  if (one.delete === true) {
    if (named === undefined) problems.push(`${at}: give view, the view to delete.`)
    else if (name !== undefined || written !== undefined || filter !== undefined) problems.push(`${at}: a view that's deleted takes no name, layout or filter.`)
    return problems.length > before || !view ? null : { kind: 'view', view, to: null, partial: [] }
  }
  if (problems.length > before) return null
  let to: ViewShape
  if (!view) {
    if (!name) {
      problems.push(`${at} has no name.`)
      return null
    }
    to = { name, layout: layout ?? 'table', filter: filter ?? '' }
  } else {
    to = { name: name ?? view.name, layout: layout ?? view.layout, filter: filter ?? view.filter }
    if (to.name === view.name && to.layout === view.layout && to.filter === view.filter) {
      problems.push(`${at} changes nothing.`)
      return null
    }
  }
  // Only a filter the plan sets is checked; one the view keeps shows on its tab as it did.
  const partial = filter ? viewMatchOf(filter, project).unknown : []
  return { kind: 'view', view, to, partial }
}

// The changes project_plan's input asks for, checked against the board as a whole: every problem is listed at once, and
// a plan with any problem is refused. Each entry may change several things on its issue; each becomes a row of its own,
// with the entry's reason. Rows are grouped by issue, in the order the issues first come, and apply in that order.
export const planOf = (input: unknown, context: PlanContext): Planned => {
  const raw = (input ?? {}) as { issues?: unknown; views?: unknown }
  const entries = Array.isArray(raw.issues) ? raw.issues : []
  const viewEntries = Array.isArray(raw.views) ? raw.views : []
  if (entries.length === 0 && viewEntries.length === 0) return { problems: ['Give issues or views: lists of changes, each with a reason.'] }
  const problems: string[] = []
  const changes: { change: PlanChange; reason: string }[] = []
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
  const views: { change: PlanChange; reason: string }[] = []
  viewEntries.forEach((entry, index) => {
    const change = viewChangeOf(entry, index, context, problems)
    if (change) views.push({ change, reason: text((entry as { reason?: unknown }).reason) ?? '' })
  })
  changes.push(...views)
  const seen = new Set<string>()
  for (const { change } of changes) {
    const slot = slotOf(change)
    if (seen.has(slot))
      problems.push(change.kind === 'view' ? `View ${viewNameOf(change)} is in the plan twice.` : `#${change.number}'s ${change.kind === 'field' ? change.field : KIND_NAMES[change.kind]} is in the plan twice.`)
    seen.add(slot)
  }
  if (changes.length > PLAN_LIMIT) problems.push(`A plan holds at most ${PLAN_LIMIT} changes; this one has ${changes.length}. Split it.`)
  if (context.refusal && changes.some(({ change }) => touchesProject(change))) problems.unshift(context.refusal)
  if (problems.length > 0) return { problems: [...new Set(problems)] }
  // The issues first, grouped, then the views in the order the plan gives them.
  const order = [...new Set(changes.flatMap(({ change }) => (change.kind === 'view' ? [] : [change.number])))]
  return { changes: [...order.flatMap(number => changes.filter(({ change }) => issueOf(change) === number)), ...views] }
}

// Whether a change writes to the project rather than to the issue.
export const touchesProject = (change: PlanChange): boolean =>
  change.kind === 'status' || change.kind === 'priority' || change.kind === 'field' || change.kind === 'order' || change.kind === 'view'

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

// What a view change does, in a few words: `new table view Bugs · label:bug`, `view Bugs: renamed Triage, filter
// cleared`, `delete view Bugs · label:bug`. A delete names the filter, or says it had none, so the person sees what goes.
const viewText = (change: ViewChange): string => {
  const { view, to } = change
  if (!to) return `delete view ${view?.name ?? ''} · ${view?.filter ? view.filter : 'no filter'}`
  if (!view) return `new ${to.layout} view ${to.name}${to.filter ? ` · ${to.filter}` : ''}`
  const parts = [
    ...(to.name !== view.name ? [`renamed ${to.name}`] : []),
    ...(to.layout !== view.layout ? [`${to.layout} layout`] : []),
    ...(to.filter !== view.filter ? [to.filter ? `filter ${to.filter}` : 'filter cleared'] : []),
  ]
  return `view ${view.name}: ${parts.join(', ')}`
}

// The note under a view's row when its filter holds terms the board can't apply. Those terms are left out of the tab's
// filter, so the tab shows every issue the rest keeps.
export const viewNoteOf = (change: PlanChange): string | null =>
  change.kind === 'view' && change.partial.length > 0
    ? `The board can't apply ${change.partial.join(' ')}, so its tab in /issues leaves ${change.partial.length === 1 ? 'that term' : 'those terms'} out and shows more than GitHub does.`
    : null

// What an applied view change answers.
export const viewDoneText = (change: ViewChange): string => {
  const partial = change.partial.length > 0 ? ` Its tab leaves out ${change.partial.join(' ')}, which the board can't apply.` : ''
  if (!change.to) return `Deleted the view ${viewNameOf(change)}.`
  if (!change.view) return `Created the ${change.to.layout} view ${change.to.name}${change.to.filter ? ` with the filter ${change.to.filter}` : ''}.${partial}`
  return `Changed the ${viewText(change)}.${partial}`
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
    case 'view':
      return viewText(change)
  }
}

// A change with what it is to, for lists outside the card: `#340 Status → Ready`, `new table view Bugs`.
export const rowText = (change: PlanChange): string => (change.kind === 'view' ? changeText(change) : `#${change.number} ${changeText(change)}`)

// The plan's rows, each ticked, with an id that stays the row's own through an Apply.
export const rowsOf = (changes: { change: PlanChange; reason: string }[]): PlanRow[] =>
  changes.map(({ change, reason }, index) => ({ id: `${issueOf(change) ?? 'view'}-${index + 1}`, change, reason, picked: true, failed: null }))

// How many changes to how many issues and views: `5 changes to 3 issues`, `3 changes to 2 issues and 1 view`.
export const sizeText = (changes: readonly PlanChange[]): string => {
  const issues = new Set(changes.flatMap(change => (change.kind === 'view' ? [] : [change.number]))).size
  const views = changes.filter(change => change.kind === 'view').length
  const parts = [...(issues > 0 ? [`${issues} ${issues === 1 ? 'issue' : 'issues'}`] : []), ...(views > 0 ? [`${views} ${views === 1 ? 'view' : 'views'}`] : [])]
  return `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} to ${parts.join(' and ')}`
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
  return [head, ...done, ...failed.map(({ row, message }) => `Failed: ${rowText(row.change)}: ${message}`)].join('\n')
}
