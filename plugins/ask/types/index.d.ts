export type AskStatus = 'pending' | 'answered' | 'failed'

// One side question and what came back. `answer` is the reply as markdown,
// each suggested prompt quoted in place; `prompts` holds those prompts whole.
export type Ask = {
  id: string
  question: string
  status: AskStatus
  answer?: string
  prompts: string[]
  error?: string
  askedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    ask: { asks: Ask[]; draft: string }
  }
}
