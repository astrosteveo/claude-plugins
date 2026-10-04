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
  - A header with the repo, when it last synced, and totals: issues, bugs,
    pull requests, failing CI, and how many task-list boxes are ticked.
  - Sparklines of the issues closed and pull requests merged each week over
    the last 12 weeks, such as `closed ▁▂▅▃▇█▁▂▅▃▇█ 41`.
  - **▶ Working on**: the issue you pressed Start on, with its progress.
  - Open pull requests with a CI badge (`✓ PASS`, `✗ FAIL`, `◷ CI`), the
    review state, the branch, author, age and `+added −deleted` lines. A
    failing pull request names its failing checks, and `◆ this branch` marks
    the one for the branch you have checked out. Press one to open it on
    GitHub.
  - **Close out** on a pull request sends Claude a message to see it
    through: fix failing CI, answer review, and merge it, without bypassing
    branch protection or force-pushing. **Close out all** (`m`) does the same
    for every open pull request, one at a time, oldest first; it asks first,
    `y` to send and `n` to cancel.
  - Open issues by `area:` label, each area with its count and how far along
    it is. Each issue has a progress bar of its task-list boxes, such as
    `━━━━━━ 2/4`, its labels in their GitHub colors, and how long since it
    changed. Bugs come first, marked `▲`, then issues under way. Hover over
    an issue to preview its open boxes without opening it.
  - `a` Active (not labelled `future`), `f` Future, `b` Bugs, `i` Mine
    (assigned to you), `l` All, and `r` refreshes.
  - A search field after the filters keeps the issues whose title, number or
    labels hold every word you type. Tab to it or click it. The mobile app has
    no text field, so it has no search.
- Press Enter on an issue, or click it, to open its card: every label and
  assignee, a progress bar and its boxes. Press a box to tick or untick it on
  GitHub. Then:
  - **Start** (`s`) sends Claude a message to start on the issue, with its
    unticked boxes.
  - **Draft** (`d`) puts the same message in the prompt box to edit first.
  - **GitHub** (`o`) opens the issue in the browser, and **Close** (`x`)
    folds the card.

  The letter keys work while one card is open.
- `/issues refresh` refreshes and replies with the summary.
- `/issues new` asks Claude to draft an issue from the conversation so far:
  a title, a body with an `## Acceptance` list of boxes, and labels the repo
  already uses. Add what it is about, as in `/issues new saves lose the
  hangar`. The draft shows at the top of the pane. **File it** (`c`) creates
  it on GitHub, and **Discard** drops it. Nothing is filed until you press
  File it.
- A band above the prompt speaks up, without the pane open, when:
  - a pull request's CI fails. It names the failing checks. **Fix** hands
    Claude the failure to fix (into the prompt box while Claude is busy),
    with the command that prints the failing log, and **Open** opens it on
    GitHub;
  - a pull request's CI passes after the board saw it running. **Merge**
    hands it to Claude to merge, as Close out does, and **Open** opens it;
  - the issue you pressed Start on changes on GitHub, other than by Claude's
    own changes or yours from the board. **View** opens it;
  - that issue is closed.

  `✕` waves an alert off until it happens again. While you work on an issue,
  the band also shows a `▶` row with its progress. `✕` on that row stops
  tracking the issue.

The board refreshes every 5 minutes, every 30 seconds while a pull request's
CI is running, and straight after Claude runs a `gh issue` or `gh pr` command
that changes something.

The board is saved for each repository. A new session shows the last board
straight away, and still knows the issue you were working on.

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
  It tells Claude to tick boxes as it finishes them, and to write
  `Closes #<number>` in the pull request. The note survives compaction. It
  covers only the session where you pressed Start, and changes only when you
  start another issue, so Claude Code's prompt cache keeps working.

## Limits

- It shows up to 300 open issues and 50 open pull requests.
- In a repo with issues turned off, it shows only pull requests.
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
