---
name: brainstorm
description: Help the operator figure out what they want before anything gets planned — from "no idea yet" to a direction clear enough to plan against. Runs as a conversation in the main thread and ends with a saved discovery brief. Use when the goal is unclear, ideas compete, or the operator asks to explore; not for requests with settled requirements.
argument-hint: <idea, problem, or nothing at all>
---

# Brainstorm

Find out what is worth doing, why, and what a good result looks like. This is a conversation, not a questionnaire. It ends with a discovery brief that a planner can act on without having been in the room. Brainstorming never authorizes implementation.

## Inspect before you ask

If the idea touches an existing codebase, look at it first: project instructions, the relevant structure, and the code, config, tests, and docs that establish current behavior. Go deep enough on the paths that matter to ground the conversation; skip the full audit. Keep file references for the brief.

Never ask the operator something the code or docs can answer. Existing behavior tells you what is; it does not tell you what the operator wants.

If there is no codebase — a new project, or a non-code idea — work from the conversation and do not invent a repository requirement.

## Meet them where they are

**No idea yet.** Start from interests, recurring frustrations, people they want to help, things they want to learn, or examples they like. Pick a promising thread from what they have said. Generate possibilities once there is something to anchor on.

**Rough direction.** Dig into the underlying need, the scenarios that matter, the assumptions, and the alternatives. Separate the solution they named from the need it serves.

**Mostly know what they want.** Focus on the unresolved decisions and contradictions. Do not reopen what they have already settled.

Adapt depth to what they ask for. An explicit request for a long open-ended session is honored; so is "keep this short".

## How to converse

One focused question per turn. Choose it from the last answer and from whichever uncertainty would most change the direction. Before asking, check whether inspection could answer it instead.

Ask for the reasoning behind a choice, a concrete example, a counterexample, or what evidence would change their mind — when the answer could alter the direction. Follow one line of thought at a time and say what it revealed. Do not stack "why" five deep.

Bring your own analysis. Offer examples, alternatives, and a recommendation when the context supports one; do not make the operator do all the thinking. When it helps, give two to four options as a numbered list with a **Recommended** first option tied to their stated goals, and accept a number, a mix, or a rejection as the answer. When context is insufficient — especially about their personal motivations — ask an open question instead of manufacturing a recommendation.

Mention these controls early and honor them throughout:

| They say | You do |
| --- | --- |
| `skip` | Mark the question deferred and move on. Do not infer an answer. |
| `not sure` | Record the uncertainty. Offer an example, a smaller question, or defer it. Uncertainty is not delegation. |
| `recommend for me` | Decide, with rationale and stated assumptions, or name the fact you would need to decide responsibly. |
| `back` | Revisit the previous question or a named decision; reopen anything that depended on it. |
| `finish` | Stop and write the best brief you can, marking what is provisional and what is blocked. |

Keep a compact working record: confirmed requirements, operator decisions, delegated decisions, your proposals, assumptions, evidence, and open or deferred questions. Never quietly promote one category into another. Summarize the emerging picture every few turns and let them correct it.

## What to explore

Only what is relevant to this idea:

- The problem, the motivation, who it is for, and the current situation.
- What a good result looks like: observable outcomes, concrete scenarios, examples.
- Constraints: time, resources, existing systems, preferences, non-negotiables.
- Required scope, nice-to-haves, explicit non-goals, and alternatives considered.
- Dependencies, tradeoffs, risks, and the assumptions that would change the direction if wrong.

When a fact needs research, do it if you can and keep the source; otherwise say what needs checking, how, and what depends on it. Do not invent facts.

## Converge

Keep exploration and commitment separate. When real alternatives exist, compare a few against the operator's actual priorities and recommend one with its tradeoffs; its status stays "recommended" until the operator picks or delegates.

The brief is ready when the objective, scope, major constraints, chosen direction, and success criteria are clear enough to plan against. It does not need to settle architecture or tasks; that is the planner's job. Ask about a remaining question only if the answer could change the direction. Handle small things with an explicit, reasonable assumption.

Do not rush to the deliverable because the idea sounds feasible, and do not drag out discovery once the purpose is clear. `finish` is immediate. A brief may describe several candidates or an unresolved blocker if the operator finishes before choosing.

## The brief

Self-contained; a planner reads it without the conversation. Scale to the task and drop irrelevant sections.

1. **Problem and objective** — the need, why it matters, the intended outcome.
2. **Users and scenarios** — who, and the concrete situations that matter.
3. **Success** — observable outcomes and acceptance criteria where known; mark provisional ones.
4. **Scope and constraints** — required, optional, explicit non-goals, hard constraints.
5. **Direction and rationale** — candidates considered, the chosen or recommended direction and its status, and why the others were set aside.
6. **Evidence** — what the codebase shows, with file references; sources; observations kept separate from inference.
7. **Decisions and open questions** — confirmed, operator-decided, delegated, assumed, deferred, blocked; each with its status intact.
8. **Planning handoff** — what is ready, what the planner must inspect or decide, and any product question that blocks dependent planning.

No implementation sequence, no invented technical detail, no false precision.

## Save and hand off

Follow the project's conventions; otherwise save to `docs/briefs/NNN-slug.md` relative to the project root — the next number across every file in that directory, three digits, from `001`. Create the directory if needed. Verify the written file.

When the orchestrator invoked you and planning is within the authorized scope, save and hand the path back without a transition question. When invoked directly, present the brief, offer to save it at the concrete path, and honor "keep it in chat".

When the session ends here, give the resume command on its own line so it can be copied:

`/workflow:orchestrate Brief: <absolute brief path>`
