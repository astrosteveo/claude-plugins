/** What one main-loop turn did, keyed to its TurnDuration line by duration. */
export type TurnRecap = {
  turnId: string
  durationMs: number
  tools: number
  failed: number
  edited: string[]
}

/** The turn in progress, filled by tool calls until turn.complete files it. */
export type LiveTurn = {
  turnId: string
  tools: number
  failed: number
  edited: string[]
}

/** A file the model edited this session. */
export type Touched = {
  path: string
  edits: number
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'turn-recap': {
      live: LiveTurn | null
      recaps: TurnRecap[]
      touched: Touched[]
    }
  }
}
