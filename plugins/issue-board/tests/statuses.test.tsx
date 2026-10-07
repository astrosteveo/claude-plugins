import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Project, Roles } from '../types'
import { COMMON_NAMES, ROLE_ORDER, guessOf, guessText, roleOf, rolesByName, rolesFor } from '../hooks/project'
import { fakeGitHub, memoryStore, session } from './github'
import { PROJECT } from './graph'
import { REFRESH, REPO, band, pane } from './ui'

const PANE = pane(120, 80)
const BAND = band(140)
const KEY = `repo:${REPO.root}`
const CHOICES = `choices:${REPO.root}`
const GUESS = 'Status: Todo is Ready, Doing is In progress, Shipped is Done'

const options = (...names: string[]) => names.map((name, index) => ({ id: `S${index}`, name }))
const project = (names: string[], roles?: Roles, guessed = false): Project => {
  const status = { id: 'F_status', options: options(...names) }
  return { id: 'PVT_8', number: 8, title: 'Void Sector', url: '', status, priority: null, roles: rolesFor(status, roles), guessed: roles === undefined || guessed }
}

const raw = (number: number, title: string, status: string) => ({ number, title, url: '', labels: [], assignees: [], body: '', updatedAt: '2026-10-05T10:00:00Z', status })

// GitHub with a project whose Status options are its own, every call kept, and a store whose choices start as `choices`.
const world = (on: On, names: string[], choices?: Record<string, unknown>) => {
  const kept = memoryStore(on, choices ? { [CHOICES]: choices } : {})
  const gh = fakeGitHub(on, {
    issues: [raw(1, 'One', names[0] ?? ''), raw(2, 'Two', names[1] ?? '')],
    project: true,
    shapeProject: linked => {
      linked.fields.nodes[0].options = options(...names)
    },
  })
  session(on)
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  const mutations = () => gh.ran.filter(call => call.argv.includes('graphql') && /\bmutation\b/.test(`${call.argv.join(' ')} ${call.stdin ?? ''}`))
  // The shared entry with the person's choices, which live under a key of their own, over it.
  const stored = () => ({ ...(kept.get(KEY) ?? {}), ...(kept.get(CHOICES) ?? {}) }) as Record<string, any>
  return { mutations, stored }
}

test('every common name plays its part, whatever its case, and the board names and the list order win ties', () => {
  for (const role of ROLE_ORDER) {
    for (const name of COMMON_NAMES[role]) {
      expect(rolesByName(options(name.toUpperCase()))).toEqual({ [role]: 'S0' })
      expect(rolesByName(options(` ${name.toLowerCase()} `))).toEqual({ [role]: 'S0' })
    }
  }
  // GitHub's own three, and a project that says it its own way.
  expect(rolesByName(options('Todo', 'In Progress', 'Done'))).toEqual({ ready: 'S0', started: 'S1', done: 'S2' })
  expect(rolesByName(options('Triage', 'Up next', 'Icebox', 'Doing', 'QA', 'Shipped'))).toEqual({ inbox: 'S0', ready: 'S1', backlog: 'S2', started: 'S3', verification: 'S4', done: 'S5' })
  // The board's own name beats a common one, wherever it stands.
  expect(rolesByName(options('Todo', 'Ready'))).toEqual({ ready: 'S1' })
  expect(rolesByName(options('Shipped', 'Closed', 'done'))).toEqual({ done: 'S2' })
  // Then the list's order: Todo before Up next, In review before Review.
  expect(rolesByName(options('Up next', 'Todo'))).toEqual({ ready: 'S1' })
  expect(rolesByName(options('Review', 'In review'))).toEqual({ verification: 'S1' })
  // No option plays two parts, even with every name at once.
  const all = rolesByName(options(...ROLE_ORDER.flatMap(role => COMMON_NAMES[role])))
  expect(Object.keys(all)).toHaveLength(6)
  expect(new Set(Object.values(all)).size).toBe(6)
  // A name not on the list plays nothing.
  expect(rolesByName(options('Someday', 'Finished'))).toEqual({})
})

test('a saved mapping wins over the names, and only names found by a common name are a guess', () => {
  const status = { id: 'F', options: options('Todo', 'Ready', 'Shipped') }
  expect(rolesFor(status, undefined)).toEqual({ ready: 'S1', done: 'S2' })
  expect(rolesFor(status, { ready: 'S0' })).toEqual({ ready: 'S0' })
  expect(rolesFor(status, {})).toEqual({})

  expect(guessText(guessOf(project(['Todo', 'Doing', 'Shipped'])))).toBe(GUESS)
  // The board's own names, whatever their case, aren't a guess; nor is a saved mapping.
  expect(guessOf(project(['Ready', 'in progress', 'Done']))).toEqual([])
  expect(guessOf(project(['Todo', 'Doing', 'Shipped'], { ready: 'S0' }))).toEqual([])
  expect(roleOf(project(['Todo', 'Doing', 'Shipped'], { done: 'S0' }), 'done')?.name).toBe('Todo')
})

test('a guessed mapping shows once in the band and in /issues check, and Looks right saves it without writing to GitHub or adopting', async ($, on) => {
  const { mutations, stored } = world(on, ['Todo', 'Doing', 'Shipped'])
  await $.command.run(REFRESH)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: GUESS })).toBeDefined()
  expect((await $.command.run({ ...REFRESH, args: 'check' })).text).toContain(`The board guessed which Status is which. ${GUESS}.`)

  await band.press({ key: 'guess-yes' })
  expect(stored().statuses).toEqual({ PVT_8: { ready: 'S0', started: 'S1', done: 'S2' } })
  // Saving the mapping isn't letting the board write to the project, nor choosing it.
  expect(stored().preferred).toBeUndefined()
  expect(mutations()).toEqual([])
  expect(await band.find({ key: 'guess-yes' })).toBeUndefined()
  expect((await $.command.run({ ...REFRESH, args: 'check' })).text).not.toContain('guessed')
  await band.unmount()

  // It stays saved: the next read goes by it, and doesn't ask again.
  await $.command.run(REFRESH)
  const again = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await again.find({ key: 'guess-yes' })).toBeUndefined()
  await again.unmount()
  expect(mutations()).toEqual([])
})

test('Change opens /issues statuses and the guess is not shown again; Save keeps the picks here, with no GraphQL mutation', async ($, on) => {
  const { mutations, stored } = world(on, ['Todo', 'Doing', 'Shipped', 'Waiting'])
  await $.command.run(REFRESH)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  await band.press({ key: 'guess-change' })
  expect(await band.find({ key: 'guess-yes' })).toBeUndefined()
  await band.unmount()

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'statuses-card' })).toBeDefined()
  expect(await ui.find({ text: '⚙ Which Status is which in Void Sector' })).toBeDefined()
  // It starts from the guess, offering only the project's own options and none.
  expect(await ui.find({ key: 'statuses-ready-S0' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'statuses-ready-add' })).toBeUndefined()
  // Waiting as Verification, and Doing as Ready, which takes it from In progress: one option plays one part.
  await ui.press({ key: 'statuses-verification-S3' })
  await ui.press({ key: 'statuses-ready-S1' })
  await ui.press({ key: 'statuses-save' })
  expect(stored().statuses).toEqual({ PVT_8: { ready: 'S1', done: 'S2', verification: 'S3' } })
  expect(await ui.find({ key: 'statuses-card' })).toBeUndefined()
  expect(mutations()).toEqual([])

  // A saved mapping wins over the names from then on.
  expect((await $.command.run({ ...REFRESH, args: 'statuses' })).text).toMatch(/Save keeps it here, and nothing changes on GitHub/)
  expect(await ui.find({ key: 'statuses-ready-S1' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'statuses-started-none' })).toMatchObject({ props: { variant: 'primary' } })
  await ui.press({ key: 'statuses-cancel' })
  expect(mutations()).toEqual([])
  await ui.unmount()
})

test('/issues statuses changes the mapping setup saved for the project, and keeps the other choices', async ($, on) => {
  const { mutations, stored } = world(on, ['Todo', 'Doing', 'Shipped'], { preferred: PROJECT.id, statuses: { [PROJECT.id]: { ready: 'S0' }, PVT_9: { done: 'S1' } } })
  await $.command.run(REFRESH)
  // Setup saved a mapping, so nothing is a guess.
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'guess-yes' })).toBeUndefined()
  await band.unmount()
  await $.command.run({ ...REFRESH, args: 'statuses' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'statuses-done-S2' })
  await ui.press({ key: 'statuses-save' })
  expect(stored().statuses).toEqual({ [PROJECT.id]: { ready: 'S0', done: 'S2' }, PVT_9: { done: 'S1' } })
  expect(stored().preferred).toBe(PROJECT.id)
  expect(mutations()).toEqual([])
  await ui.unmount()
})

test('/issues help lists /issues statuses', async ($, on) => {
  world(on, ['Todo'])
  expect((await $.command.run({ ...REFRESH, args: 'help' })).text).toContain("- /issues statuses: picks which of the project's Status options plays each part, saved here and not on GitHub.")
})
