import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptEditInput, Register } from 'claude-code'

import type { Suggestions } from '../types'

const listAtom = atom({ plugin: 'next-prompts', key: 'list' } as const, null)

export const COUNT = 3
const LINE_LIMIT = 120

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

async function suggest($: EngineInterface, mine: number) {
  const r = await $.model.fork({ prompt: ASK })
  if (!r.isAnswered || mine !== run) return

  const items = parseSuggestions(r.text)
  if (items.length < COUNT) return
  // You already started typing: the list would only get in the way.
  const box = await $.prompt.read()
  if (mine !== run || box.text !== '') return

  isShown = true
  await update($, listAtom, () => items)
}

async function send($: EngineInterface, text: string) {
  await clear($)
  // Not awaited: the prompt runs as its own turn, after this press.
  void $.prompt.submit({ text, asUser: true })
}

export const register: Register = on => {
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

  on('prompt.submit', async ($, e, next) => {
    await clear($)
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
    if (!(isShown && isHotkey(e))) await clear($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { bodyColumns, hasSurvey, isWorking, view } = e.props
    if (hasSurvey || isWorking || view.agentId) return next(e)
    const list = await read($, listAtom)
    if (!list) return next(e)

    // Another mod may draw in this band too: keep its tree under the list.
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // A Button neither wraps nor truncates, so its label is cut to fit after `1: `.
    const width = Math.max(10, bodyColumns - 4)
    return (
      <Box flexDirection="column">
        {list.map((item, i) => (
          <Button key={`send-${i + 1}`} plain hotkey={String(i + 1)} label={cut(item, width)} onPress={() => send($, item)} />
        ))}
        <Box>
          <Button key="dismiss" plain hotkey="0" role="dismiss" label="Dismiss" onPress={() => clear($)} />
          <Text dimColor wrap="truncate-end">
            {'  '}or type your own prompt
          </Text>
        </Box>
        {below}
      </Box>
    )
  })
}
