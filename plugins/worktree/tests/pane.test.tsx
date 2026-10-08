import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { isWorktreeName, labelOf, outcomeOf, parseWorktrees } from '../hooks/worktrees'

const PORCELAIN = `worktree /repo
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /repo/.claude/worktrees/fix
HEAD 2222222222222222222222222222222222222222
branch refs/heads/s-12-fix

worktree /work/repo-old
HEAD 3333333333333333333333333333333333333333
detached
locked

worktree /work/gone
HEAD 4444444444444444444444444444444444444444
branch refs/heads/old
prunable gitdir file points to non-existent location
`

const PANE = { component: 'Pane', requestId: 'worktree', props: { title: 'Worktrees', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const NOT_CUT = { isStdoutTruncated: false, isStderrTruncated: false }
const run = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', ...NOT_CUT } })

// The engine beneath the plugin: git answers from PORCELAIN, the session sits
// in `at.now`, the worktree tools are recorded in `called` and answered by
// `answer`, and toasts, commands and debug lines are collected.
function engine(
  on: On,
  { at = { now: '/repo' }, called = [] as unknown[], toasts = [] as string[], registered = [] as string[], logged = [] as string[], builtins = [] as string[], refuse = false, answer = (_e: unknown): unknown => ({ result: { message: 'Moved.' } }) } = {},
) {
  on('session.cwd', async () => ({ value: at.now }))
  on('process.run', async (_$, e) => {
    const args = e.argv.slice(1).join(' ')
    if (args === 'worktree list --porcelain') return run(PORCELAIN)
    if (args === 'rev-parse --show-toplevel') return run(`${at.now}\n`)
    if (args === 'status --porcelain') return run(e.init?.cwd === '/repo/.claude/worktrees/fix' ? ' M a.ts\n' : '')
    return run('', 1)
  })
  on('tool.call', async (_$, e) => {
    called.push(e)
    return answer(e) as never
  })
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', async (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('ui.open', async (_$, e) => ({ value: { id: e.id } }) as never)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.list', async () => ({ value: builtins.map(name => ({ name, description: '', source: 'builtin' })) }) as never)
  on('command.register', async (_$, e) => {
    if (refuse) throw new Error(`"/${e.name}" refused`)
    registered.push(e.name)
    return { value: { command: e.name } }
  })
}

const openPane = ($: Parameters<TestBody>[0]) =>
  $.command.run({ command: 'wt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never)

test('porcelain output reads as worktrees: main, linked, detached and locked, prunable', () => {
  const trees = parseWorktrees(PORCELAIN)
  expect(trees.map(tree => [tree.path, tree.branch, tree.isMain, tree.isLocked, tree.isPrunable])).toEqual([
    ['/repo', 'main', true, false, false],
    ['/repo/.claude/worktrees/fix', 's-12-fix', false, false, false],
    ['/work/repo-old', undefined, false, true, false],
    ['/work/gone', 'old', false, false, true],
  ])
  expect(trees[2]!.head).toBe('3333333333333333333333333333333333333333')
  expect(parseWorktrees('')).toEqual([])
})

test('names and outcomes read short', () => {
  expect(labelOf('/repo', '/repo')).toBe('main checkout')
  expect(labelOf('/repo/.claude/worktrees/fix', '/repo')).toBe('.claude/worktrees/fix')
  expect(labelOf('/work/repo-s-11', '/work/repo')).toBe('../repo-s-11')
  expect(labelOf('/elsewhere/x', '/work/repo')).toBe('/elsewhere/x')
  expect(isWorktreeName('s-12-wt-pane')).toBe(true)
  expect(isWorktreeName('team/s-12')).toBe(true)
  expect(isWorktreeName('has space')).toBe(false)
  expect(isWorktreeName('x'.repeat(65))).toBe(false)
  expect(outcomeOf({ deny: 'no' })).toBe('no')
  expect(outcomeOf({ isError: true, text: 'has changes' })).toBe('has changes')
  expect(outcomeOf({ result: { message: 'Moved.' } })).toBe('Moved.')
})

test('/wt opens the pane', async ($, on) => {
  const registered: string[] = []
  engine(on, { registered })
  await $.session.start({ cwd: '/repo' } as never)
  expect(registered).toEqual(['wt'])
  expect(await openPane($)).toMatchObject({ text: 'Worktrees pane opened.' })
})

test('a refused /wt is logged and the session still starts', async ($, on) => {
  const logged: string[] = []
  engine(on, { refuse: true, logged })
  expect(await $.session.start({ cwd: '/repo' } as never)).toMatchObject({ cwd: '/repo' })
  expect(logged.some(line => line.includes('/wt was not registered'))).toBe(true)
})

test('a built-in /wt is left alone', async ($, on) => {
  const registered: string[] = []
  const logged: string[] = []
  engine(on, { registered, logged, builtins: ['wt'] })
  await $.session.start({ cwd: '/repo' } as never)
  expect(registered).toEqual([])
  expect(logged.some(line => line.includes('/wt is a built-in'))).toBe(true)
})

test('the pane lists each worktree and marks the one the session is in', async ($, on) => {
  engine(on)
  await openPane($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'worktree', surface, ...PANE })
    const names = await ui.findAll({ type: 'Text', text: /^(main checkout|\.claude|\.\.\/|\/)/ })
    expect(names.map(one => one.text)).toEqual(['main checkout', '.claude/worktrees/fix', '/work/repo-old', '/work/gone'])
    expect(await ui.find({ type: 'Text', text: '● ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /s-12-fix · changes/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /detached 3333333 · locked/ })).toBeDefined()
    // A worktree whose folder is gone, and the main checkout, have no Switch.
    expect((await ui.findAll({ type: 'Button', text: /Switch/ })).length).toBe(2)
    // In the main checkout there is nothing to leave, and a new one can be made.
    expect(await ui.find({ type: 'Button', key: 'leave' })).toBeUndefined()
    expect(await ui.find({ type: 'Input', key: 'new' })).toBeDefined()
    await ui.unmount()
  }
})

test('inside a worktree the pane offers to leave it, and the tools get the right input', async ($, on) => {
  const at = { now: '/repo/.claude/worktrees/fix' }
  const called: unknown[] = []
  const toasts: string[] = []
  engine(on, { at, called, toasts })
  await openPane($)
  for (const surface of ['terminal', 'desktop'] as const) {
    called.length = 0
    const ui = await $.ui.mount({ plugin: 'worktree', surface, ...PANE })
    expect(await ui.find({ type: 'Input', key: 'new' })).toBeUndefined()
    await ui.press({ key: 'leave' })
    await ui.press({ key: 'remove' })
    await ui.press({ key: 'switch-2' })
    expect(called).toEqual([
      expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' }),
      expect.objectContaining({ tool: 'ExitWorktree', action: 'remove' }),
      expect.objectContaining({ tool: 'EnterWorktree', path: '/work/repo-old' }),
    ])
    await ui.unmount()
  }
  expect(toasts.at(-1)).toBe('Moved.')
})

test('a new worktree takes a valid name, and a refusal is a toast', async ($, on) => {
  const called: unknown[] = []
  const toasts: string[] = []
  engine(on, { called, toasts, answer: () => ({ isError: true, result: 'no', text: 'Already in a worktree session.' }) })
  await openPane($)
  const ui = await $.ui.mount({ plugin: 'worktree', surface: 'terminal', ...PANE })
  await ui.input({ key: 'new', text: 'has space' })
  expect(called).toEqual([])
  expect(toasts.at(-1)).toMatch(/letters, digits/)
  await ui.input({ key: 'new', text: ' s-13-next ' })
  expect(called).toEqual([expect.objectContaining({ tool: 'EnterWorktree', name: 's-13-next' })])
  expect(toasts.at(-1)).toBe('Already in a worktree session.')
  await ui.unmount()
})
