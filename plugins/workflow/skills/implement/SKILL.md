---
name: implement
description: Execute an approved plan or a small settled change, validate the behavior, and hand back an evidence-backed report for independent review. Use for plan execution and for in-scope corrections returned by the reviewer. Do not treat a planning-only or review-only request as permission to edit.
argument-hint: <plan path, or a settled change>
---

# Implement

Deliver the behavior and prove it. The plan is the agreed direction plus explicit assumptions; it is not proof that its description of the code is still current.

## Baseline

Read the plan (or the settled request), the brief it links to, and the project's instructions. Inspect the affected code and the available checks. Look at the working tree before editing so you can separate your changes from anything pre-existing; preserve unrelated work.

Pull out the acceptance criteria, task order, constraints, and anything blocked. If a missing decision would materially change behavior or scope, look for the answer in the code first; if it is not there, return the question and its impact to the orchestrator (or ask the operator when working directly) and continue with the work that does not depend on it.

## Execute

Work in dependency order and finish the authorized scope. Follow the project's patterns and use relevant domain skills when they help. Keep changes focused; no drive-by cleanup.

Decide ordinary implementation details from project evidence. When a plan assumption turns out wrong, record the evidence, pick a compatible adjustment that still meets the requirements, and log the deviation in the plan's progress section. Escalate before doing dependent work if the fix would change the objective, public behavior, a major constraint, or an acceptance criterion; never quietly shrink the target to fit.

Keep the plan's progress section current: task state with concise evidence, deviations with rationale. A checked box is not evidence. Do not create a plan for a trivial change that did not have one.

## Validate

Run the checks the project requires and the ones the change warrants. Add or update tests where they protect a real requirement or regression, not to mirror implementation details. For user-facing or integration work, exercise the actual flow or boundary when you can; a green unit suite or a successful build is not the same thing.

Report passed, failed, and not-run separately, with the commands or scenarios and material environment limits. Investigate any failure your change could have caused; back up "pre-existing" with evidence. Never claim completion with an unmet acceptance criterion, and never say a check ran when you only read the code.

## Report

Return to the orchestrator (or the operator, when direct):

- What was implemented and how it maps to each acceptance criterion.
- Exact files changed, and the review scope; identify anything pre-existing in the tree.
- Deviations from the plan, with rationale and the assumptions they affect.
- Validation: what ran, results, what could not run.
- Remaining work, blockers, and known risks that bear on acceptance.

Do not spawn the reviewer or start another stage. Working directly, present the same evidence without implying an independent review happened.

## Responding to review

Reproduce or verify each finding before touching code. Fix the substantiated in-scope ones, rerun the relevant checks, and report the resolution per finding. Dispute a finding only with concrete evidence, not by restating the original rationale. Keep optional suggestions and out-of-scope observations separate from required repairs and do not silently act on them.
