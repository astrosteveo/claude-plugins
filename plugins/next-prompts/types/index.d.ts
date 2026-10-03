// Up to 3 one-line prompts, in the order they are numbered
export type Suggestions = string[]

/** What the last check after a reply did, for the debug line. */
export type Check = {
  /** Such as `shown`, `no reply: api-error` or `too few lines: 1 of 3`. */
  outcome: string
  /** How long the fork took in milliseconds, or null when the check made none. */
  ms: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'next-prompts': {
      // The list on show above the prompt, or null when none shows
      list: Suggestions | null
      // What the last check did, shown under the list with the debug option
      check: Check | null
    }
  }
}
