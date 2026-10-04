// Finds the clear signs of AI-written text in prose. It only flags patterns
// that are almost never right, so a block is rare and easy to fix. Fuzzier
// habits, like "X, not Y", are left to the system prompt's rules.

export type Finding = { rule: string; text: string }

const LONG_SENTENCE_WORDS = 40

const STOCK_WORDS =
  /\b(genuinely|honestly|truly|delve[sd]?|delving|robust(ly|ness)?|seamless(ly)?|crucial(ly)?|nuanced|leverag(e|es|ed|ing)|load-bearing|(it['\u2019]?s )?worth noting|notably|under the hood|at its core|boils down to|in essence|a testament to)\b/gi

const REVEAL_LABEL =
  /^((?:the )?(?:catch|idea|short version|upshot|key insight|kicker|twist|takeaway|bottom line)|in short|long story short|tl;dr)\s*:/i

const FILLER =
  /\b(great question|good question|excellent question|you['\u2019]?re absolutely right|hope (this|that) helps|happy to help|let me know if you have any (other |more |further )?questions|feel free to (ask|reach out|let me know))\b/gi

const COUNT_NOUN =
  /\b(two|three|four|five|six|several|a few) (\w+ )?(rules|problems|reasons|things|issues|changes|parts|steps|options|ways|causes|fixes|points)\s*[.:]$/i

const HERE_IS = /^here(?:['\u2019]s| is) (what|how|why|the \w+)\b/i

// Code, quotes and quoted lines are someone else's words, or not prose.
const stripNonProse = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/"[^"\n]*"/g, ' ')
    .replace(/\u201c[^\u201d\n]*\u201d/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/https?:\/\/\S+/g, ' ')

// Splits prose into units that can hold sentences: a paragraph (its wrapped
// lines joined), a list item, a heading, or a table cell.
const units = (prose: string) => {
  const out: string[] = []
  let current = ''
  const flush = () => {
    if (current.trim()) out.push(current.trim())
    current = ''
  }
  for (const line of prose.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
    } else if (trimmed.startsWith('|')) {
      flush()
      out.push(...trimmed.split('|').map(cell => cell.trim()).filter(Boolean))
    } else if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(trimmed)) {
      flush()
      current = trimmed.replace(/^(#{1,6}|[-*+]|\d+[.)])\s+/, '')
    } else {
      current += ' ' + trimmed
    }
  }
  flush()
  return out
}

const sentences = (unit: string) =>
  unit
    .replace(/\*\*|__/g, '')
    .split(/(?<=[.!?:])\s+(?=[A-Z])/)
    .map(sentence => sentence.trim())
    .filter(Boolean)

const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 77)}...` : text)

export const check = (text: string): Finding[] => {
  const prose = stripNonProse(text)
  const findings: Finding[] = []
  const add = (rule: string, found: string) => {
    if (!findings.some(f => f.rule === rule && f.text === clip(found))) findings.push({ rule, text: clip(found) })
  }

  if (prose.includes('\u2014')) add('em dash', prose.match(/[^\n]{0,30}\u2014[^\n]{0,30}/)?.[0] ?? '\u2014')
  for (const m of prose.matchAll(STOCK_WORDS)) add('stock word', m[0])
  for (const m of prose.matchAll(FILLER)) add('filler', m[0])

  for (const unit of units(prose)) {
    for (const sentence of sentences(unit)) {
      const words = sentence.split(/\s+/).length
      if (words > LONG_SENTENCE_WORDS) add('long sentence', `${words} words: ${sentence}`)
      const label = sentence.match(REVEAL_LABEL)
      if (label) add('reveal label', `${label[1]}:`)
      if (words <= 8 && (COUNT_NOUN.test(sentence) || HERE_IS.test(sentence))) add('announcing sentence', sentence)
    }
  }

  return findings
}

export const describe = (findings: Finding[]) =>
  findings.map(f => `- ${f.rule}: ${f.text}`).join('\n')

// The prose a shell command is about to publish: commit messages, and the
// titles, bodies and comments of PRs and issues. Undefined when the command
// publishes none.
export const publishedText = (command: string): string | undefined => {
  const publishes =
    /\bgit\s+commit\b/.test(command) ||
    /\bgh\s+(pr|issue)\s+(create|edit|comment|review|close)\b/.test(command) ||
    /\bgh\s+release\s+(create|edit)\b/.test(command)
  if (!publishes) return undefined

  const parts: string[] = []
  for (const m of command.matchAll(/<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\s*\1\b/g)) parts.push(m[2] ?? '')
  const withoutHeredocs = command.replace(/<<-?\s*['"]?(\w+)['"]?\n[\s\S]*?\n\s*\1\b/g, ' ')
  const flag = /(?:^|\s)(?:-m|--message|-t|--title|-b|--body|--notes)(?:\s+|=)("((?:[^"\\]|\\.)*)"|'([^']*)')/g
  for (const m of withoutHeredocs.matchAll(flag)) {
    const body = m[2] ?? m[3] ?? ''
    if (!body.startsWith('$(')) parts.push(body.replace(/\\(["\\$`])/g, '$1').replace(/\\n/g, '\n'))
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

export const isMarkdown = (path: string) => /\.(md|mdx|markdown)$/i.test(path)
