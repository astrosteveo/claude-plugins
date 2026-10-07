import { expect, mock, test } from 'claude-code/testing'

import { alertsOf, fixPrompt, matches, parseIssues, parsePrs, searched, tickBody, wentGreen, workerPrompt, workingSection } from '../hooks/parse'
import { optionId } from './graph'
import { KESSIK_BODY, adoptedStore, pr335 } from './github'
import { COMPOSE, REFRESH, REPO, engineBand } from './ui'
import { BAND, PANE, issue, other, world } from './void-sector'

// The pane, the band and the hint over the board, with the issues and tick tools that read and tick the same copy,
// and /issues help and check.

test('boxes tick in place, CRLF bodies included, and say which were missing', () => {
  const ticked = tickBody(KESSIK_BODY, [2, 3], true)
  expect(ticked.changed).toEqual([2, 3])
  expect(ticked.missing).toEqual([])
  expect(ticked.body).toBe('## Acceptance\r\n\r\n- [x] Layout in place\r\n- [x] Old saves load\r\n- [x] Goldens regenerated\r\n')
  expect(tickBody(KESSIK_BODY, [1], true).changed).toEqual([])
  expect(tickBody(KESSIK_BODY, [1], false).body).toMatch(/^- \[ \] Layout in place\r$/m)
  expect(tickBody(KESSIK_BODY, [4], true).missing).toEqual([4])
  expect(parseIssues(JSON.stringify([issue(KESSIK_BODY)]))[0]?.checks.map(check => check.done)).toEqual([true, false, false])
})

test('failing checks name their runs, and the Fix prompt hands Claude the log', () => {
  const [failing] = parsePrs(JSON.stringify([pr335('fail')]))
  expect(failing?.failing).toEqual(['build', 'lint'])
  expect(failing?.runs).toEqual([987])
  expect(failing?.sha).toBe('abc123')
  expect(fixPrompt(failing!)).toMatch(/The failing checks are build, lint\. Read the failure with `gh run view 987 --log-failed`, then fix it\.$/)
})

test('search, Mine, and CI that goes green', () => {
  const [kessik, asteroids] = parseIssues(JSON.stringify([issue(KESSIK_BODY), other]))
  expect(searched('kessik play', kessik!)).toBe(true)
  expect(searched('#289', asteroids!)).toBe(true)
  expect(searched('simulation', kessik!)).toBe(true)
  expect(searched('kessik bug', kessik!)).toBe(false)
  expect(matches('mine', kessik!, 'astrosteveo')).toBe(true)
  expect(matches('mine', asteroids!, 'astrosteveo')).toBe(false)
  expect(matches('mine', kessik!, null)).toBe(false)

  const board = (ci: 'pass' | 'pending') => ({ repo: 'r', issues: [], prs: parsePrs(JSON.stringify([pr335(ci)])), velocity: { closed: [], merged: [] }, fetchedAt: 0 })
  expect(wentGreen(board('pending'), board('pass')).map(one => one.number)).toEqual([335])
  expect(wentGreen(board('pass'), board('pass'))).toEqual([])
  expect(wentGreen(null, board('pass'))).toEqual([])
  expect(alertsOf(board('pass'), null, [], ['335-abc123']).map(alert => alert.key)).toEqual(['pass-335-abc123'])
  expect(alertsOf(board('pass'), null, ['pass-335-abc123'], ['335-abc123'])).toEqual([])
})

test('the working note says Closes only when every box is ticked, or nothing, as closesWhenTicked says', () => {
  const issue = { number: 315, title: 'Lay Kessik out', updatedAt: '' }
  const ticked = workingSection(issue, true)
  expect(ticked).toMatch(/^The person is working on GitHub issue #315: Lay Kessik out\./)
  expect(ticked).toMatch(/write `Closes #315` in its body only if every acceptance box of #315 is ticked by then\. Otherwise write `Refs #315`, so the issue stays open for what is left\./)
  expect(ticked).toMatch(/If the repository's contributing guidelines say otherwise, follow them\.$/)

  const none = workingSection(issue, false)
  expect(none).toMatch(/^The person is working on GitHub issue #315: Lay Kessik out\./)
  expect(none).toMatch(/moving its Status needs no permission\.$/)
  expect(none).not.toMatch(/Closes|Refs|pull request/)

  // The background agent follows the same rule.
  expect(workerPrompt(true)).toMatch(/Write `Closes #<number>` in its body only if every acceptance box is ticked by then, and `Refs #<number>` otherwise\./)
  expect(workerPrompt(false)).not.toMatch(/Closes|Refs/)
})

test('the issues tool lists the board, and the tick tool ticks a box on GitHub', async ($, on) => {
  adoptedStore(on)
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
  adoptedStore(on)
  const gh = world(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  await $.command.run(REFRESH)
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro', 'issue-board:capture'])

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
  expect(sections.map(section => section.id)).toEqual(['intro', 'issue-board:capture', 'issue-board:working'])
  expect(sections.at(-1)?.text).toMatch(/^The person is working on GitHub issue #315: Lay Kessik out for play\./)
  // Its own row starts with ▶, and no separate line says so. The row shows its pull request with CI, and its boxes as a
  // short bar and a count.
  expect(await ui.find({ text: /Working on/ })).toBeUndefined()
  expect((await ui.find({ key: 'row-315' }))?.text).toMatch(/^▶ #315 Lay Kessik out for play⇄ #335 ✓.*━━━ 2\/3 +\d+d✕$/)
  expect((await ui.findAll({ type: 'Text' })).filter(text => text.text === '▶ ')).toHaveLength(1)

  // Ticking the last box changes the issue, not the note, so the prompt cache holds.
  await ui.press({ key: 'box-315-2' })
  expect(await ui.find({ text: / 3\/3/ })).toBeDefined()
  expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toBe(sections.at(-1)?.text)

  // The ✕ at the end of the ▶ row stops tracking the issue: the ▶ and the ✕ go, and the prompt no longer names it.
  expect(await ui.find({ key: 'stop-289' })).toBeUndefined()
  await ui.press({ key: 'stop-315' })
  expect((await ui.find({ key: 'row-315' }))?.text).toMatch(/^ {2}#315 /)
  expect((await ui.findAll({ type: 'Text' })).filter(text => text.text === '▶ ')).toHaveLength(0)
  expect(await ui.find({ key: 'stop-315' })).toBeUndefined()
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro', 'issue-board:capture'])
  await ui.unmount()
})

test('the band says when CI passes and offers Merge; the issue Claude is on is in the pane, not the band', async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  engineBand(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  gh.prs = [pr335('pending')]
  await $.command.run(REFRESH)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: / ✓ CI / })).toBeUndefined()

  gh.prs = [pr335('pass')]
  await $.command.run(REFRESH)
  expect(await band.find({ text: / ✓ CI / })).toBeDefined()
  await band.press({ key: 'merge-335' })
  expect(sent.at(-1)).toMatch(/^Close out PR #335: Glide in to a planet/)
  await band.press({ key: 'dismiss-pass-335-abc123' })
  expect(await band.find({ text: / ✓ CI / })).toBeUndefined()

  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  // Progress isn't something to act on, so the band says nothing about it; the issue's ▶ row in the pane does.
  expect(await band.find({ key: 'engine' })).toBeDefined()
  expect(await band.find({ key: 'stop-315' })).toBeUndefined()
  expect(await pane.find({ text: /^▶ $/ })).toBeDefined()
  await pane.press({ key: 'stop-315' })
  expect(await pane.find({ key: 'stop-315' })).toBeUndefined()
  expect(await pane.find({ text: /^▶ $/ })).toBeUndefined()

  await pane.unmount()
  await band.unmount()
})

test('the issues tool reads a closed issue from GitHub, searches every issue, and filters the open ones by label', async ($, on) => {
  adoptedStore(on)
  mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  await $.command.run(REFRESH)

  // An issue the board doesn't hold is read from GitHub, with how it closed and its boxes.
  const closed = await $.tool.call({ tool: 'mcp__issue-board__issues', number: 290 })
  expect(String(closed.result)).toBe(
    [
      '#290 Dock the shuttle (closed as completed 1d ago)',
      'https://github.com/astrosteveo/void-sector/issues/290',
      'Labels: enhancement',
      'Assignees: astrosteveo',
      'Boxes (1/2 ticked):',
      '1. [x] Shipped',
      '2. [ ] Follow up',
      'Read the whole issue with `gh issue view 290`.',
      // A long thread: the latest ten, newest last, and how many earlier ones are left out.
      'Comments (the latest 10 of 12; 2 earlier left out):',
      ...Array.from({ length: 10 }, (_, index) => `— @${(index + 2) % 2 ? 'alice' : 'astrosteveo'}, 1h ago:\n  Note ${index + 3}.`),
    ].join('\n'),
  )
  // One read of the thread, of the page that holds its latest comments.
  expect(gh.commentReads).toEqual(['290 page 1'])

  // An open issue in full carries its comments too. One the board counts none on says so without reading GitHub.
  gh.comments[289] = [{ user: { login: 'alice' }, body: 'Seen it too.', created_at: '2026-10-04T09:30:00Z' }]
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', number: 289 })).result)).toMatch(/\nComments \(1\):\n— @alice, 30m ago:\n  Seen it too\.$/)
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', number: 315 })).result)).toMatch(/\nNo comments\.$/)
  expect(gh.commentReads).toEqual(['290 page 1', '289 page 1'])
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', number: 999 })).result)).toBe("#999 doesn't exist in astrosteveo/void-sector.")

  // Closed issues are GitHub's search to answer, one line each, without pull requests, and how many more there are.
  const found = await $.tool.call({ tool: 'mcp__issue-board__issues', state: 'closed', label: 'needs design' })
  expect(gh.searched.at(-1)).toBe('repo:astrosteveo/void-sector is:issue state:closed label:"needs design"')
  expect(String(found.result)).toBe('#290 Dock the shuttle · closed as completed 1d ago · enhancement\nShowing 1 of 45; narrow the search to see the rest.')
  await $.tool.call({ tool: 'mcp__issue-board__issues', search: 'shuttle dock', assignee: 'astrosteveo' })
  expect(gh.searched.at(-1)).toBe('repo:astrosteveo/void-sector is:issue assignee:astrosteveo shuttle dock')

  // Open issues still come from the board's copy, which a label or an assignee narrows.
  const open = await $.tool.call({ tool: 'mcp__issue-board__issues', label: 'bug' })
  expect(String(open.result)).toMatch(/#289/)
  expect(String(open.result)).not.toMatch(/#315 /)
})

test("the pane's Closed filter lists the issues closed lately, read from GitHub when chosen", async ($, on) => {
  adoptedStore(on)
  world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-closed' })
  expect(await ui.find({ text: /Dock the shuttle/ })).toBeDefined()
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  await ui.unmount()
})

test('/issues help names every filter and subcommand the board has, and the argument hint every subcommand', async ($, on) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  world(on)
  let hint = ''
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => {
    hint = e.argumentHint ?? ''
    return { value: { command: e.name } }
  })
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const help = String((await $.command.run({ ...REFRESH, args: 'help' })).text)

  for (const sub of ['refresh', 'new <what>', 'new epic <what>', 'setup', 'check', 'stats', 'help']) expect(help).toContain(`- /issues ${sub}: `)
  // Without a project there is no Inbox; every other filter is there.
  expect(help).toContain('Filters: 1 Active, 2 Future, 3 Bugs, 4 Mine, 5 All, 7 Closed.')
  expect(hint).toBe('[refresh | new | new epic | setup | statuses | labels | check | stats | help]')
  await clock.settle()
})

test('/issues with an unknown subcommand says so and points to /issues help', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  world(on)
  expect(String((await $.command.run({ ...REFRESH, args: 'refersh' })).text)).toBe('Unknown subcommand refersh; /issues help lists them.')
  expect(String((await $.command.run({ ...REFRESH, args: '  sttus now ' })).text)).toBe('Unknown subcommand sttus; /issues help lists them.')
  await clock.settle()
})

test('on a short pane the sections above the issues start folded to a summary, and stay as the person leaves them', async ($, on) => {
  adoptedStore(on)
  world(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const mount = (bodyRows: number) => $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows } } })

  // Short: folded, each a line that sums it up, and the rows beneath hidden.
  const short = await mount(20)
  expect(await short.find({ text: '▸ Pull requests' })).toBeDefined()
  expect(await short.find({ text: /^1 open · ✓ 1$/ })).toBeDefined()
  expect(await short.find({ text: '▸ Milestones' })).toBeDefined()
  expect(await short.find({ text: /^Launch 5\/7$/ })).toBeDefined()
  expect(await short.find({ key: 'pr-335' })).toBeUndefined()

  // Opened, the pull requests show, and stay open on a taller pane and a short one alike.
  await short.press({ key: 'section-prs' })
  expect(await short.find({ key: 'pr-335' })).toBeDefined()
  await short.unmount()
  const tall = await mount(60)
  expect(await tall.find({ key: 'pr-335' })).toBeDefined()
  expect(await tall.find({ text: '▾ Milestones' })).toBeDefined()
  // Folded on the tall pane, it stays folded.
  await tall.press({ key: 'section-milestones' })
  expect(await tall.find({ text: '▸ Milestones' })).toBeDefined()
  await tall.unmount()
})

test('the pane draws on every surface, with search where the surface has a text field', async ($, on) => {
  adoptedStore(on)
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
  adoptedStore(on)
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
  adoptedStore(on)
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
  adoptedStore(on)
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
  adoptedStore(on)
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

test('a feature a setting turned off is said in /issues check and /issues help, and nowhere else', { options: { band: false, refresh: 'manual', followBranch: false } }, async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.project = true
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)
  const said = String((await $.command.run({ ...REFRESH, args: 'check' })).text)
  expect(said).toContain('- The band above the prompt: turned off in /config by Band above the prompt (band).')
  expect(said).toContain('- Reading GitHub by itself: turned off in /config by How often the board reads GitHub (refresh).')
  expect(said).toContain('- Following the branch to the issue Claude is on: turned off in /config by Follow the branch (followBranch).')
  // The project has every Status, so nothing is off for want of one.
  expect(said).not.toContain('has no Status option')

  const help = String((await $.command.run({ ...REFRESH, args: 'help' })).text)
  expect(help).toMatch(/- The band above the prompt shows what needs you: .*\(off\)$/m)
  expect(help).toMatch(/- The hint line sums up what is open\.$/m)
  expect(help).toMatch(/- # in the prompt box offers the board's issues and pull requests\.$/m)
  expect(help).toContain('- Following the branch to the issue Claude is on: turned off in /config by Follow the branch (followBranch).')
  expect(help).toContain('\nOff:\n- Moving issues on their own: closed ones to Done, ones a Refs merge touched to Verification, and epics with their sub-issues: turned off in /config by Move issues on their own (autoMove).')
  expect(help).not.toContain('- Moving closed issues to Done:')
  expect(toasts.filter(text => /off|setting/i.test(text))).toEqual([])
  // The check reads GitHub again once it finds nothing missing: wait for that read.
  await $.command.run(REFRESH)
})
