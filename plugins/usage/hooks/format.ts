import type { Level, Limit, Measure, Turn } from '../types'

// The pane keeps this many turns. Older ones drop off the front.
export const KEEP = 50

// Context toasts a little before the band turns red, so there is time to
// compact. A rate limit toasts once it is red.
export const CONTEXT_TOAST = 85
export const LIMIT_TOAST = 90

export const levelOf = (percent: number | undefined): Level =>
  percent === undefined ? 'ok' : percent >= 90 ? 'high' : percent >= 80 ? 'warn' : 'ok'

export const colorOf = (level: Level): 'warning' | 'error' | undefined =>
  level === 'high' ? 'error' : level === 'warn' ? 'warning' : undefined

export function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${trim(n / 1000)}k`
  return `${trim(n / 1_000_000)}M`
}

// One decimal under 100, none above, and never a trailing ".0".
const trim = (n: number): string => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''))

export const usd = (n: number): string => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`
}

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

export const limitName = (kind: string): string => LIMIT_NAMES[kind] ?? kind.replaceAll('_', ' ')

// How long until a window resets, from an ISO time: "2h 10m", "4d 3h", or
// null when the time is missing, unreadable or already past.
export function resetIn(resetsAt: string | undefined, now: number): string | null {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (Number.isNaN(at) || at <= now) return null
  const minutes = Math.ceil((at - now) / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}

// The share of the turn's input the prompt cache served, as a whole percent;
// null when the turn had no input at all.
export function hitRate(turn: Turn): number | null {
  const input = turn.input + turn.cacheRead + turn.cacheWrite
  return input === 0 ? null : Math.round((turn.cacheRead / input) * 100)
}

export const shortModel = (model: string): string => model.replace(/^claude-/, '')

export const withTurn = (turns: Turn[], turn: Turn): Turn[] => [...turns, turn].slice(-KEEP)

// One piece of the band, with how close it is to its limit.
export type Part = { key: string; text: string; level: Level }

export function bandParts(measure: Measure | null, last: Turn | undefined): Part[] {
  const parts: Part[] = []
  if (measure !== null) {
    const { percent } = measure.context
    if (percent !== undefined) parts.push({ key: 'context', text: `context ${percent}%`, level: levelOf(percent) })
    if (measure.usd !== undefined) parts.push({ key: 'cost', text: usd(measure.usd), level: 'ok' })
    for (const limit of measure.limits) {
      parts.push({ key: `limit-${limit.kind}`, text: `${limitName(limit.kind)} ${limit.percentUsed}%`, level: levelOf(limit.percentUsed) })
    }
  }
  if (last !== undefined) {
    const rate = hitRate(last)
    const cached = rate === null ? '' : `, ${rate}% cached`
    const input = last.input + last.cacheRead + last.cacheWrite
    parts.push({ key: 'last', text: `last turn ${tokens(input)} in, ${tokens(last.output)} out${cached}`, level: 'ok' })
  }
  return parts
}

export type Totals = { turns: number; input: number; cacheRead: number; cacheWrite: number; output: number; hit: number | null }

export function totals(turns: Turn[]): Totals {
  const sum = { turns: turns.length, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  for (const turn of turns) {
    sum.input += turn.input
    sum.cacheRead += turn.cacheRead
    sum.cacheWrite += turn.cacheWrite
    sum.output += turn.output
  }
  return { ...sum, hit: hitRate({ ...sum, at: 0, model: '', ms: 0, isAborted: false }) }
}

// The pane's columns. Each row is padded to these widths so the figures line up.
export const HEADER = ['model', 'in', 'read', 'write', 'out', 'hit', 'time'] as const
const WIDTHS: readonly number[] = [16, 7, 7, 7, 7, 5, 8]

export function columns(cells: readonly string[]): string {
  return cells
    .map((cell, i) => {
      const width = WIDTHS[i] ?? 0
      return i === 0 ? cell.slice(0, width).padEnd(width) : cell.padStart(width)
    })
    .join(' ')
}

export function rowCells(turn: Turn): string[] {
  const rate = hitRate(turn)
  return [
    shortModel(turn.model),
    tokens(turn.input),
    tokens(turn.cacheRead),
    tokens(turn.cacheWrite),
    tokens(turn.output),
    rate === null ? '-' : `${rate}%`,
    turn.isAborted ? 'stopped' : duration(turn.ms),
  ]
}

// The figures past their toast threshold in this measurement, by key, and
// the toasts for the ones that were not past it before. A figure that falls
// back under its threshold leaves the list, so its next crossing toasts again.
export function crossings(measure: Measure, warned: readonly string[]): { warned: string[]; toasts: string[] } {
  const now: string[] = []
  const toasts: string[] = []
  const { percent } = measure.context
  if (percent !== undefined && percent >= CONTEXT_TOAST) {
    now.push('context')
    if (!warned.includes('context')) toasts.push(`Context is ${percent}% full. Consider /compact.`)
  }
  for (const limit of measure.limits) {
    if (limit.percentUsed < LIMIT_TOAST) continue
    const key = `limit-${limit.kind}`
    now.push(key)
    if (!warned.includes(key)) toasts.push(`${limitName(limit.kind)} rate limit is ${limit.percentUsed}% used.`)
  }
  return { warned: now, toasts }
}

export const measureOf = (e: { context: Measure['context']; rateLimits: readonly Limit[]; cost?: { usd: number } }): Measure => ({
  context: { tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
  limits: e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
  usd: e.cost?.usd,
})
