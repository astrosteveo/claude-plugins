import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptDecoration, PromptEditInput, Register, SessionMessage, Timer } from 'claude-code'

import type { Pick } from '../types'

/** How long the person must stop typing before predictions are asked for. */
export const PAUSE_MS = 1000
/** Drafts shorter than this get no prediction: too little to go on. */
const MIN_DRAFT = 4
/** How many predictions are asked for and offered. */
export const OPTIONS = 3
/** The longest prediction kept, cut back to a word boundary. */
const MAX_GHOST = 120
/** How many recent messages with text ride along as context. */
const HISTORY_MESSAGES = 6
/** Each of those messages is cut to its last this-many characters. */
const HISTORY_CHARS = 1200
/** How much of the typed text leads each row of the band. */
const LEAD_CHARS = 24
const MODEL = 'haiku'
const STORE_ENABLED = 'enabled'
/**
 * The engine action whose key takes the selected prediction from the prompt.
 * Claude Code mounts its handler only while the diff panel is open: the person
 * binds alt+→ to it in the Global context (see README) and the band's take
 * Button claims it.
 */
const ACCEPT_ACTION = 'app:cycleDiffBase'
/**
 * Engine actions whose chords cycle the predictions from the prompt. Claude
 * Code binds both to ctrl+↑/↓ and alt+↑/↓ for its diff panel's file list, and
 * mounts their own handler only while that panel is open; meanwhile a band
 * Button naming them takes the chord.
 */
const PREV_ACTION = 'app:diffFileListUp'
const NEXT_ACTION = 'app:diffFileListDown'
/** The band's address for its rows: `s:0`, `s:1`, ... */
const ROW = 's:'

/** Keys that take the whole prediction, once the caret sits before it. */
const ACCEPT_KEYS = new Set(['tab', 'right', 'end'])

const pick = atom({ plugin: 'type-ahead', key: 'pick' } as const, null as Pick | null)

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

/** The draft's trailing partial word, which each of the model's lines must start with. */
export function anchorOf(draft: string): string {
  return /\S*$/.exec(draft)?.[0] ?? ''
}

/**
 * The prediction one line of the model's reply makes: the line with the
 * anchor taken off, cut to MAX_GHOST at a word boundary; undefined when the
 * line does not start with the anchor or adds nothing.
 */
export function continuationOf(draft: string, reply: string): string | undefined {
  const anchor = anchorOf(draft)
  let line = reply.replace(/^\s+/, '').split('\n')[0] ?? ''
  // A line that restates the whole draft continues after it, from the anchor on.
  const typed = draft.trim()
  if (typed.length > anchor.length && line.startsWith(typed)) {
    line = anchor + line.slice(typed.length)
  }
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

/** Every distinct prediction in the reply, a line each, numbering or bullets ignored. */
export function optionsOf(draft: string, reply: string): string[] {
  const anchor = anchorOf(draft)
  const found: string[] = []
  for (const raw of reply.split('\n')) {
    const line = raw.trim()
    const bare = line.startsWith(anchor) ? line : line.replace(/^(?:\d+[.)]|[-*•])\s+/, '')
    const option = continuationOf(draft, bare)
    if (option !== undefined && !found.includes(option)) found.push(option)
    if (found.length === OPTIONS) break
  }
  return found
}

const SYSTEM = `You are the autocomplete in a developer's prompt box. They are typing a message to Claude Code, an AI coding assistant in their terminal. You see the recent conversation and their unfinished message.

Predict how THEIR message goes on, in their own voice: each prediction at most one sentence, stopping at a natural break. Never answer the message, never speak to the developer, never add quotes, labels, numbering or commentary.

Reply with exactly ${OPTIONS} lines: ${OPTIONS} different likely continuations, the most likely first. Each line begins with the given anchor text, character for character, and then continues the message.`

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
      ? 'The message ends in whitespace: begin each line directly with the next word.'
      : `Begin each line with exactly: ${anchor}`,
  ].join('\n\n')
}

/** Decides what one edit of the box does to the ghost in it. */
export function editGhost(ghost: Ghost, e: PromptEditInput): GhostEdit {
  if (e.text !== ghost.base + ghost.text) return { kind: 'stale' }
  const key = e.key
  // alt or ctrl with them takes it too; shift is the selection's.
  if (key !== undefined && ACCEPT_KEYS.has(key.key) && !key.shift) {
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

/** The predictions left once `typed` went in after the base: those that began with it, trimmed. */
export function narrow(p: Pick, typed: string): Pick {
  const chosen = p.options[p.selected] ?? ''
  const options = p.options.filter(o => o.startsWith(typed) && o.length > typed.length).map(o => o.slice(typed.length))
  const selected = Math.max(0, options.indexOf(chosen.slice(typed.length)))
  return { base: p.base + typed, options, selected }
}

/** The row `by` steps from the selected one, wrapping round the list. */
export function step(p: Pick, by: number): number {
  const n = p.options.length
  return n === 0 ? 0 : (((p.selected + by) % n) + n) % n
}

/** One row of the band: the marker, the end of what was typed, the prediction; cut to fit. */
export function rowLabel(p: Pick, i: number, columns: number): string {
  const lead = p.base.length > LEAD_CHARS ? '…' + p.base.slice(-LEAD_CHARS) : p.base
  const label = `${i === p.selected ? '▸' : ' '} ${lead}${p.options[i] ?? ''}`
  return label.length > columns ? label.slice(0, Math.max(1, columns - 1)) + '…' : label
}

/** Session state: plain module variables, so a hot reload starts them over. */
let isEnabled = true
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
    { model: MODEL, system: SYSTEM, prompt: buildPrompt(draft, messages), maxTokens: 300, effort: 'low', timeoutMs: 8000 },
    { signal: stop.signal },
  )
  if (ask !== asked || !reply.isAnswered) return
  inflight = undefined
  const options = optionsOf(draft, reply.text)
  const first = options[0]
  if (first === undefined) return

  const box = await $.prompt.read()
  if (ask !== asked || box.text !== draft || box.cursor !== draft.length) return
  const filled = await $.prompt.fill({ text: first, mode: 'append', decorations: dim(first) })
  // A key that landed between the read and the fill sits under the ghost: the box tells.
  if (filled.isFilled && filled.text.endsWith(first)) {
    await update($, pick, () => ({ base: filled.text.slice(0, -first.length), options, selected: 0 }))
  }
}

/** Restarts the pause timer; predictions are asked for once it runs out. */
function schedule($: EngineInterface, text: string, cursor: number) {
  cancel()
  const ask = ++asked
  if (!isEnabled || !isPredictable(text, cursor)) return
  timer = $.clock.after(PAUSE_MS, () => {
    timer = undefined
    void predict($, text, ask)
  })
}

/** Takes the predictions down, the box keeping only what was typed. */
async function dismiss($: EngineInterface) {
  const p = await read($, pick)
  if (p === null) return
  await update($, pick, () => null)
  const box = await $.prompt.read()
  if (box.text === p.base + (p.options[p.selected] ?? '')) {
    await $.prompt.fill({ text: p.base, mode: 'replace' })
  }
}

/** Previews prediction `i` dim after the typed text and marks it in the band. */
async function select($: EngineInterface, i: number) {
  const p = await read($, pick)
  const option = p?.options[i]
  if (p === null || option === undefined || i === p.selected) return
  await update($, pick, () => ({ ...p, selected: i }))
  await $.prompt.fill({ text: p.base + option, mode: 'replace', decorations: dim(option, p.base.length) })
}

/** Steps the selection `by` rows, wrapping, from the prompt's alt+↑/↓. */
async function cycle($: EngineInterface, by: number) {
  const p = await read($, pick)
  if (p === null || p.options.length < 2) return
  await select($, step(p, by))
}

/** Takes prediction `i` into the box as typed text. */
async function take($: EngineInterface, i: number) {
  const p = await read($, pick)
  const option = p?.options[i]
  if (p === null || option === undefined) return
  cancel()
  asked++
  await update($, pick, () => null)
  // Rewriting the same text keeps the preview's dim paint: the box keeps a
  // fill's decorations until its draft changes. Back to the typed text first,
  // then the prediction after it, unpainted.
  await $.prompt.fill({ text: p.base, mode: 'replace' })
  await $.prompt.fill({ text: option, mode: 'append', decorations: [] })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isEnabled = (await $.store.get(STORE_ENABLED)) !== false
    await update($, pick, () => null)
    await $.command.register({
      name: 'type-ahead',
      description: 'Turn type-ahead prompt predictions on or off',
    })
    return next(e)
  })

  on('command.run', { command: 'type-ahead' }, async $ => {
    isEnabled = !isEnabled
    await $.store.set(STORE_ENABLED, isEnabled)
    if (!isEnabled) {
      cancel()
      await dismiss($)
    }
    return {
      text: isEnabled
        ? `Type-ahead is on: pause ${PAUSE_MS / 1000}s while typing for predictions.`
        : 'Type-ahead is off.',
    }
  })

  on('prompt.edit', async ($, e, next) => {
    const p = await read($, pick)
    const option = p?.options[p.selected]
    if (p !== null && option !== undefined) {
      const step = editGhost({ base: p.base, text: option }, e)
      switch (step.kind) {
        case 'accept': {
          cancel()
          asked++
          await update($, pick, () => null)
          const text = p.base + option
          return { text, cursor: text.length }
        }
        case 'dismiss':
          cancel()
          asked++
          await update($, pick, () => null)
          return { text: p.base, cursor: p.base.length }
        case 'type-through': {
          const kept = narrow(p, e.inputText)
          await update($, pick, () => kept)
          return {
            text: step.ghost.base + step.ghost.text,
            cursor: step.ghost.base.length,
            decorations: dim(step.ghost.text, step.ghost.base.length),
          }
        }
        case 'edit': {
          await update($, pick, () => null)
          const box = await next(step.edit)
          schedule($, box.text, box.cursor)
          return box
        }
        case 'stale':
          await update($, pick, () => null)
          break
      }
    }
    const box = await next(e)
    schedule($, box.text, box.cursor)
    return box
  })

  // Enter sends what was typed: the preview never leaves with the prompt.
  on('prompt.submit', async ($, e, next) => {
    const p = await read($, pick)
    cancel()
    asked++
    if (p !== null) await update($, pick, () => null)
    const option = p?.options[p.selected]
    if (p !== null && option !== undefined && e.text === p.base + option) {
      return next({ ...e, text: p.base })
    }
    return next(e)
  })

  // The band lists the predictions, the selected one marked; alt+↑/↓ cycle them
  // from the prompt, and the ring starts on the selected one when the band takes
  // the keyboard (ctrl+x tab, or Tab once bound to abovePrompt:focus).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, pick)
    if (p === null || p.options.length === 0 || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const beneath = await next(e)
    return (
      <Box flexDirection="column">
        {p.options.map((_, i) =>
          i === p.selected ? (
            <Button key={`${ROW}${i}`} plain autoFocus label={rowLabel(p, i, columns)} onPress={() => void take($, i)} />
          ) : (
            <Button key={`${ROW}${i}`} plain dimColor label={rowLabel(p, i, columns)} onPress={() => void take($, i)} />
          ),
        )}
        <Box flexDirection="row">
          <Button key="take" plain dimColor action={ACCEPT_ACTION} label="alt+→ take" onPress={() => void take($, p.selected)} />
          <Text dimColor> · </Text>
          <Button key="prev" plain dimColor action={PREV_ACTION} label="alt+↑" onPress={() => void cycle($, -1)} />
          <Text dimColor>/</Text>
          <Button key="next" plain dimColor action={NEXT_ACTION} label="alt+↓" onPress={() => void cycle($, 1)} />
          <Text dimColor wrap="truncate-end">
            {' '}cycle · Backspace dismiss · Enter sends what you typed
          </Text>
        </Box>
        {beneath}
      </Box>
    )
  })

  // The ring moving onto a row (the band focused with Tab) previews that prediction in the box.
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny === undefined && e.plugin === 'type-ahead' && e.element?.startsWith(ROW)) {
      await select($, Number(e.element.slice(ROW.length)))
    }
    return moved
  })
}
