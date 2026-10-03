import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { FileTreeChange, FileTreeEntry } from '../types'

const PANE = 'file-tree'
const TITLE = 'Files'
// Never listed: too big to be useful, and not code anyone reviews
const HIDDEN = new Set(['.git', 'node_modules'])
const MAX_ENTRIES = 300
// Code draws at most 10000 characters; leave room for the cut note
const MAX_SOURCE = 9500

const root = atom({ plugin: 'file-tree', key: 'root' } as const, '')
const changes = atom({ plugin: 'file-tree', key: 'changes' } as const, {})
const expanded = atom({ plugin: 'file-tree', key: 'expanded' } as const, [''])
const listings = atom({ plugin: 'file-tree', key: 'listings' } as const, {})
const selected = atom({ plugin: 'file-tree', key: 'selected' } as const, '')
const view = atom({ plugin: 'file-tree', key: 'view' } as const, 'diff')
const isChangedOnly = atom({ plugin: 'file-tree', key: 'isChangedOnly' } as const, false)
const isAutoOpened = atom({ plugin: 'file-tree', key: 'isAutoOpened' } as const, false)

type $ = EngineInterface
type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

const join = (dir: string, name: string) => (dir === '' ? name : `${dir}/${name}`)

const parentsOf = (rel: string) => {
  const parts = rel.split('/').slice(0, -1)
  return ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))]
}

const relativeTo = (root: string, path: string) =>
  path.startsWith(root + '/') ? path.slice(root.length + 1) : path

const hunkText = (hunk: Hunk) =>
  `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`

// A new file's patch can be empty, so draw its whole content as added lines
const creationHunk = (content: string) => {
  const lines = content.replace(/\n$/, '').split('\n')
  return `@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}`
}

// Keep the newest hunks that fit, cutting only at hunk edges so the diff still parses
const fitHunks = (hunks: string[]) => {
  const kept: string[] = []
  let size = 0
  for (const hunk of [...hunks].reverse()) {
    if (size + hunk.length + 1 > MAX_SOURCE) break
    kept.unshift(hunk)
    size += hunk.length + 1
  }
  // One hunk too big alone: cut it to fit, and Code draws it as plain text
  return kept.length > 0 ? kept : hunks.slice(-1).map(hunk => hunk.slice(0, MAX_SOURCE))
}

// Code takes tab and newline as its only control characters
const clean = (text: string) => text.replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '\ufffd')

const isBinary = (text: string) => text.includes('\0')

const fitSource = (text: string) => {
  if (text.length <= MAX_SOURCE) return text
  const cut = text.lastIndexOf('\n', MAX_SOURCE)
  return text.slice(0, cut > 0 ? cut : MAX_SOURCE)
}

async function rootOf($: $) {
  const stored = await read($, root)
  return stored !== '' ? stored : $.session.cwd()
}

const absolute = (base: string, key: string) =>
  key.startsWith('/') ? key : key === '' ? base : `${base}/${key}`

async function listDir($: $, base: string, rel: string): Promise<FileTreeEntry[]> {
  const entries = await $.fs.list(absolute(base, rel)).catch(() => [])
  return entries
    .filter(entry => !HIDDEN.has(entry.name))
    .map(entry => ({ name: entry.name, isDir: entry.kind === 'dir' }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    .slice(0, MAX_ENTRIES)
}

// Lists every open folder again; also catches files Bash made or removed
async function refresh($: $) {
  const base = await rootOf($)
  const dirs = await read($, expanded)
  const fresh: Record<string, FileTreeEntry[]> = {}
  for (const dir of dirs) fresh[dir] = await listDir($, base, dir)
  await update($, listings, () => fresh)
}

// `replace` takes hunks that already cover every change, as git diff gives them
async function record(
  $: $,
  path: string,
  status: FileTreeChange['status'],
  hunks: string[],
  mode: 'append' | 'replace' = 'append',
) {
  const key = relativeTo(await rootOf($), path)
  const safe = hunks.filter(hunk => !isBinary(hunk)).map(clean)
  await update($, changes, all => {
    const before = all[key]
    const merged = mode === 'replace' ? safe : [...(before?.hunks ?? []), ...safe]
    return {
      ...all,
      [key]: {
        status: before?.status === 'added' ? 'added' : status,
        hunks: merged.length > 0 ? fitHunks(merged) : [],
        edits: (before?.edits ?? 0) + 1,
      },
    }
  })
  if (!key.startsWith('/')) {
    await update($, expanded, dirs => [...new Set([...dirs, ...parentsOf(key)])])
  }
  await refresh($)

  if (!(await read($, isAutoOpened))) {
    await update($, isAutoOpened, () => true)
    void $.ui.open({ id: PANE, title: TITLE, columns: 44 }).catch(() => {})
  }
}

type Dirty = Record<string, { code: string; mtime: number }>

// Files git sees as changed, by absolute path; undefined outside a repo
async function gitDirty($: $, base: string): Promise<Dirty | undefined> {
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: base }).catch(() => undefined)
  if (top === undefined || top.exitCode !== 0) return undefined
  const topDir = top.stdout.trim()
  const status = await $.process.run(['git', 'status', '--porcelain', '-z', '-uall'], { cwd: base })
  if (status.exitCode !== 0) return undefined

  const dirty: Dirty = {}
  const parts = status.stdout.split('\0')
  for (let i = 0; i < parts.length && i < 1000; i++) {
    const part = parts[i] ?? ''
    if (part.length < 4) continue
    const code = part.slice(0, 2)
    // A rename or copy carries its old path as the next entry
    if (code.includes('R') || code.includes('C')) i++
    const path = `${topDir}/${part.slice(3)}`
    const stat = await $.fs.stat(path).catch(() => undefined)
    dirty[path] = { code, mtime: stat?.mtimeMs ?? -1 }
  }
  return dirty
}

async function gitHunks($: $, base: string, path: string, code: string): Promise<string[]> {
  if (code === '??') {
    const text = await $.fs.read(path).catch(() => undefined)
    return typeof text === 'string' && !isBinary(text) ? [creationHunk(text)] : []
  }
  const diff = await $.process.run(['git', 'diff', '--no-color', 'HEAD', '--', path], { cwd: base }).catch(() => undefined)
  const body = diff?.stdout ?? ''
  const start = body.indexOf('\n@@')
  return start < 0 ? [] : body.slice(start + 1).replace(/\n$/, '').split(/\n(?=@@ )/)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Runs again on each reload, so keep the first root
    if ((await read($, root)) === '') {
      const cwd = await $.session.cwd()
      await update($, root, now => (now === '' ? cwd : now))
    }
    await $.command.register({
      name: 'tree',
      description: 'Show the project file tree, with the files Claude changed marked',
    })
    void refresh($).catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'tree' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE, columns: 44 })

    return { text: 'File tree opened. Press ctrl+x x to close it.' }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError || ran.result.staged) return ran
    const isNew = ran.result.type === 'create'
    const hunks = isNew ? [creationHunk(e.content)] : ran.result.structuredPatch.map(hunkText)
    await record($, e.file_path, isNew ? 'added' : 'modified', hunks)

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError || ran.result.staged) return ran
    await record($, e.file_path, 'modified', ran.result.structuredPatch.map(hunkText))

    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    await record($, e.notebook_path, 'modified', [])

    return ran
  })

  // Bash can write files too: compare what git sees before and after the command
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const base = await rootOf($)
    const before = await gitDirty($, base).catch(() => undefined)
    const ran = await next(e)
    if (before === undefined || ran.deny !== undefined) return ran

    const after = await gitDirty($, base).catch(() => undefined)
    for (const [path, now] of Object.entries(after ?? {})) {
      const then = before[path]
      if (now.mtime < 0 || (then !== undefined && then.mtime === now.mtime)) continue
      const isNew = now.code === '??' || now.code.includes('A')
      const hunks = await gitHunks($, base, path, now.code)
      await record($, path, isNew ? 'added' : 'modified', hunks, 'replace')
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const all = await read($, changes)
    const open = new Set(await read($, expanded))
    const lists = await read($, listings)
    const picked = await read($, selected)
    const mode = await read($, view)
    const isFiltered = await read($, isChangedOnly)

    const changed = Object.keys(all).sort()
    const changedDirs = new Set(changed.filter(key => !key.startsWith('/')).flatMap(parentsOf))

    const mark = (key: string) => {
      const change = all[key]
      if (change === undefined) return <Text> </Text>
      return change.status === 'added' ? <Text color="green">A</Text> : <Text color="yellow">M</Text>
    }

    const pick = (key: string) => async () => {
      await update($, view, () => (all[key]?.hunks.length ? 'diff' : 'file'))
      await update($, selected, () => key)
    }

    // One file, full width: its diff from this session, or its current content
    if (picked !== '') {
      const change = all[picked]
      const hasDiff = (change?.hunks.length ?? 0) > 0
      const showDiff = mode === 'diff' && hasDiff
      let source = ''
      let problem = showDiff ? 'No diff.' : 'Could not read this file.'
      if (showDiff) {
        source = change!.hunks.join('\n')
      } else {
        const text = await $.fs.read(absolute(await rootOf($), picked)).catch(() => undefined)
        if (typeof text === 'string' && isBinary(text)) problem = 'Binary file.'
        else if (typeof text === 'string') source = fitSource(clean(text))
      }

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="back" hotkey="b" onPress={() => update($, selected, () => '')}>
              Back
            </Button>
            {hasDiff && (
              <Button
                key="toggle"
                hotkey="d"
                onPress={() => update($, view, now => (now === 'diff' ? 'file' : 'diff'))}
              >
                {showDiff ? 'Show file' : 'Show diff'}
              </Button>
            )}
          </Box>
          <Box flexDirection="row" gap={1}>
            {mark(picked)}
            <Text bold wrap="truncate-start">{picked}</Text>
          </Box>
          {change !== undefined && (
            <Text dimColor>
              {change.edits} {change.edits === 1 ? 'change' : 'changes'} this session
            </Text>
          )}
          {source === '' ? (
            <Text dimColor>{problem}</Text>
          ) : (
            <Code
              source={source}
              path={picked}
              format={showDiff ? 'diff' : 'source'}
              startLine={showDiff ? undefined : 1}
              wrap="truncate-end"
            />
          )}
        </Box>
      )
    }

    const rows: RenderElement[] = []

    if (isFiltered) {
      // Only the changed files, each with its folder, flat
      for (const key of changed) {
        rows.push(
          <Box key={`row-${rows.length}`} flexDirection="row" gap={1}>
            {mark(key)}
            <Button key={`file-${rows.length}`} plain onPress={pick(key)}>
              {key}
            </Button>
          </Box>,
        )
      }
    } else {
      const walk = (dir: string, depth: number) => {
        for (const entry of lists[dir] ?? []) {
          const key = join(dir, entry.name)
          const indent = '  '.repeat(depth)
          if (entry.isDir) {
            const isOpen = open.has(key)
            rows.push(
              <Box key={`row-${rows.length}`} flexDirection="row">
                <Text>{indent}</Text>
                <Button
                  key={`dir-${rows.length}`}
                  plain
                  dimColor={!changedDirs.has(key)}
                  onPress={async () => {
                    await update($, expanded, dirs =>
                      isOpen ? dirs.filter(d => d !== key && !d.startsWith(key + '/')) : [...dirs, key],
                    )
                    await refresh($)
                  }}
                >
                  {`${isOpen ? '▾' : '▸'} ${entry.name}/`}
                </Button>
                {changedDirs.has(key) && <Text color="yellow"> ●</Text>}
              </Box>,
            )
            if (isOpen) walk(key, depth + 1)
          } else {
            rows.push(
              <Box key={`row-${rows.length}`} flexDirection="row">
                {mark(key)}
                <Text>{indent} </Text>
                <Button key={`file-${rows.length}`} plain dimColor={all[key] === undefined} onPress={pick(key)}>
                  {entry.name}
                </Button>
              </Box>,
            )
          }
        }
      }
      walk('', 0)

      const outside = changed.filter(key => key.startsWith('/'))
      if (outside.length > 0) rows.push(<Text key={`row-${rows.length}`} dimColor>Outside the project</Text>)
      for (const key of outside) {
        rows.push(
          <Box key={`row-${rows.length}`} flexDirection="row">
            {mark(key)}
            <Text> </Text>
            <Button key={`file-${rows.length}`} plain onPress={pick(key)}>
              {key}
            </Button>
          </Box>,
        )
      }
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="filter" hotkey="c" onPress={() => update($, isChangedOnly, now => !now)}>
            {isFiltered ? 'All files' : 'Changed only'}
          </Button>
          <Text dimColor>{changed.length} changed</Text>
        </Box>
        {rows.length === 0 && (
          <Text dimColor>{isFiltered ? 'Claude has not changed any files yet.' : 'Loading…'}</Text>
        )}
        {rows}
      </Box>
    )
  })
}
