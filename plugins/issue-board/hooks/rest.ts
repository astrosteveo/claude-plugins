import type { Comment, Found, Issue, Milestone, ProjectField } from '../types'
import { agoText } from './layout'

// An issue's comments as GitHub's REST answers them, oldest first.
export const restCommentsOf = (items: unknown[]): Comment[] =>
  (items as { user?: { login?: string } | null; body?: string | null; created_at?: string }[]).map(one => ({
    author: one.user?.login ?? 'ghost',
    body: (one.body ?? '').trim(),
    at: one.created_at ?? '',
  }))

// Issues as GitHub's REST answers them, a list or search results; pull requests, which the same endpoints mix in, left out.
export const foundOf = (items: unknown[]): Found[] =>
  (items as {
    number: number
    title: string
    html_url?: string
    state: string
    state_reason?: string | null
    closed_at?: string | null
    labels?: ({ name?: string } | string)[]
    pull_request?: unknown
  }[])
    .filter(raw => !raw.pull_request)
    .map(raw => ({
      number: raw.number,
      title: raw.title,
      url: raw.html_url ?? '',
      state: raw.state === 'closed' ? 'closed' : 'open',
      reason: raw.state_reason ?? null,
      closedAt: raw.closed_at ?? null,
      labels: (raw.labels ?? []).map(label => (typeof label === 'string' ? label : (label.name ?? ''))).filter(Boolean),
    }))

// How an issue stands, in a few words: open, or closed, how and when.
export const standing = (found: Found, now: number): string => {
  if (found.state === 'open') return 'open'
  const when = found.closedAt ? agoText(found.closedAt, now) : ''
  return `closed${found.reason ? ` as ${found.reason.replace('_', ' ')}` : ''}${when ? ` ${when}` : ''}`
}

// One line a found issue, as the issues tool lists it.
export const foundLine = (found: Found, now: number): string =>
  `#${found.number} ${found.title} · ${standing(found, now)}${found.labels.length > 0 ? ` · ${found.labels.join(', ')}` : ''}`

// GitHub's search terms for the repo's issues: a state, words, and a label, assignee or milestone.
export const searchTerms = (repo: string, ask: { state?: string; search?: string; label?: string; assignee?: string; milestone?: string }): string => {
  const quoted = (value: string) => (/\s/.test(value) ? `"${value}"` : value)
  return [
    `repo:${repo}`,
    'is:issue',
    ask.state === 'open' || ask.state === 'closed' ? `state:${ask.state}` : '',
    ask.label ? `label:${quoted(ask.label)}` : '',
    ask.assignee ? `assignee:${ask.assignee}` : '',
    ask.milestone ? `milestone:${quoted(ask.milestone)}` : '',
    ask.search?.trim() ?? '',
  ]
    .filter(Boolean)
    .join(' ')
}

// Where GitHub's REST API keeps a project, from the project's page: `users/<login>/projectsV2/<n>` or the `orgs/` one.
export const projectPathOf = (url: string): string | null => {
  const found = /github\.com\/(users|orgs)\/([^/]+)\/projects\/(\d+)/.exec(url)
  return found ? `${found[1]}/${found[2]}/projectsV2/${found[3]}` : null
}

// The project's issues at a Status, open or closed, from its items as REST answers them with the Status field; a closed
// one only when it closed on or after `since`, a date.
export const itemsAt = (items: unknown[], status: string, since?: string): Found[] =>
  (items as { content_type?: string; content?: Record<string, unknown> | null; fields?: { name?: string; value?: { name?: { raw?: string } | string } | null }[] }[])
    .filter(item => item.content_type === 'Issue' && item.content)
    .filter(item => {
      const value = item.fields?.find(field => field.name === 'Status')?.value?.name
      const name = typeof value === 'string' ? value : value?.raw
      return name?.toLowerCase() === status.toLowerCase()
    })
    .flatMap(item => foundOf([item.content]))
    .filter(found => !since || found.state === 'open' || (found.closedAt ?? '') >= since)

// The project's items an archive takes, as REST lists them with the Status field: one issue's, by number, or every issue
// at Done that closed before a date, `done` naming the project's Done option. Archived ones are left out.
export const toArchive = (items: unknown[], ask: { number?: number; doneBefore?: string }, done?: string): { number: number; title: string; node: string }[] =>
  (
    items as {
      node_id?: string
      archived_at?: string | null
      content_type?: string
      content?: { number?: number; title?: string; state?: string; closed_at?: string | null } | null
      fields?: { name?: string; value?: { name?: { raw?: string } | string } | null }[]
    }[]
  )
    .filter(item => item.content_type === 'Issue' && item.content && item.node_id && !item.archived_at)
    .filter(item => {
      if (ask.number !== undefined) return item.content?.number === ask.number
      const value = item.fields?.find(field => field.name === 'Status')?.value?.name
      const status = typeof value === 'string' ? value : value?.raw
      return done !== undefined && status === done && item.content?.state === 'closed' && (item.content.closed_at ?? '') < (ask.doneBefore ?? '')
    })
    .map(item => ({ number: item.content?.number ?? 0, title: item.content?.title ?? '', node: item.node_id ?? '' }))

// Milestones as GitHub's REST answers them.
export const milestonesOf = (items: unknown[]): Milestone[] =>
  (items as { number: number; title: string; due_on?: string | null; description?: string | null; open_issues?: number; closed_issues?: number }[]).map(raw => ({
    number: raw.number,
    title: raw.title,
    due: raw.due_on ? raw.due_on.slice(0, 10) : null,
    description: raw.description ?? '',
    open: raw.open_issues ?? 0,
    closed: raw.closed_issues ?? 0,
  }))

// One milestone in a line: how many of its issues are closed, and when it is due, or how long since it was.
export const milestoneLine = (milestone: Milestone, today: string): string =>
  `${milestone.title} · ${milestone.closed}/${milestone.open + milestone.closed} closed · ${milestoneDue(milestone, today).text}`

// When a milestone is due, as words, and whether it is late: past its date with issues still open. `today` is a
// YYYY-MM-DD date.
export const milestoneDue = (milestone: Milestone, today: string): { text: string; late: boolean } => {
  const late = milestone.due !== null && milestone.due < today && milestone.open > 0
  return { text: milestone.due ? (late ? `was due ${milestone.due}` : `due ${milestone.due}`) : 'no due date', late }
}

// An item's field values, by field name, from the ITEM_VALUES query: each as text, as the card and Claude read it.
export const itemValuesOf = (answer: unknown): Record<string, string> => {
  const nodes =
    (answer as { node?: { fieldValues?: { nodes?: ({ text?: string; number?: number; date?: string; title?: string; name?: string; field?: { name?: string } } | null)[] } } })?.node?.fieldValues
      ?.nodes ?? []
  return Object.fromEntries(
    nodes.flatMap(one => {
      const value = one?.text ?? (one?.number !== undefined ? String(one.number) : undefined) ?? one?.date ?? one?.title ?? one?.name
      return one?.field?.name && value !== undefined ? [[one.field.name, value]] : []
    }),
  )
}

// A value for a field, as GitHub's mutation takes it, from what Claude or the person gave; or why it doesn't fit.
export const fieldValueOf = (field: ProjectField, given: unknown): { value: Record<string, string | number> } | string => {
  const text = typeof given === 'number' ? String(given) : typeof given === 'string' ? given.trim() : ''
  if (!text) return `give ${field.name} a value, or null to clear it`
  switch (field.kind) {
    case 'text':
      return { value: { text } }
    case 'number':
      return Number.isFinite(Number(text)) ? { value: { number: Number(text) } } : `${field.name} takes a number, not ${text}`
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { value: { date: text } } : `${field.name} takes a date, YYYY-MM-DD, not ${text}`
    case 'iteration':
    case 'select': {
      const option = field.options?.find(one => one.name.toLowerCase() === text.toLowerCase())
      const names = (field.options ?? []).map(one => one.name).join(', ')
      if (!option) return `${field.name} has no ${field.kind === 'iteration' ? 'iteration' : 'option'} called ${text}${names ? `; it has ${names}` : ''}`
      return { value: field.kind === 'iteration' ? { iterationId: option.id } : { singleSelectOptionId: option.id } }
    }
  }
}

// An epic's order with one sub-issue moved just before or just after a sibling; one the order didn't list is added.
export const reordered = (order: number[], number: number, beside: number, before: boolean): number[] => {
  const rest = order.filter(one => one !== number)
  const at = rest.indexOf(beside)
  if (at < 0) return [...rest, number]
  return [...rest.slice(0, before ? at : at + 1), number, ...rest.slice(before ? at : at + 1)]
}

// A move in the project's own order: the issue's item, and the item it goes straight after, or null for the top of the
// project. GitHub only places an item after another, so before an issue is after the one above it among the issues the
// board holds in the project's order; before the first of those is the top. `beside` of null is the top too. A string
// says why it can't move.
export type ProjectMove = { item: string; after: { number: number; item: string } | null }
export const projectMoveOf = (issues: Issue[], number: number, beside: number | null, before: boolean): ProjectMove | string => {
  const issue = issues.find(one => one.number === number)
  if (!issue) return `#${number} isn't an open issue on the board`
  if (!issue.item) return `#${number} isn't in the project yet; set its Status first`
  if (beside === null) return { item: issue.item, after: null }
  if (beside === number) return `#${number} can't move beside itself`
  const ordered = issues.filter(one => one.position !== undefined && one.number !== number).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const at = ordered.findIndex(one => one.number === beside)
  if (at < 0) return `#${beside} isn't an open issue the board has in the project's order`
  const after = before ? ordered[at - 1] : ordered[at]
  return { item: issue.item, after: after?.item ? { number: after.number, item: after.item } : null }
}

// The issues with one moved in the project's order straight after another, or to the top for null, and every place
// counted again from 0, so the pane shows the move before the next read confirms it.
export const placedAfter = (issues: Issue[], number: number, after: number | null): Issue[] => {
  const ordered = issues.filter(one => one.position !== undefined && one.number !== number).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(one => one.number)
  const at = after === null ? 0 : ordered.indexOf(after) + 1
  const order = [...ordered.slice(0, at), number, ...ordered.slice(at)]
  return issues.map(one => (order.includes(one.number) ? { ...one, position: order.indexOf(one.number) } : one))
}

// The labels asked for that the repo hasn't got, by name, ignoring case, each once.
export const missingLabels = (wanted: string[], existing: { name: string }[]): string[] => {
  const have = new Set(existing.map(one => one.name.toLowerCase()))
  return [...new Map(wanted.filter(name => !have.has(name.toLowerCase())).map(name => [name.toLowerCase(), name])).values()]
}

// The color a new label gets: an `area:` label takes the color the repo's other areas have, so they read as one set.
export const labelColorFor = (name: string, existing: { name: string; color?: string }[]): string =>
  (name.startsWith('area:') ? existing.find(one => one.name.startsWith('area:') && one.color)?.color : undefined) ?? 'ededed'

// Why reading an issue over REST failed, by its number: that it doesn't exist, on GitHub's 404, or what gh said.
export const notFoundText = (message: string, repo: string, number: number): string =>
  /HTTP 404|Not Found/i.test(message) ? `#${number} doesn't exist in ${repo}` : `couldn't read #${number}: ${message}`

// An issue's or pull request's page on GitHub: the URL gh gave, or one made from the repo for a board saved without it.
export const pageOf = (repo: string, kind: 'issues' | 'pull', item: { number: number; url: string }): string =>
  item.url || `https://github.com/${repo}/${kind}/${item.number}`
