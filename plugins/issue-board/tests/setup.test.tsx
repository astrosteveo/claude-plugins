import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { areasOf, automationsOff, automationsOn, mergeStatuses, rolesOf, stepsOf, suggestAreas } from '../hooks/setup'
import type { SetupFacts, SetupOption } from '../types'

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
  expect(await ui.find({ text: /^ {2}· set Item added to project to Inbox/ })).toBeDefined()
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
  mock.store(on)
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
  expect(await ui.find({ text: /^Create a Priority field: P0, P1, P2$/ })).toBeDefined()
  expect(await ui.find({ text: /^Add 1 open issue to the project$/ })).toBeDefined()
  expect(await ui.find({ key: 'setup-close' })).toMatchObject({ text: 'Cancel' })

  await ui.press({ key: 'setup-close' })
  expect(await ui.find({ key: 'setup-plan' })).toBeUndefined()
  expect(gh.writes).toEqual([])
  await ui.unmount()
})
