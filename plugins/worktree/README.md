# Worktree

Keeps Claude's edits off the default branch. Before Claude changes a file,
it moves the session into a git worktree, so `main` stays clean without you
having to remember to say so. It also adds a `/wt` pane to see, switch
between, create and leave worktrees.

## How edits are kept off main

While the session is on the default branch, each prompt carries a note
Claude reads but you don't see. It tells Claude to move into a worktree,
with Claude Code's own `EnterWorktree` tool, before its first edit. A prompt
that needs no edits doesn't move the session.

If Claude tries to change a file there anyway (with Edit, MultiEdit, Write or
NotebookEdit), the edit is stopped, and Claude is told to move and make it
again in the worktree. Every such edit is stopped until Claude moves. The
stopped edit's row says `○ Edit stopped to move into a worktree first` in
dim text, instead of showing a red error.

What decides is where the file really is. Its path is resolved first:
relative paths, `.` and `..`, doubled slashes and symlinks all lead to the
same file, and the checkout holding that file is asked. So an edit is
stopped when the file sits in the main checkout on the default branch, or on
a detached head there, however the path was spelled and whoever makes it:

- a subagent's edit is stopped too, and the subagent is told to have its
  parent move, or to be started with `isolation: "worktree"`; a subagent
  working in its own worktree is not stopped
- from a worktree, an edit aimed back at the main checkout is stopped
- when git or the path lookup fails or runs out of time, the edit is
  stopped rather than let through unchecked

The default branch is the one `origin/HEAD` points at. If the repository has
no `origin/HEAD`, `main` and `master` count as the default.

Nothing is stopped:

- on any other branch checked out in the main checkout, or inside a worktree
- for files outside the repository, such as Claude's memory or a scratch
  folder, or in another repository
- outside a git repository

### Shell commands

A shell command can write anywhere, and what it will write can't be told
from the command beforehand, so shell commands are caught, not stopped.
While the main checkout is on the default branch (or a detached head), the
plugin reads it before and after each Bash command: its branch, its commit,
and every file git would add, untracked ones included. If the command
changed any of them, Claude is told what it did and to tell you, and a toast
says so. Ignored files are not read. Reading the checkout writes git objects
through a throwaway index; it changes no file, branch or index of yours.

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

The plugin never runs git commands that change your files, branches or index. Every move in or
out goes through Claude Code's `EnterWorktree` and `ExitWorktree` tools,
with their safety checks. `claude -w` still starts a session in a worktree
from the start.

## Settings

Set under `/config`.

- `enabled` (default on): keep edits off the default branch. Turn it off
  and nothing is stopped or added to your prompts. The `/wt` pane still
  works.

Versions before 0.3.0 had a `mode` setting with an `ask` choice. It is gone:
isolation is either on or off. An old `mode` value is ignored.

## Requirements

Claude Code v2.1.293 or later. Mods are an early access part of Claude
Code, so a Claude Code release can break the plugin until it is updated.

## Install

```
/plugin marketplace add astrosteveo/claude-plugins
/plugin install worktree@astrosteveo-plugins
/reload-plugins
```
