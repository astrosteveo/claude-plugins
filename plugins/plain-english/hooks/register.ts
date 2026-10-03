import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { extraPatterns, findPhrases, flagLine, reminder } from './phrases'
import { RULES } from './rules'

export const SECTION = 'plain-english:rules'
// The output style this mod replaces. With both on, the rules load twice.
export const OLD_STYLE = 'Plain Language'
export const OLD_STYLE_NOTICE =
  'Plain English: the "Plain Language" output style is also on, so the rules load twice. Run /config and set Output style to Default.'

// The engine's content block, which its types don't export.
type Block = { type: string; [field: string]: unknown }

/** A response row's text blocks, joined. */
export const responseText = (content: readonly Block[]) =>
  content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n')

const turnText = atom({ plugin: 'plain-english', key: 'turnText' } as const, '')
const flagged = atom({ plugin: 'plain-english', key: 'flagged' } as const, [])
const hasWarned = atom({ plugin: 'plain-english', key: 'hasWarned' } as const, false)

export const register: Register = (on, options) => {
  const showFlags = options.showFlags !== false
  const extra = extraPatterns(typeof options.extraPhrases === 'string' ? options.extraPhrases : '')

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (e.traits.includes('bare')) return result

    if (e.outputStyle?.name === OLD_STYLE && !(await read($, hasWarned))) {
      await update($, hasWarned, () => true)
      $.ui.toast(OLD_STYLE_NOTICE)
    }

    return { sections: [...result.sections, { id: SECTION, text: RULES, scope: 'session' }] }
  })

  // Main loop only: a subagent's turn raises no turn.start.
  on('turn.start', async ($, e, next) => {
    await update($, turnText, () => '')
    return next(e)
  })

  // Collect the text between tool calls too, where most narration happens.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const result = await next(e)
    const row = result.message
    if (e.agentId !== undefined || row?.role !== 'assistant') return result

    const text = responseText(row.content)
    if (text.trim()) await update($, turnText, t => `${t}\n${text}`)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    const text = `${await read($, turnText)}\n${e.answer}`
    await update($, turnText, () => '')
    if (e.reason !== 'answer') return result

    const found = findPhrases(text, extra)
    await update($, flagged, () => found)
    if (!showFlags || found.length === 0) return result

    return { ...result, text: flagLine(found) }
  })

  on('prompt.submit', async ($, e, next) => {
    const found = await read($, flagged)
    await update($, flagged, () => [])

    return next({ ...e, context: [...(e.context ?? []), reminder(found)] })
  })
}
