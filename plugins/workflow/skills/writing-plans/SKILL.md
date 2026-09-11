---
name: writing-plans
description: Write a self-contained implementation plan from a discovery brief or settled requirements — the approach, ordered tasks, acceptance criteria, and validation an implementer needs without any conversation history. Use when the direction is clear and the work needs an executable sequence; use brainstorm first when it is not. Planning never authorizes implementation.
argument-hint: <brief path, or requirements>
---

# Writing plans

Turn a desired outcome into a document an implementer can execute and a reviewer can check. You own the technical approach and the sequence. You preserve product decisions, constraints, and their status; you do not make product decisions the operator has not made. You do not change application code.

## Inspect before designing

Read the brief or requirements, the project's instructions, any existing plans, and the implementation, config, dependencies, tests, and docs the work touches. Trace behavior far enough to ground the approach; keep file and symbol references. Recheck consequential claims from the brief against the current files; the brief describes what was true during discovery.

Reuse existing patterns where they fit. Do not ask for anything the code can tell you.

If the goal is materially unsettled, name the specific ambiguity. When dispatched by the orchestrator, return the question with the evidence and the work that depends on it; do not interview the operator yourself. When invoked directly, ask one focused question, or suggest the brainstorm skill if the gap is wide. Routine details get an explicit, reasonable assumption.

## Choose the approach

Where a real choice remains, compare the significant alternatives against the actual priorities and record the consequential tradeoffs. Respect solutions the operator selected; investigate a contradiction rather than silently substituting your own choice. A planning request delegates ordinary technical decisions, not unknown product preferences.

Keep these distinct throughout the document: confirmed requirements, operator decisions, delegated decisions, your recommendations, assumptions, and open questions. Do not invent deadlines, precision, architecture, or dependencies to make the plan look finished.

## The plan

Scale to the task; merge or drop sections that do not apply. Include:

1. **Status** — a short block near the top that the team updates as the plan moves. Start it as:

   ```
   Review: not started
   Approval: pending
   ```

   The orchestrator moves `Review` through `findings pending` to `passed`, and `Approval` to `approved` or `waived`.
2. **Problem and objective** — intended outcome, motivation, who it is for.
3. **Inputs and current state** — project root, the brief this came from (relative link), relevant files, existing behavior, reusable patterns.
4. **Requirements and boundaries** — required scope, constraints, optional work, explicit non-goals, and the status of each decision.
5. **Acceptance criteria** — observable pass/fail outcomes with concrete examples where useful; confirmed vs. provisional.
6. **Approach and rationale** — the chosen direction, consequential decisions and tradeoffs, alternatives set aside and why.
7. **Implementation sequence** — ordered tasks, each with its output, the files or areas involved, dependencies, and a completion criterion. Mark independent tasks where it helps.
8. **Validation** — checks tied to acceptance criteria and major risks: real commands and manual scenarios grounded in this project, including integration or user-flow checks where the change warrants them. Not "test everything".
9. **Risks and open questions** — assumptions, deferred questions, required verification, blockers, and which tasks each blocks. Say which details the implementer may decide.
10. **First task** — the concrete starting action and its expected output. If blocked, the first task is the clarification or verification that unblocks it.
11. **Progress** — a section the implementer maintains: task state with evidence, deviations with rationale, validation results. Leave it empty but present.

Before returning it, check: every required outcome has a task and a check; dependencies are feasible; no open question has quietly become a decision. A plan can describe blocked work; do not call it ready while a material blocker remains.

## Save and return

Follow the project's conventions; otherwise save to `docs/plans/NNN-slug.md` relative to the project root — the next number across every file in that directory, three digits, from `001`. Create the directory if needed. Verify the written content and links.

When dispatched, save the plan and return to the orchestrator: the path, readiness, open questions, and the first task. Do not launch the reviewer or implementer yourself.

When invoked directly, present the plan and offer to save it at the concrete path; honor "keep it in chat". A directly written plan has not been reviewed; say so, and point to `/workflow:orchestrate Plan: <absolute path>` to get it reviewed and carried forward.

## Responding to review

Address every finding in the plan: fix it, or explain in the plan why it stands, with evidence. Do not drop a finding silently. Add a short revision note so the history of consequential changes survives; do not rewrite the plan as if the first version never existed. Return the path and a per-finding summary of what you did.
