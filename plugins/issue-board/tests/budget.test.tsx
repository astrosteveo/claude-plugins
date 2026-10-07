import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { countCall, countContext, countPoints, kindOf, newStats, statsText } from '../hooks/stats'
import { adoptedStore, graphPage, isIssuesQuery } from './graph'
import { letThrough } from './engine'
import { github } from './setup-github'

// What the board may spend. Each action below has a budget of GitHub calls, as `/issues stats` counts them, so a change
// that adds requests fails here and says by how many. Raise a budget only on purpose.

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const STATS = { ...REFRESH, args: 'stats' } as const
const SETUP = { ...REFRESH, args: 'setup' } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

const issue = {
  number: 315,
  title: 'Lay Kessik out for play',
  url: 'https://github.com/astrosteveo/void-sector/issues/315',
  labels: [{ name: 'enhancement', color: 'a2eeef' }],
  assignees: [],
  body: '## Acceptance\n\n- [ ] Layout in place\n- [ ] Old saves load\n',
  updatedAt: '2026-10-03T20:00:00Z',
  status: 'Ready',
  priority: 'P1',
}

const pr = {
  number: 335,
  title: 'Glide in to a planet',
  url: 'https://github.com/astrosteveo/void-sector/pull/335',
  headRefName: 'fix/planet-glide',
  headRefOid: 'abc123',
  isDraft: false,
  statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  reviewDecision: 'APPROVED',
  additions: 1,
  deletions: 1,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-03T20:00:00Z',
  body: 'Refs #315.',
  closingIssuesReferences: [],
}

// GitHub as the board reads and writes it, with every gh call kept. The cheap checks answer 304 while nothing changed.
const world = (on: On) => {
  adoptedStore(on)
  const state = { calls: [] as string[] }
  on('process.run', async (_$, e) => {
    const argv = e.argv
    if (argv[0] === 'gh') state.calls.push(argv.slice(1).join(' '))
    const answer = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer('main\n')
    if (argv[1] === 'api' && argv[2] === '-i') return argv.includes('If-None-Match: E1') ? answer('HTTP/2.0 304 Not Modified\n', 1) : answer('HTTP/2.0 200 OK\nEtag: E1\n\n[]')
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (argv[1] === 'auth') return answer(JSON.stringify({ hosts: { 'github.com': [{ state: 'success', active: true, login: 'astrosteveo', scopes: 'repo, read:org, project' }] } }))
    if (isIssuesQuery(argv)) return answer(graphPage([issue], argv, true))
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv.includes('--input')) {
      const asked = JSON.parse(e.init?.stdin ?? '{}') as { query: string; variables: Record<string, unknown> }
      if (asked.query.includes('projectItems')) return answer(JSON.stringify({ data: { node: { projectItems: { nodes: [{ id: 'PVTI_315', project: { id: 'PVT_8' } }] } } } }))
      if (asked.query.includes('fieldValues')) return answer(JSON.stringify({ data: { node: { fieldValues: { nodes: [] } } } }))
      return answer(JSON.stringify({ data: {} }))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql') {
      if (argv.some(arg => arg.includes('reviewThreads'))) return answer(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }))
      return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_315' } } } }))
    }
    if (argv[1] === 'api' && argv[2]?.includes('/milestones')) return answer('[]')
    if (argv[1] === 'api') return answer('astrosteveo\n')
    if (argv[1] === 'issue' && argv[2] === 'view') return answer(JSON.stringify({ id: 'I_315', body: issue.body, comments: [] }))
    if (argv[1] === 'issue' && argv[2] === 'list') return answer('[]')
    if (argv[1] === 'issue') return answer('')
    if (argv[1] === 'pr' && argv[2] === 'list' && argv.includes('open')) return answer(JSON.stringify([pr]))
    return answer('[]')
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.log', async () => ({ value: undefined }))
  on('ui.status', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('tool.call', { tool: 'TaskCreate' }, async () => ({ result: { task: { id: '1' } } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  letThrough(on)
  return state
}

type Counts = { rest: number; rest304: number; graphql: number; context: number; points: number }

// What `/issues stats` says the board has spent so far.
const spent = async ($: Parameters<TestBody>[0]): Promise<Counts & { text: string }> => {
  const text = String((await $.command.run(STATS)).text)
  const calls = /^GitHub calls: .* \(REST (\d+), REST 304 (\d+), GraphQL (\d+)\)$/m.exec(text)
  const context = /^Context added: ([\d,]+) characters/m.exec(text)
  const points = /^GraphQL points: ([\d,]+),/m.exec(text)
  const number = (value: string | undefined) => Number((value ?? '').replace(/,/g, ''))
  return { text, rest: number(calls?.[1]), rest304: number(calls?.[2]), graphql: number(calls?.[3]), context: number(context?.[1]), points: number(points?.[1]) }
}

const minus = (after: Counts, before: Counts): Counts => ({
  rest: after.rest - before.rest,
  rest304: after.rest304 - before.rest304,
  graphql: after.graphql - before.graphql,
  context: after.context - before.context,
  points: after.points - before.points,
})

test('each gh command counts as REST or GraphQL, and stats add up calls, points and context', () => {
  expect(kindOf(['api', 'graphql', '-f', 'query={ viewer { login } }'])).toBe('graphql')
  expect(kindOf(['api', 'repos/o/r/milestones'])).toBe('rest')
  expect(kindOf(['api', '-X', 'PATCH', 'repos/o/r/issues/1'])).toBe('rest')
  expect(kindOf(['issue', 'list'])).toBe('graphql')
  expect(kindOf(['pr', 'list'])).toBe('graphql')
  expect(kindOf(['repo', 'view'])).toBe('graphql')
  expect(kindOf(['repo', 'edit', 'o/r', '--enable-issues'])).toBe('rest')
  expect(kindOf(['label', 'create', 'bug'])).toBe('rest')
  expect(kindOf(['label', 'list'])).toBe('graphql')
  expect(kindOf(['auth', 'status'])).toBe('rest')
  expect(kindOf(['run', 'list'])).toBe('rest')

  const stats = newStats(Date.parse('2026-10-04T10:00:00Z'))
  countCall(stats, 'full read', 'graphql')
  countCall(stats, 'full read', 'rest')
  countCall(stats, 'poll', 'rest304')
  countCall(stats, 'poll', 'rest304')
  countPoints(stats, { cost: 2, remaining: 4990, resetAt: '2026-10-04T11:00:00Z' })
  countContext(stats, 'tool definitions', 4000)
  countContext(stats, 'issue copies', 250)
  stats.lastRead = { at: Date.parse('2026-10-04T11:00:00Z'), calls: { rest: 1, rest304: 0, graphql: 1 }, points: 2 }
  const text = statsText(stats, Date.parse('2026-10-04T12:00:00Z'))
  expect(text).toMatch(/^What the issue board cost since it loaded 2 h 0 min ago\.$/m)
  expect(text).toMatch(/^GitHub calls: 4, 2\.0 an hour \(REST 1, REST 304 2, GraphQL 1\)$/m)
  expect(text).toMatch(/^- full read: REST 1, REST 304 0, GraphQL 1\n- poll: REST 0, REST 304 2, GraphQL 0$/m)
  expect(text).toMatch(/^GraphQL points: 2, 1\.0 an hour\. 4,990 left until \d\d:\d\d\.$/m)
  expect(text).toMatch(/^Context added: 4,250 characters, 2,125 an hour\n- tool definitions: 4,000\n- issue copies: 250$/m)
  expect(text).toMatch(/^Last full read, 1 h 0 min ago: REST 1, REST 304 0, GraphQL 1; 2 points\.$/m)
  expect(statsText(newStats(0), 0)).toMatch(/^No full read has finished yet\.$/m)
})

test('the budget: a refresh, a Start, an issue_update and an idle hour', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await clock.settle()
  // What each action spent, as /issues stats counts it, and the gh commands it ran.
  const measure = async (act: () => Promise<unknown>) => {
    const before = await spent($)
    const mark = gh.calls.length
    await act()
    await clock.settle()
    const after = await spent($)
    // Every gh command is counted, once.
    expect(after.rest + after.rest304 + after.graphql).toBe(gh.calls.length)
    return { ...minus(after, before), ran: gh.calls.slice(mark), text: after.text }
  }
  // A refresh: the open pull requests, their review threads, the issues query and the milestones; the repo, the closed
  // and merged counts, and who you are are kept from the first read. Then one cheap check, which answers 304.
  const refresh = await measure(() => $.command.run(REFRESH))
  expect(calls(refresh)).toEqual({ rest: 1, rest304: 1, graphql: 3 })
  expect(refresh.points).toBe(1)
  expect(refresh.text).toMatch(/^Last full read, under a minute ago: REST 1, REST 304 0, GraphQL 3; 1 points\.$/m)

  // Start: the Status move, the assignment and a fresh look at the issue. It adds the start message and the working
  // note to Claude's context, and nothing else.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  const start = await measure(async () => {
    await ui.press({ key: 'start-315' })
    await $.prompt.compose(COMPOSE)
  })
  await ui.unmount()
  expect(calls(start)).toEqual({ rest: 0, rest304: 0, graphql: 3 })
  expect(start.context).toBeGreaterThan(0)
  expect(start.context).toBeLessThanOrEqual(600)
  expect(start.text).toMatch(/^- working note: \d+$/m)
  expect(start.text).toMatch(/^- start prompts: \d+$/m)
  // The working note goes once: a later request carries it again without adding to the count.
  const again = await measure(() => $.prompt.compose(COMPOSE))
  expect(again.context).toBe(0)

  // issue_update setting a Priority: one write, then the refresh that follows it.
  const update = await measure(() => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, priority: 'P0' }))
  expect(calls(update)).toEqual({ rest: 1, rest304: 1, graphql: 4 })
  expect(update.text).toMatch(/^- tool: REST 0, REST 304 0, GraphQL 1$/m)
  expect(update.text).toMatch(/^- tool results: \d+$/m)

  // A plan of two changes, approved at its prompt: each change's own write, then one refresh for them both, not one each.
  const plan = await measure(() =>
    $.tool.call({ tool: 'mcp__issue-board__project_plan', issues: [{ number: 315, reason: 'Back to planned.', status: 'Backlog', priority: 'P1' }] }),
  )
  expect(calls(plan)).toEqual({ rest: 1, rest304: 1, graphql: 5 })
  expect(plan.text).toMatch(/^- tool: REST 0, REST 304 0, GraphQL 3$/m)

  // An idle hour: a cheap check every five minutes, which answers 304 while nothing changed, and a full read every
  // fifteen. Nothing goes into Claude's context.
  const hour = await measure(() => clock.advance(60 * 60_000))
  expect(calls(hour)).toEqual({ rest: 4, rest304: 12, graphql: 14 })
  expect(hour.points).toBe(4)
  expect(hour.context).toBe(0)
  expect(hour.text).toMatch(/^- poll: REST 0, REST 304 8, GraphQL 0$/m)
  expect(hour.text).toMatch(/^What the issue board cost since it loaded 1 h 0 min ago\.$/m)
  expect(hour.text).toMatch(/^GraphQL points: 8, 8\.0 an hour\. 4,999 left until \d\d:\d\d\.$/m)
})

test("the budget: setup's Apply", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T03:00:00Z') })
  mock.store(on)
  const gh = github(on, { hasIssues: false, projects: [], labels: ['enhancement'], issues: [{ number: 1, items: [] }, { number: 2, items: [] }] })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  await $.command.run(SETUP)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  const before = await spent($)
  await ui.press({ key: 'setup-apply' })
  await clock.settle()
  const after = await spent($)
  await ui.unmount()
  expect(after.rest + after.rest304 + after.graphql).toBe(gh.calls.length)
  // Turning on issues and three labels over REST, ten project changes over GraphQL, then the full read that follows.
  expect(calls(minus(after, before))).toEqual({ rest: 7, rest304: 0, graphql: 16 })
  expect(after.text).toMatch(/^- setup: REST 4, REST 304 0, GraphQL 13$/m)
  expect(after.context).toBe(0)
})

const calls = ({ rest, rest304, graphql }: Counts) => ({ rest, rest304, graphql })
