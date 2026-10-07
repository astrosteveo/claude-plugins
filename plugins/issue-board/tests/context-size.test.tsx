import { expect, mock, test } from 'claude-code/testing'

import { captureSection, orchestratorSection, workingSection } from '../hooks/prompts'
import { workerPrompt } from '../hooks/workers'
import { fail, fakeGitHub } from './github'
import { REPO } from './ui'

// What the board adds to every request's context: its tools' definitions, and the notes in the system prompt.

// The eight tools' names, descriptions and input schemas came to 12,946 characters before #223 trimmed them. They are
// sent with every request, so they stay at least 35% shorter than that.
const BEFORE = 12946
// project_plan came after #223, for #236: the cap grows by its size and no more. #238's label changes added 282.
const PLAN = 925 + 282
// #239 let a plan change the project's views: the cap grows by what that added and no more.
const VIEWS = 335
// #262 added the capture tool: the cap grows by its size. It removed no tool text.
const CAPTURE = 510

// Each tool's name, description and input schema, in characters, as they were at #301. A tool that grows fails here
// and says by how much, so raise its cap only on purpose.
const CAPS: Record<string, number> = {
  issues: 1431,
  tick: 382,
  issue_update: 3155,
  capture: CAPTURE,
  issue_create: 1466,
  milestone: 392,
  project_status: 383,
  project_archive: 387,
  project_plan: PLAN + VIEWS,
  project_adopt: 457,
}

test('each tool definition stays within its own cap, and all of them at least 35% shorter than before #223', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') })
  const sizes: Record<string, number> = {}
  fakeGitHub(on, { routes: [() => fail('offline')] })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  on('tool.register', async (_$, e) => {
    sizes[e.name] = e.name.length + e.description.length + JSON.stringify(e.inputSchema).length
    return { value: { tool: `mcp__issue-board__${e.name}` } }
  })
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(Object.keys(sizes).sort()).toEqual(Object.keys(CAPS).sort())
  // Every tool over its cap, with how far over.
  expect(Object.entries(sizes).flatMap(([name, size]) => (size > (CAPS[name] ?? 0) ? [`${name}: ${size} > ${CAPS[name]}`] : []))).toEqual([])
  const total = Object.values(sizes).reduce((sum, one) => sum + one, 0)
  expect(total).toBeLessThanOrEqual(Math.floor(BEFORE * 0.65) + PLAN + VIEWS + CAPTURE)
})

test("the worker prompt defers to the repo's guidelines in one sentence and keeps its safety rules", () => {
  for (const rule of [false, true]) {
    const prompt = workerPrompt(rule)
    expect(prompt.match(/CLAUDE\.md/g)?.length).toBe(1)
    expect(prompt).toContain(
      "2. Do the work on a new branch from the default branch, following the repository's CLAUDE.md and contributing guidelines for branches, tests and checks.",
    )
    expect(prompt).toContain("Don't merge, don't force-push, and don't push to the default branch.")
  }
})

test("the working, orchestrator and capture notes don't repeat each other or the tools' own text", () => {
  const working = workingSection({ number: 315, title: 'Lay Kessik out', updatedAt: '' }, false)
  const orchestrator = orchestratorSection()
  // The issues tool says how it numbers boxes, and only the orchestrator note says how to dispatch a worker.
  expect(working).not.toContain('mcp__issue-board__issues')
  expect(working).not.toContain('subagent_type')
  expect(orchestrator).not.toContain('mcp__issue-board__tick')
  expect(orchestrator).not.toContain('needs no permission')
  // The capture section says when to capture; the tool's own text says what it does with a duplicate.
  const capture = captureSection()
  expect(capture).not.toContain('30 days')
  expect(capture).not.toContain('comment')
  expect(capture.length).toBeLessThanOrEqual(240)
})
