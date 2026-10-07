import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { groupsOf, isInbox, leftForDone, leftForVerification, toArchive } from '../hooks/parse'
import { isLater, isNow, roleOf, rolesFor } from '../hooks/project'
import { addsAsTodo, areasOf, automationsOff, automationsOn, mergeStatuses, picksFor, rolesOf, stepsOf, suggestAreas, suggestRoles } from '../hooks/setup'
import type { Board, Issue, Project, SetupFacts, SetupOption } from '../types'
import { adoptedStore } from './graph'

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
const SETUP = { command: 'issues', args: 'setup', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const option = (name: string, id?: string): SetupOption => ({ ...(id ? { id } : {}), name, color: 'GRAY', description: '' })
const BOARD_STATUSES = ['Inbox', 'Backlog', 'Ready', 'In progress', 'Verification', 'Done']

test('Status options are added where they belong, and the ones there are kept as they are', () => {
  const fresh = mergeStatuses([option('Todo', 'a'), option('In Progress', 'b'), option('Done', 'c')])
  expect(fresh.options.map(one => [one.name, one.id])).toEqual([
    ['Todo', 'a'],
    ['Inbox', undefined],
    ['Backlog', undefined],
    ['Ready', undefined],
    ['In Progress', 'b'],
    ['Verification', undefined],
    ['Done', 'c'],
  ])
  expect(fresh.added).toEqual(['Inbox', 'Backlog', 'Ready', 'Verification'])
  expect(mergeStatuses([]).options.map(one => one.name)).toEqual(BOARD_STATUSES)
  expect(mergeStatuses(BOARD_STATUSES.map((name, index) => option(name, `s${index}`))).added).toEqual([])
})

const facts = (overrides: Partial<SetupFacts> = {}): SetupFacts => ({
  repo: { id: 'R_1', name: 'astrosteveo/void-sector', ownerId: 'U_1', hasIssues: true, permission: 'ADMIN' },
  projects: [],
  labels: ['bug', 'enhancement'],
  issues: [],
  suggested: [],
  hasTemplate: true,
  ...overrides,
})
const complete = {
  id: 'PVT_8',
  number: 8,
  title: 'Void Sector',
  url: 'https://github.com/users/astrosteveo/projects/8',
  status: { id: 'F_status', options: BOARD_STATUSES.map((name, index) => option(name, `s${index}`)) },
  priority: { id: 'F_priority', options: ['P0', 'P1', 'P2'].map((name, index) => option(name, `p${index}`)) },
  workflows: [
    { name: 'Item closed', enabled: true },
    { name: 'Auto-add to project', enabled: false },
    { name: 'Auto-add sub-issues to project', enabled: true },
  ],
}

test('setup plans only what is missing', () => {
  const fresh = facts({
    repo: { id: 'R_1', name: 'astrosteveo/void-sector', ownerId: 'U_1', hasIssues: false, permission: 'ADMIN' },
    labels: ['enhancement'],
    issues: [
      { id: 'I_1', number: 1, items: [] },
      { id: 'I_2', number: 2, items: [] },
    ],
  })
  expect(stepsOf(fresh, null, 'simulation, area:interface, Name!').map(step => [step.id, step.title])).toEqual([
    ['issues', 'Turn on issues for astrosteveo/void-sector'],
    ['project', 'Create the project "void-sector" and link it to astrosteveo/void-sector'],
    ['status', 'Add Status options: Inbox, Backlog, Ready, Verification'],
    ['priority', 'Create a Priority field: P0, P1, P2'],
    ['bug', 'Create the label bug'],
    ['areas', 'Create the labels area:simulation, area:interface'],
    ['items', 'Add 2 open issues to the project'],
    ['inbox', 'Set Status to Inbox on 2 issues that have none'],
  ])

  // Set up already: nothing to do, though an automation is off.
  const done = facts({ projects: [complete], issues: [{ id: 'I_1', number: 1, items: [{ project: 'PVT_8', item: 'PVTI_1', status: 'Ready' }] }] })
  expect(stepsOf(done, 'PVT_8', '')).toEqual([])
  expect(automationsOff(complete)).toEqual(['Auto-add to project'])
  // Item closed is on there: setup advises turning it off, since the board moves only completed issues to Done.
  expect(automationsOn(complete)).toEqual(['Item closed'])
  expect(automationsOn({ ...complete, workflows: [{ name: 'Item closed', enabled: false }] })).toEqual([])
  expect(rolesOf(complete.status.options)).toEqual({ inbox: 's0', backlog: 's1', ready: 's2', started: 's3', verification: 's4', done: 's5' })

  // An issue in the project with no Status is set to Inbox, not added again.
  const unset = facts({ projects: [complete], issues: [{ id: 'I_1', number: 1, items: [{ project: 'PVT_8', item: 'PVTI_1', status: null }] }] })
  expect(stepsOf(unset, 'PVT_8', '').map(step => step.id)).toEqual(['inbox'])
})

test('area labels come from the repo\'s parts, and none are offered when it has some', () => {
  expect(suggestAreas(['bug'], { top: ['.github', 'plugins', 'docs'], nested: { plugins: ['ask', 'issue-board', 'ouroboros'] } })).toEqual(['ask', 'issue-board', 'ouroboros'])
  expect(suggestAreas(['bug'], { top: ['client', 'server', 'node_modules', 'tests', '.git'], nested: {} })).toEqual(['client', 'server'])
  expect(suggestAreas(['area:sim'], { top: ['client'], nested: {} })).toEqual([])
  expect(areasOf('sim, area:net net, , UI', ['area:ui'])).toEqual(['sim', 'net'])
})

// GitHub as setup sees it: the repo, its projects and issues, and every change asked for, in order.
const github = (on: On, start: { hasIssues: boolean; projects: (typeof complete)[]; labels: string[]; issues: { number: number; items: { project: string; item: string; status: string | null }[] }[] }) => {
  const state = { ...start, writes: [] as string[], created: null as null | typeof complete }
  const projectNode = (project: typeof complete) => ({
    id: project.id,
    number: project.number,
    title: project.title,
    url: project.url,
    closed: false,
    fields: { nodes: [project.status, project.priority].filter(Boolean).map(field => ({ id: field?.id, name: field?.id === 'F_status' ? 'Status' : 'Priority', options: field?.options })) },
    workflows: { nodes: project.workflows },
  })
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = e.argv
    if (argv[0] === 'git') return answer('main\n')
    if (argv[1] === 'repo' && argv[2] === 'view') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: state.hasIssues }))
    if (argv[1] === 'repo' && argv[2] === 'edit') {
      state.writes.push(`repo edit ${argv.slice(3).join(' ')}`)
      state.hasIssues = true
      return answer('')
    }
    if (argv[1] === 'label' && argv[2] === 'create') {
      state.writes.push(`label ${argv[3]}`)
      return answer('')
    }
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv.includes('--input')) {
      const { query, variables } = JSON.parse(e.init?.stdin ?? '{}') as { query: string; variables: Record<string, any> }
      const data = (value: unknown) => answer(JSON.stringify({ data: value }))
      if (query.includes('labels(first: 100)')) {
        return data({
          repository: {
            id: 'R_1',
            nameWithOwner: 'astrosteveo/void-sector',
            hasIssuesEnabled: state.hasIssues,
            viewerPermission: 'ADMIN',
            owner: { id: 'U_1' },
            labels: { nodes: state.labels.map(name => ({ name })) },
            projectsV2: { nodes: state.projects.map(projectNode) },
          },
        })
      }
      if (query.includes('projectItems')) {
        return data({
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: state.issues.map(issue => ({
                id: `I_${issue.number}`,
                number: issue.number,
                projectItems: { nodes: issue.items.map(item => ({ id: item.item, project: { id: item.project }, status: item.status ? { name: item.status } : null })) },
              })),
            },
          },
        })
      }
      const project = state.created ?? state.projects[0]
      if (query.includes('createProjectV2(')) {
        state.writes.push(`create project ${variables.title} for ${variables.repo} by ${variables.owner}`)
        state.created = { ...complete, id: 'PVT_new', number: 9, title: variables.title, priority: null as never, status: { id: 'F_status', options: [option('Todo', 'd0'), option('In Progress', 'd1'), option('Done', 'd2')] } as never }
        return data({ createProjectV2: { projectV2: { id: 'PVT_new', number: 9, title: variables.title, url: '' } } })
      }
      if (query.includes('node(id: $id)')) return data({ node: projectNode(project!) })
      if (query.includes('updateProjectV2Field(')) {
        const options = variables.options as SetupOption[]
        state.writes.push(`status ${options.map(one => `${one.name}${one.id ? `=${one.id}` : ''}`).join(',')}`)
        project!.status = { id: 'F_status', options: options.map((one, index) => ({ ...one, id: one.id ?? `n${index}` })) }
        return data({ updateProjectV2Field: { projectV2Field: { id: 'F_status' } } })
      }
      if (query.includes('createProjectV2Field(')) {
        state.writes.push(`field ${variables.name} ${(variables.options as SetupOption[]).map(one => one.name).join(',')}`)
        project!.priority = { id: 'F_priority', options: (variables.options as SetupOption[]).map((one, index) => ({ ...one, id: `p${index}` })) }
        return data({ createProjectV2Field: { projectV2Field: { id: 'F_priority' } } })
      }
      if (query.includes('addProjectV2ItemById')) {
        state.writes.push(`add ${variables.content}`)
        return data({ addProjectV2ItemById: { item: { id: `PVTI_${variables.content}` } } })
      }
      if (query.includes('updateProjectV2ItemFieldValue')) {
        state.writes.push(`set ${variables.item} ${project!.status.options.find(one => one.id === variables.option)?.name}`)
        return data({ updateProjectV2ItemFieldValue: { projectV2Item: { id: variables.item } } })
      }
    }
    // The board's own refresh, which follows Apply.
    if (argv[1] === 'api' && argv[2] === 'graphql') return answer(JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [] } } } }))
    return answer(argv[1] === 'api' ? 'astrosteveo\n' : '[]')
  })
  on('session.repo', async () => ({ value: { root: '/work/void-sector', remote: 'git@github.com:astrosteveo/void-sector.git', internal: false, name: null } }))
  on('session.root', async () => ({ value: '/work/void-sector' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  // The folder: a client and a server, and no issue template.
  on('fs.list', async (_$, e) => ({ value: e.path === '/work/void-sector' ? [{ name: 'client', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }, { name: 'server', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] : [] }))
  return state
}

test('setup on a fresh repo shows its plan, changes nothing until Apply, then makes and links the project', async ($, on) => {
  // A store the test can read back.
  const kept = new Map<string, unknown>()
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', async (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T03:00:00Z') })
  const gh = github(on, { hasIssues: false, projects: [], labels: ['enhancement'], issues: [{ number: 1, items: [] }, { number: 2, items: [] }] })
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  const reply = await $.command.run(SETUP)
  expect(reply.text).toMatch(/nothing changes until you press Apply\.$/)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^⚙ Set up astrosteveo\/void-sector for the board$/ })).toBeDefined()
  expect(await ui.find({ text: /^none is linked to astrosteveo\/void-sector$/ })).toBeDefined()
  expect(await ui.find({ text: /^Create the labels area:client, area:server$/ })).toBeDefined()
  expect(await ui.find({ text: /^In the project's Workflows settings, by hand:$/ })).toBeDefined()
  // A fresh project has none of its workflows read: the board wants the auto-adds on, and Item closed off.
  expect(await ui.find({ text: /^ {2}· turn on Auto-add to project, Auto-add sub-issues to project$/ })).toBeDefined()
  // A new project's Status keeps GitHub's Todo, which its automation sets on new issues unless told Inbox.
  expect(await ui.find({ text: /^ {2}· new issues arrive with Status Todo, GitHub's default, so they skip the Inbox: open Item added to project and set its Status to Inbox\./ })).toBeDefined()
  expect(gh.writes).toEqual([])

  // The area labels are the person's to change.
  await ui.input({ key: 'setup-areas', text: 'client', kind: 'change' })
  expect(await ui.find({ text: /^Create the labels area:client$/ })).toBeDefined()

  // The issue template is Claude's to write, as a change to review.
  await ui.press({ key: 'setup-template' })
  expect(sent.at(-1)).toMatch(/^Add an issue template to astrosteveo\/void-sector at `\.github\/ISSUE_TEMPLATE\/task\.yml`.*open a pull request for me to review; don't merge it\.$/)
  expect(gh.writes).toEqual([])

  await ui.press({ key: 'setup-apply' })
  await clock.settle()
  expect(gh.writes).toEqual([
    'repo edit astrosteveo/void-sector --enable-issues',
    'create project void-sector for R_1 by U_1',
    // GitHub's own three kept, ids and names as they were; the board's added where they belong.
    'status Todo=d0,Inbox,Backlog,Ready,In Progress=d1,Verification,Done=d2',
    'field Priority P0,P1,P2',
    'add I_1',
    'add I_2',
    'set PVTI_I_1 Inbox',
    'set PVTI_I_2 Inbox',
    'label bug',
    'label area:client',
  ])
  expect((await ui.findAll({ type: 'Text' })).filter(text => text.text === '✓ ').length).toBe(8)
  expect(await ui.find({ key: 'setup-close' })).toMatchObject({ text: 'Close' })

  // Saved for the repo: the project, its fields, and which Status means what.
  const saved = kept.get('repo:/work/void-sector') as { setup?: { project: { id: string }; status: { roles: Record<string, string> }; priority: { id: string } } }
  expect(saved.setup?.project.id).toBe('PVT_new')
  expect(saved.setup?.priority.id).toBe('F_priority')
  expect(saved.setup?.status.roles).toMatchObject({ inbox: 'n1', started: 'd1', done: 'd2' })

  await ui.press({ key: 'setup-close' })
  expect(await ui.find({ key: 'setup-plan' })).toBeUndefined()
  await ui.unmount()
})

test('with two projects linked, setup asks which, and Cancel changes nothing', async ($, on) => {
  // The board may write to the first, Void Sector, already.
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T03:00:00Z') })
  const other = { ...complete, id: 'PVT_9', number: 9, title: 'Roadmap', priority: null as never }
  const gh = github(on, { hasIssues: true, projects: [complete, other], labels: ['bug', 'area:sim'], issues: [{ number: 1, items: [{ project: 'PVT_8', item: 'PVTI_1', status: 'Ready' }] }] })
  await $.command.run(SETUP)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })

  // The first is chosen, and set up already; the other wants a Priority field and the issue.
  expect(await ui.find({ key: 'setup-project-8' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ text: /^✓ Nothing to change/ })).toBeDefined()
  expect(await ui.find({ key: 'setup-apply' })).toBeUndefined()
  // With area labels there already, none are offered.
  expect(await ui.find({ key: 'setup-areas' })).toBeUndefined()

  await ui.press({ key: 'setup-project-9' })
  // Picking the other makes Apply let the board write there instead.
  expect(await ui.find({ text: /^Let the board write to Roadmap$/ })).toBeDefined()
  expect(await ui.find({ text: /^Create a Priority field: P0, P1, P2$/ })).toBeDefined()
  expect(await ui.find({ text: /^Add 1 open issue to the project$/ })).toBeDefined()
  expect(await ui.find({ key: 'setup-close' })).toMatchObject({ text: 'Cancel' })

  await ui.press({ key: 'setup-close' })
  expect(await ui.find({ key: 'setup-plan' })).toBeUndefined()
  expect(gh.writes).toEqual([])
  await ui.unmount()
})

test('setup says which project the board may write to; Release makes it read-only, and Apply adopts it again', async ($, on) => {
  // Saved by an older board, before adopting: its setup names the project, which counts as adopted.
  const kept = new Map<string, unknown>([['repo:/work/void-sector', { setup: { project: { id: 'PVT_8', number: 8, title: 'Void Sector' }, status: null, priority: null, at: 0 } }]])
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', async (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', async () => ({ value: undefined }))
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T03:00:00Z') })
  const gh = github(on, { hasIssues: true, projects: [complete], labels: ['bug', 'area:sim'], issues: [{ number: 1, items: [{ project: 'PVT_8', item: 'PVTI_1', status: 'Ready' }] }] })
  await $.command.run(SETUP)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^the board may write to Void Sector$/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ Nothing to change/ })).toBeDefined()

  await ui.press({ key: 'setup-release' })
  expect((kept.get('choices:/work/void-sector') as { adopted?: unknown }).adopted).toBeNull()
  expect(await ui.find({ text: /^none: the board only reads Void Sector until Apply$/ })).toBeDefined()
  expect(await ui.find({ text: /^Let the board write to Void Sector$/ })).toBeDefined()
  expect(await ui.find({ key: 'setup-release' })).toBeUndefined()

  await ui.press({ key: 'setup-apply' })
  await clock.settle()
  expect((kept.get('choices:/work/void-sector') as { adopted?: unknown }).adopted).toEqual({ id: 'PVT_8', title: 'Void Sector', owner: 'astrosteveo' })
  expect(await ui.find({ text: /^the board may write to Void Sector$/ })).toBeDefined()
  // Adopting is the board's own note; GitHub isn't changed.
  expect(gh.writes).toEqual([])
  await ui.unmount()
})

// A project that names its Status its own way: GitHub's Todo, then Doing and Shipped.
const shipyard = {
  ...complete,
  id: 'PVT_10',
  number: 10,
  title: 'Shipyard',
  url: 'https://github.com/users/astrosteveo/projects/10',
  status: { id: 'F_status', options: [option('Todo', 'o0'), option('Doing', 'o1'), option('Shipped', 'o2')] },
  workflows: [
    { name: 'Auto-add to project', enabled: true },
    { name: 'Auto-add sub-issues to project', enabled: true },
  ],
}
const NONE = { inbox: null, ready: null, backlog: null, started: null, verification: null, done: null }

test("setup suggests the board's names where the project has them, and adds only the ones picked", () => {
  // The board's names, whatever their case, are suggested; a name the project lacks is suggested for adding.
  expect(suggestRoles(complete.status.options)).toEqual({ inbox: 'Inbox', ready: 'Ready', backlog: 'Backlog', started: 'In progress', verification: 'Verification', done: 'Done' })
  expect(suggestRoles(shipyard.status.options)).toEqual({ inbox: 'Inbox', ready: 'Ready', backlog: 'Backlog', started: 'In progress', verification: 'Verification', done: 'Done' })
  expect(suggestRoles([option('IN PROGRESS', 'x')]).started).toBe('IN PROGRESS')

  // Picked from the project's own, or none: nothing to add, and the roles are the options picked.
  const picks = { ...NONE, inbox: 'Todo', started: 'Doing', done: 'Shipped' }
  expect(mergeStatuses(shipyard.status.options, picks).added).toEqual([])
  expect(rolesOf(shipyard.status.options, picks)).toEqual({ inbox: 'o0', started: 'o1', done: 'o2' })
  // One left to add is added alone, where the board's order puts it.
  expect(mergeStatuses(shipyard.status.options, { ...picks, verification: 'Verification' }).options.map(one => one.name)).toEqual(['Todo', 'Doing', 'Shipped', 'Verification'])

  const there = facts({ projects: [shipyard], issues: [{ id: 'I_1', number: 1, items: [{ project: 'PVT_10', item: 'PVTI_1', status: null }] }] })
  expect(stepsOf(there, 'PVT_10', '', picks).map(step => [step.id, step.title])).toEqual([
    ['roles', 'Go by these Status options: Inbox: Todo, Ready: none, Backlog: none, In progress: Doing, Verification: none, Done: Shipped'],
    ['inbox', 'Set Status to Todo on 1 issue that has none'],
  ])
  // With no Inbox, issues without a Status are left so.
  expect(stepsOf(there, 'PVT_10', '', { ...picks, inbox: null }).map(step => step.id)).toEqual(['roles'])
  // Todo picked as the Inbox: GitHub's automation setting Todo is what the board wants.
  expect(addsAsTodo(shipyard, 'Todo')).toBe(false)
  expect(addsAsTodo(shipyard, 'Inbox')).toBe(true)

  // Saved: setup starts from the saved roles, and has nothing to change while the picks match them.
  const saved = { ...there, issues: [], saved: { project: 'PVT_10', roles: { inbox: 'o0', started: 'o1', done: 'o2' } } }
  expect(picksFor(saved, 'PVT_10')).toEqual(picks)
  expect(stepsOf(saved, 'PVT_10', '', picks)).toEqual([])
  // A project with the board's names, never set up, needs nothing either.
  expect(stepsOf(facts({ projects: [complete] }), 'PVT_8', '')).toEqual([])
})

const issueAt = (number: number, status: string | null, priority: string | null = null): Issue =>
  ({ number, title: `Issue ${number}`, url: '', labels: [], assignees: [], body: '', updatedAt: '2026-10-04T00:00:00Z', status, priority, item: `PVTI_${number}`, checks: [] }) as unknown as Issue
const projectWith = (names: string[], roles?: Record<string, string>, nowCount?: number): Project => {
  const status = { id: 'F_status', options: names.map((name, index) => ({ id: `o${index}`, name })) }
  return {
    id: 'PVT_10',
    number: 10,
    title: 'Shipyard',
    url: '',
    status,
    priority: { id: 'F_priority', options: ['P0', 'P1', 'P2'].map((name, index) => ({ id: `p${index}`, name })) },
    roles: rolesFor(status, roles),
    ...(nowCount !== undefined ? { nowCount } : {}),
  }
}

test("the board goes by the roles: the board's names without saved roles, the saved ones with, and none for a role unset", () => {
  const named = projectWith(['Inbox', 'Backlog', 'In progress', 'Done'])
  expect(roleOf(named, 'inbox')?.name).toBe('Inbox')
  expect(roleOf(named, 'verification')).toBeUndefined()

  const own = projectWith(['Todo', 'Doing', 'Review', 'Shipped', 'Someday'], { inbox: 'o0', started: 'o1', verification: 'o2', done: 'o3', backlog: 'o4', ready: 'gone' })
  expect(roleOf(own, 'done')?.name).toBe('Shipped')
  // A saved option the project no longer has is no role.
  expect(own.roles?.ready).toBeUndefined()
  expect(isInbox(issueAt(1, 'Todo'), own)).toBe(true)
  expect(isInbox(issueAt(2, null), own)).toBe(true)
  expect(isInbox(issueAt(3, 'Doing'), own)).toBe(false)
  expect(groupsOf([issueAt(1, 'Someday'), issueAt(2, 'Todo')], 'status', own).map(group => [group.title, group.folded])).toEqual([
    ['Todo', false],
    ['Someday', true],
  ])

  // Leaving the board: moved to Shipped unless there already; a Refs merge moves to Review unless at Review or Shipped.
  const before = { repo: 'a/b', issues: [issueAt(1, 'Doing'), issueAt(2, 'Shipped'), issueAt(3, 'Doing'), issueAt(4, 'Review')], prs: [{ number: 9, issues: [3, 4] }], project: own } as unknown as Board
  const after = { ...before, issues: [issueAt(3, 'Doing'), issueAt(4, 'Review')], prs: [] } as unknown as Board
  expect(leftForDone(before, after).map(one => one.number)).toEqual([1])
  expect(leftForVerification(before, after).map(one => one.number)).toEqual([3])

  // A role unset: its part is off.
  const unset = projectWith(['Inbox', 'Doing', 'Done'], { started: 'o1', done: 'o2' })
  expect(isInbox(issueAt(1, 'Inbox'), unset)).toBe(false)
  expect(isInbox(issueAt(2, null), unset)).toBe(false)
  expect(leftForVerification(before, { ...after, project: unset })).toEqual([])
  const doneItem = { node_id: 'N1', content_type: 'Issue', content: { number: 1, title: 'x', state: 'closed', closed_at: '2026-09-01' }, fields: [{ name: 'Status', value: { name: 'Shipped' } }] }
  expect(toArchive([doneItem], { doneBefore: '2026-10-01' }, 'Shipped').map(one => one.number)).toEqual([1])
  expect(toArchive([doneItem], { doneBefore: '2026-10-01' }, undefined)).toEqual([])

  // Now is the first two priorities, or as many as set.
  expect(isNow(own, issueAt(1, null, 'P1'))).toBe(true)
  const one = projectWith(['Todo'], undefined, 1)
  expect(isNow(one, issueAt(1, null, 'P1'))).toBe(false)
  expect(isLater(one, issueAt(1, null, 'P1'))).toBe(true)
})

test('setup on a project with its own names lets the person pick which is which, and saves only that', async ($, on) => {
  const kept = new Map<string, unknown>()
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', async (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T03:00:00Z') })
  const gh = github(on, { hasIssues: true, projects: [shipyard], labels: ['bug', 'area:sim'], issues: [{ number: 1, items: [{ project: 'PVT_10', item: 'PVTI_1', status: 'Todo' }] }] })
  await $.command.run(SETUP)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })

  // Suggested: the board's names, to add, as none match; Todo still skips the Inbox.
  expect(await ui.find({ key: 'setup-role-inbox-add' })).toMatchObject({ text: '＋ Inbox', props: { variant: 'primary' } })
  expect(await ui.find({ text: /^Add Status options: Inbox, Backlog, Ready, In progress, Verification, Done$/ })).toBeDefined()
  expect(await ui.find({ text: /new issues arrive with Status Todo/ })).toBeDefined()

  for (const key of ['inbox-Todo', 'ready-none', 'backlog-none', 'started-Doing', 'verification-none', 'done-Shipped']) await ui.press({ key: `setup-role-${key}` })
  expect(await ui.find({ key: 'setup-role-started-Doing' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ text: /^Add Status options/ })).toBeUndefined()
  expect(await ui.find({ text: /^Go by these Status options: Inbox: Todo, Ready: none, Backlog: none, In progress: Doing, Verification: none, Done: Shipped$/ })).toBeDefined()
  expect(await ui.find({ text: /new issues arrive with Status Todo/ })).toBeUndefined()

  await ui.press({ key: 'setup-apply' })
  await clock.settle()
  // The project keeps its options; only the roles are saved.
  expect(gh.writes).toEqual([])
  const saved = kept.get('repo:/work/void-sector') as { setup?: { project: { id: string }; status: { roles: Record<string, string> } } }
  expect(saved.setup?.project.id).toBe('PVT_10')
  expect(saved.setup?.status.roles).toEqual({ inbox: 'o0', started: 'o1', done: 'o2' })
  await ui.unmount()
})
