import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { adoptText, adoptedOf, isMutation, ownerOf, writeRefusal } from '../hooks/project'
import { ADOPTED, PROJECT, graphPage, isIssuesQuery } from './graph'

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }
const KEY = `repo:${REPO.root}`
// Every setting that has the board change the project by itself, on.
const EVERYTHING = { options: { moveToDone: true, moveToVerification: true, advanceEpics: true, claimOnStart: true } }

const raw = (number: number, title: string, more: Record<string, unknown> = {}) => ({
  number,
  title,
  url: `https://github.com/astrosteveo/void-sector/issues/${number}`,
  labels: [] as { name: string }[],
  assignees: [] as { login: string }[],
  body: `## Acceptance\n- [ ] ${title} works`,
  updatedAt: '2026-10-05T10:00:00Z',
  ...more,
})

// The open issues before anything happens: #43 to start, #50 in the Inbox, epic #35 with its last sub-issue #44, #60
// about to close as completed, and #61 that pull request #70 refers to with Refs.
const BEFORE = [
  raw(43, 'Edit issues', { status: 'Ready', priority: 'P1' }),
  raw(50, 'Saves drop the hangar', { status: 'Inbox' }),
  raw(35, 'Stations', { status: 'In progress', subIssues: { total: 1, completed: 0 }, body: '## Acceptance\n- [ ] Every sub-issue is closed' }),
  raw(44, 'Dock', { status: 'In progress', parent: { number: 35, title: 'Stations', total: 1, completed: 0 } }),
  raw(60, 'Shuttle', { status: 'In progress' }),
  raw(61, 'Glide', { status: 'In progress' }),
]
// After: #44 and #60 closed, so the epic reads 1/1; pull request #70 merged and left.
const AFTER = BEFORE.filter(one => one.number !== 44 && one.number !== 60).map(one => (one.number === 35 ? { ...one, subIssues: { total: 1, completed: 1 } } : one))

const PR = {
  number: 70,
  title: 'Glide in',
  url: 'https://github.com/astrosteveo/void-sector/pull/70',
  headRefName: 'fix/61-glide',
  headRefOid: 'abc',
  isDraft: false,
  statusCheckRollup: [],
  reviewDecision: '',
  additions: 1,
  deletions: 1,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-05T10:00:00Z',
  body: 'Refs #61.',
  closingIssuesReferences: [],
}

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// GitHub as the board sees it, answering every call, with each call kept. A GraphQL mutation is anything sent to
// `gh api graphql` that says `mutation`, in its arguments or on stdin, whichever path in the board sent it.
const world = (on: On) => {
  const state = { issues: BEFORE as Record<string, unknown>[], prs: [PR] as unknown[], calls: [] as { argv: string[]; stdin: string }[], toasts: [] as string[] }
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    state.calls.push({ argv, stdin: e.init?.stdin ?? '' })
    if (argv[0] === 'git') return ok('main\n')
    if (isIssuesQuery(argv)) return ok(graphPage(state.issues as never, argv, true))
    if (argv[1] === 'repo') return ok(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (argv[1] === 'api' && argv[2] === 'graphql') {
      const text = `${argv.join(' ')} ${e.init?.stdin ?? ''}`
      if (text.includes('addProjectV2ItemById')) return ok(JSON.stringify({ data: { addProjectV2ItemById: { item: { id: 'PVTI_new' } } } }))
      if (text.includes('fieldValues')) return ok(JSON.stringify({ data: { node: { fieldValues: { nodes: [] } } } }))
      if (text.includes('projectItems')) return ok(JSON.stringify({ data: { node: { projectItems: { nodes: [] } } } }))
      if (text.includes('reviewThreads')) return ok(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }))
      return ok(JSON.stringify({ data: {} }))
    }
    if (argv[1] === 'pr' && argv.includes('open')) return ok(JSON.stringify(state.prs))
    if (argv[1] === 'api' && /\/pulls\/70$/.test(argv[2] ?? '')) return ok('2026-10-05T11:00:00Z\n')
    if (argv[1] === 'api' && /\/issues\/60$/.test(argv[2] ?? '')) return ok(JSON.stringify({ state: 'closed', state_reason: 'completed' }))
    if (argv[1] === 'api' && argv[2] === 'users/astrosteveo/projectsV2/8/fields?per_page=50') return ok(JSON.stringify([{ id: 111, name: 'Status' }]))
    if (argv[1] === 'api' && argv[2]?.startsWith('users/astrosteveo/projectsV2/8/items')) {
      return ok(JSON.stringify([{ node_id: 'PVTI_60', archived_at: null, content_type: 'Issue', content: { number: 60, title: 'Shuttle', state: 'closed', state_reason: 'completed', closed_at: '2026-09-01T10:00:00Z' }, fields: [{ name: 'Status', value: { name: { raw: 'Done' } } }] }]))
    }
    if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'POST' && /\/issues$/.test(argv[4] ?? '')) {
      return ok(JSON.stringify({ number: 80, id: 9080, node_id: 'I_80', html_url: 'https://github.com/astrosteveo/void-sector/issues/80', updated_at: '2026-10-05T10:00:00Z', labels: [], assignees: [] }))
    }
    if (argv[1] === 'api' && argv[2]?.includes('/milestones')) return ok('[]')
    if (argv[1] === 'api') return ok('astrosteveo\n')
    if (argv[1] === 'issue' && argv[2] === 'view') {
      const found = (state.issues.find(one => one.number === Number(argv[3])) ?? BEFORE.find(one => one.number === Number(argv[3]))) as Record<string, unknown> | undefined
      if (argv.includes('id')) return ok(JSON.stringify({ id: `I_${argv[3]}` }))
      return ok(JSON.stringify({ ...found, labels: [], assignees: [] }))
    }
    if (argv[1] === 'label') return ok(JSON.stringify([{ name: 'bug' }]))
    if (argv[1] === 'issue' && (argv[2] === 'edit' || argv[2] === 'close')) return ok('')
    return ok('[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', async (_$, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('tool.call', { tool: 'TaskCreate' }, async () => ({ result: { task: { id: '1' } } }))
  on('model.complete', async () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify([{ number: 50, priority: 'P0', area: null, status: 'Ready', reason: 'Saves break.' }]),
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))
  const mutations = () => state.calls.filter(call => call.argv.includes('graphql') && /\bmutation\b/.test(`${call.argv.join(' ')} ${call.stdin}`))
  return { state, mutations }
}

test('a project nobody adopted gets no write from Start, triage, any board tool or a read, with every setting on', EVERYTHING, async ($, on) => {
  mock.store(on)
  const { state, mutations } = world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })

  // Start still tracks the issue and assigns it.
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'start-43' })
  expect(state.calls.some(call => call.argv.join(' ') === 'gh issue edit 43 --add-assignee @me')).toBe(true)
  expect(mutations()).toEqual([])

  // Triage's Accept.
  await ui.press({ key: 'filter-inbox' })
  await ui.press({ key: 'triage-50-accept' })
  expect(mutations()).toEqual([])

  // Every tool the board registers, each asked to change the project where it can.
  const tool = (name: string, input: Record<string, unknown>) => $.tool.call({ tool: `mcp__issue-board__${name}`, ...input })
  const update = await tool('issue_update', { number: 43, status: 'Done', priority: 'P0', fields: { Estimate: 3 } })
  expect(update.deny).toMatch(/^Couldn't change #43: The issue board only reads Void Sector: nobody has let it write there\. To let it, press Let it write .*\/issues setup.*Apply\.$/)
  await tool('issue_update', { number: 43, fields: { Estimate: 3 } })
  await tool('issue_update', { number: 61, start: true })
  const created = await tool('issue_create', { title: 'New thing', body: '## Acceptance\n- [ ] Works', status: 'Ready', priority: 'P1' })
  expect(String(created.result)).toMatch(/only reads Void Sector/)
  await tool('issue_create', { title: 'Plain thing', body: 'Text' })
  const posted = await tool('project_status', { status: 'At risk', note: 'Slipping.' })
  expect(posted.deny).toMatch(/^Couldn't post the status update: The issue board only reads Void Sector/)
  await tool('project_archive', { number: 60, confirm: true })
  await tool('project_archive', { doneBefore: '2026-10-01', confirm: true })
  await tool('tick', { number: 43, boxes: [1] })
  await tool('milestone', { title: 'Launch' })
  await tool('issues', { filter: 'all' })
  await tool('issues', { number: 43 })

  // Reads that would move closed issues to Done, a Refs merge's issue to Verification, and a finished epic along.
  state.issues = AFTER
  state.prs = []
  await $.command.run(REFRESH)
  await $.command.run(REFRESH)
  await $.command.run(REFRESH)

  expect(mutations()).toEqual([])
  // The epic still closes, which is the issue's own change, not the project's.
  expect(state.calls.some(call => call.argv.join(' ') === 'gh issue close 35 --reason completed')).toBe(true)
  // And /issues check says the project is read-only.
  expect((await $.command.run({ ...REFRESH, args: 'check' })).text).toMatch(/the board only reads Void Sector until you let it write there/)
  await ui.unmount()
})

test('the pane and the band ask once before writing, naming the project, its owner, what is written and what it costs; yes adopts it', async ($, on) => {
  const kept = new Map<string, unknown>()
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', async (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  const { mutations } = world(on)
  await $.command.run(REFRESH)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /^Let the board write to Void Sector, owned by astrosteveo\?$/ })).toBeDefined()
  expect(await band.find({ key: 'adopt-review' })).toBeDefined()
  await band.unmount()

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^⚠ Let the board write to Void Sector, owned by astrosteveo\?$/ })).toBeDefined()
  expect(await ui.find({ text: /^Until you say yes, the board only reads it\.$/ })).toBeDefined()
  expect(await ui.find({ text: /sets Status and Priority, adds issues as items, archives items when asked, and posts status updates/ })).toBeDefined()
  expect(await ui.find({ text: /^Each write is a GitHub API call made with your gh token\. The board reads GitHub every 5 minutes \(the refresh setting\)\.$/ })).toBeDefined()
  expect(mutations()).toEqual([])

  await ui.press({ key: 'adopt-yes' })
  expect((kept.get(KEY) as { adopted?: unknown }).adopted).toEqual(ADOPTED)
  expect(await ui.find({ key: 'adopt-card' })).toBeUndefined()

  // Writes go through now, to the adopted project.
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(mutations().map(call => call.argv.find(arg => arg.startsWith('project=')))).toEqual(['project=PVT_8'])
  await ui.unmount()
})

test('Keep read-only puts the prompt away for good and writes nothing', async ($, on) => {
  const kept = new Map<string, unknown>()
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', async (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  const { mutations } = world(on)
  // What the engine draws in the band when the board has nothing to say.
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'adopt-no' })
  expect(kept.get(KEY)).toMatchObject({ declined: ['PVT_8'] })
  expect((kept.get(KEY) as { adopted?: unknown }).adopted).toBeUndefined()
  expect(await ui.find({ key: 'adopt-card' })).toBeUndefined()
  await $.command.run(REFRESH)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'adopt-review' })).toBeUndefined()
  await band.unmount()
  expect(mutations()).toEqual([])
  await ui.unmount()
})

test('a repo whose saved setup names the project counts as adopted, with no prompt', EVERYTHING, async ($, on) => {
  mock.store(on, { [KEY]: { setup: { project: { id: PROJECT.id, number: 8, title: PROJECT.title }, status: null, priority: null, at: 0 } } })
  const { mutations } = world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'adopt-card' })).toBeUndefined()
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(mutations()).toHaveLength(1)
  await ui.unmount()
})

test('a released project stays read-only even with a saved setup that names it', async ($, on) => {
  mock.store(on, { [KEY]: { adopted: null, setup: { project: { id: PROJECT.id, number: 8, title: PROJECT.title }, status: null, priority: null, at: 0 } } })
  const { mutations } = world(on)
  await $.command.run(REFRESH)
  const update = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(update.deny).toMatch(/only reads Void Sector/)
  expect(mutations()).toEqual([])
})

test('the write check refuses any project but the adopted one, and says why and how to adopt', () => {
  const roadmap = { id: 'PVT_9', title: 'Roadmap' }
  expect(writeRefusal(ADOPTED, { id: 'PVT_8', title: 'Void Sector' })).toBeNull()
  expect(writeRefusal(null, roadmap)).toBe(
    'The issue board only reads Roadmap: nobody has let it write there. To let it, press Let it write where the issues pane or the band asks, or run /issues setup, pick the project and press Apply.',
  )
  expect(writeRefusal(ADOPTED, roadmap)).toBe('The issue board only reads Roadmap: the project it may write to for this repo is Void Sector. To switch, run /issues setup, pick Roadmap and press Apply.')
  // Setup making a new project touches none the person has.
  expect(writeRefusal(null, 'new')).toBeNull()
})

test('a saved setup counts as adopting its project, unless the project was released or another adopted', () => {
  const setup = { project: { id: 'PVT_8', title: 'Void Sector' } }
  expect(adoptedOf(undefined)).toBeNull()
  expect(adoptedOf({})).toBeNull()
  expect(adoptedOf({ setup })).toEqual({ id: 'PVT_8', title: 'Void Sector', owner: null })
  expect(adoptedOf({ setup, adopted: null })).toBeNull()
  expect(adoptedOf({ setup, adopted: { id: 'PVT_9', title: 'Roadmap', owner: 'x' } })).toEqual({ id: 'PVT_9', title: 'Roadmap', owner: 'x' })
})

test('a mutation is told apart from a read, as a field or on stdin', () => {
  expect(isMutation(['api', 'graphql', '-f', 'query=mutation($a: ID!) { x }'])).toBe(true)
  expect(isMutation(['api', 'graphql', '--input', '-'], JSON.stringify({ query: ' mutation { x }', variables: {} }))).toBe(true)
  expect(isMutation(['api', 'graphql', '--input', '-'], JSON.stringify({ query: 'query { x }', variables: { body: 'a mutation' } }))).toBe(false)
  expect(isMutation(['api', 'graphql', '-f', 'query=query { x }', '-f', 'body=mutation'])).toBe(false)
  expect(isMutation(['issue', 'edit', '1', '--body', 'mutation'])).toBe(false)
})

test('the warning names the owner from the project page, and the refresh rate as set', () => {
  expect(ownerOf('https://github.com/orgs/acme/projects/3')).toBe('acme')
  expect(ownerOf('https://github.com/users/astrosteveo/projects/8')).toBe('astrosteveo')
  expect(ownerOf('')).toBeNull()
  expect(adoptText({ title: 'Plan', url: '' }, null)).toMatchObject({ title: 'Let the board write to Plan?' })
  expect(adoptText({ title: 'Plan', url: '' }, 15).lines[2]).toMatch(/reads GitHub every 15 minutes/)
  expect(adoptText({ title: 'Plan', url: '' }, null).lines[2]).toMatch(/reads GitHub only when you refresh/)
})
