# Gutter

Gutter adds a time column at the right edge of the transcript. It shows when you sent each prompt and how long
each tool ran, so you can see where a session's time went without leaving it.

```
> Fix the band                                                    14:05
● Fetch(https://example.com)                                       3.2s
● Read 6 files, ran 2 shell commands                               12s
● mcp__github__search_issues(…)                                    48s
```

## What it shows

- **Your prompts** show the local time you sent them, as a 24-hour clock. The expanded view (ctrl+o) leaves the
  time out.
- **Tool calls** show how long the tool itself ran. Time spent waiting on a permission prompt is not counted. A
  call shows its time once it has finished.
- **Quiet calls get no mark.** A call that ran under a second, like most reads and searches, shows nothing.
- **Bash, PowerShell and Agent rows** already say how long they ran, so Gutter gives them no second time.
- **Colors.** A time is dim gray. From 30 seconds it turns yellow. A call that failed is red.
- **A folded group** of calls shows their total once every call in it has finished. The total is red if any call
  failed. Unfold the group and each call shows its own time instead.

Times read short: `3.2s` under ten seconds, then `48s`, `2m 5s` and `1h 10m`.

Only what happened while the plugin was loaded has a time. Prompts and calls from before it loaded, or from a
resumed session, keep their rows as they were.

Gutter works the same in the terminal and in the desktop app. It has no commands and no settings.

## Requirements

Claude Code v2.1.293 or later. Mods are an early access part of Claude Code, so a Claude Code release can break
the plugin until it is updated.

## Install

```
/plugin marketplace add astrosteveo/claude-plugins
/plugin install gutter@astrosteveo-plugins
/reload-plugins
```
