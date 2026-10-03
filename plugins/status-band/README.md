# Status Band

A Claude Code mod that puts one row above the prompt, under a thin divider,
with what you check most:

```text
 ✻ Opus 5.5 ●●●●● high │ claude-plugins │ ⎇ main ↑2 +2 ~2 ?1 │ 7d ████▎ 42% ↻ 2d 3h
```

Mods need Claude Code v2.1.287 or later.

## What it shows

- **Model:** the model the last request used, such as `Opus 5.5`.
- **Effort:** five dots, one lit per level from `low` to `max`, the rest dim.
  Before the first turn it reads `effortLevel` from your settings.
- **Project:** the name of the session's project folder.
- **Git:** the branch, then commits ahead `↑` and behind `↓`, conflicts `✖`,
  staged `+`, changed `~` and untracked `?` files. A clean tree shows `✓`.
- **7-day usage:** a bar on a dim track, the percent used and the time until
  it resets. The bar turns yellow at 70% and red at 90%. It shows only on a
  subscription, after the first reply of the session.

Git status refreshes after each Bash, Edit or Write call, at the end of each
turn and every 15 seconds.

Below 100 columns the reset time goes. Below 70 the bar and the effort word
go too.

## Develop

```sh
claude plugin validate plugins/status-band
claude plugin test plugins/status-band
claude --plugin-dir ./plugins/status-band
```

The hooks module is `hooks/register.tsx`. Claude Code writes the API's type
files into `.claude-plugin/types/` each time it loads the mod, and git ignores
them.
