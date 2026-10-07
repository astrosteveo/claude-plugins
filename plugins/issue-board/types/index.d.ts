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
  // How many comments it has; absent on an issue read with `gh issue view`, or on an older board.
  comments?: number
  // Its issue type, such as Bug or Task, where the repo's organization has types.
  type?: string | null
  // An epic's sub-issues in GitHub's order, by number; absent on one that isn't an epic, or on an older board.
  subOrder?: number[]
  // The item's values in the project fields the project's views filter or group by, beyond Status and Priority, by
  // field name. Absent when no view needs any.
  fields?: Record<string, string>
  // Its item's place in the project's own order, 0 first, among the open issues of this repo the project holds. Absent
  // when the project doesn't hold it, when the board read no project, or on an older board.
  position?: number
}

// A single-select field of a project, such as Status, with its options in the project's order.
export type Field = { id: string; options: { id: string; name: string }[] }

// What a Status option means to the board: where new issues wait, where triage sends them, the one that folds, where
// Start moves an issue, where a Refs merge leaves it, and where a finished one ends.
export type Role = 'inbox' | 'ready' | 'backlog' | 'started' | 'verification' | 'done'

// Which Status option, by id, has each role. A role left out has no option, and what the board does with it is off.
export type Roles = Partial<Record<Role, string>>

// A field of the project beyond Status and Priority, by its kind. `options` are a single-select field's options, or an
// iteration field's iterations, by title.
export type ProjectField = { id: string; name: string; kind: 'text' | 'number' | 'date' | 'iteration' | 'select'; options?: { id: string; name: string }[] }

// What names a GitHub Project: its node id, its number in its owner's projects, its title and its page.
export type ProjectRef = { id: string; number: number; title: string; url: string }

// The GitHub Project linked to the repository, as far as the board uses it. `fields`: every field the board can read and
// set, Status and Priority among them; absent on an older board.
export type Project = ProjectRef & {
  status: Field | null
  priority: Field | null
  fields?: ProjectField[]
  // The project's latest status update, such as On track with a note; absent when it has none.
  update?: StatusUpdate | null
  // Whether its "Item closed" workflow is on, which marks every closed issue Done, whatever the reason.
  closesToDone?: boolean
  // Which Status option has which role: as setup or /issues statuses saved them, or else found by name.
  roles?: Roles
  // The roles were found by name, with no mapping saved: the band asks the person to confirm any common name it used.
  guessed?: boolean
  // The project's table and board views in GitHub's order; absent on an older board.
  views?: ProjectView[]
}

// A view of the project as GitHub keeps it: its name, its number in the project's URL, its layout, its filter as typed
// on GitHub (empty for none), and the field it groups by (a board's columns), or null.
export type ProjectView = { name: string; number: number; layout: 'table' | 'board' | 'roadmap'; filter: string; groupBy: string | null }

// A project status update: how it stands (On track, At risk, Off track, Complete, Inactive), the note, when it was
// posted, and the dates it gives.
export type StatusUpdate = { status: string; body: string; at: string; start: string | null; target: string | null }

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
  // When the velocity was read: it changes a little a day, so it is read again only after an hour.
  velocityAt?: number
  // The repo's open milestones, read with each full read; absent on an older board.
  milestones?: Milestone[]
  // The issue types the repo offers, by name; none outside an organization that has them.
  issueTypes?: string[]
  // The repo's labels, by name, for the Bugs and Later guess; absent on an older board.
  labels?: string[]
  // The repo's project; null without one, or when gh may not read projects. The board then works from labels.
  project?: Project | null
}

// What Claude knows of the issue it is on, as of its last prompt: the boxes, how many comments there are (null when the
// board can't say), each open pull request for it with the CI of its head commit, and whether the issue is closed. The
// next prompt carries a note of what changed since.
export type Known = { checks: Check[]; comments: number | null; prs: { number: number; ci: Ci; sha: string }[]; closed: boolean }

// The issue Start handed Claude, and when it last changed as of then; `sessionId` is the session that started it.
// `known` is absent until the first prompt in a session that started it. `started`: Start sent it to Claude, rather
// than a checkout of a branch named for it making it the one.
export type Working = { number: number; title: string; updatedAt: string; sessionId?: string; known?: Known; started?: boolean }

// A task Start made in Claude's task list for an open box of an issue, by the task's id. `box` counts from 1, as the
// tick tool does, and `text` finds the box again should the body change. `done`: Claude completed the task, so the
// band asks whether to tick the box.
export type BoxTask = { id: string; number: number; box: number; text: string; done: boolean }

// A CI run on the branch the folder has checked out, as `gh run watch` last drew it: its jobs done of all, how many
// failed, and the job running with its step.
export type RunWatch = { id: number; workflow: string; branch: string; done: number; total: number; failed: number; running: string | null; step: string | null }

// A background agent Start in background set on an issue, with where its loop stands, as `$.agent.list()` says, and
// the last thing it answered.
export type Worker = {
  number: number
  // The issue's title when the agent started, so the line at its end names it; absent on an older board.
  title?: string
  agentId: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
  startedAt: number
  answer: string | null
  // True once the conversation and Claude were told how it ended.
  told?: boolean
  // True when Claude started it with its own Agent tool call, in the main session: Claude Code then gives Claude the
  // agent's result itself, so the board doesn't tell Claude it ended. Absent when a plugin's `$.agent.spawn` or
  // another agent started it, and on an older board.
  byClaude?: boolean
}

// A Start or Start in background pressed on an issue, from the press until the work is under way.
export type Launch = { number: number; how: 'start' | 'background' }

// Something the band above the prompt raises; `key` changes when it happens again.
export type Alert =
  | { kind: 'ci'; key: string; pr: PullRequest }
  | { kind: 'pass'; key: string; pr: PullRequest }
  | { kind: 'activity'; key: string; issue: Issue }
  | { kind: 'closed'; key: string; working: Working }

// Something the board noticed about an epic, for the band: why it moved to Verification, or a sub-issue open again
// under it. `key` names the event, so the same one isn't raised twice and a dismissed one stays gone. `kind` and
// `number`, the sub-issue a reopened or orphaned line is about, say when the line no longer applies; `at` is when it
// was raised, in milliseconds.
export type EpicNote = { key: string; kind: 'verify' | 'reopened' | 'orphaned'; epic: number; number?: number; title: string; text: string; at: number }

// A pane tab: one of the built-in filters, or a project view by its number.
export type BuiltInFilter = 'active' | 'future' | 'bugs' | 'mine' | 'all' | 'inbox' | 'closed'

// `active` and `future` read Priority when there is a project (Now and Later), and the `future` label when not. `inbox`
// is the project's issues with Status Inbox or none, to triage; without a project it holds nothing. `closed` lists the
// issues closed lately, which the board's copy doesn't hold: they are read when the filter is chosen. `view:<n>` is the
// project's view with that number.
export type Filter = BuiltInFilter | `view:${number}`

// A milestone: release scope. `due` is a date, `YYYY-MM-DD`, or null; `open` and `closed` count its issues.
export type Milestone = { number: number; title: string; due: string | null; description: string; open: number; closed: number }

// An issue's values in the project's fields beyond Status and Priority, by field name, as its card last read them.
export type FieldValues = Record<string, string>

// What the text fields of the open card hold before they are sent, by field: `comment`, `title`, `box`, `label`,
// `parent` and `duplicate` for the editor's own fields, and `<issue>-<field id>` for a project field typed in.
export type TypedText = Record<string, string>

// The confirm waiting on a second press, if any. `merge-all` is Merge all; `pr` is a pull request's Finish & merge,
// pressed while a worker owns its branch or its CI hasn't passed; `close` is Close on an epic with open sub-issues.
// There is one at a time, so arming one cancels any other.
export type Armed = { kind: 'merge-all' } | { kind: 'pr' | 'close'; number: number } | null

// An issue as GitHub's search or REST answers it, open or closed, for what the board's copy of open issues can't show.
export type Found = { number: number; title: string; url: string; state: 'open' | 'closed'; reason: string | null; closedAt: string | null; labels: string[] }

// Claude's suggestion for an issue in the Inbox: its Priority, its area (the label without `area:`; null for none), the
// Status accepting moves it to, and why. `updatedAt` is the issue's as of then, so a changed issue is asked about again.
export type Suggestion = { number: number; priority: string | null; area: string | null; status: 'Ready' | 'Backlog'; reason: string; updatedAt: string }

// The Inbox's triage: Claude's suggestions, what the person changed of them, the repo's areas to pick from, and whether
// Claude is being asked; `failed` says why the last ask came to nothing.
export type Triage = {
  suggestions: Suggestion[]
  picks: { number: number; priority?: string; area?: string | null }[]
  areas: string[]
  asking: boolean
  failed: string | null
}

// One change in a plan Claude proposes with project_plan. `kind` says what it changes; each issue kind changes one
// thing on one issue, as issue_update would. A `label` change is the repo's and a `view` change the project's, with no
// issue.
export type PlanChange =
  | { kind: 'status' | 'priority'; number: number; value: string }
  | { kind: 'field'; number: number; field: string; value: string | number | null }
  | { kind: 'labels' | 'assignees'; number: number; add: string[]; remove: string[] }
  | { kind: 'milestone'; number: number; value: string | null }
  | { kind: 'parent'; number: number; value: number | null }
  // A place in the project's own order: straight after the issue `after`, or at the top for null.
  | { kind: 'order'; number: number; after: number | null }
  | LabelChange
  | ViewChange

// A change to one of the repo's labels, which belongs to no issue. `edit` renames, recolors or redescribes it. A delete
// says how many open and closed issues carry it, null when it couldn't count; `markers` names the saved Bugs and Later
// markers that go by the label, which a rename moves and a delete clears.
export type LabelChange = {
  kind: 'label'
  action: 'create' | 'edit' | 'delete'
  name: string
  rename?: string
  color?: string
  description?: string
  uses?: { open: number; closed: number } | null
  markers?: ('bug' | 'later')[]
}

// A change to one of the project's views: `view` is the view as the board read it, null for a new one; `to` is what it
// becomes, null to delete it. `partial` holds the terms of the new filter the board can't apply, so its tab shows more
// issues than GitHub does.
export type ViewChange = { kind: 'view'; view: ProjectView | null; to: ViewShape | null; partial: string[] }

// What a plan makes a view: its name, layout and filter.
export type ViewShape = { name: string; layout: ProjectView['layout']; filter: string }

// A row of the plan card: the change, Claude's reason for it, whether it is ticked to apply, and why it failed the last
// time it was applied.
export type PlanRow = { id: string; change: PlanChange; reason: string; picked: boolean; failed: string | null }

// The plan waiting on the person. `id` tells a plan from the one that replaced it; `applying` holds Apply while its
// writes are under way; `note` says how the last Apply went.
export type Plan = { id: number; rows: PlanRow[]; applying: boolean; note: string | null }

// How the pane groups the issues: by the project's Status, by the epic they are sub-issues of, or by `area:` label.
// `view` is the field the tab's project view groups by, when that isn't Status.
export type GroupBy = 'status' | 'epic' | 'area' | 'view'

// Something the board needs that is missing, and how to fix it. `blocks`: the board can't read GitHub until it's fixed.
// `command` is what Copy fix copies, and `url` the page the fix happens on.
export type Problem = { id: string; title: string; detail: string; fix: string; command?: string; url?: string; blocks: boolean }

// What the last permission check found. `repo` and `permission` are null when gh couldn't say.
export type Access = { login: string | null; repo: string | null; permission: string | null; problems: Problem[]; checkedAt: number }

// A single-select option as GitHub keeps it; `id` absent on one setup is adding.
export type SetupOption = { id?: string; name: string; color: string; description: string }

// A project linked to the repo, as setup reads it.
export type SetupProject = ProjectRef & {
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
  // The roles setup saved last time, and for which project.
  saved?: { project: string; roles: Roles }
  // The project the board may write to, by id; null when it may write to none.
  adopted?: string | null
  // Whether this repo's own settings let the board write to that project, so Release can't take it away.
  granted?: boolean
}

// One change setup makes. `state` is how it went once Apply ran.
export type SetupStep = {
  id: 'adopt' | 'issues' | 'project' | 'status' | 'roles' | 'priority' | 'bug' | 'areas' | 'items' | 'inbox'
  title: string
  state?: 'running' | 'done' | 'failed' | 'skipped'
  message?: string
}

// Setup in the pane: reading, the plan waiting on Apply, Apply running, or done; `failed` when it couldn't read.
// `chosen` is the project picked among several (or null to create one), `areas` what the area field holds.
export type Setup =
  | { phase: 'reading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready' | 'applying' | 'done'; facts: SetupFacts; chosen: string | null; areas: string; steps: SetupStep[]; roles: RolePicks }

// The Status option the person picked for each role in setup, by name: an option the project has, or the board's own
// name for one setup adds. null: none, and the role's features are off.
export type RolePicks = Record<Role, string | null>

// A project of this repo the board may write to: listed by `key`, owner/number, in the person's writeProjects setting,
// through the board's prompt, Apply in `/issues setup` or project_adopt, or in this repo's own settings files. `owner`
// is the login or organization it belongs to. `granted` says this repo's own settings list it, so Release can't take
// it out.
export type Adopted = { key: string; number: number; id: string; title: string; owner: string; granted?: boolean }

// Which project the board may write to, and the projects whose prompt the person turned down, by id, so it isn't
// asked again.
export type Adoption = { adopted: Adopted | null; declined: string[] }

// What marks an issue as a bug: a label, by name, or an issue type, such as GitHub's Bug.
export type BugMarker = { label: string } | { type: string }

// What the Bugs tab, the bug badge and the bug count go by, and the label Later goes by without a project.
export type Markers = { bug: BugMarker; later: string }

// `/issues labels` while it shows in the pane: the issue types and labels it offers, whether Later is asked (only
// without a project), and what is picked.
export type MarkerPicks = { types: string[]; labels: string[]; later: boolean; picks: Markers }

// `/issues statuses` while it shows in the pane: the project, its Status options, and the option picked for each role,
// by id. A role left out has none.
export type StatusPicks = { project: { id: string; title: string }; options: { id: string; name: string }[]; picks: Roles }

declare module 'claude-code' {
  interface PluginState {
    'issue-board': {
      board: Board | null
      error: string | null
      loading: boolean
      filter: Filter
      // The issue whose card is open; one at a time.
      expanded: number | null
      working: Working | null
      dismissed: string[]
      // The confirm waiting on a second press: Merge all, a pull request's Finish & merge, or an epic's Close.
      armed: Armed
      // What the search field holds.
      query: string
      // The GitHub login gh is signed in as, for the Mine filter.
      viewer: string | null
      // The git branch the session's folder has checked out.
      branch: string | null
      // `<number>-<sha>` of each pull request whose CI went from running to passing while the board watched.
      greened: string[]
      // How many issues were captured to the Inbox since the person last opened it: the band counts them.
      captured: number
      // The issue whose card has its editor open.
      editing: number | null
      // What the editor offers: the repo's labels and open milestones; null until it first opens.
      palette: { labels: string[]; milestones: string[] } | null
      // What the open card's text fields hold before they are sent.
      typing: TypedText
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
      // The tasks Start made for open boxes in this session.
      tasks: BoxTask[]
      // The Inbox's suggestions and picks.
      triage: Triage
      // The CI runs on the checked-out branch being watched.
      runs: RunWatch[]
      // The background agents Start in background set going in this session.
      workers: Worker[]
      // The Starts pressed that aren't under way yet: their buttons say so, and don't start the work again.
      launching: Launch[]
      // The issues closed lately, for the Closed filter, and when they were read; `failed` says why the last read failed.
      // null until the filter is first chosen.
      recent: { items: Found[]; at: number; failed?: string } | null
      // Each issue's values in the project's other fields, by issue number, read when its card opens.
      values: Record<number, FieldValues>
      // Which of the pane's sections above the issues the person opened (true) or folded (false), by section.
      sections: Record<string, boolean>
      // Whether the card's editor shows its rarer rows: type, milestone, the project's fields and closing as a duplicate.
      editorMore: boolean
      // What the band says about epics until it is dismissed.
      epicNotes: EpicNote[]
      // The issue whose start message Edit first put in the prompt box, until the person next sends a prompt.
      drafted: number | null
      // The project the board may write to, and the prompts the person turned down.
      adoption: Adoption
      // `/issues statuses` while it shows in the pane; null otherwise.
      statusPicks: StatusPicks | null
      // The guessed Status mappings and Bugs and Later labels the person answered in the band, by key, so each shows once.
      guessSeen: string[]
      // The plan Claude proposed with project_plan, until it is applied or discarded; a new one replaces it.
      plan: Plan | null
      // The Bugs and Later markers the person chose, in /issues labels or with Looks right; empty when none.
      markers: Partial<Markers>
      // `/issues labels` while it shows in the pane; null otherwise.
      markerPicks: MarkerPicks | null
    }
  }
}
