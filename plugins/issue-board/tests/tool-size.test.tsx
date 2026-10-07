import { expect, mock, test } from 'claude-code/testing'

import { orchestratorSection, workerPrompt, workingSection } from '../hooks/parse'

const REPO = '/work/void-sector'
// The eight tools' names, descriptions and input schemas came to 12,946 characters before #223 trimmed them. They are
// sent with every request, so they stay at least 35% shorter than that.
const BEFORE = 12946

test('the tool definitions stay at least 35% shorter than before #223: name, description and input schema', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') })
  const sizes: Record<string, number> = {}
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  on('tool.register', async (_$, e) => {
    sizes[e.name] = e.name.length + e.description.length + JSON.stringify(e.inputSchema).length
    return { value: { tool: `mcp__issue-board__${e.name}` } }
  })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(Object.keys(sizes).sort()).toEqual(['issue_create', 'issue_update', 'issues', 'milestone', 'project_adopt', 'project_archive', 'project_status', 'tick'])
  const total = Object.values(sizes).reduce((sum, one) => sum + one, 0)
  expect(total).toBeLessThanOrEqual(Math.floor(BEFORE * 0.65))
})

test("the worker prompt defers to the repo's guidelines in one sentence and keeps its safety rules", () => {
  for (const rule of ['none', 'closes-when-ticked', 'always-closes'] as const) {
    const prompt = workerPrompt(rule)
    expect(prompt.match(/CLAUDE\.md/g)?.length).toBe(1)
    expect(prompt).toContain(
      "2. Do the work on a new branch from the default branch, following the repository's CLAUDE.md and contributing guidelines for branches, tests and checks.",
    )
    expect(prompt).toContain("Don't merge, don't force-push, and don't push to the default branch.")
  }
})

test("the working and orchestrator notes don't repeat each other or the tools' own text", () => {
  const working = workingSection({ number: 315, title: 'Lay Kessik out', updatedAt: '' }, 'none')
  const orchestrator = orchestratorSection()
  // The issues tool says how it numbers boxes, and only the orchestrator note says how to dispatch a worker.
  expect(working).not.toContain('mcp__issue-board__issues')
  expect(working).not.toContain('subagent_type')
  expect(orchestrator).not.toContain('mcp__issue-board__tick')
  expect(orchestrator).not.toContain('needs no permission')
})
