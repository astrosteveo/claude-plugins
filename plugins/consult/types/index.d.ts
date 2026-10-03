export type ConsultMode = 'advice' | 'prompt'

/** Which call answers: a fork of the main thread, or Sonnet with a condensed transcript. */
export type Route = 'fork' | 'sonnet'

export type Turn = {
  who: 'you' | 'claude'
  text: string
  /** How a reply was made and what it read, such as `fork · 106K cached`. */
  via?: string
}

export type Thread = {
  /** Counts threads so a late reply from an older thread is dropped. */
  run: number
  mode: ConsultMode
  status: 'thinking' | 'done' | 'error'
  turns: Turn[]
  /** Why the last call failed, when it did. */
  error: string
  /** The latest reply or prompt meant for the prompt box. */
  draft: string
  /** What the mod last put in the prompt box, so it never overwrites your edits. */
  filled: string
  /** Whether the latest draft is in the prompt box. */
  isFilled: boolean
}

/** When the main thread last touched its prompt cache, and how long the cache is taken to last. */
export type CacheMark = { at: number; ttlMs: number }

declare module 'claude-code' {
  interface PluginState {
    consult: { thread: Thread | null; cache: CacheMark | null }
  }
}
