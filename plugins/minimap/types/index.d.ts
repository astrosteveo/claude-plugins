// What a turn mostly did, by the tools it called; `talk` when it called none.
export type Kind = 'talk' | 'read' | 'edit' | 'bash' | 'agent' | 'web' | 'other'

// The turn under way: the prompt that began it, how many calls of each kind so far, how many failed,
// and whether the conversation was compacted since the last turn ended.
export type Draft = {
  prompt?: string
  calls: Partial<Record<Kind, number>>
  errors: number
  isCompacted: boolean
}

// One finished main-loop turn as the strip draws it. `weight` is its tokens
// priced against each other, so turns compare by cost without a ledger.
export type Segment = {
  turnId: string
  // The start of the prompt that began the turn, and its calls by kind.
  // Absent on turns recorded before the pane existed.
  prompt?: string
  calls?: Partial<Record<Kind, number>>
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
      // The turn last picked in the pane's list, marked in its details.
      picked: string | null
    }
  }
}
