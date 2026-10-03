import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import {
  SECRET_RE,
  changedAreas,
  conflictCopies,
  cwdFromTranscript,
  findSecrets,
  memoryDirFromSection,
  parseAction,
  parseStatus,
  projectKey,
  unionLines,
} from '../hooks/core'

// The real-git checks live in tests/real-git.sh: this sandbox has no processes or files.

test('the secret check passes kebab names and catches real-looking values', () => {
  expect(SECRET_RE.test('risk-assessment-for-new-users-and-their-teams')).toBe(false)
  expect(SECRET_RE.test('use-sk-learn-for-the-classifier-pipeline')).toBe(false)
  expect(SECRET_RE.test('the task-scheduler-runs-every-night-at-two')).toBe(false)
  expect(SECRET_RE.test('ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe(true)
  expect(SECRET_RE.test(' sk-proj-abcdefghijklmnopqrstuvwx')).toBe(true)
  expect(SECRET_RE.test(`token ghp_${'a'.repeat(36)}`)).toBe(true)
  expect(SECRET_RE.test('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true)
  expect(SECRET_RE.test('The secret is named GITHUB_TOKEN; it lives in ~/.config/gh')).toBe(false)
})

test('findSecrets names files by their added lines only', () => {
  const diff = [
    'diff --git a/projects/app/ok.md b/projects/app/ok.md',
    '+++ b/projects/app/ok.md',
    '+Plan the risk-assessment-for-new-users review.',
    'diff --git a/projects/app/leak.md b/projects/app/leak.md',
    '+++ b/projects/app/leak.md',
    `-old ghp_${'b'.repeat(36)}`,
    `+token ghp_${'a'.repeat(36)}`,
  ].join('\n')
  expect(findSecrets(diff)).toEqual(['projects/app/leak.md'])
})

test('changedAreas lists projects first and counts the rest', () => {
  expect(changedAreas(['projects/app/a.md', 'projects/app/b.md', 'skills/reflect/SKILL.md', 'README.md'])).toBe(
    'projects/app, README.md, skills/reflect',
  )
  expect(changedAreas(['projects/a/x', 'projects/b/x', 'projects/c/x', 'projects/d/x', 'projects/e/x'])).toBe(
    'projects/a, projects/b, projects/c, projects/d and 1 more',
  )
})

test('parseStatus reads the branch, ahead, behind and dirty count', () => {
  const porcelain = ['# branch.oid abc', '# branch.head main', '# branch.ab +2 -1', '1 .M N... 100644 100644 100644 a b x.md', '? new.md', ''].join('\n')
  expect(parseStatus(porcelain)).toEqual({ branch: 'main', ahead: 2, behind: 1, dirty: 2 })
})

test('the memory folder comes from the memory section the engine composed', () => {
  const section =
    '# Memory\n\nYou have a persistent file-based memory at `/home/u/.claude/projects/-home-u-Projects-app/memory/`. This directory already exists.'
  expect(memoryDirFromSection(section)).toBe('/home/u/.claude/projects/-home-u-Projects-app/memory')
  expect(memoryDirFromSection('Memory lives in `/srv/mem/memory`.')).toBe('/srv/mem/memory')
  expect(memoryDirFromSection(null)).toBe(null)
})

test('MEMORY.md merges keep every line once and keep blank lines', () => {
  expect(unionLines('- a\n\n- b\n', '- b\n- c\n')).toBe('- a\n\n- b\n- c\n')
})

test('conflict copies are host-named files beside their original', () => {
  const files = ['projects/app/note.md', 'projects/app/note.laptop.md', 'projects/app/v1.2.md', 'projects/app/MEMORY.md']
  expect(conflictCopies(files)).toEqual(['projects/app/note.laptop.md'])
})

test('a transcript names the folder its session started in', () => {
  const text = '{"type":"summary"}\n{"cwd":"/home/u/Projects/app","type":"user"}\n{"cwd":"/elsewhere"}\n'
  expect(cwdFromTranscript(text)).toBe('/home/u/Projects/app')
  expect(cwdFromTranscript('{"cwd":"/home/u/Pro')).toBe(null)
})

test('a project key is the origin repo name, else the folder name', () => {
  expect(projectKey('https://github.com/me/claude-plugins.git\n', '/x/claude-plugins')).toBe('claude-plugins')
  expect(projectKey('git@github.com:me/tidelight.git', '/x/fishing-game')).toBe('tidelight')
  expect(projectKey('', '/x/scratch')).toBe('scratch')
})

test('/memsync arguments map to actions', () => {
  expect(parseAction('')).toBe('open')
  expect(parseAction('link all')).toBe('link-all')
  expect(parseAction(' Sync ')).toBe('sync')
  expect(parseAction('frobnicate')).toBe('help')
})

// ---- Hooks, with the world beneath mocked -------------------------------------------

const REPO = '/home/u/claude-memory'
const PANE = {
  component: 'Pane',
  requestId: 'memsync',
  props: { title: 'claude-memory', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const run = (args: string) =>
  ({ command: 'memsync', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } }) as const

type World = { hasRepo: boolean; skillFiles: string[]; store?: Record<string, unknown> }

function world(on: Parameters<TestBody>[1], w: World) {
  const seen = {
    processes: 0,
    repoChecks: 0,
    toasts: [] as string[],
    status: [] as (string | undefined)[],
    opened: {} as Record<string, unknown>,
  }
  mock.env(on, { HOME: '/home/u' })
  mock.store(on, w.store ?? {})
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    seen.opened = { ...e }
    return { value: { isPlaced: true } }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('fs.read', ($, e) => (e.path === '/etc/hostname' ? { value: 'box\n' } : { value: '' }))
  on('fs.exists', ($, e) => {
    if (e.path === `${REPO}/.git`) seen.repoChecks += 1
    return { value: e.path === `${REPO}/.git` ? w.hasRepo : false }
  })
  on('fs.list', ($, e) => ({
    value:
      e.path === `${REPO}/skills`
        ? w.skillFiles.map(name => ({ name, kind: 'file' as const, size: 10, mtimeMs: 5, isLink: false }))
        : [],
  }))
  on('process.run', () => {
    seen.processes += 1
    return { value: { exitCode: 1, stdout: '', stderr: 'mocked', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { seen, clock }
}

const start = ($: Parameters<TestBody>[0]) => $.session.start({ cwd: '/home/u/Projects/app', surface: 'terminal', isInteractive: true })
const finishTurn = ($: Parameters<TestBody>[0]) =>
  $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'turn-1', reason: 'answer' })

test('a turn that changed nothing starts no sync; one that changed a skill does', async ($, on) => {
  const w: World = { hasRepo: false, skillFiles: [] }
  const { seen, clock } = world(on, w)
  await start($)
  await clock.settle()
  const checksAfterStart = seen.repoChecks

  await finishTurn($)
  await clock.advance(10_000)
  expect(seen.repoChecks).toBe(checksAfterStart)
  expect(seen.processes).toBe(0)

  w.skillFiles = ['SKILL.md']
  await finishTurn($)
  await clock.advance(10_000)
  expect(seen.repoChecks).toBeGreaterThan(checksAfterStart)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane shows off, and turning on reports a missing repo (${surface})`, async ($, on) => {
    const { seen, clock } = world(on, { hasRepo: false, skillFiles: [], store: { enabled: false } })
    await start($)
    await clock.settle()
    expect(seen.status.at(-1)).toBe('mem off')
    expect(seen.processes).toBe(0)

    const status = await $.command.run(run('status'))
    expect(status.text).toContain('Memsync is off.')

    await $.command.run(run(''))
    expect(seen.opened).toMatchObject({ id: 'memsync', focus: true, closeOnEscape: true, holdToasts: true })
    const ui = await $.ui.mount({ plugin: 'memsync', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: '○ off' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'Close' })).toBeDefined()
    const turnOn = await ui.find({ type: 'Button', text: 'Turn on' })
    expect(turnOn).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /is not a git repo/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'Turn off' })).toBeDefined()
    expect(seen.toasts.some(t => t.includes('is not a git repo'))).toBe(true)
    await ui.unmount()
  })
}

test('/memsync with an unknown word shows the help', async ($, on) => {
  const { clock } = world(on, { hasRepo: false, skillFiles: [] })
  await start($)
  await clock.settle()
  const out = await $.command.run(run('frobnicate'))
  expect(out.text).toContain('/memsync link all')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane lists linked, unlinked and dead projects, conflicts and the repo (${surface})`, async ($, on) => {
    const PROJECTS = '/home/u/.claude/projects'
    const cwds = { 'f-app': '/home/u/Projects/app', 'f-new': '/home/u/Projects/new', 'f-gone': '/home/u/Projects/gone' }
    mock.env(on, { HOME: '/home/u' })
    mock.store(on, { enabled: false, cwds })
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.status', () => ({ value: undefined }))
    on('fs.read', () => ({ value: 'box\n' }))
    on('fs.exists', ($, e) => ({
      value: [`${REPO}/.git`, '/home/u/Projects/app', '/home/u/Projects/new'].includes(e.path),
    }))
    on('fs.list', ($, e) => ({
      value:
        e.path === PROJECTS
          ? Object.keys(cwds).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }))
          : [],
    }))
    on('fs.stat', ($, e) => {
      const isLink = e.path === `${PROJECTS}/f-app/memory`
      if (!e.path.startsWith(PROJECTS)) throw new Error('missing')
      return {
        value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink, realPath: isLink ? `${REPO}/projects/app` : e.path },
      }
    })
    on('process.run', ($, e) => {
      const argv = e.argv.join(' ')
      const ok = (stdout: string) => ({
        value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
      })
      if (argv.includes('status --porcelain=v2')) return ok('# branch.head main\n# branch.ab +0 -0\n')
      if (argv.startsWith(`git -C ${REPO} remote get-url`)) return ok('git@github.com:me/claude-memory.git\n')
      if (argv.includes('ls-files')) return ok('projects/app/note.md\nprojects/app/note.box.md\n')
      if (argv.includes('rev-parse --show-toplevel')) {
        const root = e.argv[2]!
        return ok(`${root}\n${root}/.git\n${root}/.git\nfalse\n`)
      }
      return { value: { exitCode: 1, stdout: '', stderr: 'mocked', isStdoutTruncated: false, isStderrTruncated: false } }
    })

    await start($)
    await clock.settle()
    await $.command.run(run(''))
    const ui = await $.ui.mount({ plugin: 'memsync', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /claude-memory → origin\/main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 linked · 1 unlinked · 1 dead/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~\/Projects\/new not linked/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~\/Projects\/gone folder gone/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /projects\/app\/note\.box\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'Merge' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'Link all' })).toBeDefined()
    await ui.unmount()
  })
}
