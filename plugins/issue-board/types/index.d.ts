export type Check = { done: boolean; text: string }

export type Issue = {
  number: number
  title: string
  labels: string[]
  checks: Check[]
  updatedAt: string
}

export type Ci = 'pass' | 'fail' | 'pending' | 'none'

export type PullRequest = {
  number: number
  title: string
  branch: string
  isDraft: boolean
  ci: Ci
  review: string
}

export type Board = {
  repo: string
  issues: Issue[]
  prs: PullRequest[]
  fetchedAt: number
}

export type Filter = 'active' | 'future' | 'bugs' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'issue-board': {
      board: Board | null
      error: string | null
      loading: boolean
      filter: Filter
      expanded: number[]
    }
  }
}
