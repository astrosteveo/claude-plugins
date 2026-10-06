import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Project, Roles } from '../types'
import { COMMON_NAMES, ROLE_ORDER, guessOf, guessText, roleOf, rolesByName, rolesFor, savedRolesOf } from '../hooks/project'
import { PROJECT, graphPage, isIssuesQuery } from './graph'

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const RUN = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }
const KEY = `repo:${REPO.root}`
const GUESS = 'Status: Todo is Ready, Doing is In progress, Shipped is Done'

const options = (...names: string[]) => names.map((name, index) => ({ id: `S${index}`, name }))
const project = (names: string[], roles?: Roles, guessed = false): Project => {
  const status = { id: 'F_status', options: options(...names) }
  return { id: 'PVT_8', number: 8, title: 'Void Sector', url: '', status, priority: null, roles: rolesFor(status, roles), guessed: roles === undefined || guessed }
}

const raw = (number: number, title: string, status: string) => ({ number, title, url: '', labels: [], assignees: [], body: '', updatedAt: '2026-10-05T10:00:00Z', status })

// GitHub with a project whose Status options are its own, every call kept, and a store that starts with `saved`.
const world = (on: On, names: string[], saved?: Record<string, unknown>) => {
  const kept = new Map<string, unknown>(saved ? [[KEY, saved]] : [])
  const state = { calls: [] as { argv: string[]; stdin: string }[], kept }
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', async (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    state.calls.push({ argv, stdin: e.init?.stdin ?? '' })
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return ok('main\n')
    if (isIssuesQuery(argv)) {
      const page = JSON.parse(graphPage([raw(1, 'One', names[0] ?? ''), raw(2, 'Two', names[1] ?? '')], argv, true)) as {
        data: { repository: { projectsV2?: { nodes: { fields: { nodes: { options?: unknown }[] } }[] } } }
      }
      const field = page.data.repository.projectsV2?.nodes[0]?.fields.nodes[0]
      if (field) field.options = options(...names)
      return ok(JSON.stringify(page))
    }
    if (argv[1] === 'repo') return ok(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (argv[1] === 'api' && argv[2] === 'graphql') return ok(JSON.stringify({ data: {} }))
    if (argv[1] === 'api') return ok('astrosteveo\n')
    return ok('[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  const mutations = () => state.calls.filter(call => call.argv.includes('graphql') && /\bmutation\b/.test(`${call.argv.join(' ')} ${call.stdin}`))
  const stored = () => (kept.get(KEY) ?? {}) as Record<string, any>
  return { state, mutations, stored }
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

test('a saved mapping wins over the names, setup first, and only names found by a common name are a guess', () => {
  const status = { id: 'F', options: options('Todo', 'Ready', 'Shipped') }
  expect(rolesFor(status, undefined)).toEqual({ ready: 'S1', done: 'S2' })
  expect(rolesFor(status, { ready: 'S0' })).toEqual({ ready: 'S0' })
  expect(rolesFor(status, {})).toEqual({})

  const setup = { project: { id: 'PVT_8' }, status: { roles: { ready: 'S1' } } }
  expect(savedRolesOf({ setup, statuses: { PVT_8: { ready: 'S0' } } }, 'PVT_8')).toEqual({ ready: 'S1' })
  expect(savedRolesOf({ setup: { ...setup, status: null }, statuses: { PVT_8: { ready: 'S0' } } }, 'PVT_8')).toEqual({ ready: 'S0' })
  expect(savedRolesOf({ setup, statuses: { PVT_9: { done: 'S2' } } }, 'PVT_9')).toEqual({ done: 'S2' })
  expect(savedRolesOf({}, 'PVT_8')).toBeUndefined()

  expect(guessText(guessOf(project(['Todo', 'Doing', 'Shipped'])))).toBe(GUESS)
  // The board's own names, whatever their case, aren't a guess; nor is a saved mapping.
  expect(guessOf(project(['Ready', 'in progress', 'Done']))).toEqual([])
  expect(guessOf(project(['Todo', 'Doing', 'Shipped'], { ready: 'S0' }))).toEqual([])
  expect(roleOf(project(['Todo', 'Doing', 'Shipped'], { done: 'S0' }), 'done')?.name).toBe('Todo')
})

test('a guessed mapping shows once in the band and in /issues check, and Looks right saves it without writing to GitHub or adopting', async ($, on) => {
  const { mutations, stored } = world(on, ['Todo', 'Doing', 'Shipped'])
  await $.command.run(RUN)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: GUESS })).toBeDefined()
  expect((await $.command.run({ ...RUN, args: 'check' })).text).toContain(`The board guessed which Status is which. ${GUESS}.`)

  await band.press({ key: 'guess-yes' })
  expect(stored().statuses).toEqual({ PVT_8: { ready: 'S0', started: 'S1', done: 'S2' } })
  // Saving the mapping isn't letting the board write to the project.
  expect(stored().adopted).toBeUndefined()
  expect(stored().setup).toBeUndefined()
  expect(mutations()).toEqual([])
  expect(await band.find({ key: 'guess-yes' })).toBeUndefined()
  expect((await $.command.run({ ...RUN, args: 'check' })).text).not.toContain('guessed')
  await band.unmount()

  // It stays saved: the next read goes by it, and doesn't ask again.
  await $.command.run(RUN)
  const again = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await again.find({ key: 'guess-yes' })).toBeUndefined()
  await again.unmount()
  expect(mutations()).toEqual([])
})

test('Change opens /issues statuses and the guess is not shown again; Save keeps the picks here, with no GraphQL mutation', async ($, on) => {
  const { mutations, stored } = world(on, ['Todo', 'Doing', 'Shipped', 'Waiting'])
  await $.command.run(RUN)
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
  expect(stored().adopted).toBeUndefined()
  expect(mutations()).toEqual([])

  // A saved mapping wins over the names from then on.
  expect((await $.command.run({ ...RUN, args: 'statuses' })).text).toMatch(/Save keeps it here, and nothing changes on GitHub/)
  expect(await ui.find({ key: 'statuses-ready-S1' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'statuses-started-none' })).toMatchObject({ props: { variant: 'primary' } })
  await ui.press({ key: 'statuses-cancel' })
  expect(mutations()).toEqual([])
  await ui.unmount()
})

test('/issues statuses saves into the roles of a setup saved for the project, which keeps it adopted as it was', async ($, on) => {
  const setup = { project: { id: PROJECT.id, number: 8, title: PROJECT.title }, status: { id: 'F_status', roles: { ready: 'S0' } }, priority: null, at: 0 }
  const { mutations, stored } = world(on, ['Todo', 'Doing', 'Shipped'], { adopted: null, setup })
  await $.command.run(RUN)
  // Setup saved a mapping, so nothing is a guess.
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'guess-yes' })).toBeUndefined()
  await band.unmount()
  await $.command.run({ ...RUN, args: 'statuses' })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'statuses-done-S2' })
  await ui.press({ key: 'statuses-save' })
  expect(stored().setup.status.roles).toEqual({ ready: 'S0', done: 'S2' })
  expect(stored().statuses).toBeUndefined()
  expect(stored().adopted).toBeNull()
  expect(mutations()).toEqual([])
  await ui.unmount()
})

test('/issues help lists /issues statuses', async ($, on) => {
  world(on, ['Todo'])
  expect((await $.command.run({ ...RUN, args: 'help' })).text).toContain("- /issues statuses: picks which of the project's Status options plays each part, saved here and not on GitHub.")
})
