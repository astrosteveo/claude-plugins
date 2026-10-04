import { describe, expect, mock, test } from 'claude-code/testing'
import type { ClientKeyEvent, PromptEditInput, SessionMessage } from 'claude-code'

import { alternativesOf, anchorOf, buildNextPrompt, buildPrompt, continuationOf, editGhost, isPredictable, narrow, optionsOf, rowLabel, step } from '../hooks/register'
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
    {
      role: 'user',
      text: '<system-reminder>\nToday is Thursday.\n</system-reminder>\nthe login page 500s when the session cookie expires',
      toolUses: [],
    },
    { role: 'user', text: '<command-name>/clear</command-name>', toolUses: [] },
    {
      role: 'assistant',
      text: 'Let me look.',
      toolUses: [{ tool_use_id: 't1', tool: 'Read', input: { file_path: 'src/auth/session.ts' } }],
    },
    { role: 'user', text: '', toolUses: [] },
    {
      role: 'assistant',
      text: 'Found it: refreshSession() throws on a null token.',
      toolUses: [{ tool_use_id: 't2', tool: 'Bash', input: { command: 'npm test -- session\nmore' } }],
    },
  ]

  test('the prompt carries the conversation, the draft and the anchor', async () => {
    const prompt = buildPrompt('please fix refresh', messages)
    expect(prompt).toContain('Developer: the login page 500s')
    expect(prompt).toContain('<draft>\nplease fix refresh\n</draft>')
    expect(prompt).toContain('Anchor: please fix refresh\nIts last word may be unfinished')
    expect(buildPrompt('so we fix the ', [])).toContain('Anchor: we fix the\nThe draft ends with a space')
  })

  test("Claude Code's markup is not the developer's, and a Claude turn names the tools it ran", async () => {
    const prompt = buildPrompt('fix refresh', messages)
    expect(prompt).not.toContain('system-reminder')
    expect(prompt).not.toContain('/clear')
    expect(prompt).toContain(
      'Claude: [ran Read src/auth/session.ts · Bash npm test -- session] Let me look.\n\nFound it: refreshSession() throws',
    )
  })

  test('each line of the reply is one prediction, three at most, no repeats', async () => {
    const reply = 'fix refreshSession to return null\n2. fix refreshSession tests\n- fix refresh token handling\nfix refreshSession to return null\nfix refresh the cache'
    expect(optionsOf('fix refresh', reply)).toEqual(['Session to return null', 'Session tests', ' token handling'])
    expect(optionsOf('fix refresh', '"fix refresh tokens"')).toEqual([' tokens'])
    expect(optionsOf('fix refresh', 'nothing useful\n\n')).toEqual([])
  })

  test('a reply to the draft, not a continuation of it, is no prediction', async () => {
    const reply = 'Your message got cut off! What next?\n\nDo you want to:\n- Skip it and add a TODO?'
    expect(optionsOf('skip it for now and ', reply)).toEqual([])
  })

  test('the reply becomes the ghost after the anchor', async () => {
    expect(anchorOf('please fix the au')).toBe('fix the au')
    expect(anchorOf('please fix the ')).toBe('please fix the')
    expect(anchorOf('first line\nok')).toBe('ok')
    expect(continuationOf('fix the au', 'fix the auth bug')).toBe('th bug')
    expect(continuationOf('fix the ', '  fix the auth bug\nand more')).toBe('auth bug')
    expect(continuationOf('fix the ', 'auth bug')).toBeUndefined()
    // After a space the next word stands alone.
    expect(continuationOf('fix the ', 'fix theme colors')).toBeUndefined()
    expect(continuationOf('fix the au', 'the auth bug')).toBeUndefined()
    expect(continuationOf('fix the au', 'fix the au')).toBeUndefined()
    expect(continuationOf('fix the au', 'fix the au.')).toBeUndefined()
    // A reply that restates the whole draft is cut back to what follows it.
    expect(continuationOf('ok so hello this is ', 'ok so hello this is go, read the trace')).toBe('go, read the trace')
    expect(continuationOf('please fix the au', 'please fix the auth bug')).toBe('th bug')
    expect(continuationOf('hello this is ', 'hello this is')).toBeUndefined()
    const long = continuationOf('a', 'a' + ' word'.repeat(40))
    expect(long?.length).toBeLessThanOrEqual(120)
    expect(long?.endsWith('word')).toBe(true)
  })

  test('only unfinished prose at the end of the box is predicted', async () => {
    expect(isPredictable('fix it', 6)).toBe(true)
    expect(isPredictable('fix it', 3)).toBe(false)
    expect(isPredictable('ok', 2)).toBe(false)
    expect(isPredictable('/model opus', 11)).toBe(false)
    expect(isPredictable('!ls -la', 7)).toBe(false)
    expect(isPredictable('looks good. ', 12)).toBe(false)
    expect(isPredictable('why is it slow?', 15)).toBe(false)
  })
})

describe('next prompts in an empty box', () => {
  const messages: SessionMessage[] = [
    { role: 'user', text: 'add a --dry-run flag to the deploy script', toolUses: [] },
    { role: 'assistant', text: 'Done: scripts/deploy.sh now takes --dry-run.', toolUses: [] },
  ]

  test("the prompt carries the conversation and Claude Code's guess", async () => {
    const prompt = buildNextPrompt('run it with --dry-run', messages)
    expect(prompt).toContain('Claude: Done: scripts/deploy.sh now takes --dry-run.')
    expect(prompt).toContain("Claude Code's guess at the developer's next message: run it with --dry-run")
  })

  test("the reply's dash lines become the alternatives, the guess and repeats left out", async () => {
    const reply = 'Here are two:\n- add a test for it\n- Run it with --dry-run\n- "commit it"\n- add a test for it\n- also:'
    expect(alternativesOf('run it with --dry-run', reply)).toEqual(['add a test for it', 'commit it'])
    expect(alternativesOf('run it', 'Sure! I would suggest testing it.')).toEqual([])
    expect(alternativesOf('run it', '- ' + 'word '.repeat(30))).toEqual([])
  })

  test("Claude Code's suggestion goes through as it was proposed", async ($, on) => {
    const proposed: string[] = []
    on('prompt.suggest', (_$, e) => {
      proposed.push(e.text)
      return { isShown: false }
    })
    expect(await $.prompt.suggest({ text: 'run the tests' })).toEqual({ isShown: false })
    expect(proposed).toEqual(['run the tests'])
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

  test('next prompts in an empty box are listed whole', async () => {
    expect(rowLabel({ base: '', options: ['run the tests', 'commit it'], selected: 1 }, 1, 80)).toBe('▸ commit it')
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
