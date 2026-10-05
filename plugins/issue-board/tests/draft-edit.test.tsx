import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { draftBody, draftLines } from '../hooks/parse'
import { graphPage, isIssuesQuery } from './graph'

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const RUN = { command: 'issues', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// The repo's labels. `documentation` is on no open issue, so only the repo's own list offers it.
const REPO_LABELS = ['area:saves', 'bug', 'documentation', 'enhancement']

// GitHub for void-sector without a project: the issues the board reads, the repo's labels, and each issue created.
const github = (on: On) => {
  const state = { created: [] as { argv: string[]; stdin?: string }[] }
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = [...e.argv]
    if (argv[0] === 'git') return answer('main\n')
    if (isIssuesQuery(argv)) {
      return answer(
        graphPage([
          { number: 315, title: 'Lay Kessik out for play', labels: [{ name: 'enhancement' }, { name: 'area:saves' }], body: '- [ ] Layout', updatedAt: '2026-10-05T00:00:00Z' },
          { number: 289, title: "Asteroids didn't draw", labels: [{ name: 'bug' }], body: null, updatedAt: '2026-10-05T00:00:00Z' },
        ]),
      )
    }
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (argv[1] === 'label' && argv[2] === 'list') return answer(JSON.stringify(REPO_LABELS.map(name => ({ name }))))
    if (argv[1] === 'api' && argv[2]?.startsWith('repos/')) return answer('[]')
    if (argv[1] === 'issue' && argv[2] === 'create') {
      state.created.push({ argv: argv.slice(1), ...(e.init?.stdin !== undefined ? { stdin: e.init.stdin } : {}) })
      return answer(`https://github.com/astrosteveo/void-sector/issues/${339 + state.created.length}\n`)
    }
    if (argv.includes('closed') || argv.includes('merged')) return answer('[]')
    return answer(argv[1] === 'api' ? 'astrosteveo\n' : '[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  return state
}

// Claude drafts this from the conversation.
const answers = (on: On, draft: unknown) =>
  on('model.fork', async () => ({ value: { isAnswered: true, text: JSON.stringify(draft), usage: USAGE } }))

const BODY = 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads'

test("a draft's body becomes a field a line and back, and lines left empty drop out", () => {
  expect(draftLines(BODY)).toEqual(['Loading loses it.', null, '## Acceptance', '- [ ] Hangar loads'])
  expect(draftBody(draftLines(BODY))).toBe(BODY)
  expect(draftLines('One\r\nTwo')).toEqual(['One', 'Two'])
  // An empty body still has a field to write in.
  expect(draftLines('')).toEqual([''])
  expect(draftBody([''])).toBe('')
  // A line added under another, and one emptied: the blank lines around it become one.
  expect(draftBody(['Why.', 'And more.', null, '', null, '- [ ] Done  '])).toBe('Why.\nAnd more.\n\n- [ ] Done')
  // Emptied at the start and the end: no blank lines left there.
  expect(draftBody(['', null, 'Middle', null, ' '])).toBe('Middle')
})

test('Edit changes the draft card: Save shows the new title, body and labels, Cancel keeps it, and Create files what it shows', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  const gh = github(on)
  answers(on, { title: 'Saves drop the hangar', body: BODY, labels: ['enhancement'] })
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.command.run({ ...RUN, args: 'new the hangar vanishing on load' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })

  // Edit is on the card next to Create, with nothing to open first.
  expect(await ui.find({ key: 'draft-edit' })).toMatchObject({ text: '✎ Edit', props: { hotkey: 'e' } })
  await ui.press({ key: 'draft-edit' })
  expect(await ui.find({ text: /^New issue · draft · editing$/ })).toBeDefined()
  expect(await ui.find({ key: 'draft-title' })).toMatchObject({ type: 'Input', props: { value: 'Saves drop the hangar' } })
  expect((await ui.findAll({ type: 'Input' })).filter(one => one.key?.startsWith('draft-line-')).map(one => [one.key, one.props.value])).toEqual([
    ['draft-line-0', 'Loading loses it.'],
    ['draft-line-2', '## Acceptance'],
    ['draft-line-3', '- [ ] Hangar loads'],
  ])
  // The labels to pick from are the repo's, as gh lists them, and the draft's are set.
  const labels = (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('draft-label-'))
  expect(labels.map(one => one.text)).toEqual(REPO_LABELS)
  expect(labels.filter(one => one.props.variant === 'primary').map(one => one.text)).toEqual(['enhancement'])
  // While the editor is open, Create and Discard wait.
  expect(await ui.find({ key: 'draft-file' })).toBeUndefined()
  expect(await ui.find({ key: 'draft-discard' })).toBeUndefined()

  // A title left empty can't be saved: the editor stays open and says why.
  await ui.input({ key: 'draft-title', text: '   ', kind: 'change' })
  expect(await ui.find({ text: /^The title can't be empty\./ })).toBeDefined()
  await ui.press({ key: 'draft-save' })
  expect(await ui.find({ key: 'draft-title' })).toBeDefined()
  await ui.input({ key: 'draft-title', text: '', kind: 'submit' })
  expect(await ui.find({ key: 'draft-title' })).toBeDefined()

  await ui.input({ key: 'draft-title', text: ' Saves lose the hangar on load ', kind: 'change' })
  await ui.input({ key: 'draft-line-0', text: 'Loading a save loses the hangar.', kind: 'change' })
  // Enter in a line adds an empty one under it. The line keeps its text, in a fresh field, since a field can empty
  // itself on Enter. The focus moving to the new line is the engine's to do, which a test can't see.
  await ui.input({ key: 'draft-line-3', text: '- [ ] Hangar loads', kind: 'submit' })
  expect((await ui.findAll({ type: 'Input' })).filter(one => one.key?.startsWith('draft-line-')).map(one => [one.key, one.props.value])).toEqual([
    ['draft-line-0', 'Loading a save loses the hangar.'],
    ['draft-line-2', '## Acceptance'],
    ['draft-line-4', '- [ ] Hangar loads'],
    ['draft-line-5', ''],
  ])
  await ui.input({ key: 'draft-line-5', text: '- [ ] Old saves still load', kind: 'change' })
  await ui.press({ key: 'draft-label-enhancement' })
  await ui.press({ key: 'draft-label-bug' })
  await ui.press({ key: 'draft-label-documentation' })
  await ui.press({ key: 'draft-save' })

  const saved = 'Loading a save loses the hangar.\n\n## Acceptance\n- [ ] Hangar loads\n- [ ] Old saves still load'
  expect(await ui.find({ key: 'draft-title' })).toBeUndefined()
  expect(await ui.find({ text: /^New issue · draft$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Saves lose the hangar on load$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^bug · documentation$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: saved })).toBeDefined()

  // Cancel drops what was changed since: the card stays as saved.
  await ui.press({ key: 'draft-edit' })
  expect(await ui.find({ key: 'draft-title' })).toMatchObject({ props: { value: 'Saves lose the hangar on load' } })
  await ui.input({ key: 'draft-title', text: 'Something else', kind: 'change' })
  await ui.input({ key: 'draft-line-0', text: '', kind: 'change' })
  await ui.press({ key: 'draft-label-bug' })
  await ui.press({ key: 'draft-cancel' })
  expect(await ui.find({ key: 'draft-title' })).toBeUndefined()
  expect(await ui.find({ text: /Something else/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Saves lose the hangar on load$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^bug · documentation$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: saved })).toBeDefined()

  // Create files the card as edited, not as Claude drafted it.
  await ui.press({ key: 'draft-file' })
  expect(gh.created).toEqual([
    {
      argv: ['issue', 'create', '--title', 'Saves lose the hangar on load', '--body-file', '-', '--label', 'bug', '--label', 'documentation'],
      stdin: saved,
    },
  ])
  expect(await ui.find({ text: /New issue · draft/ })).toBeUndefined()
  await ui.unmount()
})

test("an epic's edited parent is what's created, with its sub-issues under it", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  const gh = github(on)
  answers(on, {
    title: 'Saves survive a crash',
    body: 'Why.',
    labels: [],
    children: [
      { title: 'Write saves atomically', body: '- [ ] Temp file then rename', labels: [] },
      { title: 'Check saves on load', body: '- [ ] Checksums', labels: [] },
    ],
  })
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.command.run({ ...RUN, args: 'new epic saves that survive a crash' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })

  await ui.press({ key: 'draft-edit' })
  expect(await ui.find({ text: /^New epic · draft · 2 sub-issues · editing$/ })).toBeDefined()
  // The sub-issues still show under the editor.
  expect(await ui.find({ text: /^Check saves on load$/ })).toBeDefined()
  await ui.input({ key: 'draft-title', text: 'Saves survive a crash or a power cut', kind: 'change' })
  await ui.press({ key: 'draft-label-bug' })
  // Enter in the title saves.
  await ui.input({ key: 'draft-title', text: 'Saves survive a crash or a power cut', kind: 'submit' })
  expect(await ui.find({ key: 'draft-title' })).toBeUndefined()

  await ui.press({ key: 'draft-file' })
  await clock.settle()
  expect(gh.created.map(one => [one.argv[3], one.argv.includes('--label') ? one.argv[one.argv.indexOf('--label') + 1] : null, one.argv.includes('--parent') ? one.argv[one.argv.indexOf('--parent') + 1] : null])).toEqual([
    ['Saves survive a crash or a power cut', 'bug', null],
    ['Write saves atomically', null, '340'],
    ['Check saves on load', null, '340'],
  ])
  await ui.unmount()
})

test('a surface with no text field edits only the labels', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  const gh = github(on)
  answers(on, { title: 'Saves drop the hangar', body: BODY, labels: [] })
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.command.run({ ...RUN, args: 'new the hangar' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'mobile', ...PANE })

  await ui.press({ key: 'draft-edit' })
  expect(await ui.find({ text: /only the labels can change here/ })).toBeDefined()
  await ui.press({ key: 'draft-label-area:saves' })
  await ui.press({ key: 'draft-save' })
  await ui.press({ key: 'draft-file' })
  expect(gh.created[0]?.argv).toEqual(['issue', 'create', '--title', 'Saves drop the hangar', '--body-file', '-', '--label', 'area:saves'])
  expect(gh.created[0]?.stdin).toBe(BODY)
  await ui.unmount()
})

test('the field with the focus shows the whole of a line too long for it', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  github(on)
  // Beneath the board, the engine moves the ring.
  on('ui.focus', async () => ({}))
  const long = `Loading a save loses the hangar, ${'and everything parked in it, '.repeat(6)}every time.`
  answers(on, { title: 'Saves drop the hangar', body: `${long}\n\n## Acceptance\n- [ ] Hangar loads`, labels: [] })
  await $.command.run({ ...RUN, args: 'refresh' })
  await $.command.run({ ...RUN, args: 'new the hangar' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'draft-edit' })
  const focus = async (element: string) => {
    await $.ui.focus({ component: 'Pane', requestId: 'issue-board', plugin: 'issue-board', element, origin: { kind: 'person' } })
    await clock.settle()
  }
  // The text drawn beside the fields, as against in them.
  const shown = async (text: string) => (await ui.findAll({ type: 'Text', text })).filter(one => one.text === text).length

  expect(await shown(long)).toBe(0)
  await focus('draft-line-0')
  expect(await shown(long)).toBe(1)
  // A short line fits its field; the long one, without the focus, shows only in its field.
  await focus('draft-line-3')
  expect(await shown(long)).toBe(0)
  expect(await shown('- [ ] Hangar loads')).toBe(0)
  await ui.unmount()
})
