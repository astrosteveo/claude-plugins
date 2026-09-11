---
name: pair
description: Work a task as a Claude and Codex pair with independent plans, parallel implementation in isolated worktrees, and cross-review, with Claude driving. Use for substantial features, refactors, or hard bugs where two models improve the result; not for small settled edits.
argument-hint: <task description>
---

# Pair

Run the full pairing loop for one task. You are the driver: you own the plan, the integration, the verification, and every message to the user. Codex is a partner you consult, delegate to, and review with through the claudex skills.

## Engagement policy

Use judgment about how much Codex involvement the task earns. Each Codex call takes minutes and counts against the user's ChatGPT Pro limits.

| Task | Codex involvement |
| --- | --- |
| Trivial or cosmetic edit, quick question | None |
| Small, well-understood change | Review at the end ([codex-review](../codex-review/SKILL.md)) |
| Medium change, or an unfamiliar area | Consult on the open decision ([codex-ask](../codex-ask/SKILL.md)), review at the end |
| Substantial feature or refactor | Plan duel ([codex-plan](../codex-plan/SKILL.md)), split parallel work ([codex-task](../codex-task/SKILL.md)), review at the end |
| Hard bug with no clear cause | Consult with your findings so far; if still stuck, delegate an independent attempt |

Always say when Codex is engaged and what it contributed. The user drives from this conversation; never make them wait on Codex for something you could do yourself.

## Loop

1. **Understand.** Inspect the code and restate the task, acceptance criteria, and non-goals. Ask the user only what inspection cannot resolve.
2. **Plan.** For non-trivial work, write your plan, then run codex-plan and reconcile. Show the merged plan.
3. **Split.** Identify chunks that are independent of what you will edit. Delegate them with codex-task in the background, one worktree per chunk, while you implement the rest. Do not delegate work that touches your files.
4. **Integrate.** Review each Codex patch critically, apply it, run the checks in the checkout, and drop the worktree.
5. **Review.** Run codex-review on the combined change. Fix confirmed findings and note disputed ones.
6. **Report.** Summarize the result and its verification, then a short pairing summary: what Codex planned, built, or found, and what you changed in response.

## Guardrails

- One writer per file. Codex writes only in its worktree unless you are idle and chose `--no-worktree` deliberately.
- Note the state of the checkout before delegating so patches apply cleanly.
- Keep Codex threads: reply on an existing thread instead of re-explaining.
- If Codex is unavailable or a run fails, say so and continue alone.
- The wrapper is `${CLAUDE_PLUGIN_ROOT}/bin/codex-run`; `codex-run runs` and `codex-run worktrees` show what is in flight.
