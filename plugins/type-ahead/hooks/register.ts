import type { EngineInterface, PromptDecoration, PromptEditInput, Register, SessionMessage, Timer } from 'claude-code'

/** How long the person must stop typing before a prediction is asked for. */
export const PAUSE_MS = 1000
/** Drafts shorter than this get no prediction: too little to go on. */
const MIN_DRAFT = 4
/** The longest ghost shown, cut back to a word boundary. */
const MAX_GHOST = 120
/** How many recent messages with text ride along as context. */
const HISTORY_MESSAGES = 6
/** Each of those messages is cut to its last this-many characters. */
const HISTORY_CHARS = 1200
const MODEL = 'haiku'
const STORE_ENABLED = 'enabled'
/** How long after a held send the accepted text goes back in the box. */
const REFILL_MS = 50
/** The line shown when Enter takes a ghost instead of sending. */
export const ACCEPTED = 'Took the prediction: Enter again to send it.'

/** Keys that take the whole ghost, once the caret sits before it. */
const ACCEPT_KEYS = new Set(['tab', 'right', 'end'])

/** A prediction sitting in the box: `base` is what was typed, `text` the dim tail after it. */
export type Ghost = { base: string; text: string }

/** What one edit does to a ghost in the box. */
export type GhostEdit =
  /** The box no longer holds the ghost as placed: forget it, pass the edit on. */
  | { kind: 'stale' }
  /** Take the ghost as typed text. */
  | { kind: 'accept' }
  /** Drop the ghost and swallow the key. */
  | { kind: 'dismiss' }
  /** The key typed the ghost's next characters: keep the rest of it showing. */
  | { kind: 'type-through'; ghost: Ghost }
  /** Drop the ghost and apply the edit to the typed text. */
  | { kind: 'edit'; edit: PromptEditInput }

export function dim(text: string, at = 0): PromptDecoration[] {
  return [{ start: at, end: at + text.length, dimColor: true }]
}

/** Commands, shell escapes and memory notes are not prose worth predicting. */
export function isPredictable(draft: string, cursor: number): boolean {
  return (
    cursor === draft.length &&
    draft.trim().length >= MIN_DRAFT &&
    !/^\s*[/!#]/.test(draft)
  )
}

/** The draft's trailing partial word, which the model's reply must start with. */
export function anchorOf(draft: string): string {
  return /\S*$/.exec(draft)?.[0] ?? ''
}

/**
 * The ghost to show from the model's reply: the reply's first line with the
 * anchor taken off, cut to MAX_GHOST at a word boundary; undefined when the
 * reply does not start with the anchor or adds nothing.
 */
export function continuationOf(draft: string, reply: string): string | undefined {
  const anchor = anchorOf(draft)
  const line = reply.replace(/^\s+/, '').split('\n')[0] ?? ''
  if (!line.startsWith(anchor)) return undefined
  let rest = line.slice(anchor.length)
  if (anchor === '') rest = rest.trimStart()
  rest = rest.trimEnd()
  if (rest.length > MAX_GHOST) {
    const cut = rest.lastIndexOf(' ', MAX_GHOST)
    rest = rest.slice(0, cut > 0 ? cut : MAX_GHOST)
  }
  return rest.trim() === '' ? undefined : rest
}

const SYSTEM = `You are the autocomplete in a developer's prompt box. They are typing a message to Claude Code, an AI coding assistant in their terminal. You see the recent conversation and their unfinished message.

Predict the few words most likely to come next in THEIR message, in their own voice: at most one sentence, stopping at a natural break. Never answer the message, never speak to the developer, never add quotes, labels or commentary.

Reply with exactly one line that begins with the given anchor text, character for character, and then continues the message. If nothing useful comes to mind, reply with the anchor alone.`

export function buildPrompt(draft: string, messages: readonly SessionMessage[]): string {
  const recent = messages
    .filter(m => m.text.trim() !== '')
    .slice(-HISTORY_MESSAGES)
    .map(m => {
      const text = m.text.length > HISTORY_CHARS ? '…' + m.text.slice(-HISTORY_CHARS) : m.text
      return `${m.role === 'user' ? 'Developer' : 'Claude'}: ${text}`
    })
  const anchor = anchorOf(draft)
  return [
    `<conversation>\n${recent.length > 0 ? recent.join('\n\n') : '(none yet)'}\n</conversation>`,
    `<unfinished_message>\n${draft}\n</unfinished_message>`,
    anchor === ''
      ? 'The message ends in whitespace: begin your reply directly with the next word.'
      : `Begin your reply with exactly: ${anchor}`,
  ].join('\n\n')
}

/** Decides what one edit of the box does to the ghost in it. */
export function editGhost(ghost: Ghost, e: PromptEditInput): GhostEdit {
  if (e.text !== ghost.base + ghost.text) return { kind: 'stale' }
  const key = e.key
  if (key !== undefined && ACCEPT_KEYS.has(key.key) && !key.ctrl && !key.meta && !key.shift) {
    return { kind: 'accept' }
  }
  // A cursor move or a deletion takes the ghost down and nothing more.
  if (e.inputText === '') return { kind: 'dismiss' }
  if (ghost.text.startsWith(e.inputText)) {
    if (e.inputText.length === ghost.text.length) return { kind: 'accept' }
    return {
      kind: 'type-through',
      ghost: { base: ghost.base + e.inputText, text: ghost.text.slice(e.inputText.length) },
    }
  }
  // What was typed lands where the person's caret really is: the end of the base.
  const at = ghost.base.length
  return { kind: 'edit', edit: { ...e, text: ghost.base, cursor: at, start: at, end: at } }
}

/** Session state: plain module variables, so a hot reload starts them over. */
let isEnabled = true
let ghost: Ghost | undefined
let timer: Timer | undefined
let inflight: AbortController | undefined
let asked = 0

function cancel() {
  timer?.cancel()
  timer = undefined
  inflight?.abort()
  inflight = undefined
}

async function predict($: EngineInterface, draft: string, ask: number) {
  const messages = await $.session.messages()
  if (ask !== asked) return
  const stop = new AbortController()
  inflight = stop
  const reply = await $.model.complete(
    { model: MODEL, system: SYSTEM, prompt: buildPrompt(draft, messages), maxTokens: 80, effort: 'low', timeoutMs: 8000 },
    { signal: stop.signal },
  )
  if (ask !== asked || !reply.isAnswered) return
  inflight = undefined
  const text = continuationOf(draft, reply.text)
  if (text === undefined) return

  const box = await $.prompt.read()
  if (ask !== asked || box.text !== draft || box.cursor !== draft.length) return
  const filled = await $.prompt.fill({ text, mode: 'append', decorations: dim(text) })
  // A key that landed between the read and the fill sits under the ghost: the box tells.
  if (filled.isFilled && filled.text.endsWith(text)) {
    ghost = { base: filled.text.slice(0, -text.length), text }
  }
}

/** Puts accepted text back in the box once the held send has emptied it. */
function refill($: EngineInterface, text: string) {
  $.clock.after(REFILL_MS, () => {
    void $.prompt.fill({ text, mode: 'replace' })
  })
}

/** Restarts the pause timer; a prediction is asked for once it runs out. */
function schedule($: EngineInterface, text: string, cursor: number) {
  cancel()
  const ask = ++asked
  if (!isEnabled || !isPredictable(text, cursor)) return
  timer = $.clock.after(PAUSE_MS, () => {
    timer = undefined
    void predict($, text, ask)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isEnabled = (await $.store.get(STORE_ENABLED)) !== false
    await $.command.register({
      name: 'type-ahead',
      description: 'Turn type-ahead prompt predictions on or off',
    })
    return next(e)
  })

  on('command.run', { command: 'type-ahead' }, async $ => {
    isEnabled = !isEnabled
    await $.store.set(STORE_ENABLED, isEnabled)
    if (!isEnabled) cancel()
    return {
      text: isEnabled
        ? `Type-ahead is on: pause ${PAUSE_MS / 1000}s while typing for a prediction, Enter to take it.`
        : 'Type-ahead is off.',
    }
  })

  on('prompt.edit', async ($, e, next) => {
    if (ghost !== undefined) {
      const held = ghost
      const step = editGhost(held, e)
      ghost = undefined
      switch (step.kind) {
        case 'accept': {
          cancel()
          asked++
          const text = held.base + held.text
          return { text, cursor: text.length }
        }
        case 'dismiss':
          cancel()
          asked++
          return { text: held.base, cursor: held.base.length }
        case 'type-through':
          ghost = step.ghost
          return {
            text: step.ghost.base + step.ghost.text,
            cursor: step.ghost.base.length,
            decorations: dim(step.ghost.text, step.ghost.base.length),
          }
        case 'edit': {
          const box = await next(step.edit)
          schedule($, box.text, box.cursor)
          return box
        }
        case 'stale':
          break
      }
    }
    const box = await next(e)
    schedule($, box.text, box.cursor)
    return box
  })

  // Enter on a ghost takes it: the send is held and the box gets the whole
  // text back, so a second Enter sends it. Tab and → only reach the hook once
  // the caret sits before the ghost (after typing into it).
  on('prompt.submit', ($, e, next) => {
    const held = ghost
    ghost = undefined
    cancel()
    asked++
    if (held !== undefined && e.origin.kind === 'composer' && e.text === held.base + held.text) {
      refill($, e.text)
      return { drop: ACCEPTED }
    }
    return next(e)
  })
}
