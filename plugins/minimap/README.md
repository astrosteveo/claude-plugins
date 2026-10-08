# Minimap

Minimap draws the whole session as a strip of colored cells above the prompt.
Each cell is one turn. At a glance you can see what kind of work each turn did,
which turns cost the most, and where things failed, without scrolling back.

```
▄▄▄▄▄│▄▄▄▂▄▄
```

## Reading the strip

- **One cell per turn**, oldest on the left. A cell appears once its turn ends.
- **Color is the kind of work.** Green is edits, amber is shell commands, blue
  is reads and searches, purple is agents, teal is web, gray is other tools,
  and slate is a turn that called no tools. A turn takes the color of the tools
  it called most. On a tie, edits win, then shell, agents, web, reads and other.
- **Brightness is cost.** The costliest turn is full color and the cheapest is
  dim. Turns are ranked by their tokens, weighed by how their prices compare.
  The strip shows no figures; the `usage` plugin shows those.
- **A red top** means a tool failed in that turn, or the turn ended on an error
  or a refusal.
- **A low cell** (`▂`) is a turn you interrupted.
- **A divider** (`│`) marks a compaction. It sits before the first turn after it.
- **A long session still fits.** When there are more turns than columns,
  neighboring turns share a cell. The cell takes the color of its costliest
  turn, shows red if any of them failed, and is low only if all were
  interrupted.

Only the main conversation's turns get cells. A subagent's work counts as part
of the turn that started it. Minimap only records turns that ran while it was
loaded. A plugin reload keeps the strip. It keeps the last 2,000 turns.

## The /minimap pane

Run `/minimap` to open a pane with:

- The same map, wrapped to the pane's width over up to six rows.
- A legend for the colors and marks.
- A list of every turn: its number, the start of its prompt, its kind, and how
  it ended (errors, interrupted, after a compaction).
- Details for each turn: its prompt (up to 300 characters), its tool calls by
  kind, and its cost rank in the session.

Press a turn in the list to jump to its details. The picked turn is
highlighted there. Turns recorded before version 0.2.0 have no prompt to show.

## Terminal and desktop

The strip and the pane's map draw in the terminal only. On desktop there is no
strip, but `/minimap` still opens the pane with the legend, list and details.

## Settings

Minimap has no settings.

## Requirements

Claude Code v2.1.293 or later. Mods are an early access part of Claude Code, so
a new release can break the plugin until it is updated.

## Install

```
/plugin marketplace add astrosteveo/claude-plugins
/plugin install minimap@astrosteveo-plugins
/reload-plugins
```
