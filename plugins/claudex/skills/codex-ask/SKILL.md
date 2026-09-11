---
name: codex-ask
description: Get an independent second opinion from OpenAI Codex on a design choice, a hard bug, an unfamiliar API, or a trade-off, without Codex editing anything. Use when a second model's judgment would change what you do next; skip it for trivia and quick lookups.
---

# Codex ask

Consult Codex as a read-only second opinion. You stay the driver: weigh its answer against your own reading of the code and decide.

## When to ask

- A design or architecture decision with real trade-offs.
- A bug you cannot reproduce or explain after an honest attempt.
- An unfamiliar library, protocol, or platform where a second reading lowers risk.
- A point where you and the user disagree about a technical premise.

Do not ask for things you can settle by reading the code or running a test in under a minute, and do not ask the same question twice.

## Compose the question

Codex starts with no context except the repository. Write a self-contained question: the goal, the specific decision or symptom, the files and lines involved, what you already tried or ruled out, and the exact form of answer you want (a recommendation, a ranked list, a diagnosis). Prefer one focused question over a bundle. Read the question back as a stranger would.

## Run it

```text
${CLAUDE_PLUGIN_ROOT}/bin/codex-run ask -C <repo> "<question>"
```

Pipe a long question on stdin with `-` instead of an argument. Announce to the user in one sentence that you are consulting Codex and why. Codex answers at the user's configured reasoning effort and may take several minutes; run with `run_in_background` unless you expect a quick answer, and keep working on what does not depend on it. Add `--effort low` for simple questions to save time and quota.

The report contains the thread id. Continue the same conversation with `codex-run reply <thread-id> "<follow-up>"` rather than starting over.

## Use the answer

Read Codex's answer critically. Verify concrete claims against the files it cites before acting on them. Where you disagree, say so and explain. Tell the user in one or two sentences what Codex said and what you decided. Do not present Codex's view as settled fact.
