# Issue Board

A Claude Code mod that brings a repository's GitHub issues, pull requests and
GitHub Project into the terminal. It gives you a pane to see and change them,
a band above the prompt for what needs you, and tools that let Claude run the
project with you.

## What you need

- Claude Code v2.1.292 or later.
- The `gh` CLI, signed in, in the folder the session started in. The token
  needs `repo`, and `project` for the repo's GitHub Project.
- A repo on GitHub. A GitHub Project linked to it is optional, but Status and
  Priority come from there.

Mods are an early access part of Claude Code. Their API may change between
releases, and a release may break the board until it is updated.

## Quick start

1. Run `/issues` to open the pane.
2. If the repo has no GitHub Project yet, run `/issues setup` once. It shows
   what it would change and waits for **Apply**.
3. Press Enter on an issue, then **▶ Start** to hand it to Claude.

The board only reads a project until you let it write there. See
[Letting the board write to your project](#letting-the-board-write-to-your-project).

`/issues help` lists every key, subcommand and tool. `/issues check` says
what the board is missing, if anything.

## How the board is organized

### Status

Each issue's Status is a field in the GitHub Project. The board gives six
Status options a part each:

**Inbox → Backlog → Ready → In progress → Verification → Done**

- **Inbox** holds new work to triage. Captures and `/issues new` land here.
- Triage sends an issue to **Ready** when its Priority counts as Now, and to
  **Backlog** otherwise. The Backlog starts folded in the pane.
- **▶ Start** moves an issue to **In progress**.
- **Verification** is for issues a merge didn't finish.
- **Done** means shipped.

Your project's options can have other names, such as `Todo` or `Shipped`. See
[Fitting an existing project](#fitting-an-existing-project).

The board can move issues by itself, in a project you let it write to.
**Move issues on their own** (`autoMove`) turns these moves on. It is off by
default:

- An issue that closes as completed moves to Done at the board's next read,
  wherever it closed. One closed as not planned or as a duplicate stays where
  it was, so Done means shipped.
- An issue a merged pull request names with `Refs #N` moves to Verification,
  since the merge didn't finish it. Claude's next prompt says so. An epic
  doesn't: its Status follows its sub-issues.
- Epics move with their sub-issues. See [Epics](#epics).

One rule decides each move. When two pick the same issue in one read, the
board makes one move: the one that takes the issue furthest, so Done beats
Verification. No move goes backwards, and the moves of a read are made one at
a time.

Each move needs its Status. To skip one, set its Status to none in
`/issues statuses`: with no Verification, for example, a Refs merge moves
nothing.

Each time the board moves issues by itself, a toast says which and why, such
as `Moved #43 to Done: it closed as completed.` A move GitHub refuses says so
once.

### Priority

Priority is a project field too, such as P0, P1 and P2. The first two options
count as **Now**, and the rest as **Later**. The Now and Later tabs and
triage go by it.

### Labels for kind and area

Labels say what an issue is and where it belongs:

- **Bugs** go by the repo's bug label or GitHub's Bug issue type. They get the
  `▲` badge, the Bugs tab and the bug count.
- **`area:` labels**, such as `area:engine`, say which part of the project an
  issue is about. Triage suggests one, and the pane can group by area.
- **Later**, without a project, goes by a label such as `future`. With a
  project, Later goes by Priority instead.

The board finds the bug and Later labels by name. See
[Fitting an existing project](#fitting-an-existing-project).

## The pane

`/issues` opens the pane. From the top:

- **The header**: the repo, its open issues, bugs, pull requests and failing
  CI, and when it last synced. A wide pane adds how many boxes are ticked,
  and sparklines of issues closed and pull requests merged each week over 12
  weeks, such as `closed ▁▂▅▃▇█▁▂▅▃▇█ 41`.
- **The project's status update**, when it has one, such as
  `◉ At risk · Docking slipped. · target 2026-10-20 · 2h ago`, colored by how
  it stands.
- **Milestones**: each open milestone with a bar of its closed issues and its
  due date. It turns red once it's past due with issues still open.
- **Pull requests**: see [Pull requests and CI](#pull-requests-and-ci).
- **Issues**, under tabs, a search field and grouping buttons.

Press the **Milestones** or **Pull requests** heading to fold it to one line,
such as `Launch 5/7` or `3 open · ✓ 2 · ✗ 1`. On a pane shorter than 24 rows
they start folded, so the issues show first. The board remembers how you
leave them.

### Tabs

When the project has table or board views with a filter, those views are the
tabs. See [The project's views as tabs](#the-projects-views-as-tabs).

Otherwise, the pane has its own tabs:

| Key | Tab | What it shows |
| --- | --- | --- |
| `1` | Now | Priorities that count as Now. Without a project: Active, issues without the Later label. |
| `2` | Later | The other priorities. Without a project: Future, issues with the Later label. |
| `3` | Bugs | Issues with the bug label or type. |
| `4` | Mine | Issues assigned to you. |
| `5` | All | Every open issue. |
| `6` | Inbox | Issues with Status Inbox or none, for triage. Only with a project that has an Inbox. |
| `7` | Closed | Issues closed lately, each with how it closed, read from GitHub when you choose it. |

### Finding and grouping issues

The search field keeps the issues whose title, number or labels hold every
word you type. **by Status**, **Epic** or **Area** groups them. Press a folded
group, such as the Backlog, to open it. `r` refreshes.

### Issue rows

Each issue is one row. It shows its priority, number and title. At the right
it shows its background agent, its pull request with CI (`⇄ #51 ✓`), its
labels in their colors, a bar of its boxes (`━━━ 2/4`) and how long since it
changed. A narrow pane drops the labels, then the bar, then the age, so the
row stays on one line. An issue waiting on an open one shows `⛔ #N`.

Within a group, rows follow the project's own order, the one you set by
dragging items on GitHub. Issues the project doesn't hold come after, in the
board's order: the most pressing priority first, then bugs (`▲`), then work
under way, then the newest. Without a project, the whole list is in the
board's order.

Hover a row to preview its open boxes. The preview opens above the row, so the
rows above stay clear for the pointer. Near the top of the pane it lists fewer
boxes, and a row with no room above shows none.

### The project's views as tabs

A team that keeps views in its GitHub Project gets them in the pane. Each
table or board view with a filter becomes a tab, named and ordered as on
GitHub, on keys `1` to `7`. The board's own **Inbox**, **All** and **Closed**
come after them. Inbox comes only with a project that has an Inbox, and only
when no view keeps just the Inbox already; it then takes a key, so six views
fit. A view needs a filter to become a tab. A view with none, such as
GitHub's own "View 1", shows every issue, which All already does. Roadmap
views are left out, and so are views past the seventh.

A tab shows the open issues its view's filter keeps, from the board's own
copy, with no extra GitHub request. The board knows these terms:

- `status:`, `priority:`, `label:`, `assignee:` (with `@me`), `milestone:`
  and `type:` (the issue type).
- Any project field by name, such as `area:Engine` or `"story points":3`. A
  hyphen can stand for a space: `story-points:3`.
- `no:` and `has:` with any of those, such as `no:assignee` or `no:status`.
- `is:open` and `is:issue` keep every issue on the board. `is:closed` and
  `is:pr` keep none, since the board holds open issues.
- `-` before any term to negate it, quotes around values with spaces, and
  comma lists for any of several values, such as `label:bug,docs`.
- Plain words match the title, and a number matches the issue.

A term it doesn't know, such as `updated:>@today-7d`, a range or a wildcard,
is left out. The tab then shows a note naming the term, with **↗ Open the
view** to see it on GitHub. The tab may list more than the view does, never
less.

A tab groups its issues the way the view does, when the board can: by Status
(a board view's columns), by epic for Parent issue, or by another field such
as Area, which then shows among the **by** buttons. You can pick another
grouping any time. A view grouped by labels or assignees keeps the pane's
grouping, since an issue can have several of those.

The board reads the views with the issues. When a view filters or groups by a
field beyond Status and Priority, it reads that field's values for each issue
too. A new or changed view that names such a field costs one extra read the
first time. The band, the hint line and **▶ Next** go by the issues, not the
tab.

## Working on an issue

Press Enter on an issue, or click it, to open its card. One card is open at a
time. It shows:

- the labels, assignees, epic, milestone, type and open blockers;
- a row each of **Status** and **Priority** buttons;
- the project's other fields that have a value;
- the issue's text and its boxes (press a box to tick it on GitHub);
- the latest three comments, a field to reply, and **Ask Claude to answer**,
  which hands Claude the last comment.

Its buttons:

- **▶ Start** (`s`) sends Claude the issue with its open boxes, and makes a
  task for each box. The issue moves to In progress and is assigned to you.
  The button then says `▶ Started`, so it can't send the issue twice.
- **⚙ Start in background** (`b`) starts the board's agent,
  `issue-board:worker`, on the issue. Claude is sent no message, so the
  issue's text stays out of the conversation. The issue moves to In progress
  and is assigned to you once the agent starts. The agent works in its own git
  worktree, ticks boxes, and opens a pull request. It doesn't merge or
  force-push. It asks for permission as any background agent does. When the
  start is refused or fails, a toast says why and the button comes back.
- **✎ Edit first** (`e`) puts Start's message in the prompt box, so you can
  add your own instructions. When you send it and it still names the issue,
  the board does what Start does. If you rewrite it so it no longer names the
  issue, it goes as a plain prompt. With issue copies on, the message only
  names the issue, and a fresh copy of the issue goes with it. With copies
  off, it lists the open boxes itself.
- **✎ Edit first in background** puts a message in the prompt box that asks
  Claude to start the agent with Start's message as its prompt. Lines you add
  go in the agent's prompt, since the agent can't ask you anything.
- **⚙ Change** opens the editor. See [Changing issues](#changing-issues).
- **↗ GitHub** opens the issue. **Collapse** (`x` or Esc) folds the card.
  With no card open, Esc closes the pane.

Start assigning the issue and moving it to In progress is a setting:
**Start assigns and moves the issue** (`claimOnStart`), on by default.

### Background agents

A row shows its agent: `⚙ working`, `waiting`, `done`, `failed` or `stopped`.
While an agent works on the issue, the card shows it in place of the Start
and Edit first buttons, such as `⚙ Worker on it · working 4m`. That holds
whether Start in background or Claude started the agent. The buttons come
back when the agent ends.

When an agent ends, the conversation says so, with its last answer and pull
request. Claude is handed the same, so it can follow up. Claude gets the
first 1,000 characters of the answer, and the pull request holds the rest.

### Where Start works

**Where Start works** (`startMode`) picks the card's first Start.

- `main`, the default, works as described above. Claude works on the issue in
  this chat.
- `background` makes Claude an orchestrator. **⚙ Start in background** comes
  first and takes `s`. **✎ Edit first in background** takes `e`. **▶ Start**
  moves to `b`. A note in the system prompt tells Claude to hand each issue to
  `issue-board:worker` and to make only small changes itself, such as a
  one-line fix or a typo in the docs. When a worker ends, Claude reviews its
  pull request, runs the repository's checks, watches CI, and then merges it
  or tells you what is left. It merges only if your own rules let it.

Workers that change the same files get in each other's way, and each pull
request then conflicts with the one merged before it. In a repository where
most changes touch one big file or a version field, run one worker at a time,
unless their issues touch separate areas.

### The issue Claude is on

The issue this session is on has `▶` on its row, and `✕` to stop tracking it.
It's the one you pressed Start on, or the one Claude started on when you
asked in the conversation. It can also be the one whose branch is checked
out: a branch such as `fix/315-glide`, `315-glide` or `issue-315` counts. Only
the main session's checkouts count, not a background agent's. **Follow the
branch** (`followBranch`) turns this off.

While Claude is on it:

- With **Working note in the system prompt** (`workingNote`) on, a short note
  in the system prompt names the issue and tells Claude to tick boxes as it
  finishes them. The note survives compaction.
- A pull request Claude writes for the issue gets a line naming it: `Closes #N`
  when every box is ticked, and `Refs #N` while a box is open. The board adds
  it to the text Claude Code has Claude write into a pull request, decided from
  the boxes as they stand when the pull request is written. It isn't in the
  working note, so the note stays the same as boxes get ticked. While a
  background agent runs on another issue, the line is left out, since the
  agent's pull request would read the same text; the agent's own prompt
  carries the rule instead. **Closes only when every box is ticked**
  (`closesWhenTicked`) turns this off, and leaves it to the repo's own
  rules. Moves to Verification on a Refs merge rely on it.
- The next prompt carries what changed on GitHub since: boxes, new comments,
  CI on its pull request, or the issue closed. Claude's own changes aren't
  news. This has no setting. Press `✕` on the row to stop it.
- With **Suggest the next step** (`suggestNextStep`) on, after each turn the
  prompt box suggests the next step, such as `Open a PR for #N` once every box
  is ticked. Tab takes it.

### Copies of issues a prompt names

A prompt that names `#123` carries the board's copy of that issue or pull
request for Claude, unseen. A copy goes once per session. Naming the issue
again sends it again only when the issue, or a pull request for it, changed
since. After a compaction or `/clear`, the next prompt that names it sends it
again. A prompt carries up to three copies, and names any more in one line. A
copy carries the first 2,000 characters of the issue's text, and says when it
was cut. **Copies of issues a prompt names** (`issueCopies`) turns this off.

## Epics

Epics are parent issues with GitHub's sub-issues.

- Grouped by Epic, each heading has a bar of its sub-issues closed, such as
  `6/12 closed`, and **▶ Next**, which starts Claude on the first one nothing
  blocks.
- Sub-issues keep the epic's order, not the project's. They follow GitHub's
  sub-issue order where priority and blockers don't decide.
- On an epic's card, both Starts and both Edit first buttons act on its first
  ready sub-issue, and name it, such as `▶ Start #185`. An epic is worked one
  sub-issue at a time. When every open sub-issue is blocked, Start says so in
  a toast and sends nothing. When every sub-issue is closed, Start starts the
  epic itself, so you can finish its own boxes.
- While an agent works on one of its sub-issues, the card names it, such as
  `⚙ Worker on #185`.
- Every new epic, from `/issues new epic` or `issue_create` with sub-issues,
  is filed with an "Every sub-issue is closed" box.

With **Move issues on their own** (`autoMove`) on, an epic moves along with
its sub-issues. It is off by default.

- Starting a sub-issue moves its epic to In progress, if the epic is still in
  the Inbox, Backlog or Ready. An epic that is further along stays put.
- When the last open sub-issue closes, the board ticks the epic's "Every
  sub-issue is closed" box. If every box is then ticked, it closes the epic
  as completed and moves it to Done. If other boxes are still open, it moves
  the epic to Verification, and the band and the next prompt say how many.
- A sub-issue that reopens, or a new one under a closed epic, shows in the
  band. The board doesn't reopen or move anything for it.
- A merged pull request that says `Refs #N` for the epic leaves its Status
  alone, even when its sub-issues are all open. Only its sub-issues, or its
  own closing, move it.

These epic lines come last in the band and clear themselves once they no
longer apply. A Verification line goes when the epic closes or every box is
ticked. A line about a sub-issue goes when the sub-issue closes or leaves the
epic, or when the epic closes or reopens. Any epic line goes after 24 hours.
Press **✕** to dismiss one sooner.

When Claude runs `gh issue close` on an epic with open sub-issues, Claude Code
asks you first, whatever your rules allow. A background agent is refused
instead, and told to deal with the sub-issues first.

## Adding issues

Work found in conversation doesn't stay in the chat. It goes to the Inbox,
where you review it.

### Capture

- **Claude captures as it goes.** While **Capture section in the system
  prompt** (`capture`) is on, which it is by default, the system prompt tells
  Claude to file work it finds but won't do this turn with its `capture`
  tool. That covers a follow-up, a bug noticed in passing or an idea. Claude
  doesn't list it in its answer instead.
- **No duplicates.** Before filing, capture compares the title with the open
  issues and with the ones closed in the last 30 days. When one is the same
  work, it comments there instead, and says so.
- **You see it.** Each capture shows a toast. The band shows a `✚ INBOX`
  line, such as `3 captured to the Inbox`, until you open the Inbox. **Open
  Inbox** opens the pane at the Inbox tab: the board's own, or a project view
  whose filter is the Inbox, such as `status:Inbox` or `no:status`. `✕` puts
  the line away.

### /issues new

- `/issues new <what>` has Claude write an issue from the conversation, with
  a title, a body with an `## Acceptance` list, and labels the repo uses. It
  captures it to the Inbox at once.
- `/issues new epic <what>` captures a parent and the sub-issues that finish
  it, each under the parent.

To file an issue with a Status, Priority or other fields set, ask Claude. Its
`issue_create` tool takes them all.

### Triage

The Inbox tab holds issues with Status Inbox or none. Claude suggests a
Priority, an `area:` label, and Ready or Backlog for each, with a reason.
Change any pick, then press **✓ Accept**.

## Changing issues

The card's Status and Priority buttons change those at once. **⚙ Change** on
a card opens its editor. Each change is made on GitHub at once. Its rows:

- What it is: **Title**, **Boxes** (type one to add it; **✎ Edit the body
  with Claude** for more) and **Labels** (press one to add or take it off;
  type in **+ new label** to make one, an `area:` label in the areas' color).
- Where it sits: **Epic** (type a number to put it under one, or take it
  out).
- Who has it: **Assignee**.
- Ending it: **Close** as completed or not planned. Closing an epic with open
  sub-issues takes a second press.

**▾ More** opens the rarer rows in place: **Type** (where the repo's
organization has issue types), **Milestone**, the project's other fields, and
closing **as duplicate of #**, which GitHub links. For a field, an iteration
or option is a button, a number, date or text is a field, and **clear** takes
it off.

## Pull requests and CI

Each open pull request is a row. It shows its CI (`✓ PASS`, `✗ FAIL`,
`◷ CI`), title, the issue it is for (`→ #38`), its review, and `◆` on the
branch you have checked out. A `⚙` after its number means a background agent
is still on its issue and may push to its branch. It says why it can't merge
yet: `⚠ conflicts`, `↓ behind`, open review threads, and who is asked to
review. At the right are its diff counts (`+120 −40`) and **Finish & merge**.
Press the title for its details.

A row stays on one line. Its number, CI, linked issue and counts never break
across lines, and the title is cut with `…` instead. A narrow pane drops parts
in this order: who is asked to review, open threads, the diff counts, the
linked issue, the merge note and the review mark. Last, **Finish & merge**
becomes **Merge**.

- **Finish & merge** sends Claude to see it through: fix CI, answer review,
  and merge, without bypassing branch protection or force-pushing. While a
  background agent owns the branch, or CI is still running or failing, it
  asks first and says why. **Close out anyway** sends it, and **Cancel**
  doesn't.
- **⇶ Merge all** (`m`) does the same for every open pull request, oldest
  first, after asking: `y` to send, `n` to cancel.

One question waits at a time. Asking one, such as Merge all's, drops any
other that was waiting, such as a pull request's or an epic's Close.

While CI runs on your branch, a `◷` row shows its progress, such as
`validate › Install Claude Code`, until it ends.

## Above and below the prompt

### The band above the prompt

The band speaks up only for what needs you:

- CI that fails (**Fix** hands it to Claude) or passes (**Finish & merge**);
- news on the issue you started, and its closing;
- a task Claude finished whose box is still open (**Tick box N**);
- how many issues were captured to the Inbox since you last opened it;
- epic lines (see [Epics](#epics));
- a plan to review, a project to let the board write to, a Status or label
  guess to confirm, and setup problems.

`✕` waves an alert off until it happens again. The band doesn't list
background agents, since Claude Code already shows them. Its lines stay on
one row: their badge, number and buttons keep their width, and the text is
cut. **Band above the prompt** (`band`) turns it off.

### The line under the prompt

The line under the prompt sums up the board in dim text, such as
`? for shortcuts · 35 issues · 1 bug · PR #335✓`. It shows nothing when
nothing is open. Claude Code's own PR footer already shows the checked-out
branch's pull request at the start of that line. So while the footer is on
(`/config`, "Show PR status footer"), the board lists only the other pull
requests there. A problem the check found shows there too.

### Issues after #

Type `#` in the prompt box to pick an open issue or pull request from the
board. `#12` matches by number (#12, #120…), and `#dock` matches titles with
"dock" in them. Each row shows the title, and the Status, Priority and labels,
or the CI state for a pull request. Issues in progress come first, then pull
requests, then Ready, Verification, Backlog and Inbox, each by priority. It
shows 8 rows at most, and reads no more of GitHub than the board already has.

## Letting Claude help

### Claude's tools

| Tool | What it does |
| --- | --- |
| `issues` | Reads the board's list; one issue in full with its boxes, fields and latest ten comments; any issue by number, even closed; a search of every issue (`state`, `search`, `label`, `assignee`, `milestone`); the project's issues at a Status (`status`, `since`); and the open milestones (`milestones`). |
| `tick` | Ticks or unticks boxes, reading the body fresh first. |
| `issue_update` | Changes an issue: Status, Priority, title, body, boxes (`addBoxes`, `rewordBoxes`), labels, assignees, epic and its order among siblings (`moveBefore`, `moveAfter`), its place in the project's order (`projectAfter`, an issue's number or 0 for the top), milestone, type, other project fields (`fields`), blocked-by links, pin, lock, transfer to another of the owner's repos, a comment, and closing, as a duplicate too. It works on closed issues too, and says when one is already at the Status asked for. `start` marks that Claude started on the issue here, as Start does. On an epic it starts the next ready sub-issue and says which one, or the epic itself once every sub-issue is closed. |
| `capture` | Files work found in conversation to the Inbox, with a body that says why it came up, labels and an epic. It comments on an open issue, or one closed in the last 30 days, that is the same work. |
| `issue_create` | Files an issue, or an epic with its sub-issues, with labels, assignees, milestone, epic, type, blocked-by links, Status and Priority. A label the repo hasn't got is made first. |
| `milestone` | Makes or changes a milestone by title: due date, description, rename, close or reopen. |
| `project_status` | Reads the project's status update, or posts one. |
| `project_archive` | Archives project items: one issue's, or every one at Done that closed before a date. It lists them first and archives on a second, confirmed call. |
| `project_adopt` | Lets the board write to a project, or releases it. See [Letting the board write to your project](#letting-the-board-write-to-your-project). |
| `project_plan` | Proposes many changes as one plan. See [Plans](#plans). |

### Permissions

Each tool that changes something goes through Claude Code's permission check
before it touches GitHub, as any tool does. If you say no, or a rule denies
it, nothing changes.

Some calls don't ask, because they change nothing, are part of work you
started, or only add to the Inbox:

- reading with `issues`, reading the status update, and listing what an
  archive would take;
- ticking boxes;
- moving the Status of the issue you started, and `start`;
- capturing.

A rule that denies these still stands, and so does an organization's rule
that requires asking.

A few calls ask more than usual:

- A transfer from a public repo to a private one, which GitHub won't undo,
  needs a second, confirmed call.
- `project_adopt` always asks, even if a rule allows the tool.
- `project_adopt` and `project_plan` need you to read their prompt. So they
  are refused in auto mode, where a classifier answers the prompt, and in
  bypass mode, where nothing asks. `project_adopt` is refused for a
  background agent too. Switch to a mode that asks, or use the pane: **Let it
  write** to adopt a project, or **Apply** on the plan card.
- Closing an epic with open sub-issues asks. See [Epics](#epics).

### Plans

Ask Claude to "prioritize my backlog" or "rank the Ready issues", and it can
propose the whole change as one plan with `project_plan`. That is one
permission prompt instead of one per issue. Each change in a plan has a short
reason.

A plan can change issues: Status, Priority and other project fields, labels
and assignees, the milestone and the epic, and an issue's place in the
project's order (`projectAfter`).

A plan can change the repo's labels, in its `labels` list. It can create one
with a name, color and description, rename it, recolor it, change its
description, or delete it. Label changes come first on the card, under *The
repo's labels*, so an issue in the same plan can take a label it makes.

- A delete row says how many open and closed issues carry the label, from
  GitHub's search counts, or that it couldn't count them.
- A rename keeps the label on its issues, as GitHub does.
- If the label is one your saved Bugs or Later marker goes by, the row says
  so. A rename moves the marker to the new name, and a delete clears it, so
  the board guesses it again.
- Label changes are repo writes. They go through the permission prompt but
  don't need the board to be allowed to write to the project.

A plan can change the project's views, in its `views` list:

- **Create** a view with a name, a layout (table, board or roadmap; table by
  default) and a filter.
- **Change** a view's name, layout or filter. Name the view by its number or
  its name.
- **Delete** a view with `delete: true`. Its row names the view and its
  filter, so you can see what goes.

A filter is checked with the same parser the tabs use. A term the board can't
apply, such as `sprint:@current`, is allowed, but its row says so: the view's
tab will leave that term out and show more issues than GitHub does. After
Apply the board reads the views again, so new and changed views show as tabs,
and deleted ones go.

The board checks the whole plan first: the issues are open on the board, the
options, fields and milestones exist, and the board may write to the project.
If anything is wrong, it refuses the plan and lists every problem at once.
Nothing is shown or asked.

A valid plan shows at once as a card at the top of `/issues`. The band shows
a `✦ PLAN` line with **Review**, which opens the pane.

- The card has one row per change: label changes first, then the changes
  grouped by issue, then view changes under the project's name. Each row has
  a box to tick and Claude's reason. All rows start ticked.
- **Apply** writes the ticked rows in order, then reads GitHub once. Rows
  that went through leave the card, and so do unticked ones. A row that
  failed stays, with why, so you can try it again or discard it.
- **Discard** drops the plan. A new plan from Claude replaces the old one.
- A change the board already shows as made leaves the card and the band, for
  example because Claude made it with `issue_update` after the plan. Apply
  skips it and says so. When every change is made, the plan goes. Changes the
  board can't check, such as a field it doesn't read or a label's color,
  stay.

Claude's call asks permission once, with the plan summed up by kind, such as
`Status 3 · Priority 2 · order 4`. Saying yes applies the plan, so you can
approve it from the phone app without the pane. Saying no changes nothing and
leaves the plan on the card, to apply in part or discard.

## Letting the board write to your project

The board reads any project linked to the repo. It writes to one only after
you let it. Until then the project is read-only to the board, whatever the
other settings say.

### Letting it write

While the board reads a project it may not write to, the pane asks once:
**Let the board write to Void Sector, owned by astrosteveo?** It says what the
board would write: Status and Priority, adding issues as items, archiving
items when asked, and status updates. It says these are GitHub API calls made
with your `gh` token, and how often the board reads GitHub. The band shows a
short line with **Review**, which opens the pane.

- **Let it write** adds the project to the list. So does **Apply** in
  `/issues setup`, whose plan says *Let the board write to …*. A project setup
  creates is added as it is made.
- **Keep read-only**, or `✕` on the band's line, puts the question away for
  that project. `/issues setup` can still add it.
- `/issues setup` shows which project the board may write to, with
  **Release** to make it read-only again. Release takes only that project off
  the list.
- Claude can add or release a project when you ask it to, with the
  `project_adopt` tool, for example from Remote Control or the phone app. It
  takes the project the board reads, or another linked to the repo by number,
  and refuses any other. Its prompt carries the same warning as the pane. See
  [Permissions](#permissions) for when it is refused.

A change counts at once in the session that made it. Other sessions already
open see it the next time they load the board: after `/reload-plugins`, or in
a new session.

### The setting

The list is a setting, **Projects the board may write to** (`writeProjects`):
projects as `owner/number`, split by commas, such as
`astrosteveo/9, astrosteveo/8`. Empty, the default, means the board only
reads. A project has the same name in every repo, so one list in your own
settings covers all your repos. In a repo, the board writes only to a listed
project that is the one it reads there, or one linked to the repo. You can
change it in `/config`, where it is a text row, but the buttons and the tool
do it for you.

A repo's `.claude/settings.json` can set it too, for everyone who works in it:

```json
{ "pluginConfigs": { "issue-board@astrosteveo-plugins": { "options": { "writeProjects": "astrosteveo/9" } } } }
```

The board reads the repo's `.claude/settings.json` and
`.claude/settings.local.json` itself, and your own user settings, and counts
them together. A project the repo grants gets no question, and Release can't
take it away: `/issues setup` says so where Release would be, and
`project_adopt` refuses. To release it, edit the repo's file. Letting the
board write only ever changes your own list, never the repo's.

### Without write access

What still works:

- Every read: the pane, the band, the tabs, and Status and Priority as the
  project has them.
- Changes to issues themselves: Start still tracks the issue and assigns it to
  you, boxes still tick, an epic still closes when its last sub-issue does,
  `issue_create` still files the issue, and triage's Accept still changes the
  `area:` label.

What doesn't happen:

- Start, triage's Accept and the moves a read makes leave the project's
  Status and Priority alone, and new issues aren't added as items. Accept
  says it skipped them, and the issue stays in the Inbox.
- A tool asked to change only the project, such as `issue_update` with a
  Status, or `project_status` posting an update, is refused before it asks
  you. The refusal says why and how to let the board write.
- A call that changes the repo too, such as `issue_update` with labels and a
  Status, still asks. It makes the repo's changes and says which project
  changes it skipped.
- `/issues check` and `/issues help` list it under Off.

## Settings

Change these in Claude Code's `/config`, under the issue board. The key in
brackets is what `.claude/settings.json` takes.

| Setting | Default | What it does |
| --- | --- | --- |
| **On GitHub, by itself** | | Project changes happen only in a project you let the board write to. |
| Move issues on their own (`autoMove`) | off | Closed issues move to Done, a Refs merge moves its issue to Verification, and epics move with their sub-issues. Each move needs its Status. See [Status](#status) and [Epics](#epics). |
| Start assigns and moves the issue (`claimOnStart`) | on | Start, and Claude starting on an issue, assign it to you and move it to In progress. |
| Projects the board may write to (`writeProjects`) | empty | See [The setting](#the-setting). |
| **How Start works** | | |
| Where Start works (`startMode`) | `main` | `main` starts an issue in this chat. `background` makes Start in background the first button, and tells Claude in the system prompt to work as an orchestrator. See [Where Start works](#where-start-works). |
| **In Claude's prompts and the prompt box** | | |
| Working note in the system prompt (`workingNote`) | on | While Claude is on an issue you started, a note names it and says how to tick its boxes. |
| Closes only when every box is ticked (`closesWhenTicked`) | on | A pull request for the issue Claude is on, and the background agent's, says `Closes #N` only when every box is ticked, and `Refs #N` otherwise. Off, the board says nothing about it. See [The issue Claude is on](#the-issue-claude-is-on). |
| Capture section in the system prompt (`capture`) | on | Tells Claude to capture work it finds to the Inbox. Off, the section goes, and the tool and `/issues new` stay. |
| Copies of issues a prompt names (`issueCopies`) | on | A prompt that names `#123` carries the board's copy of it, unseen. |
| Suggest the next step (`suggestNextStep`) | off | After Claude's turn, the prompt box suggests the board's next step in place of Claude Code's own. |
| Follow the branch (`followBranch`) | on | Checking out a branch named for an issue makes it the one Claude is on. |
| **On screen** | | |
| Band above the prompt (`band`) | on | The band raises what needs you. See [The band above the prompt](#the-band-above-the-prompt). |
| **Reading GitHub** | | |
| How often the board reads GitHub (`refresh`) | `5` | Every 5, 15 or 60 minutes, or `manual`. See [How the board reads GitHub](#how-the-board-reads-github). |

The moves change the shared project from your session, so they start off. A
repo can turn them on for everyone who works in it, in its
`.claude/settings.json`:

```json
{ "pluginConfigs": { "issue-board@astrosteveo-plugins": { "options": { "autoMove": true } } } }
```

Older settings still count for one release. `moveToDone`,
`moveToVerification` or `advanceEpics` set to true turns `autoMove` on, unless
`autoMove` is set. `prRule` set to `closes-when-ticked` keeps
`closesWhenTicked` on, and `always-closes` or `none` turns it off, unless
`closesWhenTicked` is set. The summary under the prompt, the issues after `#`
and the Inbox tab after the views no longer have a setting, and Now is always
the first two priorities.

`/issues check` and `/issues help` list each feature that is off, and why:
the setting that turned it off, or the Status the project has no option for.
Nothing else nags about a feature that is off.

## Fitting an existing project

### Which Status is which

Until a mapping is saved, the board finds the six Status parts by name,
whatever their case:

| Part | Names it goes by |
| --- | --- |
| Inbox | Inbox, Triage, New |
| Ready | Ready, Todo, To do, Up next |
| Backlog | Backlog, Icebox, Later |
| In progress | In progress, Doing, Active, Started |
| Verification | Verification, In review, Review, QA, Testing |
| Done | Done, Shipped, Closed, Complete, Completed |

The board's own name wins, then the list's order. A project with both `Ready`
and `Todo` has `Ready` as Ready. One option never plays two parts. A part
with no option is off: with no Inbox, there is no Inbox tab or triage, and
with no Done, closed issues aren't moved. `/issues check` says which parts are
off.

When a name other than the board's own plays a part, the band shows the guess
once, such as `Status: Todo is Ready, Doing is In progress, Shipped is Done`.
`/issues check` shows it too, until you answer. **Looks right** saves it, and
**Change** opens `/issues statuses`.

`/issues statuses` shows the **Which Status is which** step at the top of the
pane, with the project's own options and **none** for each part. **Save**
keeps the mapping in Claude Code and changes nothing on GitHub, so it doesn't
need write access to the project. A saved mapping, from here or from setup,
always wins over the names. To add a missing option, use `/issues setup`.

### Which labels are Bugs and Later

The board reads the repo's labels and issue types to find what marks a bug,
and, without a project, which label means Later. It tries these names, in
this order, in any case:

| Part | Names |
| --- | --- |
| Bugs | GitHub's Bug issue type, when open issues use it; then the labels `bug`, `type:bug`, `kind:bug`, `bug report`, `defect`; then the Bug type when the repo offers it |
| Later (without a project) | `future`, `later`, `someday`, `icebox` |

A repo with none of the names keeps `bug` and `future`.

When the board finds something other than `bug` or `future`, the band shows
the guess once, such as `Bugs: the label defect · Later: the label someday`.
`/issues check` shows it too, until you answer. **Looks right** saves it, and
**Change** opens `/issues labels`.

`/issues labels` shows **Which labels Bugs and Later go by** at the top of the
pane, with the repo's issue types and labels (not the `area:` ones) to pick
from. **Save** keeps the choice in Claude Code for this repo and changes
nothing on GitHub. A saved choice always wins over the names.

### Setup

`/issues setup` prepares the repo and its project. It lists what it would
change at the top of the pane, and nothing changes until **Apply**. It:

- turns issues on;
- uses the linked project, or creates one;
- adds the board's Status options and a Priority field (P0, P1, P2);
- creates `bug` and `area:` labels (no `bug` where the repo has one of the bug
  labels above);
- puts open issues in the project at Inbox;
- lets the board write to the project.

It never deletes or renames anything.

Under **Which Status is which**, setup asks which of the project's own
options plays each part. It suggests the board's names where the project has
them, and offers to add the ones it lacks. A project that says `Todo`,
`Doing` and `Shipped` picks those instead, and setup adds nothing. Pick
**none** to turn a part off.

### The project's workflows

GitHub's API can't change a project's workflows, so setup lists those to
change by hand, with a link:

- Keep the **Auto-add** workflows on.
- Turn **Item closed** off, but only when the board moves closed issues to
  Done itself: **Move closed issues to Done** is on and a Done option is
  picked. It marks every closed issue Done, so Done would no longer mean
  shipped. Without those, Item closed is what puts closed issues in Done, so
  setup leaves the step out. `/issues check` notes Item closed under the same
  rule, while the board may write to the project.
- Set **Item added to project** to Inbox rather than GitHub's Todo, so new
  issues land in the Inbox.

## Commands

| Command | What it does |
| --- | --- |
| `/issues` | Opens the pane. |
| `/issues help` | Lists every key, subcommand and tool, and what is off. |
| `/issues refresh` | Reads GitHub again and replies with the summary. |
| `/issues new <what>` | Captures an issue from the conversation to the Inbox. See [Adding issues](#adding-issues). |
| `/issues new epic <what>` | Captures an epic and its sub-issues. |
| `/issues setup` | Prepares the repo and its project. See [Setup](#setup). |
| `/issues statuses` | Picks which Status option plays each part. See [Which Status is which](#which-status-is-which). |
| `/issues labels` | Picks what Bugs and Later go by. See [Which labels are Bugs and Later](#which-labels-are-bugs-and-later). |
| `/issues stats` | Says what the board has cost. See [What it costs](#what-it-costs). |
| `/issues check` | Checks what the board needs. See [When something is missing](#when-something-is-missing). |

## Troubleshooting and limits

### When something is missing

The board checks what it needs when a session starts, and again when GitHub
turns a request down:

- `gh` is installed and signed in, and its token works.
- The token has `repo`, and `project` for the repo's GitHub Project.
- You can write to the repo, for ticking boxes and merging.
- The repo isn't archived, and its issues are on.

Without `project` the board still works, from labels, without Status or
Priority.

When something is missing, a `⚠ SETUP` row in the band says what. It has
**Copy command** (such as `gh auth refresh -s repo`), **Open page**, **Check
again**, and `✕` to wave off a problem that only limits the board. The line
under the prompt says `issue board needs setup` or `is limited` meanwhile. A
tool that fails for want of a permission gives Claude the same fix. A folder
whose repo isn't on GitHub stays quiet.

### How the board reads GitHub

The board looks at GitHub every 5 minutes, or as **How often the board reads
GitHub** (`refresh`) says, and every 30 seconds while a pull request's CI
runs. Set to `manual`, it reads only on `/issues refresh`, `r`, and after
Claude's turns that ran `git` or `gh`, and doesn't watch CI either.

A look starts with a cheap check of whether anything changed, which doesn't
count against GitHub's rate limit. It reads in full only when something
changed, and at least every 15 minutes. It also reads straight after Claude
changes GitHub, after a turn that ran `git` or `gh`, and when a GitHub event
arrives for a pull request the session follows.

Ticking a box, rewriting a body and posting a comment go over REST, so they
spend none of the GraphQL limit the board reads with. The card's editor offers
the labels and milestones the last read found, without asking GitHub again.

Sessions on the same repo share the board. The rate limit is shared by every
session and agent on your account. If it runs out, the board says when it
resets and waits.

The board is saved for each repo, so a new session, or `/clear`, shows it at
once and still knows the issue you were on. A board saved by a version whose
saved shape differs isn't shown; the board reads GitHub instead. Your choices,
such as which Status is which and the prompts you turned down, are kept apart
from the saved board.

### What it costs

`/issues stats` says what the board has spent since it loaded, and for its
last full read. Once the board has been loaded 10 minutes, it also gives each
count per hour. Before then it says how long the board has been loaded.

- **GitHub calls**, as REST, REST answered 304 (nothing changed, so free
  against the rate limit), and GraphQL. `gh issue`, `gh pr` and `gh repo view`
  count as GraphQL, since that is what gh uses for them. Each `gh` command
  counts as one call, except `gh run watch`, which counts three REST calls
  each time it draws the run. Each call has a cause: a poll's cheap check, a
  full read, a write, one of Claude's tools, setup, or other.
- **GraphQL points**, added up from the issues query's own rate limit answer,
  with what is left and when it resets.
- **Context**: the characters the board adds to Claude's context, by source,
  and per prompt Claude received. The working, orchestrator and capture notes
  count when they first go into the system prompt and when they change. Issue
  copies, moved lines, news, the prompts the board sends, and its tools'
  answers count each time.
- **Tool definitions**, on their own line: the size of all the board's tools,
  and how many are loaded so far. Claude Code defers the board's tools, so
  only their names are in context until a tool is loaded. A tool's definition
  counts once: when Claude Code lists it in the prompt, when ToolSearch finds
  it, or when Claude first calls it.

The counts stay in memory. A reload starts them over.

### Limits

- Up to 300 open issues and 50 open pull requests.
- A repo with issues turned off shows only pull requests.
- It reads the first open project linked to the repo, or the one
  `/issues setup` chose.
- Searches read up to 30 results, and project reads the first 100 items. The
  answer says when there are more.
- The line under the prompt shows in the terminal only. The mobile app has no
  text fields, so there is no search or typed editing there.
- The pane opens only when you run `/issues`.
