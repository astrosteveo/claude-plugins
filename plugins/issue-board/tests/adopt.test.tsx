import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { adoptText, grantsOf, isMutation, ownerOf, projectKeysOf, projectKeysText, writeRefusal } from '../hooks/project'
import { namesText, projectPartOf, repoChangeOf } from '../hooks/parse'
import { letThrough, permissions } from './engine'
import { ADOPTED, fakeGitHub, json, memoryStore, ok, session, settingsLog } from './github'
import type { Route } from './github'
import { PROJECT, graphArg, isIssuesQuery } from './graph'
import type { Raw } from './graph'
import { REFRESH, REPO, band, engineBand, pane } from './ui'

const PANE = pane(120, 80)
const BAND = band(120)
const KEY = `repo:${REPO.root}`
const CHOICES = `choices:${REPO.root}`
// Every setting that has the board change the project by itself, on.
const EVERYTHING = { options: { autoMove: true, claimOnStart: true } }

const raw = (number: number, title: string, more: Partial<Raw> = {}): Raw => ({
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

// GitHub as the board sees it, answering every call, with each call kept. A GraphQL mutation is anything sent to
// `gh api graphql` that says `mutation`, in its arguments or on stdin, whichever path in the board sent it.
const world = (on: On, asks = false) => {
  // The project's item reads and its REST read, the merge of pull request #70 and the close of #60, a filed issue, and
  // each issue's body over REST, as a tick or an epic's close reads it and the PATCH that writes it.
  const route: Route = ({ argv, stdin }) => {
    if (argv[1] === 'api' && argv[2] === 'graphql' && !isIssuesQuery(argv)) {
      const text = `${argv.join(' ')} ${stdin ?? ''}`
      if (text.includes('addProjectV2ItemById')) return json({ data: { addProjectV2ItemById: { item: { id: 'PVTI_new' } } } })
      if (text.includes('fieldValues')) return json({ data: { node: { fieldValues: { nodes: [] } } } })
      if (text.includes('projectItems')) return json({ data: { node: { projectItems: { nodes: [] } } } })
      return undefined
    }
    if (argv[1] !== 'api') return undefined
    if (/\/pulls\/70$/.test(argv[2] ?? '')) return ok('2026-10-05T11:00:00Z\n')
    if (/\/issues\/60$/.test(argv[2] ?? '')) return json({ state: 'closed', state_reason: 'completed' })
    if (argv[2] === 'users/astrosteveo/projectsV2/8/fields?per_page=50') return json([{ id: 111, name: 'Status' }])
    if (argv[2]?.startsWith('users/astrosteveo/projectsV2/8/items')) {
      return json([{ node_id: 'PVTI_60', archived_at: null, content_type: 'Issue', content: { number: 60, title: 'Shuttle', state: 'closed', state_reason: 'completed', closed_at: '2026-09-01T10:00:00Z' }, fields: [{ name: 'Status', value: { name: { raw: 'Done' } } }] }])
    }
    if (argv[2] === '-X' && argv[3] === 'POST' && /\/issues$/.test(argv[4] ?? '')) {
      return json({ number: 80, id: 9080, node_id: 'I_80', html_url: 'https://github.com/astrosteveo/void-sector/issues/80', updated_at: '2026-10-05T10:00:00Z', labels: [], assignees: [] })
    }
    const rest = /\/issues\/(\d+)$/.exec((argv[2] === '-X' ? argv[4] : argv[2]) ?? '')
    if (rest && (argv.includes('{body, updated_at}') || argv[3] === 'PATCH')) {
      const found = state.issues.find(one => one.number === Number(rest[1])) ?? BEFORE.find(one => one.number === Number(rest[1]))
      return json({ title: found?.title ?? '', body: found?.body ?? '', updated_at: '2026-10-05T10:00:00Z' })
    }
    return undefined
  }
  const state = Object.assign(fakeGitHub(on, { issues: BEFORE, prs: [PR], project: true, routes: [route] }), { toasts: [] as string[] })
  session(on)
  // `asks` puts the engine's permission check beneath the write tools, to see which calls reach a prompt.
  const engine = asks ? permissions(on) : (letThrough(on), null)
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
  const mutations = () => state.ran.filter(call => call.argv.includes('graphql') && /\bmutation\b/.test(`${call.argv.join(' ')} ${call.stdin ?? ''}`))
  return { state, mutations, engine }
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
  expect(state.ran.some(call => call.argv.join(' ') === 'gh issue edit 43 --add-assignee @me')).toBe(true)
  expect(mutations()).toEqual([])

  // Triage's Accept.
  await ui.press({ key: 'filter-inbox' })
  await ui.press({ key: 'triage-50-accept' })
  expect(mutations()).toEqual([])

  // Every tool the board registers, each asked to change the project where it can.
  const tool = (name: string, input: Record<string, unknown>) => $.tool.call({ tool: `mcp__issue-board__${name}`, ...input })
  const update = await tool('issue_update', { number: 43, status: 'Done', priority: 'P0', fields: { Estimate: 3 } })
  expect(update.deny).toMatch(/^Couldn't set #43's Status, Priority and Estimate\. The issue board only reads Void Sector: nobody has let it write there\. To let it, press Let it write .*\/issues setup.*Apply\.$/)
  await tool('issue_update', { number: 43, fields: { Estimate: 3 } })
  await tool('issue_update', { number: 61, start: true })
  const created = await tool('issue_create', { title: 'New thing', body: '## Acceptance\n- [ ] Works', status: 'Ready', priority: 'P1' })
  expect(String(created.result)).toMatch(/only reads Void Sector/)
  await tool('issue_create', { title: 'Plain thing', body: 'Text' })
  const posted = await tool('project_status', { status: 'At risk', note: 'Slipping.' })
  expect(posted.deny).toMatch(/^Couldn't post the status update\. The issue board only reads Void Sector/)
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
  expect(state.ran.some(call => call.argv.join(' ') === 'gh issue close 35 --reason completed')).toBe(true)
  // And /issues check says the project is read-only.
  expect((await $.command.run({ ...REFRESH, args: 'check' })).text).toMatch(/the board only reads Void Sector until you let it write there/)
  await ui.unmount()
})

test("a change splits into the project's part, by name, and the repo's", () => {
  expect(projectPartOf({ status: 'Done', priority: 'P0', fields: { Estimate: 3 }, projectAfter: 0, addLabels: ['bug'] })).toEqual({
    project: ['Status', 'Priority', 'Estimate', 'place in the project'],
    repo: { addLabels: ['bug'] },
  })
  expect(repoChangeOf(projectPartOf({ status: 'Done' }).repo)).toBe(false)
  expect(repoChangeOf({ confirmTransfer: true })).toBe(false)
  expect(repoChangeOf({ comment: 'Seen it.' })).toBe(true)
  expect(namesText(['Status'])).toBe('Status')
  expect(namesText(['Status', 'Priority', 'Estimate'])).toBe('Status, Priority and Estimate')
})

test('on a project the board only reads, a write that is all project is refused before it asks; one that changes the repo too asks, and says what it skipped', async ($, on) => {
  mock.store(on)
  const { state, mutations, engine } = world(on, true)
  if (!engine) throw new Error('the engine beneath the tools is missing')
  await $.command.run(REFRESH)
  // The test asks tool.check first, as the engine does beneath the tool, and the engine answers by that verdict.
  const call = async (name: string, input: Record<string, unknown>) => {
    const tool = `mcp__issue-board__${name}` as const
    engine.verdict = (await $.tool.check({ tool, input })).decision
    return $.tool.call({ tool, ...input })
  }
  const reason = 'The issue board only reads Void Sector: nobody has let it write there\\. To let it, press Let it write'
  const projectOnly: [string, Record<string, unknown>, RegExp][] = [
    ['issue_update', { number: 43, status: 'Done' }, new RegExp(`^Couldn't set #43's Status\\. ${reason}`)],
    ['issue_update', { number: 43, priority: 'P0', fields: { Estimate: 3 } }, new RegExp(`^Couldn't set #43's Priority and Estimate\\. ${reason}`)],
    ['issue_update', { number: 43, projectAfter: 0 }, new RegExp(`^Couldn't set #43's place in the project\\. ${reason}`)],
    ['project_status', { status: 'At risk', note: 'Slipping.' }, new RegExp(`^Couldn't post the status update\\. ${reason}`)],
    ['project_archive', { number: 60, confirm: true }, new RegExp(`^Couldn't archive\\. ${reason}`)],
  ]
  for (const [name, input, refusal] of projectOnly) {
    engine.asked = []
    const answer = await call(name, input)
    expect(answer.deny).toMatch(refusal)
    // The person would have been asked, had the call gone on: nobody was.
    expect(engine.verdict).toBe('ask')
    expect(engine.asked).toEqual([])
  }

  // Labels and a comment are the repo's: the call asks, makes them, and says the Status was skipped.
  engine.asked = []
  const mixed = await call('issue_update', { number: 43, addLabels: ['bug'], comment: 'Seen it.', status: 'Done' })
  expect(engine.asked).toEqual(['mcp__issue-board__issue_update'])
  expect(String(mixed.result)).toMatch(new RegExp(`^#43 labelled bug.*\\nSkipped its Status: ${reason}`, 's'))
  expect(state.ran.some(one => one.argv.join(' ').startsWith('gh issue edit 43 --add-label bug'))).toBe(true)

  // Listing what an archive would take still answers, and says the archive would be refused.
  const listed = await call('project_archive', { number: 60 })
  expect(String(listed.result)).toMatch(new RegExp(`Call again with confirm: true to archive\\.\\nThe archive itself would be refused: ${reason}`))

  // A capture never needs the project, and a change with no project part goes through as before.
  const captured = await call('capture', { title: 'Hangar flickers', body: 'Seen while docking.' })
  expect(captured.deny).toBeUndefined()
  const labelled = await call('issue_update', { number: 43, addLabels: ['bug'] })
  expect(String(labelled.result)).toMatch(/^#43 labelled bug\.$/)
  expect(mutations()).toEqual([])
})

const WRITES_8 = { options: { writeProjects: 'astrosteveo/8' } }

test('the pane and the band ask once before writing, naming the project, its owner, what is written and what it costs; yes adopts it', async ($, on) => {
  memoryStore(on)
  const set = settingsLog(on)
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
  expect(set).toEqual([])

  await ui.press({ key: 'adopt-yes' })
  expect(set).toEqual([{ key: 'issue-board.writeProjects', value: 'astrosteveo/8' }])
  expect(await ui.find({ key: 'adopt-card' })).toBeUndefined()

  // Writes go through at once, to the adopted project, before Claude Code reloads the board with the new setting.
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(mutations().map(call => graphArg(call, 'project'))).toEqual(['project=PVT_8'])
  await ui.unmount()
})

test('Keep read-only puts the prompt away for good and writes nothing', async ($, on) => {
  const kept = memoryStore(on)
  const set = settingsLog(on)
  const { mutations } = world(on)
  engineBand(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'adopt-no' })
  expect(kept.get(CHOICES)).toEqual({ declined: ['PVT_8'] })
  expect(set).toEqual([])
  expect(await ui.find({ key: 'adopt-card' })).toBeUndefined()
  await $.command.run(REFRESH)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'adopt-review' })).toBeUndefined()
  await band.unmount()
  expect(mutations()).toEqual([])
  await ui.unmount()
})

test('a writeProjects entry that is not owner/number, or names the number under another owner, leaves the board read-only', { options: { ...EVERYTHING.options, writeProjects: '8, astrosteveo/eight, acme/8' } }, async ($, on) => {
  memoryStore(on)
  settingsLog(on)
  const { mutations } = world(on)
  await $.command.run(REFRESH)
  const update = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(update.deny).toMatch(/only reads Void Sector: nobody has let it write there/)
  expect(mutations()).toEqual([])
})

test('with astrosteveo/8 listed the board writes to project 8, with no prompt, and the store has no say', { options: { ...EVERYTHING.options, writeProjects: 'astrosteveo/8' } }, async ($, on) => {
  // A store an earlier board left saying the project was released counts for nothing once the setting names one.
  memoryStore(on, { [KEY]: { adopted: null } })
  const set = settingsLog(on)
  const { mutations } = world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'adopt-card' })).toBeUndefined()
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(mutations()).toHaveLength(1)
  expect(set).toEqual([])
  await ui.unmount()
})

test("a project another repo listed gives this repo's project nothing, and adopting here keeps it", { options: { writeProjects: 'acme/9' } }, async ($, on) => {
  memoryStore(on)
  const set = settingsLog(on)
  const { mutations } = world(on)
  await $.command.run(REFRESH)
  const update = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(update.deny).toMatch(/only reads Void Sector: nobody has let it write there/)
  expect(mutations()).toEqual([])
  // The pane still asks about this repo's project, and Let it write adds it beside the other repo's.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'adopt-yes' })
  expect(set).toEqual([{ key: 'issue-board.writeProjects', value: 'acme/9, astrosteveo/8' }])
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(mutations()).toHaveLength(1)
  await ui.unmount()
})

test("releasing this repo's project takes only it off the list, and leaves another repo's", { options: { writeProjects: 'acme/9, astrosteveo/8' } }, async ($, on) => {
  memoryStore(on)
  const set = settingsLog(on)
  const { mutations } = world(on)
  on('tool.check', async () => ({ decision: 'allow' as const }))
  await $.command.run(REFRESH)
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(mutations()).toHaveLength(1)
  await $.tool.call({ tool: 'mcp__issue-board__project_adopt', release: true })
  expect(set).toEqual([{ key: 'issue-board.writeProjects', value: 'acme/9' }])
  const update = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P1' })
  expect(update.deny).toMatch(/only reads Void Sector/)
  expect(mutations()).toHaveLength(1)
})

test("a project the repo's own settings grant needs no prompt, takes writes, and can't be released from the board", async ($, on) => {
  memoryStore(on)
  const set = settingsLog(on)
  const { mutations } = world(on)
  on('tool.check', async () => ({ decision: 'allow' as const }))
  // This repo's .claude/settings.json lists the project, as a list written by hand. The board's options don't carry
  // it, as Claude Code passes none for a value its /config row can't hold, and the person's own settings list nothing.
  on('settings.read', async (_$, e) => ({
    value: e.source === 'project' ? { pluginConfigs: { 'issue-board@astrosteveo-plugins': { options: { writeProjects: ['astrosteveo/8'] } } } } : {},
  }))
  engineBand(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'adopt-card' })).toBeUndefined()
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'adopt-review' })).toBeUndefined()
  await band.unmount()
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(mutations()).toHaveLength(1)
  const again = await $.tool.call({ tool: 'mcp__issue-board__project_adopt' })
  expect(again.deny).toBe('The board already writes to Void Sector; nothing changed.')
  const release = await $.tool.call({ tool: 'mcp__issue-board__project_adopt', release: true })
  expect(release.deny).toBe("This repo's .claude/settings.json lets the board write to Void Sector, so it can't be released here. To release it, take it out of writeProjects in that file.")
  expect(set).toEqual([])
  await ui.unmount()
})

test("adopting beside a repo's grant keeps the person's own entries and copies none of the repo's", async ($, on) => {
  memoryStore(on)
  const set = settingsLog(on)
  const { mutations } = world(on)
  on('tool.check', async () => ({ decision: 'allow' as const }))
  // The repo grants another project; the person's user settings list one more, which the merged options may hide.
  on('settings.read', async (_$, e) => ({
    value:
      e.source === 'project'
        ? { pluginConfigs: { 'issue-board@astrosteveo-plugins': { options: { writeProjects: 'acme/9' } } } }
        : e.source === 'user'
          ? { pluginConfigs: { 'issue-board@astrosteveo-plugins': { options: { writeProjects: 'acme/3' } } } }
          : {},
  }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'adopt-yes' })
  expect(set).toEqual([{ key: 'issue-board.writeProjects', value: 'acme/3, astrosteveo/8' }])
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(mutations()).toHaveLength(1)
  await ui.unmount()
})

test('what an earlier board left in the shared entry grants nothing and chooses nothing', async ($, on) => {
  // An adoption, a setup that names the project, and choices, as boards before 0.62 kept them.
  memoryStore(on, {
    [KEY]: { adopted: ADOPTED, setup: { project: { id: PROJECT.id, number: 8, title: PROJECT.title }, status: null, priority: null, at: 0 }, declined: [PROJECT.id] },
  })
  const set = settingsLog(on)
  const { mutations } = world(on)
  await $.command.run(REFRESH)
  const update = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })
  expect(update.deny).toMatch(/only reads Void Sector/)
  expect(mutations()).toEqual([])
  expect(set).toEqual([])
  // The decline there doesn't put the prompt away either: it asks once more.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'adopt-card' })).toBeDefined()
  await ui.unmount()
})

const CHOSEN = { declined: ['PVT_9'], statuses: { PVT_8: { ready: 'S0', done: 'S2' } }, guessSeen: ['PVT_8:ready=S0'] }

test("the shared entry holds only the cached board, and saving it leaves the person's choices alone", WRITES_8, async ($, on) => {
  const kept = memoryStore(on, { [CHOICES]: CHOSEN })
  settingsLog(on)
  world(on)
  await $.command.run(REFRESH)
  expect((kept.get(KEY) as { board: unknown }).board).not.toBeNull()
  expect(Object.keys(kept.get(KEY) as object).sort()).toEqual(['board', 'dismissed', 'sections', 'version', 'viewer', 'working'])
  expect(kept.get(CHOICES)).toEqual(CHOSEN)
})

test('two sessions changing different choices keep both', async ($, on) => {
  const kept = memoryStore(on)
  settingsLog(on)
  world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  // Another session saves a Status mapping after this one last read the store; this one turns its prompt down.
  kept.set(CHOICES, { ...((kept.get(CHOICES) as object | undefined) ?? {}), statuses: { PVT_9: { ready: 'S1' } } })
  await ui.press({ key: 'adopt-no' })
  expect(kept.get(CHOICES)).toEqual({ statuses: { PVT_9: { ready: 'S1' } }, declined: ['PVT_8'] })
  // And the other way: another session answers a guess, then this one adopts, which takes the project off the declines.
  kept.set(CHOICES, { ...(kept.get(CHOICES) as object), guessSeen: ['PVT_9:ready=S1'] })
  await $.tool.call({ tool: 'mcp__issue-board__project_adopt' })
  expect(kept.get(CHOICES)).toEqual({ statuses: { PVT_9: { ready: 'S1' } }, guessSeen: ['PVT_9:ready=S1'], declined: [] })
  await ui.unmount()
})

test('the write check refuses any project the list lacks, by owner and number, and says why and how to adopt', () => {
  const voidSector = { number: 8, title: 'Void Sector', url: PROJECT.url }
  const roadmap = { number: 9, title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/9' }
  expect(writeRefusal(['astrosteveo/8'], voidSector)).toBeNull()
  expect(writeRefusal(['acme/9', 'astrosteveo/8'], roadmap)).toBeNull()
  const refused = 'The issue board only reads Roadmap: nobody has let it write there. To let it, press Let it write where the issues pane or the band asks, or run /issues setup, pick the project and press Apply.'
  expect(writeRefusal([], roadmap)).toBe(refused)
  // The same number under another owner is another project.
  expect(writeRefusal(['astrosteveo/9'], roadmap)).toBe(refused)
  // Setup making a new project touches none the person has.
  expect(writeRefusal([], 'new')).toBeNull()
})

test('the setting reads as owner/number keys', () => {
  expect(projectKeysOf(['astrosteveo/9', 'AstroSteveo/8', ' acme/12 '])).toEqual(['astrosteveo/9', 'astrosteveo/8', 'acme/12'])
  expect(projectKeysOf(['astrosteveo/9', 'astrosteveo/9'])).toEqual(['astrosteveo/9'])
  expect(projectKeysOf('astrosteveo/9, acme/3')).toEqual(['astrosteveo/9', 'acme/3'])
  expect(projectKeysOf(['9', 'astrosteveo/0', 'astrosteveo/nine', '/9', 'a/b/9', 7])).toEqual([])
  expect(projectKeysOf(undefined)).toEqual([])
  // The /config row's text, and a list written by hand whose entries may hold commas too.
  expect(projectKeysOf(' astrosteveo/9,acme/3 , acme/4 ')).toEqual(['astrosteveo/9', 'acme/3', 'acme/4'])
  expect(projectKeysOf('')).toEqual([])
  expect(projectKeysOf(['astrosteveo/9, acme/3'])).toEqual(['astrosteveo/9', 'acme/3'])
  expect(projectKeysText(['astrosteveo/9', 'acme/3'])).toBe('astrosteveo/9, acme/3')
  expect(projectKeysOf(projectKeysText(['astrosteveo/9', 'acme/3']))).toEqual(['astrosteveo/9', 'acme/3'])
  // The person's list is their user file and the session's value, less what the repo grants; the board may write to both.
  expect(grantsOf(['acme/9', 'astrosteveo/8'], ['acme/3'], ['acme/9'])).toEqual({ own: ['acme/3', 'astrosteveo/8'], repo: ['acme/9'], all: ['acme/3', 'astrosteveo/8', 'acme/9'] })
  expect(grantsOf([], [], [])).toEqual({ own: [], repo: [], all: [] })

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
