# Issue Board

A Claude Code mod that shows the repository's open GitHub issues and pull
requests without leaving the terminal, and hands an issue to Claude to start
on.

Mods need Claude Code v2.1.287 or later. The mod reads GitHub through the `gh`
CLI, signed in, in the folder the session started in.

## Use it

- The status line sums up the board, such as `35 issues · 1 bug · PR #335✓`.
- Run `/issues` to open the pane:
  - Open pull requests with their CI (`✓` passed, `✗` failed, `…` running)
    and review state.
  - Open issues by `area:` label, each with how many of its task-list boxes
    are ticked, such as `2/4`. Bugs come first, then issues under way.
  - `a` Active (not labelled `future`), `f` Future, `b` Bugs, `l` All, and
    `r` refreshes.
- Press Enter on an issue, or click it, to show its boxes. Then:
  - **Start** sends Claude a message to start on the issue, with its unticked
    boxes.
  - **Draft** puts the same message in the prompt box to edit first.
- `/issues refresh` refreshes and replies with the summary.

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
