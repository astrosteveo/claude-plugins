# Issue Board

A Claude Code mod that brings a repository's GitHub issues, pull requests and
GitHub Project into the terminal: a pane to see and change them, a band above
the prompt for what needs you, and tools that let Claude run the project with
you.

It needs Claude Code v2.1.292 or later, and the `gh` CLI signed in, in the
folder the session started in. Mods are an early access part of Claude Code:
their API may change between releases, and a release may break the board
until it is updated.

## Quick start

1. Run `/issues` to open the pane.
2. Run `/issues setup` once if the repo has no GitHub Project yet. It shows
   what it would change and waits for **Apply**. The board only reads a
   project until you let it write there; see
   [Letting the board write to a project](#letting-the-board-write-to-a-project).
3. Press Enter on an issue, then **▶ Start** to hand it to Claude.

`/issues help` lists every key, subcommand and tool. `/issues check` says
what the board is missing, if anything.

## See what's open

The line under the prompt sums up the board in dim text, such as
`? for shortcuts · 35 issues · 1 bug · PR #335✓`. It shows nothing when
nothing is open.

Type `#` in the prompt box to pick an open issue or pull request from the
board. `#12` matches by number (#12, #120…), and `#dock` matches titles with
"dock" in them. Each row shows the title, and the Status, Priority and labels,
or the CI state for a pull request. Issues in progress come first, then pull
requests, then Ready, Verification, Backlog and Inbox, each by priority. It
shows 8 rows at most, and reads no more of GitHub than the board already has.

`/issues` opens the pane. From the top:

- **The header**: the repo, its open issues, bugs, pull requests and failing
  CI, and when it last synced. A wide pane adds how many boxes are ticked,
  and sparklines of issues closed and pull requests merged each week over
  12 weeks, such as `closed ▁▂▅▃▇█▁▂▅▃▇█ 41`.
- **The project's status update**, when it has one, such as
  `◉ At risk · Docking slipped. · target 2026-10-20 · 2h ago`, colored by
  how it stands.
- **Milestones**: each open milestone with a bar of its closed issues and
  its due date, red once it's past due with issues still open.
- **Pull requests**: see [Pull requests and CI](#pull-requests-and-ci).
- **Issues**, with their filters: `1` Now (the first two Priority options,
  P0 and P1, unless set otherwise), `2` Later (the rest), `3` Bugs, `4` Mine, `5` All, `6` Inbox (with a project that has one) and `7`
  Closed. Closed lists the issues closed lately, each with how it closed,
  read from GitHub when you choose it. Without a project, `1` and `2` read
  Active and Future, from the repo's later label. Bugs, the `▲` badge and
  the bug count go by the repo's bug label or issue type: see
  [Which labels are Bugs and Later](#which-labels-are-bugs-and-later).
  When the project has views
  with filters, those views are the tabs instead: see
  [The project's views as tabs](#the-projects-views-as-tabs).

Press the **Milestones** or **Pull requests** heading to fold its section to
one line, such as `Launch 5/7` or `3 open · ✓ 2 · ✗ 1`. On a pane shorter
than 24 rows they start folded, so the issues show first. The board
remembers how you leave them.

The search field after the filters keeps the issues whose title, number or
labels hold every word you type. **by Status**, **Epic** or **Area** groups
them. The Backlog starts folded; press it to open it. `r` refreshes.

Each issue is one row: its priority, number and title, then, at the right,
its background agent, its pull request with CI (`⇄ #51 ✓`), its labels in
their colors, a bar of its boxes (`━━━ 2/4`) and how long since it changed.
A narrow pane drops the labels, then the bar, then the age, so the row stays
on one line. Within a group, rows follow the project's own order, the one
you set by dragging items on GitHub. The board reads it with the issues, at
no extra cost. Issues the project doesn't hold come after, in the board's
order: the most pressing priority first, then bugs (`▲`), then work under
way, then the newest. Without a project, the whole list is in the board's
order. An issue waiting on an open one shows `⛔ #N`.

Hover a row to preview its open boxes. The preview opens above the row, so
the rows above stay clear for the pointer. Near the top of the pane it lists
fewer boxes, and a row with no room above shows none.

**Epics** are parent issues with GitHub's sub-issues. Grouped by Epic, each
heading has a bar of its sub-issues closed, such as `6/12 closed`, and
**▶ Next**, which starts Claude on the first one nothing blocks. Sub-issues
keep the epic's order, not the project's: they follow GitHub's sub-issue
order where priority and blockers don't decide.

An epic can move along with its sub-issues. This is off by default; turn on
**Move epics with their sub-issues** (`advanceEpics`) to have it:

- Starting a sub-issue moves its epic to In progress, if the epic is still in
  the Inbox, Backlog or Ready. An epic that is further along stays put.
- When the last open sub-issue closes, the board ticks the epic's "Every
  sub-issue is closed" box. If every box is then ticked, it closes the epic
  as completed and moves it to Done. If other boxes are still open, it moves
  the epic to Verification, and the band and the next prompt say how many.
- A sub-issue that reopens, or a new one under a closed epic, shows in the
  band. The board doesn't reopen or move anything for it.

These epic lines come last in the band and clear themselves once they no
longer apply. A Verification line goes when the epic closes or every box is
ticked. A line about a sub-issue goes when the sub-issue closes or leaves the
epic, or when the epic closes or reopens, whichever ends what it reports. Any
epic line goes after 24 hours. Press **✕** to dismiss one sooner.

Every new epic, from `/issues new epic` or `issue_create` with sub-issues, is
filed with the "Every sub-issue is closed" box.

### The project's views as tabs

A team that keeps views in its GitHub Project gets them in the pane. Each
table or board view with a filter becomes a tab, named and ordered as on
GitHub, on keys `1` to `7`. **All** and **Closed** come after them. A view
needs a filter to become a tab: a view with none, such as GitHub's own
"View 1", shows every issue, which All already does. Roadmap views are left
out, and so are views past the seventh. A project with no filtered views
keeps the built-in tabs.

A tab shows the open issues its view's filter keeps, from the board's own
copy, with no extra GitHub request. The board knows these terms:

- `status:`, `priority:`, `label:`, `assignee:` (with `@me`), `milestone:`
  and `type:` (the issue type).
- Any project field by name, such as `area:Engine` or
  `"story points":3`. A hyphen can stand for a space: `story-points:3`.
- `no:` and `has:` with any of those, such as `no:assignee` or `no:status`.
- `is:open` and `is:issue` keep every issue on the board. `is:closed` and
  `is:pr` keep none, since the board holds open issues.
- `-` before any term to negate it, quotes around values with spaces, and
  comma lists for any of several values, such as `label:bug,docs`.
- Plain words match the title, and a number matches the issue.

A term it doesn't know, such as `updated:>@today-7d`, a range or a
wildcard, is left out. The tab then shows a note naming the term, with
**↗ Open the view** to see it on GitHub. The tab may list more than the view
does, never less.

A tab groups its issues the way the view does, when the board can: by
Status (a board view's columns), by epic for Parent issue, or by another
field such as Area, which then shows among the **by** buttons. Pick another
grouping any time. A view grouped by labels or assignees, which an issue
can have several of, keeps the pane's grouping.

The board reads the views with the issues. When a view filters or groups by
a field beyond Status and Priority, it reads that field's values for each
issue too. A new or changed view that names such a field costs one extra
read the first time. The band, the hint line and **▶ Next** go by the
issues, not the tab.

To keep the built-in tabs, set **Where the pane's tabs come from**
(`filters`) to `board`. The default is `views`.

## Work on an issue

Press Enter on an issue, or click it, to open its card: its labels,
assignees, epic, milestone, type and open blockers, a row each of **Status**
and **Priority** buttons, the project's other fields that have a value, its
text, and its boxes. One card is open at a time. Press a box to tick it on
GitHub. The card shows the latest three comments, a field to reply, and
**Ask Claude to answer**, which hands Claude the last one.

- **▶ Start** (`s`) sends Claude the issue with its open boxes, and makes a
  task for each box. The issue moves to In progress and is assigned to you.
  The button then says `▶ Started`, so it can't send the issue twice.
- **⚙ Start in background** (`b`) starts the board's agent,
  `issue-board:worker`, on the issue itself. Claude is sent no message, so
  the issue's text stays out of the conversation. The issue moves to In
  progress and is assigned to you once the agent starts. The agent works in
  its own git worktree, ticks boxes, and opens a pull request, without
  merging or force-pushing. The row shows the agent: `⚙ working`,
  `waiting`, `done`, `failed` or `stopped`. When it ends, the conversation
  says so, with its last answer and pull request, and Claude is handed the
  same so it can follow up. Claude gets the first 1,000 characters of the
  answer; the pull request holds the rest. It asks for permission as any background agent
  does. When the start is refused or fails, a toast says why and the button
  comes back.
- On an epic's card, both Starts act on its first ready sub-issue, as
  **▶ Next** does, and the buttons name it, such as `▶ Start #185`. An epic
  is worked one sub-issue at a time. When every open sub-issue is blocked,
  Start says so in a toast and sends nothing. When every sub-issue is
  closed, Start starts the epic itself, so you can finish its own boxes.
- **✎ Edit first** (`e`) puts Start's message in the prompt box to edit,
  so you can add your own instructions at the bottom. When you send it and
  it still names the issue, the board does what Start does: it tracks the
  issue, makes its tasks, moves it to In progress and assigns it. Rewritten
  so it no longer names the issue, it is sent as a plain prompt. With issue
  copies on, the message only names the issue, and the issue's copy goes
  with it, fresh even when an earlier prompt carried one. With copies off,
  it lists the open boxes itself, as Start's message always does.
- **✎ Edit first in background** puts a message in the prompt box instead,
  asking Claude to dispatch the agent with Start's message as its prompt.
  Lines you add go in the agent's prompt, since the agent can't ask you
  anything. Sending it asks Claude to dispatch the
  agent, and the row follows the agent as it does for Start in background.
- On an epic's card, both Edit first buttons follow the same sub-issue as
  Start.
- While a background agent works on the issue, the card shows it in place of
  both Starts and both Edit first buttons, such as
  `⚙ Worker on it · working 4m`. That holds whether Start in background or
  Claude started the agent. On an epic's card it names the sub-issue, such as
  `⚙ Worker on #185`. The buttons come back when the agent ends.
- **⚙ Change** opens the editor; see [File and plan issues](#file-and-plan-issues).
- **↗ GitHub** opens the issue. **Collapse** (`x` or Esc) folds the card.
  With nothing open, Esc closes the pane.

### Start in the main chat or in the background

The **Where Start works** setting (`startMode`) picks the card's first
Start.

- `main`, the default, is what the list above says. Claude works on the
  issue in this chat.
- `background` makes Claude an orchestrator. **⚙ Start in background**
  comes first and takes `s`. **✎ Edit first in background** takes `e`.
  **▶ Start** is still there, on `b`. The working note in the system
  prompt tells Claude to hand each issue to `issue-board:worker` and to do
  only small changes itself, such as a one-line fix or a typo in the docs.
  When a worker ends, Claude reviews its pull request, runs the
  repository's checks, watches CI, and then merges it or tells you what is
  left. It merges only if your own rules let it.

Workers that change the same files get in each other's way, and each
pull request then conflicts with the one merged before it. In a repository
where most changes touch one big file or a version field, as this one's
plugins do, run one worker at a time, unless their issues touch separate
areas.

The issue this session is on has `▶` on its row and `✕` to stop tracking
it. It's the one you pressed Start on, the one Claude started on when you
asked in the conversation, or, with its setting on, the one whose branch is
checked out: a branch such as `fix/315-glide`, `315-glide` or `issue-315`
counts. Only the main session's checkouts count, not a background agent's.

While Claude is on it:

- A short note in the system prompt names it, and tells Claude to tick boxes
  as it finishes them. Its PR rule setting can also tell Claude to write
  `Closes #N` in the pull request only when every box is ticked, `Refs #N`
  otherwise, or always `Closes #N`. The note survives compaction.
- The next prompt carries what changed on GitHub since: boxes, new comments,
  CI on its pull request, or the issue closed. Claude's own changes aren't
  news.
- With its setting on, after each turn the prompt box suggests the next step,
  such as `Open a PR for #N` once every box is ticked. Tab takes it.

A prompt that names `#123` carries the board's copy of that issue or pull
request for Claude, unseen. A copy goes once per session. Naming the issue
again sends it again only when the issue, or a pull request for it, changed
since. After a compaction or `/clear`, the next prompt that names it sends it
again. A prompt carries up to three copies, and names any more in one line. A
copy carries the first 2000 characters of the issue's text and says when it was
cut.

**The band above the prompt** speaks up only for what needs you: CI that
fails (**Fix** hands it to Claude), CI that passes (**Finish & merge**), news
on the issue you started, its closing, a task Claude finished whose box is
still open (**Tick box N**), and background agents at work. `✕` waves an
alert off until it happens again.

## Pull requests and CI

Each open pull request is a row: its CI (`✓ PASS`, `✗ FAIL`, `◷ CI`), title,
the issue it is for (`→ #38`), its review, and `◆` on the branch you have
checked out. A `⚙` after its number means a background agent is still on
the issue it is for, and may push to its branch. It says why it can't merge yet: `⚠ conflicts`, `↓ behind`,
open review threads, and who is asked to review. At the right are its diff
counts (`+120 −40`) and **Finish & merge**. Press the title for its details.

A pull request's row stays on one line. Its number, CI, linked issue and
counts never break across lines; the title is cut with `…` instead. A narrow
pane drops parts in this order: who is asked to review, open threads, the
diff counts, the linked issue, the merge note and the review mark. Last,
**Finish & merge** becomes **Merge**. The band's lines work the same way:
their badge, number and buttons keep their width, and the text is cut.

- **Finish & merge** sends Claude to see it through: fix CI, answer review,
  and merge, without bypassing branch protection or force-pushing. While a
  background agent owns the branch, or CI is still running or failing, it
  asks first and says why. **Close out anyway** sends it, **Cancel** doesn't.
- **⇶ Merge all** (`m`) does the same for every open pull request, oldest
  first, after asking: `y` to send, `n` to cancel.

While CI runs on your branch, a `◷` row shows its progress, such as
`validate › Install Claude Code`, until it ends.

## File and plan issues

- `/issues new <what>` drafts an issue from the conversation: a title, a
  body with an `## Acceptance` list, and labels the repo uses. It waits at
  the top of the pane. **✎ Edit** (`e`) changes it, **Create issue** (`c`)
  files it into the project's Inbox, and **Discard** drops it.
- `/issues new epic <what>` drafts a parent and the sub-issues that finish
  it, and files them together. The parent gets an "Every sub-issue is
  closed" box.

**⚙ Change** on a card opens its editor. Each change is made on GitHub at
once. Its rows go by what they're for:

- What it is: **Title**, **Boxes** (type one to add it; **✎ Edit the body
  with Claude** for more) and **Labels** (press to add or take off; type in
  **+ new label** to make one, an `area:` label in the areas' color).
- Where it sits: **Epic** (type a number to put it under one, or take it
  out).
- Who has it: **Assignee**.
- Ending it: **Close** as completed or not planned. Closing an epic with
  open sub-issues takes a second press.

**▾ More** opens the rarer rows in place: **Type** (where the repo's
organization has types), **Milestone**, the project's other fields (an
iteration or option is a button; a number, date or text is a field;
**clear** takes one off), and closing **as duplicate of #**, which GitHub
links.

**Inbox** (`6`) is for triage: issues with Status Inbox or none. Claude
suggests a Priority, an `area:` label and Ready or Backlog for each, with a
reason. Change any pick, then **✓ Accept**.

## Keep the project up to date

Status and Priority come from the repo's GitHub Project, set from the card,
by Start, or by Claude.

### Which Status is which

The board gives six Status options a part each: Inbox, Ready, Backlog (the
one that folds), In progress, Verification and Done. Until a mapping is
saved, it finds them by name, whatever their case:

| Part | Names it goes by |
| --- | --- |
| Inbox | Inbox, Triage, New |
| Ready | Ready, Todo, To do, Up next |
| Backlog | Backlog, Icebox, Later |
| In progress | In progress, Doing, Active, Started |
| Verification | Verification, In review, Review, QA, Testing |
| Done | Done, Shipped, Closed, Complete, Completed |

The board's own name wins, then the list's order: a project with both
`Ready` and `Todo` has `Ready` as Ready. One option never plays two parts.
A part with no option is off, and `/issues check` says so.

When a name other than the board's own plays a part, the band shows the guess
once, such as `Status: Todo is Ready, Doing is In progress, Shipped is Done`.
`/issues check` shows it too, until you answer. **Looks right** saves it, and
**Change** opens `/issues statuses`.

`/issues statuses` shows only the **Which Status is which** step, at the top
of the pane, with the project's own options and **none** for each part.
**Save** keeps the mapping in Claude Code and changes nothing on GitHub, so it
doesn't need the board to be let write to the project. A saved mapping, from
here or from setup, always wins over the names. Adding a missing option stays
in `/issues setup`.

### Which labels are Bugs and Later

The board reads the repo's labels and issue types to find what marks a bug,
and, without a project, which label means Later. It tries these names, in
this order, in any case:

| Part | Names |
| --- | --- |
| Bugs | GitHub's Bug issue type, when open issues use it; then the labels `bug`, `type:bug`, `kind:bug`, `bug report`, `defect`; then the Bug type when the repo offers it |
| Later (without a project) | `future`, `later`, `someday`, `icebox` |

With a project, Later goes by Priority, so no label is needed for it. A repo
with none of the names keeps `bug` and `future`.

When the board finds something other than `bug` or `future`, the band shows
the guess once, such as `Bugs: the label defect · Later: the label someday`.
`/issues check` shows it too, until you answer. **Looks right** saves it, and
**Change** opens `/issues labels`.

`/issues labels` shows **Which labels Bugs and Later go by** at the top of the
pane, with the repo's issue types and labels (not the `area:` ones) to pick
from. **Save** keeps the choice in Claude Code for this repo and changes
nothing on GitHub. A saved choice always wins over the names.

- With its setting on, an issue that closes as **completed** moves to Done
  at the board's next read, wherever it closed. One closed as not planned or as a duplicate
  stays where it was, so Done means shipped.
- With its setting on, an issue a merged pull request names with `Refs #N`
  moves to Verification: merging didn't finish it. Claude's next prompt says so.
- With its setting on, an epic moves along with its sub-issues, and closes
  when the last one closes and its boxes are ticked. See
  [See what's open](#see-whats-open).
- Each time the board moves issues on its own, a toast says which and why,
  such as `Moved #43 to Done: it closed as completed.` A move GitHub refuses
  says so once.

For Done to mean shipped, turn off the project's own **Item closed**
workflow, which marks every closed issue Done. Keep the **Auto-add**
workflows on. `/issues setup` advises both, and `/issues check` notes Item
closed while it's on.

Claude closing an epic with open sub-issues through `gh issue close` asks you
first, whatever your rules allow. A background agent is refused instead, and
told to deal with the sub-issues first.

## What Claude can do

The board gives Claude nine tools:

- `issues` reads: the board's list, one issue in full with its boxes,
  fields and latest ten comments, any issue by number even closed, a search
  of every issue (`state`, `search`, `label`, `assignee`, `milestone`), the
  project's issues at a Status (`status`, `since`), and the open milestones
  (`milestones`). It never asks for permission.
- `tick` ticks or unticks boxes, reading the body fresh first.
- `issue_update` changes an issue: Status, Priority, title, body, boxes
  (`addBoxes`, `rewordBoxes`), labels, assignees, epic and its order among
  siblings (`moveBefore`, `moveAfter`), its place in the project's order
  (`projectAfter`, an issue's number or 0 for the top), milestone, type, the project's
  fields (`fields`), blocked-by links, pin, lock, transfer to another of the
  owner's repos, a comment, and closing, as a duplicate too. `start` marks
  that Claude started on it here, as Start does; on an epic it starts the
  next ready sub-issue and says which one, or the epic itself once every
  sub-issue is closed. It sets the Status,
  Priority and fields of a closed issue too, such as one a merge just
  closed, and says when one is already at the Status asked for.
- `issue_create` files an issue, or an epic with its sub-issues, with
  labels, assignees, milestone, epic, type, blocked-by links, Status and
  Priority. A label the repo hasn't got is made first.
- `milestone` makes or changes a milestone by title: due date,
  description, rename, close or reopen.
- `project_status` reads the project's status update, or posts one.
- `project_archive` archives project items: one issue's, or every one at
  Done that closed before a date. It lists them first and archives on a
  second, confirmed call.
- `project_adopt` lets the board write to a project, or releases it, only
  when you ask. It always asks first; see
  [Letting the board write to a project](#letting-the-board-write-to-a-project).
- `project_plan` proposes many changes, to issues, the repo's labels and the
  project's views, as one plan; see
  [Plans](#plans).

Each tool that changes something goes through Claude Code's permission
check before it touches GitHub, as any tool does. If you say no, or a rule
denies it, nothing changes. Some calls don't ask, because they are part of
work you started or change nothing: ticking boxes, moving the Status of
your issue, `start`, listing what an archive would take, and reading the
status update. A rule that denies them still stands, and so does an
organization's rule that requires asking. A transfer from a public repo to
a private one, which GitHub won't undo, needs a second, confirmed call.

### Plans

Ask Claude to "prioritize my backlog" or "rank the Ready issues", and it can
propose the whole change as one plan with `project_plan`, instead of one
`issue_update` and one permission prompt per issue. Each change in a plan
has a short reason. A plan can set Status, Priority and other project
fields, add and remove labels and assignees, set the milestone and the epic,
and move an issue in the project's order (`projectAfter`).

A plan can also change the repo's labels, in its `labels` list: create one
with a name, color and description, rename it, recolor it or change its
description, or delete it. Label changes come first on the card, under
*The repo's labels*, so an issue in the same plan can take a label it makes.

- A delete row says how many open and closed issues carry the label, from
  GitHub's search counts, or that it couldn't count them.
- A rename keeps the label on its issues, as GitHub does. The board shows
  the new names after the plan applies.
- If the label is one your saved Bugs or Later marker goes by (see
  `/issues labels`), the row says so. A rename moves the marker to the new
  name, and a delete clears it, so the board guesses it again.
- Label changes are repo writes. They go through the permission prompt but
  don't need the board to be allowed to write to the project.
A plan can also change the project's views, in its `views` list:

- **Create** a view with a name, a layout (table, board or roadmap; table
  by default) and a filter.
- **Change** a view's name, layout or filter. Name the view by its number
  or its name.
- **Delete** a view with `delete: true`. Its row names the view and its
  filter, so you can see what goes.

A filter is checked with the same parser the tabs use. A term the board
can't apply, such as `sprint:@current`, is allowed, but its row says so:
the view's tab will leave that term out and show more issues than GitHub
does. After Apply the board reads the views again, so new and changed views
with a filter show as tabs in `/issues`, and deleted ones go.

The board checks the whole plan first: the issues are open on the board, the
options, fields and milestones exist, and the board may write to the
project. If anything is wrong, it refuses the plan and lists every problem
at once, and nothing is shown or asked.

A valid plan shows at once as a card at the top of `/issues`, and the band
shows a `✦ PLAN` line with **Review**, which opens the pane:

- The card has one row per change: label changes first, then the changes
  grouped by issue, then view changes under the project's name. Each row has a box to tick and Claude's
  reason. All rows start ticked.
- **Apply** writes the ticked rows in order, then reads GitHub once. Rows
  that went through leave the card, and so do unticked ones. A row that
  failed stays, with why, so you can try it again or discard it.
- **Discard** drops the plan. A new plan from Claude replaces the old one.

Claude's call asks permission once, with the plan summed up by kind, such as
`Status 3 · Priority 2 · order 4`. Saying yes applies the plan, so you can
approve it from the phone app without the pane. Saying no changes nothing
and leaves the plan on the card, to apply in part or discard. Every project
write goes through the same write check as the other tools, so a project
the board only reads refuses the plan. In auto or bypass mode, where you
would not see the prompt, Claude's call is refused, and the plan waits on
the card for you to apply.

## Commands

- `/issues` opens the pane.
- `/issues help` lists what the board does.
- `/issues refresh` reads GitHub again and replies with the summary.
- `/issues new <what>` and `/issues new epic <what>` draft issues.
- `/issues statuses` picks which Status option plays each part; see
  [Which Status is which](#which-status-is-which).
- `/issues labels` picks the label or issue type Bugs goes by, and the label
  Later goes by without a project; see
  [Which labels are Bugs and Later](#which-labels-are-bugs-and-later).
- `/issues setup` prepares the repo and its project. It lists what it
  would change at the top of the pane, and nothing changes until
  **Apply**: it turns issues on, uses the linked project or creates one,
  adds the board's Status options (Inbox, Backlog, Ready, In progress,
  Verification, Done) and a Priority field (P0, P1, P2), creates `bug` and
  `area:` labels (no `bug` where the repo has one of the bug labels above), and puts open issues in the project at Inbox. It never
  deletes or renames anything.
- Under **Which Status is which**, setup asks which of the project's own
  options plays each part: Inbox, Ready, Backlog (the one that folds), In
  progress, Verification and Done. It suggests the board's names where the
  project has them, and offers to add the ones it lacks. A project that says
  `Todo`, `Doing` and `Shipped` picks those instead, and setup adds nothing.
  Pick **none** to turn that part off: with no Inbox, there is no Inbox
  filter or triage; with no Done, closed issues aren't moved.
- GitHub's API can't change a project's workflows, so setup lists those to
  change by hand, with a link: the Auto-add workflows on, **Item closed**
  off, and **Item added to project** set to Inbox rather than GitHub's Todo,
  so new issues land in the Inbox.
- `/issues stats` says what the board has cost; see
  [What it costs](#what-it-costs).
- `/issues check` checks what the board needs; see [Permissions](#permissions).
  It also lists each feature that is off, and why: the setting that turned it
  off, or the Status the project has no option for. `/issues help` lists
  them too. Nothing else nags about a feature that is off.

## Letting the board write to a project

The board reads any project linked to the repo, but writes to one only after
you adopt it. Until then the project is read-only to the board, whatever the
settings below say.

The projects the board may write to are a setting, **Projects the board may
write to** (`writeProjects`): projects as `owner/number`, split by commas,
such as `astrosteveo/9, astrosteveo/8`. A project has the same name in every
repo, so one list in your own settings covers all your repos. In a repo, the
board writes only to a listed project that is the one it reads there, or one
linked to the repo. Empty, the default, means the board only reads. You can
change it in `/config`, where it is a text row. The buttons and the tool
below add and remove projects for you. A list such as `["astrosteveo/9"]`,
which earlier versions used, no longer fits the setting, and Claude Code may
refuse to load the board with one. Change it to the text form.

A repo's `.claude/settings.json` can set `writeProjects` too, for everyone
who works in it:

```json
{ "pluginConfigs": { "issue-board@astrosteveo-plugins": { "options": { "writeProjects": "astrosteveo/9" } } } }
```

The board reads the repo's `.claude/settings.json` and
`.claude/settings.local.json` itself, so a project they grant counts even
when Claude Code's merged value doesn't carry it. It also reads your own user
settings, so a repo's file can't hide your list. A project the repo grants
gets no prompt, and Release can't take it away: `/issues setup` says so where
Release would be, and `project_adopt` refuses. To release it, edit the repo's
file. Adopting writes only your own list to your settings, never the repo's
projects.

While the board reads a project it may not write to, the pane asks once:
**Let the board write to Void Sector, owned by astrosteveo?** It says what
the board would write: Status and Priority, adding issues as items,
archiving items when asked, and status updates. It says these are GitHub API
calls made with your `gh` token, and how often the board reads GitHub (the
`refresh` setting). The band shows a short line with **Review**, which opens
the pane.

- **Let it write** adopts the project for this repo. So does **Apply** in
  `/issues setup`, whose plan says *Let the board write to …*. A project
  setup creates is adopted as it is made.
- **Keep read-only**, or `✕` on the band's line, puts the question away for
  that project. `/issues setup` can still adopt it.
- `/issues setup` shows which project the board may write to, with
  **Release** to make it read-only again. Release takes only that project
  off the list. Projects for other repos stay.
- Claude can adopt or release a project when you ask it to, with the
  `project_adopt` tool, for example from Remote Control or the phone app.
  It adopts the project the board reads, or another linked to the repo by
  number, and refuses any other. It always shows a permission prompt with
  the same warning as the pane, even if a rule allows the tool. Saying no
  changes nothing. A background agent is refused, and so is a session in
  auto mode, where a classifier would answer the prompt instead of you, or
  in bypass mode, where nothing asks.
- Adopting adds the project to the list and keeps the others.
- Adopting or releasing counts at once in the session that did it. Other
  sessions already open see the change by the next time they load the board:
  after `/reload-plugins`, or in a new session.
- A board from before this kept the adopted project in its store. Once this
  board has read that project, it adds it to the list, once. A repo whose
  saved setup names a project counts as having adopted it, so a board set up
  before adopting existed keeps working.

What stays the same without an adopted project:

- Every read: the pane, the band, the filters, Status and Priority as the
  project has them.
- Changes to issues themselves: Start still tracks the issue and assigns it
  to you, boxes still tick, an epic still closes when its last sub-issue
  does, issue_create still files the issue, and triage's Accept still
  changes the `area:` label.
- What doesn't happen: Start, triage's Accept and the moves a read makes
  leave the project's Status and Priority alone, and new issues aren't added
  as items. Accept says it skipped them, and the issue stays in the Inbox. A tool asked to change the project, such as issue_update with a
  Status or project_status posting an update, is refused, and the refusal
  says why and how to adopt the project. `/issues check` and `/issues help`
  list it under Off.

Every project write goes through one check: your `writeProjects` and the
repo's together. The prompt, setup and `project_adopt` use the same check. A
write to any other project is refused.

The setting lives in Claude Code's settings, not in the board's store, which
every session on the repo rewrites. So a session still running an older board
can't take away what you let the board write to. The prompts you turned down
and the Status mappings you saved are kept apart from that store too.

## What the board changes, and how to turn it off

Change these in Claude Code's `/config`, under the issue board. The setting's
key is what `.claude/settings.json` takes.

On GitHub, by itself (project changes only in a project you let the board
write to):

| What | Setting | Default |
|---|---|---|
| An issue closed as completed moves to Done in the project. | Move closed issues to Done (`moveToDone`) | off |
| An issue a merged pull request names with `Refs #N` moves to Verification. | Move to Verification on a Refs merge (`moveToVerification`) | off |
| An epic moves with its sub-issues: to In progress when one starts, and closed and Done, or Verification, when the last one closes. | Move epics with their sub-issues (`advanceEpics`) | off |
| Start, and Claude starting on an issue, assign it to you and move it to In progress. | Start assigns and moves the issue (`claimOnStart`) | on |

How Start works:

| What | Setting | Default |
|---|---|---|
| `main` starts an issue in this chat. `background` makes Start in background the card's first button, on `s`, and the working note tells Claude to hand issues to workers and see their pull requests through. See [Start in the main chat or in the background](#start-in-the-main-chat-or-in-the-background). | Where Start works (`startMode`) | `main` |

In Claude's prompts and the prompt box:

| What | Setting | Default |
|---|---|---|
| While Claude is on an issue you started, a note in the system prompt names it and says how to tick its boxes. In `background` start mode it also tells Claude to work as an orchestrator. | Working note in the system prompt (`workingNote`) | on |
| The note tells Claude how to name the issue in a pull request: `closes-when-ticked` (`Closes #N` only when every box is ticked, `Refs #N` otherwise), `always-closes`, or `none`. Start in background follows it too. | Working note's pull request rule (`prRule`) | `none` |
| A prompt that names `#123` carries the board's copy of it, unseen. | Copies of issues a prompt names (`issueCopies`) | on |
| Typing `#` in the prompt box offers the board's open issues and pull requests, by number or title. | Suggest issues after # (`hashSuggestions`) | on |
| After Claude's turn, the prompt box suggests the board's next step in place of Claude Code's own. | Suggest the next step (`suggestNextStep`) | off |
| Checking out a branch named for an issue makes it the one Claude is on. | Follow the branch (`followBranch`) | off |

On screen, and how often it reads GitHub:

| What | Setting | Default |
|---|---|---|
| The band above the prompt raises what needs you: CI, news on your issue, boxes to tick, background agents. | Band above the prompt (`band`) | on |
| The line under the prompt ends with the board in a few words. A problem the check found shows either way. | Summary under the prompt (`hintSummary`) | on |
| The board looks at GitHub every 5, 15 or 60 minutes, or `manual`: only on `/issues refresh`, `r`, and after Claude's turns that ran git or gh. While a pull request's CI runs it still looks every 30 seconds, unless set to `manual`. | How often the board reads GitHub (`refresh`) | `5` |

Two more have no setting:

- The next prompt notes what changed on GitHub to the issue Claude is on.
  Press `✕` on its row to stop tracking it.
- Claude Code doesn't ask before the board's reads, ticking boxes, moving the
  Status of the issue you started, or listing what an archive would take.
  Every other change the board's tools make asks first, as any tool does,
  and a no changes nothing. See
  [What Claude can do](#what-claude-can-do).

One more setting changes no behavior, only the filters: **Priorities that
count as Now** (`nowCount`, default 2) is how many of the project's first
Priority options the Now filter shows, and triage sends to Ready. The rest
are Later. **Where the pane's tabs come from** (`filters`, default `views`)
picks the project's views or the built-in tabs; see
[The project's views as tabs](#the-projects-views-as-tabs).

The moves change the shared project from your session, so they start off.
The PR rule is a repo's own convention, so it starts at none. A repo can set
these for everyone who works in it, in its `.claude/settings.json`:

```json
{ "pluginConfigs": { "issue-board@astrosteveo-plugins": { "options": { "moveToDone": true, "moveToVerification": true, "advanceEpics": true, "prRule": "closes-when-ticked" } } } }
```

## How it reads GitHub

The board looks at GitHub every 5 minutes, or as its setting says, and
every 30 seconds while CI runs. A look starts with a cheap check of whether anything changed, which
doesn't count against GitHub's rate limit. It reads in full only when
something changed, and at least every 15 minutes. It also reads straight
after Claude changes GitHub, after a turn that ran `git` or `gh`, and when a
GitHub event arrives for a pull request the session follows.

Sessions on the same repo share the board, and the rate limit is shared by
every session and agent on your account. If the limit runs out, the board
says when it resets and waits.

The board is saved for each repo, so a new session, or `/clear`, shows it at
once and still knows the issue you were on.

### What it costs

`/issues stats` says what the board has spent since it loaded, and for its
last full read. Once the board has been loaded 10 minutes, it also gives
each count per hour. Before then it says how long the board has been loaded,
since a rate scaled up from a few seconds says little.

- **GitHub calls**, as REST, REST answered 304 (nothing changed, so free
  against the rate limit), and GraphQL. `gh issue`, `gh pr` and
  `gh repo view` count as GraphQL, since that is what gh uses for them. Each
  `gh` command counts as one call, save `gh run watch`, which counts three
  REST calls for each time it draws the run. Each call has a cause: a poll's cheap
  check, a full read, a write, one of Claude's tools, setup, or other.
- **GraphQL points**, added up from the issues query's own rate limit
  answer, with what is left and when it resets.
- **Context**: the characters the board adds to Claude's context, by
  source, and per prompt Claude received. The working and orchestrator
  notes count when they first go into the system prompt and when they
  change. Issue copies, moved lines, news, the prompts the board sends, and
  its tools' answers count each time.
- **Tool definitions**, on their own line: the size of all the board's
  tools, and how many are loaded so far. Claude Code defers the board's
  tools, so only their names are in context until a tool is loaded. A tool's
  definition counts as context once: when Claude Code lists it in the
  prompt, when ToolSearch finds it, or when Claude first calls it.

The counts stay in memory. A reload starts them over.

The tests hold the board to a budget, so a change that adds calls fails CI:

| What | REST | REST 304 | GraphQL |
| --- | --- | --- | --- |
| A refresh | 1 | 1 | 3 |
| Start | 0 | 0 | 3 |
| `issue_update` setting a Priority, with the refresh after it | 1 | 1 | 4 |
| Setup's Apply on a fresh repo, with the refresh after it | 7 | 0 | 16 |
| An idle hour, at the 5-minute setting | 4 | 12 | 14 |

Start adds at most 600 characters to Claude's context: the start message and
the working note.

## Permissions

The board checks what it needs when a session starts, and again when GitHub
turns a request down:

- `gh` is installed and signed in, and its token works.
- The token has `repo`, and `project` for the repo's GitHub Project.
- You can write to the repo, for ticking boxes and merging.
- The repo isn't archived, and its issues are on.

Without `project` the board still works, from labels, without Status or
Priority.

When something is missing, a `⚠ SETUP` row in the band says what, with
**Copy command** (such as `gh auth refresh -s repo`), **Open page**,
**Check again**, and `✕` to wave off a problem that only limits the board.
The line under the prompt says `issue board needs setup` or `is limited`
meanwhile. A tool that fails for want of a permission gives Claude the same
fix. A folder whose repo isn't on GitHub stays quiet.

Two tools need you to read their prompt, so they refuse in auto and bypass
mode, where no prompt reaches you: `project_adopt` and `project_plan`.
Switch to a mode that asks, or use the pane: **Let it write** to adopt a
project, or **Apply** on the plan card.

## Limits

- Up to 300 open issues and 50 open pull requests.
- A repo with issues turned off shows only pull requests.
- It reads the first open project linked to the repo, or the one
  `/issues setup` chose.
- Searches read up to 30 results, and project reads the first 100 items;
  the answer says when there are more.
- The line under the prompt shows in the terminal only, and the mobile app
  has no text fields, so no search or typed edits there.
- The pane opens only when you run `/issues`.

## Develop

```sh
sh scripts/validate.sh                    # from the repo's root
sh scripts/test.sh
sh scripts/typecheck.sh
claude --plugin-dir ./plugins/issue-board
```

The hooks module is `hooks/register.tsx`; `hooks/parse.ts` holds the logic
the tests call directly. Claude Code writes the API's type files into
`.claude-plugin/types/` when it loads the mod, and git ignores them.
