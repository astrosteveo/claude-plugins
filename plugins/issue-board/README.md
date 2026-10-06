# Issue Board

A Claude Code mod that brings a repository's GitHub issues, pull requests and
GitHub Project into the terminal: a pane to see and change them, a band above
the prompt for what needs you, and tools that let Claude run the project with
you.

It needs Claude Code v2.1.287 or later, and the `gh` CLI signed in, in the
folder the session started in.

## Quick start

1. Run `/issues` to open the pane.
2. Run `/issues setup` once if the repo has no GitHub Project yet. It shows
   what it would change and waits for **Apply**.
3. Press Enter on an issue, then **▶ Start** to hand it to Claude.

`/issues help` lists every key, subcommand and tool. `/issues check` says
what the board is missing, if anything.

## See what's open

The line under the prompt sums up the board in dim text, such as
`? for shortcuts · 35 issues · 1 bug · PR #335✓`. It shows nothing when
nothing is open.

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
- **Issues**, with their filters: `1` Now (Priority P0 and P1), `2` Later
  (P2), `3` Bugs, `4` Mine, `5` All, `6` Inbox (with a project) and `7`
  Closed. Closed lists the issues closed lately, each with how it closed,
  read from GitHub when you choose it. Without a project, `1` and `2` read
  Active and Future, from the `future` label.

Press the **Milestones** or **Pull requests** heading to fold its section to
one line, such as `Launch 5/7` or `3 open · ✓ 2 · ✗ 1`. On a pane shorter
than 24 rows they start folded, so the issues show first. The board
remembers how you leave them.

The search field after the filters keeps the issues whose title, number or
labels hold every word you type. **by Status**, **Epic** or **Area** groups
them. Backlog starts folded; press it to open it. `r` refreshes.

Each issue is one row: its priority, number and title, then, at the right,
its background agent, its pull request with CI (`⇄ #51 ✓`), its labels in
their colors, a bar of its boxes (`━━━ 2/4`) and how long since it changed.
A narrow pane drops the labels, then the bar, then the age, so the row stays
on one line. Within a group, the most pressing priority comes first, then
bugs (`▲`), then work under way. An issue waiting on an open one shows
`⛔ #N`.

Hover a row to preview its open boxes. The preview opens above the row, so
the rows above stay clear for the pointer. Near the top of the pane it lists
fewer boxes, and a row with no room above shows none.

**Epics** are parent issues with GitHub's sub-issues. Grouped by Epic, each
heading has a bar of its sub-issues closed, such as `6/12 closed`, and
**▶ Next**, which starts Claude on the first one nothing blocks. Sub-issues
follow GitHub's order where priority and blockers don't decide.

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
- **⚙ Start in background** (`b`) asks Claude to hand the issue to the
  board's agent, `issue-board:worker`. It works in its own git worktree,
  ticks boxes, and opens a pull request, without merging or force-pushing.
  The row shows the agent: `⚙ working`, `waiting`, `done`, `failed` or
  `stopped`. When it ends, the conversation says so, with its last answer
  and pull request. It asks for permission as any background agent does.
- **✎ Edit first** (`e`) puts Start's message in the prompt box to edit.
- **⚙ Change** opens the editor; see [File and plan issues](#file-and-plan-issues).
- **↗ GitHub** opens the issue. **Collapse** (`x` or Esc) folds the card.
  With nothing open, Esc closes the pane.

The issue this session is on has `▶` on its row and `✕` to stop tracking
it. It's the one you pressed Start on, the one Claude started on when you
asked in the conversation, or the one whose branch is checked out: a branch
such as `fix/315-glide`, `315-glide` or `issue-315` counts. Only the main
session's checkouts count, not a background agent's.

While Claude is on it:

- A short note in the system prompt names it, and tells Claude to tick boxes
  as it finishes them and to write `Closes #N` in the pull request only when
  every box is ticked, `Refs #N` otherwise. The note survives compaction.
- The next prompt carries what changed on GitHub since: boxes, new comments,
  CI on its pull request, or the issue closed. Claude's own changes aren't
  news.
- After each turn, the prompt box suggests the next step, such as
  `Open a PR for #N` once every box is ticked. Tab takes it.

A prompt that names `#123` carries the board's copy of that issue or pull
request for Claude, unseen. A prompt carries up to three.

**The band above the prompt** speaks up only for what needs you: CI that
fails (**Fix** hands it to Claude), CI that passes (**Finish & merge**), news
on the issue you started, its closing, a task Claude finished whose box is
still open (**Tick box N**), and background agents at work. `✕` waves an
alert off until it happens again.

## Pull requests and CI

Each open pull request is a row: its CI (`✓ PASS`, `✗ FAIL`, `◷ CI`), title,
the issue it is for (`→ #38`), its review, and `◆` on the branch you have
checked out. It says why it can't merge yet: `⚠ conflicts`, `↓ behind`,
open review threads, and who is asked to review. Press the title for its
details.

- **Finish & merge** sends Claude to see it through: fix CI, answer review,
  and merge, without bypassing branch protection or force-pushing.
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
  it, and files them together.

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

- An issue that closes as **completed** moves to Done at the board's next
  read, wherever it closed. One closed as not planned or as a duplicate
  stays where it was, so Done means shipped.
- An issue a merged pull request names with `Refs #N` moves to
  Verification: merging didn't finish it. Claude's next prompt says so.
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

The board gives Claude seven tools:

- `issues` reads: the board's list, one issue in full with its boxes,
  fields and latest ten comments, any issue by number even closed, a search
  of every issue (`state`, `search`, `label`, `assignee`, `milestone`), the
  project's issues at a Status (`status`, `since`), and the open milestones
  (`milestones`). It never asks for permission.
- `tick` ticks or unticks boxes, reading the body fresh first.
- `issue_update` changes an issue: Status, Priority, title, body, boxes
  (`addBoxes`, `rewordBoxes`), labels, assignees, epic and its order among
  siblings (`moveBefore`, `moveAfter`), milestone, type, the project's
  fields (`fields`), blocked-by links, pin, lock, transfer to another of the
  owner's repos, a comment, and closing, as a duplicate too. `start` marks
  that Claude started on it here, as Start does.
- `issue_create` files an issue, or an epic with its sub-issues, with
  labels, assignees, milestone, epic, type, blocked-by links, Status and
  Priority. A label the repo hasn't got is made first.
- `milestone` makes or changes a milestone by title: due date,
  description, rename, close or reopen.
- `project_status` reads the project's status update, or posts one.
- `project_archive` archives project items: one issue's, or every one at
  Done that closed before a date. It lists them first and archives on a
  second, confirmed call.

Claude Code asks before any tool that changes something, as it does for any
tool, except where the change is part of work you started: moving the
Status of your issue, `start`, listing what an archive would take, and
reading the status update. An organization's rule that requires asking
still stands. A transfer from a public repo to a private one, which GitHub
won't undo, needs a second, confirmed call.

## Commands

- `/issues` opens the pane.
- `/issues help` lists what the board does.
- `/issues refresh` reads GitHub again and replies with the summary.
- `/issues new <what>` and `/issues new epic <what>` draft issues.
- `/issues setup` prepares the repo and its project. It lists what it
  would change at the top of the pane, and nothing changes until
  **Apply**: it turns issues on, uses the linked project or creates one,
  adds the board's Status options (Inbox, Backlog, Ready, In progress,
  Verification, Done) and a Priority field (P0, P1, P2), creates `bug` and
  `area:` labels, and puts open issues in the project at Inbox. It never
  deletes or renames anything. GitHub's API can't change a project's
  workflows, so it lists those to change by hand, with a link: the
  Auto-add workflows on, **Item closed** off, and **Item added to project**
  set to Inbox rather than GitHub's Todo, so new issues land in the Inbox.
- `/issues check` checks what the board needs; see [Permissions](#permissions).

## How it reads GitHub

The board looks at GitHub every 5 minutes, and every 30 seconds while CI
runs. A look starts with a cheap check of whether anything changed, which
doesn't count against GitHub's rate limit. It reads in full only when
something changed, and at least every 15 minutes. It also reads straight
after Claude changes GitHub, after a turn that ran `git` or `gh`, and when a
GitHub event arrives for a pull request the session follows.

Sessions on the same repo share the board, and the rate limit is shared by
every session and agent on your account. If the limit runs out, the board
says when it resets and waits.

The board is saved for each repo, so a new session, or `/clear`, shows it at
once and still knows the issue you were on.

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
