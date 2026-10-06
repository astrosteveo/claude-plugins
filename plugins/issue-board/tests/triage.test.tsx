import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { matches, parseIssues, parseTriage, triagePrompt } from '../hooks/parse'
import { PRIORITIES, STATUSES, graphPage, isIssuesQuery, optionId } from './graph'

const raw = (number: number, title: string, labels: string[] = []) => ({
  number,
  title,
  url: `https://github.com/astrosteveo/void-sector/issues/${number}`,
  labels: labels.map(name => ({ name, color: '0e8a16' })),
  assignees: [],
  body: `${title}, in more words.\n\n## Acceptance\n\n- [ ] It works`,
  updatedAt: '2026-10-03T20:00:00Z',
})

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }
const PROJECT = { id: 'PVT_8', number: 8, title: 'Void Sector', url: '', status: { id: 'F_status', options: STATUSES.map((name, index) => ({ id: `S${index}`, name })) }, priority: { id: 'F_priority', options: PRIORITIES.map((name, index) => ({ id: `P${index}`, name })) } }

// The Void Sector project: #340 sits in the Inbox, #341 isn't in the project yet, and #315 is Ready.
const world = (on: On, answer: string) => {
  const state = {
    planned: { 340: { status: 'Inbox' }, 315: { status: 'Ready', priority: 'P1' } } as Record<number, { status?: string; priority?: string }>,
    issues: [raw(340, 'Saves drop the hangar', ['area:simulation']), raw(341, 'The map key hides the legend'), raw(315, 'Lay Kessik out for play', ['area:simulation'])],
    fields: [] as Record<string, string>[],
    edits: [] as string[][],
    asked: [] as string[],
    blocks: [] as (readonly { text: string; cache?: true }[] | undefined)[],
  }
  on('process.run', async (_$, e) => {
    const argv = e.argv
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer('main\n')
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (isIssuesQuery(argv)) return answer(graphPage(state.issues.map(one => ({ ...one, ...state.planned[one.number] })), argv, true))
    if (argv[1] === 'api' && argv[2] === 'graphql') {
      const args = Object.fromEntries(argv.flatMap((arg, index) => (argv[index - 1] === '-f' ? [arg.split(/=(.*)/s).slice(0, 2) as [string, string]] : [])))
      if (args.query?.includes('reviewThreads')) return answer(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }))
      state.fields.push(args)
      if (args.query?.includes('addProjectV2ItemById')) return answer(JSON.stringify({ data: { addProjectV2ItemById: { item: { id: `PVTI_${args.content?.slice(2)}` } } } }))
      const number = Number(args.item?.slice('PVTI_'.length))
      const name = [...STATUSES, ...PRIORITIES].find(one => optionId(one) === args.option) ?? ''
      state.planned[number] = { ...state.planned[number], ...(args.field === 'F_status' ? { status: name } : { priority: name }) }
      return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: args.item } } } }))
    }
    if (argv[1] === 'api') return answer('astrosteveo\n')
    if (argv[1] === 'label') return answer(JSON.stringify(['bug', 'area:simulation', 'area:interface'].map(name => ({ name }))))
    if (argv[1] === 'issue' && argv[2] === 'edit') {
      state.edits.push([...argv])
      return answer('')
    }
    return answer('[]')
  })
  on('model.complete', async (_$, e) => {
    state.asked.push(e.prompt)
    state.blocks.push(e.promptBlocks)
    return { value: { isAnswered: true, text: answer, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  return state
}

const SUGGESTED = JSON.stringify([
  { number: 340, priority: 'P1', area: 'simulation', status: 'Ready', reason: 'Losing the hangar breaks saves people already have.' },
  { number: 341, priority: 'P2', area: 'area:interface', status: 'Backlog', reason: 'A small layout fix that can wait.' },
])

test('the Inbox holds issues with Status Inbox or none, and only with a project', () => {
  const [inbox, none, ready] = parseIssues(JSON.stringify([raw(1, 'a'), raw(2, 'b'), raw(3, 'c')])).map((issue, index) => ({ ...issue, status: ['Inbox', null, 'Ready'][index] }))
  expect([inbox, none, ready].map(issue => matches('inbox', issue!, null, PROJECT))).toEqual([true, true, false])
  expect(matches('inbox', none!, null, null)).toBe(false)
})

test("Claude's answer reads back as one suggestion an issue, with only the priorities and areas offered", () => {
  const issues = parseIssues(JSON.stringify([raw(340, 'Saves drop the hangar', ['area:simulation']), raw(341, 'The map key hides the legend')]))
  const priorities = [{ name: 'P0', description: 'Blocks the release' }, { name: 'P1', description: 'Planned work' }]
  const [rules, asked, ...more] = triagePrompt('astrosteveo/void-sector', issues, priorities, ['interface', 'simulation'])
  expect(more).toEqual([])
  // The rules are the cached first block: nothing in them names the repo or an issue.
  expect(rules!.cache).toBe(true)
  expect(rules!.text).toMatch(/^Triage the new GitHub issues listed below\. For each, suggest:\n- priority: one of P0 \(Blocks the release\), P1 \(Planned work\);/)
  expect(rules!.text).toMatch(/one of interface, simulation, or null when none fits;/)
  expect(rules!.text).not.toMatch(/void-sector|#340|hangar/)
  // Another repo's or another batch's ask opens with the very same rules, so it reads them from the cache.
  expect(triagePrompt('someone/else', issues.slice(1), priorities, ['interface', 'simulation'])[0]).toEqual(rules)
  // The issues follow, uncached, opening with their own blank line since the blocks are joined with nothing between.
  expect(asked!.cache).toBeUndefined()
  expect(asked!.text).toMatch(/^\n\nThe issues, of astrosteveo\/void-sector:\n\n#340 Saves drop the hangar\nLabels: area:simulation\. Priority: none\.\nSaves drop the hangar, in more words\./)
  expect(asked!.text).toMatch(/\n\n#341 The map key hides the legend\n/)

  const reply = `Here you go:\n[${[
    '{"number": 340, "priority": "p1", "area": "Simulation", "status": "ready", "reason": "Breaks\\n saves."}',
    '{"number": 341, "priority": "P7", "area": "nowhere", "reason": "Unclear."}',
    '{"number": 340, "priority": "P0"}',
    '{"number": 999, "priority": "P0"}',
  ].join(', ')}]`
  expect(parseTriage(reply, issues, ['P0', 'P1', 'P2'], ['interface', 'simulation'])).toEqual([
    { number: 340, priority: 'P1', area: 'simulation', status: 'Ready', reason: 'Breaks saves.', updatedAt: '2026-10-03T20:00:00Z' },
    { number: 341, priority: null, area: null, status: 'Backlog', reason: 'Unclear.', updatedAt: '2026-10-03T20:00:00Z' },
  ])
  expect(parseTriage('no json', issues, ['P0'], [])).toEqual([])
})

test('Claude suggests for each Inbox issue; the person changes a pick, and Accept moves it on to Ready or Backlog', async ($, on) => {
  mock.store(on)
  const gh = world(on, SUGGESTED)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })

  expect(await ui.find({ key: 'filter-inbox' })).toMatchObject({ text: 'Inbox 2' })
  await ui.press({ key: 'filter-inbox' })
  expect(gh.asked.length).toBe(1)
  expect(gh.asked[0]).toMatch(/#340 Saves drop the hangar/)
  expect(gh.asked[0]).toMatch(/#341 The map key hides the legend/)
  expect(gh.asked[0]).not.toMatch(/#315/)
  // Sent as two blocks: the rules marked for the cache, then the issues.
  expect(gh.blocks[0]?.map(block => block.cache ?? false)).toEqual([true, false])
  expect(gh.blocks[0]?.[0]?.text).not.toMatch(/#340/)
  expect(gh.blocks[0]?.[1]?.text).toMatch(/#340 Saves drop the hangar/)
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()

  // Claude's picks are highlighted, with its reason.
  expect(await ui.find({ key: 'triage-340-priority-P1' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'triage-340-area-simulation' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'triage-340-accept' })).toMatchObject({ text: '✓ Accept → Ready' })
  expect(await ui.find({ text: /✦ Losing the hangar breaks saves people already have\./ })).toBeDefined()
  expect(await ui.find({ key: 'triage-341-area-interface' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'triage-341-accept' })).toMatchObject({ text: '✓ Accept → Backlog' })

  // The person makes #340 P0 and accepts: Priority and Status set in the project; its area label it already had.
  await ui.press({ key: 'triage-340-priority-P0' })
  expect(await ui.find({ key: 'triage-340-priority-P0' })).toMatchObject({ props: { variant: 'primary' } })
  await ui.press({ key: 'triage-340-accept' })
  expect(gh.planned[340]).toEqual({ status: 'Ready', priority: 'P0' })
  expect(gh.edits).toEqual([])
  expect(await ui.find({ key: 'triage-340-accept' })).toBeUndefined()

  // #341 goes to Ready instead of Claude's Backlog: it joins the project first, and takes its area label.
  await ui.press({ key: 'triage-341-ready' })
  expect(gh.fields.find(one => one.content === 'I_341')).toBeDefined()
  expect(gh.planned[341]).toEqual({ status: 'Ready', priority: 'P2' })
  expect(gh.edits).toEqual([['gh', 'issue', 'edit', '341', '--add-label', 'area:interface']])
  expect(await ui.find({ text: /^Nothing open under Inbox\.$/ })).toBeDefined()

  // Nothing left to ask about: refreshes don't ask again.
  await $.command.run(REFRESH)
  expect(gh.asked.length).toBe(1)
  await ui.unmount()
})

test('a changed area replaces the old one, and an answer that fails says so and can be asked again', async ($, on) => {
  mock.store(on)
  const gh = world(on, 'Sorry, no JSON today.')
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-inbox' })
  expect(await ui.find({ text: /^Couldn't get suggestions: Claude's answer didn't come back as suggestions$/ })).toBeDefined()
  // Without a suggestion, the issue's own area is picked, and Status follows the Priority.
  expect(await ui.find({ key: 'triage-340-area-simulation' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'triage-340-accept' })).toMatchObject({ text: '✓ Accept → Backlog' })

  await ui.press({ key: 'triage-again' })
  expect(gh.asked.length).toBe(2)

  await ui.press({ key: 'triage-340-area-interface' })
  await ui.press({ key: 'triage-340-priority-P1' })
  expect(await ui.find({ key: 'triage-340-accept' })).toMatchObject({ text: '✓ Accept → Ready' })
  await ui.press({ key: 'triage-340-accept' })
  expect(gh.edits).toEqual([['gh', 'issue', 'edit', '340', '--add-label', 'area:interface', '--remove-label', 'area:simulation']])
  expect(gh.planned[340]).toEqual({ status: 'Ready', priority: 'P1' })
  await ui.unmount()
})
