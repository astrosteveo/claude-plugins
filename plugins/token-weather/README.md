# Token Weather

A Claude Code mod that shows how full the context window is, as a weather
forecast in the band above the prompt. It updates after every turn.

Mods need Claude Code v2.1.287 or later.

## What it shows

```text
☂ Showers 67% · 134.4k / 200k · ▂▃▄▅▆ · ▲ +98.3k last turn
```

- The weather for how full the window is:

  | Used | Forecast |
  | --- | --- |
  | under 25% | ☀ Clear, in yellow |
  | 25–49% | ☁ Cloudy, in cyan |
  | 50–74% | ☂ Showers, in blue |
  | 75–89% | ☇ Storm, in magenta |
  | 90% and up | ↯ Compact soon, in red |

- The percentage used, then the tokens used out of the window.
- A chart of the last 12 turns, drawn with `▁▂▃▄▅▆▇█`. Each bar is scaled
  to the whole window, so `█` is a full window, and has the color of its
  own forecast.
- How much the last turn added. A turn that shrank the context, such as a
  compaction, shows in green as `▼ -140k`.

The band shows the current fill as soon as the mod loads. `/clear` empties
it until the next turn.

## Limits

- The tokens are the input of the last response, the same figure as the
  status line's context window. They do not include that response's output.
- On a 1M-token window, every bar stays at `▁` until about 125k tokens.
- On a narrow terminal the band drops parts from the end of the line: the
  words "last turn" below 72 columns, the change below 62 and the chart
  below 50.
- The colors are the terminal's named colors, so they follow its palette.

## Develop

```sh
claude plugin validate plugins/token-weather
claude plugin test plugins/token-weather
claude --plugin-dir ./plugins/token-weather
```

The hooks module is `hooks/register.tsx`. Claude Code writes the API's type
files into `.claude-plugin/types/` each time it loads the mod, and git ignores
them.
