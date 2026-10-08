# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A Claude Code plugin marketplace (`astrosteveo-plugins`). Each plugin under `plugins/` is a **mod**: a plugin of
function hooks written in TypeScript/TSX that draws panes, bands and hint text inside Claude Code and hooks its events.
The plugins are `ask` and `usage`. The issue board that used to live here has moved to its own repository. Load the
`plugin-authoring` skill before writing or debugging hooks: it points at this build's full API typings
(`claude-code.d.ts`), which are the reference for every event, `$` method and element prop.

## Commands

```sh
sh scripts/validate.sh                      # strict `claude plugin validate` on the marketplace and every plugin, and every gating hook has a .catch (what CI runs)
sh scripts/test.sh                          # run every plugin's tests (what CI runs after validate.sh)
sh scripts/typecheck.sh                     # type-check every plugin against the installed Claude Code (CI runs it last)
sh scripts/mutants.sh                       # put each fixed bug in scripts/mutants/ back and check the tests catch it (about a minute); tests the last commit, so commit first
sh scripts/mutants.sh origin/main           # only the patches the changes since origin/main can affect, as pull requests run it
claude plugin test plugins/usage            # run one plugin's *.test.ts(x); there is no per-test filter
claude plugin validate --json plugins/usage # what the module hooks and calls, state keys, gating hooks and `.catch`
npx -p typescript@7 tsc -p plugins/usage    # type-check; needs .claude-plugin/types/, see below
claude --plugin-dir ./plugins/usage         # try a plugin from this checkout without installing it
```

CI (`.github/workflows/validate.yml`) runs `validate.sh`, then `test.sh`, then `typecheck.sh`. A second workflow,
`mutants.yml`, runs `mutants.sh` on pull requests that touch hooks, tests, `plugin.json` or `scripts/`, with the pull
request's base, so only the patches it can affect run. It runs every patch on each push to `main` that touches those
files, weekly, and by hand. More than four patches run as four parallel jobs. Both install the Claude Code version pinned in `.github/claude-code-version`, so a Claude Code release can't turn CI
red with no change here. `validate.yml` also runs weekly against the latest Claude Code, and by hand with `latest`
ticked. When that run fails, fix the plugins for the new release. Once it passes, bump the pin in its own PR.

The marketplace is registered from this local checkout, so the installed plugins are whatever is checked out here.
After changing a plugin, or after merging and pulling `main`, the person runs `/reload-plugins` to load it.

## How a mod is laid out

- `hooks/hooks.json` names one module, `./register.tsx`, which exports `register: Register = (on, options) => …`.
  Every hook is `($, e, next)`; `next(e)` runs the plugins beneath and the engine's own behavior.
- The `$` rule shapes the rest of the layout. A plugin has one hooks module, and the engine never follows `$` across
  an import: it only follows `$` into functions declared in `register.tsx`. So every function that calls `$` lives in
  `register.tsx`, and everything that doesn't moves out of it, into the pure `.ts` files below. A hook gathers what it
  needs through `$` first, hands it to a pure function that decides, and then writes what that decided. In `usage`,
  `crossings` decides which toasts a measurement raises, and the `session.measure` hook reads the atoms, calls it and
  writes back.
- Every hook at a gating site (`tool.call`, `tool.check`, `prompt.submit`, `ui.close`…) ends in `.catch`, written as a
  function literal that calls `fallBack` (the site's default, `next(e)`, plus a debug log line).
- Pure logic lives in sibling `.ts` files and is imported by `register.tsx`. Tests call these directly, with no faked
  engine. Put new deciding, layout or text logic there when it can be tested without mounting a pane. Each file is
  imported by name; there is no barrel.
  - ask: `parse.ts` and `decide.ts`.
  - usage: `format.ts`.
- `types/index.d.ts` is the plugin's state contract: every `$.state` atom (`atom({ plugin, key })`) is declared there
  under the plugin's name, and `claude plugin validate` holds the module's keys to it. Add a key there when adding an
  atom. Shared value types (`Turn`, `Measure`, `Ask`…) live there too.
- `.claude-plugin/types/` is written by Claude Code each time the mod loads and is gitignored. The plugin's
  `tsconfig.json` extends it. `scripts/typecheck.sh` gets it written by a headless `claude --plugin-dir` run with an
  empty config folder, which is signed out, so it loads the plugin and stops before sending a prompt.

## Tests

Test files import `test` and `expect` from `'claude-code/testing'`. A test gets `($, on)`. Its `on` hooks sit beneath
the plugin and stand for the engine: nothing answers an event unless the test does, so a test answers each event the
plugin's hooks pass on (`usage`'s `engine(on)` helper is the model). `$` raises events as the engine would
(`$.session.measure(...)`, `$.turn.complete(...)`, `$.command.run(...)`), and `$.ui.mount({ plugin, surface,
component, … })` draws a site so `ui.find` / `ui.findAll` / `ui.press` can inspect it. Run a UI test on both
`'terminal'` and `'desktop'`. There is no rendered frame, so layout is checked through element props (for example a
`Box`'s `flexDirection` or `width`), and a `Text` is found by its text, since its `key` is not kept.

When a fix comes with a regression test, add a mutant too: a patch in `scripts/mutants/` that puts the bug back, named
`<issue>-<what-breaks>.patch`, whose first line says which issue it guards and what it breaks. Then come one or more
`Test:` lines, each naming a test that must catch the bug, as `Test: <where>: <test name>`. `<where>` is a plugin
folder such as `plugins/usage`, run with `claude plugin test`, or a test file such as
`scripts/config-rows.test.mjs`, run with `node --test`. The name is the test's name exactly as the run prints it after
`(fail)` or `✖`. `scripts/mutants.sh` applies each patch to a clean worktree, runs each named place once, and needs
every named test among the failures. It reports `SURVIVED` when nothing fails, `WRONG KILL` when the run fails but not
through a named test (a patch that breaks loading, or trips some other test), `NO TEST` when the header names none,
and `STALE` when a patch no longer applies; any of them fails the run. It tests the last commit, not uncommitted
changes: each clean worktree is made from HEAD. When a file a patch touches, or the place its tests live, has
uncommitted changes, it prints a warning and notes it beside that patch's verdict; commit and run it again before
trusting the result. Make a patch by changing the code in a scratch
worktree and saving `git diff` below the header. Remake a stale one the same way against the current code.

Given a base ref, as in `sh scripts/mutants.sh origin/main`, it runs only the patches the changes since that base can
affect: a new or changed patch, or one whose touched files or `Test:` test files changed. It finds a plugin test's
file by searching the plugin's test files for the name. When the search can't place a name, such as one built from a
table, add a `Test-file: <path from the repo root>` line to the header, such as
`Test-file: plugins/usage/tests/format.test.ts`, naming the file that holds it; with neither, the patch always
runs. A change to `mutants.sh`, `mutants.yml`, `.github/claude-code-version`, a shared test helper (any file in a
plugin's `tests/` that is not a test file), or a plugin's `plugin.json` beyond its `version` line runs every patch. It
prints `skipped` with the reason for each patch it leaves out, and `running` with the reasons for each it runs. A base
it can't find runs every patch. Pull requests run it with their base; the full set on pushes to `main` and weekly
catches the rare survivor a change elsewhere makes, such as a refactor of a helper the patched code calls. In CI a
plan job runs `mutants.sh --list` to pick the patches, and when more than four are picked, four jobs each run
`mutants.sh --shard <i>/4`, which deals the picked patches out in turn and runs its share.

## Working in this repo

- Work is tracked as GitHub issues on Project #9 ("claude-plugins"), with Status and Priority set, labels such as
  `bug`/`enhancement` plus `area:<plugin>`, and a `## Acceptance` checklist in the body.
- Branches are `fix/<issue>-<slug>` or `feat/<issue>-<slug>`. PRs are merge commits. After merging, delete the
  branch locally and on origin, and pull `main`.
- Each change to a plugin bumps its version in **both** `plugins/<name>/.claude-plugin/plugin.json` and its entry in
  `.claude-plugin/marketplace.json` (patch for fixes, minor for features). When main moved on meanwhile, take the
  next free version.
- Write issues, PR text, READMEs and code comments in short, plain sentences. Code comments explain why, in full
  sentences, matching the existing density. User-facing behavior changes go in the plugin's README.
