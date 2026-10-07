import { expect, mock, test } from 'claude-code/testing'

import { optionId } from './graph'
import { adoptedStore } from './github'
import { REFRESH } from './ui'
import { PANE, world } from './void-sector'

// Filing and changing issues over REST: issue_create with every option, epics and their sub-issues, milestones and
// issue types.

test('issue_create files an issue with every option over REST, puts it in the project, and on the board at once', async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.project = true
  on('tool.check', async () => ({ decision: 'ask' as const }))
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const reads = gh.issueReads

  // Filing changes something, so Claude Code asks first, as it does for any such tool.
  expect((await $.tool.check({ tool: 'mcp__issue-board__issue_create', input: { title: 'x' } })).decision).toBe('ask')

  const filed = await $.tool.call({
    tool: 'mcp__issue-board__issue_create',
    title: 'Dock at a station',
    body: '## Acceptance\n- [ ] Docking works',
    labels: ['enhancement'],
    assign: ['@me'],
    milestone: 'launch',
    parent: 315,
    status: 'Ready',
    priority: 'P1',
  })
  expect(String(filed.result)).toBe('Filed #340: “Dock at a station”, labelled enhancement, assigned astrosteveo, on Launch, under #315, in Void Sector, Ready, P1.')
  // One REST call made the issue with its labels, assignee and milestone; one more put it under the epic.
  expect(gh.filed).toEqual([{ title: 'Dock at a station', body: '## Acceptance\n- [ ] Docking works', labels: ['enhancement'], assignees: ['astrosteveo'], milestone: 3 }])
  expect(gh.linked).toEqual([[315, '9340']])
  expect(gh.planned[340]).toEqual({ status: 'Ready', priority: 'P1' })

  // It shows at once, with its box, without the board reading GitHub again.
  expect(gh.issueReads).toBe(reads)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-340' })
  expect(await ui.find({ text: /Docking works/ })).toBeDefined()
  await ui.unmount()
})

test("issue_create takes the item a project's own auto-add made, and goes on to set its fields", async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.project = true
  gh.autoAdded = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const filed = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Added already', priority: 'P2' })
  expect(String(filed.result)).toBe('Filed #340: “Added already”, in Void Sector, Inbox, P2.')
  expect(gh.fields.filter(one => one.item === 'PVTI_auto_340').map(one => one.option)).toEqual([optionId('Inbox'), optionId('P2')])
})

test('issue_create with only a title files it to the Inbox, and a step that fails after filing is named with the number', async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.project = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)

  const bare = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Look into lag' })
  expect(String(bare.result)).toBe('Filed #340: “Look into lag”, in Void Sector, Inbox.')
  expect(gh.filed.at(-1)).toEqual({ title: 'Look into lag', body: '', labels: [], assignees: [] })

  // The link to the epic fails once the issue exists: the answer says so, and gives the issue's number.
  gh.failLink = true
  const partly = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Look into lag again', parent: 315, priority: 'P9' })
  expect(String(partly.result)).toBe(
    "Filed #341: “Look into lag again”, in Void Sector, Inbox. The issue exists, but the board couldn't put it under #315 (gh: Sub issue may only have one parent (HTTP 422)); nor set its Priority (the project has no Priority called P9).",
  )

  // Without a title, or with a milestone the repo hasn't, nothing is filed.
  const filed = gh.filed.length
  expect((await $.tool.call({ tool: 'mcp__issue-board__issue_create', body: 'x' })).deny).toBe('Give the issue a title.')
  expect((await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'x', milestone: 'Someday' })).deny).toBe("Couldn't file the issue: the repo has no open milestone called Someday")
  expect(gh.filed).toHaveLength(filed)
})

test('issue_create files an epic and its sub-issues in order, each under it and in the project, and goes on past one that fails', async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.project = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const reads = gh.issueReads

  const filed = await $.tool.call({
    tool: 'mcp__issue-board__issue_create',
    title: 'Stations',
    body: 'Docking and trade.',
    status: 'Backlog',
    subIssues: [
      { title: 'Dock at a station', body: '- [ ] Docking works', priority: 'P1' },
      { title: 'A sub-issue GitHub refused' },
      { title: 'Trade at a station', labels: ['enhancement'] },
    ],
  })
  expect(String(filed.result)).toBe(
    [
      'Filed #340: “Stations”, in Void Sector, Backlog.',
      'Its sub-issues:',
      '- Filed #341: “Dock at a station”, under #340, in Void Sector, Inbox, P1.',
      "- Couldn't file sub-issue 2, “A sub-issue GitHub refused”: gh: Validation Failed (HTTP 422)",
      '- Filed #342: “Trade at a station”, labelled enhancement, under #340, in Void Sector, Inbox.',
    ].join('\n'),
  )
  expect(gh.linked).toEqual([
    [340, '9341'],
    [340, '9342'],
  ])

  // The epic and its parts show at once, grouped under it, without a read.
  expect(gh.issueReads).toBe(reads)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'group-epic' })
  expect(await ui.find({ text: /^#340 Stations/ })).toBeDefined()
  expect(await ui.find({ text: /0\/2 closed/ })).toBeDefined()
  await ui.unmount()

  // An issue filed as blocked by another shows so at once.
  const blocked = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Refuel at a station', blockedBy: [289] })
  expect(String(blocked.result)).toBe('Filed #343: “Refuel at a station”, blocked by #289, in Void Sector, Inbox.')
  expect(gh.blocks).toEqual(['343 90289'])
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  expect(await pane.find({ text: /⛔ #289/ })).toBeDefined()
  await pane.unmount()

  // A sub-issue can't have sub-issues of its own.
  const nested = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'x', subIssues: [{ title: 'y', subIssues: [{ title: 'z' }] }] })
  expect(nested.deny).toBe('Sub-issue 1: A sub-issue takes no sub-issues of its own.')
})

test('the milestone tool makes and changes milestones over REST, and the pane and the issues tool show their progress', async ($, on) => {
  adoptedStore(on)
  mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  on('tool.check', async () => ({ decision: 'ask' as const }))
  await $.command.run(REFRESH)

  // Reading them is the issues tool's, with no permission prompt; changing one asks.
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', milestones: true })).result)).toBe('Launch · 5/7 closed · due 2026-10-20')
  expect((await $.tool.check({ tool: 'mcp__issue-board__milestone', input: { title: 'Beta' } })).decision).toBe('ask')

  const made = await $.tool.call({ tool: 'mcp__issue-board__milestone', title: 'Beta', due: '2026-11-01', description: 'Playable start to end.' })
  expect(String(made.result)).toBe('Made the milestone Beta: due 2026-11-01, described.')
  expect(gh.milestoneWrites.at(-1)).toBe('POST milestones {"title":"Beta","due_on":"2026-11-01T12:00:00Z","description":"Playable start to end."}')

  const changed = await $.tool.call({ tool: 'mcp__issue-board__milestone', title: 'launch', due: '', close: true })
  expect(String(changed.result)).toBe('Changed the milestone Launch: no due date, closed.')
  expect(gh.milestoneWrites.at(-1)).toBe('PATCH milestones/3 {"due_on":null,"state":"closed"}')

  // A due date not written as a date, and closing one the repo hasn't got, change nothing.
  const writes = gh.milestoneWrites.length
  expect((await $.tool.call({ tool: 'mcp__issue-board__milestone', title: 'Beta', due: 'next week' })).deny).toBe(
    "Couldn't change the milestone: give the due date as YYYY-MM-DD, or an empty string to clear it",
  )
  expect((await $.tool.call({ tool: 'mcp__issue-board__milestone', title: 'Gamma', close: true })).deny).toBe("Couldn't change the milestone: the repo has no milestone called Gamma")
  expect(gh.milestoneWrites).toHaveLength(writes)

  // The pane lists the open ones at once: Launch closed, Beta made.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^Beta$/ })).toBeDefined()
  expect(await ui.find({ text: /^Launch$/ })).toBeUndefined()
  expect(await ui.find({ text: 'due 2026-11-01' })).toBeDefined()
  await ui.unmount()
})

test("an issue's type shows on its card and is set by name, where the repo has types, and offered nowhere else", async ($, on) => {
  adoptedStore(on)
  const gh = world(on)
  gh.types = ['Bug', 'Task']
  gh.type315 = 'Task'
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const update = (type: string | null) => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, type })

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  expect(await ui.find({ text: /^Type Task$/ })).toBeDefined()

  expect(String((await update('bug')).result)).toBe('#315 typed bug.')
  expect(gh.patches.at(-1)).toBe('315 {"type":"Bug"}')
  expect(String((await update(null)).result)).toBe('#315 its type taken off.')
  expect(gh.patches.at(-1)).toBe('315 {"type":null}')
  expect((await update('Epic')).deny).toBe("Couldn't change #315: the repo has no issue type called Epic; it has Bug, Task")

  // The card's editor offers the repo's types; filing takes one too.
  await ui.press({ key: 'edit-315' })
  await ui.press({ key: 'more-315' })
  await ui.press({ key: 'type-315-Bug' })
  expect(gh.patches.at(-1)).toBe('315 {"type":"Bug"}')
  await ui.unmount()
  await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'A task', type: 'task' })
  expect(gh.filed.at(-1)).toMatchObject({ title: 'A task', type: 'Task' })
})

test('a repo without issue types offers none, and setting one says why it cannot', async ($, on) => {
  adoptedStore(on)
  world(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  expect((await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, type: 'Bug' })).deny).toBe(
    "Couldn't change #315: the repo has no issue types; they come with an organization's settings",
  )
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  await ui.press({ key: 'edit-315' })
  await ui.press({ key: 'more-315' })
  expect(await ui.find({ key: 'type-315-Bug' })).toBeUndefined()
  await ui.unmount()
})
