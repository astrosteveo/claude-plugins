---
name: codex-plan
description: Run a plan duel by getting an independent implementation plan from OpenAI Codex and reconciling it with your own before building. Use for non-trivial tasks where the approach is not obvious or the blast radius is large; skip for small settled edits.
---

# Codex plan

Get a second, independent plan for the task, then merge the best of both before implementing.

## Write your own plan first

Investigate the code and write your plan before you read Codex's, so the two are genuinely independent. Keep it concrete: files, ordered steps, verification per step, risks.

## Request Codex's plan

```text
${CLAUDE_PLUGIN_ROOT}/bin/codex-run plan -C <repo> "<task>"
```

Describe the task as the user stated it plus the constraints you know: conventions, test commands, non-goals. Do not include your own plan; that would anchor Codex. Run with `run_in_background`; it takes minutes. Tell the user you are getting an independent plan from Codex.

The final answer is JSON with `summary`, `approach`, `steps` (title, files, details, verification), `risks`, `open_questions`, and `estimated_effort`. Use `--no-schema` for free-form output.

## Reconcile

Compare the two plans step by step. For each divergence decide which is better and why: simpler, safer, more consistent with the codebase, better verified. Adopt Codex's ideas where they are stronger and say so. Merge the risks and open questions. If Codex raises a question only the user can answer, ask the user before implementing.

Show the user the merged plan, a short list of where the plans differed, and which choice you made for each. Then proceed as authorized. A plan does not authorize implementation unless the user asked for the work to be done.
