// What the guard does before the first edit on the default branch.
export type Mode = 'ask' | 'always' | 'never'

// One entry of `git worktree list --porcelain`.
export type Worktree = {
  path: string
  // The branch checked out, without `refs/heads/`; undefined when detached.
  branch: string | undefined
  head: string
  isMain: boolean
  isLocked: boolean
  isPrunable: boolean
}

// A worktree as the pane lists it: what git says, and whether it has changes
// that are not committed. A prunable one, whose folder is gone, has none.
export type Row = Worktree & { isDirty: boolean }

declare module 'claude-code' {
  interface PluginState {
    worktree: {
      // Whether this session has already been stopped once. It is never
      // stopped twice: the person has answered, or Claude has moved.
      asked: boolean
      // The worktrees the /wt pane lists, as last read from git.
      rows: Row[]
      // The top folder of the checkout the session is in, as last read.
      here: string | null
    }
  }
}
