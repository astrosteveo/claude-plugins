import { describe, expect, mock, test } from 'claude-code/testing'
import type { ClientKeyEvent, PromptEditInput, SessionMessage } from 'claude-code'

import { anchorOf, buildPrompt, continuationOf, editGhost, isPredictable } from '../hooks/register'
import type { Ghost } from '../hooks/register'

// The kit raises no `prompt.edit` (keys come from the terminal), so the edit
// logic is tested through `editGhost`, the decision the hook acts on.

const GHOST: Ghost = { base: 'handle', text: ' the null token case' }
const FULL = GHOST.base + GHOST.text

function edit(inputText: string, opts: { key?: ClientKeyEvent; deleted?: number; text?: string } = {}): PromptEditInput {
  const text = opts.text ?? FULL
  const at = text.length
  return {
    origin: { kind: 'composer' },
    ...(opts.key ? { key: opts.key } : {}),
    text,
    cursor: at,
    start: at - (opts.deleted ?? 0),
    end: at,
    inputText,
  }
}

describe('editGhost', () => {
  test('Tab, → and End take the ghost', async () => {
    for (const key of ['tab', 'right', 'end']) {
      expect(editGhost(GHOST, edit('', { key: { key } }))).toEqual({ kind: 'accept' })
    }
  })

  test('a modified accept key is no accept', async () => {
    expect(editGhost(GHOST, edit('', { key: { key: 'right', ctrl: true } }))).toEqual({ kind: 'dismiss' })
  })

  test('Backspace and cursor moves take the ghost down only', async () => {
    expect(editGhost(GHOST, edit('', { key: { key: 'backspace' }, deleted: 1 }))).toEqual({ kind: 'dismiss' })
    expect(editGhost(GHOST, edit('', { key: { key: 'left' } }))).toEqual({ kind: 'dismiss' })
  })

  test('typing what the ghost says keeps the rest of it', async () => {
    expect(editGhost(GHOST, edit(' th', { key: undefined }))).toEqual({
      kind: 'type-through',
      ghost: { base: 'handle th', text: 'e null token case' },
    })
    expect(editGhost(GHOST, edit(' the null token case'))).toEqual({ kind: 'accept' })
  })

  test('typing something else lands at the end of what was typed', async () => {
    const step = editGhost(GHOST, edit('d', { key: { key: 'd' } }))
    expect(step.kind).toBe('edit')
    if (step.kind !== 'edit') return
    expect(step.edit).toMatchObject({ text: 'handle', cursor: 6, start: 6, end: 6, inputText: 'd' })
  })

  test('a box that no longer holds the ghost leaves the edit alone', async () => {
    expect(editGhost(GHOST, edit('x', { text: 'something else' }))).toEqual({ kind: 'stale' })
  })
})

describe('the model call', () => {
  const messages: SessionMessage[] = [
    { role: 'user', text: 'the login page 500s when the session cookie expires', toolUses: [] },
    { role: 'user', text: '', toolUses: [] },
    { role: 'assistant', text: 'Found it: refreshSession() throws on a null token.', toolUses: [] },
  ]

  test('the prompt carries the conversation, the draft and the anchor', async () => {
    const prompt = buildPrompt('fix refresh', messages)
    expect(prompt).toContain('Developer: the login page 500s')
    expect(prompt).toContain('Claude: Found it: refreshSession() throws')
    expect(prompt).toContain('<unfinished_message>\nfix refresh\n</unfinished_message>')
    expect(prompt).toContain('Begin your reply with exactly: refresh')
    expect(buildPrompt('fix the ', [])).toContain('begin your reply directly with the next word')
  })

  test('the reply becomes the ghost after the anchor', async () => {
    expect(anchorOf('fix the au')).toBe('au')
    expect(anchorOf('fix the ')).toBe('')
    expect(continuationOf('fix the au', 'auth bug')).toBe('th bug')
    expect(continuationOf('fix the ', '  auth bug\nand more')).toBe('auth bug')
    expect(continuationOf('fix the au', 'the auth bug')).toBeUndefined()
    expect(continuationOf('fix the au', 'au')).toBeUndefined()
    const long = continuationOf('a', 'a' + ' word'.repeat(40))
    expect(long?.length).toBeLessThanOrEqual(120)
    expect(long?.endsWith('word')).toBe(true)
  })

  test('only prose at the end of the box is predicted', async () => {
    expect(isPredictable('fix it', 6)).toBe(true)
    expect(isPredictable('fix it', 3)).toBe(false)
    expect(isPredictable('ok', 2)).toBe(false)
    expect(isPredictable('/model opus', 11)).toBe(false)
    expect(isPredictable('!ls -la', 7)).toBe(false)
  })
})

const TOGGLE = {
  command: 'type-ahead',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

test('/type-ahead turns predictions off and back on', async ($, on) => {
  mock.store(on)
  expect((await $.command.run(TOGGLE)).text).toBe('Type-ahead is off.')
  expect((await $.command.run(TOGGLE)).text).toContain('Type-ahead is on')
})

test('a prompt with no ghost in it is sent as typed', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.prompt.submit({ text: 'run the tests', wait: false, origin: { kind: 'composer' } })
  expect(sent).toEqual(['run the tests'])
})
