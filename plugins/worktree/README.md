# Worktree

Asks once, before Claude's first edit on the default branch, whether to do
the work in a git worktree instead. This keeps changes off `main` without
you having to remember to say so. It also adds a `/wt` pane to see, switch
between, create and leave worktrees.

## Before the first edit

When Claude is about to change a file (with Edit, MultiEdit, Write or
NotebookEdit) in a checkout of the default branch, the edit is stopped once.
The default branch is the one `origin/HEAD` points at. If the repository has
no `origin/HEAD`, `main` and `master` count as the default.

Claude then asks you, with the usual question dialog, whether to use a
worktree. If you say yes, Claude moves the session into a new worktree with
Claude Code's own `EnterWorktree` tool and makes the edit there. If you say
no, Claude makes the edit where it is. Either way, only one edit is stopped
per session.

The stopped edit's row says so in dim text, such as `○ Edit stopped once to
ask about a worktree first`, instead of showing a red error.

With the `always` setting, Claude usually never gets stopped. While the
session is on the default branch, each prompt carries a note Claude reads
but you don't see. It tells Claude to move into a worktree before its first
edit. A prompt that needs no edits doesn't move the session. If Claude edits
without moving anyway, the edit is stopped as above.

Nothing is stopped:

- on any other branch, on a detached head, or inside a worktree
- for files outside the repository, such as Claude's memory or a scratch
  folder
- for a subagent's edits
- when git can't be read, for example outside a repository

## The /wt pane

`/wt` opens the Worktrees pane. It lists each of the repository's worktrees:
the main checkout first, then each worktree's folder and branch (or its
commit, when detached). A row also says if the worktree has uncommitted
changes, is locked, or has lost its folder. A dot marks the one the session
is in.

- **Switch** moves the session into that worktree. It shows on every
  worktree except the main checkout, the one you are in, and one whose
  folder is gone.
- **New worktree** makes a worktree with the name you type and moves into
  it. It shows while you are in the main checkout. A name takes letters,
  digits, dots, dashes and underscores, 64 characters at most. It isn't
  drawn on mobile.
- **Leave, keep it** takes the session back to where it started and keeps
  the worktree on disk. It shows while you are in a worktree.
- **Leave and remove it** also deletes the worktree and its branch. Claude
  Code refuses if it holds uncommitted changes or unmerged commits.
- **Refresh** reads the list from git again.

Leaving only works for a worktree this session made or entered with Claude
Code's own tools. The result of each action, or the reason it was refused,
shows as a toast.

The plugin never runs git commands that change anything. Every move in or
out goes through Claude Code's `EnterWorktree` and `ExitWorktree` tools,
with their safety checks. `claude -w` still starts a session in a worktree
from the start.

## Settings

Set under `/config`.

- `mode` (default `ask`): what happens before the first edit on the default
  branch.
  - `ask`: Claude asks you whether to use a worktree.
  - `always`: Claude moves into a worktree without asking.
  - `never`: nothing is stopped. The `/wt` pane still works.

## Requirements

Claude Code v2.1.293 or later. Mods are an early access part of Claude
Code, so a Claude Code release can break the plugin until it is updated.

## Install

```
/plugin marketplace add astrosteveo/claude-plugins
/plugin install worktree@astrosteveo-plugins
/reload-plugins
```
