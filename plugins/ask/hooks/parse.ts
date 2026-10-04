// The question the fork reads after the session's own transcript.
export function framed(question: string): string {
  return [
    'A side question from the user, sent through the ask pane. Your answer shows in that pane only: it never enters the main conversation, and the main task does not see it.',
    'Answer the question below. Do not carry on with the main task and do not call tools. Keep it short.',
    'If you suggest prompts the user could send to the main session, write each one ready to send, inside its own <prompt></prompt> tags.',
    '',
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

export function fit(text: string, width: number): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > width ? `${line.slice(0, Math.max(1, width - 1))}…` : line
}

export function pendingLine(count: number): string | undefined {
  return count === 0 ? undefined : `ask: ${count} thinking…`
}
