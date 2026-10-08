# Worktree

Asks once, before Claude's first edit on the default branch, whether to do
the work in a git worktree instead. Changes stay off `main` without you
having to remember to say so.

When Claude is about to edit a file in a checkout of `main` (or whatever
`origin/HEAD` points at), the edit is stopped. Claude then asks you, with the
usual question dialog, whether to use a worktree. If you say yes, Claude
moves the session into a new worktree with Claude Code's own `EnterWorktree`
tool and makes the edit there. If you say no, the edit goes ahead. Either
way, you are asked only once per session.

Nothing is stopped:

- on any other branch, or inside a worktree
- for files outside the repository, such as Claude's memory or a scratch folder
- for a subagent's edits

## The /wt pane

`/wt` lists the repository's worktrees: the main checkout, each worktree's
branch, and whether it has uncommitted changes, is locked, or has lost its
folder. A dot marks the one the session is in.

- **Switch** moves the session into another worktree.
- **New worktree** makes one with the name you type and moves into it. It
  is offered while you are in the main checkout.
- **Leave, keep it** takes the session back to where it started and keeps
  the worktree on disk.
- **Leave and remove it** also deletes the worktree and its branch. Claude
  Code refuses if it holds uncommitted changes or unmerged commits.

Leaving and removing only work for a worktree this session made or entered
with Claude Code's own tools. A refusal shows as a toast. The name field
isn't drawn on mobile.

The mod creates no worktrees itself. Moving in and out is left to Claude
Code's own `EnterWorktree` and `ExitWorktree` tools, with their safety
checks. `claude -w` still starts a session in a worktree from the start.

## Settings

`mode`, under `/config`:

- `ask` (the default): Claude asks you, as above.
- `always`: Claude moves into a worktree without asking.
- `never`: the mod does nothing.

It needs Claude Code v2.1.293 or later. Mods are an early access part of
Claude Code: their API may change between releases, and a release may break
the plugin until it is updated.

## Install

```
/plugin install worktree@astrosteveo-plugins
```
