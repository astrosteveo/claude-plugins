// One rate-limit window as the last measurement reported it.
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// The session's latest measurement. `tokens` and `percent` are absent before
// the first response; `usd` where the host keeps no cost ledger.
export type Measure = {
  tokens?: number
  window: number
  percent?: number
  limits: Limit[]
  usd?: number
}

// One main-loop turn: who answered, its four token counts, how long it ran
// and what it cost. `usd` arrives with the first measurement after the turn.
export type Turn = {
  turnId: string
  at: number
  model: string
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  ms: number
  isAborted: boolean
  usd?: number
}

// One project's figures for one day of history.
export type Spend = {
  usd: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
}

// A day of history, keyed by project root.
export type Day = Record<string, Spend>

declare module 'claude-code' {
  interface PluginState {
    gauge: {
      measure: Measure | null
      // The last turns, oldest first.
      turns: Turn[]
      // The thresholds past which a figure is now, so each crossing acts once.
      warned: string[]
      // The session's cost as the running turn started.
      start: { turnId: string; usd: number } | null
      // The session cost already added to the history.
      banked: number
    }
  }
}
