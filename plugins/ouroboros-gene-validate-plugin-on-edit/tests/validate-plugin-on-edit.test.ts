import { expect, test } from 'claude-code/testing'

const PLUGIN = '/work/my-plugin'
const MANIFESTS = [`${PLUGIN}/.claude-plugin/plugin.json`, `${PLUGIN}/hooks/hooks.json`]

function finished(exitCode: number, stdout: string, stderr = '') {
  return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
}

test('hands a failing validate to the model after an Edit to plugin code', async ($, on) => {
  const runs: (readonly string[])[] = []
  on('tool.call', () => ({ result: { ok: true } }))
  on('fs.exists', (_$, e) => ({ value: MANIFESTS.includes(e.path) }))
  on('process.run', (_$, e) => {
    runs.push(e.argv)
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n')
    return finished(1, lines, 'error: tool.call registered twice without a matcher')
  })

  const ran = await $.tool.call({ tool: 'Edit', file_path: `${PLUGIN}/hooks/register.ts`, old_string: 'a', new_string: 'b' })

  expect(runs).toEqual([['claude', 'plugin', 'validate', PLUGIN]])
  expect(ran.context).toHaveLength(1)
  const note = ran.context?.[0] ?? ''
  expect(note).toContain(PLUGIN)
  expect(note).toContain('registered twice without a matcher')
  expect(note).toContain('line 12\n')
  expect(note).not.toContain('line 11\n')
})

test('adds nothing when validate passes, resolving a relative Write', async ($, on) => {
  const runs: (readonly string[])[] = []
  on('tool.call', () => ({ result: { ok: true } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.exists', (_$, e) => ({ value: MANIFESTS.includes(e.path) }))
  on('process.run', (_$, e) => {
    runs.push(e.argv)
    return finished(0, 'Validation passed')
  })

  const ran = await $.tool.call({ tool: 'Write', file_path: 'my-plugin/.claude-plugin/plugin.json', content: '{}' })

  expect(runs).toEqual([['claude', 'plugin', 'validate', PLUGIN]])
  expect(ran.context).toBeUndefined()
})

test('skips other extensions and files outside a plugin', async ($, on) => {
  const runs: (readonly string[])[] = []
  on('tool.call', () => ({ result: { ok: true } }))
  on('fs.exists', (_$, e) => ({ value: MANIFESTS.includes(e.path) }))
  on('process.run', (_$, e) => {
    runs.push(e.argv)
    return finished(1, 'should not run')
  })

  const readme = await $.tool.call({ tool: 'Edit', file_path: `${PLUGIN}/README.md`, old_string: 'a', new_string: 'b' })
  const outside = await $.tool.call({ tool: 'Write', file_path: '/work/app/src/index.ts', content: 'x' })

  expect(runs).toEqual([])
  expect(readme.context).toBeUndefined()
  expect(outside.context).toBeUndefined()
})

test('leaves the result untouched when validate cannot run', async ($, on) => {
  on('tool.call', () => ({ result: { ok: true } }))
  on('fs.exists', (_$, e) => ({ value: MANIFESTS.includes(e.path) }))
  on('process.run', () => ({ deny: 'claude: command not found' }))

  const ran = await $.tool.call({ tool: 'Edit', file_path: `${PLUGIN}/hooks/register.ts`, old_string: 'a', new_string: 'b' })

  expect(ran.deny).toBeUndefined()
  expect(ran.isError).toBeUndefined()
  expect(ran.context).toBeUndefined()
})
