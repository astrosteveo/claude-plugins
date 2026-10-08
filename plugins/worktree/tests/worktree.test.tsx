import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { STOPPED_KEPT, checkoutOf, isInside, mayStop, noteFor, pathOf, reasonFor, withStopped } from '../hooks/guard'
import type { Checkout } from '../hooks/guard'

const MAIN: Checkout = { top: '/repo', branch: 'main', defaultBranch: 'main', isLinked: false }

// Neither stream of a git run is cut short.
const NOT_CUT = { isStdoutTruncated: false, isStderrTruncated: false }

// A git checkout as `git rev-parse` reports it, and origin/HEAD.
type Git = { top: string; branch: string; gitDir: string; commonDir: string; originHead?: string }
const ON_MAIN: Git = { top: '/repo', branch: 'main', gitDir: '/repo/.git', commonDir: '/repo/.git', originHead: 'origin/main' }

// The engine beneath the plugin: the session's folder, git as `git` says it
// (`git.now` can change mid-test, as entering a worktree does), and each
// tool call answered.
function engine(on: On, git: { now: Git }, ran: string[] = []) {
  on('session.cwd', async () => ({ value: git.now.top }))
  on('process.run', async (_$, e) => {
    const { now } = git
    if (e.argv.includes('rev-parse')) {
      return { value: { exitCode: 0, stdout: `${now.top}\n${now.branch}\n${now.gitDir}\n${now.commonDir}\n`, stderr: '', ...NOT_CUT } }
    }
    if (e.argv.includes('symbolic-ref')) {
      return { value: now.originHead === undefined ? { exitCode: 128, stdout: '', stderr: 'no ref', ...NOT_CUT } : { exitCode: 0, stdout: `${now.originHead}\n`, stderr: '', ...NOT_CUT } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', ...NOT_CUT } }
  })
  on('tool.call', async (_$, e) => {
    ran.push(`${e.tool} ${String((e as { file_path?: string }).file_path)}`)
    return { result: {} } as never
  })
  on('ui.log', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
}

const edit = (path: string, id = 'tu1') => ({ tool: 'Edit', tool_use_id: id, file_path: path, old_string: 'a', new_string: 'b' }) as never
const ORIGIN = { kind: 'composer' } as const
const prompt = (text: string) => ({ text, wait: false, origin: ORIGIN })
const ROW = { tool_use_id: 'tu1', tool: 'Edit', input: {}, isRunning: false, isErrored: true, isInterrupted: false } as const

test('git output reads as a checkout', () => {
  expect(checkoutOf('/repo\nmain\n/repo/.git\n/repo/.git\n', 'origin/main\n')).toEqual(MAIN)
  expect(checkoutOf('/wt\ns-1\n/repo/.git/worktrees/wt\n/repo/.git\n', 'origin/main')).toMatchObject({ branch: 's-1', isLinked: true })
  expect(checkoutOf('/repo\nHEAD\n/repo/.git\n/repo/.git\n', undefined)).toMatchObject({ branch: undefined, defaultBranch: undefined })
})

test('only an edit by the main loop may be stopped', () => {
  expect(mayStop(undefined, 'Edit')).toBe(true)
  expect(mayStop(undefined, 'Write')).toBe(true)
  expect(mayStop('agent-1', 'Edit')).toBe(false)
  expect(mayStop(undefined, 'Read')).toBe(false)
  expect(pathOf({ notebook_path: '/repo/a.ipynb' })).toBe('/repo/a.ipynb')
  expect(pathOf({ command: 'ls' })).toBeUndefined()
})

test('only an edit inside the checkout, on its default branch, outside a worktree, is stopped', () => {
  expect(reasonFor(MAIN, '/repo/src/a.ts')).toContain('EnterWorktree')
  expect(reasonFor({ ...MAIN, branch: 's-1' }, '/repo/a.ts')).toBeNull()
  expect(reasonFor({ ...MAIN, isLinked: true }, '/repo/a.ts')).toBeNull()
  expect(reasonFor(MAIN, '/home/me/.claude/notes.md')).toBeNull()
  // A folder that only starts with the same name is outside.
  expect(isInside('/repo-other/a.ts', '/repo')).toBe(false)
  // Without origin/HEAD, main and master count as the default.
  expect(reasonFor({ ...MAIN, defaultBranch: undefined, branch: 'master' }, '/repo/a.ts')).not.toBeNull()
  expect(reasonFor({ ...MAIN, defaultBranch: undefined, branch: 'dev' }, '/repo/a.ts')).toBeNull()
})

test('a feature branch, a worktree, a subagent and a file outside the repo are never stopped', async ($, on) => {
  const ran: string[] = []
  const git = { now: { ...ON_MAIN, branch: 's-1' } }
  engine(on, git, ran)
  expect((await $.tool.call(edit('/repo/a.ts'))).deny).toBeUndefined()
  git.now = { ...ON_MAIN, top: '/wt', branch: 'main', gitDir: '/repo/.git/worktrees/wt' }
  expect((await $.tool.call(edit('/wt/a.ts'))).deny).toBeUndefined()
  git.now = ON_MAIN
  expect((await $.tool.call(edit('/tmp/scratch.txt'))).deny).toBeUndefined()
  expect((await $.tool.call({ ...(edit('/repo/a.ts') as object), agentId: 'a1' } as never)).deny).toBeUndefined()
  expect(ran).toHaveLength(4)
})

test('turned off, nothing is stopped and no note is added', { options: { enabled: false } }, async ($, on) => {
  const ran: string[] = []
  engine(on, { now: ON_MAIN }, ran)
  expect((await $.tool.call(edit('/repo/a.ts'))).deny).toBeUndefined()
  expect((await $.prompt.submit(prompt('Fix it'))).context).toBeUndefined()
  expect(ran).toEqual(['Edit /repo/a.ts'])
})

test('every edit on main is stopped, and an edit in the worktree goes through', async ($, on) => {
  const git = { now: ON_MAIN }
  engine(on, git)
  expect(await $.tool.call(edit('/repo/a.ts'))).toMatchObject({ deny: expect.stringContaining('EnterWorktree') })
  expect(await $.tool.call(edit('/repo/a.ts', 'tu2'))).toMatchObject({ deny: expect.stringContaining('Every edit on this branch') })
  git.now = { top: '/repo/.claude/worktrees/fix', branch: 'worktree-fix', gitDir: '/repo/.git/worktrees/fix', commonDir: '/repo/.git' }
  expect((await $.tool.call(edit('/repo/.claude/worktrees/fix/a.ts'))).deny).toBeUndefined()
})

test('when git fails the edit goes through', async ($, on) => {
  on('session.cwd', async () => ({ value: '/repo' }))
  on('process.run', async () => {
    throw new Error('git is missing')
  })
  on('tool.call', async () => ({ result: {} }) as never)
  const logged: string[] = []
  on('ui.log', async (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  expect((await $.tool.call(edit('/repo/a.ts'))).deny).toBeUndefined()
  expect(logged.some(line => line.startsWith('worktree: tool.call failed'))).toBe(true)
})

test('the stopped list keeps the newest ids', () => {
  const many = Array.from({ length: STOPPED_KEPT }, (_, i) => `tu${i}`)
  expect(withStopped([], 'a')).toEqual(['a'])
  expect(withStopped(many, 'new')).toHaveLength(STOPPED_KEPT)
  expect(withStopped(many, 'new').at(-1)).toBe('new')
  expect(withStopped(many, 'new')[0]).toBe('tu1')
})

test('only the default branch, outside a worktree, has a note', () => {
  expect(noteFor(MAIN)).toContain('EnterWorktree')
  expect(noteFor({ ...MAIN, branch: 's-1' })).toBeNull()
  expect(noteFor({ ...MAIN, isLinked: true })).toBeNull()
  expect(noteFor({ ...MAIN, branch: undefined })).toBeNull()
})

test('a prompt on main tells Claude to move first, until it has moved', async ($, on) => {
  const git = { now: ON_MAIN }
  engine(on, git)
  const first = await $.prompt.submit(prompt('Fix the band'))
  expect(first.context).toEqual([expect.stringContaining('call EnterWorktree')])
  expect(first.text).toBe('Fix the band')
  git.now = { top: '/repo/.claude/worktrees/fix', branch: 'worktree-fix', gitDir: '/repo/.git/worktrees/fix', commonDir: '/repo/.git' }
  expect((await $.prompt.submit(prompt('And the pane'))).context).toBeUndefined()
})

test('the note keeps coming after a stop, while the session is still on main', async ($, on) => {
  engine(on, { now: ON_MAIN })
  await $.tool.call(edit('/repo/a.ts'))
  expect((await $.prompt.submit(prompt('Go on'))).context).toEqual([expect.stringContaining('call EnterWorktree')])
})

test('a feature branch adds no note', async ($, on) => {
  engine(on, { now: { ...ON_MAIN, branch: 's-1' } })
  expect((await $.prompt.submit(prompt('Fix it'))).context).toBeUndefined()
})

test('each stopped edit draws as a dim note, and other rows as the engine draws them', async ($, on) => {
  engine(on, { now: ON_MAIN })
  await $.tool.call(edit('/repo/a.ts', 'tu1'))
  await $.tool.call(edit('/repo/a.ts', 'tu3'))
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const id of ['tu1', 'tu3']) {
      const row = await $.ui.mount({ plugin: 'worktree', surface, component: 'ToolUse', requestId: id, props: { ...ROW, tool_use_id: id } })
      expect(await row.find({ type: 'Text', text: '○ Edit stopped to move into a worktree first' })).toMatchObject({ props: { dimColor: true } })
      expect(await row.find({ type: 'Text', text: 'engine row' })).toBeUndefined()
      await row.unmount()
    }
    const result = await $.ui.mount({ plugin: 'worktree', surface, component: 'ToolResult', requestId: 'tu1', props: { tool_use_id: 'tu1', tool: 'Edit', output: 'refused', isErrored: true } as never })
    expect(await result.find({ type: 'Text', text: '  ⎿ Claude makes the edit again.' })).toMatchObject({ props: { dimColor: true } })
    await result.unmount()
    const other = await $.ui.mount({ plugin: 'worktree', surface, component: 'ToolUse', requestId: 'tu2', props: { ...ROW, tool_use_id: 'tu2' } })
    expect(await other.find({ type: 'Text', text: 'engine row' })).toBeDefined()
    await other.unmount()
  }
})

test('when git fails the prompt goes in unchanged', async ($, on) => {
  on('session.cwd', async () => ({ value: '/repo' }))
  on('process.run', async () => {
    throw new Error('git is missing')
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('ui.log', async () => ({ value: undefined }))
  const entered = await $.prompt.submit(prompt('Fix it'))
  expect(entered).toMatchObject({ text: 'Fix it' })
  expect(entered.context).toBeUndefined()
})
