import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { authOf, deniedOf, problemsOf, repoOf } from '../hooks/access'

const STORED = '/home/someone/.config/gh/hosts.yml'
const account = (fields: Record<string, unknown>) => JSON.stringify({ hosts: { 'github.com': [{ state: 'success', active: true, host: 'github.com', login: 'astrosteveo', gitProtocol: 'https', ...fields }] } })
const REPO = { nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true, viewerPermission: 'ADMIN', isArchived: false, visibility: 'PUBLIC' }

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const
const RUN = { command: 'issues', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

test('gh auth status reads as signed in, signed out, refused, or unknown', () => {
  expect(authOf(account({ tokenSource: 'GH_TOKEN', scopes: 'gist, project, repo' }))).toEqual({ state: 'signed-in', login: 'astrosteveo', source: 'GH_TOKEN', scopes: ['gist', 'project', 'repo'] })
  // A fine-grained token lists no scopes, so what it may do isn't known ahead.
  expect(authOf(account({ tokenSource: STORED, scopes: '' }))).toEqual({ state: 'signed-in', login: 'astrosteveo', source: STORED, scopes: null })
  expect(authOf('{"hosts":{}}')).toEqual({ state: 'signed-out' })
  expect(authOf(account({ state: 'error', login: '', tokenSource: 'GH_TOKEN', error: 'non-200 OK status code: 401 Unauthorized body: "Bad credentials"' }))).toEqual({ state: 'refused', source: 'GH_TOKEN' })
  // Offline reads as an error too, and isn't the token's fault.
  expect(authOf(account({ state: 'error', login: '', tokenSource: 'GH_TOKEN', error: 'dial tcp: connect: connection refused' }))).toBeNull()
  expect(authOf('[]')).toBeNull()
  expect(authOf('unknown flag: --json')).toBeNull()
})

test('a gh error names the permission it lacked', () => {
  expect(deniedOf('error: your authentication token is missing required scopes [read:project]')).toEqual(['read:project'])
  expect(deniedOf("GraphQL: Your token has not been granted the required scopes to execute this query. The 'projectsV2' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['repo'] scopes.")).toEqual(['read:project'])
  expect(deniedOf('HTTP 404: Not Found')).toEqual([])
})

test('problems say what is missing, and the fix fits where the token comes from', () => {
  const repo = repoOf(JSON.stringify(REPO))
  const signedIn = (source: string, scopes: string[] | null) => ({ state: 'signed-in' as const, login: 'astrosteveo', source, scopes })

  expect(problemsOf({ installed: false, auth: null, repo: null }).map(one => one.id)).toEqual(['gh-missing'])
  expect(problemsOf({ installed: true, auth: { state: 'signed-out' }, repo: null })[0]).toMatchObject({ id: 'signed-out', command: 'gh auth login', blocks: true })
  expect(problemsOf({ installed: true, auth: { state: 'refused', source: 'GH_TOKEN' }, repo: null })[0]).toMatchObject({ title: "The token in GH_TOKEN doesn't work", url: 'https://github.com/settings/tokens' })
  expect(problemsOf({ installed: true, auth: signedIn(STORED, ['repo']), repo })).toEqual([])

  // A saved login can be refreshed; a token in a variable can't, so the fix is its settings page.
  const missing = 'error: your authentication token is missing required scopes [read:project]'
  expect(problemsOf({ installed: true, auth: signedIn(STORED, ['repo']), repo, message: missing })[0]).toMatchObject({ id: 'scope-read:project', command: 'gh auth refresh -s read:project', blocks: true })
  const variable = problemsOf({ installed: true, auth: signedIn('GH_TOKEN', ['repo']), repo, message: missing })[0]
  expect(variable?.command).toBeUndefined()
  expect(variable?.fix).toMatch(/^Add read:project to the token in GH_TOKEN at https:\/\/github\.com\/settings\/tokens\. gh can't change/)

  // public_repo is enough for a public repository, not a private one.
  expect(problemsOf({ installed: true, auth: signedIn(STORED, ['public_repo']), repo })).toEqual([])
  const secret = repoOf(JSON.stringify({ ...REPO, visibility: 'PRIVATE' }))
  expect(problemsOf({ installed: true, auth: signedIn(STORED, ['public_repo']), repo: secret })[0]).toMatchObject({ id: 'scope-repo', command: 'gh auth refresh -s repo' })

  const reader = repoOf(JSON.stringify({ ...REPO, viewerPermission: 'READ', hasIssuesEnabled: false }))
  expect(problemsOf({ installed: true, auth: signedIn(STORED, ['repo']), repo: reader }).map(one => [one.id, one.blocks, one.command])).toEqual([
    ['read-only', false, undefined],
    ['issues-off', false, undefined],
  ])
  const off = repoOf(JSON.stringify({ ...REPO, hasIssuesEnabled: false }))
  expect(problemsOf({ installed: true, auth: signedIn(STORED, ['repo']), repo: off })[0]).toMatchObject({ id: 'issues-off', command: 'gh repo edit astrosteveo/void-sector --enable-issues' })
})

// gh as the check sees it: what `gh auth status` and `gh repo view` say, and an error every other call fails with.
const gh = (on: On, remote = 'git@github.com:astrosteveo/void-sector.git') => {
  const state = { auth: account({ tokenSource: STORED, scopes: 'gist, read:org, repo, workflow' }), repo: JSON.stringify(REPO), failure: '', missing: false, copied: [] as string[] }
  on('process.run', async (_$, e) => {
    const answer = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'git') return answer('main\n')
    if (state.missing) return { deny: 'Executable not found in $PATH: "gh"' }
    if (e.argv[1] === 'auth') return answer(state.auth)
    if (e.argv[1] === 'repo') return answer(state.repo)
    if (state.failure) return answer('', 1, state.failure)
    return answer(e.argv[1] === 'api' ? 'astrosteveo\n' : '[]')
  })
  on('session.repo', async () => ({ value: { root: '/work/void-sector', remote, internal: false, name: null } }))
  on('session.root', async () => ({ value: '/work/void-sector' }))
  on('ui.copy', async (_$, e) => {
    state.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  return state
}

test('a missing permission shows in the band, the hint and the pane, with the command that fixes it', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  const world = gh(on)
  world.failure = 'error: your authentication token is missing required scopes [read:project]\nTo request it, run:  gh auth refresh -s read:project'

  await $.command.run({ ...RUN, args: 'refresh' })
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: / ⚠ SETUP / })).toBeDefined()
  expect(await band.find({ text: /^gh's token is missing the read:project permission$/ })).toBeDefined()
  await band.press({ key: 'copy-fix-scope-read:project' })
  expect(world.copied).toEqual(['gh auth refresh -s read:project'])

  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /✗ Setup needed/ })).toBeDefined()
  expect(await pane.find({ text: /^Run `gh auth refresh -s read:project` in a terminal/ })).toBeDefined()

  // Fixed: Check again finds nothing missing and reads GitHub.
  world.failure = ''
  await band.press({ key: 'recheck-scope-read:project' })
  await clock.settle()
  expect(await band.find({ text: / ⚠ SETUP / })).toBeUndefined()
  expect(await pane.find({ text: /Setup needed/ })).toBeUndefined()
  await pane.unmount()
  await band.unmount()
})

test('a problem that only limits the board can be waved off, and the hint goes with it', async ($, on) => {
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  // What the engine draws: its hint, then ` · ` and the tail the plugins added.
  on('ui.render', { component: 'PromptHint' }, async ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{e.props.tail ? `${e.props.hint} · ${e.props.tail}` : e.props.hint}</Text>
  })
  const world = gh(on)
  world.repo = JSON.stringify({ ...REPO, viewerPermission: 'READ' })

  const reply = await $.command.run({ ...RUN, args: 'check' })
  expect(reply.text).toMatch(/^The issue board found one problem:\n- You have read access to astrosteveo\/void-sector\. Ticking boxes and merging pull requests need write access\. Ask an owner/)

  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  const hint = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...HINT })
  expect(await hint.drawn()).toMatchObject({ type: 'Text', children: ['? for shortcuts · issue board is limited (/issues check)'] })
  await band.press({ key: 'dismiss-access-read-only' })
  expect(await band.find({ text: / ⚠ SETUP / })).toBeUndefined()
  expect(await hint.drawn()).toMatchObject({ type: 'Text', children: ['? for shortcuts'] })
  await hint.unmount()
  await band.unmount()
})

test('without gh the band says so, and Claude gets the same fix', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  const world = gh(on)
  world.missing = true

  const reply = await $.command.run({ ...RUN, args: 'check' })
  expect(reply.text).toMatch(/GitHub's gh tool isn't installed\. The board reads GitHub through gh\. Install it from cli\.github\.com/)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /^GitHub's gh tool isn't installed$/ })).toBeDefined()
  await band.unmount()

  // The issues tool hands Claude the same fix.
  const listed = await $.tool.call({ tool: 'mcp__issue-board__issues' })
  expect(listed.deny).toMatch(/GitHub's gh tool isn't installed\..*Install it from cli\.github\.com/)
  await clock.settle()
})

test('a folder whose repository is elsewhere has nothing missing', async ($, on) => {
  mock.store(on)
  const world = gh(on, 'git@gitlab.com:someone/thing.git')
  world.missing = true
  const reply = await $.command.run({ ...RUN, args: 'check' })
  expect(reply.text).toBe("The issue board couldn't find a GitHub repository for this folder, so it has nothing to show.")
})

test("offline in a GitHub repository, nothing is missing and the check says it couldn't reach GitHub", async ($, on) => {
  mock.store(on)
  const world = gh(on)
  const offline = 'Post "https://api.github.com/graphql": dial tcp: connect: connection refused'
  world.auth = account({ state: 'error', login: '', tokenSource: 'GH_TOKEN', error: offline })
  world.repo = ''
  const reply = await $.command.run({ ...RUN, args: 'check' })
  expect(reply.text).toBe("gh couldn't read this folder's GitHub repository. Check your connection, then run /issues check again.")
})

test('/issues check says who gh is and what access it has when nothing is missing', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const world = gh(on)
  world.auth = account({ tokenSource: 'GH_TOKEN', scopes: 'project, repo' })
  const reply = await $.command.run({ ...RUN, args: 'check' })
  expect(reply.text).toBe('The issue board has what it needs. gh is signed in as astrosteveo, with admin access to astrosteveo/void-sector.')
  await clock.settle()
})
