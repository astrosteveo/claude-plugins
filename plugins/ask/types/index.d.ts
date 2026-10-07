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

// One question as AskUserQuestion takes it.
export type Choice = { label: string; description: string; preview?: string }
export type Question = { question: string; header: string; options: Choice[]; multiSelect: boolean }

// Claude's take on one question: the option it would pick, how sure it is,
// why, and each option said in plain words.
export type Take = {
  pick: string
  confidence: number
  why: string
  plain: string
  notes: Record<string, string>
}

// The take for one open dialog, keyed by its tool_use_id. `takes` lines up
// with the dialog's questions; a question the reply skipped is null.
export type Advice =
  | { status: 'thinking' }
  | { status: 'ready'; takes: (Take | null)[] }
  | { status: 'failed'; error: string }

// An answer to give again, without asking, in the project it was saved in.
export type Remembered = { key: string; root: string; question: string; answer: string; at: number }

// One answered question, for the decision log. `away` is Claude's own pick,
// taken when the dialog timed out with nobody at the keyboard.
export type Decision = {
  root: string
  header: string
  question: string
  answer: string
  pick?: string
  confidence?: number
  source: 'you' | 'remembered' | 'away'
  at: number
}

// The answers the band offers to remember, from the last dialog.
export type Offer = { root: string; items: { key: string; question: string; answer: string }[] }

// What the band says after the dialog timed out and Claude went with its pick.
export type Away = { items: { question: string; pick: string }[] }

declare module 'claude-code' {
  interface PluginState {
    ask: {
      asks: Ask[]
      draft: string
      // Claude's take on each open AskUserQuestion dialog.
      advice: StateFamily<Advice | null>
      offer: Offer | null
      // The picks Claude took while the person was away, until they press Got it.
      away: Away | null
      log: Decision[]
      remembered: Remembered[]
      // What the /decisions pane's search box holds.
      search: string
    }
  }
}
