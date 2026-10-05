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
- Run `/issues` to open the pane:
  - A header line with the repo, its totals (issues, bugs, pull requests,
    failing CI) and when it last synced. In a wide pane it also shows how
    many task-list boxes are ticked, and sparklines of the issues closed and
    pull requests merged each week over the last 12 weeks, such as
    `closed ▁▂▅▃▇█▁▂▅▃▇█ 41`.
  - **▶ Working on**: the issue you pressed Start on, with its progress. When
    a pull request says it is for that issue (`Closes #N` or `Refs #N`), the
    line names it with its CI.
  - Open pull requests, one row each: a CI badge (`✓ PASS`, `✗ FAIL`,
    `◷ CI`), the title, the issue it is for (`→ #38`), a dot for the review
    state, and `◆` on the one for the branch you have checked out. Press the
    title for its details: the branch,
    author, age, review, failing checks, the issues it is for, and
    **↗ GitHub**.
  - **Finish & merge** on a pull request sends Claude a message to see it
    through: fix failing CI, answer review, and merge it, without bypassing
    branch protection or force-pushing. **Merge all…** (`m`), in the pull
    requests' heading, does the same for every open pull request, one at a
    time, oldest first. It asks first: `y` to send and `n` to cancel.
  - The Issues heading, with its filters: `1` Now (Priority P0 and P1), `2`
    Later (P2), `3` Bugs, `4` Mine (assigned to you) and `5` All. A search
    field after them keeps the issues whose title, number or labels hold every
    word you type. Tab to it or click it. The mobile app has no text field, so
    it has no search. `r` refreshes.
  - A **by** picker groups the issues by the project's Status (the default, in
    the project's order), by the epic they are sub-issues of, or by `area:`
    label. Backlog is folded: press it to open it.
  - Each issue has a progress bar of its task-list boxes, such as
    `━━━━━━ 2/4`, its priority, its labels in their GitHub colors, how long
    since it changed, and the pull request for it with its CI, such as
    `⇄ #51 ✓`. Within a group the most pressing priority comes first, then
    bugs, marked `▲`, then issues under way. Hover over an issue to preview
    its open boxes without opening it.
- Press Enter on an issue, or click it, to open its card: every label and
  assignee, its epic, milestone and open blockers, **Status** and
  **Priority** pickers that change them in the project, the issue's text, a
  progress bar and its boxes. One card is open at a time, and opening one
  scrolls it into view. Press a box to tick or untick it on GitHub. Then:
  - **Start** (`s`) sends Claude a message to start on the issue, with its
    unticked boxes. It also moves the issue to In progress in the project,
    adding it to the project if it isn't there, and assigns it to you.
  - **Edit first** (`e`) puts the same message in the prompt box to edit
    first.
  - **↗ GitHub** opens the issue in the browser.
  - **Collapse** (`x` or Esc) folds the card. Esc also folds a pull
    request's details. With nothing open, Esc closes the pane.

  The letter keys work while the card is open.
- `/issues refresh` refreshes and replies with the summary.
- `/issues check` checks that `gh` has what the board needs, and says how to
  fix anything missing. See [Permissions](#permissions).
- `/issues new` asks Claude to draft an issue from the conversation so far:
  a title, a body with an `## Acceptance` list of boxes, and labels the repo
  already uses. Add what it is about, as in `/issues new saves lose the
  hangar`. The draft shows at the top of the pane. **Create issue** (`c`)
  creates it on GitHub, and **Discard** drops it. Nothing is created until
  you press Create issue.
- A band above the prompt speaks up, without the pane open, when:
  - a pull request's CI fails. It names the failing checks. **Fix** hands
    Claude the failure to fix (into the prompt box while Claude is busy),
    with the command that prints the failing log, and **↗ GitHub** opens it;
  - a pull request's CI passes after the board saw it running. **Finish &
    merge** hands it to Claude to merge, as in the pane, and **↗ GitHub**
    opens it;
  - the issue you pressed Start on changes on GitHub, other than by Claude's
    own changes or yours from the board. **↗ GitHub** opens it;
  - that issue is closed.

  `✕` waves an alert off until it happens again. While you work on an issue,
  the band also shows a `▶` row with its progress. `✕` on that row stops
  tracking the issue.

The board refreshes every 5 minutes, every 30 seconds while a pull request's
CI is running, and straight after Claude runs a `gh issue` or `gh pr` command
that changes something.

The board is saved for each repository. A new session shows the last board
straight away, and still knows the issue you were working on. The issues'
text isn't saved, to keep the save small, so cards show it once the first
refresh is done.

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

- Two tools:
  - `issues` lists the board's issues and pull requests, one line each, or
    one issue in full with its boxes numbered. It reads the board's copy, so
    it doesn't run `gh`, and it needs no permission prompt.
  - `tick` ticks or unticks boxes in an issue's body on GitHub, so the
    progress bars fill in as Claude works. It reads the body fresh before it
    edits, so it doesn't overwrite other changes. Claude Code asks before it
    runs, as with any tool that changes something, unless you allow it.
- After you press Start, a short note in the system prompt names the issue.
  It tells Claude to tick boxes as it finishes them. In the pull request,
  Claude writes `Closes #<number>` only if every box is ticked by then, and
  `Refs #<number>` otherwise, so the issue stays open for what is left. The
  repository's contributing guidelines come first. The note survives compaction. It
  covers only the session where you pressed Start, and changes only when you
  start another issue, so Claude Code's prompt cache keeps working.

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
