import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Issue } from '../types'
import { BUG_LABELS, DEFAULT_MARKERS, LATER_LABELS, guessMarkers, isBug, isFuture, markerAskOf, markerKey, markerOptionsOf, markerText, markersOf } from '../hooks/markers'
import { chipsOf, matches, summary } from '../hooks/parse'
import { stepsOf } from '../hooks/setup'
import { fakeGitHub, memoryStore, session } from './github'
import type { Raw } from './graph'
import { REFRESH, REPO, band, engineBand, pane } from './ui'

const PANE = pane(120, 80)
const BAND = band(140)
const KEY = `repo:${REPO.root}`
const CHOICES = `choices:${REPO.root}`

const raw = (number: number, labels: string[] = [], type?: string): Raw => ({
  number,
  title: `Issue ${number}`,
  url: '',
  labels: labels.map(name => ({ name })),
  assignees: [],
  body: '',
  updatedAt: '2026-10-05T10:00:00Z',
  ...(type ? { type } : {}),
})
const issue = (number: number, labels: string[] = [], type?: string): Issue => ({
  number,
  title: `Issue ${number}`,
  url: '',
  labels: labels.map(name => ({ name, color: '' })),
  assignees: [],
  checks: [],
  updatedAt: '2026-10-05T10:00:00Z',
  body: '',
  ...(type ? { type } : {}),
})

// GitHub without a project: the repo's labels and issue types as given, every call kept, and a store that starts with
// `choices` under the choices key.
const world = (on: On, issues: Raw[], labels: string[], types: string[] = [], choices?: Record<string, unknown>) => {
  const kept = memoryStore(on, choices ? { [CHOICES]: choices } : {})
  const gh = fakeGitHub(on, { issues, labels, types })
  session(on)
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  engineBand(on)
  // What would change GitHub: a GraphQL mutation, or any gh call that makes or edits a label or an issue.
  const writes = () =>
    gh.ran.filter(call => (call.argv.includes('graphql') && /\bmutation\b/.test(`${call.argv.join(' ')} ${call.stdin ?? ''}`)) || call.argv[1] === 'label' || (call.argv[1] === 'issue' && call.argv[2] !== 'list'))
  return { kept, writes }
}

test('each bug and later name is found in any case, the Bug type when issues use it, and nothing without a name', () => {
  for (const name of BUG_LABELS) {
    expect(guessMarkers({ issues: [], labels: ['enhancement', name.toUpperCase()] })).toEqual({ bug: { label: name.toUpperCase() } })
  }
  for (const name of LATER_LABELS) {
    expect(guessMarkers({ issues: [], labels: [` ${name[0]?.toUpperCase()}${name.slice(1)}`] }).later).toBe(` ${name[0]?.toUpperCase()}${name.slice(1)}`)
  }
  // The list's order settles a repo with several.
  expect(guessMarkers({ issues: [], labels: ['defect', 'type:bug', 'icebox', 'later'] })).toEqual({ bug: { label: 'type:bug' }, later: 'later' })
  // The Bug type: when open issues use it, it beats a label; offered and unused, a label wins; offered alone, it counts.
  expect(guessMarkers({ issues: [issue(1, [], 'Bug')], labels: ['bug'], issueTypes: ['Bug', 'Task'] })).toEqual({ bug: { type: 'Bug' } })
  expect(guessMarkers({ issues: [issue(1, [], 'Task')], labels: ['defect'], issueTypes: ['Bug', 'Task'] })).toEqual({ bug: { label: 'defect' } })
  expect(guessMarkers({ issues: [], labels: [], issueTypes: ['Bug'] })).toEqual({ bug: { type: 'Bug' } })
  // With a project, Later goes by Priority, so no label is guessed for it.
  expect(guessMarkers({ issues: [], labels: ['someday'], project: { id: 'P', number: 1, title: 'P', url: '', status: null, priority: null } })).toEqual({})
  // Without the repo's labels, as on an older board, the guess reads the labels its issues carry.
  expect(guessMarkers({ issues: [issue(1, ['Defect'])] })).toEqual({ bug: { label: 'Defect' } })
  // A repo with none of the names keeps `bug` and `future`.
  expect(guessMarkers({ issues: [], labels: ['enhancement', 'docs'] })).toEqual({})
  expect(markersOf({ issues: [], labels: ['enhancement'] }, {})).toEqual(DEFAULT_MARKERS)
})

test('the markers decide bugs, Later, the badge chip and the count, and only a guess off the old names is asked', () => {
  const defect = { bug: { label: 'defect' }, later: 'someday' }
  const typed = { bug: { type: 'Bug' }, later: 'future' }
  expect(isBug(issue(1, ['Defect']), defect)).toBe(true)
  expect(isBug(issue(1, ['bug']), defect)).toBe(false)
  expect(isBug(issue(1, ['bug']))).toBe(true)
  expect(isBug(issue(1, [], 'bug'), typed)).toBe(true)
  expect(isBug(issue(1, ['bug'], 'Task'), typed)).toBe(false)
  expect(isFuture(issue(1, ['someday']), defect)).toBe(true)
  expect(matches('future', issue(1, ['someday']), null, null, defect)).toBe(true)
  expect(matches('active', issue(1, ['someday']), null, null, defect)).toBe(false)
  expect(matches('bugs', issue(1, ['defect']), null, null, defect)).toBe(true)
  // The bug label is a badge, not a chip; `bug` is an ordinary chip once it isn't the marker.
  expect(chipsOf(issue(1, ['defect', 'bug', 'area:x']), defect).map(one => one.name)).toEqual(['bug'])
  expect(summary([issue(1, ['defect']), issue(2, ['bug'])], [], defect)).toBe('2 issues · 1 bug')

  // `bug` in any case and `future` are what the board went by, so they aren't asked about.
  expect(markerAskOf({ issues: [], labels: ['Bug', 'future'] }, {})).toEqual({})
  const ask = markerAskOf({ issues: [], labels: ['defect', 'someday'] }, {})
  expect(markerText(ask)).toBe('Bugs: the label defect · Later: the label someday')
  expect(markerKey(ask)).toBe('labels:bug=defect,later=someday')
  // A part the person chose isn't asked again.
  expect(markerAskOf({ issues: [], labels: ['defect', 'someday'] }, { bug: { label: 'defect' } })).toEqual({ later: 'someday' })
  expect(markerText({ bug: { type: 'Bug' } })).toBe('Bugs: the Bug issue type')

  // Setup doesn't make a `bug` label in a repo that marks bugs with one of the names.
  const facts = { repo: { id: 'R', name: 'astrosteveo/void-sector', ownerId: 'O', hasIssues: true, permission: 'ADMIN' }, projects: [], issues: [], suggested: [], hasTemplate: true }
  expect(stepsOf({ ...facts, labels: ['defect'] }, null, '').some(step => step.id === 'bug')).toBe(false)
  expect(stepsOf({ ...facts, labels: ['enhancement'] }, null, '').some(step => step.id === 'bug')).toBe(true)
})

test('/issues labels keeps offering a saved marker the repo no longer has, and leaves out the area labels', () => {
  const repo = { issues: [], labels: ['enhancement', 'Bug', 'area:ui'], issueTypes: ['Task'] }
  // The saved Bugs and Later labels are gone from the repo, so they are added back, sorted with the rest.
  expect(markerOptionsOf(repo, { bug: { label: 'defect' }, later: 'someday' })).toEqual({ types: ['Task'], labels: ['Bug', 'defect', 'enhancement', 'someday'] })
  // One the repo still has, in another case, isn't added twice.
  expect(markerOptionsOf(repo, { bug: { label: 'bug' }, later: 'someday' }).labels).toEqual(['Bug', 'enhancement', 'someday'])
  // A saved issue type the repo lost stays among the types.
  expect(markerOptionsOf(repo, { bug: { type: 'Bug' }, later: 'someday' })).toEqual({ types: ['Task', 'Bug'], labels: ['Bug', 'enhancement', 'someday'] })
  // Before the board read the repo's labels, the ones on its open issues are offered.
  expect(markerOptionsOf({ issues: [issue(1, ['wontfix', 'area:net'])] }, { bug: { label: 'defect' }, later: 'future' }).labels).toEqual(['defect', 'future', 'wontfix'])
})

test('/issues labels shows a saved Bugs label the repo lost as the pick, so Save keeps it', async ($, on) => {
  const { kept } = world(on, [raw(1, ['enhancement'])], ['enhancement', 'someday'], [], { markers: { bug: { label: 'kind:bug' }, later: 'someday' } })
  await $.command.run(REFRESH)
  await $.command.run({ ...REFRESH, args: 'labels' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'labels-bug-kind:bug' })).toMatchObject({ props: { variant: 'primary' } })
  await ui.press({ key: 'labels-save' })
  expect((kept.get(CHOICES) as Record<string, unknown>).markers).toEqual({ bug: { label: 'kind:bug' }, later: 'someday' })
  await ui.unmount()
})

test('a guessed label shows once in the band and /issues check, and Looks right saves it locally without writing to GitHub', async ($, on) => {
  const { kept, writes } = world(on, [raw(1, ['defect']), raw(2, ['someday']), raw(3, ['bug report'])], ['bug report', 'defect', 'someday', 'area:board'])
  // `bug report` comes before `defect` in the names the board tries.
  expect((await $.command.run(REFRESH)).text).toBe('Refreshed: 3 issues · 1 bug.')
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'filter-bugs' })).toMatchObject({ text: 'Bugs 1' })
  expect(await pane.find({ key: 'filter-future' })).toMatchObject({ text: 'Future 1' })
  expect(await pane.find({ key: 'filter-active' })).toMatchObject({ text: 'Active 2' })

  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: 'Bugs: the label bug report · Later: the label someday' })).toBeDefined()
  expect((await $.command.run({ ...REFRESH, args: 'check' })).text).toContain(
    'The board guessed which labels Bugs and Later go by. Bugs: the label bug report · Later: the label someday. Press Looks right in the band to keep it, or run /issues labels to change it.',
  )

  await band.press({ key: 'labels-yes' })
  // Saved in the person's own choices, never in the shared repo entry.
  expect((kept.get(CHOICES) as Record<string, unknown>).markers).toEqual({ bug: { label: 'bug report' }, later: 'someday' })
  expect((kept.get(KEY) as Record<string, unknown> | undefined)?.markers).toBeUndefined()
  expect(await band.find({ key: 'labels-yes' })).toBeUndefined()
  expect((await $.command.run({ ...REFRESH, args: 'check' })).text).not.toContain('guessed which labels')
  await band.unmount()

  // It stays saved: the next read goes by it, and doesn't ask again.
  await $.command.run(REFRESH)
  const again = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await again.find({ key: 'labels-yes' })).toBeUndefined()
  await again.unmount()
  expect(await pane.find({ key: 'filter-bugs' })).toMatchObject({ text: 'Bugs 1' })
  await pane.unmount()
  expect(writes()).toEqual([])
})

test('Change opens /issues labels, the guess goes, and Save keeps the picks here and moves the tabs', async ($, on) => {
  const { kept, writes } = world(on, [raw(1, ['defect']), raw(2, ['someday']), raw(3, ['enhancement']), raw(4, ['icebox'])], ['defect', 'enhancement', 'icebox', 'someday', 'area:board'])
  await $.command.run(REFRESH)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  await band.press({ key: 'labels-change' })
  expect(await band.find({ key: 'labels-yes' })).toBeUndefined()
  await band.unmount()

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'labels-card' })).toBeDefined()
  // It starts from the guess, and offers the repo's labels but the area ones.
  expect(await ui.find({ key: 'labels-bug-defect' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'labels-later-someday' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'labels-bug-area:board' })).toBeUndefined()
  await ui.press({ key: 'labels-bug-enhancement' })
  await ui.press({ key: 'labels-later-icebox' })
  await ui.press({ key: 'labels-save' })
  expect((kept.get(CHOICES) as Record<string, unknown>).markers).toEqual({ bug: { label: 'enhancement' }, later: 'icebox' })
  expect(await ui.find({ key: 'labels-card' })).toBeUndefined()
  // Bugs is #3 now, and Later #4.
  expect(await ui.find({ key: 'filter-bugs' })).toMatchObject({ text: 'Bugs 1' })
  expect(await ui.find({ key: 'filter-future' })).toMatchObject({ text: 'Future 1' })
  await ui.press({ key: 'filter-future' })
  expect(await ui.find({ text: /Issue 4/ })).toBeDefined()
  expect(await ui.find({ text: /Issue 2/ })).toBeUndefined()

  // /issues labels opens it again on the saved picks; Esc steps back and saves nothing.
  expect((await $.command.run({ ...REFRESH, args: 'labels' })).text).toBe(
    'Which label or issue type Bugs goes by, and which label Later does, shows at the top of the issues pane. Save keeps it here, and nothing changes on GitHub.',
  )
  expect(await ui.find({ key: 'labels-bug-enhancement' })).toMatchObject({ props: { variant: 'primary' } })
  await ui.press({ key: 'labels-cancel' })
  expect(await ui.find({ key: 'labels-card' })).toBeUndefined()
  await ui.unmount()
  expect(writes()).toEqual([])
})

test('a saved choice wins over the guess, and the Bug issue type marks bugs where issues use it', async ($, on) => {
  world(on, [raw(1, ['kind:bug']), raw(2, ['defect']), raw(3, [], 'Bug')], ['defect', 'kind:bug'], ['Bug', 'Task'], { markers: { bug: { label: 'kind:bug' } } })
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'filter-bugs' })).toMatchObject({ text: 'Bugs 1' })
  await ui.press({ key: 'filter-bugs' })
  expect(await ui.find({ text: /Issue 1/ })).toBeDefined()
  expect(await ui.find({ text: /Issue 3/ })).toBeUndefined()
  // The person chose, so the band asks nothing.
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'labels-yes' })).toBeUndefined()
  await band.unmount()
  await ui.unmount()
})

test('the Bug issue type is guessed when open issues use it, and the bug count follows it', async ($, on) => {
  world(on, [raw(1, [], 'Bug'), raw(2, ['bug']), raw(3, [], 'Bug')], ['bug'], ['Bug', 'Task'])
  expect((await $.command.run(REFRESH)).text).toBe('Refreshed: 3 issues · 2 bugs.')
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: 'Bugs: the Bug issue type' })).toBeDefined()
  await band.unmount()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'filter-bugs' })).toMatchObject({ text: 'Bugs 2' })
  await ui.unmount()
})

test('a repo with none of the names keeps bug and future, and the band asks nothing', async ($, on) => {
  const { kept } = world(on, [raw(1, ['enhancement']), raw(2, ['docs'])], ['enhancement', 'docs'])
  expect((await $.command.run(REFRESH)).text).toBe('Refreshed: 2 issues.')
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'labels-yes' })).toBeUndefined()
  await band.unmount()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'filter-bugs' })).toMatchObject({ text: 'Bugs 0' })
  expect(await ui.find({ key: 'filter-active' })).toMatchObject({ text: 'Active 2' })
  await ui.unmount()
  expect((kept.get(CHOICES) as Record<string, unknown> | undefined)?.markers).toBeUndefined()
})
