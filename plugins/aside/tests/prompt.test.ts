import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import * as p from '../hooks/prompt'

test('a question can lead with flags and keeps its own lines', () => {
  expect(p.parse('')).toEqual({ kind: 'open' })
  expect(p.parse('is this right?')).toEqual({ kind: 'ask', question: 'is this right?' })
  expect(p.parse('-m haiku -e high -t is this\nright?')).toEqual({ kind: 'ask', question: 'is this\nright?', model: 'haiku', effort: 'high', tools: true })
  expect(p.parse('--no-tools why')).toEqual({ kind: 'ask', question: 'why', tools: false })
  expect(p.parse('-m gpt why')).toEqual({ kind: 'error', text: 'No model "gpt": session, fable, opus, sonnet, haiku.' })
  expect(p.parse('-t')).toEqual({ kind: 'error', text: 'Ask a question after the flags.' })
})

test('subcommands are the whole argument, so a question may start with one of their words', () => {
  expect(p.parse('send')).toEqual({ kind: 'send', index: undefined })
  expect(p.parse('edit 3')).toEqual({ kind: 'edit', index: 3 })
  expect(p.parse('clear')).toEqual({ kind: 'clear' })
  expect(p.parse('model sonnet')).toEqual({ kind: 'model', model: 'sonnet' })
  expect(p.parse('tools on')).toEqual({ kind: 'tools', tools: true })
  expect(p.parse('send the email first or the invoice?')).toMatchObject({ kind: 'ask' })
})

test('read-only commands pass and anything that writes or chains does not', () => {
  for (const ok of ['git status', 'git log --oneline -20', 'rg -n foo src | head -20', "sed -n '1,40p' src/a.ts", "find . -name '*.ts'", 'git branch -a', 'ls -la', 'sort file | uniq -c']) {
    expect([ok, p.isReadOnlyCommand(ok)]).toEqual([ok, true])
  }
  for (const bad of [
    'rm -rf build', 'git push', 'git commit -m x', 'echo hi > f', 'cat a; rm b', 'cat a && rm b', 'a || b',
    'cat $(rm x)', 'find . -delete', 'find . -exec rm {} +', 'sed -i s/a/b/ f', "sed -n '1w out' f", 'git branch -D x',
    'git log --output=x', 'sort -o out in', 'uniq in out', 'git config user.name me', 'npm test', 'fd -x rm',
  ]) {
    expect([bad, p.isReadOnlyCommand(bad)]).toEqual([bad, false])
  }
})

test('an aside subagent may read and nothing else', () => {
  expect(p.refusal('Read', { file_path: 'a' })).toBeUndefined()
  expect(p.refusal('Bash', { command: 'git diff' })).toBeUndefined()
  expect(p.refusal('Bash', { command: 'git checkout .' })).toMatch(/read-only/)
  expect(p.refusal('Edit', {})).toBe('An aside only reads: Edit is not one of its tools.')
  expect(p.refusal('mcp__x__write', {})).toMatch(/only reads/)
})

const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const claude = (text: string): SessionMessage => ({
  role: 'assistant',
  text,
  toolUses: [{ tool_use_id: 't', tool: 'Read', input: { file_path: 'a.ts' }, text: 'x'.repeat(2_500) }],
})

test('a message renders as transcript text, a long tool result cut short', () => {
  expect(p.renderMessage(user('hi'))).toBe('## Person\nhi\n')
  expect(p.renderMessage({ role: 'user', text: '', toolUses: [] })).toBe('')
  const drawn = p.renderMessage(claude('Reading it.'))
  expect(drawn.startsWith('## Claude\nReading it.\n[Read] {"file_path":"a.ts"}\nxxx')).toBe(true)
  expect(drawn.endsWith('… (500 more characters)\n')).toBe(true)
})

test('each request reads the stretch the last one wrote and writes the new one', () => {
  const r1 = ['a'.repeat(700), 'b'.repeat(700)]
  const first = p.transcript(r1, 100_000, undefined, 0)
  expect(first).toMatchObject({ stretches: [r1.join('\n')], isFresh: true })
  expect(first.track.anchors).toEqual([2])

  const r2 = [...r1, 'c'.repeat(700)]
  const second = p.transcript(r2, 100_000, first.track, 60_000)
  expect(second.stretches).toEqual([r1.join('\n'), 'c'.repeat(700)])
  expect(second.isFresh).toBe(false)
  expect(second.track.anchors).toEqual([2, 3])
  expect(p.cachedTokens(r2, second.track, 120_000)).toBe(600)
  expect(p.cachedTokens(r2, second.track, 60_000 + 5 * 60_000 + 1)).toBe(0)

  // Nothing new: the same stretches again, all read.
  expect(p.transcript(r2, 100_000, second.track, 90_000).stretches).toEqual(second.stretches)

  // A compaction rewrote the conversation: start over.
  const compacted = ['summary', 'c'.repeat(700)]
  expect(p.transcript(compacted, 100_000, second.track, 100_000)).toMatchObject({ isFresh: true, stretches: [compacted.join('\n')] })
})

test('a transcript keeps the newest messages that fit', () => {
  const r = ['a'.repeat(3_500), 'b'.repeat(3_500), 'c'.repeat(3_500)]
  const t = p.transcript(r, 2_000, undefined, 0)
  expect(t.stretches).toEqual(['b'.repeat(3_500) + '\n' + 'c'.repeat(3_500)])
  expect(t.tokens).toBe(2_000)
})

test('the side thread carries its last answered exchanges, oldest first', () => {
  const ex = (n: number, status: 'done' | 'failed') => ({
    id: String(n), at: n, question: `q${n}`, model: 'Opus 5.5', route: 'fork' as const, tools: false, effort: 'default' as const,
    status, answer: status === 'done' ? `a${n}` : undefined,
  })
  const thread = [ex(1, 'done'), ex(2, 'failed'), ex(3, 'done'), ex(4, 'done')]
  expect(p.threadText(thread, 2)).toBe('Earlier questions in this side thread, oldest first:\n\nQ: q3\nA: a3\n\nQ: q4\nA: a4\n\n')
  expect(p.threadText(thread, 0)).toBe('')
})
