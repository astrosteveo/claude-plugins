import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptEditInput, PromptOrigin, Register } from 'claude-code'

import type { Suggestions } from '../types'

const listAtom = atom({ plugin: 'next-prompts', key: 'list' } as const, null)
const checkAtom = atom({ plugin: 'next-prompts', key: 'check' } as const, null)

export const COUNT = 3
const LINE_LIMIT = 120
// Unused lists in a row before replies start to be skipped, and the most skipped at once
const FREE_IGNORES = 2
const MAX_SKIPS = 16

// The fork reads the whole conversation from the session's prompt cache,
// so this request is all it adds.
export const ASK = [
  "[SUGGESTION MODE: suggest what the user might type next. Don't call tools and don't reply to the user.]",
  `Write exactly ${COUNT} prompts the user is likely to send you next, in their own voice and style.`,
  'Base them on what the user asked and on your last reply: answer its question, take the next step, or check the work.',
  'Make them different from each other. One line each, 2 to 12 words, in plain words.',
  'Never write in your own voice ("Let me...", "I\'ll..."), and never suggest thanks or praise.',
  `If you can't suggest ${COUNT} safe, useful prompts, output nothing.`,
  `Output only the ${COUNT} lines: no numbers, bullets, quotes or other text.`,
].join('\n')

const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

// Quotes that wrap a whole line, so `status = 'active'` keeps its own.
const WRAPPED = /^(["'`])(.*)\1$|^“(.*)”$/
const unwrap = (line: string) => {
  const m = WRAPPED.exec(line)
  return m ? (m[2] ?? m[3] ?? '').trim() : line
}

/** The model's lines as up to 3 one-line prompts, numbering and quotes taken off. */
export function parseSuggestions(text: string): Suggestions {
  return text
    .split('\n')
    .map(line => unwrap(line.trim().replace(/^(?:\d+[.)]|[-*•])\s*/, '')))
    .filter(Boolean)
    .slice(0, COUNT)
    .map(line => cut(line, LINE_LIMIT))
}

/**
 * A lone digit key from 0 to COUNT into an empty box. The digit lands in the
 * box, and if nothing follows it for 400 ms the engine presses the list's
 * Button with that hotkey and empties the box.
 */
export function isHotkey(e: PromptEditInput): boolean {
  if (e.text !== '' || !e.key || e.key.ctrl || e.key.meta || e.key.key !== e.inputText) return false
  return /^\d$/.test(e.inputText) && Number(e.inputText) <= COUNT
}

/**
 * How many replies to skip after `ignored` lists in a row went unused: none
 * for the first 2, then 1, 2, 4 and so on, up to 16.
 */
export function skipsAfter(ignored: number): number {
  return ignored <= FREE_IGNORES ? 0 : Math.min(MAX_SKIPS, 2 ** (ignored - FREE_IGNORES - 1))
}

// The store holds a count, or nothing before the first one.
const count = (value: unknown) => (typeof value === 'number' && value > 0 ? value : 0)

// Your own Enter, at the terminal or through Remote Control
const isYours = (origin: PromptOrigin) => origin.kind === 'composer' || origin.kind === 'bridge'

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

// Kept here as well as in state so a keystroke with no list costs no engine call.
let isShown = false
// Counts lists so a late reply for an older one is dropped.
let run = 0

async function clear($: EngineInterface) {
  run += 1
  if (!isShown) return
  isShown = false
  await update($, listAtom, () => null)
}

// The counts live in the store, so the backoff carries over to the next session.
async function noteIgnored($: EngineInterface) {
  const ignored = count(await $.store.get('ignored')) + 1
  await $.store.set('ignored', ignored)
  await $.store.set('skips', skipsAfter(ignored))
}

async function noteUsed($: EngineInterface) {
  if (count(await $.store.get('ignored')) === 0) return
  await $.store.set('ignored', 0)
  await $.store.set('skips', 0)
}

/** Drops a list you moved on from without sending it, and counts it as unused. */
async function ignore($: EngineInterface) {
  const wasShown = isShown
  await clear($)
  if (wasShown) await noteIgnored($)
}

/** Records what this check did, for the debug line. */
function note($: EngineInterface, outcome: string, ms: number | null = null) {
  return update($, checkAtom, () => ({ outcome, ms }))
}

async function suggest($: EngineInterface, mine: number) {
  // Nobody would see the list, as in a plain `-p` run: don't pay for it.
  if ((await $.session.surfaces()).length === 0) return note($, 'skipped: no screen to show it on')

  const skips = count(await $.store.get('skips'))
  if (skips > 0) {
    await $.store.set('skips', skips - 1)
    return note($, `skipped: recent lists went unused (${skips - 1} more to skip)`)
  }

  const startedAt = await $.clock.now()
  const r = await $.model.fork({ prompt: ASK })
  const ms = (await $.clock.now()) - startedAt
  if (!r.isAnswered) return note($, `no reply: ${r.reason}`, ms)
  if (mine !== run) return note($, 'dropped: a prompt or turn started first', ms)

  const items = parseSuggestions(r.text)
  if (items.length < COUNT) return note($, `too few lines: ${items.length} of ${COUNT}`, ms)
  // You already started typing: the list would only get in the way.
  const box = await $.prompt.read()
  if (mine !== run || box.text !== '') return note($, 'dropped: you started typing', ms)

  isShown = true
  await update($, listAtom, () => items)
  await note($, 'shown', ms)
}

async function send($: EngineInterface, text: string) {
  await clear($)
  // Not awaited: the prompt runs as its own turn, after this press.
  void $.prompt.submit({ text, asUser: true })
  await noteUsed($)
}

export const register: Register = (on, options) => {
  const debug = options.debug === true
  isShown = false
  run = 0

  // A reload starts with no list, so clear one an older load left on show.
  on('session.start', async ($, e, next) => {
    await update($, listAtom, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId && e.reason === 'answer' && e.answer.trim()) {
      await clear($)
      // Not awaited: the model call must not hold up the end of the turn.
      void suggest($, run)
    }
    return result
  })

  on('turn.start', async ($, e, next) => {
    await clear($)
    return next(e)
  })

  // Your own prompt counts the list as unused; one from a plugin, such as a
  // picked suggestion, only drops it.
  on('prompt.submit', async ($, e, next) => {
    await (isYours(e.origin) ? ignore($) : clear($))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await clear($)
    return next(e)
  })

  // Typing your own prompt drops the list, or the one still on its way. A
  // hotkey keeps the list, so its Button is still there when the engine
  // presses it; the next key, if any, drops it.
  on('prompt.edit', async ($, e, next) => {
    if (!(isShown && isHotkey(e))) await ignore($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { bodyColumns, hasSurvey, isWorking, view } = e.props
    if (hasSurvey || isWorking || view.agentId) return next(e)
    const [list, check] = await Promise.all([read($, listAtom), debug ? read($, checkAtom) : null])
    if (!list && !check) return next(e)

    // Another mod may draw in this band too: keep its tree under the list.
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // A Button neither wraps nor truncates, so its label is cut to fit after `1: `.
    const width = Math.max(10, bodyColumns - 4)
    // One press per drawing: a second press before the band redraws does nothing.
    let isPressed = false
    const once = (act: () => Promise<void>) => () => {
      if (isPressed) return
      isPressed = true
      return act()
    }
    return (
      <Box flexDirection="column">
        {list?.map((item, i) => (
          <Button key={`send-${i + 1}`} plain hotkey={String(i + 1)} label={cut(item, width)} onPress={once(() => send($, item))} />
        ))}
        {list && (
          <Box>
            <Button key="dismiss" plain hotkey="0" role="dismiss" label="Dismiss" onPress={once(() => ignore($))} />
            <Text dimColor wrap="truncate-end">
              {'  '}or type your own prompt
            </Text>
          </Box>
        )}
        {check && (
          <Text key="check" dimColor wrap="truncate-end">
            next-prompts: {check.outcome}
            {check.ms === null ? '' : ` (${seconds(check.ms)})`}
          </Text>
        )}
        {below}
      </Box>
    )
  })
}
