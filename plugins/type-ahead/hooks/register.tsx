import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptDecoration, PromptEditInput, Register, SessionMessage, Timer, ToolUseSummary } from 'claude-code'

import type { Pick } from '../types'

/** How long the person must stop typing before predictions are asked for. */
export const PAUSE_MS = 1000
/** Drafts shorter than this get no prediction: too little to go on. */
const MIN_DRAFT = 4
/** How many predictions are asked for, and the most offered. */
export const OPTIONS = 3
/** How many next prompts Haiku adds to Claude Code's own suggestion in an empty box. */
const ALTERNATIVES = OPTIONS - 1
/** The longest prediction kept, cut back to a word boundary. */
const MAX_GHOST = 120
/** How many words of the draft's end each line of the reply repeats. */
const ANCHOR_WORDS = 3
/** How many recent turns ride along as context. */
const HISTORY_TURNS = 6
/** Each of those turns is cut to its last this-many characters. */
const HISTORY_CHARS = 1200
/** How many of a Claude turn's tool calls are named, the latest kept. */
const HISTORY_TOOLS = 8
/** Claude Code's own markup in a user message's text: reminders, command echoes, not the developer's words. */
const MARKUP = /<(system-reminder|local-command-[\w-]+|command-[\w-]+|bash-[\w-]+|task-notification)>[\s\S]*?<\/\1>/g
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

/**
 * Commands, shell escapes and memory notes are not prose worth predicting, and
 * a draft that ends a sentence leaves only a guess at the next one.
 */
export function isPredictable(draft: string, cursor: number): boolean {
  return (
    cursor === draft.length &&
    draft.trim().length >= MIN_DRAFT &&
    !/^\s*[/!#]/.test(draft) &&
    !/[.?!]\s*$/.test(draft)
  )
}

/**
 * The end of the draft's last line, which each of the model's lines repeats
 * before continuing: up to ANCHOR_WORDS words, a partial last word included,
 * trailing whitespace left off. A line that does not start with it is no
 * continuation of the draft (a reply to it, a preamble, a list) and is dropped.
 */
export function anchorOf(draft: string): string {
  const line = draft.trimEnd().split('\n').pop() ?? ''
  return new RegExp(`(?:\\S+\\s+){0,${ANCHOR_WORDS - 1}}\\S+$`).exec(line)?.[0] ?? ''
}

/** Whether the draft ends in whitespace, so what comes next is a new word. */
function endsInSpace(draft: string): boolean {
  return /\s$/.test(draft)
}

/**
 * The prediction one line of the model's reply makes: the line with the
 * anchor taken off, cut to MAX_GHOST at a word boundary; undefined when the
 * line does not start with the anchor, splits a word the draft finished, or
 * adds no word.
 */
export function continuationOf(draft: string, reply: string): string | undefined {
  const anchor = anchorOf(draft)
  let line = reply.replace(/^\s+/, '').split('\n')[0] ?? ''
  // A line that restates the whole draft continues after it, from the anchor on.
  const typed = draft.trim()
  if (typed.length > anchor.length && line.startsWith(typed)) {
    line = anchor + line.slice(typed.length)
  }
  if (anchor === '' || !line.startsWith(anchor)) return undefined
  let rest = line.slice(anchor.length)
  if (endsInSpace(draft)) {
    // After a space the next word stands alone: `the` + `me colors` is no continuation.
    if (!/^\s/.test(rest)) return undefined
    rest = rest.trimStart()
  }
  rest = rest.trimEnd()
  if (rest.length > MAX_GHOST) {
    const cut = rest.lastIndexOf(' ', MAX_GHOST)
    rest = rest.slice(0, cut > 0 ? cut : MAX_GHOST)
  }
  return /[\p{L}\p{N}]/u.test(rest) ? rest : undefined
}

/** Every distinct prediction in the reply, a line each, numbering, bullets or quotes ignored. */
export function optionsOf(draft: string, reply: string): string[] {
  const anchor = anchorOf(draft)
  const found: string[] = []
  for (const raw of reply.split('\n')) {
    const line = raw.trim()
    const bare = line.startsWith(anchor)
      ? line
      : line.replace(/^(?:\d+[.)]|[-*•>])\s+/, '').replace(/^["'`“](.*?)["'`”]?$/, '$1')
    const option = continuationOf(draft, bare)
    if (option !== undefined && !found.includes(option)) found.push(option)
    if (found.length === OPTIONS) break
  }
  return found
}

const SYSTEM = `You complete a developer's half-typed message, like the word predictions above a phone keyboard. The developer is typing their next message to Claude Code, an AI coding assistant, most often in reply to Claude's last message. You are not Claude Code and the message is not addressed to you: never answer it, ask about it or comment on it.

Predict the words the developer is about to type, in their own voice and style:
- Ground each prediction in the conversation: the task at hand, what Claude just said or asked, the files, commands and names already mentioned. Do not invent files, names or requirements that nothing points to.
- Go only as far as you can predict well: usually the rest of the current clause or sentence, a few words up to about fifteen.
- Make each line a different likely direction, the likeliest first. When you cannot tell where the message is going, write fewer lines.

Write only the lines: no preamble, quotes, numbering, labels or commentary. Each line repeats the anchor character for character, then continues it.

Example. Claude's last message: "I can add the index in a new migration or edit 0042_users.sql. Which do you prefer?" Draft: "add it in a new mi". Anchor: a new mi
a new migration
a new migration and leave 0042 alone
a new migration, then run it locally`

/** One tool call as a few words: the tool and what it touched. */
function toolNote(use: ToolUseSummary): string {
  const { file_path, path, command, pattern, url } = use.input
  const target = [file_path, path, command, pattern, url].find(v => typeof v === 'string')
  const note = typeof target === 'string' ? `${use.tool} ${target.split('\n')[0]}` : use.tool
  return note.length > 80 ? note.slice(0, 79) + '…' : note
}

/** One turn of the context: the developer's words, or a Claude turn's text and the tools it ran. */
type Turn = { role: 'user' | 'assistant'; text: string; tools: string[] }

/**
 * The conversation as turns: Claude Code's markup taken out of the
 * developer's messages, and each run of Claude's messages (tool results
 * between them) one turn naming the tools it called.
 */
function turnsOf(messages: readonly SessionMessage[]): Turn[] {
  const turns: Turn[] = []
  for (const m of messages) {
    const text = (m.role === 'user' ? m.text.replace(MARKUP, '') : m.text).trim()
    const last = turns.at(-1)
    if (m.role === 'user') {
      if (text !== '') turns.push({ role: 'user', text, tools: [] })
      continue
    }
    const tools = m.toolUses.map(toolNote)
    if (last?.role === 'assistant') {
      last.text = [last.text, text].filter(t => t !== '').join('\n\n')
      last.tools.push(...tools)
    } else if (text !== '' || tools.length > 0) {
      turns.push({ role: 'assistant', text, tools })
    }
  }
  return turns
}

function describeTurn(t: Turn): string {
  const text = t.text.length > HISTORY_CHARS ? '…' + t.text.slice(-HISTORY_CHARS) : t.text
  if (t.role === 'user') return `Developer: ${text}`
  const tools = [...new Set(t.tools)].slice(-HISTORY_TOOLS)
  return [`Claude:`, tools.length > 0 ? `[ran ${tools.join(' · ')}]` : '', text].filter(s => s !== '').join(' ')
}

function conversationOf(messages: readonly SessionMessage[]): string {
  const recent = turnsOf(messages).slice(-HISTORY_TURNS).map(describeTurn)
  return `<conversation>\n${recent.length > 0 ? recent.join('\n\n') : '(none yet)'}\n</conversation>`
}

export function buildPrompt(draft: string, messages: readonly SessionMessage[]): string {
  const anchor = anchorOf(draft)
  return [
    conversationOf(messages),
    `<draft>\n${draft}\n</draft>`,
    `The developer is still typing the draft and has not sent it: do not reply to it. Write up to ${OPTIONS} ways it goes on, a line each.`,
    endsInSpace(draft)
      ? `Anchor: ${anchor}\nThe draft ends with a space after the anchor, so each line goes on from the anchor with a space and a new word.`
      : `Anchor: ${anchor}\nIts last word may be unfinished. Every line still starts with the whole anchor and finishes the word from there: "${anchor}…", never the rest of the word alone.`,
  ].join('\n\n')
}

const NEXT_SYSTEM = `You guess what a developer will type next to Claude Code, an AI coding assistant, now that its turn has ended. You are not Claude Code: never answer, explain or comment.

Claude Code has already guessed one next message. Write up to ${ALTERNATIVES} other likely next messages, each a different direction from that guess and from each other:
- Ground each in the conversation: the task at hand, what Claude just did, said or asked, the files and names mentioned. Do not invent work that nothing points to.
- Write in the developer's own voice and style, short: a few words up to one sentence.
- When nothing else is likely, write fewer lines, or none.

Write each on its own line starting with "- ", and nothing else.`

export function buildNextPrompt(guess: string, messages: readonly SessionMessage[]): string {
  return [
    conversationOf(messages),
    `Claude Code's guess at the developer's next message: ${guess}`,
    `Write up to ${ALTERNATIVES} other likely next messages, each on its own line starting with "- ".`,
  ].join('\n\n')
}

/**
 * The next prompts the reply adds to Claude Code's guess: its `- ` lines,
 * quotes taken off; none that repeats the guess or another, runs past
 * MAX_GHOST or introduces a list.
 */
export function alternativesOf(guess: string, reply: string): string[] {
  const seen = [guess.trim().toLowerCase()]
  const found: string[] = []
  for (const raw of reply.split('\n')) {
    const item = /^\s*-\s+(.*)$/.exec(raw)?.[1]
    if (item === undefined) continue
    const text = item.trim().replace(/^["'`“](.*?)["'`”]$/, '$1').trim()
    if (text.length > MAX_GHOST || text.endsWith(':') || !/[\p{L}\p{N}]/u.test(text)) continue
    if (seen.includes(text.toLowerCase())) continue
    seen.push(text.toLowerCase())
    found.push(text)
    if (found.length === ALTERNATIVES) break
  }
  return found
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

/**
 * Asks Haiku for other next prompts beside Claude Code's guess, shown in the
 * empty box, and lists them all in the band, the guess first.
 */
async function suggestMore($: EngineInterface, guess: string, ask: number) {
  const messages = await $.session.messages()
  if (ask !== asked) return
  const stop = new AbortController()
  inflight = stop
  const reply = await $.model.complete(
    { model: MODEL, system: NEXT_SYSTEM, prompt: buildNextPrompt(guess, messages), maxTokens: 200, effort: 'low', timeoutMs: 8000 },
    { signal: stop.signal },
  )
  if (ask !== asked || !reply.isAnswered) return
  inflight = undefined
  const more = alternativesOf(guess, reply.text)
  if (more.length === 0) return
  const box = await $.prompt.read()
  if (ask !== asked || box.text !== '') return
  await update($, pick, () => ({ base: '', options: [guess, ...more], selected: 0 }))
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

/**
 * Previews prediction `i` dim after the typed text and marks it in the band;
 * in an empty box, makes next prompt `i` Claude Code's suggestion, Tab to take.
 */
async function select($: EngineInterface, i: number) {
  const p = await read($, pick)
  const option = p?.options[i]
  if (p === null || option === undefined || i === p.selected) return
  if (p.base === '') {
    const shown = await $.prompt.suggest({ text: option })
    await update($, pick, () => (shown.isShown ? { ...p, selected: i } : null))
    return
  }
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
    // Next prompts live in Claude Code's suggestion, never in the box: any edit ends them.
    if (p?.base === '') await update($, pick, () => null)
    else if (p !== null && option !== undefined) {
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
    if (p !== null && p.base !== '' && option !== undefined && e.text === p.base + option) {
      return next({ ...e, text: p.base })
    }
    return next(e)
  })

  // Claude Code's own guess at the next prompt shows as always; Haiku adds
  // others to it, listed in the band with it, alt+↑/↓ choosing the one shown.
  on('prompt.suggest', async ($, e, next) => {
    const shown = await next(e)
    if (shown.isShown && isEnabled && e.origin.kind === 'suggestion') {
      cancel()
      await update($, pick, () => null)
      void suggestMore($, e.text, ++asked)
    }
    return shown
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
            {p.base === '' ? ' cycle · Tab takes the one shown' : ' cycle · Backspace dismiss · Enter sends what you typed'}
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
