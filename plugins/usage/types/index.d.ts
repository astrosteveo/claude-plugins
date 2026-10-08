// How close a figure is to its limit: under 80%, from 80%, from 90%.
export type Level = 'ok' | 'warn' | 'high'

// One rate-limit window as the last response reported it.
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// The session's latest measurement: the context window, the rate-limit
// windows and the cost so far. `usd` is absent where the host keeps no ledger.
export type Measure = {
  context: { tokens?: number; window: number; percent?: number }
  limits: Limit[]
  usd?: number
}

// One main-loop turn: who answered, the four token counts, how long it ran,
// and what it cost. `usd` comes from the first measurement after the turn,
// so it is absent until then, and where the host keeps no ledger.
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

// The session's cost as a turn started, to tell what that turn added.
export type Start = { turnId: string; usd: number }

declare module 'claude-code' {
  interface PluginState {
    usage: {
      measure: Measure | null
      // The last turns, oldest first.
      turns: Turn[]
      // The figures that are past their toast threshold now, so each
      // crossing toasts once.
      warned: string[]
      start: Start | null
    }
  }
}
