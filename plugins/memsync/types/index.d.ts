// waiting: a sync waits for the repo lock, held by another session or this one
export type MemsyncPhase = 'off' | 'idle' | 'waiting' | 'syncing' | 'error'

// What kind of failure `error` is, so the pane can offer the right fix
export type MemsyncErrorKind = 'secret' | 'rebase' | 'push' | 'offline' | 'busy' | 'repo' | 'other'

export type MemsyncRepo = {
  branch: string
  ahead: number
  behind: number
  // Uncommitted changes, counted as `git status` lists them
  dirty: number
  // '' when the repo has no origin remote
  remote: string
}

export type MemsyncProject = {
  // The project folder, as the session or its transcripts report it
  root: string
  // The folder name under projects/ in the repo; '' when not known
  key: string
  // The memory folder the engine reported; '' when not reported yet
  memoryDir: string
}

export type MemsyncLastSync = {
  // Milliseconds since the epoch
  at: number
  // Files this machine committed and pushed
  pushed: number
  // Files the pull brought in
  pulled: number
}

export type MemsyncShared = {
  name: string
  isLinked: boolean
}

export type MemsyncDiff = {
  // The conflict copy, such as projects/app/notes.laptop.md
  copy: string
  // Unified-diff hunks against the original; '' when there is nothing to draw
  hunks: string
  // Why there are no hunks, or that only the first part is shown; '' otherwise
  note: string
}

export type MemsyncView = {
  phase: MemsyncPhase
  // The last failure in plain words; '' when the last sync worked
  error: string
  // null when there is no error
  errorKind: MemsyncErrorKind | null
  // What the last pane button did, in plain words; '' when there is nothing to say
  notice: string
  repoPath: string
  // null until the first look at the repo, or when it isn't a git repo
  repo: MemsyncRepo | null
  lastSync: MemsyncLastSync | null
  // This session's project; null outside the projects folder
  project: (MemsyncProject & { state: 'linked' | 'unlinked' | 'unknown' }) | null
  linked: MemsyncProject[]
  unlinked: MemsyncProject[]
  // Projects whose folder is gone from this machine
  dead: MemsyncProject[]
  // Repo paths of conflict copies, such as projects/app/notes.laptop.md
  conflicts: string[]
  shared: MemsyncShared[]
  // Newest last, each line led by its time
  log: string[]
  // The conflict copy whose diff the pane shows; null when none is open
  diff: MemsyncDiff | null
}

declare module 'claude-code' {
  interface PluginState {
    memsync: {
      view: MemsyncView
    }
  }
}
