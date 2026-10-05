import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  alertsOf,
  draftPrompt,
  fixPrompt,
  matches,
  parseDraft,
  parseIssues,
  parsePrs,
  searched,
  tickBody,
  wentGreen,
  workingSection,
} from '../hooks/parse'
import { PRIORITIES, STATUSES, asksProject, graphPage, isIssuesQuery, optionId } from './graph'

const BODY = '## Acceptance\r\n\r\n- [x] Layout in place\r\n- [ ] Old saves load\r\n- [ ] Goldens regenerated\r\n'

const issue = (body: string, updatedAt = '2026-10-03T20:00:00Z') => ({
  number: 315,
  title: 'Lay Kessik out for play',
  url: 'https://github.com/astrosteveo/void-sector/issues/315',
  labels: [{ name: 'area:simulation', color: '0e8a16' }, { name: 'enhancement', color: 'a2eeef' }],
  assignees: [{ login: 'astrosteveo' }],
  body,
  updatedAt,
})

const other = {
  number: 289,
  title: "Asteroids didn't draw",
  url: 'https://github.com/astrosteveo/void-sector/issues/289',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: [],
  body: null,
  updatedAt: '2026-10-02T20:00:00Z',
}

const pr = (ci: 'pass' | 'pending' | 'fail', sha = 'abc123') => ({
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

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

// GitHub and git as the board reads them, with what the tests change and what gh was asked to write.
// `project`: the repo has the Void Sector project, and `planned` is each issue's Status and Priority in it.
// `refuseProject`: what GitHub says to a query that asks for projects, as to a token without read:project.
const world = (on: On) => {
  const state = {
    body: BODY,
    prs: [pr('pass')] as unknown[],
    branch: 'fix/planet-glide',
    edits: [] as string[],
    created: [] as { argv: string[]; stdin?: string }[],
    prLists: 0,
    project: false,
    planned: {} as Record<number, { status?: string; priority?: string }>,
    refuseProject: '',
    fields: [] as Record<string, string>[],
    assigned: [] as number[],
  }
  on('process.run', async (_$, e) => {
    const argv = e.argv
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer(`${state.branch}\n`)
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (isIssuesQuery(argv)) {
      if (state.refuseProject && asksProject(argv)) return { value: { exitCode: 1, stdout: '', stderr: state.refuseProject, isStdoutTruncated: false, isStderrTruncated: false } }
      return answer(graphPage([{ ...issue(state.body), ...state.planned[315] }, { ...other, ...state.planned[289] }], argv, state.project))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql') {
      // A mutation: its `-f name=value` arguments, and the change it makes to the project.
      const args = Object.fromEntries(argv.flatMap((arg, index) => (argv[index - 1] === '-f' ? [arg.split(/=(.*)/s).slice(0, 2) as [string, string]] : [])))
      state.fields.push(args)
      if (args.query?.includes('addProjectV2ItemById')) return answer(JSON.stringify({ data: { addProjectV2ItemById: { item: { id: `PVTI_${args.content?.slice(2)}` } } } }))
      const number = Number(args.item?.slice('PVTI_'.length))
      const name = [...STATUSES, ...PRIORITIES].find(one => optionId(one) === args.option) ?? ''
      state.planned[number] = { ...state.planned[number], ...(args.field === 'F_status' ? { status: name } : { priority: name }) }
      return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: args.item } } } }))
    }
    if (argv[1] === 'api') return answer('astrosteveo\n')
    if (argv[1] === 'issue' && argv[2] === 'edit' && argv.includes('--add-assignee')) {
      state.assigned.push(Number(argv[3]))
      return answer('')
    }
    if (argv[1] === 'issue' && argv[2] === 'edit') {
      state.body = e.init?.stdin ?? ''
      state.edits.push(state.body)
      return answer('')
    }
    if (argv[1] === 'issue' && argv[2] === 'create') {
      state.created.push({ argv: [...argv], stdin: e.init?.stdin })
      return answer('https://github.com/astrosteveo/void-sector/issues/340\n')
    }
    if (argv[1] === 'issue' && argv[2] === 'view') {
      const fields = argv[argv.indexOf('--json') + 1]
      if (fields === 'id') return answer(JSON.stringify({ id: `I_${argv[3]}` }))
      return answer(JSON.stringify(fields === 'body' ? { body: state.body } : issue(state.body, '2026-10-04T09:00:00Z')))
    }
    if (argv.includes('closed') || argv.includes('merged')) return answer('[]')
    if (argv[1] === 'pr') state.prLists += 1
    return answer(JSON.stringify(argv[1] === 'issue' ? [issue(state.body), other] : state.prs))
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  return state
}

test('boxes tick in place, CRLF bodies included, and say which were missing', () => {
  const ticked = tickBody(BODY, [2, 3], true)
  expect(ticked.changed).toEqual([2, 3])
  expect(ticked.missing).toEqual([])
  expect(ticked.body).toBe('## Acceptance\r\n\r\n- [x] Layout in place\r\n- [x] Old saves load\r\n- [x] Goldens regenerated\r\n')
  expect(tickBody(BODY, [1], true).changed).toEqual([])
  expect(tickBody(BODY, [1], false).body).toMatch(/^- \[ \] Layout in place\r$/m)
  expect(tickBody(BODY, [4], true).missing).toEqual([4])
  expect(parseIssues(JSON.stringify([issue(BODY)]))[0]?.checks.map(check => check.done)).toEqual([true, false, false])
})

test('failing checks name their runs, and the Fix prompt hands Claude the log', () => {
  const [failing] = parsePrs(JSON.stringify([pr('fail')]))
  expect(failing?.failing).toEqual(['build', 'lint'])
  expect(failing?.runs).toEqual([987])
  expect(failing?.sha).toBe('abc123')
  expect(fixPrompt(failing!)).toMatch(/The failing checks are build, lint\. Read the failure with `gh run view 987 --log-failed`, then fix it\.$/)
})

test('search, Mine, and CI that goes green', () => {
  const [kessik, asteroids] = parseIssues(JSON.stringify([issue(BODY), other]))
  expect(searched('kessik play', kessik!)).toBe(true)
  expect(searched('#289', asteroids!)).toBe(true)
  expect(searched('simulation', kessik!)).toBe(true)
  expect(searched('kessik bug', kessik!)).toBe(false)
  expect(matches('mine', kessik!, 'astrosteveo')).toBe(true)
  expect(matches('mine', asteroids!, 'astrosteveo')).toBe(false)
  expect(matches('mine', kessik!, null)).toBe(false)

  const board = (ci: 'pass' | 'pending') => ({ repo: 'r', issues: [], prs: parsePrs(JSON.stringify([pr(ci)])), velocity: { closed: [], merged: [] }, fetchedAt: 0 })
  expect(wentGreen(board('pending'), board('pass')).map(one => one.number)).toEqual([335])
  expect(wentGreen(board('pass'), board('pass'))).toEqual([])
  expect(wentGreen(null, board('pass'))).toEqual([])
  expect(alertsOf(board('pass'), null, [], ['335-abc123']).map(alert => alert.key)).toEqual(['pass-335-abc123'])
  expect(alertsOf(board('pass'), null, ['pass-335-abc123'], ['335-abc123'])).toEqual([])
})

test('a draft reads back from JSON, keeping only labels the repository has', () => {
  expect(draftPrompt('', ['bug'])).toMatch(/from what we have discussed\..*only from this list, or none: bug\./)
  const reply = 'Here it is:\n{"title": "Saves drop the hangar", "body": "Loading loses it.\\n\\n## Acceptance\\n- [ ] Hangar loads", "labels": ["bug", "made-up"]}'
  expect(parseDraft(reply, ['bug', 'area:saves'])).toEqual({ title: 'Saves drop the hangar', body: 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads', labels: ['bug'] })
  expect(parseDraft('no json here', ['bug'])).toBeNull()
  expect(parseDraft('{"body": "no title"}', ['bug'])).toBeNull()
})

test('the working note says Closes only when every box is ticked, and Refs otherwise', () => {
  const note = workingSection({ number: 315, title: 'Lay Kessik out', updatedAt: '' })
  expect(note).toMatch(/^The person is working on GitHub issue #315: Lay Kessik out\./)
  expect(note).toMatch(/write `Closes #315` in its body only if every acceptance box of #315 is ticked by then\. Otherwise write `Refs #315`, so the issue stays open for what is left\./)
  expect(note).toMatch(/If the repository's contributing guidelines say otherwise, follow them\.$/)
})

test('the issues tool lists the board, and the tick tool ticks a box on GitHub', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  await $.command.run(REFRESH)

  const listed = await $.tool.call({ tool: 'mcp__issue-board__issues' })
  expect(listed.text ?? String(listed.result)).toMatch(/^astrosteveo\/void-sector: 2 open issues, 1 open pull requests/)
  expect(String(listed.result)).toMatch(/#335 Glide in to a planet \[branch fix\/planet-glide, CI pass, approved/)
  expect(String(listed.result)).toMatch(/#315 Lay Kessik out for play \[area:simulation, enhancement; 1\/3 boxes\]/)

  const bugs = await $.tool.call({ tool: 'mcp__issue-board__issues', filter: 'bugs' })
  expect(String(bugs.result)).not.toMatch(/#315/)

  const one = await $.tool.call({ tool: 'mcp__issue-board__issues', number: 315 })
  expect(String(one.result)).toMatch(/Boxes \(1\/3 ticked\):\n1\. \[x\] Layout in place\n2\. \[ \] Old saves load\n3\. \[ \] Goldens regenerated/)

  const ticked = await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [2] })
  expect(String(ticked.result)).toBe('Ticked box 2. #315 has 2/3 ticked.')
  expect(gh.edits).toEqual(['## Acceptance\r\n\r\n- [x] Layout in place\r\n- [x] Old saves load\r\n- [ ] Goldens regenerated\r\n'])

  const again = await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [2] })
  expect(String(again.result)).toMatch(/^Nothing changed: that box was already ticked\./)
  expect(gh.edits.length).toBe(1)

  const missing = await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [9] })
  expect(missing.deny).toMatch(/^Couldn't tick boxes on #315: #315 has 3 boxes, so there is no box 9$/)

  const after = await $.tool.call({ tool: 'mcp__issue-board__issues', number: 315 })
  expect(String(after.result)).toMatch(/Boxes \(2\/3 ticked\)/)
})

test('Start names the issue in the system prompt; the pane searches, filters Mine, marks the branch and ticks boxes', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  await $.command.run(REFRESH)
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  // The row marks this branch's pull request; its details say so in words, and which issue it is for.
  expect(await ui.find({ text: /^◆$/ })).toBeDefined()
  await ui.press({ key: 'pr-335' })
  expect(await ui.find({ text: /^· ◆ this branch$/ })).toBeDefined()
  expect(await ui.find({ text: /^· for #315$/ })).toBeDefined()
  await ui.press({ key: 'pr-335' })

  await ui.press({ key: 'filter-mine' })
  expect(await ui.find({ key: 'issue-315' })).toBeDefined()
  expect(await ui.find({ key: 'issue-289' })).toBeUndefined()

  await ui.press({ key: 'filter-all' })
  await ui.input({ key: 'search', text: 'asteroids', kind: 'change' })
  expect(await ui.find({ key: 'issue-289' })).toBeDefined()
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  await ui.input({ key: 'search', text: '', kind: 'change' })

  await ui.press({ key: 'issue-315' })
  await ui.press({ key: 'box-315-3' })
  expect(gh.edits.at(-1)).toMatch(/- \[x\] Goldens regenerated/)
  expect(await ui.find({ text: / 2\/3/ })).toBeDefined()

  await ui.press({ key: 'start-315' })
  expect(sent.at(-1)).toMatch(/^Let's start on #315/)
  const sections = (await $.prompt.compose(COMPOSE)).sections
  expect(sections.map(section => section.id)).toEqual(['intro', 'issue-board:working'])
  expect(sections.at(-1)?.text).toMatch(/^The person is working on GitHub issue #315: Lay Kessik out for play\./)
  expect(await ui.find({ text: /▶ Working on/ })).toBeDefined()
  // Its pull request, which refers to it, and that pull request's CI.
  expect(await ui.find({ text: /^PR #335 $/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ PASS$/ })).toBeDefined()

  // Ticking the last box changes the issue, not the note, so the prompt cache holds.
  await ui.press({ key: 'box-315-2' })
  expect(await ui.find({ text: / 3\/3/ })).toBeDefined()
  expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toBe(sections.at(-1)?.text)
  await ui.unmount()
})

test('the band says when CI passes and offers Merge, and shows the issue Claude is on', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  gh.prs = [pr('pending')]
  await $.command.run(REFRESH)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: / ✓ CI / })).toBeUndefined()

  gh.prs = [pr('pass')]
  await $.command.run(REFRESH)
  expect(await band.find({ text: / ✓ CI / })).toBeDefined()
  await band.press({ key: 'merge-335' })
  expect(sent.at(-1)).toMatch(/^Close out PR #335: Glide in to a planet/)
  await band.press({ key: 'dismiss-pass-335-abc123' })
  expect(await band.find({ text: / ✓ CI / })).toBeUndefined()

  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  expect(await band.find({ key: 'stop-315' })).toBeDefined()
  expect(await band.find({ text: / 1\/3/ })).toBeDefined()
  await band.press({ key: 'stop-315' })
  expect(await band.find({ key: 'stop-315' })).toBeUndefined()

  await pane.unmount()
  await band.unmount()
})

test('/issues new drafts an issue from the conversation and files it on request, into the project at Inbox', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  const asked: string[] = []
  on('model.fork', async (_$, e) => {
    asked.push(e.prompt)
    const text = JSON.stringify({ title: 'Saves drop the hangar', body: 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads', labels: ['enhancement', 'nope'] })
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.command.run(REFRESH)

  const reply = await $.command.run({ ...REFRESH, args: 'new the hangar vanishing on load' })
  expect(reply.text).toMatch(/^Drafting an issue/)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(asked.at(-1)).toMatch(/about: the hangar vanishing on load\./)
  expect(await ui.find({ text: /New issue · draft/ })).toBeDefined()
  expect(await ui.find({ text: /^Saves drop the hangar$/ })).toBeDefined()

  await ui.press({ key: 'draft-file' })
  expect(gh.created).toEqual([
    {
      argv: ['gh', 'issue', 'create', '--title', 'Saves drop the hangar', '--body-file', '-', '--label', 'enhancement'],
      stdin: 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads',
    },
  ])
  // Added to the project, then set to Inbox, whatever the project's own automation would set.
  expect(gh.fields.map(one => [one.content ?? one.item, one.option ?? null])).toEqual([
    ['I_340', null],
    ['PVTI_340', optionId('Inbox')],
  ])
  expect(await ui.find({ text: /New issue · draft/ })).toBeUndefined()
  await ui.unmount()
})

test('a new session paints the saved board and keeps the issue Claude was on', async ($, on) => {
  const saved = {
    board: {
      repo: 'astrosteveo/void-sector',
      issues: parseIssues(JSON.stringify([issue(BODY)])),
      prs: [],
      velocity: { closed: [], merged: [] },
      fetchedAt: Date.parse('2026-10-03T20:00:00Z'),
    },
    working: { number: 315, title: 'Lay Kessik out for play', updatedAt: '2026-10-03T20:00:00Z', sessionId: 'an-earlier-session' },
    dismissed: [],
    viewer: 'astrosteveo',
  }
  mock.store(on, { [`repo:${REPO.root}`]: saved })
  on('session.id', async () => ({ value: 'session-2' }))
  on('session.repo', async () => ({ value: REPO }))
  // GitHub can't be reached yet: what shows is what was saved.
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'stop-315' })).toBeDefined()
  // Another session started it, so this session's system prompt doesn't claim it.
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])
  await band.unmount()
})

test('the board looks again every 30 seconds while CI runs, and every 5 minutes otherwise', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.prs = [pr('pending')]
  await $.command.run(REFRESH)
  expect(gh.prLists).toBe(1)

  await clock.advance(30_000)
  expect(gh.prLists).toBe(2)

  gh.prs = [pr('pass')]
  await clock.advance(30_000)
  expect(gh.prLists).toBe(3)
  await clock.advance(4 * 60_000)
  expect(gh.prLists).toBe(3)
  await clock.advance(60_000)
  expect(gh.prLists).toBe(4)
})

test('the pane draws on every surface, with search where the surface has a text field', async ($, on) => {
  mock.store(on)
  world(on)
  await $.command.run(REFRESH)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'issue-board', surface, ...PANE })
    expect(await ui.find({ key: 'issue-315' })).toBeDefined()
    expect((await ui.find({ key: 'search' })) !== undefined).toBe(surface !== 'mobile')
    await ui.unmount()
  }
})

test("the project's Status groups the issues, Priority filters them, and the card and Start change both on GitHub", async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  // #315 is planned; #289 isn't in the project yet.
  gh.planned[315] = { status: 'Ready', priority: 'P1' }
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })

  // Priority filters: Now is P0 and P1, Later is P2; an issue with none is in neither.
  expect(await ui.find({ key: 'filter-active' })).toMatchObject({ text: 'Now 1' })
  expect(await ui.find({ key: 'filter-future' })).toMatchObject({ text: 'Later 0' })
  await ui.press({ key: 'filter-all' })

  // Grouped by Status by default, in the project's order, then No status.
  expect(await ui.find({ key: 'group-status' })).toMatchObject({ props: { variant: 'primary' } })
  const headings = async () => (await ui.findAll({ type: 'Text' })).map(text => text.text).filter(text => ['Ready', 'No status', 'simulation', 'other'].includes(text))
  expect(await headings()).toEqual(['Ready', 'No status'])
  // The row: its priority, and the pull request that refers to it with that pull request's CI. The pull request's row
  // names the issue.
  expect(await ui.find({ text: /^P1 $/ })).toBeDefined()
  expect(await ui.find({ text: /^⇄ #335 ✓$/ })).toBeDefined()
  expect(await ui.find({ text: /^→ #315$/ })).toBeDefined()

  await ui.press({ key: 'group-area' })
  expect(await headings()).toEqual(['simulation', 'other'])
  await ui.press({ key: 'group-status' })

  // The card's pickers set Priority on GitHub.
  await ui.press({ key: 'issue-315' })
  expect(await ui.find({ key: 'status-315-S2' })).toMatchObject({ text: 'Ready', props: { variant: 'primary' } })
  await ui.press({ key: 'priority-315-P0' })
  expect(gh.fields.at(-1)).toMatchObject({ project: 'PVT_8', item: 'PVTI_315', field: 'F_priority', option: optionId('P0') })
  expect(await ui.find({ text: /^P0 $/ })).toBeDefined()

  // Start on #289: it joins the project, moves to In progress, and is assigned to the person.
  await ui.press({ key: 'issue-289' })
  await ui.press({ key: 'start-289' })
  expect(sent.at(-1)).toMatch(/^Let's start on #289/)
  expect(gh.fields.at(-2)).toMatchObject({ project: 'PVT_8', content: 'I_289' })
  expect(gh.fields.at(-1)).toMatchObject({ item: 'PVTI_289', field: 'F_status', option: optionId('In progress') })
  expect(gh.assigned).toEqual([289])
  await ui.unmount()
})

test('Backlog is folded until opened, and Epic groups the issues under the epic they belong to', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Backlog', priority: 'P2' }
  gh.planned[289] = { status: 'Ready', priority: 'P1' }
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })

  expect(await ui.find({ key: 'fold-status:Backlog' })).toMatchObject({ text: '▸ Backlog' })
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  expect(await ui.find({ key: 'issue-289' })).toBeDefined()
  await ui.press({ key: 'fold-status:Backlog' })
  expect(await ui.find({ key: 'issue-315' })).toBeDefined()

  await ui.press({ key: 'group-epic' })
  expect(await ui.find({ text: /^No epic$/ })).toBeDefined()
  await ui.unmount()
})

test('a card stays open when a new Priority takes it out of the filter, and leaves when collapsed', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Ready', priority: 'P1' }
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'filter-active' })).toMatchObject({ text: 'Now 1' })

  await ui.press({ key: 'issue-315' })
  await ui.press({ key: 'priority-315-P2' })
  // P2 is Later, but the card being changed stays, saying so.
  expect(await ui.find({ key: 'start-315' })).toBeDefined()
  expect(await ui.find({ text: /^Not under Now any more\. It leaves the list when you collapse it\.$/ })).toBeDefined()
  expect(await ui.find({ key: 'filter-active' })).toMatchObject({ text: 'Now 0' })

  await ui.press({ key: 'close-315' })
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  await ui.unmount()
})

test("Merge all's confirm goes when the pull requests it waited on have merged, and sends nothing", async ($, on) => {
  mock.store(on)
  const gh = world(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'close-out-all' })
  expect(await ui.find({ key: 'close-out-all-yes' })).toBeDefined()

  // The pull request merges elsewhere while the confirm waits.
  gh.prs = []
  await $.command.run(REFRESH)
  expect(await ui.find({ key: 'close-out-all-yes' })).toBeUndefined()
  expect(await ui.find({ text: /^y merge every open PR/ })).toBeUndefined()
  expect(sent).toEqual([])
  await ui.unmount()
})
