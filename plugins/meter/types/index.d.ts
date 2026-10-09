// What a tool call is doing, as the spinner names it.
export type Activity = { id: string; phase: string; target: string; startedAt: number }

// The main loop's turn as far as the spinner tells it.
export type Meter = {
  // The calls running now, oldest first. The spinner names the newest.
  running: Activity[]
  // The files this turn changed, each once.
  changed: string[]
  // When a file last changed, or null before the first change.
  lastChangeAt: number | null
  // How many calls in a row failed or were denied.
  failStreak: number
  // How many calls the turn made, and how many of them failed.
  calls: number
  failed: number
  // How long the turn's calls spent in each phase, in milliseconds.
  phaseMs: Record<string, number>
}

// What a finished turn did, for the line that closes it.
export type Summary = {
  // The turn's length, which is all the closing line carries to find it by.
  durationMs: number
  // When it finished, for the line's `done 7:56 PM`.
  doneAt: number
  files: number
  calls: number
  failed: number
  // The phase the turn's calls spent the longest in, or null with no calls.
  top: { phase: string; ms: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    meter: {
      // The running turn, or null between turns.
      meter: Meter | null
      // The time now, ticked each second while a turn runs.
      now: number
      // The session's finished turns, newest last.
      summaries: Summary[]
    }
  }
}
