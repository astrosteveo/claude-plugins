// The gh call that posts a comment on an issue, over REST, which spends nothing of the GraphQL limit. The body goes on
// stdin as JSON, so any text arrives as written.
export const commentCommand = (repo: string, number: number, body: string): { argv: string[]; stdin: string } => ({
  argv: ['api', '-X', 'POST', `repos/${repo}/issues/${number}/comments`, '--input', '-'],
  stdin: JSON.stringify({ body }),
})

// Words that say little about what an issue is, left out when titles are compared.
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'so', 'the', 'to', 'when', 'with'])

// A title's words for comparing: lower case, without punctuation or small words, and a plural's s dropped.
export const titleWords = (title: string): Set<string> =>
  new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(word => word !== '' && !SMALL_WORDS.has(word))
      .map(word => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)),
  )

// How alike two titles are, from 0 to 1: the words they share, against the words of both.
export const titleLikeness = (a: string, b: string): number => {
  const one = titleWords(a)
  const two = titleWords(b)
  if (one.size === 0 || two.size === 0) return 0
  const shared = [...one].filter(word => two.has(word)).length
  return (2 * shared) / (one.size + two.size)
}

// How alike a title must be to another for a capture to count as the same work.
export const SAME_WORK = 0.7

// The issue among `candidates` most like `title`, when it is alike enough to be the same work; null otherwise.
export const sameWorkOf = <T extends { title: string }>(title: string, candidates: T[]): T | null => {
  let best: T | null = null
  let score = SAME_WORK
  for (const one of candidates) {
    const like = titleLikeness(title, one.title)
    if (like >= score) {
      best = one
      score = like
    }
  }
  return best
}

// A change to an issue, from its card or from Claude's issue_update tool. `parent` and `milestone` set as null remove
// them; `assign` and `unassign` take logins, or `@me` for the signed-in user.
export type IssueChanges = {
  status?: string
  priority?: string
  addLabels?: string[]
  removeLabels?: string[]
  assign?: string[]
  unassign?: string[]
  parent?: number | null
  milestone?: string | null
  comment?: string
  close?: 'completed' | 'not planned'
  reopen?: boolean
  // Blocked-by links to make and to take away, by the blocking issue's number.
  addBlockedBy?: number[]
  removeBlockedBy?: number[]
  // A new title; a whole new body; boxes to add to the acceptance list; boxes to reword, by number.
  title?: string
  body?: string
  addBoxes?: string[]
  rewordBoxes?: { box: number; text: string }[]
  // Close it as a duplicate of this issue, which GitHub then links.
  duplicateOf?: number
  // Its issue type, by name; null takes it off.
  type?: string | null
  // A place among its epic's sub-issues: just before or just after a sibling, by number.
  moveBefore?: number
  moveAfter?: number
  // A place in the project's own order: straight after this issue, by number, or at the top for 0.
  projectAfter?: number
  // Pinned to the top of the repo's issues, or not; its conversation locked, with GitHub's reason or none, or unlocked;
  // and the repo it moves to, `owner/name`, the same owner's.
  pin?: boolean
  lock?: boolean | 'off_topic' | 'resolved' | 'spam' | 'too_heated'
  transferTo?: string
  // Moves it even where GitHub won't move it back, from a public repo to a private one.
  confirmTransfer?: boolean
  // The project's other fields to set, by name; null clears one.
  fields?: Record<string, string | number | null>
}

const listed = (values: string[] | undefined): string => (values ?? []).filter(Boolean).join(',')

// The gh commands a change takes, in order: the edit, then the comment, then the close or reopen, so a comment made
// with a close lands before it. Status and Priority are the project's, set apart from these. `repo` is where the
// comment is posted.
export const commandsOf = (number: number, changes: IssueChanges, repo = ''): { argv: string[]; stdin?: string }[] => {
  const id = String(number)
  const edit = [
    ...(listed(changes.addLabels) ? ['--add-label', listed(changes.addLabels)] : []),
    ...(listed(changes.removeLabels) ? ['--remove-label', listed(changes.removeLabels)] : []),
    ...(listed(changes.assign) ? ['--add-assignee', listed(changes.assign)] : []),
    ...(listed(changes.unassign) ? ['--remove-assignee', listed(changes.unassign)] : []),
    ...(changes.parent === null ? ['--remove-parent'] : changes.parent !== undefined ? ['--parent', String(changes.parent)] : []),
    ...(changes.milestone === null ? ['--remove-milestone'] : changes.milestone !== undefined ? ['--milestone', changes.milestone] : []),
  ]
  return [
    ...(edit.length > 0 ? [{ argv: ['issue', 'edit', id, ...edit] }] : []),
    ...(changes.comment?.trim() ? [commentCommand(repo, number, changes.comment.trim())] : []),
    ...(changes.close ? [{ argv: ['issue', 'close', id, '--reason', changes.close] }] : []),
    ...(changes.reopen && !changes.close ? [{ argv: ['issue', 'reopen', id] }] : []),
    ...(changes.pin === true ? [{ argv: ['issue', 'pin', id] }] : changes.pin === false ? [{ argv: ['issue', 'unpin', id] }] : []),
    ...(changes.lock === false
      ? [{ argv: ['issue', 'unlock', id] }]
      : changes.lock
        ? [{ argv: ['issue', 'lock', id, ...(typeof changes.lock === 'string' ? ['--reason', changes.lock] : [])] }]
        : []),
    // Last: once moved, the issue is no longer this repo's.
    ...(changes.transferTo ? [{ argv: ['issue', 'transfer', id, changes.transferTo] }] : []),
  ]
}

// What a change did, in a sentence each, for a toast and for Claude.
export const changesText = (number: number, changes: IssueChanges): string => {
  const said = [
    changes.status ? `moved to ${changes.status}` : '',
    changes.priority ? `set to ${changes.priority}` : '',
    listed(changes.addLabels) ? `labelled ${listed(changes.addLabels).replace(/,/g, ', ')}` : '',
    listed(changes.removeLabels) ? `unlabelled ${listed(changes.removeLabels).replace(/,/g, ', ')}` : '',
    listed(changes.assign) ? `assigned ${listed(changes.assign).replace(/,/g, ', ')}` : '',
    listed(changes.unassign) ? `unassigned ${listed(changes.unassign).replace(/,/g, ', ')}` : '',
    changes.parent === null ? 'taken out of its epic' : changes.parent !== undefined ? `put under #${changes.parent}` : '',
    changes.title ? `retitled “${changes.title}”` : '',
    changes.body !== undefined ? 'its body rewritten' : '',
    changes.rewordBoxes?.length ? `${changes.rewordBoxes.length === 1 ? 'box' : 'boxes'} ${changes.rewordBoxes.map(one => one.box).join(', ')} reworded` : '',
    changes.addBoxes?.length ? `${changes.addBoxes.length} ${changes.addBoxes.length === 1 ? 'box' : 'boxes'} added` : '',
    changes.addBlockedBy?.length ? `blocked by ${changes.addBlockedBy.map(one => `#${one}`).join(', ')}` : '',
    changes.removeBlockedBy?.length ? `no longer blocked by ${changes.removeBlockedBy.map(one => `#${one}`).join(', ')}` : '',
    changes.milestone === null ? 'taken off its milestone' : changes.milestone !== undefined ? `put on the milestone ${changes.milestone}` : '',
    changes.comment?.trim() ? 'commented on' : '',
    changes.close ? `closed as ${changes.close}` : '',
    changes.duplicateOf ? `closed as a duplicate of #${changes.duplicateOf}` : '',
    changes.type === null ? 'its type taken off' : changes.type ? `typed ${changes.type}` : '',
    changes.moveBefore ? `moved before #${changes.moveBefore}` : changes.moveAfter ? `moved after #${changes.moveAfter}` : '',
    changes.projectAfter === 0 ? "moved to the top of the project's order" : changes.projectAfter ? `moved after #${changes.projectAfter} in the project's order` : '',
    changes.pin === true ? 'pinned' : changes.pin === false ? 'unpinned' : '',
    changes.lock === false ? 'unlocked' : changes.lock ? `locked${typeof changes.lock === 'string' ? ` as ${changes.lock.replace('_', ' ')}` : ''}` : '',
    changes.transferTo ? `moved to ${changes.transferTo}` : '',
    ...Object.entries(changes.fields ?? {}).map(([name, value]) => (value === null ? `${name} cleared` : `${name} set to ${value}`)),
    changes.reopen && !changes.close ? 'reopened' : '',
  ].filter(Boolean)
  return said.length > 0 ? `#${number} ${said.join(', ')}.` : `Nothing to change on #${number}.`
}

// Which of the Status and Priority a change asks for the issue already has, by its project item as read for an issue
// off the board: those are said and not written. `set` is what is left to write, in order.
export type Settled = { already: string[]; skipped: ('status' | 'priority')[]; set: ['status' | 'priority', string][] }
export const settledOf = (number: number, changes: IssueChanges, current: Record<string, string>): Settled => {
  const settled: Settled = { already: [], skipped: [], set: [] }
  for (const field of ['status', 'priority'] as const) {
    const value = changes[field]
    if (!value) continue
    const name = field === 'status' ? 'Status' : 'Priority'
    if (current[name] && current[name].toLowerCase() === value.toLowerCase()) {
      settled.already.push(`#${number}'s ${name} is already ${current[name]}.`)
      settled.skipped.push(field)
      continue
    }
    settled.set.push([field, value])
  }
  return settled
}

// The repo an issue moves to, as `owner/name`: a bare name is the same owner's, and another owner's is refused, so an
// issue doesn't leave the owner's hands by a slip.
export const sameOwner = (repo: string, target: string): string => {
  const owner = repo.split('/')[0] ?? ''
  const [first = '', second] = target.split('/')
  const full = second === undefined ? `${owner}/${first}` : target
  if (full.split('/')[0]?.toLowerCase() !== owner.toLowerCase()) throw new Error(`an issue moves only to another of ${owner}'s repos, not to ${target}`)
  if (full.toLowerCase() === repo.toLowerCase()) throw new Error(`the issue is in ${repo} already`)
  return full
}

// Why a move to another repo waits: GitHub moves an issue from a public repo to a private one, but not back, so that
// takes a second, confirmed call. Null when it may go.
export const transferRefusal = (number: number, repo: string, to: string, privacy: { from: boolean; to: boolean }, confirmed: boolean): string | null =>
  !privacy.from && privacy.to && !confirmed
    ? `${to} is private and ${repo} is public, so GitHub won't move #${number} back once it's there. Call again with confirmTransfer: true to move it anyway`
    : null

// What a change did, for a toast and for Claude: what was already so, what changed, and the labels made for it.
export const changedText = (number: number, changes: IssueChanges, settled: Pick<Settled, 'already' | 'skipped'>, made: string[]): string => {
  const left = { ...changes }
  for (const field of settled.skipped) delete left[field]
  const done = changesText(number, left)
  const said = [...settled.already, ...(settled.already.length > 0 && done.startsWith('Nothing to change') ? [] : [done])].join(' ')
  return `${said}${made.length > 0 ? ` Created the ${made.length === 1 ? 'label' : 'labels'} ${made.join(', ')}, new to the repo.` : ''}`
}

// What the board did on its own in one read, in a line for a toast: the issues it moved to a Status and why, many at
// once in one line. `why` reads for one issue; `whyMany` for several.
export const movedText = (to: string, moved: number[], why: string, whyMany: string): string =>
  moved.length === 1 ? `Moved #${moved[0]} to ${to}: ${why}.` : `Moved ${moved.length} issues to ${to} (${moved.map(one => `#${one}`).join(', ')}): ${whyMany}.`

// And the ones it couldn't move, with the first reason and where to look.
export const unmovedText = (to: string, failed: { number: number; message: string }[]): string => {
  const [first] = failed
  const which = failed.length === 1 ? `#${first?.number}` : `${failed.length} issues (${failed.map(one => `#${one.number}`).join(', ')})`
  return `Couldn't move ${which} to ${to}: ${first?.message ?? 'GitHub refused'}. /issues check may say why.`
}

// What the board says when it has no read of GitHub to work from yet. A thrown error carries the clause, which the
// caller puts after its own "Couldn't ...: "; a refusal that stands alone is the sentence.
export const NOT_READ = "the issue board hasn't read GitHub yet; refresh it and try again"
export const NOT_READ_SENTENCE = `T${NOT_READ.slice(1)}.`

// The issue number typed into a field, with or without its #; null for anything that isn't a whole number above 0.
export const issueNumberIn = (text: string): number | null => {
  const number = Number(text.replace(/^#/, '').trim())
  return Number.isInteger(number) && number > 0 ? number : null
}

// Issue numbers from a tool's input: whole and positive, each once.
export const numbersOf = (value: unknown): number[] =>
  Array.isArray(value) ? [...new Set(value.filter((one): one is number => typeof one === 'number' && Number.isInteger(one) && one > 0))] : []

// A tool input's text, trimmed; undefined when it is missing, not text, or blank.
export const textOf = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

// A tool input's list of names, each trimmed, without the blank ones and anything that isn't text.
export const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map(one => one.trim()) : []

// An issue for Claude's issue_create tool to file: its title and body, and what it starts with.
export type NewIssue = {
  title: string
  body: string
  labels?: string[]
  assign?: string[]
  milestone?: string
  parent?: number
  status?: string
  priority?: string
  type?: string
  // The issues it is blocked by, by number.
  blockedBy?: number[]
  // Sub-issues to file under it, in order: an epic and its parts in one call. They have none of their own.
  subIssues?: NewIssue[]
}

// The issue_create tool's input as a new issue, or why it can't be one. `nested`: a sub-issue, which takes no
// sub-issues of its own.
export const newIssueOf = (input: unknown, nested = false): NewIssue | string => {
  const raw = (input ?? {}) as Record<string, unknown>
  const title = textOf(raw.title)
  if (!title) return 'Give the issue a title.'
  const made: NewIssue = { title, body: typeof raw.body === 'string' ? raw.body : '' }
  const labels = stringsOf(raw.labels)
  const assign = stringsOf(raw.assign)
  if (labels.length > 0) made.labels = labels
  if (assign.length > 0) made.assign = assign
  const milestone = textOf(raw.milestone)
  if (milestone) made.milestone = milestone
  if (typeof raw.parent === 'number' && Number.isInteger(raw.parent) && raw.parent > 0) made.parent = raw.parent
  const status = textOf(raw.status)
  const priority = textOf(raw.priority)
  if (status) made.status = status
  if (priority) made.priority = priority
  const type = textOf(raw.type)
  if (type) made.type = type
  const blockers = numbersOf(raw.blockedBy)
  if (blockers.length > 0) made.blockedBy = blockers
  if (Array.isArray(raw.subIssues) && raw.subIssues.length > 0) {
    if (nested) return 'A sub-issue takes no sub-issues of its own.'
    const parts = raw.subIssues.map(part => newIssueOf(part, true))
    const wrong = parts.findIndex(part => typeof part === 'string')
    if (wrong >= 0) return `Sub-issue ${wrong + 1}: ${parts[wrong]}`
    made.subIssues = parts as NewIssue[]
  }
  return made
}

// The capture tool's input as an issue to capture, or why it can't be one.
export const captureOf = (input: unknown): NewIssue | string => {
  const raw = (input ?? {}) as { title?: unknown; body?: unknown; labels?: unknown; epic?: unknown }
  const title = textOf(raw.title)
  if (!title) return 'Give the capture a title.'
  const body = textOf(raw.body)
  if (!body) return 'Say in body what the work is and why it came up.'
  const labels = stringsOf(raw.labels)
  const epic = typeof raw.epic === 'number' && Number.isInteger(raw.epic) && raw.epic > 0 ? raw.epic : undefined
  return { title, body, ...(labels.length > 0 ? { labels } : {}), ...(epic ? { parent: epic } : {}) }
}

// The issue_update tool's input as a change; null without an issue number. A parent of 0 and an empty milestone remove
// them, as the tool says.
export const changesOf = (input: unknown): (IssueChanges & { number: number }) | null => {
  const raw = (input ?? {}) as Record<string, unknown>
  if (typeof raw.number !== 'number' || !Number.isInteger(raw.number) || raw.number < 1) return null
  const changes: IssueChanges & { number: number } = { number: raw.number }
  const status = textOf(raw.status)
  const priority = textOf(raw.priority)
  if (status) changes.status = status
  if (priority) changes.priority = priority
  for (const key of ['addLabels', 'removeLabels', 'assign', 'unassign'] as const) {
    const list = stringsOf(raw[key])
    if (list.length) changes[key] = list
  }
  if (typeof raw.parent === 'number') changes.parent = raw.parent > 0 ? raw.parent : null
  if (typeof raw.milestone === 'string') changes.milestone = raw.milestone.trim() || null
  const comment = textOf(raw.comment)
  if (comment) changes.comment = comment
  if (raw.close === 'completed' || raw.close === 'not planned') changes.close = raw.close
  if (raw.reopen === true) changes.reopen = true
  const title = textOf(raw.title)
  if (title) changes.title = title
  if (typeof raw.body === 'string') changes.body = raw.body
  const boxes = stringsOf(raw.addBoxes)
  if (boxes.length) changes.addBoxes = boxes
  const rewords = Array.isArray(raw.rewordBoxes)
    ? raw.rewordBoxes.flatMap(one => {
        const edit = one as { box?: unknown; text?: unknown }
        return typeof edit.box === 'number' && Number.isInteger(edit.box) && typeof edit.text === 'string' && edit.text.trim() ? [{ box: edit.box, text: edit.text.trim() }] : []
      })
    : []
  if (rewords.length > 0) changes.rewordBoxes = rewords
  if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) {
    const given = Object.entries(raw.fields as Record<string, unknown>).flatMap(([name, value]) =>
      name.trim() && (value === null || typeof value === 'string' || typeof value === 'number') ? [[name.trim(), value as string | number | null]] : [],
    )
    if (given.length > 0) changes.fields = Object.fromEntries(given)
  }
  if (typeof raw.pin === 'boolean') changes.pin = raw.pin
  // A tool's caller may send lock's true or false as a string, since the field also takes GitHub's reasons.
  const lock = raw.lock === 'true' ? true : raw.lock === 'false' ? false : raw.lock
  if (lock === true || lock === false) changes.lock = lock
  else if (lock === 'off_topic' || lock === 'resolved' || lock === 'spam' || lock === 'too_heated') changes.lock = lock
  const target = textOf(raw.transferTo)
  if (target) changes.transferTo = target
  if (raw.confirmTransfer === true) changes.confirmTransfer = true
  if (typeof raw.moveBefore === 'number' && Number.isInteger(raw.moveBefore)) changes.moveBefore = raw.moveBefore
  else if (typeof raw.moveAfter === 'number' && Number.isInteger(raw.moveAfter)) changes.moveAfter = raw.moveAfter
  if (typeof raw.projectAfter === 'number' && Number.isInteger(raw.projectAfter) && raw.projectAfter >= 0) changes.projectAfter = raw.projectAfter
  if (raw.type === null) changes.type = null
  else if (textOf(raw.type)) changes.type = textOf(raw.type)
  if (typeof raw.duplicateOf === 'number' && Number.isInteger(raw.duplicateOf) && raw.duplicateOf > 0 && raw.duplicateOf !== raw.number) changes.duplicateOf = raw.duplicateOf
  const blocking = numbersOf(raw.addBlockedBy)
  const unblocking = numbersOf(raw.removeBlockedBy)
  if (blocking.length > 0) changes.addBlockedBy = blocking
  if (unblocking.length > 0) changes.removeBlockedBy = unblocking
  return changes
}

// What filing an issue did, for Claude: what it was filed with, and each later step that failed, by what it was for.
export const filedText = (number: number, did: string[], failed: string[]): string =>
  [
    `Filed #${number}${did.length > 0 ? `: ${did.join(', ')}` : ''}.`,
    ...(failed.length > 0 ? [`The issue exists, but the board couldn't ${failed.join('; nor ')}.`] : []),
  ].join(' ')

// Whether a change only moves an issue's Status, which the issue Claude is on may do without asking.
export const statusOnly = (changes: IssueChanges): boolean =>
  Boolean(changes.status) &&
  commandsOf(0, changes).length === 0 &&
  !changes.priority &&
  !changes.addBlockedBy?.length &&
  !changes.removeBlockedBy?.length &&
  !changes.title &&
  changes.body === undefined &&
  !changes.addBoxes?.length &&
  !changes.rewordBoxes?.length &&
  !changes.duplicateOf &&
  changes.type === undefined &&
  !changes.moveBefore &&
  !changes.moveAfter &&
  changes.projectAfter === undefined &&
  Object.keys(changes.fields ?? {}).length === 0

// A change split by where it lands: the project's part, by name for an answer to say, and the repo's part. Status,
// Priority, the project's other fields and its order live in the project; everything else is the repo's. A project the
// board may not write to then skips the first part, and the second still goes through.
export const projectPartOf = (changes: IssueChanges): { project: string[]; repo: IssueChanges } => {
  const { status, priority, fields, projectAfter, ...repo } = changes
  const project = [
    ...(status ? ['Status'] : []),
    ...(priority ? ['Priority'] : []),
    ...Object.keys(fields ?? {}),
    ...(projectAfter !== undefined ? ['place in the project'] : []),
  ]
  return { project, repo }
}

// Names as a sentence lists them: "Status, Priority and Estimate".
export const namesText = (names: readonly string[]): string => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

// Whether the repo's part of a change has anything in it. confirmTransfer only qualifies a transfer, so alone it is
// nothing.
export const repoChangeOf = (repo: IssueChanges): boolean => Object.entries(repo).some(([key, value]) => key !== 'confirmTransfer' && value !== undefined)
