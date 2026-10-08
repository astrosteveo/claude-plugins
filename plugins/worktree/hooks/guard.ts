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

// Whether this edit could be stopped, before anything is asked of git: an
// edit by the main loop. A subagent's edits are its parent's business.
export const mayStop = (agentId: string | undefined, tool: string): boolean => agentId === undefined && EDIT_TOOLS.has(tool)

// Whether the session sits in the main checkout, on its default branch.
const isOnDefault = (checkout: Checkout): boolean => !checkout.isLinked && isDefault(checkout)

// The reason the edit is stopped, which Claude reads; null to let it through.
export const reasonFor = (checkout: Checkout, path: string): string | null => {
  if (!isOnDefault(checkout) || !isInside(path, checkout.top)) return null
  return `This session is on ${checkout.branch}, the default branch of ${checkout.top}, and the person keeps every edit off it. Call EnterWorktree with a short name for this task, then make this edit again inside the worktree, with its paths. Every edit on this branch is stopped until you move.`
}

// The note a prompt carries while the session sits on the default branch, so
// Claude moves before it writes an edit that would be stopped; null when no
// note is due.
export const noteFor = (checkout: Checkout): string | null => {
  if (!isOnDefault(checkout)) return null
  return `This session is on ${checkout.branch}, the default branch of ${checkout.top}, and the person keeps every edit off it. Before your first edit to a file in this repository, call EnterWorktree with a short name for the task, then make your edits inside the worktree, with its paths. A prompt that needs no edits needs no worktree.`
}

// What a stopped edit's row says in place of the refusal, which reads as an
// error though nothing went wrong.
export const STOPPED_LABEL = 'stopped to move into a worktree first'

// The stopped edits whose rows draw as notes: the newest ones, so a long
// session doesn't grow the list without end.
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
