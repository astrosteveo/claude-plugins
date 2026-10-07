# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A Claude Code plugin marketplace (`astrosteveo-plugins`). Each plugin under `plugins/` is a **mod**: a plugin of
function hooks written in TypeScript/TSX that draws panes, bands and hint text inside Claude Code and hooks its events.
`issue-board` is the big one; `ask` is small. Load the `plugin-authoring` skill before writing or debugging hooks: it
points at this build's full API typings (`claude-code.d.ts`), which are the reference for every event, `$` method and
element prop.

## Commands

```sh
sh scripts/validate.sh                      # strict `claude plugin validate` on the marketplace and every plugin, and every gating hook has a .catch (what CI runs)
sh scripts/test.sh                          # run every plugin's tests (what CI runs after validate.sh)
sh scripts/typecheck.sh                     # type-check every plugin against the installed Claude Code (CI runs it last)
sh scripts/mutants.sh                       # put each fixed bug in scripts/mutants/ back and check the tests catch it (about a minute)
claude plugin test plugins/issue-board      # run one plugin's *.test.ts(x); there is no per-test filter
claude plugin validate --json plugins/issue-board   # what the module hooks and calls, state keys, gating hooks and `.catch`
npx -p typescript tsc -p plugins/issue-board        # type-check; needs .claude-plugin/types/, see below
```

CI (`.github/workflows/validate.yml`) runs `validate.sh`, then `test.sh`, then `typecheck.sh`. A second workflow,
`mutants.yml`, runs `mutants.sh` on pull requests that touch hooks, tests, `plugin.json` or `scripts/`, and weekly.

The marketplace is registered from this local checkout, so the installed plugins are whatever is checked out here.
After changing a plugin, or after merging and pulling `main`, the person runs `/reload-plugins` to load it.

## How a mod is laid out

- `hooks/hooks.json` names one module, `./register.tsx`, which exports `register: Register = (on, options) => …`.
  Every hook is `($, e, next)`; `next(e)` runs the plugins beneath and the engine's own behavior.
- Every hook at a gating site (`tool.call`, `tool.check`, `prompt.submit`, `ui.close`…) ends in `.catch`, written as a
  function literal that calls `fallBack` (the site's default, `next(e)`, plus a debug log line) or, for the board's own
  tools, `toolFailed` (a deny that names the error). The engine only follows `$` into functions declared in
  `register.tsx`, so helpers that take `$` live there, not in `parse.ts`.
- Pure logic lives in sibling `.ts` files (`parse.ts`, and in issue-board `access.ts`, `project.ts`, `setup.ts`) and
  is imported by `register.tsx`. Tests call these directly. Put new layout or text logic there when it can be tested
  without mounting a pane.
- `types/index.d.ts` is the plugin's state contract: every `$.state` atom (`atom({ plugin, key })`) is declared there
  under the plugin's name, and `claude plugin validate` holds the module's keys to it. Add a key there when adding an
  atom. Shared value types (`Issue`, `Board`, `Worker`…) live there too.
- `.claude-plugin/types/` is written by Claude Code each time the mod loads and is gitignored. The plugin's
  `tsconfig.json` extends it. `scripts/typecheck.sh` gets it written by a headless `claude --plugin-dir` run with an
  empty config folder, which is signed out, so it loads the plugin and stops before sending a prompt.

## Tests

Test files import `test` and `expect` from `'claude-code/testing'`. A test gets `($, on)`: `on('process.run', …)` fakes
`gh`/`git` answers, `$.command.run(...)` runs `/issues`, and `$.ui.mount({ plugin, surface, component: 'Pane', … })`
draws the pane so `ui.find` / `ui.findAll` / `ui.press` can inspect it. There is no rendered frame, so layout is
checked through element props (for example a `Box`'s `position`, `top`, `width`). In issue-board, `tests/graph.ts`
turns `gh issue list`-shaped fixtures into the GraphQL answer the board's query expects.

When a fix comes with a regression test, add a mutant too: a patch in `scripts/mutants/` that puts the bug back, named
`<issue>-<what-breaks>.patch`, whose first line says which issue it guards and what it breaks. Then come one or more
`Test:` lines, each naming a test that must catch the bug, as `Test: <where>: <test name>`. `<where>` is a plugin
folder such as `plugins/issue-board`, run with `claude plugin test`, or a test file such as
`scripts/config-rows.test.mjs`, run with `node --test`. The name is the test's name exactly as the run prints it after
`(fail)` or `✖`. `scripts/mutants.sh` applies each patch to a clean worktree, runs each named place once, and needs
every named test among the failures. It reports `SURVIVED` when nothing fails, `WRONG KILL` when the run fails but not
through a named test (a patch that breaks loading, or trips some other test), `NO TEST` when the header names none,
and `STALE` when a patch no longer applies; any of them fails the run. Make a patch by changing the code in a scratch
worktree and saving `git diff` below the header. Remake a stale one the same way against the current code.

## issue-board in brief

The board reads issues, pull requests, CI and the linked GitHub Project through `gh`. It keeps the board in `$.state`
and draws it in three places: the `/issues` pane, the `AbovePrompt` band, and the `PromptHint` tail. It also
registers MCP tools (`issues`, `issue_update`, `issue_create`, `capture`, `project_plan`, `project_adopt`, `milestone`, `project_status`, `project_archive`, `tick`) and an `issue-board:worker` agent type for "Start in
background". Its `tool.check` hooks adjust permission verdicts for those tools and for `gh issue close` on epics.

It is built around the GitHub Project workflow: Status (Inbox → Backlog → Ready → In Progress → Verification → Done)
and Priority (P0/P1/P2) come from project fields, not labels. Epics are parent issues with native sub-issues. A PR
says `Closes #N` only when merging completes the issue's acceptance list, `Refs #N` otherwise.

## Working in this repo

- Work is tracked as GitHub issues on Project #9 ("claude-plugins"), with Status and Priority set, labels such as
  `bug`/`enhancement` plus `area:issue-board`, and a `## Acceptance` checklist in the body.
- Branches are `fix/<issue>-<slug>` or `feat/<issue>-<slug>`. PRs are merge commits. After merging, delete the
  branch locally and on origin, and pull `main`.
- Each change to a plugin bumps its version in **both** `plugins/<name>/.claude-plugin/plugin.json` and its entry in
  `.claude-plugin/marketplace.json` (patch for fixes, minor for features). When main moved on meanwhile, take the
  next free version.
- Write issues, PR text, READMEs and code comments in short, plain sentences. Code comments explain why, in full
  sentences, matching the existing density. User-facing behavior changes go in the plugin's README.
