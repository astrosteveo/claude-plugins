# Turn Recap

A Claude Code mod that says what each turn did, and keeps a list of every file
Claude edited in the session.

Mods need Claude Code v2.1.287 or later.

## Use it

- The line that closes a turn sums it up when the turn ran tools, such as
  `✻ Baked for 2m 14s · 23 tools · 2 failed · edited register.tsx, plugin.json`:
  - how many tool calls the turn made, its subagents' included;
  - how many were denied or failed, when any were;
  - the files it edited, by name up to three, then as a count.

  A turn that ran no tools keeps the usual line.
- Run `/touched` to open a pane of every file Claude edited this session,
  newest first, each with how many times it was edited, such as
  `3× hooks/register.tsx`. Paths are relative to the session's folder.
  - **Copy paths** (`y`) copies the full paths, one per line.
  - **Clear** (`c`) empties the list.

Edits count from Edit, Write and NotebookEdit calls that succeeded. Nothing is
blocked or changed: the mod only watches.

## Limits

- The closing line names no turn, so a recap is matched to it by the turn's
  duration (within a second).
- The list lasts for the session; a new session starts empty.

## Develop

```sh
claude plugin validate plugins/turn-recap
claude plugin test plugins/turn-recap
claude --plugin-dir ./plugins/turn-recap
```

The hooks module is `hooks/register.tsx`, and `types/index.d.ts` declares the
state it keeps. Claude Code writes the API's type files into
`.claude-plugin/types/` each time it loads the mod, and git ignores them.
