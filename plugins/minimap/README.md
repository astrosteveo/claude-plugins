# Minimap

The whole session as a strip of colored cells above the prompt, so you can
see what kind of work happened, where it failed and where the cost went
without scrolling back.

```
▄▄▄▄▄│▄▄▄▂▄▄
```

- **Each cell is one turn**, oldest on the left. Its color says what the turn
  mostly did: green for edits, amber for shell commands, blue for reads and
  searches, purple for agents, teal for web, gray for other tools, and slate
  for a turn that only talked.
- **Brightness is cost.** The costliest turn is full color and the cheapest
  is dim. Turns are ranked by their tokens, weighed as their prices compare,
  so no ledger is needed. The strip shows no figures: `usage` has those.
- **A red top** marks a turn where a tool failed, or that ended on an error
  or a refusal. **A low cell** is a turn you interrupted.
- **A divider** marks a compaction, before the turn it came in.
- **A long session still fits.** Once there are more turns than columns,
  neighboring turns share a cell, which takes the color of its costliest turn.

## The /minimap pane

`/minimap` opens a pane with the same map, wrapped to the pane's width, and
a legend for its colors. Below the map is a list of every turn: its number,
the start of its prompt, its kind, and how it ended. Press a turn to jump to
its details further down, where the turn is highlighted. They give its whole
prompt (up to 300 characters), its tool calls by kind, and where it ranks by
cost. The list and details also work on desktop, where the map isn't drawn.

Turns recorded before version 0.2.0 have no prompt to show.

Only the main conversation's turns are cells. A subagent's work is part of
the turn that called it. Only what happened while the mod was loaded is
drawn, and a reload keeps the strip.

The strip and the pane's map draw in the terminal only. It needs Claude Code v2.1.293 or later.
Mods are an early access part of Claude Code: their API may change between
releases, and a release may break the plugin until it is updated.

## Install

```
/plugin install minimap@astrosteveo-plugins
```
