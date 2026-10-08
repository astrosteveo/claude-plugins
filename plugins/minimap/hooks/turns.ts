import type { Draft, Kind, Segment } from '../types'

// The most turns kept. Past this the oldest go, so the state stays small in a
// session that runs for days.
export const MAX_TURNS = 2000

const KIND_OF_TOOL: Record<string, Kind> = {
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  LS: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'bash',
  PowerShell: 'bash',
  Agent: 'agent',
  Task: 'agent',
  WebFetch: 'web',
  WebSearch: 'web',
}

// When two kinds have as many calls, the one that changes more wins: a turn
// that read five files and edited five is an edit.
const RANK: Kind[] = ['edit', 'bash', 'agent', 'web', 'read', 'other']

export const kindOf = (tool: string): Kind => KIND_OF_TOOL[tool] ?? 'other'

export const emptyDraft = (): Draft => ({ calls: {}, errors: 0, isCompacted: false })

export const withCall = (draft: Draft | null, tool: string, isError: boolean): Draft => {
  const held = draft ?? emptyDraft()
  const kind = kindOf(tool)
  return {
    ...held,
    calls: { ...held.calls, [kind]: (held.calls[kind] ?? 0) + 1 },
    errors: held.errors + (isError ? 1 : 0),
  }
}

// The most of a prompt kept, enough to tell turns apart in the pane.
export const PROMPT_CHARS = 300

// A new turn keeps a compaction that ran between turns, as /compact does.
export const startTurn = (draft: Draft | null, prompt: string): Draft => ({
  ...emptyDraft(),
  isCompacted: draft?.isCompacted ?? false,
  prompt: prompt.slice(0, PROMPT_CHARS),
})

export const withCompaction = (draft: Draft | null): Draft => ({ ...(draft ?? emptyDraft()), isCompacted: true })

export const mainKind = (calls: Draft['calls']): Kind => {
  let best: Kind = 'talk'
  let most = 0
  for (const kind of RANK) {
    const n = calls[kind] ?? 0
    if (n > most) {
      best = kind
      most = n
    }
  }
  return best
}

export type Tokens = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

// Tokens weighed by their list price relative to fresh input, the same on
// every model, so the heaviest turn is the costliest without knowing prices.
export const weightOf = (usage: Tokens | undefined): number =>
  usage === undefined
    ? 0
    : usage.input_tokens +
      1.25 * (usage.cache_creation_input_tokens ?? 0) +
      0.1 * (usage.cache_read_input_tokens ?? 0) +
      5 * usage.output_tokens

export type Ending = {
  turnId: string
  reason: 'answer' | 'aborted' | 'refusal' | 'error'
  usage?: Tokens
}

// Close the turn under way into a segment. A turn that ended on an API error
// or a refusal counts as one more error.
export const closeTurn = (draft: Draft | null, end: Ending): Segment => {
  const held = draft ?? emptyDraft()
  const isFailed = end.reason === 'error' || end.reason === 'refusal'
  return {
    turnId: end.turnId,
    ...(held.prompt === undefined ? {} : { prompt: held.prompt }),
    calls: held.calls,
    kind: mainKind(held.calls),
    errors: held.errors + (isFailed ? 1 : 0),
    weight: weightOf(end.usage),
    isCompacted: held.isCompacted,
    isAborted: end.reason === 'aborted',
  }
}

export const withTurn = (turns: Segment[], segment: Segment): Segment[] => [...turns, segment].slice(-MAX_TURNS)
