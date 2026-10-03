import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptEditInput, Register, SessionMessage } from 'claude-code'

import type { Suggestions } from '../types'

const listAtom = atom({ plugin: 'next-prompts', key: 'list' } as const, null)

export const COUNT = 3
// About 3K tokens of the conversation's end is enough to suggest a next step.
export const BUDGET = 12_000
const BLOCK_LIMIT = 4000
const LINE_LIMIT = 120

const SYSTEM = [
  'You suggest what the user might type next in a Claude Code session.',
  'The user message holds the end of their conversation with Claude.',
].join('\n')

const ASK = [
  `Write exactly ${COUNT} prompts the user is likely to send Claude next, in the user's voice.`,
  "Each must follow from Claude's last reply: answer its question, take the next step, or check the work.",
  'Make them different from each other. One line each, under 70 characters, in plain words.',
  `Output only the ${COUNT} lines: no numbers, bullets, quotes or other text.`,
].join('\n')

const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

// Quotes that wrap a whole line, so `status = 'active'` keeps its own.
const WRAPPED = /^(["'`])(.*)\1$|^“(.*)”$/
const unwrap = (line: string) => {
  const m = WRAPPED.exec(line)
  return m ? (m[2] ?? m[3] ?? '').trim() : line
}

/** The conversation's end as text, newest kept, with tool calls as names only. */
export function condense(messages: readonly SessionMessage[], answer: string, budget = BUDGET): string {
  const blocks: string[] = []
  for (const m of messages) {
    const lines: string[] = []
    if (m.text.trim()) lines.push(`${m.role === 'user' ? 'User' : 'Claude'}: ${cut(m.text.trim(), BLOCK_LIMIT)}`)
    if (m.toolUses.length) lines.push(`  [tools: ${m.toolUses.map(u => u.tool).join(', ')}]`)
    if (lines.length) blocks.push(lines.join('\n'))
  }
  // The transcript may not hold the turn's last reply yet.
  const last = messages.filter(m => m.role === 'assistant' && m.text.trim()).at(-1)
  if (answer.trim() && last?.text.trim() !== answer.trim()) blocks.push(`Claude: ${cut(answer.trim(), BLOCK_LIMIT)}`)

  const kept: string[] = []
  let size = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!
    if (size + block.length > budget) break
    kept.unshift(block)
    size += block.length
  }
  return kept.join('\n\n')
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
 * Which list item one edit picks: 0 to 2, 'dismiss' for 0, or null for an
 * edit that is just typing. Only a lone digit key into an empty box counts,
 * so a paste, a burst such as `1a` or a digit after other text passes.
 */
export function choiceFor(e: PromptEditInput, count: number): number | 'dismiss' | null {
  if (e.text !== '' || !e.key || e.key.ctrl || e.key.meta || e.key.key !== e.inputText) return null
  if (e.inputText === '0') return 'dismiss'
  const n = /^[1-9]$/.test(e.inputText) ? Number(e.inputText) : 0
  return n >= 1 && n <= count ? n - 1 : null
}

// Kept here as well as in state so a keystroke with no list costs no engine call.
let shown: Suggestions | null = null
// Counts lists so a late reply for an older one is dropped.
let run = 0

async function clear($: EngineInterface) {
  run += 1
  if (shown === null) return
  shown = null
  await update($, listAtom, () => null)
}

async function suggest($: EngineInterface, mine: number, answer: string) {
  const messages = await $.session.messages()
  if (mine !== run) return

  let text: string
  try {
    const r = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: `<conversation>\n${condense(messages, answer)}\n</conversation>\n\n${ASK}`,
      maxTokens: 300,
      timeoutMs: 20_000,
    })
    if (!r.isAnswered) return
    text = r.text
  } catch {
    // The engine refused to send it, such as a blocked model: show nothing.
    return
  }

  const items = parseSuggestions(text)
  if (items.length < COUNT || mine !== run) return
  // You already started typing: the list would only get in the way.
  const box = await $.prompt.read()
  if (mine !== run || box.text !== '') return

  shown = items
  await update($, listAtom, () => items)
}

export const register: Register = on => {
  shown = null
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
      void suggest($, run, e.answer)
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

  on('prompt.edit', async ($, e, next) => {
    if (shown === null) {
      // Typing before a list arrives drops it.
      run += 1
      return next(e)
    }

    const items = shown
    const choice = choiceFor(e, items.length)
    await clear($)
    if (choice === null) return next(e)

    // Not awaited: the prompt runs as its own turn, after this edit.
    if (choice !== 'dismiss') void $.prompt.submit({ text: items[choice]!, asUser: true })
    // The digit is consumed: the box stays as it was.
    return { text: e.text, cursor: e.cursor }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { hasSurvey, isWorking, view } = e.props
    if (hasSurvey || isWorking || view.agentId) return next(e)
    const list = await read($, listAtom)
    // A list an older load wrote has no keys behind it here, so it stays hidden.
    if (!list || shown === null) return next(e)

    // Another mod may draw in this band too: keep its tree under the list.
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {list.map((item, i) => (
          <Text wrap="truncate-end">
            <Text bold>{i + 1}</Text> {item}
          </Text>
        ))}
        <Text dimColor wrap="truncate-end">
          Type 1-{list.length} to send, 0 to dismiss, or type your own prompt
        </Text>
        {below}
      </Box>
    )
  })
}
