# Gauge

Gauge keeps track of how much context and usage a session spends. The status line shows the context, the cost and
your rate-limit windows. Toasts warn you at thresholds you set. `/gauge` shows tokens and cost for each turn, what
fills the context window, and your spend by day.

## The status line

```
ctx 142k/200k 71% · $1.23 · 5h 31% · 7d 12%
```

The figures update after each reply, and when a rate-limit window moves. A figure with no reading yet is left out.

## Warnings

Each warning fires once when its figure crosses the line. If the figure drops back under, for example after
`/compact`, it warns again the next time it crosses.

| Setting | Default | Warns when |
| --- | --- | --- |
| `warnTokens` | 200000 | the context passes this many tokens |
| `warnPercent` | 85 | the context passes this share of the window |
| `limitPercent` | 90 | a rate-limit window passes this share |

Set any of them to 0 to turn it off.

## Compact helper

`compact` sets what happens when the context passes `compactTokens` (0, the default, means the same as `warnTokens`):

- `suggest` (the default): a toast tells you to run `/compact`. It replaces the token warning, so you get one toast.
- `auto`: Gauge compacts the conversation itself, after the running turn ends.
- `off`: nothing.

## `/gauge`

- `/gauge`: the current figures, then your last 20 turns, newest first. Each row has the model, uncached input,
  cache reads, cache writes, output, cache hit rate, cost, how long it ran and how long ago it was. The last row
  adds them up. Subagent turns are left out of the table, but their cost is in the session total.
- `/gauge context`: what fills the context window, by category, largest first. It uses a local estimate.
  `/gauge context full` counts exactly, the way `/context` does.
- `/gauge history`: cost, turns and tokens for each project for each of the last 14 days. History is kept for
  `historyDays` days (default 90), across sessions.

A turn's cost is how much the session total grew while it ran, so it includes any subagents it ran.

## Settings

Change them in `/config`, or under `pluginConfigs.gauge` in your settings.

## Requirements

Claude Code v2.1.296 or later. Mods are an early access part of Claude Code, so a Claude Code release can break the
plugin until it is updated.

## Install

```
/plugin install gauge --marketplace astrosteveo/claude-plugins
```
