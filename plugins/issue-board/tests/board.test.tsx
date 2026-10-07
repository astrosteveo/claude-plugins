import { expect, mock, test } from 'claude-code/testing'

import { ago, agoText, bar, cells, checksOf, ciOf, filterKeys, fit, hintFit, issuesOf, openedText, pad, peekPlace, proseOf, rowRoom, spark, summary, weekly, wrappedLines } from '../hooks/parse'
import { ASTEROIDS, KESSIK, fakeGitHub, json, pr335 } from './github'
import type { Call } from './github'
import { HINT, REFRESH, RUN, engineHint, pane } from './ui'

test("a card's text leaves out its boxes, and a pull request names the issues it is for", () => {
  expect(proseOf('Why it matters.\n\n## Acceptance\n\n- [ ] One\n- [x] Two\n\n## Notes\n\nKeep this.')).toBe('Why it matters.\n\n## Notes\n\nKeep this.')
  expect(proseOf('## Acceptance\r\n\r\n- [ ] Only boxes\r\n')).toBe('')
  expect(proseOf('x'.repeat(12_000))).toHaveLength(10_000)
  expect(issuesOf([{ number: 344 }], 'Fixes #12, then refs #344 and see #9. Closes: #13')).toEqual([344, 12, 13])
  expect(issuesOf([], '')).toEqual([])
})

// Without URLs, so the board links to the page the repo gives.
const ISSUES = [
  {
    ...KESSIK,
    url: undefined,
    labels: [{ name: 'enhancement', color: 'a2eeef' }, { name: 'area:simulation', color: '0e8a16' }, { name: 'future', color: 'c5def5' }],
    body: 'Kessik needs a layout for play.\n\n## Acceptance\n\n- [x] Layout in place\n- [X] Old saves load\n- [ ] Goldens regenerated',
  },
  { ...ASTEROIDS, url: undefined, assignees: undefined, labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'area:art-audio', color: 'fbca04' }] },
]

// #335 without a URL or a body, so it links to the page the repo gives and names no issue.
const PRS = [{ ...pr335('pass'), url: undefined, body: undefined, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], additions: 120, deletions: 40 }]

const PANE = pane(100, 40)

test('acceptance boxes and CI read the way gh writes them', () => {
  expect(checksOf('- [x] one\n* [ ] two\nnot a box\n  - [X] three')).toEqual([
    { done: true, text: 'one' },
    { done: false, text: 'two' },
    { done: true, text: 'three' },
  ])
  expect(ciOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending')
  expect(ciOf([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }])).toBe('fail')
  expect(ciOf(null)).toBe('none')
})

test('bars, ages and titles fit the pane', () => {
  expect(bar({ done: 0, total: 0 }, 4)).toEqual(['', '╌╌╌╌'])
  expect(bar({ done: 2, total: 4 }, 6)).toEqual(['━━━', '━━━'])
  expect(bar({ done: 99, total: 100 }, 6)).toEqual(['━━━━━', '━'])
  expect(bar({ done: 3, total: 3 }, 6)).toEqual(['━━━━━━', ''])
  const at = Date.parse('2026-10-03T12:00:00Z')
  expect(ago('2026-10-03T11:59:30Z', at)).toBe('now')
  expect(ago('2026-10-03T09:00:00Z', at)).toBe('3h')
  expect(ago('2026-09-01T12:00:00Z', at)).toBe('4w')
  expect(fit('Lay Kessik out for play', 10)).toBe('Lay Kessi…')
  expect(fit('short', 10)).toBe('short')
})

test('an age in a sentence reads "just now" under a minute, never "now ago", from a number or an ISO string', () => {
  const at = Date.parse('2026-10-03T12:00:00Z')
  expect(agoText('2026-10-03T11:59:30Z', at)).toBe('just now')
  expect(agoText(at - 30_000, at)).toBe('just now')
  expect(agoText('2026-10-03T09:00:00Z', at)).toBe('3h ago')
  expect(agoText(at - 5 * 60_000, at)).toBe('5m ago')
  expect(ago(at - 3 * 3_600_000, at)).toBe('3h')
  expect(agoText('not a date', at)).toBe('')
  expect(agoText('', at)).toBe('')
})

test('text is measured in terminal cells: an emoji or a wide character takes two, a combining mark none', () => {
  expect(cells('marked ⛔')).toBe(9)
  expect(cells('星系')).toBe(4)
  expect(cells('é')).toBe(1)
  expect(cells('☐ box')).toBe(5)
  // Cut at the cell, never past it: ⛔ wouldn't fit in the last cell before the ellipsis.
  expect(fit('is marked ⛔ #301', 12)).toBe('is marked …')
  expect(cells(fit('is marked ⛔ #301', 13))).toBeLessThanOrEqual(13)
  expect(fit('is marked ⛔', 12)).toBe('is marked ⛔')
  expect(pad('⛔ go', 6)).toBe('⛔ go ')
  expect(cells(pad('⛔ go', 6))).toBe(6)
})

test("a preview line holding an emoji keeps the card's width, so nothing shows through it", async ($, on) => {
  const blocked = {
    number: 42,
    title: 'Show epics as parent issues with sub-issues',
    labels: [{ name: 'enhancement', color: 'a2eeef' }],
    body: '- [ ] A blocked row shows `⛔ #N`.\n- [ ] Ready ones come first.',
    updatedAt: '2026-10-03T20:00:00Z',
  }
  // Rows enough above it for its card: numbered higher, so they sort first.
  const others = [101, 102, 103, 104, 105, 106].map(number => ({ number, title: `Other ${number}`, labels: [], body: '', updatedAt: '2026-10-03T20:00:00Z' }))
  fakeGitHub(on, { repo: 'astrosteveo/claude-plugins', issues: [blocked, ...others] })
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  const preview = (await ui.findAll({ type: 'Box' })).find(box => box.props.position === 'absolute')
  // The card's lines, which are cut rather than wrapped; the repo's name in the header is cut too, but isn't one.
  const lines = (await ui.findAll({ type: 'Text' })).filter(text => text.props.wrap === 'truncate-end' && !text.text.startsWith('◆ '))
  expect(lines.some(line => line.text.includes('⛔'))).toBe(true)
  // Each line fills the card's inside exactly: its width less the two border cells.
  expect(lines.map(line => cells(line.text))).toEqual(lines.map(() => Number(preview?.props.width) - 2))
  await ui.unmount()
})

test('a hover card goes above its row, whole when it fits, trimmed when short of room, else not at all', () => {
  // Five boxes open: the title, how far along, four boxes, +1 more and the hint, in a border, take ten lines.
  expect(peekPlace(10, 5)).toEqual({ listed: 4, more: true, hint: true })
  expect(peekPlace(7, 2)).toEqual({ listed: 2, more: false, hint: true })
  // Short of room: no hint, the boxes that fit, and +N more for the rest.
  expect(peekPlace(6, 5)).toEqual({ listed: 1, more: true, hint: false })
  expect(peekPlace(6, 2)).toEqual({ listed: 2, more: false, hint: false })
  expect(peekPlace(4, 5)).toEqual({ listed: 0, more: false, hint: false })
  // Not even the title and how far along fit.
  expect(peekPlace(3, 5)).toBeNull()
})

test('the hint line keeps the most useful keys that fit, shortens the filters before dropping them, and never wraps', () => {
  const filters = [
    { hotkey: '1', name: 'Now' },
    { hotkey: '2', name: 'Later' },
    { hotkey: '7', name: 'Closed' },
  ]
  const parts = ['⏎ open an issue', filterKeys(filters), 'r refresh', 'm merge all PRs']
  expect(hintFit(parts, 120)).toBe('⏎ open an issue · 1 now · 2 later · 7 closed · r refresh · m merge all PRs')
  // Narrower: the filters fold to their short form, then the last parts go.
  expect(hintFit(parts, 50)).toBe('⏎ open an issue · 1-7 filter · r refresh')
  expect(hintFit(parts, 30)).toBe('⏎ open an issue · 1-7 filter')
  for (const width of [120, 50, 30, 10]) expect(cells(hintFit(parts, width))).toBeLessThanOrEqual(width)
})

test('opening the pane names every filter it has, from the same list the pane draws', () => {
  expect(openedText([{ hotkey: '1', name: 'Now' }, { hotkey: '7', name: 'Closed' }])).toBe(
    'Issues pane opened. Filters: 1 Now, 7 Closed. Enter opens an issue: Start hands it to Claude, Change edits it, and Esc folds it. r refreshes. ' +
      'Also: /issues new [epic] captures an issue to the Inbox, /issues setup links a project, /issues check says what is missing. /issues help lists everything.',
  )
})

test('a wrapping row counts the lines its items take', () => {
  expect(wrappedLines([6, 10, 10], 40)).toBe(1)
  expect(wrappedLines([6, 10, 10], 28)).toBe(1)
  expect(wrappedLines([6, 10, 10], 27)).toBe(2)
  // An item wider than the row still takes a line of its own.
  expect(wrappedLines([50, 4], 40)).toBe(2)
})

test('every hover card sits above its row, trimmed near the top, and none where there is no room', async ($, on) => {
  const issues = [1, 2, 3, 4, 5, 6, 7].map(number => ({
    number,
    title: `Issue ${number}`,
    labels: [],
    body: '- [ ] One.\n- [ ] Two.',
    updatedAt: '2026-10-03T20:00:00Z',
  }))
  fakeGitHub(on, { repo: 'astrosteveo/claude-plugins', issues })
  await $.command.run(REFRESH)
  const tops = async (offset: number, bodyRows: number) => {
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, scroll: { offset, bodyRows } } })
    const found = (await ui.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute').map(box => Number(box.props.top))
    await ui.unmount()
    return found
  }
  // A whole card takes seven lines. Above the first row are four: the repo line, the trends, the Issues heading and the
  // group's. The first rows' cards are trimmed to fit above them; from the fourth row down they are whole. None goes
  // below its row, where the rows after it would paint over it.
  const tops$ = await tops(0, 40)
  expect(tops$).toEqual([-4, -5, -6, -7, -7, -7, -7])
  // Scrolled so the first row is at the window's top: the rows near it have no room for a card, so none shows.
  expect(await tops(4, 40)).toEqual([-4, -5, -6])
})

test('a narrow row drops its chips, then its bar, then its age, and the title keeps the rest', () => {
  const parts = { chips: 14, bar: 10, age: 4, rest: 0 }
  expect(rowRoom(100, 6, parts)).toEqual({ chips: true, bar: true, age: true, title: 66 })
  expect(rowRoom(56, 6, parts)).toEqual({ chips: false, bar: true, age: true, title: 36 })
  expect(rowRoom(40, 6, parts)).toEqual({ chips: false, bar: false, age: true, title: 30 })
  expect(rowRoom(30, 6, parts)).toEqual({ chips: false, bar: false, age: false, title: 24 })
  // What always stays, such as the agent badge, still leaves the title a cell rather than wrapping the row.
  expect(rowRoom(30, 6, { ...parts, rest: 40 })).toEqual({ chips: false, bar: false, age: false, title: 1 })
  // A part the row hasn't is never shown.
  expect(rowRoom(100, 6, { chips: 0, bar: 0, age: 4, rest: 0 })).toEqual({ chips: false, bar: false, age: true, title: 90 })
})

test('the pane has no blank lines between sections, short group headers and the progress at the right', async ($, on) => {
  fakeGitHub(on, { issues: ISSUES })
  await $.command.run(REFRESH)
  // A row as drawn, without the hidden preview card that hovering it shows.
  type Drawn = string | { type?: string; props?: { position?: string; label?: string }; children?: Drawn[] }
  const textOf = (node: Drawn): string =>
    typeof node === 'string' ? node : node.props?.position === 'absolute' ? '' : node.type === 'Button' ? (node.props?.label ?? '') : (node.children ?? []).map(textOf).join('')
  const rowOf = async (ui: { find: (match: { key: string }) => Promise<{ children: unknown[] } | undefined> }, number: number) =>
    ((await ui.find({ key: `row-${number}` }))?.children ?? []).map(child => textOf(child as Drawn)).join('|')
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  // No pull requests are open, so there is no section for them.
  expect(await ui.find({ text: /Pull requests/ })).toBeUndefined()
  // A group header is its name and its count: no rule, no percentage.
  const groups = (await ui.findAll({ type: 'Box' })).filter(box => String(box.props.key ?? '').startsWith('group-'))
  expect(groups.length).toBe(2)
  expect(groups.some(box => /─|%/.test(box.text))).toBe(false)
  const header = (await ui.findAll({ type: 'Box' })).find(box => box.text === 'simulation1')
  expect(header).toBeDefined()
  expect((await ui.findAll({ type: 'Text' })).find(text => text.text === 'simulation')?.props).toMatchObject({ bold: true, color: 'claude' })
  // The number and title start the row; the bar and count sit before the age at its right. No boxes, no bar.
  expect(await rowOf(ui, 315)).toMatch(/^\|  #315 Lay Kessik out for play\|.*━━━ 2\/3 +\S+$/)
  expect(await rowOf(ui, 289)).toMatch(/^\|▲ #289 Asteroids didn't draw\| +\S+$/)
  // Nothing puts a blank line above it while no card is open.
  expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.marginTop)).toEqual([])
  // An open card keeps the space below it.
  await ui.press({ key: 'issue-315' })
  expect((await ui.find({ key: 'card-315' }))?.props.marginBottom).toBe(1)
  await ui.unmount()

  // A narrow pane gives up the bar, then the age, and keeps the title on one line.
  for (const [columns, bar, age] of [[60, true, true], [44, false, true]] as const) {
    const narrow = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: columns } })
    await narrow.press({ key: 'filter-all' })
    const row = await rowOf(narrow, 315)
    expect(/━━━ 2\/3/.test(row)).toBe(bar)
    expect(/\d[mhdwy]$|now$/.test(row)).toBe(age)
    expect(cells(row)).toBeLessThan(columns)
    await narrow.unmount()
  }
})

test('velocity counts each week and draws it as a sparkline', () => {
  const at = Date.parse('2026-10-03T12:00:00Z')
  expect(weekly(['2026-10-03T00:00:00Z', '2026-10-01T00:00:00Z', '2026-09-24T00:00:00Z', '2025-01-01T00:00:00Z'], at, 3)).toEqual([0, 1, 2])
  expect(spark([0, 1, 2, 4])).toBe('▁▃▅█')
  expect(spark([0, 0])).toBe('▁▁')
})

test('the pane lists the issues by filter and opens one to its boxes', async ($, on) => {
  // Two issues closed and a pull request merged yesterday, for the weekly counts.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const velocity = ({ argv }: Call) =>
    argv.includes('closed') ? json([{ closedAt: yesterday }, { closedAt: yesterday }]) : argv.includes('merged') ? json([{ mergedAt: yesterday }]) : undefined
  fakeGitHub(on, { issues: ISSUES, prs: PRS, routes: [velocity] })
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'issue-board', surface, ...PANE })
    expect(await ui.find({ text: /^Glide in to a planet$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('filter-')).map(one => one.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '7'])
    expect(await ui.find({ text: / ✓ PASS / })).toBeDefined()
    // A pull request is one row; its title opens its details, link included, beneath it.
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    expect(await ui.find({ text: /approved/ })).toBeUndefined()
    await ui.press({ key: 'pr-335' })
    expect(await ui.find({ text: /^· ● approved$/ })).toBeDefined()
    // A board without URLs links to the page the repo gives.
    expect((await ui.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual(['https://github.com/astrosteveo/void-sector/pull/335'])
    await ui.press({ key: 'pr-335' })
    expect(await ui.find({ text: /approved/ })).toBeUndefined()
    expect(await ui.find({ key: 'issue-289' })).toBeDefined()
    expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
    expect(await ui.find({ text: /^closed / })).toBeDefined()
    expect((await ui.find({ text: /^ 2$/ }))?.props.bold).toBe(true)
    // The hover preview is drawn hidden beside the row, shown by the surface on hover. It sits at the pane's right, so
    // the rows above keep their mark, number and the start of their title clear for the pointer moving up.
    expect(await ui.find({ text: /^ No acceptance boxes\. +$/ })).toBeDefined()
    const previews = (await ui.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')
    expect(previews.length).toBeGreaterThan(0)
    expect(previews.every(box => box.props.left === 44 && box.props.width === 56)).toBe(true)

    await ui.press({ key: 'filter-future' })
    expect(await ui.find({ key: 'issue-315' })).toBeDefined()
    expect(await ui.find({ key: 'start-315' })).toBeUndefined()
    await ui.press({ key: 'issue-315' })
    expect(await ui.find({ text: /Goldens regenerated/ })).toBeDefined()
    expect(await ui.find({ text: / 2\/3/ })).toBeDefined()
    expect(await ui.find({ text: /@astrosteveo/ })).toBeDefined()
    expect(await ui.find({ text: /^s start/ })).toBeDefined()
    expect(await ui.find({ key: 'draft-315' })).toMatchObject({ text: '✎ Edit first', props: { hotkey: 'e' } })
    expect(await ui.find({ key: 'close-315' })).toMatchObject({ text: 'Collapse', props: { hotkey: 'x' } })
    expect((await ui.findAll({ type: 'Link' })).map(link => link.props.href)).toContain('https://github.com/astrosteveo/void-sector/issues/315')
    // A narrow pane moves the card's buttons and link down a line rather than squeezing the link down the pane a letter
    // a line; with too little room even then, the link ends in an ellipsis.
    type Child = { type?: string; props?: { key?: string; flexShrink?: number } }
    const holding = (match: (child: Child) => boolean) => (element: { children: unknown[] }) => element.children.some(child => match(child as Child))
    expect((await ui.findAll({ type: 'Box' })).find(holding(child => child.props?.key === 'start-315'))?.props.flexWrap).toBe('wrap')
    expect((await ui.findAll({ type: 'Text' })).filter(holding(child => child.type === 'Link')).map(text => text.props.wrap)).toEqual(['truncate-end'])
    // A box's mark keeps its two cells beside a long box, whose text wraps in the room the mark leaves.
    expect((await ui.find({ key: 'box-row-315-1' }))?.children.map(child => (child as Child).props?.flexShrink)).toEqual([0, 1])
    // The card shows the issue's text, without the boxes it lists as buttons or the heading they leave empty.
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('Kessik needs a layout for play.')
    // Opening it also scrolls it into view: the engine resolves that against a real window, which a test hasn't.
    expect(await ui.find({ key: 'card-315' })).toBeDefined()

    await ui.press({ key: 'start-315' })
    expect(sent.at(-1)).toMatch(/^Let's start on #315: Lay Kessik out for play\./)
    expect(sent.at(-1)).toMatch(/- Goldens regenerated$/)
    expect(sent.at(-1)).not.toMatch(/Layout in place/)

    // One card at a time: opening another folds the first, and the new one takes the letter keys.
    await ui.press({ key: 'filter-all' })
    await ui.press({ key: 'issue-289' })
    expect(await ui.find({ key: 'start-315' })).toBeUndefined()
    expect((await ui.find({ key: 'start-289' }))?.props.hotkey).toBe('s')
    expect(await ui.find({ text: /^s start/ })).toBeDefined()

    await ui.press({ key: 'issue-289' })
    // At 100 columns every key in full doesn't fit, so the filters show in short; their names are on the buttons above.
    expect(await ui.find({ text: /^⏎ open an issue · 1-7 filter · r refresh · m merge all PRs$/ })).toBeDefined()
    await ui.press({ key: 'filter-active' })
    await ui.unmount()
  }

  // A narrow pane keeps its one header line and leaves out the sparklines and the ticked meter.
  const narrow = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 80 } })
  expect((await narrow.find({ text: /^ 2$/ }))?.props.bold).toBe(true)
  expect(await narrow.find({ text: /^closed / })).toBeUndefined()
  expect(await narrow.find({ text: /^ \d+%$/ })).toBeUndefined()
  // Its preview narrows to keep the left of the rows clear; a pane too narrow for both shows none.
  expect((await narrow.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute').map(box => [box.props.left, box.props.width])).toContainEqual([28, 52])
  await narrow.unmount()
  const slim = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 50 } })
  expect((await slim.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')).toEqual([])
  await slim.unmount()
})

test('the summary names what is open, and nothing when nothing is', () => {
  expect(summary([], [])).toBeUndefined()
  const issue = { number: 1, title: 'One', url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '' }
  expect(summary([issue], [])).toBe('1 issue')
})

test("the summary leaves out the pull request Claude Code's footer already shows, and only that one", () => {
  const issue = { number: 1, title: 'One', url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '' }
  const pr = (number: number, branch: string, ci: 'pass' | 'fail') => ({ number, title: '', url: '', author: '', branch, isDraft: false, ci, review: '' }) as never
  const prs = [pr(276, 'fix/276-footer', 'pass'), pr(280, 'feat/280-other', 'fail')]
  expect(summary([issue], prs)).toBe('1 issue · PR #276✓ #280✗')
  expect(summary([issue], prs, undefined, null)).toBe('1 issue · PR #276✓ #280✗')
  expect(summary([issue], prs, undefined, 'fix/276-footer')).toBe('1 issue · PR #280✗')
  // A branch with no pull request on the board leaves the list as it is.
  expect(summary([issue], prs, undefined, 'main')).toBe('1 issue · PR #276✓ #280✗')
  // With only the footer's pull request open, the list goes, and with nothing else open, the summary does.
  expect(summary([issue], prs.slice(0, 1), undefined, 'fix/276-footer')).toBe('1 issue')
  expect(summary([], prs.slice(0, 1), undefined, 'fix/276-footer')).toBeUndefined()
})

test('the hint under the prompt carries the summary, and nothing with nothing open', async ($, on) => {
  const gh = fakeGitHub(on, { issues: ISSUES, prs: PRS })
  engineHint(on)
  const hint = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...HINT })
  const shows = async (text: string) => expect(await hint.drawn()).toMatchObject({ type: 'Text', children: [text] })

  await $.command.run(REFRESH)
  await shows('? for shortcuts · 2 issues · 1 bug · PR #335✓')

  gh.issues = []
  gh.prs = []
  const reply = await $.command.run(REFRESH)
  await shows('? for shortcuts')
  expect(reply.text).toBe('Refreshed: nothing open.')

  // A repo with issues turned off: no issue calls, and its pull requests still show.
  gh.hasIssues = false
  gh.prs = PRS
  const ran = gh.ran.length
  await $.command.run(REFRESH)
  expect(gh.ran.slice(ran).filter(call => call.argv[1] === 'issue')).toEqual([])
  await shows('? for shortcuts · PR #335✓')

  await hint.unmount()
})

// The person's Esc reaches plugins as their close of the pane, which a test can't raise: the ui.close hook that turns
// it into a collapse while a card is open is left to the live session.
test('the pane opens to close on Esc, and Collapse folds the card', async ($, on) => {
  fakeGitHub(on, { issues: ISSUES, prs: PRS })
  const opened: unknown[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e)
    return { value: { isPlaced: true as const } }
  })
  await $.command.run({ ...RUN, args: '' })
  expect(opened).toEqual([{ id: 'issue-board', title: 'Issues', focus: true, closeOnEscape: true }])
  // The pane reads GitHub as it opens: wait for that read.
  await $.command.run(REFRESH)

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  expect(await ui.find({ key: 'start-315' })).toBeDefined()
  expect(await ui.find({ text: /x or esc collapse/ })).toBeDefined()

  await ui.press({ key: 'close-315' })
  expect(await ui.find({ key: 'start-315' })).toBeUndefined()
  expect(await ui.find({ key: 'issue-315' })).toBeDefined()
  await ui.unmount()
})

// How long the board waits after a read before it looks at GitHub again, by the refresh setting: so many minutes, or
// only when asked. A look makes gh calls, so their count tells when it looked.
const INTERVALS: [string | undefined, number | null][] = [
  [undefined, 5],
  ['15', 15],
  ['60', 60],
  ['manual', null],
]

for (const [refresh, minutes] of INTERVALS) {
  const when = minutes === null ? 'only when asked' : `${minutes} minutes after a read`
  test(`with refresh ${refresh ?? 'unset'}, the board looks at GitHub again ${when}`, { options: refresh ? { refresh } : {} }, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') })
    const gh = fakeGitHub(on, { issues: ISSUES, prs: PRS })
    await $.command.run(REFRESH)
    await clock.settle()
    const after = gh.ran.length
    // Nothing is read a minute short of the wait, or for three hours while it waits to be asked.
    await clock.advance(minutes === null ? 3 * 60 * 60 * 1000 : (minutes - 1) * 60 * 1000)
    expect(gh.ran.length).toBe(after)
    if (minutes === null) await $.command.run(REFRESH)
    else await clock.advance(60 * 1000)
    expect(gh.ran.length).toBeGreaterThan(after)
  })
}

// Claude Code's /config row for its own PR footer, as `$.config.list()` returns it.
const footerRow = (value: boolean) => ({ key: 'prStatus', label: 'Show PR status footer', kind: 'boolean' as const, value, provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false })

test("while Claude Code's PR footer is on, the hint's tail leaves out the branch's pull request", async ($, on) => {
  const other = { ...PRS[0], number: 336, title: 'Dock at a station', headRefName: 'feat/336-dock', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }
  const gh = fakeGitHub(on, { issues: ISSUES, prs: [...PRS, other], branch: 'fix/planet-glide' })
  let footer = true
  on('config.list', async () => ({ value: [footerRow(footer)] }))
  engineHint(on)
  const hint = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...HINT })
  const shows = async (text: string) => expect(await hint.drawn()).toMatchObject({ type: 'Text', children: [text] })

  await $.command.run(REFRESH)
  await shows('? for shortcuts · 2 issues · 1 bug · PR #336✗')
  // It still has its row in the pane, with its CI.
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /#335/ })).toBeDefined()
  await pane.unmount()

  // The footer turned off: the tail lists every pull request again.
  footer = false
  await $.command.run(REFRESH)
  await shows('? for shortcuts · 2 issues · 1 bug · PR #335✓ #336✗')

  // On a branch with no pull request, nothing is left out.
  footer = true
  gh.branch = 'main'
  await $.command.run(REFRESH)
  await shows('? for shortcuts · 2 issues · 1 bug · PR #335✓ #336✗')

  await hint.unmount()
})
