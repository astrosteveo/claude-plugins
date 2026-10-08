# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A Claude Code plugin marketplace (`astrosteveo-plugins`). Each plugin under `plugins/` is a **mod**: a plugin of
function hooks written in TypeScript/TSX that draws panes, bands and hint text inside Claude Code and hooks its events.
`issue-board` is the big one; `ask`, `usage` and `gutter` are small. Load the `plugin-authoring` skill before
writing or debugging hooks: it points at this build's full API typings (`claude-code.d.ts`), which are the reference
for every event, `$` method and element prop.

## Commands

```sh
sh scripts/validate.sh                      # strict `claude plugin validate` on the marketplace and every plugin, and every gating hook has a .catch (what CI runs)
sh scripts/test.sh                          # run every plugin's tests (what CI runs after validate.sh)
sh scripts/typecheck.sh                     # type-check every plugin against the installed Claude Code (CI runs it last)
sh scripts/mutants.sh                       # put each fixed bug in scripts/mutants/ back and check the tests catch it (about a minute); tests the last commit, so commit first
sh scripts/mutants.sh origin/main           # only the patches the changes since origin/main can affect, as pull requests run it
claude plugin test plugins/issue-board      # run one plugin's *.test.ts(x); there is no per-test filter
claude plugin validate --json plugins/issue-board   # what the module hooks and calls, state keys, gating hooks and `.catch`
npx -p typescript@7 tsc -p plugins/issue-board      # type-check; needs .claude-plugin/types/, see below
claude --plugin-dir ./plugins/issue-board           # try a plugin from this checkout without installing it
```

CI (`.github/workflows/validate.yml`) runs `validate.sh`, then `test.sh`, then `typecheck.sh`. A second workflow,
`mutants.yml`, runs `mutants.sh` on pull requests that touch hooks, tests, `plugin.json` or `scripts/`, with the pull
request's base, so only the patches it can affect run. It runs every patch on each push to `main` that touches those
files, weekly, and by hand. More than four patches run as four parallel jobs. Both install the Claude Code version pinned in `.github/claude-code-version`, so a Claude Code release can't turn CI
red with no change here. `validate.yml` also runs weekly against the latest Claude Code, and by hand with `latest`
ticked. When that run fails, fix the plugins for the new release. Once it passes, bump the pin in its own PR.

The marketplace is registered from this local checkout, so the installed plugins are whatever is checked out here.
After changing a plugin, or after merging and pulling `main`, the person runs `/reload-plugins` to load it.

`.claude/settings.json` sets the board's options under both `issue-board@astrosteveo-plugins` and `issue-board`.
Claude Code keys a plugin's options by the name it loaded it under: the installed plugin is
`issue-board@astrosteveo-plugins`, and one loaded with `claude --plugin-dir` is plain `issue-board`. Keep the two
entries the same.

## How a mod is laid out

- `hooks/hooks.json` names one module, `./register.tsx`, which exports `register: Register = (on, options) => …`.
  Every hook is `($, e, next)`; `next(e)` runs the plugins beneath and the engine's own behavior.
- The `$` rule shapes the rest of the layout. A plugin has one hooks module, and the engine never follows `$` across
  an import: it only follows `$` into functions declared in `register.tsx`. So every function that calls `$` lives in
  `register.tsx`, and everything that doesn't moves out of it, into the pure `.ts` files and the views below. A big `$`
  function gathers GitHub's answers first, hands them to a pure function that decides, and then writes what that
  decided. `moves.ts` is the model: `planMoves` plans the board's automatic Status moves, and `moveOnRead` and
  `applyMoves` in `register.tsx` ask GitHub and apply the plan.
- Every hook at a gating site (`tool.call`, `tool.check`, `prompt.submit`, `ui.close`…) ends in `.catch`, written as a
  function literal that calls `fallBack` (the site's default, `next(e)`, plus a debug log line) or, for the board's own
  tools, `toolFailed` (a deny that names the error).
- issue-board's `register.tsx` is in labelled sections, each opened by a one-line `// ---- … ----` comment, in this
  order: atoms and shared constants; gh and I/O; adoption and grants; refresh and poll, with the movers; project
  writes; capture and filing; setup; workers; plan and triage, with the pane's other actions; tool registration; and
  `register`. Put a new `$` function in the section it belongs to.
- Pure logic lives in sibling `.ts` files and is imported by `register.tsx`. Tests call these directly, with no faked
  `gh`. Put new deciding, layout or text logic there when it can be tested without mounting a pane. Each file is
  imported by name; there is no barrel.
  - ask: `parse.ts` and `decide.ts`.
  - usage and gutter: `format.ts`.
  - issue-board, by topic: `github.ts` (reading gh's issues, pull requests, CI, comments and the project graph, and
    the board a full read makes), `rest.ts` (REST answers: search, project items, milestones, labels), `filters.ts`
    (filters, view tabs, sorting and grouping, `#` rows), `layout.ts` (cell widths, fitting, badges, glyphs, times),
    `prompts.ts` (what the board hands Claude, the system prompt's sections, help text), `boxes.ts` (acceptance
    boxes), `changes.ts` (issue edits and new issues from tool input, and what an edit says), `filing.ts` (filing one
    issue), `moves.ts` (the automatic Status moves), `epics.ts`, `workers.ts` (background agents and handoff),
    `news.ts` (mentions, copies, news on an issue, alerts, runs), `merging.ts` (what a pull request's files flag
    before Finish & merge and Merge all), `setup.ts` (setup's plan and Apply's steps), and
    `access.ts`, `markers.ts`, `plan.ts`, `project.ts`, `settings.ts`, `stats.ts` and `tools.ts`.
- Drawing moved out of `register.tsx` lives in `hooks/views/`, one `.tsx` file per piece. In issue-board these are
  `parts.tsx` (`partsOf`, the small parts rows are built from), `issue-row.tsx`, `pr-row.tsx`, `peek.tsx`,
  `header.tsx` (the pane's header and trends), `tabs.tsx` (the Issues heading), `card.tsx` (the opened issue's card,
  its field buttons, Start buttons and acceptance boxes), `editor.tsx` (the card's editor), `comments.tsx` (the card's
  comments), `plan.tsx` (the project_plan review), `setup.tsx` (setup, the access problems, the adoption ask, and the
  Status and label pickers), `sections.tsx` (the project's update, pull requests and Merge all, CI runs, milestones),
  `list.tsx` (the view note, Closed, the groups with their epic meters, the key hints), `triage.tsx` (the Inbox's
  rows) and `band.tsx` (the band's lines). A view is `(elements, data, handlers) => tree`: the surface's element
  table, plain data, and handlers. Views take handlers rather than `$`. A handler that calls `$` is built in
  `register.tsx`, inside the hook that draws, and passed in; what it does at length is a `$` function there. The
  pane's `ui.render` hook only reads atoms, builds handlers and puts the views together.
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
checked through element props (for example a `Box`'s `position`, `top`, `width`).

In issue-board, use the shared helpers instead of writing your own fakes:

- `tests/github.ts`: `fakeGitHub(on, { issues, prs, branch, project, routes })` answers `gh`/`git` and records what
  ran and what it wrote. Pass `routes` for a test's own calls. It also has `session`, `registrations`, `memoryStore`,
  `heldState`, `adoptedStore` and the named fixtures (`KESSIK`, `ASTEROIDS`, `pr335(ci)`).
- `tests/ui.tsx`: `pane(cols, rows)`, `band(cols)`, `REFRESH`, `RUN`, `COMPOSE`, `REPO`.
- `tests/graph.ts` turns `gh issue list`-shaped fixtures (`Raw`) into the GraphQL answer the board's query expects.
- `tests/narrow.ts` has `assertNoSplitAtoms`. Add a new kind of row to `tests/narrow.test.tsx`'s fixture so it is
  checked at 40 to 120 columns.

When a fix comes with a regression test, add a mutant too: a patch in `scripts/mutants/` that puts the bug back, named
`<issue>-<what-breaks>.patch`, whose first line says which issue it guards and what it breaks. Then come one or more
`Test:` lines, each naming a test that must catch the bug, as `Test: <where>: <test name>`. `<where>` is a plugin
folder such as `plugins/issue-board`, run with `claude plugin test`, or a test file such as
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
`Test-file: plugins/issue-board/tests/planner.test.ts`, naming the file that holds it; with neither, the patch always
runs. A change to `mutants.sh`, `mutants.yml`, `.github/claude-code-version`, a shared test helper (any file in a
plugin's `tests/` that is not a test file), or a plugin's `plugin.json` beyond its `version` line runs every patch. It
prints `skipped` with the reason for each patch it leaves out, and `running` with the reasons for each it runs. A base
it can't find runs every patch. Pull requests run it with their base; the full set on pushes to `main` and weekly
catches the rare survivor a change elsewhere makes, such as a refactor of a helper the patched code calls. In CI a
plan job runs `mutants.sh --list` to pick the patches, and when more than four are picked, four jobs each run
`mutants.sh --shard <i>/4`, which deals the picked patches out in turn and runs its share.

## The call budget

`plugins/issue-board/tests/budget.test.tsx` holds the board to a budget of GitHub calls, as `/issues stats` counts
them, so a change that adds calls fails CI and says by how many. Raise a budget only on purpose, and update this table
with it.

| What | REST | REST 304 | GraphQL |
| --- | --- | --- | --- |
| A refresh | 1 | 1 | 3 |
| Start | 0 | 0 | 3 |
| `issue_update` setting a Priority, with the refresh after it | 1 | 1 | 4 |
| A capture: the closed issues to compare with, the issue, its project item and Status | 2 | 0 | 2 |
| A tick of an issue's last box: its body read and written, and its pull request's body read and `Refs #N` switched to `Closes #N` | 4 | 0 | 0 |
| A `project_plan` of a Status and a Priority, approved, with one refresh after it | 1 | 1 | 5 |
| Setup's Apply on a fresh repo, with the refresh after it | 7 | 0 | 16 |
| Finish & merge: the pull request's files | 1 | 0 | 0 |
| Merge all's confirm: each open pull request's files, here one | 1 | 0 | 0 |
| An idle hour, at the 5-minute setting | 4 | 12 | 14 |

Start adds at most 600 characters to Claude's context: the start message and the working note.

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
