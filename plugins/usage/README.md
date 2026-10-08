# Usage

Usage shows what the session is spending while you work. A line above the prompt shows how full the context is, what
the session has cost and how much of each rate-limit window you have used. The line that closes each turn adds that
turn's tokens, cache hits and cost. The `/spend` command opens a pane with the details. It draws the same way in the
terminal and in the desktop app.

## The band above the prompt

Once the session has figures, a line above the prompt shows them:

```
context 42% · $1.23 · 5h 31% · 7d 12%
```

The figures update after each reply. In a new session they appear after the first reply. The rate-limit windows are the ones your
account reports, such as `5h`, `7d` or `spend`. The cost is left out where Claude Code keeps no cost ledger. The line is
hidden while a survey is showing.

Context and each rate-limit window turn yellow at 80% and red at 90%.

A toast warns you once when context reaches 85%, so you have time to `/compact`. Another warns you once when a
rate-limit window reaches 90%. If a figure drops back below its line, it warns again the next time it crosses.

## The end of each turn

The line that closes a turn adds what the turn took after its length:

```
✻ Baked for 12s · 10k in · 1.2k out · 80% cached · $0.04
```

- **in** is all the input the turn sent, cached or not.
- **cached** is the share of that input the prompt cache served.
- **The cost** is how much the session total grew during the turn, so it includes any subagents the turn ran. It
  appears a moment after the turn ends, once Claude Code reports the new total. A cost under a cent shows as `<$0.01`.

Turns from before Usage loaded keep Claude Code's own line.

## The `/spend` pane

Run `/spend` to open the Usage pane. (`/usage` is Claude Code's own command.) The top of the pane shows:

- the context window: percent full, its size and the tokens used
- the session's cost
- each rate-limit window: percent used and how long until it resets

Below that is a table of your last 50 turns, newest first. Each row shows the model, uncached input, cache reads,
cache writes, output, cache hit rate, cost and how long the turn ran. A turn you stopped is dimmed and says `stopped`.
The last row adds up the turn count, the four token columns and the overall hit rate.

The table lists only your own turns. Subagent turns are left out, but their cost is still in the session total.

## Requirements

Usage needs Claude Code v2.1.293 or later. Mods are an early access part of Claude Code, so a Claude Code release can
break the plugin until it is updated.

## Install

```
/plugin marketplace add astrosteveo/claude-plugins
/plugin install usage@astrosteveo-plugins
/reload-plugins
```
