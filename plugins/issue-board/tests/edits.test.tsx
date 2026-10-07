import { expect, test } from 'claude-code/testing'

import { addBoxes, changesText, commandsOf, rewordBoxes, statusOnly } from '../hooks/parse'
import { PANE, github, writeLine, writes } from './claude-plugins'
import { optionId } from './graph'
import { adoptedStore } from './github'
import { REFRESH } from './ui'

// Changing an issue: issue_update and the card's editor, each change as a gh command or a REST call, and the board
// showing it at once.

test('a change becomes gh commands in order: the edit, then the comment, then the close', () => {
  expect(commandsOf(43, { addLabels: ['bug'], removeLabels: ['future'], assign: ['@me'], parent: 35, milestone: null, comment: ' Done here. ', close: 'not planned' }, 'o/r')).toEqual([
    { argv: ['issue', 'edit', '43', '--add-label', 'bug', '--remove-label', 'future', '--add-assignee', '@me', '--parent', '35', '--remove-milestone'] },
    { argv: ['api', '-X', 'POST', 'repos/o/r/issues/43/comments', '--input', '-'], stdin: '{"body":"Done here."}' },
    { argv: ['issue', 'close', '43', '--reason', 'not planned'] },
  ])
  expect(commandsOf(43, { parent: null, milestone: 'Launch', reopen: true })).toEqual([
    { argv: ['issue', 'edit', '43', '--remove-parent', '--milestone', 'Launch'] },
    { argv: ['issue', 'reopen', '43'] },
  ])
  // Status and Priority are the project's, not gh issue edit's.
  expect(commandsOf(43, { status: 'Verification', priority: 'P1' })).toEqual([])
  expect(changesText(43, { status: 'Verification', addLabels: ['bug'], close: 'completed' })).toBe('#43 moved to Verification, labelled bug, closed as completed.')
  expect(changesText(43, {})).toBe('Nothing to change on #43.')
  expect([statusOnly({ status: 'Done' }), statusOnly({ status: 'Done', comment: 'x' }), statusOnly({ priority: 'P0' }), statusOnly({}), statusOnly({ status: 'Done', addBlockedBy: [35] })]).toEqual([
    true,
    false,
    false,
    false,
    false,
  ])
  expect(changesText(43, { addBlockedBy: [35, 44], removeBlockedBy: [12] })).toBe('#43 blocked by #35, #44, no longer blocked by #12.')
})

test("Claude's issue_update tool makes the changes in order and the board reads GitHub straight after", async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  await $.command.run(REFRESH)
  const before = gh.reads

  const done = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, status: 'Verification', addLabels: ['bug'], assign: ['@me'], comment: 'Built; checking it live.', close: 'completed' })
  expect(String(done.result)).toBe('#43 moved to Verification, labelled bug, assigned @me, commented on, closed as completed.')
  expect(writes(gh.calls).map(writeLine)).toEqual([
    `project option=${optionId('Verification')}`,
    'issue edit 43 --add-label bug --add-assignee @me',
    'api -X POST repos/astrosteveo/claude-plugins/issues/43/comments --input -',
    'issue close 43 --reason completed',
  ])
  expect(writes(gh.calls)[2]?.stdin).toBe('{"body":"Built; checking it live."}')
  expect(gh.reads).toBeGreaterThan(before)

  // An issue the board doesn't hold is looked up on GitHub; one GitHub hasn't got says so, in GitHub's words.
  const missing = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 99, status: 'Done' })
  expect(missing.deny).toMatch(/^Couldn't change #99: GraphQL: Could not resolve to an issue or pull request with the number of 99/)
  const empty = await $.tool.call({ tool: 'mcp__issue-board__issue_update', status: 'Done' })
  expect(empty.deny).toBe('Give the issue number, and what to change on it.')
})

test("issue_update links and unlinks blocked-by issues over REST, the row shows it at once, and an unknown blocker fails by number", async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  on('tool.check', async () => ({ decision: 'ask' as const }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })

  const linked = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, addBlockedBy: [35] })
  expect(String(linked.result)).toBe('#43 blocked by #35.')
  expect(gh.links).toEqual(['POST 43/dependencies/blocked_by issue_id=9035'])
  expect(await ui.find({ text: /⛔ #35/ })).toBeDefined()

  const unlinked = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, removeBlockedBy: [35] })
  expect(String(unlinked.result)).toBe('#43 no longer blocked by #35.')
  expect(gh.links.at(-1)).toBe('DELETE 43/dependencies/blocked_by/9035')
  expect(await ui.find({ text: /⛔/ })).toBeUndefined()
  await ui.unmount()

  // A blocker that doesn't exist fails by its number, and no link is made.
  const made = gh.links.length
  const missing = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, addBlockedBy: [35, 999] })
  expect(missing.deny).toBe("Couldn't change #43: #999 doesn't exist in astrosteveo/claude-plugins")
  expect(gh.links).toHaveLength(made)

  // A Status move with a blocked-by change still asks.
  expect((await $.tool.check({ tool: 'mcp__issue-board__issue_update', input: { number: 43, status: 'Done', addBlockedBy: [35] } })).decision).toBe('ask')
})

test('boxes are added after the last one, or under a new Acceptance heading, and reworded by number', () => {
  expect(addBoxes('Intro.\n\n## Acceptance\n- [x] One\n- [ ] Two\n\nNotes.', ['Three'])).toBe('Intro.\n\n## Acceptance\n- [x] One\n- [ ] Two\n- [ ] Three\n\nNotes.')
  expect(addBoxes('- [ ] One', ['Two', 'Three'])).toBe('- [ ] One\n- [ ] Two\n- [ ] Three')
  expect(addBoxes('Intro.\n', ['One'])).toBe('Intro.\n\n## Acceptance\n- [ ] One\n')
  expect(addBoxes('', ['One'])).toBe('## Acceptance\n- [ ] One\n')
  // A body the web editor saved with \r\n keeps them.
  expect(addBoxes('- [ ] One\r\nNotes.\r\n', ['Two'])).toBe('- [ ] One\r\n- [ ] Two\r\nNotes.\r\n')
  expect(rewordBoxes('- [x] One\n- [ ] Two\r\n', [{ box: 1, text: 'First' }, { box: 2, text: 'Second' }])).toEqual({ body: '- [x] First\n- [ ] Second\r\n', missing: [] })
  expect(rewordBoxes('- [ ] One', [{ box: 3, text: 'x' }]).missing).toEqual([3])
})

test("issue_update changes the title and body over REST, adds and rewords boxes, and won't overwrite a body changed meanwhile", async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const call = (fields: Record<string, unknown>) => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, ...fields })

  expect(String((await call({ title: 'Edit issues in place' })).result)).toBe('#43 retitled “Edit issues in place”.')
  expect(String((await call({ addBoxes: ['Undo a change'] })).result)).toBe('#43 1 box added.')
  expect(gh.body).toBe('- [ ] Edit\n- [ ] Undo a change')
  expect(String((await call({ rewordBoxes: [{ box: 1, text: 'Edit any field' }] })).result)).toBe('#43 box 1 reworded.')
  expect(gh.body).toBe('- [ ] Edit any field\n- [ ] Undo a change')
  expect((await call({ rewordBoxes: [{ box: 5, text: 'x' }] })).deny).toBe("Couldn't change #43: #43 has 2 boxes, so there is no box 5")

  // A whole new body goes in while GitHub's is the one the board read.
  expect(String((await call({ body: 'Rewritten.\n- [ ] Edit' })).result)).toBe('#43 its body rewritten.')

  // Someone edits the body on GitHub: a whole new body is refused, and nothing is sent.
  gh.body = 'Changed on GitHub.'
  const sent = gh.patched.length
  expect((await call({ body: 'Mine.' })).deny).toBe(
    "Couldn't change #43: #43's body changed on GitHub since the board read it, so it wasn't overwritten. Read it again with the issues tool, then change it",
  )
  expect(gh.patched).toHaveLength(sent)

  // The board shows the new title and boxes at once.
  gh.body = '- [ ] Edit\n- [ ] Undo a change'
  await call({ addBoxes: ['Redo'] })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  expect(await ui.find({ text: /Edit issues in place/ })).toBeDefined()
  await ui.unmount()
})

test("the card's editor renames an issue, adds a box, and hands a body edit to Claude", async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  on('ui.toast', async () => ({ value: undefined }))
  const filled: string[] = []
  on('prompt.fill', async (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'edit-43' })
  await ui.press({ key: 'more-43' })
  await ui.input({ key: 'title-43', text: 'Edit issues in place' })
  await ui.input({ key: 'box-43', text: 'Undo a change' })
  expect(gh.patched).toEqual([{ title: 'Edit issues in place' }, { body: '- [ ] Edit\n- [ ] Undo a change' }])
  await ui.press({ key: 'body-43' })
  expect(filled).toEqual(['Edit the body of #43: '])
  await ui.unmount()
})

test('an issue closes as a duplicate of another, from the tool or the card, and leaves the board', async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)

  // An issue that doesn't exist can't be the original: nothing is posted or closed.
  expect((await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, duplicateOf: 999 })).deny).toBe("Couldn't change #43: #999 doesn't exist in astrosteveo/claude-plugins")
  expect([gh.posted, gh.closes]).toEqual([[], []])

  const closed = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, duplicateOf: 35 })
  expect(String(closed.result)).toBe('#43 closed as a duplicate of #35.')
  expect(gh.posted).toEqual(['43 Duplicate of #35'])
  expect(gh.closes).toEqual(['43 duplicate'])
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  expect(await ui.find({ key: 'issue-43' })).toBeUndefined()
  await ui.unmount()
})

test("the card closes an issue as a duplicate, as not planned where GitHub refuses the duplicate reason", async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  gh.noDuplicate = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'edit-43' })
  await ui.press({ key: 'more-43' })
  await ui.input({ key: 'duplicate-43', text: '#35' })
  expect(gh.posted).toEqual(['43 Duplicate of #35'])
  expect(gh.closes).toEqual(['43 not_planned'])
  await ui.unmount()
})

test('an issue is pinned, locked and moved to another of the owner\'s repos, each as a gh command, and leaves the board when moved', async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  on('tool.check', async () => ({ decision: 'ask' as const }))
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const update = (fields: Record<string, unknown>) => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, ...fields })
  const ran = () => gh.calls.filter(call => ['pin', 'unpin', 'lock', 'unlock', 'transfer'].includes(call.argv[1] ?? '')).map(call => call.argv.join(' '))

  expect(String((await update({ pin: true, lock: 'too_heated' })).result)).toBe('#43 pinned, locked as too heated.')
  expect(String((await update({ pin: false, lock: false })).result)).toBe('#43 unpinned, unlocked.')
  // Sent as a string, as a caller may for a field that also takes GitHub's reasons, it reads the same.
  expect(String((await update({ lock: 'false' })).result)).toBe('#43 unlocked.')
  expect((await update({ lock: 'maybe' })).deny).toBe("lock takes true, false, or one of GitHub's reasons: off_topic, resolved, spam, too_heated.")
  expect((await $.tool.check({ tool: 'mcp__issue-board__issue_update', input: { number: 43, pin: true } })).decision).toBe('ask')

  // Another owner's repo, or the same repo, is refused before anything runs.
  expect((await update({ transferTo: 'someone/else' })).deny).toBe("Couldn't change #43: an issue moves only to another of astrosteveo's repos, not to someone/else")
  expect((await update({ transferTo: 'claude-plugins' })).deny).toBe("Couldn't change #43: the issue is in astrosteveo/claude-plugins already")
  // void-sector is private: GitHub won't move the issue back, so the move waits for a confirmed call.
  expect((await update({ transferTo: 'void-sector' })).deny).toBe(
    "Couldn't change #43: astrosteveo/void-sector is private and astrosteveo/claude-plugins is public, so GitHub won't move #43 back once it's there. Call again with confirmTransfer: true to move it anyway",
  )
  expect(String((await update({ transferTo: 'void-sector', confirmTransfer: true })).result)).toBe('#43 moved to astrosteveo/void-sector.')
  expect(ran()).toEqual(['issue pin 43', 'issue lock 43 --reason too_heated', 'issue unpin 43', 'issue unlock 43', 'issue unlock 43', 'issue transfer 43 astrosteveo/void-sector'])

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  expect(await ui.find({ key: 'issue-43' })).toBeUndefined()
  await ui.unmount()
})

test("the card's editor shows its rows by what they're for, the common ones first, and the rest under More, in place", async ($, on) => {
  adoptedStore(on)
  github(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'edit-43' })
  // The editor's buttons in the order they show, without the labels' own.
  const order = async () =>
    (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => /^(unparent|milestone|assign|close-completed|more)-43/.test(key)).map(key => key.replace(/-43.*$/, ''))
  expect(await order()).toEqual(['unparent', 'assign', 'close-completed', 'more'])
  expect(await ui.find({ key: 'duplicate-43' })).toBeUndefined()
  expect(await ui.find({ text: '▾ More: milestone, fields, duplicate' })).toBeDefined()

  // More opens the rare rows where they belong: the milestone with the epic, before who has it.
  await ui.press({ key: 'more-43' })
  expect(await order()).toEqual(['unparent', 'milestone', 'assign', 'close-completed', 'more'])
  expect(await ui.find({ key: 'duplicate-43' })).toBeDefined()
  expect(await ui.find({ text: '▴ Less' })).toBeDefined()
  await ui.unmount()
})

test("a label the repo hasn't got is made first, an area one in the areas' color, and the answer says so", async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)

  const added = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, addLabels: ['area:ask', 'Bug', 'needs design'] })
  expect(String(added.result)).toBe('#43 labelled area:ask, Bug, needs design. Created the labels area:ask, needs design, new to the repo.')
  expect(gh.madeLabels).toEqual(['area:ask 1d76db', 'needs design ededed'])

  // The card makes one from what is typed.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'edit-43' })
  await ui.press({ key: 'more-43' })
  await ui.input({ key: 'new-label-43', text: 'area:board' })
  expect(gh.madeLabels.at(-1)).toBe('area:board 1d76db')
  await ui.unmount()
})

test("the card's editor changes labels, assignee and milestone, comments, and asks twice to close an epic with open sub-issues", async ($, on) => {
  adoptedStore(on)
  const gh = github(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })
  await ui.press({ key: 'edit-43' })
  await ui.press({ key: 'more-43' })

  // The repo's labels, the one it has drawn as set; the repo's milestones.
  expect(await ui.find({ key: 'label-43-enhancement' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'label-43-bug' })).toBeDefined()
  expect(await ui.find({ key: 'milestone-43-Launch' })).toBeDefined()
  expect(await ui.find({ text: /^#35 Make the issue board/ })).toBeDefined()

  await ui.press({ key: 'label-43-bug' })
  await ui.press({ key: 'label-43-enhancement' })
  await ui.press({ key: 'assign-43' })
  await ui.press({ key: 'milestone-43-Launch' })
  await ui.press({ key: 'unparent-43' })
  await ui.input({ key: 'reply-43', text: 'Looks right.', kind: 'change' })
  await ui.input({ key: 'reply-43', text: 'Looks right.', kind: 'submit' })
  await ui.input({ key: 'parent-43', text: '#35', kind: 'submit' })
  expect(writes(gh.calls).map(call => call.argv.join(' '))).toEqual([
    'issue edit 43 --add-label bug',
    'issue edit 43 --remove-label enhancement',
    'issue edit 43 --add-assignee @me',
    'issue edit 43 --milestone Launch',
    'issue edit 43 --remove-parent',
    'api -X POST repos/astrosteveo/claude-plugins/issues/43/comments --input -',
    'issue edit 43 --parent 35',
  ])
  await ui.press({ key: 'close-not-planned-43' })
  expect(writes(gh.calls).at(-1)?.argv.join(' ')).toBe('issue close 43 --reason not planned')

  // The epic: the first press of Close says what's open; the second closes it.
  const count = writes(gh.calls).length
  await ui.press({ key: 'issue-35' })
  await ui.press({ key: 'edit-35' })
  await ui.press({ key: 'more-35' })
  await ui.press({ key: 'close-completed-35' })
  expect(await ui.find({ text: /^#35 is an epic with 6 open sub-issues\. .*Press again to close it anyway\.$/ })).toBeDefined()
  expect(writes(gh.calls).length).toBe(count)
  await ui.press({ key: 'close-completed-35' })
  expect(writes(gh.calls).at(-1)?.argv.join(' ')).toBe('issue close 35 --reason completed')
  await ui.unmount()
})
