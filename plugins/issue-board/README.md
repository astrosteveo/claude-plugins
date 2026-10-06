# Issue Board

A Claude Code mod that shows the repository's open GitHub issues and pull
requests without leaving the terminal, and hands an issue to Claude to start
on.

Mods need Claude Code v2.1.287 or later. The mod reads GitHub through the `gh`
CLI, signed in, in the folder the session started in.

## Use it

- The hint line under the prompt sums up the board in dim text, such as
  `? for shortcuts · 35 issues · 1 bug · PR #335✓`. It shows nothing when
  no issues or pull requests are open.
- Run `/issues` to open the pane. Its sections follow one another with no
  blank lines between them:
  - A header line with the repo, its totals (issues, bugs, pull requests,
    failing CI) and when it last synced. In a wide pane it also shows how
    many task-list boxes are ticked, and sparklines of the issues closed and
    pull requests merged each week over the last 12 weeks, such as
    `closed ▁▂▅▃▇█▁▂▅▃▇█ 41`.
  - The project's latest status update, under the header line, such as
    `◉ At risk · Docking slipped. · target 2026-10-20 · 2h ago`, in green,
    yellow or red by how it stands.
  - The **Milestones** and **Pull requests** headings fold: press one to
    fold its section to a line that sums it up, such as `Launch 5/7` or
    `3 open · ✓ 2 · ✗ 1`, and press it again to open it. On a pane shorter
    than 24 rows they start folded, so the issues show first. The board
    remembers how you left them.
  - The open milestones, under a **Milestones** heading: how many of each
    one's issues are closed, as a bar, and when it is due, in red once it
    is past due with issues still open. The section shows only when the
    repo has open milestones.
  - Open pull requests, one row each, under a **Pull requests** heading. The
    section shows only when pull requests are open. Each row has a CI
    badge (`✓ PASS`, `✗ FAIL`, `◷ CI`), the title, the issue it is for (`→ #38`), a dot for the review
    state, and `◆` on the one for the branch you have checked out. The row
    also says why it can't merge yet: `⚠ conflicts` with its base or
    `↓ behind` it, how many review threads are still open, and who is asked
    to review. Press the title for its details: the branch, author, age,
    review, failing checks, the issues it is for, and **↗ GitHub**.
  - **Finish & merge** on a pull request sends Claude a message to see it
    through: fix failing CI, answer review, and merge it, without bypassing
    branch protection or force-pushing. **Merge all…** (`m`), in the pull
    requests' heading, does the same for every open pull request, one at a
    time, oldest first. It asks first: `y` to send and `n` to cancel.
  - The Issues heading, with its filters: `1` Now (Priority P0 and P1), `2`
    Later (P2), `3` Bugs, `4` Mine (assigned to you), `5` All and, with a
    project, `6` Inbox, and `7` Closed, which lists the issues closed
    lately, each with how it closed, read from GitHub when you choose it. A search
    field after them keeps the issues whose title, number or labels hold every
    word you type. Tab to it or click it. The mobile app has no text field, so
    it has no search. `r` refreshes.
  - **Inbox** lists the issues to triage: Status Inbox, or no Status, such as
    an issue not in the project yet. Opening it asks Claude, for each, for a
    Priority, an `area:` label from the repo's own, Ready or Backlog, and a
    short reason. Each issue shows a row of Priority buttons and one of areas,
    with Claude's picks highlighted, and the reason under them. Press another
    to change a pick. **✓ Accept → Ready** (or Backlog, as Claude suggests)
    sets the Priority and area on GitHub and moves the issue on, out of the
    Inbox. The button beside it moves it to the other Status instead. A new
    area label replaces the one the issue had. **Suggest again** asks Claude
    afresh. New issues that come in while the Inbox is open are asked about
    too.
  - **by Status**, **Epic** or **Area** groups the issues by the project's
    Status (the default, in the project's order), by the epic they are
    sub-issues of, or by `area:` label. Each group's heading is its name
    and how many issues it holds, such as `In Progress 1`. Backlog is
    folded: press it to open it.
  - An epic is a parent issue with sub-issues, GitHub's own. Grouped by
    epic, each epic's heading has a bar of its sub-issues closed so far,
    such as `6/12 closed`, and **▶ Next**, which starts Claude on the first
    sub-issue nothing blocks. Within an epic, the sub-issues nothing blocks
    come first, oldest first. Issues in no epic are under No epic. An issue
    waiting on an open one shows `⛔ #N`.
  - Each issue is one row. It starts with the issue's priority, number and
    title. At the right are its background agent, if any, the pull request
    for it with its CI, such as `⇄ #51 ✓`, its labels in their GitHub
    colors, a short bar of its task-list boxes with the count, such as
    `━━━ 2/4`, and how long since it changed. An issue with no boxes has
    no bar. In a narrow pane the labels go first, then the bar, then the
    age, so the title keeps the rest of the width and the row stays on one
    line.
  - The issue this session is on, the one you pressed Start on or whose
    branch is checked out, has `▶` at the start of its row and `✕` at
    the end. Press `✕` to stop tracking it. An issue a background agent is
    working on shows the agent instead.
  - Within a group the most pressing priority comes first, then
    bugs, marked `▲`, then issues under way. Hover over an issue to preview
    its open boxes without opening it. The preview opens above the row, at
    the pane's right, so the rows above stay clear to move the pointer up
    to. Near the top of the pane it lists fewer boxes, and a row with no
    room above it shows none.
- Press Enter on an issue, or click it, to open its card: every label and
  assignee, its epic, milestone and open blockers, a row of buttons each for
  **Status** and **Priority** (press one to set it in the project; the one
  set is highlighted), the issue's text, a progress bar and its boxes. One
  card is open at a time, and opening one scrolls it into view. An open card
  stays in the list until you collapse it, even when a new Priority or Status
  takes it out of the filter; it says so. Press a box to tick or untick it on
  GitHub. Opening a card reads its latest three comments. Under them, a
  reply field posts a comment when you press Enter, and **Ask Claude to
  answer** hands Claude the last comment to reply to. Then:
  - **Start** (`s`) sends Claude a message to start on the issue, with its
    unticked boxes. It makes a task in Claude's task list for each of those
    boxes. It also moves the issue to In progress in the project, adding it
    to the project if it isn't there, and assigns it to you. Once pressed,
    the button says `▶ Starting…` and then `▶ Started`, so it can't send
    the issue twice. It comes back in a new session, or when you start
    another issue.
  - **⚙ Start in background** (`b`) asks Claude to hand the issue to a
    background agent, so you and Claude can go on with something else.
    Claude dispatches the board's own agent, `issue-board:worker`, with
    Start's message and the description `#<number> <title>`, and doesn't
    work on the issue itself. The agent works
    in a git worktree of its own. It reads the issue, makes a branch for
    it, does the work, ticks boxes as it finishes them, and opens a pull
    request, with `Closes` or `Refs` as Start's note says. It doesn't merge
    or force-push. The issue moves to In progress and is assigned to you,
    as with Start. Until the agent starts, the button says
    `⚙ Starting in background…`. It comes back if the start is refused, or
    after five minutes with no agent. Once the agent starts, the issue's
    row shows it: `⚙ working`, `⚙ waiting`, `⚙ done`, `⚙ failed` or
    `⚙ stopped`, and its card shows the agent's last answer. While the
    agent works there is no button, so one agent works on an issue at a
    time. The board follows any agent of this type whose description
    starts with its issue's `#<number>`, so Claude can also dispatch one
    when you ask. When the agent ends, a
    line in the conversation says it is done, failed or was stopped. The
    line names the issue, gives the agent's last answer, and links its
    pull request when there is one. When Claude started the agent with its
    Agent tool, Claude Code gives Claude the agent's result, so Claude can
    tell you what the agent did and what's left. When something else
    started it, such as another plugin or another agent, Claude gets the
    same news as a message from the board instead.
    The agent asks for permission as any background agent does, so allow
    what it needs, or it stops to wait.
  - **⚙ Change** opens the card's editor. Each change is made on GitHub as
    soon as you press it, and the board reads GitHub again straight after:
    - **Labels**: the repo's labels, the ones the issue has highlighted;
      press one to add or take it off. Type a new one in **+ new label** to make it
      and add it; an `area:` label takes the color the other areas have.
    - **Title**: type a new title to rename the issue.
    - **Boxes**: type a box to add it to the acceptance list. **✎ Edit the
      body with Claude** puts `Edit the body of #N:` in the prompt box, for
      a bigger change.
    - **Assignee**: assign yourself or unassign yourself.
    - **Epic**: type an epic's number to put the issue under it, or take it
      out of its epic.
    - **Milestone**: the repo's open milestones; press one to put the issue
      on it, or the highlighted one to take it off.
    - **Type**: the repo's issue types, such as Bug or Task, where its
      organization has them; press one to set it. The card shows the
      issue's type.
    - **The project's other fields**, such as an estimate, a sprint or a
      due date: an iteration or option is a button; a number, date or text
      is a field to type in. **clear** takes a value off. The card itself
      lists the ones that have a value.
    - **Close**: as completed or as not planned, or type a number in **as
      duplicate of #** to close it as a duplicate of that issue, which
      GitHub then links. Closing an epic with open
      sub-issues takes a second press, and says how many are open.
  - **Edit first** (`e`) puts the same message in the prompt box to edit
    first.
  - **↗ GitHub** opens the issue in the browser.
  - **Collapse** (`x` or Esc) folds the card. Esc also folds a pull
    request's details. With nothing open, Esc closes the pane.

  The letter keys work while the card is open.
- `/issues refresh` refreshes and replies with the summary.
- `/issues help` lists everything the board does: the pane's keys, the
  card, the band, the subcommands and Claude's tools.
- `/issues check` checks that `gh` has what the board needs, and says how to
  fix anything missing. See [Permissions](#permissions).
- `/issues setup` prepares the repo and its GitHub Project for the board. It
  reads them, then lists at the top of the pane what it would change. Nothing
  changes until you press **Apply**:
  - It turns on issues if they're off.
  - It uses the project linked to the repo. With several, you pick one; with
    none, it creates one named after the repo and links it.
  - It adds the board's Status options (Inbox, Backlog, Ready, In progress,
    Verification, Done) that are missing, keeping the ones there as they are,
    so issues keep their Status. It creates a Priority field (P0, P1, P2) if
    there isn't one.
  - It creates the `bug` label, and `area:` labels from a list it suggests
    from the repo's folders, which you can edit, when the repo has none.
  - It adds the open issues that aren't in the project, and sets Inbox on
    the ones with no Status.

  It never deletes or renames anything. GitHub's API can't turn on project
  automations, so it lists the ones that are off ("Item closed", "Auto-add
  to project", "Auto-add sub-issues to project") with a link to their
  settings. Without an issue template that has an Acceptance list, **Have
  Claude add one** asks Claude for one as a pull request to review. Setup
  saves the project and its fields for the repo, so the board keeps reading
  that project when several are linked. Esc or Cancel closes it.
- `/issues new` asks Claude to draft an issue from the conversation so far:
  a title, a body with an `## Acceptance` list of boxes, and labels the repo
  already uses. Add what it is about, as in `/issues new saves lose the
  hangar`. The draft shows at the top of the pane. **Create issue** (`c`)
  creates it on GitHub, and **Discard** drops it. Nothing is created until
  you press Create issue.
- `/issues new epic <what>` drafts an epic instead: a parent issue and the
  sub-issues that finish it, each with its own Acceptance list. Creating it
  makes the parent, then each sub-issue under it with `--parent`, and adds
  them all to the repo's project.

  **✎ Edit** (`e`) on the draft opens its editor, on the card itself. For an
  epic, it edits the parent issue.
  - **Title**: a text field. Enter in it saves.
  - **Labels**: the repo's labels, with the draft's highlighted. Press one
    to add it or take it off.
  - **Body**: a text field for each line. Enter in a line adds a new line
    under it. A line you empty is left out. A field shows one line of text,
    so the field you are in shows its whole line under it when the line is
    too long to fit.

  **✓ Save** puts your changes on the card. **Cancel** or Esc drops them.
  You can't save a draft with an empty title. Create and Discard come back
  once the editor is closed, so what gets created is what the card shows.
  The mobile app has no text field, so there the editor changes only the
  labels.

  A created issue joins the repo's project at Inbox. While it's being
  created the draft says so, and pressing Create again does nothing. A
  project's own "Item added to project" automation may set its Status
  instead: `/issues setup` says to set that to Inbox when the project still
  has GitHub's Todo.
- When an issue closes as completed, by a merge, by Claude or on GitHub, the
  board moves it to Done in the project at its next read. One closed as not
  planned or as a duplicate stays where it was, so Done means shipped. For
  that, turn off the project's own **Item closed** workflow, which marks
  every closed issue Done: `/issues setup` advises it, and `/issues check`
  notes it while it's on. Keep the **Auto-add** workflows on; they put new
  issues and sub-issues in the project.
- When a pull request that refers to an issue with `Refs #N`, not
  `Closes`, merges, the board moves the issue to Verification: merging
  didn't complete its acceptance. The next prompt tells Claude so.
- Claude closing an epic with `gh issue close` while some of its sub-issues
  are open asks you first, whatever your permission rules allow, and says
  how many are open. A background agent or other subagent is refused
  instead, since nobody may be watching for the prompt, and is told to deal
  with the sub-issues first or leave the epic open.
- A band above the prompt is for what needs you now, something to fix,
  merge, tick or look at, and for the background agents working out of
  sight. It shows nothing otherwise. The main session's progress is the
  pane's job, so the band doesn't repeat it. Each line is one row at any
  width. It speaks up, without the pane open, when:
  - a pull request's CI fails. It names the failing checks. **Fix** hands
    Claude the failure to fix (into the prompt box while Claude is busy),
    with the command that prints the failing log, and **↗ GitHub** opens it;
  - a pull request's CI passes after the board saw it running. **Finish &
    merge** hands it to Claude to merge, as in the pane, and **↗ GitHub**
    opens it;
  - the issue you pressed Start on changes on GitHub, other than by Claude's
    own changes or yours from the board. **↗ GitHub** opens it;
  - that issue is closed;
  - Claude completes a task that Start made for a box, and the box is still
    open. **Tick box N** ticks it on GitHub;
  - a background agent works on an issue. Its line names the issue, says
    `working` or `waiting`, and, when the issue has boxes, shows a bar of
    those ticked, such as
    `⚙ #90 Tell the agent its issue · working · ━━━━━━ 1/4`. The line goes when the agent ends, since the conversation and Claude
    are told then.

  `✕` waves an alert off until it happens again. The issue you are working
  on and its progress are on its row in the pane, marked `▶`.

  While CI runs on the branch you have checked out, the pane shows a `◷` row
  under the pull requests with its progress: the workflow, a bar of its jobs
  done, and the job and step running, such as
  `validate › Install Claude Code`. The board follows the run with
  `gh run watch`, from when it sees the branch's pull request's CI running,
  or a few seconds after a `git push`, and reads GitHub again when the run
  ends. The band says nothing until the run fails or passes.

The board looks at GitHub every 5 minutes, and every 30 seconds while a
pull request's CI is running. A look is a cheap check first: it asks GitHub
whether the repo's issues and pull requests, or the running CI's checks,
changed since the last look. An unchanged answer doesn't count against
GitHub's rate limit, and the board reads in full only when something
changed. It reads in full at least every 15 minutes anyway, because a
change to a project field, such as Status, doesn't show in the check. The
weekly counts behind the sparklines are read at most once an hour.

The board also reads straight after Claude changes GitHub: a `gh issue` or
`gh pr` command that changes something, `gh project item-edit`, a `gh api`
call that writes, or `git push`. When a turn ends and Claude ran `git` or
`gh` since the last look, the board looks again. And when the session gets
a GitHub event for a pull request it is subscribed to, such as CI
finished, a merge or a review, the board reads at once. The event still
reaches Claude as before. Events come only for pull requests the session
subscribes to, so the board keeps looking as well.

Sessions on the same repository share the board: a session takes another's
newer read rather than read GitHub again. The rate limit is shared too,
across every session and agent on your account. If it runs out, the board
says when it resets and reads nothing until then.

The board is saved for each repository. A new session shows the last board
straight away, and still knows the issue you were working on. The issues'
text isn't saved, to keep the save small, so cards show it once the first
refresh is done. `/clear`, `/new` and `/resume` start a new session too: the
board shows its saved copy again and refreshes at once, so you don't need to
press Refresh.

## Permissions

The board checks what it needs when a session starts, and again when GitHub
turns a request down:

- `gh` is installed and signed in, and its token still works.
- The token has the permissions the board uses: `repo`, and `project` for
  the repo's GitHub Project.
- You have write access to the repo, for ticking boxes and merging.
- The repo isn't archived, and its issues are turned on.

Without the `project` permission the board still works, from labels: Active
and Future instead of Now and Later, grouped by area, and no Status or
Priority. The `⚠ SETUP` row for it only limits the board, so you can wave it
off.

When something is missing, a `⚠ SETUP` row in the band above the prompt says
what, with the fix:

- **Copy command** copies the command that fixes it, such as
  `gh auth refresh -s repo`. Run it in a terminal, or type it after `!` in
  the prompt.
- **Open page** opens the page the fix happens on, such as GitHub's token
  settings. A token in `GH_TOKEN` can't be changed by `gh`, so its fix is
  that page.
- **Check again** looks again once you've fixed it.
- `✕` waves the row off.

The line under the prompt says `issue board needs setup` while the board
can't read GitHub, and `issue board is limited` while something else is
missing and you haven't waved it off. The pane lists each problem with its
fix, and `/issues check` replies with them. When the `issues` or `tick` tool
fails for want of a permission, Claude gets the same fix.

A folder whose repository isn't on GitHub has nothing to check, so the board
stays quiet there.

## What Claude gets

- Seven tools:
  - `issues` lists the board's issues and pull requests, one line each, or
    one issue in full with its boxes numbered. It reads the board's copy, so
    it doesn't run `gh`, and it needs no permission prompt. A label,
    assignee or milestone narrows the list. For an issue the board doesn't
    hold, such as a closed one, it reads GitHub and says how it closed. One
    issue in full also carries its latest ten comments, newest last, and
    says how many earlier ones are left out. With
    `state` closed or all, or words to `search`, it uses GitHub's search
    over every issue, and says how many more there are. With a project
    `status`, such as Done or Verification, it lists the project's issues
    there, closed ones included, and `since` a date narrows Done to what
    shipped lately.
  - `tick` ticks or unticks boxes in an issue's body on GitHub, so the
    progress bars fill in as Claude works. It reads the body fresh before it
    edits, so it doesn't overwrite other changes. Claude Code asks before it
    runs, as with any tool that changes something, unless you allow it.
  - `issue_update` makes the same changes as the card's editor, plus Status
    and Priority, and the board shows them at once. Moving the Status of the
    issue you pressed Start on doesn't ask for permission; any other change
    asks, unless you allow it. It also adds and removes blocked-by links,
    and the row's `⛔` follows at once. A label the repo hasn't got yet is
    made first, by either tool, and Claude is told so. It also changes the title and the
    body, adds boxes and rewords them by number. Boxes go into the body as
    GitHub has it, so nothing else is lost. A whole new body is refused if
    the body changed on GitHub since the board read it. It sets the
    project's other fields by name, each value checked against its field,
    and `null` clears one. It sets the issue's type, as `issue_create` does,
    where the repo has types. It moves a sub-issue before or after a sibling in its epic's
    order, which the Epic grouping and ▶ Next follow. It pins or unpins an
    issue, locks or unlocks its conversation, and moves it to another of
    the owner's repos, by name; a moved issue leaves the board.
  - `issue_create` files a new issue: its title and body, labels,
    assignees, milestone, the epic it goes under, and its Status and
    Priority in the project. Without a Status it goes to the Inbox. For an
    epic, it also takes the sub-issues, and files each under the epic in
    order; one that fails doesn't stop the rest. It can mark the issue
    blocked by others. It all shows on the board at once. Claude Code asks before it runs. If a step
    after filing fails, such as putting it under an epic, Claude is told
    which, with the new issue's number.
  - `milestone` makes a milestone, with a due date and description, or
    changes one by its title: renames it, moves its due date, closes or
    reopens it. Claude Code asks before it runs. `issues` with `milestones`
    lists the open ones with their progress.
  - `project_status` reads the project's latest status update, without
    asking, or posts one: On track, At risk, Off track, Complete or
    Inactive, with a note and start and target dates. Posting asks.
  - `project_archive` archives items in the project, which takes them out
    of its views and leaves the issues as they are: one issue's, or every
    one at Done that closed before a date. It first says how many and
    which, without asking; only archiving them asks.
  - If your organization requires Claude Code to ask before `issues` or
    `issue_update` runs, the board doesn't skip that prompt.
  - When you ask Claude in the conversation to work on an issue, Claude
    calls `issue_update` with `start`, without asking. The board then treats
    it as if you had pressed Start: `▶` on its row, In progress, assigned to
    you, and `▶ Started` on its card with no Start in background. Giving a
    pull request's number starts the issue it is for.
  - When Claude dispatches the board's agent from the conversation, the
    issue moves to In progress and is assigned to you, as with Start in
    background, and its row follows the agent.
- After you press Start, a short note in the system prompt names the issue.
  It tells Claude to tick boxes as it finishes them. In the pull request,
  Claude writes `Closes #<number>` only if every box is ticked by then, and
  `Refs #<number>` otherwise, so the issue stays open for what is left. The
  repository's contributing guidelines come first. The note survives compaction. It
  covers only the session where you pressed Start, and changes only when you
  start another issue, so Claude Code's prompt cache keeps working.
- Checking out a branch named for an issue makes it the issue Claude is on,
  as Start does, but without a message or tasks. A part of the branch name
  starts with the number, such as `fix/315-glide`, `315-glide` or
  `issue-315`. A worktree's branch counts too. Only the main session's
  checkouts count: a subagent's, such as a background agent's in its own
  worktree, don't. The issue must be open on the
  board.
- A prompt that names an issue or pull request as `#123` carries the board's
  copy of it for Claude to read: its labels, Status, boxes, pull requests
  and text. You don't see it. A prompt carries up to three.
- While Claude is on an issue, the next prompt carries a short note when
  the issue changed on GitHub: a box ticked, added or taken out, new
  comments with what they say, CI that fails or passes on its pull request,
  or the issue closed. Changes Claude made itself aren't in it, and the
  system prompt stays the same.
- After each turn, the prompt box suggests a next step for that issue:
  `Fix the failing CI on PR #N`, or, once every box is ticked,
  `Open a PR for #N`, or `Finish and merge PR #N` when its CI passes. Tab
  takes it. It replaces Claude Code's own suggestion.

## Limits

- It shows up to 300 open issues and 50 open pull requests.
- In a repo with issues turned off, it shows only pull requests.
- It reads the first open GitHub Project linked to the repo, and its fields
  named Status and Priority. A project that isn't linked to the repo isn't
  read. With no project, the board works from labels: Active is every issue
  not labelled `future`, and Future is the ones that are.
- The summary under the prompt shows in the terminal only.
- The pane opens only when you run `/issues`.
- The `tick` tool counts boxes from 1 in the order the issue lists them,
  code blocks included.

## Develop

```sh
claude plugin validate plugins/issue-board
claude plugin test plugins/issue-board
claude --plugin-dir ./plugins/issue-board
```

The hooks module is `hooks/register.tsx`, and `hooks/parse.ts` reads `gh`'s
JSON. Claude Code writes the API's type files into `.claude-plugin/types/` each
time it loads the mod, and git ignores them.
