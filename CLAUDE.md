# CLAUDE.md

This file guides Claude Code when it works in this repository.

## What this is

A Claude Code plugin marketplace, `astrosteveo-plugins`. Each plugin under `plugins/` is a **mod**: a plugin of
function hooks, written in TypeScript/TSX, that draws inside Claude Code and hooks its events.

| Plugin | What it draws |
| --- | --- |
| `ask` | A side-question pane, and Claude's own pick beside the question dialog |
| `usage` | Context, cost and rate limits in the band; each turn's figures on its closing line; the `/spend` pane |
| `gutter` | A time column in the transcript: prompt times, tool run times, folded-group totals |
| `minimap` | The session as a strip of colored cells in the band: each turn's kind, cost and failures |
| `worktree` | Asks once, before the first edit on the default branch, whether to use a worktree; the `/wt` pane |
| `backlog` | The project tracker: board pane, tracker tools, web app. Lives in its own repo (see below) |

Load the `plugin-authoring` skill before writing or debugging hooks. It points at this build's API typings
(`claude-code.d.ts`), the reference for every event, `$` method and element prop. Grep it for the name at hand.

## Design rules

- **Show each thing once.** Before a mod draws a figure, check whether Claude Code or another mod here already shows
  it, and leave it out if so. Bash rows already say how long they ran, so `gutter` gives them no time. `usage` puts a
  turn's figures on its closing line, so the band no longer repeats them.
- **Draw beyond panes and the band.** A `ui.render` hook can redraw transcript rows (`UserMessage`, `ToolUse`,
  `ToolGroup`, `TurnDuration`…), the `Spinner`, `SessionMode` and `PromptHint`. To add to the engine's own row, wrap
  what `await next(e)` returns in your own `Box`, as `gutter` does. Return `next(e)` when there is nothing to add.
- **A slash command must not clash with a built-in.** `/usage` is Claude Code's, so `usage` registers `/spend`. A
  registration that fails must not stop the rest of `session.start`.
- **Check it on screen.** Tests can't show layout. Before merging a change to what a mod draws, have the person load
  it and look.

## Commands

```sh
sh scripts/validate.sh                      # strict validate of the marketplace and each plugin; each gating hook has a .catch
sh scripts/test.sh                          # every plugin's tests, plus the scripts' own node tests
sh scripts/typecheck.sh                     # type-check every plugin against the installed Claude Code
sh scripts/mutants.sh                       # put each fixed bug back and check a test catches it; tests HEAD, so commit first
sh scripts/mutants.sh origin/main           # only the patches the changes since origin/main can affect
claude plugin test plugins/usage            # one plugin's tests; there is no per-test filter
claude plugin validate --json plugins/usage # what the module hooks and calls, its state keys and gating hooks
claude --plugin-dir ./plugins/usage         # try a plugin without installing it
```

CI runs `validate.sh`, `test.sh` and `typecheck.sh` (`validate.yml`), and `mutants.sh` with the pull request's base
(`mutants.yml`). Both install the latest Claude Code, the version used for development, and `validate.yml` also runs
weekly. When a new release turns CI red, fix the plugins. Run `claude update` first if a test passes locally but
fails in CI.

The marketplace is registered from this checkout, so the installed plugins are whatever is checked out. After a
change, or after merging and pulling `main`, the person runs `/reload-plugins`. A new plugin needs
`/plugin install <name>@astrosteveo-plugins` first.

## Mods in their own repositories

A mod with its own runtime, users or release schedule lives in its own repository. `backlog` does: it is
`astrosteveo/backlog`, checked out at `~/Projects/claude-tasks`. Its `marketplace.json` entry has a `github` source
pinned by `sha`, and no `version`; its own `plugin.json` holds that. The scripts here only cover `plugins/*`, so its
own CI must validate and test it.

- To release it, merge in its repo, then bump the `sha` here in its own pull request.
- To work on it, install it from its own checkout (`/plugin marketplace add ~/Projects/claude-tasks`, then
  `backlog@backlog`), not from this marketplace. Install it from only one marketplace at a time.

## How a mod is laid out

```text
plugins/<name>/
  .claude-plugin/plugin.json   # identity, version, userConfig; "types" points at the contract
  hooks/hooks.json             # { "modules": ["./register.tsx"] }
  hooks/register.tsx           # export const register: Register = (on, options) => { ... }
  hooks/<topic>.ts             # pure logic the tests call directly
  types/index.d.ts             # the $.state contract and shared value types
  tests/*.test.ts(x)
  tsconfig.json                # extends ./.claude-plugin/types/tsconfig.json
  README.md
```

- Every hook is `($, e, next)`. `next(e)` runs the plugins beneath and then the engine.
- The engine only follows `$` into functions declared in `register.tsx`, never across an import. So every function
  that calls `$` lives in `register.tsx`, and everything else moves to the pure `.ts` files. A hook reads what it
  needs through `$`, hands it to a pure function that decides, and writes the result. In `usage`, `crossings` decides
  which toasts a measurement raises, and the `session.measure` hook reads, calls it and writes back.
- Every hook at a gating site (`tool.call`, `tool.check`, `prompt.submit`, `session.append`, the `classic.*` events…)
  ends in `.catch(($, e, next) => fallBack($, e, next, '<site>'))`. `fallBack` logs to the debug log and returns
  `next(e)`. `validate.sh` fails on a gating hook without one.
- Every `$.state` atom is declared in `types/index.d.ts` under the plugin's name; `claude plugin validate` holds the
  module to it. State a drawing reads belongs in `$.state`, not a module variable, which a reload loses.
- `.claude-plugin/types/` is written by Claude Code each time the mod loads, and git ignores it. Switching branches
  can leave a plugin folder holding only these files, which fails `validate.sh`; delete such a folder.

## Tests

Tests import `test` and `expect` from `'claude-code/testing'` and get `($, on)`.

- The test's `on` hooks sit beneath the plugin and stand for the engine. An event the plugin passes on needs an
  answer there. `usage` and `gutter` keep those answers in an `engine(on)` helper; follow that.
- `$` raises events as the engine would: `$.session.measure(...)`, `$.turn.complete(...)`, `$.classic.PostToolUse(...)`,
  `$.command.run(...)`. `$.ui.mount({ plugin, surface, component, requestId, props })` draws a site, and
  `find` / `findAll` / `press` act on it. Run UI tests on both `'terminal'` and `'desktop'`.
- There is no rendered frame. Check layout through element props, such as a `Box`'s `flexDirection`. Find a `Text` by
  its text: its `key` is not kept.

When a fix comes with a regression test, add a mutant: a patch in `scripts/mutants/` that puts the bug back, named
`<id>-<what-breaks>.patch`. Its first line says what it guards and what it breaks (`Guards S-12: …`). Then come one or
more `Test: <where>: <test name>` lines, where `<where>` is a plugin folder (run with `claude plugin test`) or a
`scripts/*.test.mjs` file (run with `node --test`), and the name is exactly as the run prints it. Add
`Test-file: <path>` when the name can't be found by searching the test files. Make a patch by changing the code in a
scratch worktree and saving `git diff` below the header. `mutants.sh` reports `SURVIVED`, `WRONG KILL`, `NO TEST` or
`STALE` for a patch that doesn't hold, and fails.

## Working in this repo

- Work is tracked in the backlog plugin's board (`mcp__backlog__*`), not GitHub issues. Plan with `propose`, and give
  each story who it serves, its approach, testable acceptance criteria and an estimate. Set an item in progress when
  starting, tick each criterion once verified, and send it to review when done. Done is the person's call.
- Branches carry the item's id: `s-12-short-title`, as `/backlog branch S-12` makes. Commit messages start with it
  (`S-12: add the time column`); `fixes S-12` sends the item to review.
- Pull requests are merge commits. Merge once every check is green and the file list has nothing unexpected. Then
  delete the branch locally and on origin, and pull `main`.
- Each change to a plugin bumps its version in **both** `plugins/<name>/.claude-plugin/plugin.json` and its
  `.claude-plugin/marketplace.json` entry: patch for fixes, minor for features. A new plugin also gets a row in the
  README's table and in the table above.
- Write PR text, READMEs and code comments in short, plain sentences. Comments say why, in full sentences, matching
  the code around them. User-facing changes go in the plugin's README.
