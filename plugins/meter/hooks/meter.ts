import type { Activity, Meter, Summary } from '../types'

// After this many failed calls in a row the spinner says the turn may be stuck.
export const STUCK_AFTER = 3

const TARGET_WIDTH = 32

const EDITS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const TESTS = /\b(test|tests|spec|pytest|jest|vitest|mocha|rspec|ctest|tsc|typecheck|lint|eslint|clippy|validate)\b|\bmake (check|test)\b/

// The closing lines of this many turns can be drawn with what they did.
export const MAX_SUMMARIES = 100

export const emptyMeter = (): Meter => ({ running: [], changed: [], lastChangeAt: null, failStreak: 0, calls: 0, failed: 0, phaseMs: {} })

type Doing = Omit<Activity, 'startedAt'>

const baseName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

const clip = (text: string): string => {
  const line = text.split('\n')[0]!.trim()
  return line.length > TARGET_WIDTH ? `${line.slice(0, TARGET_WIDTH - 1)}…` : line
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export const isEdit = (tool: string): boolean => EDITS.has(tool)

// The file a call changes, for the tools that change one.
export const changedFile = (tool: string, input: Record<string, unknown>): string | null =>
  isEdit(tool) ? text(input.file_path) || text(input.notebook_path) || null : null

// What one call is doing and on what, in the words the spinner shows.
export const activityOf = (id: string, tool: string, input: Record<string, unknown>): Doing => {
  const of = (phase: string, target = '') => ({ id, phase, target: clip(target) })
  switch (tool) {
    case 'Read':
      return of('Reading', baseName(text(input.file_path)))
    case 'Grep':
    case 'Glob':
      return of('Searching', text(input.pattern))
    case 'WebFetch':
      return of('Researching', text(input.url).replace(/^https?:\/\//, ''))
    case 'WebSearch':
      return of('Researching', text(input.query))
    case 'Agent':
    case 'Task':
      return of('Delegating', text(input.description))
    case 'TodoWrite':
      return of('Planning')
    // The Bash row above the spinner already shows the command, so the
    // phase stands alone.
    case 'Bash': {
      const command = text(input.command)
      if (TESTS.test(command)) return of('Testing')
      if (/(^|[;&|]\s*)git\b/.test(command)) return of('Using git')
      return of('Running')
    }
  }
  if (isEdit(tool)) return of('Editing', baseName(text(input.file_path) || text(input.notebook_path)))
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return mcp ? of('Calling', `${mcp[1]} ${mcp[2]}`) : of('Calling', tool)
}

export const started = (meter: Meter | null, doing: Doing, at: number): Meter => {
  const held = meter ?? emptyMeter()
  return { ...held, running: [...held.running.filter(a => a.id !== doing.id), { ...doing, startedAt: at }] }
}

export const finished = (meter: Meter | null, id: string, outcome: { isFailed: boolean; file: string | null; at: number }): Meter => {
  const held = meter ?? emptyMeter()
  const isChanged = !outcome.isFailed && outcome.file !== null
  const call = held.running.find(a => a.id === id)
  const phaseMs = call ? { ...held.phaseMs, [call.phase]: (held.phaseMs[call.phase] ?? 0) + Math.max(0, outcome.at - call.startedAt) } : held.phaseMs
  return {
    running: held.running.filter(a => a.id !== id),
    calls: held.calls + 1,
    failed: held.failed + (outcome.isFailed ? 1 : 0),
    phaseMs,
    changed: isChanged && !held.changed.includes(outcome.file!) ? [...held.changed, outcome.file!] : held.changed,
    lastChangeAt: isChanged ? outcome.at : held.lastChangeAt,
    failStreak: outcome.isFailed ? held.failStreak + 1 : 0,
  }
}

export const ago = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

// How long, to the second: `42s`, `1m 40s`, `2h 5m`.
export const span = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`
}

export const summarize = (meter: Meter | null, durationMs: number, doneAt: number): Summary => {
  const held = meter ?? emptyMeter()
  const [phase, ms] = Object.entries(held.phaseMs).sort((a, b) => b[1] - a[1])[0] ?? []
  return {
    durationMs,
    doneAt,
    files: held.changed.length,
    calls: held.calls,
    failed: held.failed,
    top: phase === undefined || ms === undefined ? null : { phase, ms },
  }
}

export const withSummary = (list: readonly Summary[] | null, summary: Summary): Summary[] => [...(list ?? []), summary].slice(-MAX_SUMMARIES)

// The closing line names only its turn's length, so the newest turn of that
// length is the one it closes.
export const summaryOf = (list: readonly Summary[] | null, durationMs: number): Summary | undefined =>
  [...(list ?? [])].reverse().find(s => s.durationMs === durationMs)

// The engine's own words for a closing line, which this mod draws again
// because its row is as wide as the screen and nothing fits beside it.
export const closingHead = (word: string, durationMs: number, doneAt: number): string => {
  const done = new Date(doneAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `✻ ${word} for ${span(durationMs)} · done ${done}`
}

// The words added to a closing line. A turn that called no tool adds none.
export const closingParts = (summary: Summary): string[] => {
  if (summary.calls === 0) return []
  const files = summary.files === 0 ? [] : [`${summary.files} file${summary.files === 1 ? '' : 's'} changed`]
  const tools = `${summary.calls} tool${summary.calls === 1 ? '' : 's'}${summary.failed === 0 ? '' : `, ${summary.failed} failed`}`
  // A phase under a second says nothing about where the time went.
  const top = summary.top !== null && summary.top.ms >= 1000 ? [`mostly ${summary.top.phase} (${span(summary.top.ms)})`] : []
  return [...files, tools, ...top]
}

type Mode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

const BETWEEN_CALLS: Record<Mode, string> = {
  requesting: 'Waiting on the model',
  responding: 'Writing',
  thinking: 'Thinking',
  'tool-input': 'Choosing a tool',
  'tool-use': 'Working',
}

// The spinner's words, or null to leave the engine's. Elapsed time and
// tokens follow them, drawn by the engine, so they are not repeated here.
export const label = (meter: Meter | null, mode: Mode, now: number): string | null => {
  if (meter === null) return null
  const current = meter.running[meter.running.length - 1]
  const isStuck = meter.failStreak >= STUCK_AFTER
  const head = isStuck
    ? `Stuck? ${meter.failStreak} failures in a row`
    : current
      ? [current.phase, current.target].filter(Boolean).join(' ')
      : BETWEEN_CALLS[mode]
  const more = current && meter.running.length > 1 ? ` +${meter.running.length - 1}` : ''
  const files = meter.changed.length
  const tail =
    files === 0 || meter.lastChangeAt === null
      ? ''
      : ` · ${files} file${files === 1 ? '' : 's'} changed, last ${ago(now - meter.lastChangeAt)} ago`
  // The ellipsis that says the turn is still going sits after the head, not
  // after the tail, so the register draws the engine's suffix as "".
  const body = `${head}${more}`
  return `${body}${body.endsWith('…') ? '' : '…'}${tail}`
}
