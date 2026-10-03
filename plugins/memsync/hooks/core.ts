// Pure helpers: no `$`, so the tests call them directly.

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
export type Action = 'open' | 'status' | 'sync' | 'link' | 'link-all' | 'on' | 'off' | 'close' | 'help'

export function parseAction(args: string): Action {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'open'
  if (words[0] === 'link') return words[1] === 'all' ? 'link-all' : 'link'
  const known: Action[] = ['status', 'sync', 'on', 'off', 'close']
  return known.includes(words[0] as Action) ? (words[0] as Action) : 'help'
}
