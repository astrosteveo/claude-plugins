import type { Ask } from '../types'

// One earlier question and its answer from the pane.
export type Exchange = { question: string; answer: string }

// How much of the pane a new question carries: the last few answered asks,
// each answer cut short, the whole capped so a follow-up stays cheap.
const EARLIER = 3
const EARLIER_ANSWER = 1500
const EARLIER_TOTAL = 4000

// The other answered asks, oldest first, as many as fit the caps. The list
// is oldest first already, so they are the ones the question follows.
export function earlier(list: readonly Ask[], id: string): Exchange[] {
  const answered = list
    .filter(one => one.id !== id && one.status === 'answered')
    .slice(-EARLIER)
    .map(one => ({ question: one.question.trim(), answer: clip(one.answer ?? '', EARLIER_ANSWER) }))
  // Drop the oldest until the rest fit.
  while (answered.reduce((n, one) => n + one.question.length + one.answer.length, 0) > EARLIER_TOTAL) {
    answered.shift()
  }

  return answered
}

// The question the fork reads after the session's own transcript, led by
// what the pane already said, which the main conversation never saw.
export function framed(question: string, before: readonly Exchange[] = []): string {
  const history =
    before.length === 0
      ? []
      : [
          'Earlier in the ask pane, oldest first. Only this pane has seen these; build on them rather than repeat them:',
          '<earlier>',
          ...before.flatMap(one => [`Q: ${one.question}`, `A: ${one.answer}`, '']),
          '</earlier>',
          '',
        ]

  return [
    'A side question from the user, sent through the ask pane. Your answer shows in that pane only: it never enters the main conversation, and the main task does not see it.',
    'Answer the question below. Do not carry on with the main task and do not call tools. Keep it short.',
    'If you suggest prompts the user could send to the main session, write each one ready to send, inside its own <prompt></prompt> tags.',
    '',
    ...history,
    question.trim(),
  ].join('\n')
}

export const SUGGEST = 'Given where this conversation stands, suggest three prompts I could send next.'

// Markdown draws at most 10000 characters.
const MAX = 9000

// Pulls the <prompt> blocks out of a reply. Each one is quoted in place,
// numbered to match its Use button.
export function split(text: string): { answer: string; prompts: string[] } {
  const prompts: string[] = []
  const answer = text.replace(/<prompt>([\s\S]*?)<\/prompt>/g, (_all, inner: string) => {
    const prompt = inner.trim()
    if (prompt === '') return ''
    prompts.push(prompt)
    const lines = prompt.split('\n')
    return `\n> **${prompts.length}.** ${lines.map((line, i) => (i === 0 ? line : `> ${line}`)).join('\n')}\n`
  })
  const tidy = answer.replace(/\n{3,}/g, '\n\n').trim()

  return { answer: tidy.length > MAX ? `${tidy.slice(0, MAX)}…` : tidy, prompts }
}

function clip(text: string, width: number): string {
  const trimmed = text.trim()

  return trimmed.length > width ? `${trimmed.slice(0, Math.max(1, width - 1))}…` : trimmed
}

export function fit(text: string, width: number): string {
  return clip(text.replace(/\s+/g, ' '), width)
}

export function pendingLine(count: number): string | undefined {
  return count === 0 ? undefined : `ask: ${count} thinking…`
}
