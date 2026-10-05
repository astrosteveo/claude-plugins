export type Check = { done: boolean; text: string }

// A GitHub label, its color the six hex digits GitHub keeps.
export type Label = { name: string; color: string }

export type Issue = {
  number: number
  title: string
  url: string
  labels: Label[]
  assignees: string[]
  checks: Check[]
  updatedAt: string
  // The issue's text as written; empty on a board saved between sessions, until it refreshes.
  body: string
  // What GraphQL adds, which `gh issue view` doesn't give: absent on an issue read that way, or on an older board.
  // `id` is the issue's node, `item` its item in the board's project, and `status` and `priority` that item's values.
  id?: string
  item?: string | null
  status?: string | null
  priority?: string | null
  milestone?: string | null
  // The issue this one is a sub-issue of, with how many of that issue's sub-issues are closed.
  parent?: { number: number; title: string; total: number; completed: number } | null
  subIssues?: { total: number; completed: number }
  // The open issues this one is blocked by, and the open pull requests GitHub says will close it.
  blockedBy?: number[]
  prs?: number[]
}

// A single-select field of a project, such as Status, with its options in the project's order.
export type Field = { id: string; options: { id: string; name: string }[] }

// The GitHub Project linked to the repository, as far as the board uses it.
export type Project = { id: string; number: number; title: string; url: string; status: Field | null; priority: Field | null }

export type Ci = 'pass' | 'fail' | 'pending' | 'none'

export type PullRequest = {
  number: number
  title: string
  url: string
  author: string
  branch: string
  isDraft: boolean
  ci: Ci
  review: string
  additions: number
  deletions: number
  updatedAt: string
  // The head commit, so an alert about one CI run comes back for the next.
  sha: string
  // The names of the checks that failed, and the Actions runs they belong to.
  failing: string[]
  runs: number[]
  // The issues it says it closes or refers to (`Closes #N`, `Refs #N`), in order.
  issues: number[]
}

// Issues closed and pull requests merged each week, oldest week first.
export type Velocity = { closed: number[]; merged: number[] }

export type Board = {
  repo: string
  issues: Issue[]
  prs: PullRequest[]
  velocity: Velocity
  fetchedAt: number
  // The repo's project; null without one, or when gh may not read projects. The board then works from labels.
  project?: Project | null
}

// The issue Start handed Claude, and when it last changed as of then; `sessionId` is the session that started it.
export type Working = { number: number; title: string; updatedAt: string; sessionId?: string }

// An issue Claude drafted from the conversation, waiting for the person to file it.
export type Draft = { title: string; body: string; labels: string[] }

// Something the band above the prompt raises; `key` changes when it happens again.
export type Alert =
  | { kind: 'ci'; key: string; pr: PullRequest }
  | { kind: 'pass'; key: string; pr: PullRequest }
  | { kind: 'activity'; key: string; issue: Issue }
  | { kind: 'closed'; key: string; working: Working }

// `active` and `future` read Priority when there is a project (Now and Later), and the `future` label when not.
export type Filter = 'active' | 'future' | 'bugs' | 'mine' | 'all'

// How the pane groups the issues: by the project's Status, by the epic they are sub-issues of, or by `area:` label.
export type GroupBy = 'status' | 'epic' | 'area'

// Something the board needs that is missing, and how to fix it. `blocks`: the board can't read GitHub until it's fixed.
// `command` is what Copy fix copies, and `url` the page the fix happens on.
export type Problem = { id: string; title: string; detail: string; fix: string; command?: string; url?: string; blocks: boolean }

// What the last permission check found. `repo` and `permission` are null when gh couldn't say.
export type Access = { login: string | null; repo: string | null; permission: string | null; problems: Problem[]; checkedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'issue-board': {
      board: Board | null
      error: string | null
      loading: boolean
      filter: Filter
      expanded: number[]
      working: Working | null
      dismissed: string[]
      // Close out all was pressed and waits on its confirm.
      confirming: boolean
      // What the search field holds.
      query: string
      // The GitHub login gh is signed in as, for the Mine filter.
      viewer: string | null
      // The git branch the session's folder has checked out.
      branch: string | null
      // `<number>-<sha>` of each pull request whose CI went from running to passing while the board watched.
      greened: string[]
      draft: Draft | null
      drafting: boolean
      // The last permission check; null until one has run.
      access: Access | null
      // The pull request whose details are open in the pane.
      openPr: number | null
      // The grouping picked; null until one is, which means Status with a project and Area without.
      groupBy: GroupBy | null
      // The folded groups the person unfolded, such as Backlog.
      unfolded: string[]
    }
  }
}
