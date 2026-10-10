import type { ContextCategory } from 'claude-code'

import type { Day, Limit, Measure, Spend, Turn } from '../types'

// Token counts read short: 950, 12.3k, 142k, 1.2M.
export function tokens(n: number): string {
  if (n < 1_000) return String(Math.round(n))
  if (n < 10_000) return `${trim(n / 1_000)}k`
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`

  return `${trim(n / 1_000_000)}M`
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

// Dollars: $1.23, and under a cent as <$0.01.
export function usd(n: number): string {
  if (n > 0 && n < 0.005) return '<$0.01'

  return `$${n.toFixed(2)}`
}

// Durations read short: 3.2s, 48s, 2m 5s, 1h 10m.
export function duration(ms: number): string {
  const s = ms / 1_000
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`

  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// A rate-limit window's short name: five_hour is 5h, seven_day 7d.
export function limitName(kind: string): string {
  const named: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

  return named[kind] ?? kind.replace(/_/g, ' ')
}

export function limit(l: Limit): string {
  return `${limitName(l.kind)} ${Math.round(l.percentUsed)}%`
}

// How close a figure is to its limit: under its warning, past it, or nearly full.
export type Level = 'ok' | 'warn' | 'high'
export type Part = { text: string; level: Level }
// The warning thresholds; 0 turns one off.
export type Lines = { warnTokens: number; warnPercent: number; limitPercent: number }

const FULL = 95

function past(n: number | undefined, line: number): boolean {
  return line > 0 && n !== undefined && n >= line
}

// The footer's figures, each with its level: ctx 142k/200k 71%, $1.23, 5h 31%.
export function statusParts(m: Measure, lines: Lines): Part[] {
  const parts: Part[] = []
  if (m.tokens !== undefined) {
    const pct = m.percent === undefined ? '' : ` ${Math.round(m.percent)}%`
    const level: Level = past(m.percent, FULL)
      ? 'high'
      : past(m.tokens, lines.warnTokens) || past(m.percent, lines.warnPercent)
        ? 'warn'
        : 'ok'
    parts.push({ text: `ctx ${tokens(m.tokens)}/${tokens(m.window)}${pct}`, level })
  }
  if (m.usd !== undefined) parts.push({ text: usd(m.usd), level: 'ok' })
  for (const l of m.limits) {
    const level: Level = l.percentUsed >= FULL ? 'high' : past(l.percentUsed, lines.limitPercent) ? 'warn' : 'ok'
    parts.push({ text: limit(l), level })
  }

  return parts
}

// The figures as one line: ctx 142k/200k 71% · $1.23 · 5h 31% · 7d 12%.
export function statusLine(m: Measure): string {
  return statusParts(m, { warnTokens: 0, warnPercent: 0, limitPercent: 0 })
    .map(p => p.text)
    .join(' · ')
}

// What share of a turn's input the prompt cache served, as a whole percent.
export function hitRate(input: number, cacheRead: number, cacheWrite: number): number {
  const all = input + cacheRead + cacheWrite

  return all === 0 ? 0 : Math.round((cacheRead / all) * 100)
}

// A model id without its family prefix: claude-opus-5-5 is opus-5-5.
export function model(id: string): string {
  return id.replace(/^claude-/, '')
}

function table(rows: string[][], right: boolean[]): string {
  const widths = (rows[0] ?? []).map((_, i) => Math.max(...rows.map(r => (r[i] ?? '').length)))

  return rows
    .map(r => r.map((cell, i) => (right[i] ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0))).join('  ').trimEnd())
    .join('\n')
}

// How long until a time: 42m, 4h 10m, 6d 7h.
export function until(at: string, now: number): string {
  const ms = Date.parse(at) - now
  if (!Number.isFinite(ms)) return at
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  if (m < 1_440) return `${Math.floor(m / 60)}h ${m % 60}m`

  return `${Math.floor(m / 1_440)}d ${Math.floor((m % 1_440) / 60)}h`
}

// The current figures, one per line.
export function summary(m: Measure | null, now: number): string {
  if (m === null) return 'No measurement yet: figures arrive after the first reply.'
  const lines: string[] = []
  if (m.tokens !== undefined) {
    const pct = m.percent === undefined ? '' : ` (${Math.round(m.percent)}%)`
    lines.push(`Context   ${tokens(m.tokens)} of ${tokens(m.window)}${pct}`)
  } else {
    lines.push(`Context   window ${tokens(m.window)}`)
  }
  if (m.usd !== undefined) lines.push(`Cost      ${usd(m.usd)}`)
  for (const l of m.limits) {
    lines.push(`${limitName(l.kind).padEnd(10)}${Math.round(l.percentUsed)}% used${l.resetsAt ? `, resets in ${until(l.resetsAt, now)}` : ''}`)
  }

  return lines.join('\n')
}

// The last turns, newest first, with a totals row.
export function turnTable(turns: Turn[], now: number): string {
  if (turns.length === 0) return 'No turns yet.'
  const head = ['model', 'in', 'cache rd', 'cache wr', 'out', 'hit', 'cost', 'time', 'ago']
  const rows = [...turns].reverse().map(t => [
    model(t.model),
    tokens(t.input),
    tokens(t.cacheRead),
    tokens(t.cacheWrite),
    tokens(t.output),
    `${hitRate(t.input, t.cacheRead, t.cacheWrite)}%`,
    t.usd === undefined ? '-' : usd(t.usd),
    t.isAborted ? 'stopped' : duration(t.ms),
    duration(Math.max(0, now - t.at)),
  ])
  const sum = (f: (t: Turn) => number) => turns.reduce((a, t) => a + f(t), 0)
  const input = sum(t => t.input)
  const cacheRead = sum(t => t.cacheRead)
  const cacheWrite = sum(t => t.cacheWrite)
  const priced = turns.filter(t => t.usd !== undefined)
  const total = [
    turns.length === 1 ? '1 turn' : `${turns.length} turns`,
    tokens(input),
    tokens(cacheRead),
    tokens(cacheWrite),
    tokens(sum(t => t.output)),
    `${hitRate(input, cacheRead, cacheWrite)}%`,
    priced.length === 0 ? '-' : usd(priced.reduce((a, t) => a + (t.usd ?? 0), 0)),
    duration(sum(t => t.ms)),
    '',
  ]

  return table([head, ...rows, total], [false, true, true, true, true, true, true, true, true])
}

// The context window by category, largest first, free space last.
export function breakdown(categories: readonly ContextCategory[], total: number, max: number): string {
  const used = categories.filter(c => c.kind === 'used' && c.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const rest = categories.filter(c => c.kind === 'free' || c.kind === 'buffer')
  const share = (n: number) => `${max === 0 ? 0 : Math.round((n / max) * 100)}%`
  const rows = [...used, ...rest].map(c => [c.name, tokens(c.tokens), share(c.tokens)])
  const deferred = categories.filter(c => c.kind === 'deferred' && c.tokens > 0)
  const out = [
    `context window, ${tokens(total)} of ${tokens(max)} (${share(total)})`,
    '',
    table(rows, [false, true, true]),
  ]
  if (deferred.length > 0) {
    out.push('', `Loaded on demand, outside the window: ${deferred.map(c => `${c.name} ${tokens(c.tokens)}`).join(', ')}`)
  }

  return out.join('\n')
}

// The history: one row per day and project, newest first, with totals.
export function history(days: [string, Day][]): string {
  const rows: string[][] = []
  const all: Spend = { usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }
  for (const [date, day] of days) {
    for (const [project, s] of Object.entries(day).sort((a, b) => b[1].usd - a[1].usd)) {
      rows.push([date, base(project), usd(s.usd), String(s.turns), tokens(s.input + s.cacheRead + s.cacheWrite), tokens(s.output)])
      for (const k of Object.keys(all) as (keyof Spend)[]) all[k] += s[k]
    }
  }
  if (rows.length === 0) return 'No history yet.'
  const total = ['total', '', usd(all.usd), String(all.turns), tokens(all.input + all.cacheRead + all.cacheWrite), tokens(all.output)]

  return table([['day', 'project', 'cost', 'turns', 'in', 'out'], ...rows, total], [false, false, true, true, true, true])
}

function base(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

// A local calendar day, YYYY-MM-DD.
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
