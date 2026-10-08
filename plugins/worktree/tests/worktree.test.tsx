import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import {
  RESOLVE_SCRIPT,
  SNAPSHOT_SCRIPT,
  STOPPED_KEPT,
  UNCHECKED_REASON,
  checkoutOf,
  isGuarded,
  isInside,
  mainTopOf,
  mayStop,
  normalize,
  noteFor,
  pathOf,
  reasonFor,
  resolvedOf,
  withStopped,
} from '../hooks/guard'
import type { Checkout } from '../hooks/guard'

const MAIN: Checkout = { top: '/repo', branch: 'main', defaultBranch: 'main', isLinked: false, commonDir: '/repo/.git' }
const WORKTREE: Checkout = { top: '/repo/.claude/worktrees/fix', branch: 'worktree-fix', defaultBranch: 'main', isLinked: true, commonDir: '/repo/.git' }

// Neither stream of a git run is cut short.
const NOT_CUT = { isStdoutTruncated: false, isStderrTruncated: false }
const ran0 = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', ...NOT_CUT } })
const failed = { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', ...NOT_CUT } }

// A git checkout as `git rev-parse` reports it, and origin/HEAD.
type Git = { top: string; branch: string; gitDir: string; commonDir: string; originHead?: string }
const ON_MAIN: Git = { top: '/repo', branch: 'main', gitDir: '/repo/.git', commonDir: '/repo/.git', originHead: 'origin/main' }
const IN_WORKTREE: Git = { top: '/repo/.claude/worktrees/fix', branch: 'worktree-fix', gitDir: '/repo/.git/worktrees/fix', commonDir: '/repo/.git', originHead: 'origin/main' }

// The world beneath the plugin. `session` is where the session sits (it can
// change mid-test, as entering a worktree does); `trees` are the checkouts on
// disk, git answering for the one a folder is in; `links` are symlinks;
// `snapshot` is what the main checkout holds, which a shell command matching
// `changesMain` bumps, standing for one that changed it.
type World = { session: Git; trees: Git[]; links?: Record<string, string>; snapshot?: number; resolveFails?: boolean; changesMain?: RegExp }

const treeAt = (world: World, dir: string) =>
  [...world.trees, world.session].filter(tree => isInside(dir, tree.top)).sort((a, b) => b.top.length - a.top.length)[0]

function engine(on: On, world: World, ran: string[] = [], toasts: string[] = []) {
  on('session.cwd', async () => ({ value: world.session.top }))
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'sh' && e.argv[2] === RESOLVE_SCRIPT) {
      if (world.resolveFails) return { value: { exitCode: 1, stdout: '', stderr: 'no', ...NOT_CUT } }
      let path = e.argv[4]!
      for (const [link, real] of Object.entries(world.links ?? {})) if (isInside(path, link)) path = real + path.slice(link.length)
      return ran0(`${path}\n${path.slice(0, path.lastIndexOf('/')) || '/'}\n`)
    }
    if (e.argv[0] === 'sh' && e.argv[2] === SNAPSHOT_SCRIPT) return ran0(`refs/heads/main abc tree${world.snapshot ?? 0}\n`)
    const tree = treeAt(world, e.init?.cwd ?? world.session.top)
    if (e.argv.includes('rev-parse')) return tree === undefined ? failed : ran0(`${tree.top}\n${tree.branch}\n${tree.gitDir}\n${tree.commonDir}\n`)
    if (e.argv.includes('symbolic-ref')) return tree?.originHead === undefined ? failed : ran0(`${tree.originHead}\n`)
    return { value: { exitCode: 1, stdout: '', stderr: '', ...NOT_CUT } }
  })
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Bash' && world.changesMain?.test(e.command)) world.snapshot = (world.snapshot ?? 0) + 1
    ran.push(`${e.tool} ${String((e as { file_path?: string; command?: string }).file_path ?? (e as { command?: string }).command)}`)
    return { result: {} } as never
  })
  on('ui.log', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
}

const edit = (path: string, id = 'tu1') => ({ tool: 'Edit', tool_use_id: id, file_path: path, old_string: 'a', new_string: 'b' }) as never
const bash = (command: string) => ({ tool: 'Bash', tool_use_id: 'b1', command }) as never
const ORIGIN = { kind: 'composer' } as const
const prompt = (text: string) => ({ text, wait: false, origin: ORIGIN })
const ROW = { tool_use_id: 'tu1', tool: 'Edit', input: {}, isRunning: false, isErrored: true, isInterrupted: false } as const

test('git output reads as a checkout', () => {
  expect(checkoutOf('/repo\nmain\n/repo/.git\n/repo/.git\n', 'origin/main\n')).toEqual(MAIN)
  expect(checkoutOf('/wt\ns-1\n/repo/.git/worktrees/wt\n/repo/.git\n', 'origin/main')).toMatchObject({ branch: 's-1', isLinked: true, commonDir: '/repo/.git' })
  expect(checkoutOf('/repo\nHEAD\n/repo/.git\n/repo/.git\n', undefined)).toMatchObject({ branch: undefined, defaultBranch: undefined })
})

test('every edit tool may be stopped, a subagent\'s too', () => {
  expect(mayStop('Edit')).toBe(true)
  expect(mayStop('Write')).toBe(true)
  expect(mayStop('NotebookEdit')).toBe(true)
  expect(mayStop('Read')).toBe(false)
  expect(pathOf({ notebook_path: '/repo/a.ipynb' })).toBe('/repo/a.ipynb')
  expect(pathOf({ command: 'ls' })).toBeUndefined()
})

test('a path reads the same however it is spelled', () => {
  expect(normalize('README.md', '/repo')).toBe('/repo/README.md')
  expect(normalize('/repo/./README.md', '/x')).toBe('/repo/README.md')
  expect(normalize('//repo//src/../README.md', '/x')).toBe('/repo/README.md')
  expect(normalize('../repo/a.ts', '/tmp')).toBe('/repo/a.ts')
  expect(normalize('/../../repo', '/x')).toBe('/repo')
  expect(resolvedOf('/repo/a.ts\n/repo\n')).toEqual({ path: '/repo/a.ts', dir: '/repo' })
  expect(resolvedOf('')).toBeNull()
  expect(mainTopOf('/repo/.git')).toBe('/repo')
  expect(mainTopOf('/srv/repo.git')).toBeUndefined()
})

test('the main checkout on the default branch or a detached head is guarded', () => {
  expect(isGuarded(MAIN)).toBe(true)
  expect(isGuarded({ ...MAIN, branch: undefined })).toBe(true)
  expect(isGuarded({ ...MAIN, branch: 's-1' })).toBe(false)
  expect(isGuarded(WORKTREE)).toBe(false)
  // Without origin/HEAD, main and master count as the default.
  expect(isGuarded({ ...MAIN, defaultBranch: undefined, branch: 'master' })).toBe(true)
  expect(isGuarded({ ...MAIN, defaultBranch: undefined, branch: 'dev' })).toBe(false)
})

test('the file\'s own checkout decides whether its edit is stopped', () => {
  expect(reasonFor(MAIN, MAIN, '/repo/src/a.ts', false)).toContain('EnterWorktree')
  expect(reasonFor(MAIN, { ...MAIN, branch: undefined }, '/repo/a.ts', false)).toContain('a detached head')
  expect(reasonFor(MAIN, { ...MAIN, branch: 's-1' }, '/repo/a.ts', false)).toBeNull()
  expect(reasonFor(MAIN, WORKTREE, '/repo/.claude/worktrees/fix/a.ts', false)).toBeNull()
  expect(reasonFor(MAIN, null, '/home/me/.claude/notes.md', false)).toBeNull()
  // Another repository's main is not this session's to guard.
  expect(reasonFor(MAIN, { ...MAIN, top: '/other', commonDir: '/other/.git' }, '/other/a.ts', false)).toBeNull()
  // From a worktree, the main checkout is still kept clean.
  expect(reasonFor(WORKTREE, MAIN, '/repo/a.ts', false)).toContain('make the edit there')
  expect(reasonFor(MAIN, MAIN, '/repo/a.ts', true)).toContain('isolation')
  // A folder that only starts with the same name is outside.
  expect(isInside('/repo-other/a.ts', '/repo')).toBe(false)
})

test('a feature branch, a worktree and a file outside the repo are never stopped', async ($, on) => {
  const ran: string[] = []
  const world: World = { session: { ...ON_MAIN, branch: 's-1' }, trees: [] }
  engine(on, world, ran)
  expect((await $.tool.call(edit('/repo/a.ts'))).deny).toBeUndefined()
  world.session = IN_WORKTREE
  world.trees = [ON_MAIN]
  expect((await $.tool.call(edit('/repo/.claude/worktrees/fix/a.ts'))).deny).toBeUndefined()
  world.session = ON_MAIN
  world.trees = []
  expect((await $.tool.call(edit('/tmp/scratch.txt'))).deny).toBeUndefined()
  expect(ran).toHaveLength(3)
})

test('turned off, nothing is stopped and no note is added', { options: { enabled: false } }, async ($, on) => {
  const ran: string[] = []
  engine(on, { session: ON_MAIN, trees: [] }, ran)
  expect((await $.tool.call(edit('/repo/a.ts'))).deny).toBeUndefined()
  expect((await $.prompt.submit(prompt('Fix it'))).context).toBeUndefined()
  expect(ran).toEqual(['Edit /repo/a.ts'])
})

test('every edit on main is stopped, and an edit in the worktree goes through', async ($, on) => {
  const world: World = { session: ON_MAIN, trees: [] }
  engine(on, world)
  expect(await $.tool.call(edit('/repo/a.ts'))).toMatchObject({ deny: expect.stringContaining('EnterWorktree') })
  expect(await $.tool.call(edit('/repo/a.ts', 'tu2'))).toMatchObject({ deny: expect.stringContaining('Every edit on this branch') })
  world.session = IN_WORKTREE
  world.trees = [ON_MAIN]
  expect((await $.tool.call(edit('/repo/.claude/worktrees/fix/a.ts'))).deny).toBeUndefined()
})

test('a relative path, a dot, a double slash or a symlink into main is stopped', async ($, on) => {
  const ran: string[] = []
  engine(on, { session: ON_MAIN, trees: [], links: { '/tmp/link': '/repo' } }, ran)
  for (const path of ['README.md', '/repo/./README.md', '//repo/README.md', '/repo/src/../README.md', '/tmp/link/README.md']) {
    expect(await $.tool.call(edit(path))).toMatchObject({ deny: expect.stringContaining('/repo/README.md is in /repo') })
  }
  expect(ran).toEqual([])
})

test('a subagent\'s edit to main is stopped, and one in its own worktree goes through', async ($, on) => {
  const ran: string[] = []
  engine(on, { session: ON_MAIN, trees: [IN_WORKTREE] }, ran)
  expect(await $.tool.call({ ...(edit('/repo/a.ts') as object), agentId: 'a1' } as never)).toMatchObject({ deny: expect.stringContaining('isolation') })
  expect((await $.tool.call({ ...(edit('/repo/.claude/worktrees/fix/a.ts') as object), agentId: 'a1' } as never)).deny).toBeUndefined()
  expect(ran).toEqual(['Edit /repo/.claude/worktrees/fix/a.ts'])
})

test('from a worktree, an edit to the main checkout is stopped', async ($, on) => {
  engine(on, { session: IN_WORKTREE, trees: [ON_MAIN] })
  expect(await $.tool.call(edit('/repo/a.ts'))).toMatchObject({ deny: expect.stringContaining('make the edit there') })
})

test('on a detached head in the main checkout, edits are stopped', async ($, on) => {
  engine(on, { session: { ...ON_MAIN, branch: 'HEAD' }, trees: [] })
  expect(await $.tool.call(edit('/repo/a.ts'))).toMatchObject({ deny: expect.stringContaining('a detached head') })
})

test('when git or the path lookup fails, the edit is stopped', async ($, on) => {
  on('session.cwd', async () => ({ value: '/repo' }))
  on('process.run', async () => {
    throw new Error('git is missing')
  })
  const ran: string[] = []
  on('tool.call', async () => (ran.push('ran'), { result: {} }) as never)
  const logged: string[] = []
  on('ui.log', async (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  expect(await $.tool.call(edit('/repo/a.ts'))).toEqual({ deny: UNCHECKED_REASON })
  expect(ran).toEqual([])
  expect(logged.some(line => line.startsWith('worktree: an edit was stopped unchecked'))).toBe(true)
})

test('a failed path lookup in a repository stops the edit', async ($, on) => {
  const ran: string[] = []
  engine(on, { session: ON_MAIN, trees: [], resolveFails: true }, ran)
  expect(await $.tool.call(edit('/repo/a.ts'))).toEqual({ deny: UNCHECKED_REASON })
  expect(ran).toEqual([])
})

test('a shell command that changes main is told to Claude and shown, and one that does not is left alone', async ($, on) => {
  const ran: string[] = []
  const toasts: string[] = []
  engine(on, { session: ON_MAIN, trees: [], changesMain: /^echo/ }, ran, toasts)
  expect((await $.tool.call(bash('ls'))).context).toBeUndefined()
  const changed = await $.tool.call(bash('echo x >> README.md'))
  expect(changed.context).toEqual([expect.stringContaining('That command changed /repo')])
  expect(toasts).toEqual([expect.stringContaining('changed /repo on main')])
  expect(ran).toEqual(['Bash ls', 'Bash echo x >> README.md'])
})

test('from a worktree, a shell command that changes the main checkout is caught', async ($, on) => {
  engine(on, { session: IN_WORKTREE, trees: [ON_MAIN], changesMain: /touch/ })
  expect((await $.tool.call(bash('cd /repo && touch x'))).context).toEqual([expect.stringContaining('That command changed /repo')])
})

test('on a feature branch, shell commands are not read around', async ($, on) => {
  engine(on, { session: { ...ON_MAIN, branch: 's-1' }, trees: [], changesMain: /touch/ })
  expect((await $.tool.call(bash('touch x'))).context).toBeUndefined()
})

test('when git fails around a shell command, the command runs once', async ($, on) => {
  on('session.cwd', async () => ({ value: '/repo' }))
  on('process.run', async () => {
    throw new Error('git is missing')
  })
  const ran: string[] = []
  on('tool.call', async () => (ran.push('ran'), { result: {} }) as never)
  on('ui.log', async () => ({ value: undefined }))
  expect((await $.tool.call(bash('ls'))).deny).toBeUndefined()
  expect(ran).toEqual(['ran'])
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
  expect(noteFor({ ...MAIN, branch: undefined })).toContain('a detached head')
})

test('a prompt on main tells Claude to move first, until it has moved', async ($, on) => {
  const world: World = { session: ON_MAIN, trees: [] }
  engine(on, world)
  const first = await $.prompt.submit(prompt('Fix the band'))
  expect(first.context).toEqual([expect.stringContaining('call EnterWorktree')])
  expect(first.text).toBe('Fix the band')
  world.session = IN_WORKTREE
  expect((await $.prompt.submit(prompt('And the pane'))).context).toBeUndefined()
})

test('the note keeps coming after a stop, while the session is still on main', async ($, on) => {
  engine(on, { session: ON_MAIN, trees: [] })
  await $.tool.call(edit('/repo/a.ts'))
  expect((await $.prompt.submit(prompt('Go on'))).context).toEqual([expect.stringContaining('call EnterWorktree')])
})

test('a feature branch adds no note', async ($, on) => {
  engine(on, { session: { ...ON_MAIN, branch: 's-1' }, trees: [] })
  expect((await $.prompt.submit(prompt('Fix it'))).context).toBeUndefined()
})

test('each stopped edit draws as a dim note, and other rows as the engine draws them', async ($, on) => {
  engine(on, { session: ON_MAIN, trees: [] })
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
