import type { Friction, GeneRecord } from '../types'

export type Plan = { id: string; title: string; why: string; spec: string }

const frictionLines = (log: readonly Friction[]): string =>
  log.length === 0
    ? '(nothing recorded yet)'
    : log
        .map(f => `[turn ${f.turn}] ${f.kind}${f.tool ? ` ${f.tool}` : ''}: ${f.detail}`)
        .join('\n')

export const diagnosePrompt = (
  log: readonly Friction[],
  genes: readonly GeneRecord[],
  rejected: readonly string[],
): string => `[Ouroboros: harness introspection. This message comes from a Claude Code plugin, not from the user. Use no tools. Answer with JSON only.]

Ouroboros evolves this Claude Code harness by writing function hooks ("genes") that remove recurring friction between the user and you. This is the friction it recorded (denied or failed tool calls, the user's corrections, interrupted turns), oldest first:

<friction>
${frictionLines(log)}
</friction>

Genes already active:
${genes.length === 0 ? '(none)' : genes.map(g => `- ${g.id}: ${g.title} (${g.why})`).join('\n')}

Genes the user rejected before (never propose these again): ${rejected.length === 0 ? '(none)' : rejected.join(', ')}

From this log AND everything you have seen in this conversation, pick the ONE recurring friction a hook could most reliably remove. A hook can: block or rewrite a tool call before it runs (tool.call); act after a tool ran and hand the model extra context, such as running the tests after an Edit (tool.call, awaiting next); annotate the user's prompt with context (prompt.submit); add a standing instruction to the system prompt (prompt.compose); or react when a turn ends (turn.complete).

Prefer small, deterministic, safe behaviour. Never propose a gene that weakens safety, hides information from the user, deletes data, or acts outside the project.

Answer with exactly one JSON object and nothing else:
{"id":"kebab-case-slug","title":"Short imperative title","why":"One sentence citing the evidence","spec":"Precise behaviour: which event, which matcher, what it does, its edge cases. 3-6 sentences."}
or, when nothing recurs or no hook would help:
{"none":"One sentence why"}`

export const parsePlan = (text: string): Plan | { none: string } | undefined => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    if (typeof value.none === 'string') return { none: value.none }
    const { id, title, why, spec } = value
    if (typeof id !== 'string' || typeof title !== 'string') return undefined
    if (typeof why !== 'string' || typeof spec !== 'string') return undefined
    return { id, title, why, spec }
  } catch {
    return undefined
  }
}

export const GENE_EXAMPLE = `import type { Register } from 'claude-code'

// After an Edit or Write lands, run the project's tests and hand the outcome
// to the model as context on that tool result.
export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isEdit = e.tool === 'Edit' || e.tool === 'Write'
    if (!isEdit || e.agentId !== undefined || ran.deny !== undefined || ran.isError) {
      return ran
    }
    const tests = await $.process.run(['npm', 'test', '--silent'], { timeoutMs: 120000 })
    const outcome = tests.exitCode === 0 ? 'passed' : \`failed (exit \${tests.exitCode})\`
    const tail = (tests.stdout + tests.stderr).slice(-1500)
    return { ...ran, context: [...(ran.context ?? []), \`Tests after this edit \${outcome}:\\n\${tail}\`] }
  })
}
`

export const TEST_EXAMPLE = `import { expect, test } from 'claude-code/testing'

test('hands the test outcome to the model after an Edit', async ($, on) => {
  // Hooks the test registers sit beneath the plugin and stand for the engine.
  on('tool.call', () => ({ result: { ok: true } }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: 'FAIL src/a.test.ts', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  const ran = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })

  expect(ran.context?.join('\\n')).toContain('failed (exit 1)')
})
`

export const GENETICIST_SYSTEM = `You are the Ouroboros geneticist. You write exactly one "gene": a small Claude Code plugin of function hooks that removes one friction, plus a test for it. You work only inside the lab folder you are given, where the plugin's manifest is already laid out, and never edit anything outside it.

The gene's hooks module, hooks/register.ts, looks like this:

\`\`\`ts
${GENE_EXAMPLE}\`\`\`

Its test, tests/<id>.test.ts, looks like this:

\`\`\`ts
${TEST_EXAMPLE}\`\`\`

Rules:
- \`export const register: Register = on => { ... }\`. One registration per event without a matcher: the engine refuses a second; add a matcher (\`{ tool: 'Edit' }\`) or merge the two hooks into one.
- The module runs with no DOM and no Node: everything outside it is reached through \`$\` (\`$.process.run\`, \`$.fs\`, \`$.store\`, \`$.ui.toast\`, \`$.ui.log\`, \`$.model.complete\`, ...). Spell \`$\` only as \`$.noun.call(...)\` or as an argument to a function declared at the top level of the file: never store, spread or return it. Pass \`on\` to nothing. No \`import()\`, no require, no \`$.state\`, no \`$.env\`. Keep anything the gene remembers in \`$.store\`.
- A hook that does not mean to answer returns \`next(e)\`. A hook that acts after the engine awaits \`next(e)\` and returns that result, adding \`context\` if the model should read something.
- Ignore subagents unless the spec says otherwise: \`e.agentId !== undefined\` means the event belongs to a subagent.
- In a test, mock every \`$\` noun the gene calls that has no engine behind it: \`mock.clock(on)\` and \`mock.store(on)\` from 'claude-code/testing', or \`on('<noun>.<call>', ...)\` beneath the plugin as above: a \`$\` call's event (\`process.run\`, \`fs.read\`, ...) is answered there with \`{ value }\` or \`{ deny }\`.
- Keep it under about 120 lines, readable, with sparse comments.
- The API is declared in the file named in your task (about 20,000 lines: grep it for what you need, e.g. \`'tool.call'\`, \`ToolCallResult\`, \`process: {\`, \`PromptComposeSection\`); the test kit is the module 'claude-code/testing' in the same file. Read a declaration before using anything you are unsure of.

Validation loop. Run these and fix what they report until all pass, at most six rounds:
  claude plugin validate <lab>
  claude plugin test <lab>
  tsc -p <lab>        (only when <lab>/tsconfig.json exists)

Finish with one line: what the gene does, and whether every check passed.`

export const geneticistPrompt = (plan: Plan, lab: string, api: string): string => `Lab folder: ${lab}
API declarations: ${api}

Write the gene "${plan.id}": ${plan.title}.
Why: ${plan.why}

Behaviour to implement:
${plan.spec}

Files: ${lab}/hooks/register.ts and ${lab}/tests/${plan.id}.test.ts. The manifest and hooks.json are already there; touch nothing else.`
