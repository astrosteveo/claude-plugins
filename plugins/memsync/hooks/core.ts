// Pure helpers: no `$`, so the tests call them directly.

import type { MemsyncErrorKind, MemsyncPhase, MemsyncView } from '../types'

// Values that look like credentials. Names of secrets are fine; values aren't.
// `sk-` needs a non-word, non-dash char before it, so kebab names like
// `risk-assessment-…` or `use-sk-learn-…` pass.
export const SECRET_RE =
  /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?<![\w-])sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|(KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*[=:]\s*["']?[A-Za-z0-9/+_-]{16,}/

/** Files whose added lines in a `git diff -U0` look like a secret. */
export function findSecrets(diff: string): string[] {
  const hits = new Set<string>()
  let file = ''
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/.* b\/(.*)$/.exec(line)
    if (header) file = header[1]!
    else if (line.startsWith('+') && !line.startsWith('+++') && SECRET_RE.test(line)) hits.add(file)
  }
  return [...hits]
}

/** Staged paths as a short list, such as "projects/app, skills/reflect". */
export function changedAreas(names: readonly string[]): string {
  const projects = new Set<string>()
  const rest = new Set<string>()
  for (const name of names) {
    const parts = name.split('/')
    if ((parts[0] === 'projects' || parts[0] === 'skills') && parts.length > 2) {
      ;(parts[0] === 'projects' ? projects : rest).add(`${parts[0]}/${parts[1]}`)
    } else rest.add(parts[0]!)
  }
  const areas = [...[...projects].sort(), ...[...rest].sort()]
  const list = areas.slice(0, 4).join(', ')
  return areas.length > 4 ? `${list} and ${areas.length - 4} more` : list
}

export type RepoStatus = { branch: string; ahead: number; behind: number; dirty: number }

export function parseStatus(porcelain: string): RepoStatus {
  const status: RepoStatus = { branch: '', ahead: 0, behind: 0, dirty: 0 }
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('# branch.head ')) status.branch = line.slice(14)
    else if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice(12).split(' ')
      status.ahead = Math.abs(Number(ahead))
      status.behind = Math.abs(Number(behind))
    } else if (line !== '' && !line.startsWith('#')) status.dirty += 1
  }
  return status
}

/** The memory folder named in the system prompt's `memory` section. */
export function memoryDirFromSection(text: string | null | undefined): string | null {
  if (!text) return null
  const found = /memory at `([^`]+)`/.exec(text) ?? /`(\/[^`]*\/memory)\/?`/.exec(text)
  return found ? found[1]!.replace(/\/+$/, '') : null
}

/** MEMORY.md from two machines: every line of both, each non-blank line once. */
export function unionLines(mine: string, theirs: string): string {
  const seen = new Set<string>()
  const lines = `${mine.replace(/\n$/, '')}\n${theirs.replace(/\n$/, '')}`.split('\n')
  return `${lines.filter(line => line.trim() === '' || (!seen.has(line) && seen.add(line))).join('\n')}\n`
}

/** Copies a merge kept under a host name: `notes.laptop.md` beside `notes.md`. */
export function conflictCopies(files: readonly string[]): string[] {
  const all = new Set(files)
  return files.filter(file => {
    const found = /^(.*)\.[^./]+\.md$/.exec(file)
    return found !== null && all.has(`${found[1]}.md`)
  })
}

/** The folder a session started in, from the first transcript line that has one. */
export function cwdFromTranscript(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!line.includes('"cwd"')) continue
    try {
      const row = JSON.parse(line) as { cwd?: unknown }
      if (typeof row.cwd === 'string' && row.cwd !== '') return row.cwd
    } catch {
      // A line cut short at the end of a live transcript
    }
  }
  return null
}

export const isUnder = (path: string, root: string) => root !== '' && path.startsWith(`${root.replace(/\/+$/, '')}/`)

export const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path

export const dirname = (path: string) => path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'

/** The repo's folder name for a project: the origin repo's name, else the folder's. */
export function projectKey(remoteUrl: string, root: string): string {
  const url = remoteUrl.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  return url !== '' ? basename(url.replace(/:/g, '/')) : basename(root)
}

export const expandHome = (path: string, home: string) =>
  path === '~' ? home : path.startsWith('~/') ? `${home}${path.slice(1)}` : path

const pad = (n: number) => String(n).padStart(2, '0')

export function clockLabel(ms: number, now: number): string {
  const at = new Date(ms)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (now - ms < 20 * 3_600_000) return time
  return `${at.toLocaleString('en-US', { month: 'short' })} ${at.getDate()} ${time}`
}

export function stamp(ms: number): string {
  const at = new Date(ms)
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
}

export type Paths = {
  repo: string
  projectsRoot: string
  claudeDir: string
  lock: string
  host: string
}

/** What `/memsync <args>` asks for. */
export type Action = 'open' | 'status' | 'log' | 'sync' | 'link' | 'link-all' | 'prune' | 'on' | 'off' | 'close' | 'help'

export function parseAction(args: string): Action {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'open'
  if (words[0] === 'link') return words[1] === 'all' ? 'link-all' : 'link'
  const known: Action[] = ['status', 'log', 'sync', 'prune', 'on', 'off', 'close']
  return known.includes(words[0] as Action) ? (words[0] as Action) : 'help'
}

/** Text that Text and Code accept: CRLF made LF, other control characters dropped. */
export const clean = (text: string) =>
  text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')

/** `text` cut to `max` characters, ending in an ellipsis when cut. */
export const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)

/** The file a conflict copy was kept beside: notes.laptop.md → notes.md. */
export const originalOf = (copy: string) => copy.replace(/\.[^./]+\.md$/, '.md')

/**
 * The line pinned under the prompt, or undefined when nothing needs the person.
 * Claude Code draws every pinned line as a warning, so a healthy sync pins none.
 */
export function statusLine(v: Pick<MemsyncView, 'phase' | 'error' | 'conflicts' | 'project'>): string | undefined {
  if (v.phase === 'off') return 'memory sync is off: /memsync on'
  if (v.phase === 'error') return v.error ? `memory sync failed (${cut(v.error, 60)}): /memsync` : 'memory sync failed: /memsync'
  if (v.project?.state === 'unlinked') return 'memory sync: this project’s memory isn’t linked: /memsync link'
  const n = v.conflicts.length
  if (n > 0) return `memory sync: ${n} conflict cop${n === 1 ? 'y' : 'ies'} to merge: /memsync`
  return undefined
}

/** The kind of an error stored before kinds were, read from its words. */
export function kindOf(error: string): MemsyncErrorKind {
  if (error.startsWith('rebase onto')) return 'rebase'
  if (error.startsWith('fetch failed')) return 'offline'
  if (error.startsWith('push failed')) return 'push'
  if (error.includes('possible secret')) return 'secret'
  if (error.includes('is not a git repo')) return 'repo'
  if (error.includes('held the lock')) return 'busy'
  return 'other'
}

/** The footer label while a sync runs or waits, beside Claude Code's own modes. */
export function modeLabel(phase: MemsyncPhase): string | null {
  if (phase === 'syncing') return 'memory syncing'
  if (phase === 'waiting') return 'memory sync waiting'
  return null
}

/**
 * A prompt asking Claude to fix the failure, or null when there is none to
 * offer. Offline and a busy lock need only Sync now. A failed rebase gets
 * none: every sync aborts a rebase in progress, so a turn that ends mid-rebase
 * would lose the work.
 */
export function fixPrompt(kind: MemsyncErrorKind, error: string, repo: string): string | null {
  const hands = 'Don’t commit or push. Memsync does that on its next sync.'
  switch (kind) {
    case 'secret':
      return `Memsync didn’t sync my memory repo at ${repo} because of this: ${error}. In each file it names, remove the secret value and keep only the secret’s name or where it’s stored. ${hands}`
    case 'push':
      return `Memsync can’t push my memory repo at ${repo}. Git said: ${error}. Find out why and fix it. ${hands}`
    case 'repo':
      return `Memsync needs a git clone of my private memory repo at ${repo}, and there isn’t one. Help me find that repo on my git host and clone it to ${repo}. If I don’t have one yet, help me create a private one.`
    case 'other':
      return `Memsync, the mod that syncs my Claude memory through the git repo at ${repo}, reported this: ${error}. Find the cause and fix it. ${hands}`
    default:
      return null
  }
}

/**
 * The hunks of a `git diff` for a Code element, cut at a hunk boundary to fit
 * `max` characters (Code takes at most 10,000). null when there are no hunks,
 * or the first alone is too long.
 */
export function diffHunks(diff: string, max = 10_000): { hunks: string; isCut: boolean } | null {
  const lines = clean(diff).replace(/\n+$/, '').split('\n')
  const start = lines.findIndex(line => line.startsWith('@@'))
  if (start < 0) return null
  const hunks: string[][] = []
  for (const line of lines.slice(start)) {
    if (line.startsWith('diff --git')) break
    if (line.startsWith('@@')) hunks.push([line])
    else hunks[hunks.length - 1]!.push(line)
  }
  let out = ''
  for (const hunk of hunks) {
    const next = out === '' ? hunk.join('\n') : `${out}\n${hunk.join('\n')}`
    if (next.length > max) return out === '' ? null : { hunks: out, isCut: true }
    out = next
  }
  return { hunks: out, isCut: false }
}

export type Tone = 'bad' | 'warn' | 'dim' | ''

/** How `/memsync status` and `/memsync log` color one line of their output. */
export function lineTone(line: string, action: 'status' | 'log'): Tone {
  if (action === 'status') {
    if (line.startsWith('Problem:')) return 'bad'
    if (/^(Memsync is off|Unlinked:|Conflict copies:)/.test(line)) return 'warn'
    return ''
  }
  if (/fail|could not|not synced|secret/i.test(line)) return 'bad'
  if (/conflict|skipped|lock|aborted/i.test(line)) return 'warn'
  return 'dim'
}
