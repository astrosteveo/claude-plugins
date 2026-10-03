import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { StatusBandGit, StatusBandWeek } from '../types'

const model = atom({ plugin: 'status-band', key: 'model' } as const, '')
const effort = atom({ plugin: 'status-band', key: 'effort' } as const, '')
const project = atom({ plugin: 'status-band', key: 'project' } as const, '')
const git = atom({ plugin: 'status-band', key: 'git' } as const, null)
const week = atom({ plugin: 'status-band', key: 'week' } as const, null)

type $ = EngineInterface

// Catches edits made outside Claude, such as a commit from another terminal
const GIT_POLL_MS = 15_000
const BAR_CELLS = 10
// Below these widths the band drops its widest parts first
const WIDE = 100
const NARROW = 70

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const TOOLS_THAT_TOUCH_FILES = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit'])

// Claude Code theme keys, so the band follows /theme, light and colorblind themes included
const COLOR = {
  model: 'claude',
  effort: 'warning',
  project: 'text',
  branch: 'merged',
  clean: 'success',
  staged: 'success',
  modified: 'warning',
  untracked: 'suggestion',
  conflict: 'error',
  track: 'subtle',
  dim: 'inactive',
}

// 'claude-opus-5-5[1m]' reads as 'Opus 5.5 1M'; an alias like 'opus' as 'Opus'
export function modelLabel(id: string) {
  const isLong = /\[1m\]/i.test(id)
  const bare = id.replace(/\[1m\]/i, '').replace(/-\d{8}$/, '').trim()
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i.exec(bare)
  const name = match
    ? `${capitalize(match[1]!)} ${match[2]}${match[3] ? '.' + match[3] : ''}`
    : capitalize(bare)
  return isLong ? `${name} 1M` : name
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export function parseGitStatus(porcelain: string): StatusBandGit {
  const status: StatusBandGit = {
    branch: '',
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicts: 0,
  }
  let oid = ''
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('# branch.head ')) status.branch = line.slice(14)
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13)
    else if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice(12).split(' ')
      status.ahead = Math.abs(Number(ahead))
      status.behind = Math.abs(Number(behind))
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      if (line[2] !== '.') status.staged += 1
      if (line[3] !== '.') status.modified += 1
    } else if (line.startsWith('u ')) status.conflicts += 1
    else if (line.startsWith('? ')) status.untracked += 1
  }
  if (status.branch === '(detached)') status.branch = oid.slice(0, 7) || 'detached'
  return status
}

// 7 days of window, so whole days and hours say enough
export function resetLabel(resetsAt: string | undefined, now: number) {
  if (resetsAt === undefined) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return ''
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function usageColor(percent: number) {
  if (percent >= 90) return COLOR.conflict
  if (percent >= 70) return COLOR.modified
  return COLOR.clean
}

// Eighth blocks give the bar sub-cell precision
export function bar(percent: number, cells: number) {
  const eighths = Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells * 8)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8
  const partial = part > 0 ? ' ▏▎▍▌▋▊▉'[part]! : ''
  return { fill: '█'.repeat(full) + partial, track: '█'.repeat(cells - full - (partial ? 1 : 0)) }
}

function weekOf(limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]) {
  const found = limits.find(limit => limit.kind === 'seven_day')
  if (found === undefined) return null
  const value: StatusBandWeek = { percent: found.percentUsed }
  if (found.resetsAt !== undefined) value.resetsAt = found.resetsAt
  return value
}

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

let isGitRunning = false
let isGitStale = false

// Never awaited by a hook, so tool results don't wait on git
async function refreshGit($: $) {
  if (isGitRunning) {
    isGitStale = true
    return
  }
  isGitRunning = true
  try {
    do {
      isGitStale = false
      // --no-optional-locks: a poll must not take index.lock from Claude's own git commands
      const run = await $.process
        .run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], {
          cwd: await $.session.cwd(),
          timeoutMs: 5000,
        })
        .catch(() => null)
      const value = run !== null && run.exitCode === 0 ? parseGitStatus(run.stdout) : null
      await update($, git, () => value)
    } while (isGitStale)
  } finally {
    isGitRunning = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    const [id, root, settings, usage] = await Promise.all([
      $.session.model(),
      $.session.root(),
      $.settings.read(),
      $.session.usage(),
    ])
    await update($, model, () => id)
    await update($, project, () => basename(root))
    const level = settings['effortLevel']
    if (typeof level === 'string' || typeof level === 'number') {
      await update($, effort, () => String(level))
    }
    await update($, week, () => weekOf(usage.rateLimits))

    void refreshGit($)
    $.clock.every(GIT_POLL_MS, () => void refreshGit($))

    return result
  })

  // The main loop's request names the model and effort actually sent
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await update($, model, () => e.model)
      await update($, effort, () => (e.effort === undefined ? '' : String(e.effort)))
    }
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, week, () => weekOf(e.rateLimits))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (TOOLS_THAT_TOUCH_FILES.has(e.tool)) void refreshGit($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const root = await $.session.root()
    await update($, project, () => basename(root))
    void refreshGit($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [id, level, name, repo, usage, now] = await Promise.all([
      read($, model),
      read($, effort),
      read($, project),
      read($, git),
      read($, week),
      $.clock.now(),
    ])
    if (id === '' && name === '') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const isWide = width >= WIDE
    const isNarrow = width < NARROW

    const sep = <Text color={COLOR.dim}>│</Text>

    const levelIndex = EFFORT_LEVELS.indexOf(level)
    const effortPart =
      level === '' ? null : levelIndex >= 0 ? (
        <Text>
          <Text color={COLOR.effort}>{'●'.repeat(levelIndex + 1)}</Text>
          <Text color={COLOR.track}>{'●'.repeat(EFFORT_LEVELS.length - levelIndex - 1)}</Text>
          {isNarrow ? '' : <Text color={COLOR.dim}> {level}</Text>}
        </Text>
      ) : (
        <Text color={COLOR.effort}>{level} tok</Text>
      )

    const gitPart =
      repo === null ? null : (
        <Text>
          <Text color={COLOR.branch}>⎇ {repo.branch}</Text>
          {repo.ahead > 0 ? <Text color={COLOR.project}> ↑{repo.ahead}</Text> : ''}
          {repo.behind > 0 ? <Text color={COLOR.project}> ↓{repo.behind}</Text> : ''}
          {repo.conflicts > 0 ? <Text color={COLOR.conflict}> ✖{repo.conflicts}</Text> : ''}
          {repo.staged > 0 ? <Text color={COLOR.staged}> +{repo.staged}</Text> : ''}
          {repo.modified > 0 ? <Text color={COLOR.modified}> ~{repo.modified}</Text> : ''}
          {repo.untracked > 0 ? <Text color={COLOR.untracked}> ?{repo.untracked}</Text> : ''}
          {repo.staged + repo.modified + repo.untracked + repo.conflicts === 0 ? (
            <Text color={COLOR.clean}> ✓</Text>
          ) : (
            ''
          )}
        </Text>
      )

    let weekPart = null
    if (usage !== null) {
      const color = usageColor(usage.percent)
      const cells = bar(usage.percent, BAR_CELLS)
      const reset = isWide ? resetLabel(usage.resetsAt, now) : ''
      weekPart = (
        <Text>
          <Text color={COLOR.dim}>7d </Text>
          {isNarrow ? (
            ''
          ) : (
            <Text>
              <Text color={color}>{cells.fill}</Text>
              <Text color={COLOR.track}>{cells.track}</Text>{' '}
            </Text>
          )}
          <Text color={color} bold>
            {Math.round(usage.percent)}%
          </Text>
          {reset === '' ? '' : <Text color={COLOR.dim}> ↻ {reset}</Text>}
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        <Text color={COLOR.track} wrap="truncate">
          {'─'.repeat(width)}
        </Text>
        <Box flexDirection="row" paddingRight={1} columnGap={1}>
          <Text color={COLOR.model} bold>
            ✻ {modelLabel(id)}
          </Text>
          {effortPart}
          {sep}
          <Text color={COLOR.project} bold wrap="truncate">
            {name}
          </Text>
          {gitPart === null ? null : sep}
          {gitPart}
          {weekPart === null ? null : sep}
          {weekPart}
        </Box>
      </Box>
    )
  })
}
