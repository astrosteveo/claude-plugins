# Meter

Meter puts what the turn is doing in the spinner, and what the turn did on the line that closes it. You can see
whether Claude is reading, editing, testing or going in circles without scrolling back.

```
✻ Editing register.tsx… · 2 files changed, last 42s ago (1m 3s · ↓ 4.1k tokens)
✻ Stuck? 3 failures in a row… · 1 file changed, last 3m ago (4m 10s · ↓ 9.8k tokens)

✻ Crunched for 15s · done 7:58 PM · 1 file changed · 4 tools · mostly Testing (7s)
```

## The spinner

- **The phase** comes from the tool that is running: Reading, Searching, Researching, Editing, Delegating,
  Planning, Testing, Using git, Running, or Calling for an MCP tool. A Bash command counts as Testing when it runs
  tests, a type check or a linter.
- **The target** is the file, pattern or address the call works on. Bash calls show no target, because the row
  above the spinner already shows the command.
- **Several calls at once** show the newest, with `+1` for each other one.
- **Between calls** the spinner says Thinking, Writing, Choosing a tool or Waiting on the model.
- **Files changed** counts each file the turn edited or wrote once, and says how long ago the last change was.
  It counts up each second.
- **Stuck?** shows after 3 calls in a row fail or are denied. The next call that works clears it.
- The engine's elapsed time and tokens stay where they are. A message of the engine's own, like compacting, is
  left alone.

## The closing line

After a turn that called tools, the line that closes it adds the files the turn changed, how many tools it called
and how many failed, and the phase its calls spent the longest in. A turn that called no tools keeps the engine's
line as it is. [usage](../usage) draws this line too, with the turn's tokens and cost. When Claude Code runs
usage's hook beneath Meter's, the summary follows the cost on the same line. When it runs usage's on top, usage
draws the line alone and the summary is not shown.

Only the main conversation counts. A subagent's calls are its own.

Meter works the same in the terminal and in the desktop app. It has no commands and no settings.

## Requirements

Claude Code v2.1.295 or later. Mods are an early access part of Claude Code, so a Claude Code release can break
the plugin until it is updated.

## Install

```
/plugin marketplace add astrosteveo/claude-plugins
/plugin install meter@astrosteveo-plugins
/reload-plugins
```
