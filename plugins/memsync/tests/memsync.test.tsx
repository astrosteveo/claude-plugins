import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import {
  SECRET_RE,
  changedAreas,
  clean,
  conflictCopies,
  cwdFromTranscript,
  diffHunks,
  findSecrets,
  fixPrompt,
  kindOf,
  lineTone,
  memoryDirFromSection,
  modeLabel,
  originalOf,
  parseAction,
  parseStatus,
  projectKey,
  statusLine,
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
  expect(parseAction('prune')).toBe('prune')
  expect(parseAction('log')).toBe('log')
  expect(parseAction('frobnicate')).toBe('help')
})

const calm: Parameters<typeof statusLine>[0] = { phase: 'idle', error: '', conflicts: [], project: null }

test('the status line names the cause and stays away when all is well', () => {
  expect(statusLine(calm)).toBe(undefined)
  expect(statusLine({ ...calm, phase: 'off' })).toBe('memory sync is off: /memsync on')
  expect(statusLine({ ...calm, phase: 'error', error: 'push failed: denied' })).toBe('memory sync failed (push failed: denied): /memsync')
  expect(statusLine({ ...calm, phase: 'error', error: 'x'.repeat(100) })).toMatch(/^memory sync failed \(x{59}…\): \/memsync$/)
  const unlinked = { root: '/p/app', key: 'app', memoryDir: '/m', state: 'unlinked' } as const
  expect(statusLine({ ...calm, project: unlinked, conflicts: ['a.box.md'] })).toBe('memory sync: this project’s memory isn’t linked: /memsync link')
  expect(statusLine({ ...calm, conflicts: ['a.box.md', 'b.box.md'] })).toBe('memory sync: 2 conflict copies to merge: /memsync')
  // A sync that is running or waiting hides an old error until it ends
  expect(statusLine({ ...calm, phase: 'waiting', error: 'push failed' })).toBe(undefined)
})

test('the footer label shows only while a sync runs or waits', () => {
  expect(modeLabel('syncing')).toBe('memory syncing')
  expect(modeLabel('waiting')).toBe('memory sync waiting')
  expect(modeLabel('idle')).toBe(null)
  expect(modeLabel('error')).toBe(null)
})

test('a fix prompt names the repo, and none is offered where Claude could lose work', () => {
  expect(fixPrompt('secret', 'not synced: possible secret in projects/app/leak.md', '/r')).toContain('projects/app/leak.md')
  expect(fixPrompt('repo', 'x', '/home/u/claude-memory')).toContain('clone it to /home/u/claude-memory')
  expect(fixPrompt('push', 'push failed: denied', '/r')).toContain('push failed: denied')
  expect(fixPrompt('other', 'commit failed', '/r')).toContain('/r')
  expect(fixPrompt('rebase', 'rebase onto origin/main failed', '/r')).toBe(null)
  expect(fixPrompt('offline', 'fetch failed', '/r')).toBe(null)
  expect(fixPrompt('busy', 'held the lock', '/r')).toBe(null)
})

test('an error stored without a kind gets one from its words', () => {
  expect(kindOf('rebase onto origin/main failed; resolve by hand in /r')).toBe('rebase')
  expect(kindOf('fetch failed (offline?)')).toBe('offline')
  expect(kindOf('push failed: denied')).toBe('push')
  expect(kindOf('not synced: possible secret in a.md')).toBe('secret')
  expect(kindOf('/r is not a git repo; clone your memory repo there')).toBe('repo')
  expect(kindOf('commit failed: x')).toBe('other')
})

test('diff hunks drop the file header, lose carriage returns and cut between hunks', () => {
  const diff = ['diff --git a/n.md b/n.box.md', '--- a/n.md', '+++ b/n.box.md', '@@ -1 +1 @@', '-old\r', '+new\r', '@@ -9 +9 @@', '-x', '+y', ''].join('\n')
  expect(diffHunks(diff)).toEqual({ hunks: '@@ -1 +1 @@\n-old\n+new\n@@ -9 +9 @@\n-x\n+y', isCut: false })
  expect(diffHunks(diff, 30)).toEqual({ hunks: '@@ -1 +1 @@\n-old\n+new', isCut: true })
  expect(diffHunks(diff, 10)).toBe(null)
  expect(diffHunks('Binary files differ')).toBe(null)
})

test('text for the screen keeps tabs and newlines and drops other control characters', () => {
  expect(clean('a\r\nb\tc\u001b[31md\u0007')).toBe('a\nb\tc[31md')
})

test('a conflict copy maps back to its original', () => {
  expect(originalOf('projects/app/note.laptop.md')).toBe('projects/app/note.md')
})

test('status and log lines get their tones', () => {
  expect(lineTone('Problem: push failed', 'status')).toBe('bad')
  expect(lineTone('Unlinked: /p/new', 'status')).toBe('warn')
  expect(lineTone('Repo: /r on main', 'status')).toBe('')
  expect(lineTone('10:42 push failed: denied', 'log')).toBe('bad')
  expect(lineTone('10:42 conflict: kept both copies of a.md in app', 'log')).toBe('warn')
  expect(lineTone('10:42 change: pushed 2, pulled 0', 'log')).toBe('dim')
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

type World = { hasRepo: boolean; skillFiles: string[]; store?: Record<string, unknown>; refusesFill?: boolean }
type On = Parameters<TestBody>[1]

/** Records what the mod does to the prompt box, the pane and the clipboard, in order. */
function promptBox(on: On, refusesFill = false) {
  const box = { steps: [] as string[], text: '', mode: '' }
  on('ui.close', ($, e) => {
    box.steps.push(`close ${e.id}`)
    return { value: undefined }
  })
  on('prompt.fill', ($, e) => {
    box.steps.push('fill')
    box.text = e.text
    box.mode = e.mode
    return refusesFill ? { isFilled: false, refusal: 'dialog' as const } : { isFilled: true }
  })
  on('ui.copy', () => {
    box.steps.push('copy')
    return { value: { isCopied: true as const } }
  })
  return box
}

function world(on: On, w: World) {
  const seen = {
    processes: 0,
    repoChecks: 0,
    toasts: [] as string[],
    status: [] as (string | undefined)[],
    opened: {} as Record<string, unknown>,
    box: promptBox(on, w.refusesFill),
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
    expect(seen.status.at(-1)).toBe('memory sync is off: /memsync on')
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

    // A press that changes nothing still says why
    await ui.press({ key: 'sync' })
    expect(await ui.find({ type: 'Text', text: /Memsync is off\. Run \/memsync on/ })).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /is not a git repo/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'Turn off' })).toBeDefined()
    expect(seen.toasts.some(t => t.includes('is not a git repo'))).toBe(true)
    expect(seen.status.at(-1)).toMatch(/^memory sync failed \(\/home\/u\/claude-memory is not a git repo/)

    // The fix closes the dialog first: the prompt box refuses text under one
    await ui.press({ key: 'fix' })
    expect(seen.box.steps).toEqual(['close memsync', 'fill'])
    expect(seen.box.text).toContain('clone it to /home/u/claude-memory')
    expect(seen.box.mode).toBe('append')
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`an old rebase error gets no fix button, and its stored text is cleaned (${surface})`, async ($, on) => {
    const { clock } = world(on, {
      hasRepo: false,
      skillFiles: [],
      store: { enabled: false, error: 'rebase onto origin/main failed; resolve by hand in /r\r', log: ['10:00 push failed\r'] },
    })
    await start($)
    await clock.settle()
    await $.command.run(run(''))
    const ui = await $.ui.mount({ plugin: 'memsync', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: 'rebase onto origin/main failed; resolve by hand in /r' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'fix' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a prompt the box refuses goes to the clipboard (${surface})`, async ($, on) => {
    const { seen, clock } = world(on, {
      hasRepo: false,
      skillFiles: [],
      store: { enabled: false, error: 'push failed: denied', errorKind: 'push' },
      refusesFill: true,
    })
    await start($)
    await clock.settle()
    await $.command.run(run(''))
    const ui = await $.ui.mount({ plugin: 'memsync', surface, ...PANE })
    await ui.press({ key: 'fix' })
    expect(seen.box.steps).toEqual(['close memsync', 'fill', 'copy'])
    expect(seen.toasts).toContain('memsync: the prompt box was busy, so the prompt is on your clipboard')
    await ui.unmount()
  })
}

test('/memsync log shows every stored line', async ($, on) => {
  const { clock } = world(on, { hasRepo: false, skillFiles: [], store: { enabled: false, log: ['10:00 start: pushed 1, pulled 0', '10:05 push failed: denied'] } })
  await start($)
  await clock.settle()
  const out = await $.command.run(run('log'))
  expect(out.text).toBe('10:00 start: pushed 1, pulled 0\n10:05 push failed: denied')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/memsync status and log draw colored lines, and other output passes (${surface})`, async ($, on) => {
    world(on, { hasRepo: false, skillFiles: [] })
    on('ui.render', { component: 'CommandOutput' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine: {e.props.text}</Text>
    })
    const output = (args: string, text: string) =>
      $.ui.mount({
        plugin: 'memsync',
        surface,
        component: 'CommandOutput',
        requestId: `out-${args}`,
        props: { command: 'memsync', args, text, isErrored: false },
      })

    const status = await output('status', 'Memsync is on.\nProblem: push failed: denied\nShared: CLAUDE.md ✓, reflect ✗')
    expect((await status.find({ type: 'Text', text: 'Problem: push failed: denied' }))?.props).toMatchObject({ color: 'error' })
    // A text query matches part of a line, so read the marks off the tree
    expect(await status.drawn()).toMatchObject({
      children: [{}, {}, { children: ['Shared: CLAUDE.md ', { props: { color: 'success' } }, ', reflect ', { props: { color: 'error' } }] }],
    })
    await status.unmount()

    const log = await output('log', '10:05 push failed: denied\n10:06 manual: pushed 1, pulled 0')
    expect((await log.find({ type: 'Text', text: '10:06 manual: pushed 1, pulled 0' }))?.props).toMatchObject({ color: 'inactive' })
    await log.unmount()

    const synced = await output('sync', 'Synced: pushed 1 file, pulled 0.')
    expect(await synced.find({ type: 'Text', text: /^engine: Synced/ })).toBeDefined()
    await synced.unmount()
  })

  test(`the footer keeps Claude Code's own modes while no sync runs (${surface})`, async ($, on) => {
    const { clock } = world(on, { hasRepo: false, skillFiles: [], store: { enabled: false } })
    on('ui.render', { component: 'SessionMode' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.modes.join(' & ')}</Text>
    })
    await start($)
    await clock.settle()
    const footer = await $.ui.mount({ plugin: 'memsync', surface, component: 'SessionMode', requestId: 'footer', props: { modes: ['focus'] } })
    expect(await footer.find({ type: 'Text', text: 'focus' })).toBeDefined()
    await footer.unmount()
  })
}

test('/memsync with an unknown word shows the help', async ($, on) => {
  const { clock } = world(on, { hasRepo: false, skillFiles: [] })
  await start($)
  await clock.settle()
  const out = await $.command.run(run('frobnicate'))
  expect(out.text).toContain('/memsync link all')
})

for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
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
    const box = promptBox(on)
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
      if (argv.includes('diff --no-index')) {
        const diff = 'diff --git a/projects/app/note.md b/projects/app/note.box.md\n--- a/projects/app/note.md\n+++ b/projects/app/note.box.md\n@@ -1 +1 @@\n-Fact from A.\r\n+Fact from B.\r\n'
        return { value: { exitCode: 1, stdout: diff, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
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
    expect(await ui.find({ type: 'Button', text: 'Prune' })).toBeDefined()

    // The repo line leads with its state, so a cut line keeps it
    expect(await ui.find({ type: 'Text', text: /^clean  ~\/claude-memory/ })).toBeDefined()

    // A diff opens under its copy, without carriage returns
    await ui.press({ key: 'diff-projects/app/note.box.md' })
    expect(await ui.find({ type: 'Button', text: 'Hide diff' })).toBeDefined()
    const code = await ui.find({ type: 'Code' })
    expect(code?.props).toMatchObject({ format: 'diff', source: '@@ -1 +1 @@\n-Fact from A.\n+Fact from B.' })
    await ui.press({ key: 'diff-projects/app/note.box.md' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    // One project links from its own row; while off, the pane says why it didn't
    await ui.press({ key: 'link-/home/u/Projects/new' })
    expect(await ui.find({ type: 'Text', text: /Memsync is off/ })).toBeDefined()

    // Merge closes the dialog, then fills the prompt and keeps any draft
    await ui.press({ key: 'merge-projects/app/note.box.md' })
    expect(box.steps).toEqual(['close memsync', 'fill'])
    expect(box.text).toContain('/home/u/claude-memory/projects/app/note.box.md into /home/u/claude-memory/projects/app/note.md')
    expect(box.mode).toBe('append')

    // A narrow pane puts the buttons on their own line, and still draws
    await ui.redraw({ ...PANE.props, bodyColumns: 40 })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    expect(await ui.find({ type: 'Button', text: 'Link all' })).toBeDefined()
    await ui.unmount()
  })
}
