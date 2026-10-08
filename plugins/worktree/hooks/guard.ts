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

// Whether this edit should be stopped, before anything is asked of git: the
// main loop's first edit this session, with the guard on.
export const mayStop = (mode: Mode, asked: boolean, agentId: string | undefined, tool: string): boolean =>
  mode !== 'never' && !asked && agentId === undefined && EDIT_TOOLS.has(tool)

// The reason the edit is stopped, which Claude reads; null to let it through.
export const reasonFor = (mode: Mode, checkout: Checkout, path: string): string | null => {
  if (checkout.isLinked || !isDefault(checkout) || !isInside(path, checkout.top)) return null
  const where = `This session is on ${checkout.branch}, the default branch of ${checkout.top}.`
  if (mode === 'always') {
    return `${where} The person's worktree setting is "always": call EnterWorktree with a short name for this task, then make this edit again inside the worktree, with its paths. This edit is the only one stopped this session.`
  }
  return `${where} Before the first edit, ask the person with AskUserQuestion whether to do this work in a git worktree instead. If they choose the worktree, call EnterWorktree with a short name for the task and make the edit inside it, with its paths. If they choose to stay, make the same edit again here. This edit is the only one stopped this session.`
}

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
