// Who answers: the session's own model, or another by its alias.
export type Choice = 'session' | 'fable' | 'opus' | 'sonnet' | 'haiku'

// How hard the answering model thinks; default leaves it as the model has it.
export type Effort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// How an aside is asked. fork: the session's own last request with the
// question after it, read from its prompt cache, no tools. model: a request of
// the aside's own with the conversation as a transcript. fork-agent: a forked
// subagent with read-only tools. agent: a fresh subagent with read-only tools.
export type Route = 'fork' | 'model' | 'fork-agent' | 'agent'

// What the session's prompt cache lives for.
export type Ttl = '5m' | '1h'

// The four token counts an answer cost, as the API reports them.
export type Spent = { input: number; output: number; read: number; write: number }

// One question of the side thread and its answer.
export type Exchange = {
  id: string
  at: number
  question: string
  // The answering model's name (`Opus 5.5`), and how it was asked.
  model: string
  route: Route
  tools: boolean
  effort: Effort
  status: 'running' | 'done' | 'failed'
  answer?: string
  error?: string
  spent?: Spent
  usd?: number
  // What the cost estimate said before it was asked, against the session's
  // own model reading its cache, and whether it was asked anyway after a hold.
  estimate?: number
  stayEstimate?: number
  forced?: boolean
  agentId?: string
  // When the answer was handed to the session, and how.
  handedOff?: 'sent' | 'edited'
  ms?: number
}

// The defaults each new question is asked with.
export type Picks = { model: Choice; effort: Effort; tools: boolean }

// A question held while the person decides on a pricier model.
export type Pending = {
  question: string
  settings: Picks
  usd: number
  stayUsd: number
  // The model that would answer, and the session's own, by name.
  model: string
  session: string
  why: string
}

// What each choice is estimated to cost for the next question.
export type Quote = {
  at: number
  session: string
  contextTokens: number
  transcriptTokens: number
  isMainWarm: boolean
  ttl: Ttl
  costs: Partial<Record<Choice, number>>
}

// The conversation as one model's cache holds it: the transcript's first
// message, the message counts each earlier request's blocks ended at, a hash
// of the text up to the last of them, and when it was last read or written.
export type CacheTrack = { from: number; anchors: number[]; hash: number; at: number }

declare module 'claude-code' {
  interface PluginState {
    aside: {
      // The side thread, oldest first.
      thread: Exchange[]
      // The settings the person picked; null until they pick.
      defaults: Picks | null
      pending: Pending | null
      quote: Quote | null
      // Each model's cached transcript, by model id.
      caches: Record<string, CacheTrack>
      // The subagents asides started, whose reports stay out of the session.
      agents: string[]
      // When the main thread last sent a request, and whether a turn runs now.
      main: { at: number | null; isRunning: boolean }
    }
  }
}
