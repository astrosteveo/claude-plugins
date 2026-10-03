# File Tree

A Claude Code mod that shows your project's file tree in a pane beside the
chat. It marks each file Claude creates or changes, so you can review the code
without leaving the terminal.

Mods need Claude Code v2.1.287 or later.

## Use it

- The pane opens the first time Claude changes a file. Run `/tree` to open it
  any time, and press `ctrl+x x` to close it.
- Files Claude created show a green `A`. Files it changed show a yellow `M`.
  Folders with changes inside show a `●` and open by themselves.
- Click a file to review it. A changed file shows its diff from this session.
  Any other file shows its content.
- While the pane has focus, `c` lists changed files only, `d` switches between
  the diff and the whole file, and `b` goes back to the tree.

Changes Claude makes through Bash are marked too, inside a git repo: the mod
compares `git status` before and after each command.

## Limits

- The pane docks on the right only in the fullscreen terminal layout
  (`/tui fullscreen`), 110 columns or wider. It opens by itself from 144
  columns. Otherwise it sits above the prompt.
- The tree's root is the folder the session started in.
- `.git` and `node_modules` are hidden.
- Long diffs keep the newest changes that fit in about 9,500 characters.

## Develop

```sh
claude plugin validate plugins/file-tree
claude plugin test plugins/file-tree
claude --plugin-dir ./plugins/file-tree
```

The hooks module is `hooks/register.tsx`. Claude Code writes the API's type
files into `.claude-plugin/types/` each time it loads the mod, and git ignores
them.
