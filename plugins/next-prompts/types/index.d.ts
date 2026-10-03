// Up to 3 one-line prompts, in the order they are numbered
export type Suggestions = string[]

declare module 'claude-code' {
  interface PluginState {
    'next-prompts': {
      // The list on show above the prompt, or null when none shows
      list: Suggestions | null
    }
  }
}
