# Gutter

A time column at the right edge of the transcript, so you can see where a
session's time went without leaving it.

```
> Fix the band                                                    14:05
● Bash(npm test)                                                   3.2s
  ⎿  14 pass
● Read 6 files                                                     1.5s
● Bash(npm run build)                                               48s
```

- **Your prompts** show the local time you sent them.
- **Tool calls** show how long the tool itself ran. Time spent waiting on a
  permission prompt is left out. Calls under a second get no mark, so quick
  reads and searches stay quiet. From 30 seconds the time is yellow, and a
  call that failed is red.
- **A folded group** of calls shows their total, once every call in it has
  finished. Unfold it (ctrl+o) and each call shows its own.

Only what happened while the mod was loaded has a time. Prompts and calls
from before, or from a resumed session, keep their rows as they were.

It draws in the terminal and the desktop app. It needs Claude Code v2.1.293
or later. Mods are an early access part of Claude Code: their API may change
between releases, and a release may break the plugin until it is updated.

## Install

```
/plugin install gutter@astrosteveo-plugins
```
