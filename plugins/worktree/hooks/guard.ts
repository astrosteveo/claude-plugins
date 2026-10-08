import type { Mode } from '../types'

// The tools that change files in the checkout.
export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

// Where a tool call writes, from its input; undefined for one that names none.
export const pathOf = (input: Record<string, unknown>): string | undefined => {
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' ? path : undefined
}

// What git says about the checkout the session is in.
export type Checkout = {
  // The checkout's top folder, absolute.
  top: string
  // The branch checked out, or undefined on a detached head.
  branch: string | undefined
  // The branch origin/HEAD points at, or undefined when unknown.
  defaultBranch: string | undefined
  // True in a linked worktree, where the git folder is not the common one.
  isLinked: boolean
}

// Without origin/HEAD, main and master are taken as the default.
const isDefault = (checkout: Checkout): boolean =>
  checkout.branch !== undefined &&
  (checkout.defaultBranch === undefined ? ['main', 'master'].includes(checkout.branch) : checkout.branch === checkout.defaultBranch)

export const isInside = (path: string, top: string): boolean => path === top || path.startsWith(top.endsWith('/') ? top : `${top}/`)

// Whether this edit should be stopped, before anything is asked of git: a
// main-loop edit with the guard on. Ask stops only the session's first, since
// the person's answer stands; always stops every one until Claude moves.
export const mayStop = (mode: Mode, asked: boolean, agentId: string | undefined, tool: string): boolean =>
  mode !== 'never' && (mode === 'always' || !asked) && agentId === undefined && EDIT_TOOLS.has(tool)

// The reason the edit is stopped, which Claude reads; null to let it through.
export const reasonFor = (mode: Mode, checkout: Checkout, path: string): string | null => {
  if (checkout.isLinked || !isDefault(checkout) || !isInside(path, checkout.top)) return null
  const where = `This session is on ${checkout.branch}, the default branch of ${checkout.top}.`
  if (mode === 'always') {
    return `${where} The person's worktree setting is "always": call EnterWorktree with a short name for this task, then make this edit again inside the worktree, with its paths. Every edit on this branch is stopped until you move.`
  }
  return `${where} Before the first edit, ask the person with AskUserQuestion whether to do this work in a git worktree instead. If they choose the worktree, call EnterWorktree with a short name for the task and make the edit inside it, with its paths. If they choose to stay, make the same edit again here. This edit is the only one stopped this session.`
}

// The note a prompt carries in always mode while the session sits on the
// default branch, so Claude moves before it writes an edit that would be
// stopped; null when no note is due.
export const noteFor = (mode: Mode, checkout: Checkout): string | null => {
  if (mode !== 'always' || checkout.isLinked || !isDefault(checkout)) return null
  return `This session is on ${checkout.branch}, the default branch of ${checkout.top}. The person's worktree setting is "always": before your first edit to a file in this repository, call EnterWorktree with a short name for the task, then make your edits inside the worktree, with its paths. A prompt that needs no edits needs no worktree.`
}

// What the stopped edit's row says in place of the refusal, which reads as an
// error though nothing went wrong.
export const stoppedLabelOf = (mode: Mode): string =>
  mode === 'always' ? 'stopped to move into a worktree first' : 'stopped once to ask about a worktree first'

// The stopped edits whose rows draw as notes: the newest ones, so a long
// session in always mode doesn't grow the list without end.
export const STOPPED_KEPT = 50
export const withStopped = (ids: readonly string[], id: string): string[] => [...ids, id].slice(-STOPPED_KEPT)

// `git rev-parse` output, one answer per line, into a Checkout. The lines are
// the top folder, the branch (`HEAD` when detached), the git folder and the
// common git folder.
export const checkoutOf = (revParse: string, originHead: string | undefined): Checkout => {
  const [top = '', branch = 'HEAD', gitDir = '', commonDir = ''] = revParse.trim().split('\n')
  const head = originHead?.trim()
  return {
    top,
    branch: branch === 'HEAD' ? undefined : branch,
    defaultBranch: head ? head.replace(/^origin\//, '') : undefined,
    isLinked: gitDir !== commonDir,
  }
}
