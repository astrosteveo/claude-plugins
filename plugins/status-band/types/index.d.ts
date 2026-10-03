export type StatusBandGit = {
  branch: string
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  conflicts: number
}

export type StatusBandWeek = {
  percent: number
  // ISO 8601, absent when the API sent no reset time
  resetsAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    'status-band': {
      model: string
      // A level such as 'high', a number of thinking tokens, or '' when the model takes none
      effort: string
      project: string
      // null outside a git repository
      git: StatusBandGit | null
      // null off a subscription or before the first API response
      week: StatusBandWeek | null
    }
  }
}
