// What a turn mostly did, by the tools it called; `talk` when it called none.
export type Kind = 'talk' | 'read' | 'edit' | 'bash' | 'agent' | 'web' | 'other'

// The turn under way: how many calls of each kind so far, how many failed,
// and whether the conversation was compacted since the last turn ended.
export type Draft = {
  calls: Partial<Record<Kind, number>>
  errors: number
  isCompacted: boolean
}

// One finished main-loop turn as the strip draws it. `weight` is its tokens
// priced against each other, so turns compare by cost without a ledger.
export type Segment = {
  turnId: string
  kind: Kind
  errors: number
  weight: number
  isCompacted: boolean
  isAborted: boolean
}

declare module 'claude-code' {
  interface PluginState {
    minimap: {
      // The session's turns, oldest first.
      turns: Segment[]
      // The turn under way, or null between turns.
      draft: Draft | null
    }
  }
}
