import { expect, mock, test } from 'claude-code/testing'

import { sameWorkOf, titleLikeness } from '../hooks/changes'
import { captureSection, draftPrompt, parseDraft } from '../hooks/prompts'
import { adoptedStore } from './github'
import { COMPOSE, REFRESH, engineBand } from './ui'
import { BAND, CAPTURE, PANE, issue, world } from './void-sector'

// Capture: the capture tool and /issues new filing work to the Inbox, the band counting what was captured, and the
// capture section in the system prompt.

test('a draft reads back from JSON, keeping only labels the repository has', () => {
  expect(draftPrompt('', ['bug'])).toMatch(/from what we have discussed\..*only from this list, or none: bug\./)
  const reply = 'Here it is:\n{"title": "Saves drop the hangar", "body": "Loading loses it.\\n\\n## Acceptance\\n- [ ] Hangar loads", "labels": ["bug", "made-up"]}'
  expect(parseDraft(reply, ['bug', 'area:saves'])).toEqual({ title: 'Saves drop the hangar', body: 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads', labels: ['bug'] })
  expect(parseDraft('no json here', ['bug'])).toBeNull()
  expect(parseDraft('{"body": "no title"}', ['bug'])).toBeNull()
})

test('capture files work to the Inbox without a prompt, with a toast, and the band counts it until the Inbox tab opens', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  engineBand(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)

  // No rule: the board's check lets it through, and nobody is asked.
  gh.engine.beneath = 'ask'
  gh.engine.answer = 'no'
  gh.engine.asked = []
  const input = { title: 'Hangar lights flicker after a jump', body: 'Seen while laying out #315: the lights flicker for a second.', labels: ['bug'], epic: 315 }
  gh.engine.verdict = (await $.tool.check({ tool: CAPTURE, input })).decision
  expect(gh.engine.verdict).toBe('allow')
  const answer = await $.tool.call({ tool: CAPTURE, ...input })
  expect(gh.engine.asked).toEqual([])
  expect(String(answer.result)).toBe(
    'Captured to the Inbox for the person to triage. Filed #340: “Hangar lights flicker after a jump”, labelled bug, under #315, in Void Sector, Inbox.',
  )
  expect(gh.filed.at(-1)).toEqual({ title: input.title, body: input.body, labels: ['bug'], assignees: [] })
  expect(gh.linked).toEqual([[315, '9340']])
  expect(gh.planned[340]).toEqual({ status: 'Inbox' })
  expect(toasts).toContain('Captured #340 to the Inbox')
  expect(toasts).not.toContain('Filed #340')

  // The band counts what was captured, and Open Inbox opens the pane at the Inbox tab, which ends the count.
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: '1 captured to the Inbox' })).toBeDefined()
  await $.tool.call({ tool: CAPTURE, title: 'Docking ring creaks on approach', body: 'Heard in the same test run.' })
  expect(await band.find({ text: '2 captured to the Inbox' })).toBeDefined()
  expect(await band.find({ key: 'captured-open' })).toMatchObject({ text: 'Open Inbox' })
  await band.press({ key: 'captured-open' })
  expect(await band.find({ key: 'captured-row' })).toBeUndefined()
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'issue-340' })).toBeDefined()

  // Choosing the Inbox tab in the pane ends the count too.
  await pane.press({ key: 'filter-all' })
  await $.tool.call({ tool: CAPTURE, title: 'Map legend overlaps the key', body: 'Noticed on a small screen.' })
  expect(await band.find({ text: '1 captured to the Inbox' })).toBeDefined()
  await pane.press({ key: 'filter-inbox' })
  expect(await band.find({ key: 'captured-row' })).toBeUndefined()

  // A rule that denies it still stands, and nothing is filed.
  gh.engine.beneath = 'deny'
  const filed = gh.filed.length
  gh.engine.verdict = (await $.tool.check({ tool: CAPTURE, input: { title: 'Another thing', body: 'Why.' } })).decision
  expect(gh.engine.verdict).toBe('deny')
  await $.tool.call({ tool: CAPTURE, title: 'Another thing', body: 'Why.' })
  expect(gh.filed).toHaveLength(filed)

  // Without a body that says why, nothing is filed either.
  gh.engine.beneath = 'ask'
  gh.engine.verdict = 'allow'
  expect((await $.tool.call({ tool: CAPTURE, title: 'No reason' })).deny).toBe('Say in body what the work is and why it came up.')
  expect(gh.filed).toHaveLength(filed)
  await pane.unmount()
  await band.unmount()
  await clock.settle()
})

test('a capture that is the same work as an open issue, or one closed in the last 30 days, comments there instead', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)

  // #315 is open on the board: the same words in another order are the same work.
  const open = await $.tool.call({ tool: CAPTURE, title: 'Lay out Kessik for play', body: 'It came up again while testing saves.' })
  expect(String(open.result)).toBe('Not filed: #315 “Lay Kessik out for play” looks like the same work, so this went there as a comment instead.')
  expect(gh.commented).toEqual([[315, 'Captured again from a conversation: **Lay out Kessik for play**\n\nIt came up again while testing saves.']])
  expect(toasts).toContain('Added to #315 as a comment: it looks like the same work')

  // #290 closed the day before: still the same work.
  const closed = await $.tool.call({ tool: CAPTURE, title: 'Dock the shuttles', body: 'The shuttle still drifts.' })
  expect(String(closed.result)).toBe('Not filed: #290 “Dock the shuttle”, closed lately, looks like the same work, so this went there as a comment instead.')
  expect(gh.commented.at(-1)?.[0]).toBe(290)
  expect(gh.filed).toEqual([])

  // Different work is filed.
  await $.tool.call({ tool: CAPTURE, title: 'Asteroid belt draws too dense', body: 'Seen near Kessik.' })
  expect(gh.filed.map(one => one.title)).toEqual(['Asteroid belt draws too dense'])
  await clock.settle()
})

test('an issue closed more than 30 days before a capture is not the same work', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-10T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const filed = await $.tool.call({ tool: CAPTURE, title: 'Dock the shuttles', body: 'The shuttle still drifts.' })
  expect(String(filed.result)).toMatch(/^Captured to the Inbox for the person to triage\. Filed #340: “Dock the shuttles”/)
  expect(gh.commented).toEqual([])
  await clock.settle()
})

test('titles count as the same work when most of their words match', () => {
  expect(titleLikeness('Lay Kessik out for play', 'Lay out Kessik for play')).toBe(1)
  expect(titleLikeness('Saves drop the hangar', 'The hangar drops from saves')).toBe(1)
  expect(titleLikeness('Saves drop the hangar', 'Asteroids draw late')).toBe(0)
  const issues = [{ number: 1, title: 'Dock the shuttle' }, { number: 2, title: 'Dock the shuttle at night in a storm' }]
  expect(sameWorkOf('Dock the shuttles', issues)?.number).toBe(1)
  expect(sameWorkOf('Refuel at a station', issues)).toBeNull()
})

test('the system prompt has the fixed capture section while the setting is on', async ($, on) => {
  adoptedStore(on)
  world(on)
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  await $.command.run(REFRESH)
  const first = (await $.prompt.compose(COMPOSE)).sections
  expect(first.map(section => section.id)).toEqual(['intro', 'issue-board:capture'])
  expect(first[1]).toEqual({ id: 'issue-board:capture', text: captureSection(), scope: 'session' })
  // Two or three sentences, and the same text on every request.
  expect(captureSection().split(/\.\s/).length).toBeLessThanOrEqual(3)
  expect((await $.prompt.compose(COMPOSE)).sections[1]?.text).toBe(first[1]?.text)
})

test('with the capture setting off, the system prompt has no capture section, and /issues check says so', { options: { capture: false } }, async ($, on) => {
  adoptedStore(on)
  world(on)
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  await $.command.run(REFRESH)
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])
  const said = String((await $.command.run({ ...REFRESH, args: 'check' })).text)
  expect(said).toContain('- The capture section in the system prompt: turned off in /config by Capture section in the system prompt (capture).')
  await $.command.run(REFRESH)
})

test('/issues new captures an issue from the conversation straight to the Inbox', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  engineBand(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const asked: string[] = []
  on('model.fork', async (_$, e) => {
    asked.push(e.prompt)
    const text = JSON.stringify({ title: 'Saves drop the hangar', body: 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads', labels: ['enhancement', 'nope'] })
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.command.run(REFRESH)

  const reply = await $.command.run({ ...REFRESH, args: 'new the hangar vanishing on load' })
  expect(reply.text).toMatch(/^Capturing an issue from the conversation to the Inbox\./)
  await clock.settle()
  expect(asked.at(-1)).toMatch(/about: the hangar vanishing on load\./)
  // Filed over REST with the labels the repo has, then into the project at Inbox; no card to check first.
  expect(gh.filed).toEqual([{ title: 'Saves drop the hangar', body: 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads', labels: ['enhancement'], assignees: [] }])
  expect(gh.planned[340]).toEqual({ status: 'Inbox' })
  expect(toasts).toContain('Captured #340 to the Inbox')
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: '1 captured to the Inbox' })).toBeDefined()
  await band.unmount()
})

test("an organization's ceiling of ask keeps capture asking, and a capture with no title is refused", async ($, on) => {
  const gh = world(on)
  gh.project = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const input = { title: 'Hangar lights flicker after a jump', body: 'Seen while laying out #315.' }
  gh.engine.beneath = 'ask'
  expect((await $.tool.check({ tool: CAPTURE, input, ceiling: 'ask' })).decision).toBe('ask')
  expect((await $.tool.check({ tool: CAPTURE, input, ceiling: 'allow' })).decision).toBe('allow')
  expect((await $.tool.check({ tool: CAPTURE, input })).decision).toBe('allow')

  // Left at ask, the person is asked, and a no files nothing.
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'no'
  await $.tool.call({ tool: CAPTURE, ...input })
  expect(gh.engine.asked).toEqual([CAPTURE])
  expect(gh.filed).toEqual([])

  // A capture needs a title before anything is asked or filed.
  gh.engine.verdict = 'allow'
  expect((await $.tool.call({ tool: CAPTURE, body: 'Seen.' })).deny).toBe('Give the capture a title.')
  expect((await $.tool.call({ tool: CAPTURE, title: '   ', body: 'Seen.' })).deny).toBe('Give the capture a title.')
  expect(gh.engine.asked).toEqual([CAPTURE])
  expect(gh.filed).toEqual([])
})

test("the band's ✕ ends the capture count, and the next capture counts from one", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  engineBand(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  await $.tool.call({ tool: CAPTURE, title: 'Hangar lights flicker after a jump', body: 'Seen while laying out #315.' })
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: '1 captured to the Inbox' })).toBeDefined()
  await band.press({ key: 'captured-dismiss' })
  expect(await band.find({ key: 'captured-row' })).toBeUndefined()
  // The count starts again from nothing.
  await $.tool.call({ tool: CAPTURE, title: 'Docking ring creaks on approach', body: 'Heard in the same test run.' })
  expect(await band.find({ text: '1 captured to the Inbox' })).toBeDefined()
  expect(gh.filed).toHaveLength(2)
  await band.unmount()
  await clock.settle()
})

test("a capture is filed anyway when the closed issues to compare it with can't be read", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  on('ui.toast', async () => ({ value: undefined }))
  const logged: string[] = []
  on('ui.log', async (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)
  gh.failClosed = true
  // The title matches #290, closed the day before, but the board can't see it, so it files the work.
  const answer = await $.tool.call({ tool: CAPTURE, title: 'Dock the shuttles', body: 'The shuttle still drifts.' })
  expect(String(answer.result)).toMatch(/^Captured to the Inbox for the person to triage\. Filed #340: “Dock the shuttles”/)
  expect(gh.filed.map(one => one.title)).toEqual(['Dock the shuttles'])
  expect(gh.commented).toEqual([])
  expect(logged.some(line => line.startsWith("issue-board: couldn't read the closed issues to compare a capture with: "))).toBe(true)
  await clock.settle()
})

test('/issues new says by toast why nothing was captured, and files nothing', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  type Reply = { isAnswered: true; text: string; usage: typeof usage } | { isAnswered: false; reason: 'nothing-to-fork' } | { isAnswered: false; reason: 'empty-reply'; usage: typeof usage }
  let forked: Reply = { isAnswered: false, reason: 'nothing-to-fork' }
  const completed: string[] = []
  on('model.fork', async () => ({ value: forked }))
  on('model.complete', async (_$, e) => {
    completed.push(e.model ?? '')
    return { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage } }
  })
  await $.command.run(REFRESH)
  const run = async (args: string) => {
    await $.command.run({ ...REFRESH, args })
    await clock.settle()
    return toasts.at(-1)
  }

  // Nothing said yet in the conversation, and nothing said to go on.
  expect(await run('new')).toBe('Nothing to capture from yet. Say what it is about: /issues new <what>')
  expect(await run('new epic')).toBe('Nothing to capture from yet. Say what it is about: /issues new epic <what>')
  expect(completed).toEqual([])
  // With something to go on, it asks Sonnet instead, and says why that failed.
  expect(await run('new the hangar vanishing on load')).toBe("Couldn't write the issue: empty-reply")
  expect(completed).toEqual(['sonnet'])

  // The fork's own failure is named.
  forked = { isAnswered: false, reason: 'empty-reply', usage }
  expect(await run('new the hangar vanishing on load')).toBe("Couldn't write the issue: empty-reply")
  expect(completed).toEqual(['sonnet'])

  // An answer that isn't an issue or an epic.
  forked = { isAnswered: true, text: 'I would call it the hangar bug.', usage }
  expect(await run('new the hangar vanishing on load')).toBe("Claude's answer didn't come back as an issue. Try /issues new again.")
  expect(await run('new epic saves that survive a crash')).toBe("Claude's answer didn't come back as an epic. Try /issues new again.")

  // GitHub refusing the issue.
  forked = { isAnswered: true, text: JSON.stringify({ title: 'A refused issue', body: 'Why.', labels: [] }), usage }
  expect(await run('new the hangar vanishing on load')).toMatch(/^Couldn't capture the issue: .*Validation Failed/)
  expect(gh.filed).toEqual([])
})

test('a project view that is the Inbox stands in for the Inbox tab: Open Inbox opens it, and choosing it ends the capture count', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  gh.views = {
    views: [
      { name: 'Triage', number: 1, layout: 'TABLE_LAYOUT', filter: 'status:Inbox' },
      { name: 'Bugs', number: 2, layout: 'TABLE_LAYOUT', filter: 'label:bug' },
    ],
  }
  engineBand(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  const tabs = async () => (await pane.findAll({ type: 'Button' })).map(one => String(one.key ?? '')).filter(key => key.startsWith('filter-'))
  expect(await tabs()).toEqual(['filter-view:1', 'filter-view:2', 'filter-all', 'filter-closed'])
  await pane.press({ key: 'filter-view:2' })

  // Open Inbox picks the Triage view, which shows the new issue, and ends the count.
  const capture = (title: string) => $.tool.call({ tool: CAPTURE, title, body: 'Seen while testing.' })
  await capture('Hangar lights flicker after a jump')
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: '1 captured to the Inbox' })).toBeDefined()
  await band.press({ key: 'captured-open' })
  expect(await band.find({ key: 'captured-row' })).toBeUndefined()
  expect(await pane.find({ key: 'issue-340' })).toBeDefined()

  // Choosing the Triage tab in the pane ends the count too.
  await pane.press({ key: 'filter-view:2' })
  await capture('Docking ring creaks on approach')
  expect(await band.find({ text: '1 captured to the Inbox' })).toBeDefined()
  await pane.press({ key: 'filter-view:1' })
  expect(await band.find({ key: 'captured-row' })).toBeUndefined()

  // So does /issues, opening the pane at the Triage tab.
  await capture('Map legend overlaps the key')
  expect(await band.find({ text: '1 captured to the Inbox' })).toBeDefined()
  await $.command.run({ ...REFRESH, args: '' })
  expect(await band.find({ key: 'captured-row' })).toBeUndefined()
  await band.unmount()
  await pane.unmount()
  await clock.settle()
})
