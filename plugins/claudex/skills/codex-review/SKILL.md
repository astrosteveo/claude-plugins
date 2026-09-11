---
name: codex-review
description: Get an independent code review from OpenAI Codex of uncommitted changes, a branch against its base, or a commit, then triage its findings. Use after finishing a non-trivial change and before reporting it done; skip for one-line or cosmetic edits.
---

# Codex review

Ask Codex to review the diff with fresh eyes, then confirm or reject each finding yourself.

## Scope the review

```text
${CLAUDE_PLUGIN_ROOT}/bin/codex-run review -C <repo>
```

That reviews uncommitted changes. Use `--base <branch>` for a whole branch or `--commit <sha>` for one commit. Add `--focus "<instructions>"` to steer it toward what matters: a threat model, a performance budget, a specific invariant. Make sure the working tree holds exactly the changes you want reviewed; note unrelated edits first.

Run with `run_in_background`; reviews take minutes. Tell the user you are getting a Codex review.

## Triage the findings

Codex's findings are claims, not verdicts. For each one, check the code: confirm real defects and fix them; mark speculative or mistaken ones as disputed with a reason; treat style opinions as optional. Do not fix unrelated things Codex did not find unless they are real bugs.

If you fixed anything significant, one more pass with `--focus "verify the fixes for: ..."` is reasonable. Do not loop indefinitely.

## Report

Tell the user how many findings Codex raised, which you fixed, which you disputed and why, and anything that needs their decision. Keep it to a few sentences unless a finding changes the plan.
