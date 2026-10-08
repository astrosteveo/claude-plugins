# CLAUDE.md

This file guides Claude Code in this repository. `AGENTS.md` links to it.

## What this is

`astrosteveo-plugins`, a Claude Code plugin marketplace. Each plugin under `plugins/` is a mod: TypeScript/TSX
function hooks that draw inside Claude Code and hook its events. `.claude-plugin/marketplace.json` lists them.

| Plugin | What it draws |
| --- | --- |
| `ask` | A side-question pane, and Claude's own pick beside the question dialog |
| `usage` | Context, cost and rate limits in the band; each turn's figures on its closing line; the `/spend` pane |
| `gutter` | A time column in the transcript: prompt times, tool run times, folded-group totals |
| `minimap` | The session as a strip of colored cells in the band: each turn's kind, cost and failures |
| `worktree` | Asks once, before the first edit on the default branch, whether to use a worktree; the `/wt` pane |
| `backlog` | The project tracker. It lives in its own repository (see below) |

Load the `plugin-authoring` skill before writing or debugging hooks. It points at the API typings
(`claude-code.d.ts`), which document every event, `$` method and element prop. Grep them for the name you need.

## Commands

```sh
sh scripts/validate.sh                      # strict validate of the marketplace and each plugin
sh scripts/test.sh                          # the userConfig check, then every plugin's tests
sh scripts/typecheck.sh                     # type-check every plugin against the installed Claude Code
claude plugin test plugins/usage            # one plugin's tests; there is no per-test filter
claude plugin validate --json plugins/usage # what the module hooks and calls, its state keys and gating hooks
claude --plugin-dir ./plugins/usage         # try a plugin without installing it
```

CI (`.github/workflows/validate.yml`) runs the three scripts on pull requests, pushes to `main`, and weekly. It
installs the latest Claude Code, the same version used for development. There is no version pin. When a new release
turns CI red, fix the plugins. If a test passes locally but fails in CI, run `claude update` first.

The marketplace is registered from this checkout, so the installed plugins are whatever is checked out. After a
change, or after merging and pulling `main`, the person runs `/reload-plugins`. A new plugin needs
`/plugin install <name>@astrosteveo-plugins` first.

## Design rules

- **Show each thing once.** Before a mod draws a figure, check whether Claude Code or another mod already shows it.
  If so, leave it out. Bash rows already show how long they ran, so `gutter` adds no time to them. `usage` puts a
  turn's figures on its closing line, so the band doesn't repeat them.
- **Draw beyond panes and the band.** A `ui.render` hook can redraw transcript rows (`UserMessage`, `ToolUse`,
  `ToolGroup`, `TurnDuration`…), the `Spinner`, `SessionMode` and `PromptHint`. To add to the engine's own row, wrap
  what `await next(e)` returns in your own `Box`, as `gutter` does. Return `next(e)` when there is nothing to add.
- **Don't clash with a built-in slash command.** `/usage` belongs to Claude Code, so `usage` registers `/spend`. A
  registration that fails must not stop the rest of `session.start`.
- **Check it on screen.** Tests can't show layout. Before merging a change to what a mod draws, have the person load
  it and look.

## How a mod is laid out

```text
plugins/<name>/
  .claude-plugin/plugin.json   # identity, version, userConfig; "types" points at the state contract
  hooks/hooks.json             # { "modules": ["./register.tsx"] }
  hooks/register.tsx           # export const register: Register = (on, options) => { ... }
  hooks/<topic>.ts             # pure logic the tests call directly
  types/index.d.ts             # the $.state contract and shared value types
  tests/*.test.ts(x)
  tsconfig.json                # extends ./.claude-plugin/types/tsconfig.json
  README.md
```

- Every hook is `($, e, next)`. `next(e)` runs the plugins beneath, then the engine.
- The engine follows `$` only into functions declared in `register.tsx`, never across an import. So every function
  that calls `$` lives in `register.tsx`, and the rest goes in pure `.ts` files. A hook reads through `$`, passes the
  values to a pure function that decides, and writes the result. In `usage`, `crossings` decides which toasts a
  measurement raises; the `session.measure` hook reads, calls it and writes back.
- Every hook at a gating site (`tool.call`, `tool.check`, `prompt.submit`, `session.append`, the `classic.*`
  events…) ends in `.catch(($, e, next) => fallBack($, e, next, '<site>'))`. `fallBack` logs to the debug log and
  returns `next(e)`. `validate.sh` fails on a gating hook without one.
- Declare every `$.state` atom in `types/index.d.ts` under the plugin's name. `claude plugin validate` holds the
  module to it. State that a drawing reads belongs in `$.state`, not a module variable, because a reload loses
  module variables.
- Every `userConfig` field must be a kind `/config` can show as a row: boolean, number, text, or a choice of strings.
  `scripts/config-rows.test.mjs` checks this.
- TypeScript runs as source. Never commit compiled `.js` next to it; `validate.sh` fails if you do.
- Claude Code writes `.claude-plugin/types/` each time the mod loads, and git ignores it. Switching branches can
  leave a plugin folder that holds only these files, which fails `validate.sh`. Delete such a folder.

## Tests

Tests import `test` and `expect` from `'claude-code/testing'` and get `($, on)`.

- The test's `on` hooks sit beneath the plugin and stand in for the engine. Any event the plugin passes on needs an
  answer there. `usage`, `gutter`, `minimap` and `worktree` keep those answers in an `engine(on)` helper. Follow that.
- `$` raises events as the engine would: `$.session.measure(...)`, `$.turn.complete(...)`,
  `$.classic.PostToolUse(...)`, `$.command.run(...)`. `$.ui.mount({ plugin, surface, component, requestId, props })`
  draws a site, and `find` / `findAll` / `press` act on it. Run UI tests on both `'terminal'` and `'desktop'`.
- There is no rendered frame. Check layout through element props, such as a `Box`'s `flexDirection`. Find a `Text`
  by its text, because its `key` is not kept.

## Mods in their own repositories

A mod with its own runtime, users or release schedule gets its own repository. `backlog` is one: it is
`astrosteveo/backlog`, checked out at `~/Projects/claude-tasks`. Its `marketplace.json` entry has a `github` source
pinned by `sha` and no `version`; its own `plugin.json` holds the version. The scripts here only cover `plugins/*`,
so its own CI validates and tests it.

- To release it, merge in its repository, then bump the `sha` here in a pull request of its own.
- To work on it, install it from its own checkout (`/plugin marketplace add ~/Projects/claude-tasks`, then
  `backlog@backlog`), not from this marketplace. Install it from only one marketplace at a time.

## Working in this repo

- Work is tracked on the backlog board (`mcp__backlog__*`), not in GitHub issues. Plan with `propose`. Give each
  story who it serves, its approach, testable acceptance criteria and an estimate. Set an item in progress when you
  start, tick each criterion once it is verified, and move it to review when done. Done is the person's call.
- Branches carry the item's id, such as `s-12-short-title` (`/backlog branch S-12` makes one). Commit messages start
  with it: `S-12: add the time column`. `fixes S-12` moves the item to review.
- Pull requests are merge commits. Merge once every check is green and the file list has nothing unexpected. Then
  delete the branch locally and on origin, and pull `main`.
- Each change to a plugin bumps its version in **both** `plugins/<name>/.claude-plugin/plugin.json` and its
  `marketplace.json` entry: patch for fixes, minor for features. A new plugin also gets a row in the table above and
  in the README's.
- Write PR text, READMEs and code comments in short, plain sentences. Comments say why, in full sentences, and match
  the code around them. User-facing changes go in the plugin's README.
