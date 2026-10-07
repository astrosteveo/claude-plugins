import { expect, test } from 'claude-code/testing'

import { PANE, github } from './claude-plugins'
import { adoptedStore } from './github'
import { REFRESH } from './ui'

// What the board's tools and the commands it watches ask before they run, and what a failed check falls back to.

test("moving the Status of the issue Claude is on doesn't ask; any other change does", async ($, on) => {
  adoptedStore(on)
  github(on)
  // Beneath the board, Claude Code asks before a tool that changes something.
  on('tool.check', async () => ({ decision: 'ask' as const }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'start-43' })

  const check = (input: Record<string, unknown>) => $.tool.check({ tool: 'mcp__issue-board__issue_update', input })
  expect((await check({ number: 43, status: 'Verification' })).decision).toBe('allow')
  expect((await check({ number: 35, status: 'Verification' })).decision).toBe('ask')
  expect((await check({ number: 43, status: 'Done', comment: 'Done.' })).decision).toBe('ask')
  expect((await check({ number: 43, addLabels: ['bug'] })).decision).toBe('ask')
  await ui.unmount()
})

test('a permission check that fails falls back to the verdict beneath, and says why in the debug log', async ($, on) => {
  adoptedStore(on)
  github(on)
  // Beneath the board, Claude Code would run the command.
  on('tool.check', async () => ({ decision: 'allow' as const }))
  // Once the board is up, its copy reads back malformed, so the check on closing an epic throws.
  let malformed = false
  on('state.get', async (_$, e, next) => {
    const got = await next(e)
    if (!malformed || e.key !== 'board' || !got.value?.value) return got
    return { value: { ...got.value, value: { ...(got.value.value as object), issues: 'malformed' } } }
  })
  const logged: string[] = []
  on('ui.log', async (_$, e) => {
    if (e.to === 'debug') logged.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)
  malformed = true

  // The command still runs as Claude Code decided, rather than being refused, so a fault in the board blocks no command.
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'gh issue close 35' } })
  expect(verdict.decision).toBe('allow')
  expect(logged.some(line => line.startsWith('issue-board: tool.check on Bash failed and was left to the default:'))).toBe(true)

  // One of the board's own tools has nothing beneath to fall back to: Claude reads why it failed.
  malformed = false
  const listed = await $.tool.call({ tool: 'mcp__issue-board__issues', area: 5 })
  expect(listed.deny).toMatch(/^The issue board's issues tool failed: /)
})

test("an organization's ceiling of ask keeps both board tools asking; one of allow, or none, changes nothing", async ($, on) => {
  adoptedStore(on)
  github(on)
  on('tool.check', async () => ({ decision: 'ask' as const }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'start-43' })

  const move = { number: 43, status: 'Verification' }
  const update = (ceiling?: 'allow' | 'ask') => $.tool.check({ tool: 'mcp__issue-board__issue_update', input: move, ...(ceiling ? { ceiling } : {}) })
  const issues = (ceiling?: 'allow' | 'ask') => $.tool.check({ tool: 'mcp__issue-board__issues', input: {}, ...(ceiling ? { ceiling } : {}) })
  expect((await update('ask')).decision).toBe('ask')
  expect((await issues('ask')).decision).toBe('ask')
  expect((await update('allow')).decision).toBe('allow')
  expect((await issues('allow')).decision).toBe('allow')
  expect((await update()).decision).toBe('allow')
  expect((await issues()).decision).toBe('allow')
  await ui.unmount()
})
