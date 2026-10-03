export type MemsyncPhase = 'off' | 'idle' | 'syncing' | 'error'

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

export type MemsyncView = {
  phase: MemsyncPhase
  // The last failure in plain words; '' when the last sync worked
  error: string
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
}

declare module 'claude-code' {
  interface PluginState {
    memsync: {
      view: MemsyncView
    }
  }
}
