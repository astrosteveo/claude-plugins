import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { MemsyncLastSync, MemsyncProject, MemsyncShared, MemsyncView } from '../types'
import {
  basename,
  changedAreas,
  clockLabel,
  conflictCopies,
  cwdFromTranscript,
  dirname,
  expandHome,
  findSecrets,
  isUnder,
  memoryDirFromSection,
  parseAction,
  parseStatus,
  projectKey,
  stamp,
  unionLines,
} from './core'
import type { Paths } from './core'

type $ = EngineInterface

const PANE = 'memsync'
const LOG_KEEP = 40
const LOG_SHOW = 6
// Network calls get 30 s each, like the old script
const NET_MS = 30_000
const GIT_MS = 15_000
// Longer than a whole sync, so the lock never drops in the middle of one
const LOCK_HOLD_S = 300
const LOCK_WAIT_S = 60
// Quiet time after a turn before a changed memory syncs
const DEBOUNCE_MS = 3_000
// fs.read stops at 4 MiB
const READ_LIMIT = 4 * 1024 * 1024

const EMPTY: MemsyncView = {
  phase: 'idle',
  error: '',
  repoPath: '',
  repo: null,
  lastSync: null,
  project: null,
  linked: [],
  unlinked: [],
  dead: [],
  conflicts: [],
  shared: [],
  log: [],
}
const view = atom({ plugin: 'memsync', key: 'view' } as const, EMPTY)

const COLOR = { ok: '#A3BE8C', warn: '#EBCB8B', bad: '#BF616A', dim: '#6B7280', accent: '#88C0D0' }

// Module state; a reload starts it over, and the store keeps what matters
let paths: Paths | null = null
let lastSnapshot = ''
let debounce: { cancel: () => void } | null = null
let isSyncing = false

type Run = { exitCode: number; stdout: string; stderr: string }

const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0' }

async function run($: $, argv: string[], timeoutMs = GIT_MS): Promise<Run> {
  try {
    // No credential prompts: one would land in Claude Code's terminal and hang
    const r = await $.process.run(argv, { timeoutMs, env: NO_PROMPT })
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err) }
  }
}

const git = ($: $, repo: string, args: string[], timeoutMs = GIT_MS) => run($, ['git', '-C', repo, ...args], timeoutMs)
const lines = (text: string) => text.split('\n').filter(line => line !== '')
const firstLine = (r: Run) => lines(r.stderr)[0] ?? lines(r.stdout)[0] ?? `exit ${r.exitCode}`

async function resolvePaths($: $, options: PluginOptions): Promise<Paths> {
  if (paths) return paths
  const home = (await $.env.get('HOME')) ?? ''
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const repo = expandHome(String(options['repoPath'] ?? '~/claude-memory'), home).replace(/\/+$/, '')
  let host = ''
  try {
    host = (await $.fs.read('/etc/hostname')).toString().trim()
  } catch {
    host = (await $.env.get('HOSTNAME')) ?? ''
  }
  paths = {
    repo,
    projectsRoot: expandHome(String(options['projectsRoot'] ?? '~/Projects'), home).replace(/\/+$/, ''),
    claudeDir: (configDir || `${home}/.claude`).replace(/\/+$/, ''),
    lock: `${repo}/.memsync.lock`,
    host: host || 'this-machine',
  }
  return paths
}

async function isEnabled($: $) {
  return (await $.store.get('enabled')) !== false
}

async function patch($: $, change: Partial<MemsyncView>) {
  await update($, view, v => ({ ...v, ...change }))
}

async function log($: $, text: string) {
  const at = clockLabel(await $.clock.now(), await $.clock.now())
  const kept = (((await $.store.get('log')) as string[] | undefined) ?? []).concat(`${at} ${text}`).slice(-LOG_KEEP)
  await $.store.set('log', kept)
  await patch($, { log: kept.slice(-LOG_SHOW) })
}

async function showStatus($: $) {
  const v = await read($, view)
  const now = await $.clock.now()
  if (v.phase === 'off') $.ui.status('mem off')
  else if (v.phase === 'syncing') $.ui.status('mem ⟳')
  else if (v.phase === 'error') $.ui.status('mem ! sync failed: /memsync')
  else if (v.conflicts.length > 0) $.ui.status(`mem ! ${v.conflicts.length} conflict${v.conflicts.length === 1 ? '' : 's'}`)
  else $.ui.status(v.lastSync ? `mem ✓ ${clockLabel(v.lastSync.at, now)}` : 'mem ✓')
}

async function fail($: $, message: string) {
  const before = await read($, view)
  await $.store.set('error', message)
  await patch($, { phase: 'error', error: message })
  await log($, message)
  if (before.error !== message) $.ui.toast(`memsync: ${message}`, { timeoutMs: 8000 })
  await showStatus($)
  return message
}

// ---- Files ------------------------------------------------------------------

async function stat($: $, path: string) {
  try {
    return await $.fs.stat(path, { resolve: true })
  } catch {
    return null
  }
}

/** Every file under `dir`, relative to it. Links and caches are skipped. */
async function walk($: $, dir: string, prefix = ''): Promise<{ rel: string; size: number; mtimeMs: number }[]> {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const found: { rel: string; size: number; mtimeMs: number }[] = []
  for (const entry of entries) {
    if (entry.isLink || entry.name === '.git' || entry.name === '__pycache__') continue
    const rel = prefix + entry.name
    if (entry.kind === 'dir') found.push(...(await walk($, `${dir}/${entry.name}`, `${rel}/`)))
    else if (entry.kind === 'file') found.push({ rel, size: entry.size, mtimeMs: entry.mtimeMs })
  }
  return found
}

/** $.fs.write makes missing parent folders; this leaves a note in a new one. */
async function ensureDir($: $, dir: string, note: string) {
  if (!(await $.fs.exists(dir))) await $.fs.write(`${dir}/README.md`, `${note}\n`)
}

/**
 * Copies memories from src into dst without overwriting. MEMORY.md indexes
 * merge line by line; any other file that differs is kept under a host name.
 */
async function mergeInto($: $, src: string, dst: string) {
  const p = paths!
  for (const file of await walk($, src)) {
    if (file.size > READ_LIMIT) {
      await log($, `skipped ${file.rel}: too big to copy`)
      continue
    }
    let text: string
    try {
      text = String(await $.fs.read(`${src}/${file.rel}`))
    } catch {
      await log($, `skipped ${file.rel}: unreadable`)
      continue
    }
    if (text.includes('\u0000')) {
      await log($, `skipped ${file.rel}: not a text file`)
      continue
    }
    const target = `${dst}/${file.rel}`
    if (!(await $.fs.exists(target))) {
      await $.fs.write(target, text)
      continue
    }
    const current = String(await $.fs.read(target))
    if (current === text) continue
    if (basename(file.rel) === 'MEMORY.md') {
      await $.fs.write(target, unionLines(current, text))
    } else {
      const copy = `${target.replace(/\.md$/, '')}.${p.host}.md`
      await $.fs.write(copy, text)
      await log($, `conflict: kept both copies of ${file.rel} in ${basename(dst)}`)
    }
  }
}

/** Moves a real file or folder at `path` into a backup folder. */
async function moveAside($: $, path: string, backupDir: string, name: string) {
  await ensureDir($, backupDir, 'memsync moved these aside before linking their place to the memory repo.')
  const target = `${backupDir}/${name}-${stamp(await $.clock.now())}`
  const moved = await run($, ['mv', '--', path, target])
  if (moved.exitCode !== 0) throw new Error(`could not move ${path} aside: ${firstLine(moved)}`)
  return target
}

// ---- Projects -----------------------------------------------------------------

type ProjectInfo = { root: string; key: string; isWorktree: boolean }

/** The project folder as Claude Code keys memory on it, and its repo key. */
async function projectInfo($: $, dir: string): Promise<ProjectInfo | null> {
  const top = await run($, ['git', '-C', dir, 'rev-parse', '--show-toplevel', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir', '--is-bare-repository'])
  if (top.exitCode !== 0) return { root: dir, key: basename(dir), isWorktree: false }
  const [toplevel, gitDir, common, bare] = lines(top.stdout)
  if (bare === 'true' || !toplevel) return null
  // A linked worktree shares its main repo's memory; a submodule has its own
  const isWorktree = common !== undefined && common.endsWith('/.git') && gitDir !== common
  const root = isWorktree ? dirname(common!) : toplevel
  const remote = await git($, root, ['remote', 'get-url', 'origin'])
  return { root, key: projectKey(remote.exitCode === 0 ? remote.stdout : '', root), isWorktree }
}

/** The memory folder the engine uses for this session. */
async function reportedMemoryDir($: $): Promise<string> {
  try {
    const composed = await $.prompt.compose()
    const found = memoryDirFromSection(composed.sections.find(s => s.id === 'memory')?.text)
    if (found) return found
  } catch {
    // Fall back to the files the context carries
  }
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const index = usage.context.breakdown?.memoryFiles.find(f => f.type === 'AutoMem')
    if (index) return dirname(index.path)
  } catch {
    // Nothing reported yet
  }
  return ''
}

type LinkResult = 'linked' | 'already' | 'outside' | 'off'

/** Points a project's memory folder at projects/<key> in the repo. */
async function linkProject($: $, memoryDir: string, root: string): Promise<LinkResult> {
  const p = paths!
  if (!isUnder(root, p.projectsRoot) && root !== p.projectsRoot) return 'outside'
  const here = await stat($, memoryDir)
  if (here?.isLink) return 'already'
  const info = await projectInfo($, root)
  if (!info) return 'outside'
  const store = `${p.repo}/projects/${info.key}`
  if (here) {
    await mergeInto($, memoryDir, store)
    await moveAside($, memoryDir, `${p.claudeDir}/backups/memory`, basename(dirname(memoryDir)))
  }
  if (!(await $.fs.exists(store))) await $.fs.write(`${store}/.gitkeep`, '')
  const linked = await run($, ['ln', '-s', '--', store, memoryDir])
  if (linked.exitCode !== 0) throw new Error(`could not link ${memoryDir}: ${firstLine(linked)}`)
  await log($, `linked ${root} -> projects/${info.key}`)
  return 'linked'
}

/** Links claude/CLAUDE.md and each skills/<name> into the Claude config folder. */
async function linkShared($: $): Promise<MemsyncShared[]> {
  const p = paths!
  const pairs: { name: string; src: string; dst: string }[] = []
  if (await $.fs.exists(`${p.repo}/claude/CLAUDE.md`)) {
    pairs.push({ name: 'CLAUDE.md', src: `${p.repo}/claude/CLAUDE.md`, dst: `${p.claudeDir}/CLAUDE.md` })
  }
  let skills: { name: string; kind: string }[] = []
  try {
    skills = await $.fs.list(`${p.repo}/skills`)
  } catch {
    // No shared skills
  }
  for (const skill of skills) {
    if (skill.kind === 'dir') pairs.push({ name: skill.name, src: `${p.repo}/skills/${skill.name}`, dst: `${p.claudeDir}/skills/${skill.name}` })
  }
  if (pairs.some(pair => pair.name !== 'CLAUDE.md')) {
    await ensureDir($, `${p.claudeDir}/skills`, 'User skills. memsync links shared skills here.')
  }

  const shared: MemsyncShared[] = []
  for (const pair of pairs) {
    const want = (await stat($, pair.src))?.realPath ?? pair.src
    const have = await stat($, pair.dst)
    if (have?.isLink && have.realPath === want) {
      shared.push({ name: pair.name, isLinked: true })
      continue
    }
    try {
      if (have || (await $.fs.list(dirname(pair.dst))).some(e => e.name === basename(pair.dst))) {
        await moveAside($, pair.dst, `${p.claudeDir}/backups/memsync`, basename(pair.dst))
        await log($, `moved old ${pair.dst} to backups/memsync`)
      }
      const linked = await run($, ['ln', '-s', '--', pair.src, pair.dst])
      shared.push({ name: pair.name, isLinked: linked.exitCode === 0 })
      if (linked.exitCode !== 0) await log($, `could not link ${pair.name}: ${firstLine(linked)}`)
    } catch (err) {
      shared.push({ name: pair.name, isLinked: false })
      await log($, String(err instanceof Error ? err.message : err))
    }
  }
  return shared
}

/** Sorts every project folder Claude Code knows into linked, unlinked and dead. */
async function scanProjects($: $) {
  const p = paths!
  const cache = ((await $.store.get('cwds')) as Record<string, string> | undefined) ?? {}
  const result = { linked: [] as MemsyncProject[], unlinked: [] as MemsyncProject[], dead: [] as MemsyncProject[] }
  let folders: { name: string; kind: string }[] = []
  try {
    folders = await $.fs.list(`${p.claudeDir}/projects`)
  } catch {
    return result
  }
  let isCacheChanged = false
  for (const folder of folders) {
    if (folder.kind !== 'dir') continue
    const dir = `${p.claudeDir}/projects/${folder.name}`
    let cwd = cache[folder.name]
    if (cwd === undefined) {
      cwd = (await transcriptCwd($, dir)) ?? ''
      cache[folder.name] = cwd
      isCacheChanged = true
    }
    if (!isUnder(cwd, p.projectsRoot)) continue
    const memoryDir = `${dir}/memory`
    const mem = await stat($, memoryDir)
    const key = mem?.isLink && mem.realPath && isUnder(mem.realPath, `${p.repo}/projects`) ? basename(mem.realPath) : ''
    if (!(await $.fs.exists(cwd))) {
      if (mem) result.dead.push({ root: cwd, key, memoryDir })
    } else if (mem?.isLink) {
      result.linked.push({ root: cwd, key, memoryDir })
    } else {
      // Only folders Claude Code keys memory on: a project root, not a subfolder or worktree
      const info = await projectInfo($, cwd)
      if (info && info.root === cwd && !info.isWorktree) result.unlinked.push({ root: cwd, key: info.key, memoryDir })
    }
  }
  if (isCacheChanged) await $.store.set('cwds', cache)
  const byRoot = (a: MemsyncProject, b: MemsyncProject) => a.root.localeCompare(b.root)
  return { linked: result.linked.sort(byRoot), unlinked: result.unlinked.sort(byRoot), dead: result.dead.sort(byRoot) }
}

async function transcriptCwd($: $, dir: string): Promise<string | null> {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return null
  }
  const transcripts = entries
    .filter(e => e.kind === 'file' && e.name.endsWith('.jsonl') && e.size > 0 && e.size < READ_LIMIT)
    .sort((a, b) => a.size - b.size)
  for (const transcript of transcripts.slice(0, 3)) {
    try {
      const cwd = cwdFromTranscript(String(await $.fs.read(`${dir}/${transcript.name}`)))
      if (cwd) return cwd
    } catch {
      // Try the next one
    }
  }
  return null
}

// ---- Git ------------------------------------------------------------------------

/**
 * Runs `task` while holding the repo's flock, the same lock the old memsync
 * script takes, so sessions and the script never sync at once.
 *
 * The holder takes the lock with `-n` and then runs a second flock that waits
 * on the same lock, which keeps the holder alive until we end its stream (or
 * LOCK_HOLD_S passes). flock's own output is buffered, so a probe tells us
 * instead: if the lock is busy for 0.4 s while our holder still runs, the
 * holder has it. Every wait here is a `$` call, which a hook's budget skips.
 */
async function withLock<T>($: $, waitS: number, task: () => Promise<T>): Promise<T | 'busy'> {
  const p = paths!
  const deadline = (await $.clock.now()) + waitS * 1000
  for (;;) {
    const holder = $.process.spawn({
      argv: ['flock', '-o', '-n', p.lock, 'flock', '-w', String(LOCK_HOLD_S), p.lock, 'git', '--version'],
    })
    const pieces = holder[Symbol.asyncIterator]()
    let hasEnded = false
    void pieces.next().then(
      () => (hasEnded = true),
      () => (hasEnded = true),
    )
    // Ending the stream kills the holder, which lets the lock go
    const release = async () => {
      try {
        await pieces.return?.(undefined as never)
      } catch {
        // Already gone
      }
    }
    const probe = await run($, ['flock', '-w', '0.4', '-E', '75', p.lock, 'git', '--version'])
    if (probe.exitCode === 75 && !hasEnded) {
      try {
        return await task()
      } finally {
        await release()
      }
    }
    await release()
    if ((await $.clock.now()) >= deadline) return 'busy'
  }
}

async function abortStuckRebase($: $) {
  const repo = paths!.repo
  if ((await $.fs.exists(`${repo}/.git/rebase-merge`)) || (await $.fs.exists(`${repo}/.git/rebase-apply`))) {
    await git($, repo, ['rebase', '--abort'])
    await log($, 'aborted a rebase left stuck by an earlier sync')
  }
}

type Commit = { ok: true; names: string[] } | { ok: false; message: string }

/** Stages everything, refuses secrets, commits. */
async function commitLocal($: $): Promise<Commit> {
  const p = paths!
  const added = await git($, p.repo, ['add', '-A'])
  if (added.exitCode !== 0) return { ok: false, message: `git add failed: ${firstLine(added)}` }
  // bin/ holds the old script and its tests, which contain patterns, not secrets
  const diff = await git($, p.repo, ['diff', '--cached', '-U0', '--no-color', '--', '.', ':!bin'])
  const hits = findSecrets(diff.stdout)
  if (hits.length > 0) {
    await git($, p.repo, ['reset', '-q'])
    return { ok: false, message: `not synced: possible secret in ${hits.join(' ')}` }
  }
  const names = lines((await git($, p.repo, ['diff', '--cached', '--name-only'])).stdout)
  if (names.length > 0) {
    const committed = await git($, p.repo, ['commit', '-q', '-m', `Sync from ${p.host}: ${changedAreas(names)}`])
    if (committed.exitCode !== 0) return { ok: false, message: `commit failed: ${firstLine(committed)}` }
  }
  return { ok: true, names }
}

type SyncResult = { ok: true; pushed: number; pulled: string[] } | { ok: false; message: string }

async function gitSync($: $): Promise<SyncResult> {
  const p = paths!
  const g = (args: string[], ms?: number) => git($, p.repo, args, ms)
  await abortStuckRebase($)
  const commit = await commitLocal($)
  if (!commit.ok) return commit
  if ((await g(['remote', 'get-url', 'origin'])).exitCode !== 0) return { ok: true, pushed: commit.names.length, pulled: [] }

  const branch = (await g(['branch', '--show-current'])).stdout.trim()
  if (branch === '') return { ok: false, message: `${p.repo} is not on a branch` }
  const fetched = await g(['fetch', '-q', 'origin'], NET_MS)
  if (fetched.exitCode !== 0) return { ok: false, message: 'fetch failed (offline?)' }

  const before = (await g(['rev-parse', 'HEAD'])).stdout.trim()
  const hasUpstream = (await g(['rev-parse', '-q', '--verify', `origin/${branch}`])).exitCode === 0
  if (hasUpstream && (await g(['rebase', '-q', `origin/${branch}`])).exitCode !== 0) {
    await g(['rebase', '--abort'])
    return { ok: false, message: `rebase onto origin/${branch} failed; resolve by hand in ${p.repo}` }
  }
  const after = (await g(['rev-parse', 'HEAD'])).stdout.trim()
  const pulled = before !== after && before !== '' ? lines((await g(['diff', '--name-only', before, after])).stdout) : []

  const ahead = hasUpstream ? Number((await g(['rev-list', '--count', `origin/${branch}..HEAD`])).stdout.trim()) : 1
  if (ahead > 0) {
    const pushed = await g(['push', '-q', '-u', 'origin', branch], NET_MS)
    if (pushed.exitCode !== 0) return { ok: false, message: `push failed: ${firstLine(pushed)}` }
  }
  return { ok: true, pushed: commit.names.length, pulled }
}

/** What turn.complete compares: this project's memory, CLAUDE.md and skills. */
async function snapshot($: $): Promise<string> {
  const p = paths!
  const v = await read($, view)
  const parts: string[] = []
  const add = (prefix: string, files: { rel: string; size: number; mtimeMs: number }[]) =>
    files.forEach(f => parts.push(`${prefix}${f.rel}:${f.size}:${f.mtimeMs}`))
  if (v.project?.key) add(`projects/${v.project.key}/`, await walk($, `${p.repo}/projects/${v.project.key}`))
  add('claude/', await walk($, `${p.repo}/claude`))
  add('skills/', await walk($, `${p.repo}/skills`))
  return parts.sort().join('\n')
}

async function refreshRepo($: $) {
  const p = paths!
  const [status, remote, files] = await Promise.all([
    git($, p.repo, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch']),
    git($, p.repo, ['remote', 'get-url', 'origin']),
    git($, p.repo, ['ls-files', '--', 'projects']),
  ])
  if (status.exitCode !== 0) {
    await patch($, { repo: null, conflicts: [] })
    return
  }
  const parsed = parseStatus(status.stdout)
  await patch($, {
    repo: { ...parsed, remote: remote.exitCode === 0 ? remote.stdout.trim() : '' },
    conflicts: conflictCopies(lines(files.stdout)),
  })
}

const OFF_TEXT = 'Memsync is off. Run /memsync on to turn it on.'
const BUSY = 'another sync held the lock for a minute; try again'

async function repoMissing($: $): Promise<string | null> {
  const p = paths!
  if (await $.fs.exists(`${p.repo}/.git`)) return null
  return fail($, `${p.repo} is not a git repo; clone your memory repo there or change the Memory repo setting`)
}

/** gitSync with the pane showing it. Call it while holding the lock. */
async function gitSyncShown($: $): Promise<SyncResult> {
  isSyncing = true
  await patch($, { phase: 'syncing' })
  await showStatus($)
  try {
    return await gitSync($)
  } finally {
    isSyncing = false
  }
}

/** Records a sync's outcome, refreshes memory if the pull changed it. */
async function afterSync($: $, why: string, result: SyncResult): Promise<string> {
  if (!result.ok) {
    await refreshRepo($)
    // Retry on the next change, not on every turn
    lastSnapshot = await snapshot($)
    return fail($, result.message)
  }
  const now = await $.clock.now()
  const lastSync: MemsyncLastSync = { at: now, pushed: result.pushed, pulled: result.pulled.length }
  await $.store.set('lastSync', lastSync)
  await $.store.delete('error')
  await patch($, { phase: 'idle', error: '', lastSync })
  if (result.pushed > 0 || result.pulled.length > 0) {
    await log($, `${why}: pushed ${result.pushed}, pulled ${result.pulled.length}`)
  }

  if (result.pulled.length > 0) {
    const v = await read($, view)
    const key = v.project?.key
    const touchesUs = result.pulled.some(name => (key && name.startsWith(`projects/${key}/`)) || name === 'claude/CLAUDE.md')
    if (touchesUs) {
      // The memory section names the folder; the MEMORY.md index rides in the context blocks
      $.ui.invalidate('prompt.section')
      $.ui.invalidate('prompt.context')
      $.ui.toast('memsync: pulled new memory from another machine')
    }
    if (result.pulled.some(name => name.startsWith('skills/') || name === 'claude/CLAUDE.md')) {
      await patch($, { shared: await linkShared($) })
    }
  }
  await refreshRepo($)
  lastSnapshot = await snapshot($)
  await showStatus($)
  return `Synced: pushed ${result.pushed} file${result.pushed === 1 ? '' : 's'}, pulled ${result.pulled.length}.`
}

/** Commit, pull and push now. */
async function syncOp($: $, why: string): Promise<string> {
  if (!(await isEnabled($))) return OFF_TEXT
  const missing = await repoMissing($)
  if (missing) return missing
  const result = await withLock($, LOCK_WAIT_S, () => gitSyncShown($))
  if (result === 'busy') return fail($, BUSY)
  return afterSync($, why, result)
}

// ---- Session ---------------------------------------------------------------------

/** Finds this session's memory folder and links it. Call it while holding the lock. */
async function linkHere($: $): Promise<string> {
  const p = paths!
  const root = await $.session.root()
  const memoryDir = await reportedMemoryDir($)
  const info = await projectInfo($, root)
  const projectRoot = info?.root ?? root
  if (!isUnder(projectRoot, p.projectsRoot)) {
    await patch($, { project: null })
    return `${projectRoot} is outside ${p.projectsRoot}, so its memory stays on this machine.`
  }
  const project = { root: projectRoot, key: info?.key ?? basename(projectRoot), memoryDir }
  if (memoryDir === '') {
    await patch($, { project: { ...project, state: 'unknown' } })
    return 'Claude Code has not reported this project’s memory folder yet.'
  }
  try {
    const result = await linkProject($, memoryDir, projectRoot)
    await patch($, { project: { ...project, state: 'linked' } })
    return `${result === 'already' ? 'Already linked' : 'Linked'} ${projectRoot} to projects/${project.key}.`
  } catch (err) {
    await patch($, { project: { ...project, state: 'unlinked' } })
    return fail($, String(err instanceof Error ? err.message : err))
  }
}

async function linkOp($: $): Promise<string> {
  if (!(await isEnabled($))) return OFF_TEXT
  const missing = await repoMissing($)
  if (missing) return missing
  const result = await withLock($, LOCK_WAIT_S, () => linkHere($))
  return result === 'busy' ? fail($, BUSY) : result
}

async function linkAllOp($: $): Promise<string> {
  if (!(await isEnabled($))) return OFF_TEXT
  const missing = await repoMissing($)
  if (missing) return missing
  const p = paths!
  const here = await read($, view)
  // The other folders follow the engine's layout only while this one does
  if (here.project?.memoryDir && dirname(dirname(here.project.memoryDir)) !== `${p.claudeDir}/projects`) {
    return 'This machine keeps memory outside the usual folder, so only the current project links. Open each project to link it.'
  }
  const scan = await scanProjects($)
  let count = 0
  const failed: string[] = []
  const result = await withLock($, LOCK_WAIT_S, async () => {
    for (const project of scan.unlinked) {
      try {
        if ((await linkProject($, project.memoryDir, project.root)) === 'linked') count += 1
      } catch (err) {
        failed.push(`${basename(project.root)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  })
  if (result === 'busy') return fail($, BUSY)
  await refreshProjects($)
  if (failed.length > 0) await fail($, `could not link ${failed.join('; ')}`)
  return `Linked ${count} project${count === 1 ? '' : 's'}.${failed.length ? ` ${failed.length} failed.` : ''}`
}

async function refreshProjects($: $) {
  const scan = await scanProjects($)
  await patch($, scan)
}

let isLoaded = false
let isStarted = false

/**
 * Start-up work, once per session: abort a stuck rebase, pull, link this
 * project and the shared files, and sync again if linking brought in memory.
 * Pulling before linking lets a merge see the other machines' copies. The session.start hook starts it without
 * waiting; a command that comes first does it inline, and whichever gets the
 * lock second finds it done. Returns the sync's summary when this call ran it.
 */
async function startupOnce($: $): Promise<string | null> {
  const p = paths!
  if (!isLoaded) {
    isLoaded = true
    const [lastSync, error, logLines] = await Promise.all([
      $.store.get('lastSync') as Promise<MemsyncLastSync | undefined>,
      $.store.get('error') as Promise<string | undefined>,
      $.store.get('log') as Promise<string[] | undefined>,
    ])
    await patch($, {
      repoPath: p.repo,
      lastSync: lastSync ?? null,
      error: error ?? '',
      phase: error ? 'error' : 'idle',
      log: (logLines ?? []).slice(-LOG_SHOW),
    })
  }
  if (isStarted) return null
  if (!(await isEnabled($))) {
    await patch($, { phase: 'off' })
    await showStatus($)
    return null
  }
  const missing = await repoMissing($)
  if (missing) return missing
  const result = await withLock($, LOCK_WAIT_S, async () => {
    if (isStarted) return null
    isStarted = true
    await abortStuckRebase($)
    const pulled = await gitSyncShown($)
    if (!pulled.ok) return pulled
    await linkHere($)
    await patch($, { shared: await linkShared($) })
    if ((await git($, p.repo, ['status', '--porcelain'])).stdout.trim() === '') return pulled
    const pushed = await gitSyncShown($)
    return pushed.ok ? { ...pushed, pulled: [...pulled.pulled, ...pushed.pulled] } : pushed
  })
  if (result === 'busy') return fail($, BUSY)
  return result === null ? null : afterSync($, 'start', result)
}

async function setEnabled($: $, isOn: boolean) {
  await $.store.set('enabled', isOn)
  await patch($, { phase: isOn ? 'idle' : 'off' })
  await showStatus($)
  if (isOn) {
    isStarted = false
    await startupOnce($)
  }
}

/** The end of a session: commit what changed, and push without waiting. */
async function finish($: $) {
  if (!paths || isSyncing || !(await isEnabled($))) return
  if ((await snapshot($)) === lastSnapshot) return
  const committed = await withLock($, 1, () => commitLocal($))
  if (committed === 'busy' || !committed.ok || committed.names.length === 0) return
  const branch = (await git($, paths.repo, ['branch', '--show-current'])).stdout.trim()
  if (branch === '') return
  // setsid -f outlives the session. Its child keeps our pipes, so don't wait on the stream
  const push = $.process.spawn({ argv: ['setsid', '-f', 'git', '-C', paths.repo, 'push', '-q', 'origin', branch], env: NO_PROMPT })
  const pieces = push[Symbol.asyncIterator]()
  await Promise.race([pieces.next().catch(() => undefined), $.clock.sleep(200)])
}

// ---- Pane --------------------------------------------------------------------------

const HELP = [
  '/memsync            open the pane',
  '/memsync sync       commit, pull and push now',
  '/memsync link       link this project’s memory',
  '/memsync link all   link every project in the projects folder',
  '/memsync status     show the state as text',
  '/memsync on | off   turn syncing on or off',
  '/memsync close      close the pane',
].join('\n')

function statusText(v: MemsyncView, now: number): string {
  const out = [
    `Memsync is ${v.phase === 'off' ? 'off' : 'on'}.`,
    v.lastSync
      ? `Last sync: ${clockLabel(v.lastSync.at, now)}, pushed ${v.lastSync.pushed}, pulled ${v.lastSync.pulled}.`
      : 'No sync yet.',
  ]
  if (v.error) out.push(`Problem: ${v.error}`)
  if (v.repo) out.push(`Repo: ${v.repoPath} on ${v.repo.branch || '?'}, ${v.repo.ahead} ahead, ${v.repo.behind} behind, ${v.repo.dirty} uncommitted.`)
  if (v.project) out.push(`This project: ${v.project.root} → projects/${v.project.key} (${v.project.state}).`)
  out.push(`Projects: ${v.linked.length} linked, ${v.unlinked.length} unlinked, ${v.dead.length} dead.`)
  if (v.unlinked.length) out.push(`Unlinked: ${v.unlinked.map(x => x.root).join(', ')}`)
  if (v.conflicts.length) out.push(`Conflict copies: ${v.conflicts.join(', ')}`)
  if (v.shared.length) out.push(`Shared: ${v.shared.map(s => `${s.name} ${s.isLinked ? '✓' : '✗'}`).join(', ')}`)
  return out.join('\n')
}

const short = (path: string, home: string) => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await resolvePaths($, options)
    await $.command.register({
      name: 'memsync',
      description: 'Show the memory sync pane, or sync, link, status, on, off',
      argumentHint: '[sync | link [all] | status | on | off | close]',
    })
    // Never awaited: the first prompt must not wait on the network
    void startupOnce($).catch(err => fail($, String(err)))
    return result
  })

  // Git runs only when a memory, skill or CLAUDE.md changed during the turn
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && paths && !isSyncing && (await isEnabled($))) {
      const now = await snapshot($)
      if (now !== lastSnapshot) {
        debounce?.cancel()
        debounce = $.clock.after(DEBOUNCE_MS, () => void syncOp($, 'change'))
      }
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    await Promise.race([finish($).catch(() => undefined), $.clock.sleep(1000)])
    return next(e)
  })

  on('command.run', { command: 'memsync' }, async ($, e) => {
    await resolvePaths($, options)
    const action = parseAction(e.args)
    if (action === 'help') return { text: HELP }
    if (action === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    if (action === 'on' || action === 'off') {
      await setEnabled($, action === 'on')
      return { text: `Memsync is ${action}.` }
    }
    // Start-up runs first, here or in the background, so answers reflect it
    const started = await startupOnce($)
    if (action === 'sync') return { text: started ?? (await syncOp($, 'manual')) }
    if (action === 'link') return { text: await linkOp($) }
    if (action === 'link-all') return { text: await linkAllOp($) }
    await refreshRepo($)
    await refreshProjects($)
    if (action === 'status') return { text: statusText(await read($, view), await $.clock.now()) }
    await $.ui.open({ id: PANE, title: 'claude-memory' })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    const now = await $.clock.now()
    const home = (await $.env.get('HOME')) ?? ''
    const isOff = v.phase === 'off'

    const act = (task: () => Promise<unknown>) => () => {
      void task().catch(err => fail($, String(err)))
    }
    const toggle = act(() => setEnabled($, isOff))
    const syncNow = act(() => syncOp($, 'manual'))
    const linkThis = act(async () => {
      await linkOp($)
      await refreshProjects($)
    })
    const linkEvery = act(() => linkAllOp($))
    const merge = (copy: string) =>
      act(() =>
        $.prompt.fill({
          text: `Merge the memsync conflict copy ${v.repoPath}/${copy} into ${v.repoPath}/${copy.replace(/\.[^./]+\.md$/, '.md')}, keep every fact from both, then delete the copy.`,
          mode: 'replace',
        }),
      )

    const label = (text: string) => (
      <Box width={13}>
        <Text color={COLOR.dim}>{text}</Text>
      </Box>
    )
    const stateText =
      v.phase === 'off' ? (
        <Text color={COLOR.dim}>○ off</Text>
      ) : v.phase === 'error' ? (
        <Text color={COLOR.bad}>● error</Text>
      ) : v.phase === 'syncing' ? (
        <Text color={COLOR.accent}>⟳ syncing</Text>
      ) : (
        <Text color={COLOR.ok}>● on</Text>
      )

    const repoLine = v.repo ? (
      <Text wrap="truncate">
        {short(v.repoPath, home)} → {v.repo.remote ? `origin/${v.repo.branch}` : `${v.repo.branch} (no remote)`}
        {v.repo.ahead > 0 ? ` ↑${v.repo.ahead}` : ''}
        {v.repo.behind > 0 ? ` ↓${v.repo.behind}` : ''}
        <Text color={v.repo.dirty > 0 ? COLOR.warn : COLOR.ok}>
          {v.repo.dirty > 0 ? ` (${v.repo.dirty} uncommitted)` : ' (clean)'}
        </Text>
      </Text>
    ) : (
      <Text color={COLOR.bad}>{short(v.repoPath, home)} is not a git repo</Text>
    )

    const project = v.project
    const projectLine = project ? (
      <Text wrap="truncate">
        {basename(project.root)} → projects/{project.key}{' '}
        {project.state === 'linked' ? (
          <Text color={COLOR.ok}>✓</Text>
        ) : project.state === 'unknown' ? (
          <Text color={COLOR.dim}>(memory folder not reported yet)</Text>
        ) : (
          <Text color={COLOR.warn}>not linked</Text>
        )}
      </Text>
    ) : (
      <Text color={COLOR.dim}>outside the projects folder, stays on this machine</Text>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" columnGap={2}>
          {stateText}
          <Button key="toggle" label={isOff ? 'Turn on' : 'Turn off'} hotkey="t" onPress={toggle} />
        </Box>
        {v.error !== '' && <Text color={COLOR.bad}>{v.error}</Text>}

        <Box flexDirection="column">
          <Box flexDirection="row">
            {label('Last sync')}
            <Text>
              {v.lastSync
                ? `${clockLabel(v.lastSync.at, now)}  pushed ${v.lastSync.pushed}, pulled ${v.lastSync.pulled}`
                : 'not yet'}{' '}
            </Text>
            <Button key="sync" label="Sync now" hotkey="s" variant="primary" onPress={syncNow} />
          </Box>
          <Box flexDirection="row">
            {label('Repo')}
            {repoLine}
          </Box>
          <Box flexDirection="row">
            {label('This project')}
            {projectLine}
            {project && project.state === 'unlinked' && <Button key="link" label="Link" hotkey="l" onPress={linkThis} />}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Box flexDirection="row">
            {label('Projects')}
            <Text>
              {v.linked.length} linked · {v.unlinked.length} unlinked · {v.dead.length} dead{' '}
            </Text>
            {v.unlinked.length > 0 && <Button key="link-all" label="Link all" hotkey="a" onPress={linkEvery} />}
          </Box>
          {v.unlinked.map(x => (
            <Text color={COLOR.warn} wrap="truncate">
              {'  '}! {short(x.root, home)} not linked
            </Text>
          ))}
          {v.dead.map(x => (
            <Text color={COLOR.dim} wrap="truncate">
              {'  '}✗ {short(x.root, home)} folder gone{x.key ? ` (projects/${x.key} kept)` : ''}
            </Text>
          ))}
        </Box>

        <Box flexDirection="column">
          <Box flexDirection="row">
            {label('Conflicts')}
            <Text color={v.conflicts.length > 0 ? COLOR.warn : COLOR.ok}>{v.conflicts.length === 0 ? 'none' : v.conflicts.length}</Text>
          </Box>
          {v.conflicts.map(copy => (
            <Box flexDirection="row">
              <Text wrap="truncate">{'  '}{copy} </Text>
              <Button key={`merge-${copy}`} label="Merge" onPress={merge(copy)} />
            </Box>
          ))}
        </Box>

        <Box flexDirection="row">
          {label('Shared')}
          <Text wrap="wrap">
            {v.shared.length === 0
              ? 'nothing shared'
              : v.shared.map(s => `${s.name} ${s.isLinked ? '✓' : '✗'}`).join('  ')}
          </Text>
        </Box>

        <Box flexDirection="column">
          {label('Log')}
          {v.log.length === 0 && <Text color={COLOR.dim}>{'  '}nothing yet</Text>}
          {v.log.map(line => (
            <Text color={COLOR.dim} wrap="truncate">
              {'  '}{line}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
