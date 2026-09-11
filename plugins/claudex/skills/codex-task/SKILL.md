---
name: codex-task
description: Delegate a self-contained implementation task to OpenAI Codex in an isolated git worktree, then review and integrate its patch. Use to parallelize work that does not touch files you are editing, or to hand off a well-specified subtask; do not use it for edits you can make faster yourself.
---

# Codex task

Hand Codex a bounded implementation task. It works in its own git worktree so your edits and its edits never collide; you review its patch and bring it into the checkout.

## Choose a task worth delegating

Good candidates are self-contained, verifiable, and independent of files you are changing now: a new module behind a defined interface, tests for existing code, a migration, a well-specified refactor in another area, or an independent attempt at a hard problem. Keep tasks that need the user's judgment part-way through, or that overlap your own edits.

## Write the brief

Codex sees only the repository and your brief. Include:

- The goal and the acceptance criteria. Say what "done" means.
- The files or area involved and the interfaces to honor.
- The repository's conventions and the exact build, test, and lint commands.
- Setup a fresh checkout needs. The worktree has no installed dependencies and no ignored files such as `.env`.
- Constraints and explicit non-goals.

## Run it

```text
${CLAUDE_PLUGIN_ROOT}/bin/codex-run task -C <repo> --name <short-slug> "<brief>"
```

Pipe a long brief on stdin with `-`. Always run it with `run_in_background`; implementation runs take many minutes and you are re-invoked when the command exits. Tell the user in one sentence what you delegated, then continue your own work.

By default the worktree branches from `HEAD` and is seeded with the checkout's uncommitted changes as a baseline commit, so Codex builds on what you have. Pass `--exclude-uncommitted` for a clean base or `--base <ref>` for another starting point. Check on a long run with `codex-run show <run-id> --live`.

## Integrate

When the report arrives, read Codex's summary, then inspect the actual patch with `codex-run patch <name> -C <repo>`. Review it as you would a pull request: correctness, scope creep, conventions, tests. Run the tests in the worktree if the report does not show them passing. If it needs changes, continue the same thread with `codex-run reply <thread-id> "<corrections>"`; Codex keeps working in the worktree.

When the patch is acceptable, run `codex-run apply <name> -C <repo>` to apply it onto the checkout with a three-way merge, then run the checks in the checkout and resolve any conflicts yourself. Finally run `codex-run drop <name> -C <repo>` to remove the worktree and branch. Never leave a worktree behind without telling the user.

Report to the user what Codex implemented, what you changed in review, and how it was verified. For a long delegation whose verification is routine, dispatch the whole loop to the `claudex:codex-liaison` agent to keep this conversation small.
