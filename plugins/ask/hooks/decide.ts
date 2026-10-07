import type { Decision, Offer, Question, Remembered, Take } from '../types'

export const LOG_KEEP = 300

// The same question with the same options, in the same project, is the same
// decision. Case and spacing don't make it a new one.
export function keyOf(root: string, q: Question): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  const labels = q.options.map(o => norm(o.label)).sort()
  return [root, norm(q.question), ...labels].join('\n')
}

// How long the fork's short sentences may be. A why line of this length,
// with its "Why: " in front, fits the two rows a note gets in the take box.
export const WHY_CHARS = 70
export const PLAIN_CHARS = 60

// What the fork is asked. The fork reads the whole conversation, but not the
// question Claude is asking right now, so the questions ride in the prompt.
export function takePrompt(questions: readonly Question[]): string {
  const listed = questions
    .map((q, i) => {
      const options = q.options.map(o => `  - ${o.label}${o.description ? `: ${o.description}` : ''}`).join('\n')
      return `Question ${i + 1}${q.multiSelect ? ' (several may be picked)' : ''}: ${q.question}\n${options}`
    })
    .join('\n\n')
  return [
    'This is an aside. It never enters the main conversation and you cannot use tools.',
    'You just asked the user the questions below. They are not sure what the options mean or which to choose.',
    'Using everything you know from this conversation, say which option you would pick and explain the options in plain words, as to someone smart who is not an expert.',
    '',
    listed,
    '',
    'Answer with JSON only, no prose and no code fence:',
    `{"takes":[{"pick":"<exact option label; for several, labels joined with \\", \\">","confidence":<0-100>,"why":"<one short sentence, at most ${WHY_CHARS} characters>","plain":"<what is being decided, one short sentence, at most ${PLAIN_CHARS} characters>","notes":{"<exact option label>":"<what choosing it means in practice, one short sentence>"}}]}`,
    `One entry per question, in order. Keep "why" under ${WHY_CHARS} characters and "plain" under ${PLAIN_CHARS}: they are shown in a small box and longer ones get cut.`,
    'Be honest about confidence: under 50 means it is close.',
  ].join('\n')
}

export const clip = (s: unknown, n: number): string => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n - 1)}…` : s).trim() : '')

// Cuts at the last space that fits, so a line that must be cut doesn't end
// in half a word.
export function clipWords(s: string, n: number): string {
  if (s.length <= n) return s
  const room = s.slice(0, n - 1)
  const space = room.lastIndexOf(' ')
  return `${(space > n / 2 ? room.slice(0, space) : room).trimEnd()}…`
}

// Claude Code draws at most 12 rows around the AskUserQuestion dialog and
// refuses a taller tree. It counts a row per line of text and one more for
// each 40 characters, whatever the terminal's width.
export const ROWS_AROUND_DIALOG = 12
const ROW_CHARS = 40

export const rowsOf = (text: string): number => Math.max(1, Math.ceil(text.length / ROW_CHARS))

export type TakeLine =
  | { kind: 'pick'; header: string; pick: string; confidence: number }
  | { kind: 'note'; text: string }

export function pickText(line: Extract<TakeLine, { kind: 'pick' }>): string {
  const header = line.header === '' ? '' : ` ${line.header}  `
  return `${header}I'd pick ${line.pick}  ${meter(line.confidence)} ${line.confidence}% ${sureness(line.confidence)}`
}

export const textOf = (line: TakeLine): string => (line.kind === 'pick' ? pickText(line) : line.text)

// The `askUserQuestionTimeout` setting when it can fire: "60s", "5m" or
// "10m". Anything else, "never" and a missing setting included, is null.
export function idleTimeout(settings: unknown): string | null {
  const value = (settings as { askUserQuestionTimeout?: unknown } | null | undefined)?.askUserQuestionTimeout
  return typeof value === 'string' && ['60s', '5m', '10m'].includes(value) ? value : null
}

// The take box's line saying what happens if nobody answers in time.
export function awayText(questions: readonly Question[], takes: readonly (Take | null)[], timeout: string): string {
  const picked = questions.flatMap((_, i) => (takes[i] ? [takes[i] as Take] : []))
  const what = questions.length === 1 && picked[0] ? clip(picked[0].pick, 28) : 'my picks'
  return `If you're away for ${timeout}, I'll go with ${what}.`
}

// The take box's lines within `rows`. Pick lines come first in importance,
// then the away line when there is one, then why, then what the question
// means; notes are cut to the room left.
export function takeLines(questions: readonly Question[], takes: readonly (Take | null)[], rows: number, timeout: string | null = null): TakeLine[] {
  const shown = questions.flatMap((q, i) => {
    const take = takes[i]
    return take ? [{ q, take }] : []
  })
  const isOne = questions.length === 1
  const picks: TakeLine[] = shown.map(({ q, take }) => ({
    kind: 'pick',
    header: isOne ? '' : clip(q.header, 12),
    pick: clip(take.pick, 28),
    confidence: take.confidence,
  }))
  let spare = rows
  const kept = picks.filter(line => {
    const cost = rowsOf(textOf(line))
    if (cost > spare) return false
    spare -= cost
    return true
  })
  // A note takes what's left, two rows at most, so one long why can't crowd out the rest.
  const note = (text: string): TakeLine | null => {
    if (!text || spare < 1) return null
    const fitted = clipWords(text, Math.min(spare, 2) * ROW_CHARS)
    spare -= rowsOf(fitted)
    return { kind: 'note', text: fitted }
  }
  const away = kept.length > 0 && timeout !== null ? note(awayText(questions, takes, timeout)) : null
  if (isOne && kept.length === 1) {
    const [{ take }] = shown as [{ q: Question; take: Take }]
    const why = note(take.why ? `Why: ${take.why}` : '')
    const plain = note(take.plain ? `In plain words: ${take.plain}` : '')
    return [plain, kept[0], why, away].filter((line): line is TakeLine => line !== null && line !== undefined)
  }
  const lines: TakeLine[] = []
  kept.forEach((line, i) => {
    lines.push(line)
    const why = note(shown[i]?.take.why ?? '')
    if (why) lines.push(why)
  })
  if (away) lines.push(away)
  return lines
}

// Claude Code's dialog, once `askUserQuestionTimeout` passes with nobody at
// the keyboard, submits what was selected so far and sets `afkTimeoutMs`.
// A person answering never sets it.
export function timedOut(result: unknown): boolean {
  return typeof (result as { afkTimeoutMs?: unknown } | null | undefined)?.afkTimeoutMs === 'number'
}

export type AwayPick = { question: Question; take: Take }

// The questions a timed-out dialog left unanswered that Claude has a take
// for. An answer selected before the timeout stands.
export function awayPicks(questions: readonly Question[], answers: unknown, takes: readonly (Take | null)[]): AwayPick[] {
  return questions.flatMap((question, i) => {
    const take = takes[i]
    return take && answerOf(answers, question) === undefined ? [{ question, take }] : []
  })
}

// What Claude reads after the tool's result. The answers stay as the person
// left them, so the tool's own text still says truthfully what they chose;
// this tells Claude to go ahead with its pick for the rest.
export function awayContext(picks: readonly AwayPick[]): string {
  const lines = picks.map(({ question, take }) => `- "${question.question}": ${take.pick} (${take.confidence}% sure)`)
  return [
    'The user was away and the question timed out. The ask plugin took your earlier pick for each question they left unanswered:',
    ...lines,
    'The user did not choose these. Go ahead with them, and mention it when the user is back.',
  ].join('\n')
}

// The toast and the band's text after an away pick.
export function awayNotice(picks: readonly { question: string; pick: string }[]): string {
  const [first] = picks
  if (picks.length === 1 && first) return `You were away, so Claude went with ${first.pick}.`
  return `You were away, so Claude went with its picks for ${picks.length} questions.`
}

// Reads the fork's reply. Anything that doesn't fit a question is dropped, so
// a bad reply shows less, never something wrong.
export function parseTakes(text: string, questions: readonly Question[]): (Take | null)[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let raw: unknown
  try {
    raw = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : undefined
  } catch {
    raw = undefined
  }
  const list = Array.isArray((raw as { takes?: unknown })?.takes) ? (raw as { takes: unknown[] }).takes : []
  return questions.map((q, i) => {
    const one = list[i] as Record<string, unknown> | undefined
    if (!one || typeof one !== 'object') return null
    const labels = q.options.map(o => o.label)
    const said = clip(one.pick, 500)
    const picks = (q.multiSelect ? said.split(/\s*,\s*/) : [said]).filter(p => labels.includes(p))
    if (picks.length === 0) return null
    const notes: Record<string, string> = {}
    const rawNotes = (one.notes ?? {}) as Record<string, unknown>
    for (const label of labels) {
      const note = clip(rawNotes[label], 200)
      if (note) notes[label] = note
    }
    const confidence = Math.round(Math.min(100, Math.max(0, Number(one.confidence) || 0)))
    return { pick: picks.join(', '), confidence, why: clip(one.why, 240), plain: clip(one.plain, 240), notes }
  })
}

// The dialog's questions with Claude's take written into the option
// descriptions. Labels stay as they were: the answer Claude gets back is the
// label, so they must not change.
export function decorate(questions: readonly Question[], takes: readonly (Take | null)[]): Question[] {
  return questions.map((q, i) => {
    const take = takes[i]
    if (!take) return q
    const picked = take.pick.split(', ')
    return {
      ...q,
      options: q.options.map(o => {
        const parts = [
          picked.includes(o.label) ? `★ Claude's pick (${take.confidence}%).` : '',
          o.description,
          take.notes[o.label] ? `In plain words: ${take.notes[o.label]}` : '',
        ].filter(Boolean)
        return { ...o, description: parts.join(' ') }
      }),
    }
  })
}

export function meter(confidence: number, width = 10): string {
  const full = Math.round((Math.min(100, Math.max(0, confidence)) / 100) * width)
  return '▰'.repeat(full) + '▱'.repeat(width - full)
}

export function sureness(confidence: number): string {
  if (confidence >= 80) return 'confident'
  if (confidence >= 55) return 'leaning'
  return 'close call'
}

export function sureColor(confidence: number): 'success' | 'warning' | 'subtle' {
  if (confidence >= 80) return 'success'
  if (confidence >= 55) return 'warning'
  return 'subtle'
}

// The answer AskUserQuestion recorded for one question, or undefined.
export function answerOf(answers: unknown, q: Question): string | undefined {
  const value = (answers as Record<string, unknown> | undefined)?.[q.question]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

const pad = (n: number) => String(n).padStart(2, '0')

export function when(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Did the person go with Claude's pick? Only said when Claude had one and
// the person chose; an away pick was nobody's choice.
export function agreed(d: Decision): boolean | undefined {
  if (d.pick === undefined || d.source === 'away') return undefined
  return d.pick.toLowerCase() === d.answer.toLowerCase()
}

// Does a log entry or a remembered answer match the pane's search? Every
// word must appear somewhere in it, ignoring case.
export function matches(query: string, ...texts: (string | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = texts.filter(Boolean).join('\n').toLowerCase()
  return words.every(word => hay.includes(word))
}

export type Tally = { agreed: number; of: number }
export type Agreement = { total: Tally; recent: Tally; weeks: { start: number; tally: Tally }[] }

export const RECENT = 20
const WEEKS = 4

const tally = (list: readonly Decision[]): Tally => ({ agreed: list.filter(d => agreed(d) === true).length, of: list.length })

// Monday 00:00, local time, of the week `at` falls in.
export function weekOf(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

// How often the person went with Claude's pick: over the whole log, over the
// last 20 answers Claude had a pick for, and per week, newest week first.
// Answers given from memory had no take, and nobody chose an away pick, so
// neither counts.
export function agreement(log: readonly Decision[]): Agreement {
  const taken = log.filter(d => d.pick !== undefined && d.source === 'you').sort((a, b) => a.at - b.at)
  const byWeek = new Map<number, Decision[]>()
  for (const d of taken) {
    const start = weekOf(d.at)
    byWeek.set(start, [...(byWeek.get(start) ?? []), d])
  }
  const weeks = [...byWeek.entries()]
    .sort(([a], [b]) => b - a)
    .slice(0, WEEKS)
    .map(([start, list]) => ({ start, tally: tally(list) }))
  return { total: tally(taken), recent: tally(taken.slice(-RECENT)), weeks }
}

export const percent = (t: Tally): string => `${t.agreed} of ${t.of} (${t.of === 0 ? 0 : Math.round((t.agreed / t.of) * 100)}%)`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function weekLabel(start: number): string {
  const d = new Date(start)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

// The stats as the pane's lines. Nothing to say until Claude had a pick.
export function agreementLines(a: Agreement): string[] {
  if (a.total.of === 0) return []
  const lines = [`You went with Claude's pick ${percent(a.total)}`]
  if (a.total.of > a.recent.of) lines[0] += ` · last ${RECENT}: ${percent(a.recent)}`
  if (a.weeks.length > 1) lines.push(`By week: ${a.weeks.map(w => `${weekLabel(w.start)} ${w.tally.agreed}/${w.tally.of}`).join(' · ')}`)
  return lines
}

// The log as markdown, newest first, for DECISIONS.md.
export function logMarkdown(log: readonly Decision[]): string {
  const rows = [...log]
    .sort((a, b) => b.at - a.at)
    .map(d => {
      const take =
        d.pick === undefined
          ? ''
          : agreed(d)
            ? ` (Claude agreed, ${d.confidence}%)`
            : ` (Claude would have picked ${d.pick}, ${d.confidence}%)`
      if (d.source === 'away') return `- **${when(d.at)}** · ${d.header}: ${d.question}\n  → ${d.answer} (picked by Claude while you were away, ${d.confidence}%)`
      const from = d.source === 'remembered' ? ' (remembered)' : ''
      return `- **${when(d.at)}** · ${d.header}: ${d.question}\n  → ${d.answer}${from}${take}`
    })
  return `# Decisions\n\nAnswers given to Claude's questions, newest first.\n\n${rows.join('\n')}\n`
}

// The store is shared by every session, so each write starts from what is
// stored now and changes only its own entries. These take the stored value as
// read, which may be missing or not a list.
const listOf = <T>(stored: unknown): T[] => (Array.isArray(stored) ? (stored as T[]) : [])

// Each entry is saved once, by the session that logged it, so the new ones
// are added as they are.
export function withDecisions(stored: unknown, entries: readonly Decision[]): Decision[] {
  return [...listOf<Decision>(stored), ...entries].sort((a, b) => a.at - b.at).slice(-LOG_KEEP)
}

export function withoutRoot(stored: unknown, root: string): Decision[] {
  return listOf<Decision>(stored).filter(d => d.root !== root)
}

export function withRemembered(stored: unknown, held: Offer, at: number): Remembered[] {
  const keys = new Set(held.items.map(item => item.key))
  return [...listOf<Remembered>(stored).filter(one => !keys.has(one.key)), ...held.items.map(item => ({ ...item, root: held.root, at }))]
}

export function withoutRemembered(stored: unknown, key: string): Remembered[] {
  return listOf<Remembered>(stored).filter(one => one.key !== key)
}

export const rememberedOf = (stored: unknown): Remembered[] => listOf<Remembered>(stored)
export const decisionsOf = (stored: unknown): Decision[] => listOf<Decision>(stored)
