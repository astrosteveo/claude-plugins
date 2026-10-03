import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const ROOT = '/proj'
const FILES: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  [ROOT]: [
    { name: 'src', kind: 'dir' },
    { name: '.git', kind: 'dir' },
    { name: 'README.md', kind: 'file' },
  ],
  [`${ROOT}/src`]: [{ name: 'app.ts', kind: 'file' }],
}

const PANE = {
  component: 'Pane',
  requestId: 'file-tree',
  props: {
    title: 'Files',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('a file Claude writes shows in the tree, marked, and opens as a diff', async ($, on) => {
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.list', ($, e) => ({
    value: (FILES[e.path] ?? []).map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // CRLF text must not get the pane's tree refused
  on('fs.read', () => ({ value: '# Read me\r\nline two\r\n' }))
  on('tool.call', ($, e) => ({
    result: {
      type: 'create',
      filePath: `${ROOT}/src/app.ts`,
      content: 'export const app = 1\n',
      structuredPatch: [],
      originalFile: null,
    },
  }))

  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/app.ts`, content: 'export const app = 1\n' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'file-tree', surface, ...PANE })

    expect(await ui.find({ type: 'Button', text: /\.git/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: 'README.md' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /changed$/ }))?.text).toBe('1 changed')

    const row = await ui.find({ type: 'Button', text: 'app.ts' })
    expect(row).toBeDefined()
    await ui.press({ key: row!.key! })

    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(String(code?.props.source)).toContain('+export const app = 1')

    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    const readme = await ui.find({ type: 'Button', text: 'README.md' })
    await ui.press({ key: readme!.key! })
    const file = await ui.find({ type: 'Code' })
    expect(file?.props.format).toBe('source')
    expect(String(file?.props.source)).toBe('# Read me\nline two\n')
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a file Claude changes through Bash is marked, with its git diff', async ($, on) => {
  let isAfter = false
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.list', ($, e) => ({
    value: (FILES[e.path] ?? []).map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: isAfter ? 2 : 1, isLink: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', ($, e) => {
    const run = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv.includes('rev-parse')) return run(`${ROOT}\n`)
    if (e.argv.includes('status')) return run(isAfter ? ' M src/app.ts\0' : '')
    return run('diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n')
  })
  on('tool.call', () => {
    isAfter = true
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  await $.tool.call({ tool: 'Bash', command: "sed -i 's/old/new/' src/app.ts" })

  const ui = await $.ui.mount({ plugin: 'file-tree', surface: 'terminal', ...PANE })
  const row = await ui.find({ type: 'Button', text: 'app.ts' })
  await ui.press({ key: row!.key! })
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.format).toBe('diff')
  expect(String(code?.props.source)).toBe('@@ -1 +1 @@\n-old\n+new')
  await ui.unmount()
})

test('a file Bash reverts loses its mark', async ($, on) => {
  let isAfter = false
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.list', ($, e) => ({
    value: (FILES[e.path] ?? []).map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', ($, e) => {
    const run = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv.includes('rev-parse')) return run(`${ROOT}\n`)
    if (e.argv.includes('status')) return run(isAfter ? '' : ' M README.md\0')
    return run('')
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') {
      isAfter = true
      return { result: { stdout: '', stderr: '', interrupted: false } }
    }
    return { result: { type: 'update', filePath: `${ROOT}/README.md`, content: '', structuredPatch: [], originalFile: '' } }
  })

  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/README.md`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'git checkout README.md' })

  const ui = await $.ui.mount({ plugin: 'file-tree', surface: 'terminal', ...PANE })
  expect((await ui.find({ type: 'Text', text: /changed$/ }))?.text).toBe('0 changed')
  await ui.unmount()
})

test('a file an Edit puts back to match git loses its mark', async ($, on) => {
  let edits = 0
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.list', ($, e) => ({
    value: (FILES[e.path] ?? []).map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('status') && edits === 1 ? ' M README.md\0' : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('tool.call', () => {
    edits++
    return { result: { type: 'update', filePath: `${ROOT}/README.md`, content: '', structuredPatch: [], originalFile: '' } }
  })

  const ui = await $.ui.mount({ plugin: 'file-tree', surface: 'terminal', ...PANE })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/README.md`, old_string: 'a', new_string: 'b' })
  expect((await ui.find({ type: 'Text', text: /changed$/ }))?.text).toBe('1 changed')
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/README.md`, old_string: 'b', new_string: 'a' })
  expect((await ui.find({ type: 'Text', text: /changed$/ }))?.text).toBe('0 changed')
  await ui.unmount()
})

// The pane opens by itself on the first change; a narrow terminal keeps it undrawn
function autoOpen(on: Parameters<TestBody>[1], isPlaced: boolean) {
  const toasts: string[] = []
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.list', ($, e) => ({
    value: (FILES[e.path] ?? []).map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('ui.open', () => ({
    value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'below 144 columns: the terminal is 100' },
  }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', () => ({
    value: { exitCode: 0, stdout: ' M README.md\0', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('tool.call', () => ({
    result: { type: 'update', filePath: `${ROOT}/README.md`, content: '', structuredPatch: [], originalFile: '' },
  }))
  return { toasts, clock: mock.clock(on, { now: 0 }) }
}

const edit = { tool: 'Edit', file_path: `${ROOT}/README.md`, old_string: 'a', new_string: 'b' } as const

test('a pane the terminal is too narrow to draw says how to open it, once', async ($, on) => {
  const { toasts, clock } = autoOpen(on, false)

  await $.tool.call(edit)
  await clock.settle()
  expect(toasts).toEqual(['Claude changed files. Run /tree to see them, or widen the terminal.'])

  await $.tool.call(edit)
  await clock.settle()
  expect(toasts).toHaveLength(1)
})

test('a pane that opens shows no toast', async ($, on) => {
  const { toasts, clock } = autoOpen(on, true)

  await $.tool.call(edit)
  await clock.settle()
  expect(toasts).toEqual([])
})
