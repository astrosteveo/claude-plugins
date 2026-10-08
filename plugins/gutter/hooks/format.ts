import type { Timing } from '../types'

// The gutter's width in cells. Every badge is right-aligned in it, so the
// figures line up down the transcript like a column.
export const WIDTH = 8

// A call under this ran too fast to be worth a mark: most reads and searches.
export const QUIET_MS = 1000

// From here a call is slow enough to stand out.
export const SLOW_MS = 30_000

// Tools whose own row already says how long they ran (`(6s · 7 lines)`).
// Their rows get no badge, so no time is shown twice.
export const TIMED_BY_ENGINE: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'Agent', 'Task'])

export function duration(ms: number): string {
  if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
}

// A local clock time, 24-hour, as `14:05`.
export function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export type Badge = { text: string; tone: 'quiet' | 'slow' | 'failed' }

export function timingBadge(timing: Timing | null): Badge | null {
  if (timing === null || timing.ms < QUIET_MS) return null
  const tone = timing.isErrored ? 'failed' : timing.ms >= SLOW_MS ? 'slow' : 'quiet'
  return { text: duration(timing.ms), tone }
}

// A folded group's badge: its calls' run times summed, once every call has
// one. A call still running, or not timed, leaves the group without a mark
// rather than showing a total that is too small.
export function groupBadge(timings: readonly (Timing | null)[]): Badge | null {
  if (timings.length === 0 || timings.some(timing => timing === null)) return null
  const known = timings as Timing[]
  return timingBadge({ ms: known.reduce((sum, timing) => sum + timing.ms, 0), isErrored: known.some(timing => timing.isErrored) })
}

export const colorOf = (badge: Badge): 'subtle' | 'warning' | 'error' =>
  badge.tone === 'failed' ? 'error' : badge.tone === 'slow' ? 'warning' : 'subtle'

// A short, stable key for a prompt's text, so the row that draws it later
// finds when it was sent. FNV-1a, as hex.
export function keyOf(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
