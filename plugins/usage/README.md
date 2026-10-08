# Usage

See what the session is spending while you work: how full the context is,
what it has cost, how much of each rate-limit window is used, and what each
turn took in tokens and cache hits.

It needs Claude Code v2.1.293 or later. Mods are an early access part of
Claude Code: their API may change between releases, and a release may break
the plugin until it is updated.

## The band

A line above the prompt shows the latest figures once the session has
measured them, after the first reply:

```
context 42% · $1.23 · 5h 31% · 7d 12%
```

Context and each rate-limit window turn yellow from 80% and red from 90%.

A toast tells you once when context passes 85%, so there is time to
`/compact`, and once when a rate-limit window passes 90%. A figure that falls
back under its line toasts again the next time it crosses.

## The end of each turn

The line that closes a turn says what the turn took, after its length:

```
✻ Baked for 12s · 10k in · 1.2k out · 80% cached · $0.04
```

"Cached" is the share of the turn's input the prompt cache served. The cost
is what the session total grew by over the turn, so it includes any
subagents the turn ran. It shows once the session measures, just after the
turn ends. Turns from before the session started, or before the mod loaded,
keep Claude Code's own line.

## The pane

Run `/spend` to open the Usage pane. (`/usage` is Claude Code's own command.) It shows the context window, the cost,
each rate-limit window with when it resets, and the last 50 turns, newest
first: the model, uncached input, cache read, cache written, output, hit
rate, cost and how long the turn ran. A last row sums them.

Only your own turns are listed. A subagent's turns are left out, but their
cost is still in the session total.

## Install

```
/plugin install usage@astrosteveo-plugins
```
