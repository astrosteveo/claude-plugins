// The tools that change files in the checkout.
export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

// Where a tool call writes, from its input; undefined for one that names none.
export const pathOf = (input: Record<string, unknown>): string | undefined => {
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' ? path : undefined
}

// What git says about a checkout.
export type Checkout = {
  // The checkout's top folder, absolute.
  top: string
  // The branch checked out, or undefined on a detached head.
  branch: string | undefined
  // The branch origin/HEAD points at, or undefined when unknown.
  defaultBranch: string | undefined
  // True in a linked worktree, where the git folder is not the common one.
  isLinked: boolean
  // The repository's common git folder, absolute: the same for the main
  // checkout and each of its worktrees.
  commonDir: string
}

// Without origin/HEAD, main and master are taken as the default.
const isDefault = (checkout: Checkout): boolean =>
  checkout.branch !== undefined &&
  (checkout.defaultBranch === undefined ? ['main', 'master'].includes(checkout.branch) : checkout.branch === checkout.defaultBranch)

export const isInside = (path: string, top: string): boolean => path === top || path.startsWith(top.endsWith('/') ? top : `${top}/`)

// Whether this edit could be stopped, before anything is asked of git. A
// subagent's edits count too: without a worktree of its own it writes into
// the same checkout as the main loop.
export const mayStop = (tool: string): boolean => EDIT_TOOLS.has(tool)

// Whether edits are kept out of this checkout: the main checkout, on the
// default branch or on a detached head, which is the default branch's work
// with the branch name taken off.
export const isGuarded = (checkout: Checkout): boolean => !checkout.isLinked && (checkout.branch === undefined || isDefault(checkout))

const branchOf = (checkout: Checkout): string => checkout.branch ?? 'a detached head'

// `path` made absolute against `cwd`, with `.`, `..` and repeated slashes
// taken out, so it reads the same however it was spelled. Symlinks are left
// to the resolver, which asks the file system.
export const normalize = (path: string, cwd: string): string => {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

// A shell script that prints, for the normalized path in $1, the path with
// every symlink resolved and the nearest folder of it that exists, so a new
// file's checkout can be read too. Plain POSIX sh, readlink and pwd -P.
export const RESOLVE_SCRIPT = [
  'p="$1"',
  'while [ -L "$p" ]; do t=$(readlink "$p") || exit 1; case "$t" in /*) p="$t" ;; *) p="$(dirname "$p")/$t" ;; esac; done',
  'd=$(dirname "$p"); tail=$(basename "$p")',
  'while [ ! -d "$d" ]; do tail="$(basename "$d")/$tail"; d=$(dirname "$d"); done',
  'r=$(cd -P "$d" && pwd -P) || exit 1',
  'case "$r" in /) r="" ;; esac',
  'printf "%s\\n%s\\n" "$r/$tail" "${r:-/}"',
].join('\n')

// The resolver's output: the real path and the nearest folder that exists.
export const resolvedOf = (stdout: string): { path: string; dir: string } | null => {
  const [path, dir] = stdout.split('\n')
  return path && dir ? { path, dir } : null
}

// The reason the edit is stopped, which Claude reads; null to let it through.
// `session` is the checkout the session is in, `target` the one holding the
// file (null outside any), `path` the file's real path. Only the session's own
// repository is guarded, through any of its checkouts.
export const reasonFor = (session: Checkout, target: Checkout | null, path: string, isSubagent: boolean): string | null => {
  if (target === null || target.commonDir !== session.commonDir || !isGuarded(target) || !isInside(path, target.top)) return null
  const where = `${path} is in ${target.top}, the main checkout, on ${branchOf(target)}, and the person keeps every edit off it.`
  if (isSubagent) {
    return `${where} Stop and tell the agent that started you: it moves into a worktree with EnterWorktree, or starts you with isolation "worktree", and you make the edit there.`
  }
  if (isGuarded(session)) {
    return `${where} Call EnterWorktree with a short name for this task, then make this edit again inside the worktree, with its paths. Every edit on this branch is stopped until you move.`
  }
  return `${where} The session is in ${session.top}: make the edit there, with its paths.`
}

// The reason an edit is stopped when it could not be checked: git or the
// resolver failed or ran out of time. Stopping is the safe side.
export const UNCHECKED_REASON =
  'This edit could not be checked against the default branch (git or the path lookup failed), so it is stopped. Try it again; if it keeps failing, tell the person.'

// The note a prompt carries while the session sits on the default branch, so
// Claude moves before it writes an edit that would be stopped; null when no
// note is due.
export const noteFor = (checkout: Checkout): string | null => {
  if (!isGuarded(checkout)) return null
  return `This session is on ${branchOf(checkout)}, in the main checkout of ${checkout.top}, and the person keeps every edit off it. Before your first edit to a file in this repository, call EnterWorktree with a short name for the task, then make your edits inside the worktree, with its paths. A prompt that needs no edits needs no worktree.`
}

// The main checkout's top folder, from the common git folder; undefined for a
// repository whose git folder is not a `.git` inside its checkout.
export const mainTopOf = (commonDir: string): string | undefined => (commonDir.endsWith('/.git') ? commonDir.slice(0, -'/.git'.length) : undefined)

// A shell script, run in the main checkout, that prints what the checkout
// holds: HEAD's branch and commit, and a tree of every file git would add,
// untracked ones too, written through a throwaway index. It changes no ref,
// no index and no file of the checkout's.
export const SNAPSHOT_SCRIPT = [
  'g=$(git rev-parse --absolute-git-dir) || exit 1',
  'idx="$g/worktree-guard-index.$$"',
  'trap \'rm -f "$idx"\' EXIT',
  'if [ -f "$g/index" ]; then cp "$g/index" "$idx" || exit 1; fi',
  'GIT_INDEX_FILE="$idx" git add -A >/dev/null 2>&1 || exit 1',
  'printf "%s %s %s\\n" "$(git symbolic-ref -q HEAD)" "$(git rev-parse -q --verify HEAD)" "$(GIT_INDEX_FILE="$idx" git write-tree)"',
].join('\n')

// What a shell command that changed the main checkout tells Claude.
export const changedNote = (top: string, branch: string | undefined): string =>
  `That command changed ${top}, the main checkout, on ${branch ?? 'a detached head'}, which the person keeps every edit off: its files, its HEAD or its branch. Tell the person what changed (git status there shows it), and make further changes in a worktree.`

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
    commonDir,
  }
}

// What a stopped edit's row says in place of the refusal, which reads as an
// error though nothing went wrong.
export const STOPPED_LABEL = 'stopped to move into a worktree first'

// The stopped edits whose rows draw as notes: the newest ones, so a long
// session doesn't grow the list without end.
export const STOPPED_KEPT = 50
export const withStopped = (ids: readonly string[], id: string): string[] => [...ids, id].slice(-STOPPED_KEPT)
