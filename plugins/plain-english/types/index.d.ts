/** Figurative phrases found in a reply, each once, in the order they first appear. */
export type FlaggedPhrases = readonly string[]

declare module 'claude-code' {
  interface PluginState {
    'plain-english': {
      /** The main loop's reply text so far this turn, the text between tool calls included. */
      turnText: string
      /** Phrases the last reply used, named in the reminder on the next prompt. */
      flagged: FlaggedPhrases
      /** Whether this session already said the old output style is still on. */
      hasWarned: boolean
    }
  }
}
