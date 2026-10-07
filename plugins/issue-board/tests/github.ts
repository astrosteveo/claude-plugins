import type { On } from 'claude-code'

import { writesGitHub } from '../hooks/parse'
import { isMutation } from '../hooks/project'
import { PROJECT, graphPage, isIssuesQuery } from './graph'
import type { Raw, Views } from './graph'
import { REPO } from './ui'

// One fake GitHub for every test: git and gh as the board calls them, answered from a repo the test describes and
// changes as it goes. A test adds what only it needs as routes, which are asked first.

// A call the board made, with what it sent on stdin.
export type Call = { argv: readonly string[]; stdin?: string }

// What process.run answers: the command's output, or a refusal to run it at all.
export type Answer = { value: { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: false; isStderrTruncated: false } } | { deny: string }

// A route answers the calls it knows and leaves the rest, by returning nothing, to the routes after it and the defaults.
export type Route = (call: Call) => Answer | undefined | Promise<Answer | undefined>

export const ok = (stdout: string): Answer => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
export const fail = (stderr: string, stdout = ''): Answer => ({ value: { exitCode: 1, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
export const json = (value: unknown): Answer => ok(JSON.stringify(value))

// A call as one line, the way a list of what was sent shows it.
export const line = (call: Call): string => call.argv.join(' ')

// The repo as the fake has it. A test may change any of it between calls, and the next call sees the change.
export type GitHub = {
  // The repo's name, and whether its issues are on.
  repo: string
  hasIssues: boolean
  // The open issues, as `gh issue list --json` gives them with what the project holds, and the open pull requests.
  issues: Raw[]
  prs: unknown[]
  // The branch git has checked out, and who gh is signed in as.
  branch: string
  login: string
  // Whether the issues query gets the repo's project, and the project's views and extra fields.
  project: boolean
  views: Views
  // The repo's issue types, and its labels; left out, the issues query has none, as before the board read them.
  types: string[]
  labels: string[] | undefined
  // The ETag the cheap checks get. While a check sends it back, GitHub answers 304, nothing changed. Left null, a
  // check gets no status, so the board takes it as changed.
  etag: string | null
  // Every call, git's included, and the gh calls that change GitHub, in order.
  ran: Call[]
  writes: Call[]
}

export type Options = Partial<Omit<GitHub, 'ran' | 'writes'>> & { routes?: Route[] }

export const fakeGitHub = (on: On, options: Options = {}): GitHub => {
  const { routes = [], ...given } = options
  const gh: GitHub = {
    repo: 'astrosteveo/void-sector',
    hasIssues: true,
    issues: [],
    prs: [],
    branch: 'main',
    login: 'astrosteveo',
    project: false,
    views: {},
    types: [],
    labels: undefined,
    etag: null,
    ...given,
    ran: [],
    writes: [],
  }
  on('process.run', async (_$, e) => {
    const call: Call = { argv: [...e.argv], ...(e.init?.stdin === undefined ? {} : { stdin: e.init.stdin }) }
    const { argv } = call
    gh.ran.push(call)
    if (argv[0] === 'gh' && (writesGitHub(argv.join(' ')) || isMutation(argv.slice(1), call.stdin))) gh.writes.push(call)
    for (const route of routes) {
      const answer = await route(call)
      if (answer) return answer
    }
    if (argv[0] === 'git') return ok(`${gh.branch}\n`)
    if (argv[1] === 'repo' && argv[2] === 'view') return json({ nameWithOwner: gh.repo, hasIssuesEnabled: gh.hasIssues })
    if (argv[1] === 'api' && argv[2] === '-i' && gh.etag !== null) {
      if (argv.includes(`If-None-Match: ${gh.etag}`)) return fail('gh: HTTP 304', 'HTTP/2.0 304 Not Modified\n')
      return ok(`HTTP/2.0 200 OK\nEtag: ${gh.etag}\n\n[]`)
    }
    if (isIssuesQuery(argv)) return ok(graphPage(gh.issues, argv, gh.project, gh.types, gh.views, gh.labels))
    // The pull requests' review threads: none open.
    if (argv[1] === 'api' && argv[2] === 'graphql') return json({ data: { repository: { pullRequests: { nodes: [] } } } })
    if (argv[1] === 'pr' && argv[2] === 'list') return argv.includes('open') ? json(gh.prs) : ok('[]')
    if (argv[1] === 'api') return ok(`${gh.login}\n`)
    return ok('[]')
  })
  return gh
}

// The session the board runs in: its id, the folder and its repo, and a pane that opens where asked.
export const session = (on: On, id = 'session-1'): void => {
  on('session.id', async () => ({ value: id }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
}

// What the engine answers as a session starts and the board registers its command, tools and agent.
export const registrations = (on: On): void => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
}

// A store that keeps what it is given, as one machine's store would for every session on it, and that the test can
// read back. Asked for twice in a test, the second call adds its entries to the first's store.
const stores = new WeakMap<On, Map<string, unknown>>()
export const memoryStore = (on: On, entries: Readonly<Record<string, unknown>> = {}): Map<string, unknown> => {
  const had = stores.get(on)
  if (had) {
    for (const [key, value] of Object.entries(entries)) had.set(key, value)
    return had
  }
  const kept = new Map<string, unknown>(Object.entries(entries))
  stores.set(on, kept)
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', async (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', async (_$, e) => {
    kept.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', async () => ({ value: [...kept.keys()] }))
  return kept
}

// Every `$.config.set` the board made, answered as written, as Claude Code's settings would.
const logs = new WeakMap<On, { key: string; value: unknown }[]>()
export const settingsLog = (on: On): { key: string; value: unknown }[] => {
  const had = logs.get(on)
  if (had) return had
  const log: { key: string; value: unknown }[] = []
  logs.set(on, log)
  on('config.set', async (_$, e) => {
    log.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  return log
}

// The board writes only to a project the writeProjects setting lists. A test that has it write to the fake project
// uses this store in place of `mock.store`: the person's own settings list the fake project, until the board writes the
// setting, after which they hold what it wrote, as Claude Code's would. A test's fake world and the test itself may both
// ask for it; the second call adds its entries to the first's store.
export const ADOPTED = { id: PROJECT.id, title: PROJECT.title, owner: 'astrosteveo' }
const ADOPTED_KEY = 'astrosteveo/8'
const adopted = new WeakSet<On>()

export const adoptedStore = (on: On, entries: Readonly<Record<string, unknown>> = {}): Map<string, unknown> => {
  const kept = memoryStore(on, entries)
  if (adopted.has(on)) return kept
  adopted.add(on)
  const set = settingsLog(on)
  on('settings.read', async (_$, e) => {
    if (e.source !== 'user') return { value: {} }
    const written = set.filter(one => one.key === 'issue-board.writeProjects').at(-1)?.value
    return { value: { pluginConfigs: { 'issue-board@astrosteveo-plugins': { options: { writeProjects: written ?? ADOPTED_KEY } } } } }
  })
  return kept
}

// The plugins' state, held here by `plugin/key` so a test can read it or put something in it. A drawing isn't drawn
// again when a test changes the state itself, so a test that does mounts the pane afresh.
export const heldState = (on: On): Map<string, { value: unknown; version: number }> => {
  const held = new Map<string, { value: unknown; version: number }>()
  on('state.get', async (_$, e) => ({ value: held.get(`${e.plugin}/${e.key}`) ?? { value: undefined, version: 0 } }))
  on('state.set', async (_$, e) => {
    const version = (held.get(`${e.plugin}/${e.key}`)?.version ?? 0) + 1
    held.set(`${e.plugin}/${e.key}`, { value: e.value, version })
    return { value: { isSet: true as const, version } }
  })
  return held
}

// The issues and pull request most tests share, from the Void Sector repo: Kessik, an enhancement with three boxes,
// one ticked; the asteroids bug; and pull request #335, whose CI a test picks.
export const KESSIK_BODY = '## Acceptance\r\n\r\n- [x] Layout in place\r\n- [ ] Old saves load\r\n- [ ] Goldens regenerated\r\n'

export const KESSIK = {
  number: 315,
  title: 'Lay Kessik out for play',
  url: 'https://github.com/astrosteveo/void-sector/issues/315',
  labels: [
    { name: 'area:simulation', color: '0e8a16' },
    { name: 'enhancement', color: 'a2eeef' },
  ],
  assignees: [{ login: 'astrosteveo' }],
  body: KESSIK_BODY,
  updatedAt: '2026-10-03T20:00:00Z',
} satisfies Raw

export const ASTEROIDS = {
  number: 289,
  title: "Asteroids didn't draw",
  url: 'https://github.com/astrosteveo/void-sector/issues/289',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: [],
  body: null,
  updatedAt: '2026-10-02T20:00:00Z',
} satisfies Raw

export const pr335 = (ci: 'pass' | 'pending' | 'fail', sha = 'abc123') => ({
  number: 335,
  title: 'Glide in to a planet',
  url: 'https://github.com/astrosteveo/void-sector/pull/335',
  headRefName: 'fix/planet-glide',
  headRefOid: sha,
  isDraft: false,
  statusCheckRollup:
    ci === 'pass'
      ? [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }]
      : ci === 'pending'
        ? [{ name: 'build', status: 'IN_PROGRESS' }]
        : [
            { name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/987/job/1' },
            { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/987/job/2' },
          ],
  reviewDecision: 'APPROVED',
  additions: 1,
  deletions: 1,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-03T20:00:00Z',
  body: 'Glides in from cruise. Refs #315.',
  closingIssuesReferences: [],
})
