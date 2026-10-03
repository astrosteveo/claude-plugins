import type { FlaggedPhrases } from '../types'

// What gets merged: "PR #223", "#223", "the fix", "this".
const MERGED = '(?:PRs?|MRs?|pull requests?|branch(?:es)?|commits?|changes?|fix(?:es)?|patch(?:es)?|release|this|that|#\\d+)(?:\\s#\\d+)?'

// Mostly multi-word phrases: a bare "ship", "land" or "flight" is too often literal
// in a coding session, and a flag that cries wolf gets ignored.
const BUILT_IN = [
  // Cues and stage directions
  "(?:our|my|your) cue|the cue to",
  'on deck',
  'tee(?:s|d|ing)? (?:it |this |that |them |things )?up',
  'green ?light(?:s|ed)?|greenlit',
  'next up|up next',
  'moving on',
  'with that (?:in place|done|out of the way|sorted|settled|squared away)',
  'that said',
  'without further ado',
  '(?:sets?|setting) the stage|the stage is set',
  '(?:paves?|paving|clears?|clearing) the way',
  'furthermore|moreover',
  // Travel, flight and sports. "Land" counts only for code being merged, since a
  // player landing on a platform is literal in a game.
  `(?:once|when|after|until|before|as soon as)\\s(?:[^.!?\\n]{0,30}?\\s)?${MERGED}\\slands?`,
  `${MERGED}\\s(?:(?:has|have|had|just|already|finally)\\s)*landed`,
  `land(?:s|ed|ing)?\\s(?:(?:the|this|that|your|my|our)\\s)?${MERGED}`,
  '(?:for|into) flight|ready for takeoff|cleared for takeoff',
  'home stretch|finish line|(?:over|across) the line',
  "ball(?:'s| is) in|(?:get|gets|got) the ball rolling|drop(?:s|ped)? the ball",
  'smooth sailing|plain sailing|off the rails',
  'kick(?:s|ed|ing)? off',
  // Idioms
  'circle back|touch base',
  'deep[- ]dive|dig(?:s|ging)? into|dive into|zero(?:s|ed|ing)? in on',
  'heavy lifting|load[- ]bearing|north star|moving parts|low[- ]hanging fruit|game[- ]changer',
  'rabbit hole|sweet spot|silver bullet|quick wins?|secret sauce|bread and butter',
  'boils? down to|dust settles|in the weeds|move the needle|under the hood|smoking gun',
  'belt and (?:braces|suspenders)|battle[- ]tested|rock[- ]solid|lay of the land',
  'game plan|plan of attack|tip of the iceberg|double[- ]edged|in a nutshell',
  "the kicker|plot twist|the fun part|here'?s the thing|on (?:the|my|our) radar",
  'nail(?:s|ed|ing)? (?:it|this|that) down|nailed it',
  'at the end of the day|elephant in the room|bite the bullet|hit the ground running',
]

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Lookarounds rather than \b, so a phrase may start or end with punctuation.
const compile = (source: string) => new RegExp(`(?<!\\w)(?:${source})(?!\\w)`, 'gi')

const BUILT_IN_PATTERNS = BUILT_IN.map(compile)

/** The `extraPhrases` option as patterns: comma-separated, matched literally. */
export function extraPatterns(option: string): RegExp[] {
  return option
    .split(',')
    .map(phrase => phrase.trim())
    .filter(Boolean)
    .map(phrase => compile(escape(phrase).replace(/\s+/g, '\\s+')))
}

/** The prose alone: code, links, block quotes and quoted text are someone else's words. */
export function prose(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^[ \t]*>.*$/gm, ' ')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, ' ')
}

/** Each figurative phrase the text uses, once, in the order it first appears. */
export function findPhrases(text: string, extra: readonly RegExp[] = []): FlaggedPhrases {
  const scanned = prose(text)
  const hits: { at: number; end: number; phrase: string }[] = []
  for (const pattern of [...BUILT_IN_PATTERNS, ...extra]) {
    for (const match of scanned.matchAll(pattern)) {
      const at = match.index ?? 0
      hits.push({ at, end: at + match[0].length, phrase: match[0].replace(/\s+/g, ' ') })
    }
  }
  // Earliest first, and the longest of those that start together.
  hits.sort((a, b) => a.at - b.at || b.end - a.end)

  const seen = new Set<string>()
  const found: string[] = []
  let covered = 0
  for (const { at, end, phrase } of hits) {
    // A match inside one already kept, such as "on deck" in "all hands on deck", adds nothing.
    if (at < covered) continue
    covered = end
    const key = phrase.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push(phrase)
  }

  return found
}

const quoteAll = (phrases: FlaggedPhrases) => phrases.map(p => `"${p}"`).join(', ')

/** The line shown under a reply that used figurative phrases. Claude Code puts the plugin's name before it. */
export const flagLine = (found: FlaggedPhrases) => `Flagged phrases: ${quoteAll(found)}`

/** What the model reads beside each prompt; the user never sees it. */
export function reminder(found: FlaggedPhrases): string {
  const lines = [
    'Plain English: write short, literal sentences. Report status as plain facts, such as "PR #223 is merged. PR #227 is next." Use no metaphors, idioms or stagey transitions.',
  ]
  if (found.length) {
    lines.push(`Your last reply used figurative wording: ${quoteAll(found)}. Say the literal thing instead.`)
  }

  return lines.join('\n')
}
