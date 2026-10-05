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
  // GitHub's mergeStateStatus, such as DIRTY (conflicts) or BEHIND its base; absent on an older board.
  mergeState?: string
  // Who is asked to review it, by login or team name, and how many of its review threads are still open.
  reviewers?: string[]
  openThreads?: number
}

// A comment on an issue, as a card shows it.
export type Comment = { author: string; body: string; at: string }

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
// With `children`, an epic: the parent issue, and the sub-issues created under it.
export type Draft = { title: string; body: string; labels: string[]; children?: { title: string; body: string; labels: string[] }[] }

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

// A single-select option as GitHub keeps it; `id` absent on one setup is adding.
export type SetupOption = { id?: string; name: string; color: string; description: string }

// A project linked to the repo, as setup reads it.
export type SetupProject = {
  id: string
  number: number
  title: string
  url: string
  status: { id: string; options: SetupOption[] } | null
  priority: { id: string; options: SetupOption[] } | null
  // The project's automations by name, and whether each is on.
  workflows: { name: string; enabled: boolean }[]
}

// What setup read: the repo, its linked projects, its labels, its open issues and their place in each project, the
// `area:` labels it suggests, and whether an issue template with an Acceptance list is there.
export type SetupFacts = {
  repo: { id: string; name: string; ownerId: string; hasIssues: boolean; permission: string | null }
  projects: SetupProject[]
  labels: string[]
  issues: { id: string; number: number; items: { project: string; item: string; status: string | null }[] }[]
  suggested: string[]
  hasTemplate: boolean
}

// One change setup makes. `state` is how it went once Apply ran.
export type SetupStep = {
  id: 'issues' | 'project' | 'status' | 'priority' | 'bug' | 'areas' | 'items' | 'inbox'
  title: string
  state?: 'running' | 'done' | 'failed' | 'skipped'
  message?: string
}

// Setup in the pane: reading, the plan waiting on Apply, Apply running, or done; `failed` when it couldn't read.
// `chosen` is the project picked among several (or null to create one), `areas` what the area field holds.
export type Setup =
  | { phase: 'reading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready' | 'applying' | 'done'; facts: SetupFacts; chosen: string | null; areas: string; steps: SetupStep[] }

// What setup saves for a repo: the project the board reads, its fields, and which Status option means what.
export type SavedSetup = {
  project: { id: string; number: number; title: string }
  status: { id: string; roles: Partial<Record<'inbox' | 'backlog' | 'ready' | 'started' | 'verification' | 'done', string>> } | null
  priority: { id: string } | null
  at: number
}

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
      // The draft is being created on GitHub: Create waits, so a second press doesn't create it again.
      creating: boolean
      // The issue whose card has its editor open.
      editing: number | null
      // What the editor offers: the repo's labels and open milestones; null until it first opens.
      palette: { labels: string[]; milestones: string[] } | null
      // An epic whose Close was pressed once while it has open sub-issues; the next press closes it.
      closing: number | null
      // What the editor's fields hold: the comment being written, and the epic number typed.
      typing: { comment: string; parent: string }
      // The open card's comments, read when it opens; `comments` null while they're being read.
      talk: { number: number; comments: Comment[] | null; total: number } | null
      // The last permission check; null until one has run.
      access: Access | null
      // The pull request whose details are open in the pane.
      openPr: number | null
      // The grouping picked; null until one is, which means Status with a project and Area without.
      groupBy: GroupBy | null
      // The folded groups the person unfolded, such as Backlog.
      unfolded: string[]
      // `/issues setup` while it shows in the pane; null otherwise.
      setup: Setup | null
    }
  }
}
