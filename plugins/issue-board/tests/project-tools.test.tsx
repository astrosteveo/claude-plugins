import { expect, mock, test } from 'claude-code/testing'

import { projectPathOf } from '../hooks/parse'
import { adoptedStore } from './github'
import { HINT, REFRESH, engineHint } from './ui'
import { PANE, savedRoles, world } from './void-sector'

// The tools that read and change the project: Status lists, field values, archive, status updates, the permission
// each write asks for, and a project's own Status names.

test("the issues tool lists the project's issues at a Status, closed ones included, read over REST", async ($, on) => {
  adoptedStore(on)
  mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  await $.command.run(REFRESH)
  const list = async (fields: Record<string, unknown>) => String((await $.tool.call({ tool: 'mcp__issue-board__issues', ...fields })).result)

  // What shipped since a date: Done, closed on or after it, without pull requests.
  expect(await list({ status: 'Done', since: '2026-10-01' })).toBe('Void Sector at Done, closed since 2026-10-01 (1):\n#290 Dock the shuttle · closed as completed 1d ago')
  expect(await list({ status: 'verification' })).toBe('Void Sector at verification (1):\n#315 Lay Kessik out for play · open')
  expect(await list({ status: 'Ready' })).toBe('Nothing in Void Sector at Ready.')
  expect(await list({ status: 'Done', since: 'last week' })).toBe('Give since as a date, YYYY-MM-DD.')
})

test("a project's REST path comes from its page, for a user's project or an organization's", () => {
  expect(projectPathOf('https://github.com/users/astrosteveo/projects/9')).toBe('users/astrosteveo/projectsV2/9')
  expect(projectPathOf('https://github.com/orgs/anthropics/projects/12')).toBe('orgs/anthropics/projectsV2/12')
  expect(projectPathOf('https://example.com/elsewhere')).toBeNull()
})

test("issue_update sets the project's other fields by name, checked against each field's kind, and the card shows them", async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Ready', priority: 'P1' }
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const set = (fields: Record<string, unknown>) => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, fields })

  const done = await set({ Estimate: 3, Sprint: 'iteration 2', Due: '2026-10-20', Notes: 'Pairs with #289.' })
  expect(String(done.result)).toBe('#315 Estimate set to 3, Sprint set to iteration 2, Due set to 2026-10-20, Notes set to Pairs with #289..')
  expect(gh.valueWrites).toEqual([
    'PVTI_315 F_estimate {"number":3}',
    'PVTI_315 F_sprint {"iterationId":"IT2"}',
    'PVTI_315 F_due {"date":"2026-10-20"}',
    'PVTI_315 F_notes {"text":"Pairs with #289."}',
  ])
  expect(String((await set({ Notes: null })).result)).toBe('#315 Notes cleared.')
  expect(gh.valueWrites.at(-1)).toBe('PVTI_315 F_notes null')

  // A value that doesn't fit its field, a field the project hasn't got, or Status by this road, sets nothing.
  const writes = gh.valueWrites.length
  expect((await set({ Estimate: 'lots' })).deny).toBe("Couldn't change #315: Estimate takes a number, not lots")
  expect((await set({ Due: 'Friday' })).deny).toBe("Couldn't change #315: Due takes a date, YYYY-MM-DD, not Friday")
  expect((await set({ Sprint: 'Iteration 9' })).deny).toBe("Couldn't change #315: Sprint has no iteration called Iteration 9; it has Iteration 1, Iteration 2")
  expect((await set({ Effort: 1 })).deny).toBe("Couldn't change #315: Void Sector has no field called Effort; it has Status, Priority, Estimate, Sprint, Due, Notes")
  expect((await set({ Status: 'Done' })).deny).toBe("Couldn't change #315: set Status with status, not fields")
  expect(gh.valueWrites).toHaveLength(writes)

  // One issue in full lists its fields; the card shows them, and its editor sets them.
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', number: 315 })).result)).toMatch(/\nFields: Estimate 3, Sprint Iteration 2, Due 2026-10-20\n/)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  expect(await ui.find({ text: /Estimate 3 · Sprint Iteration 2 · Due 2026-10-20/ })).toBeDefined()
  await ui.press({ key: 'edit-315' })
  await ui.press({ key: 'more-315' })
  await ui.press({ key: 'field-315-F_sprint-IT1' })
  expect(gh.valueWrites.at(-1)).toBe('PVTI_315 F_sprint {"iterationId":"IT1"}')
  await ui.input({ key: 'field-315-F_estimate', text: '5' })
  expect(gh.valueWrites.at(-1)).toBe('PVTI_315 F_estimate {"number":5}')
  await ui.unmount()
})

test('issue_update sets the Status, Priority and fields of a closed issue through its item in the project, and leaves one already there', async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.project = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const update = (changes: Record<string, unknown>) => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 290, ...changes })
  const sets = () => gh.fields.filter(one => one.query?.includes('updateProjectV2ItemFieldValue')).map(one => `${one.item} ${one.field} ${one.option}`)

  // #290 closed, so it isn't on the board: its item is found in the project on GitHub, and set there.
  expect(String((await update({ status: 'Done', priority: 'P2' })).result)).toBe('#290 moved to Done, set to P2.')
  expect(sets()).toEqual(['PVTI_auto_290 F_status S5', 'PVTI_auto_290 F_priority P2'])
  expect(String((await update({ fields: { Estimate: 2 } })).result)).toBe('#290 Estimate set to 2.')
  expect(gh.valueWrites.at(-1)).toBe('PVTI_auto_290 F_estimate {"number":2}')

  // Already at the Status asked for, as when the board moved it to Done as it closed: said so, and nothing is written.
  gh.values.PVTI_auto_290 = { ...gh.values.PVTI_auto_290, Status: 'Done' }
  expect(String((await update({ status: 'done' })).result)).toBe("#290's Status is already Done.")
  expect(String((await update({ status: 'Done', priority: 'P1' })).result)).toBe("#290's Status is already Done. #290 set to P1.")
  expect(sets()).toEqual(['PVTI_auto_290 F_status S5', 'PVTI_auto_290 F_priority P2', 'PVTI_auto_290 F_priority P1'])
})

test('project_archive says how many items it would take first, without asking, and archives them on confirm', async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.project = true
  on('tool.check', async () => ({ decision: 'ask' as const }))
  await $.command.run(REFRESH)
  const archive = (input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__issue-board__project_archive', ...input })
  const check = (input: Record<string, unknown>) => $.tool.check({ tool: 'mcp__issue-board__project_archive', input })

  // Listing changes nothing, so it doesn't ask; archiving does.
  expect((await check({ doneBefore: '2026-10-01' })).decision).toBe('allow')
  expect((await check({ doneBefore: '2026-10-01', confirm: true })).decision).toBe('ask')

  expect(String((await archive({ doneBefore: '2026-10-01' })).result)).toBe(
    "Archiving the items at Done that closed before 2026-10-01 takes 1 item out of the views of Void Sector:\n#250 Old work\nThe issues stay as they are. Call again with confirm: true to archive.",
  )
  expect(gh.archived).toEqual([])
  expect(String((await archive({ doneBefore: '2026-10-01', confirm: true })).result)).toBe('Archived 1 item from Void Sector:\n#250 Old work')
  expect(gh.archived).toEqual(['PVTI_250'])
  // Once archived, it isn't taken again.
  expect(String((await archive({ doneBefore: '2026-10-01' })).result)).toBe('Nothing in Void Sector to archive: no items at Done that closed before 2026-10-01.')

  // One issue's item, by number.
  expect(String((await archive({ number: 290, confirm: true })).result)).toBe('Archived 1 item from Void Sector:\n#290 Dock the shuttle')
  expect(String((await archive({ number: 999 })).result)).toBe("#999 isn't in Void Sector, or is archived already.")
  expect((await archive({ doneBefore: 'soon' })).deny).toBe("Couldn't archive: give doneBefore as a date, YYYY-MM-DD")
})

test("project_status reads the project's latest update without asking, posts one when asked, and the pane shows it", async ($, on) => {
  adoptedStore(on)
  mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  on('tool.check', async () => ({ decision: 'ask' as const }))
  await $.command.run(REFRESH)
  const status = (input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__issue-board__project_status', ...input })

  expect((await $.tool.check({ tool: 'mcp__issue-board__project_status', input: {} })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'mcp__issue-board__project_status', input: { status: 'At risk' } })).decision).toBe('ask')
  expect(String((await status({})).result)).toBe('Void Sector has no status update yet.')

  const posted = await status({ status: 'at risk', note: 'Docking slipped.\nThe glide needs another pass.', target: '2026-10-20' })
  expect(String(posted.result)).toBe('Posted on Void Sector: At risk · Docking slipped. · target 2026-10-20 · just now.')
  expect(gh.statusPosts).toEqual([{ project: 'PVT_8', status: 'AT_RISK', body: 'Docking slipped.\nThe glide needs another pass.', start: null, target: '2026-10-20' }])
  expect(String((await status({})).result)).toBe('Void Sector: At risk · Docking slipped. · target 2026-10-20 · just now\nDocking slipped.\nThe glide needs another pass.')

  // A status GitHub hasn't got, or a date not written as one, posts nothing.
  expect((await status({ status: 'Great' })).deny).toBe("Couldn't post the status update: a status update is On track, At risk, Off track, Complete or Inactive, not Great")
  expect((await status({ status: 'On track', start: 'Monday' })).deny).toBe("Couldn't post the status update: give start as a date, YYYY-MM-DD")
  expect(gh.statusPosts).toHaveLength(1)

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /At risk · Docking slipped\./ })).toBeDefined()
  await ui.unmount()
})

test('each write tool asks before it changes anything: a no or a rule that denies writes nothing, a yes writes', async ($, on) => {
  const gh = world(on)
  gh.project = true
  await $.command.run(REFRESH)
  // The test asks tool.check first, as the engine does beneath the tool, and the engine answers by that verdict.
  const call = async (name: string, input: Record<string, unknown>) => {
    const tool = `mcp__issue-board__${name}` as const
    gh.engine.verdict = (await $.tool.check({ tool, input })).decision
    return { verdict: gh.engine.verdict, answer: await $.tool.call({ tool, ...input }) }
  }
  const writes: [string, Record<string, unknown>][] = [
    ['issue_create', { title: 'Dock at a station' }],
    ['issue_update', { number: 289, priority: 'P0' }],
    ['milestone', { title: 'Beta' }],
    ['project_status', { status: 'At risk', note: 'Docking slipped.' }],
    ['project_archive', { number: 290, confirm: true }],
  ]
  for (const [name, input] of writes) {
    gh.writes = []
    gh.engine.beneath = 'deny'
    const denied = await call(name, input)
    expect(denied.verdict).toBe('deny')
    expect(gh.writes).toEqual([])

    gh.engine.beneath = 'ask'
    gh.engine.answer = 'no'
    gh.engine.asked = []
    const no = await call(name, input)
    expect(gh.engine.asked).toEqual([`mcp__issue-board__${name}`])
    expect(no.answer).toMatchObject({ isError: true, text: `Permission to use mcp__issue-board__${name} was denied` })
    expect(gh.writes).toEqual([])

    gh.engine.answer = 'yes'
    const yes = await call(name, input)
    expect(yes.answer.deny).toBeUndefined()
    expect(yes.answer.isError).toBeUndefined()
    expect(gh.writes.length).toBeGreaterThan(0)
  }

  // What the board's tool.check lets through needs no prompt: ticking a box, starting on an issue, and moving the
  // Status of the issue this session is on. A rule that denies still stands.
  gh.engine.answer = 'no'
  gh.engine.asked = []
  const unasked: [string, Record<string, unknown>][] = [
    ['tick', { number: 315, boxes: [2] }],
    ['issue_update', { number: 289, start: true }],
    ['issue_update', { number: 289, status: 'Verification' }],
  ]
  for (const [name, input] of unasked) {
    gh.writes = []
    gh.engine.beneath = 'deny'
    expect((await call(name, input)).verdict).toBe('deny')
    expect(gh.writes).toEqual([])
    gh.engine.beneath = 'ask'
    const ran = await call(name, input)
    expect(ran.verdict).toBe('allow')
    expect(ran.answer.deny).toBeUndefined()
    expect(gh.writes.length).toBeGreaterThan(0)
  }
  expect(gh.engine.asked).toEqual([])

  // Reads neither ask nor write.
  gh.writes = []
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues' })).result)).toMatch(/#315/)
  expect(String((await call('project_status', {})).answer.result)).toMatch(/^Void Sector/)
  expect(String((await call('project_archive', { doneBefore: '2026-10-01' })).answer.result)).toMatch(/Call again with confirm: true to archive\.$/)
  expect(gh.engine.asked).toEqual([])
  expect(gh.writes).toEqual([])
})

test('a field the project gained since the last read is read before setting it, rather than refused', async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Ready', priority: 'P1' }
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const reads = gh.issueReads
  gh.newField = { id: 'F_effort', name: 'Effort', dataType: 'NUMBER' }
  const set = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, fields: { Effort: 2 } })
  expect(String(set.result)).toBe('#315 Effort set to 2.')
  expect(gh.valueWrites.at(-1)).toBe('PVTI_315 F_effort {"number":2}')
  expect(gh.issueReads).toBeGreaterThan(reads)
})

test("/issues check notes the project's Item closed workflow when it's on, as a limit that doesn't block", { options: { autoMove: true } }, async ($, on) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  gh.itemClosed = true
  await $.command.run(REFRESH)
  const said = String((await $.command.run({ ...REFRESH, args: 'check' })).text)
  expect(said).toContain("Void Sector's Item closed workflow is on.")
  expect(said).toContain('the board moves issues closed as completed to Done by itself.')

  gh.itemClosed = false
  await $.command.run(REFRESH)
  expect(String((await $.command.run({ ...REFRESH, args: 'check' })).text)).not.toContain('Item closed')
  await clock.settle()
})

test("/issues check leaves the Item closed workflow alone while the board doesn't move closed issues to Done", async ($, on) => {
  // autoMove is off by default. Turning Item closed off then would leave Done empty, so check doesn't advise it.
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  gh.itemClosed = true
  await $.command.run(REFRESH)
  expect(String((await $.command.run({ ...REFRESH, args: 'check' })).text)).not.toContain('Item closed')
  await clock.settle()
})

test('a project with its own Status names goes by the roles setup saved: its Inbox, the one that folds, and where Start moves', async ($, on) => {
  adoptedStore(on, savedRoles({ inbox: 'S0', ready: 'S1', backlog: 'S2', started: 'S3', verification: 'S4', done: 'S5' }))
  const gh = world(on)
  gh.project = true
  gh.statusNames = ['Todo', 'Next', 'Someday', 'Doing', 'Review', 'Shipped']
  gh.planned[315] = { status: 'Someday', priority: 'P2' }
  gh.planned[289] = { status: 'Todo', priority: 'P1' }
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })

  // Someday has the Backlog's role, so it folds.
  expect(await ui.find({ key: 'fold-status:Someday' })).toMatchObject({ text: '▸ Someday' })
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  expect(await ui.find({ key: 'issue-289' })).toBeDefined()

  // Todo is the Inbox: #289 waits there, #315 doesn't.
  await ui.press({ key: 'filter-inbox' })
  expect(await ui.find({ key: 'triage-289' })).toBeDefined()
  expect(await ui.find({ key: 'triage-315' })).toBeUndefined()
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', filter: 'inbox' })).result)).toMatch(/Issues \(inbox: Status Todo or none, 1\):\n#289 /)
  await ui.unmount()

  // Start moves #289 to Doing, the option for In progress.
  const started = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 289, start: true })
  expect(String(started.result)).toBe('Started #289: it is the issue this session is on, Doing and assigned.')
  expect(gh.planned[289]?.status).toBe('Doing')
})

test("a role setup left unset turns its part off, even where an option has the board's name, and /issues check and help say how to set it", async ($, on) => {
  adoptedStore(on, savedRoles({ ready: 'S2', backlog: 'S1', started: 'S3', done: 'S5' }))
  const gh = world(on)
  engineHint(on)
  gh.project = true
  gh.planned[315] = { status: 'Inbox', priority: 'P1' }
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  // No Inbox: no filter for it, and #315 is an issue like any other.
  expect(await ui.find({ key: 'filter-inbox' })).toBeUndefined()
  expect(await ui.find({ key: 'filter-all' })).toBeDefined()
  await ui.unmount()

  // Said once, in /issues check and /issues help, and not as a problem in the band or the hint.
  const said = String((await $.command.run({ ...REFRESH, args: 'check' })).text)
  expect(said).toContain('\nOff:\n')
  expect(said).toContain('- The Inbox filter, its triage, and new issues landing in the Inbox: Void Sector has no Status option as the Inbox; pick one in /issues statuses.')
  // The moves are off by their setting too, which is said once, for all three.
  expect(said).toContain('- Moving issues on their own: closed ones to Done, ones a Refs merge touched to Verification, and epics with their sub-issues: turned off in /config by Move issues on their own (autoMove).')
  expect(said).not.toContain('Moving an issue a Refs merge touched to Verification')
  expect(said).not.toContain('Moving closed issues to Done: Void Sector')
  expect(String((await $.command.run({ ...REFRESH, args: 'help' })).text)).toContain('- The Inbox filter, its triage, and new issues landing in the Inbox: Void Sector has no Status option as the Inbox')
  // The hint under the prompt doesn't call the board limited for it.
  const hint = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...HINT })
  expect(JSON.stringify(await hint.drawn())).not.toContain('limited')
  await hint.unmount()

  // Archiving what is done still works by the saved Done, and Start by the saved In progress.
  const started = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, start: true })
  expect(String(started.result)).toMatch(/, In progress and assigned\.$/)
})

test('a board with no Done set archives one issue, but not by doneBefore', async ($, on) => {
  adoptedStore(on, savedRoles({ inbox: 'S0', started: 'S3' }))
  const gh = world(on)
  gh.project = true
  await $.command.run(REFRESH)
  const by = await $.tool.call({ tool: 'mcp__issue-board__project_archive', doneBefore: '2026-10-01' })
  expect(by.deny).toBe("Couldn't archive: Void Sector has no Done option set; pick one in /issues statuses")
  const one = await $.tool.call({ tool: 'mcp__issue-board__project_archive', number: 290 })
  expect(String(one.result)).toMatch(/^Archiving #290 takes 1 item/)
})
