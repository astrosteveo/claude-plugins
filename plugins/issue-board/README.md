# Issue Board

A Claude Code mod that shows the repository's open GitHub issues and pull
requests without leaving the terminal, and hands an issue to Claude to start
on.

Mods need Claude Code v2.1.287 or later. The mod reads GitHub through the `gh`
CLI, signed in, in the folder the session started in.

## Use it

- The status line sums up the board, such as `35 issues · 1 bug · PR #335✓`.
- Run `/issues` to open the pane:
  - A header with the repo, when it last synced, and totals: issues, bugs,
    pull requests, failing CI, and how many task-list boxes are ticked.
  - Sparklines of the issues closed and pull requests merged each week over
    the last 12 weeks, such as `closed ▁▂▅▃▇█▁▂▅▃▇█ 41`.
  - Open pull requests with a CI badge (`✓ PASS`, `✗ FAIL`, `◷ CI`), the
    review state, the branch, author, age and `+added −deleted` lines. Press
    one to open it on GitHub.
  - Open issues by `area:` label, each area with its count and how far along
    it is. Each issue has a progress bar of its task-list boxes, such as
    `━━━━━━ 2/4`, its labels in their GitHub colors, and how long since it
    changed. Bugs come first, marked `▲`, then issues under way. Hover over
    an issue to preview its open boxes without opening it.
  - `a` Active (not labelled `future`), `f` Future, `b` Bugs, `l` All, and
    `r` refreshes.
- Press Enter on an issue, or click it, to open its card: every label and
  assignee, a progress bar and its boxes. Then:
  - **Start** (`s`) sends Claude a message to start on the issue, with its
    unticked boxes.
  - **Draft** (`d`) puts the same message in the prompt box to edit first.
  - **GitHub** (`o`) opens the issue in the browser, and **Close** (`x`)
    folds the card.

  The letter keys work while one card is open.
- `/issues refresh` refreshes and replies with the summary.
- A band above the prompt speaks up, without the pane open, when:
  - a pull request's CI fails. **Fix** hands Claude the failure to fix (into
    the prompt box while Claude is busy), and **Open** opens it on GitHub;
  - the issue you pressed Start on changes on GitHub, other than by Claude's
    own `gh` commands. **View** opens it;
  - that issue is closed.

  `✕` waves an alert off until it happens again.

The board refreshes every 5 minutes, and straight after Claude runs a
`gh issue` or `gh pr` command that changes something.

## Limits

- It shows up to 300 open issues and 50 open pull requests.
- The pane opens only when you run `/issues`.

## Develop

```sh
claude plugin validate plugins/issue-board
claude plugin test plugins/issue-board
claude --plugin-dir ./plugins/issue-board
```

The hooks module is `hooks/register.tsx`, and `hooks/parse.ts` reads `gh`'s
JSON. Claude Code writes the API's type files into `.claude-plugin/types/` each
time it loads the mod, and git ignores them.
