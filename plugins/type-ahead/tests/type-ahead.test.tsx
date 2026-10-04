import { describe, expect, mock, test } from 'claude-code/testing'
import type { ClientKeyEvent, PromptEditInput, SessionMessage } from 'claude-code'

import { anchorOf, buildPrompt, continuationOf, editGhost, isPredictable, narrow, optionsOf, rowLabel, step } from '../hooks/register'
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

  test('alt+→ and ctrl+→ take the ghost; shift+→ only takes it down', async () => {
    expect(editGhost(GHOST, edit('', { key: { key: 'right', meta: true } }))).toEqual({ kind: 'accept' })
    expect(editGhost(GHOST, edit('', { key: { key: 'right', ctrl: true } }))).toEqual({ kind: 'accept' })
    expect(editGhost(GHOST, edit('', { key: { key: 'right', shift: true } }))).toEqual({ kind: 'dismiss' })
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
    expect(prompt).toContain('Begin each line with exactly: refresh')
    expect(buildPrompt('fix the ', [])).toContain('begin each line directly with the next word')
  })

  test('each line of the reply is one prediction, three at most, no repeats', async () => {
    const reply = 'refreshSession to return null\n2. refreshSession tests\n- refresh token handling\nrefreshSession to return null\nrefresh the cache'
    expect(optionsOf('fix refresh', reply)).toEqual(['Session to return null', 'Session tests', ' token handling'])
    expect(optionsOf('fix refresh', 'nothing useful\n\n')).toEqual([])
  })

  test('the reply becomes the ghost after the anchor', async () => {
    expect(anchorOf('fix the au')).toBe('au')
    expect(anchorOf('fix the ')).toBe('')
    expect(continuationOf('fix the au', 'auth bug')).toBe('th bug')
    expect(continuationOf('fix the ', '  auth bug\nand more')).toBe('auth bug')
    expect(continuationOf('fix the au', 'the auth bug')).toBeUndefined()
    expect(continuationOf('fix the au', 'au')).toBeUndefined()
    // A reply that restates the whole draft is cut back to what follows it.
    expect(continuationOf('hello this is ', 'hello this is go, read the trace')).toBe('go, read the trace')
    expect(continuationOf('fix the au', 'fix the auth bug')).toBe('th bug')
    expect(continuationOf('hello this is ', 'hello this is')).toBeUndefined()
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

describe('the band', () => {
  const p = { base: 'handle', options: [' the null token', ' the expired cookie', ' a retry'], selected: 1 }

  test('typing narrows the predictions to those that still fit, keeping the selected one', async () => {
    expect(narrow(p, ' the ')).toEqual({ base: 'handle the ', options: ['null token', 'expired cookie'], selected: 1 })
    expect(narrow({ ...p, selected: 2 }, ' a')).toEqual({ base: 'handle a', options: [' retry'], selected: 0 })
  })

  test('alt+↑/↓ step through the predictions, wrapping at either end', async () => {
    expect(step(p, 1)).toBe(2)
    expect(step({ ...p, selected: 2 }, 1)).toBe(0)
    expect(step({ ...p, selected: 0 }, -1)).toBe(2)
    expect(step({ ...p, options: [] }, 1)).toBe(0)
  })

  test('each row marks the selected prediction and fits the band', async () => {
    expect(rowLabel(p, 1, 80)).toBe('▸ handle the expired cookie')
    expect(rowLabel(p, 0, 80)).toBe('  handle the null token')
    expect(rowLabel(p, 1, 12)).toBe('▸ handle th…')
    const long = { ...p, base: 'please look at the session refresh code and handle' }
    expect(rowLabel(long, 1, 200)).toBe('▸ … refresh code and handle the expired cookie')
  })

  test('with no predictions the band is left to the plugins beneath', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>beneath</Text>
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({
        plugin: 'type-ahead',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
      })
      expect(await band.find({ type: 'Text', text: 'beneath' })).toBeDefined()
      expect(await band.find({ type: 'Button' })).toBeUndefined()
      await band.unmount()
    }
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
