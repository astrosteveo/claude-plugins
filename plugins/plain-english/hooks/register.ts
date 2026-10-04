import type { EngineInterface, Register } from 'claude-code'

import { check, describe, isMarkdown, publishedText } from './checker'
import type { Finding } from './checker'

const SECTION_ID = 'plain-english:style'
const ENABLED_KEY = 'enabled'
const REWRITE_KEY = 'rewrite'

// The rules come from reading void-sector's commits, PRs and wiki, which are
// the style to avoid. The hard parts to read were long sentences chained with
// semicolons, numbers packed into parentheses, dropped verbs and articles,
// unexplained project terms, slogans, teaser lead-ins and clever headings.
// "Habits to drop" bans the general signs of AI-written text on top of those.
const STYLE = `# Writing in plain English

Write everything meant for people in plain English: replies, summaries, commit messages, pull request and issue descriptions, code comments and docs. A reader who is new to the project should understand it on the first read.

- Start with the result. Say what changed or what you found first, then why, then the details. Put caveats about what you could or couldn't check after the answer, not before it.
- Use short sentences with one idea each, about 20 words or fewer. Don't chain clauses with semicolons or colons. Start a new sentence instead.
- Write whole sentences. Keep the subject, the verb and words like "the" and "a". A commit summary like "Keep the test past the new bound" leaves the reader guessing. Write "Update the order-distance test for the new limit" instead.
- Use everyday words in their usual order. Write "around", not "round". Write "keeps mining", not "cuts on". Call the person "you", not "the owner" or "the user".
- Explain a project term the first time you use it, or describe the thing plainly instead. For example, write "the saved expected output (goldens)", not just "goldens".
- Don't pack numbers into parentheses in the middle of a sentence. Give one or two numbers in a sentence. Put more than that in a list or a table.
- Say things literally. Don't use metaphors, idioms or slogans like "danger still follows the ore", "fly when it counts" or "competent, not optimal". Say what actually happens.
- Give headings and titles plain names that say what the section covers, like "Mining fields" or "Camera controls". Don't write clever ones like "The Holomap Is the Bridge" or "Range is a ceiling, not a point".
- State cause and effect directly: "X failed because Y."
- Break up anything longer than a short paragraph. Use a bullet for each change, and headings for separate topics.
- Put issue and PR references at the end of a sentence or on their own line, not in the middle of one.

## Habits to drop

These are the usual signs of AI-written text. Don't use them.

- Sentences that only set up the next one. This includes teasers like "Four rules keep that honest." or "It also suits an MMO.", and announcements like "The design follows four rules.", "Two problems caused this.", "Here's what happened:" or "Here's the breakdown." Delete that sentence and start with the first rule or the first problem. A heading or a list already shows how many there are. A sentence that introduces a list is fine when it says something, like "Switch to Postgres if any of these apply:".
- Reveal labels in the middle of prose, like "The catch:", "The idea:", "The short version:", "The upshot:", "Bottom line:" or "The key insight:". Write a normal sentence instead.
- Contrast framing used for effect, like "competent, not optimal", "not just X, but Y" or "This isn't X. It's Y." Say what the thing is. A literal correction is fine, like "the label measured to the centre, not the surface".
- Em dashes. Use a period, a comma or parentheses instead.
- Stock words and phrases: "genuinely", "honestly", "truly", "delve", "robust", "seamless", "crucial", "nuanced", "leverage", "load-bearing", "it's worth noting", "notably", "under the hood", "at its core", "boils down to", "in essence", "a testament to". Use the plain word or leave it out.
- Filler at the start or end of a reply, like "Great question!", "You're absolutely right", "Got it!", "Hope this helps", "Let me know if you have any questions" or a closing "In short, ..." that repeats what you just said. Asking a real question about the next step is fine.
- Lists of three adjectives or phrases added for rhythm, like "fast, simple and reliable", when one word says it.

Code, commands, file names, identifiers and quoted text stay exactly as they are.

Example. Instead of:
"The server checked an order's point and direction against 1,000 km, a bound from the old compact sectors. Kessik's planet lies 8,000 km out and the edge 10,000 km, so a Head this way or Move here aimed that far failed the check, and the server closed the pilot's connection as if the message were malformed."

Write:
"Flying toward Kessik's planet disconnected the player. The server rejected any order aimed more than 1,000 km away. That limit was left over from when sectors were small. The planet is 8,000 km away, so the server treated the order as a broken message and closed the connection. The limit is now twice the distance to the farthest sector edge."`

const isOn = async ($: EngineInterface, key: string) => (await $.store.get(key)) !== false

const HELP =
  'Use /plain-english on or off for the whole mod, /plain-english rewrite on or off for the end-of-reply check, or /plain-english to see both.'

const refusal = (what: string, findings: Finding[]) =>
  `plain-english: ${what} has signs of AI-written text. The user set up this check to keep them out, so fix them yourself and run it again without asking first. Keep the meaning, and change only what the list names.\n${describe(findings)}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'plain-english',
      description: 'Turn plain English on or off, or its end-of-reply check (rewrite on|off)',
    })

    return next(e)
  })

  on('command.run', { command: 'plain-english' }, async ($, e) => {
    const [first = '', second = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const isRewrite = first === 'rewrite'
    const wanted = isRewrite ? second : first
    if (wanted === 'on' || wanted === 'off') {
      await $.store.set(isRewrite ? REWRITE_KEY : ENABLED_KEY, wanted === 'on')
      return {
        text: isRewrite
          ? `The end-of-reply check is now ${wanted}.`
          : `Plain English is now ${wanted}. It applies from the next reply.`,
      }
    }
    if (first !== '') return { text: HELP }

    const enabled = (await isOn($, ENABLED_KEY)) ? 'on' : 'off'
    const rewrite = (await isOn($, REWRITE_KEY)) ? 'on' : 'off'
    return { text: `Plain English is ${enabled}. The end-of-reply check is ${rewrite}.` }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await isOn($, ENABLED_KEY))) return composed

    return {
      sections: [
        ...composed.sections.filter(section => section.id !== SECTION_ID),
        { id: SECTION_ID, text: STYLE, scope: 'session' },
      ],
    }
  })

  // Commit messages, PRs, issues and Markdown files outlast the session, so a
  // sign of AI-written text there is refused and Claude writes it again.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const text = publishedText(e.command)
    if (text === undefined || !(await isOn($, ENABLED_KEY))) return next(e)
    const findings = check(text)

    return findings.length > 0 ? { deny: refusal('This message', findings) } : next(e)
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!isMarkdown(e.file_path) || !(await isOn($, ENABLED_KEY))) return next(e)
    const findings = check(e.content)

    return findings.length > 0 ? { deny: refusal(e.file_path, findings) } : next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (!isMarkdown(e.file_path) || !(await isOn($, ENABLED_KEY))) return next(e)
    const findings = check(e.new_string)

    return findings.length > 0 ? { deny: refusal(`The new text for ${e.file_path}`, findings) } : next(e)
  })

  // A chat reply that slips gets one rewrite. stop_hook_active is set on the
  // stop that follows a rewrite, so the check never loops.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result.block !== undefined || e.stop_hook_active) return result
    if (!(await isOn($, ENABLED_KEY)) || !(await isOn($, REWRITE_KEY))) return result
    const findings = check(e.last_assistant_message ?? '')
    if (findings.length === 0) return result

    return {
      ...result,
      block: `plain-english: your last reply has signs of AI-written text.\n${describe(findings)}\nWrite the whole reply again without them. Start with the corrected reply itself, and don't mention this check or apologize.`,
    }
  })
}
