import { expect, test } from 'claude-code/testing'

import { ago, bar, checksOf, ciOf, fit, issuesOf, proseOf, spark, summary, weekly } from '../hooks/parse'
import { graphPage, isIssuesQuery } from './graph'

test("a card's text leaves out its boxes, and a pull request names the issues it is for", () => {
  expect(proseOf('Why it matters.\n\n## Acceptance\n\n- [ ] One\n- [x] Two\n\n## Notes\n\nKeep this.')).toBe('Why it matters.\n\n## Notes\n\nKeep this.')
  expect(proseOf('## Acceptance\r\n\r\n- [ ] Only boxes\r\n')).toBe('')
  expect(proseOf('x'.repeat(12_000))).toHaveLength(10_000)
  expect(issuesOf([{ number: 344 }], 'Fixes #12, then refs #344 and see #9. Closes: #13')).toEqual([344, 12, 13])
  expect(issuesOf([], '')).toEqual([])
})

const ISSUES = [
  {
    number: 315,
    title: 'Lay Kessik out for play',
    labels: [{ name: 'enhancement', color: 'a2eeef' }, { name: 'area:simulation', color: '0e8a16' }, { name: 'future', color: 'c5def5' }],
    assignees: [{ login: 'astrosteveo' }],
    body: 'Kessik needs a layout for play.\n\n## Acceptance\n\n- [x] Layout in place\n- [X] Old saves load\n- [ ] Goldens regenerated',
    updatedAt: '2026-10-03T20:00:00Z',
  },
  {
    number: 289,
    title: "Asteroids didn't draw",
    labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'area:art-audio', color: 'fbca04' }],
    body: null,
    updatedAt: '2026-10-02T20:00:00Z',
  },
]

const PRS = [
  {
    number: 335,
    title: 'Glide in to a planet',
    headRefName: 'fix/planet-glide',
    isDraft: false,
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    reviewDecision: 'APPROVED',
    additions: 120,
    deletions: 40,
    author: { login: 'astrosteveo' },
    updatedAt: '2026-10-03T20:00:00Z',
  },
]

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

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

test('velocity counts each week and draws it as a sparkline', () => {
  const at = Date.parse('2026-10-03T12:00:00Z')
  expect(weekly(['2026-10-03T00:00:00Z', '2026-10-01T00:00:00Z', '2026-09-24T00:00:00Z', '2025-01-01T00:00:00Z'], at, 3)).toEqual([0, 1, 2])
  expect(spark([0, 1, 2, 4])).toBe('▁▃▅█')
  expect(spark([0, 0])).toBe('▁▁')
})

test('the pane lists the issues by filter and opens one to its boxes', async ($, on) => {
  on('process.run', async (_$, e) => {
    const kind = e.argv[1]
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const stdout =
      isIssuesQuery(e.argv)
        ? graphPage(ISSUES)
        : kind === 'repo'
        ? JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true })
        : e.argv.includes('closed')
          ? JSON.stringify([{ closedAt: yesterday }, { closedAt: yesterday }])
          : e.argv.includes('merged')
            ? JSON.stringify([{ mergedAt: yesterday }])
            : JSON.stringify(kind === 'issue' ? ISSUES : PRS)
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run({
    command: 'issues',
    args: 'refresh',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'issue-board', surface, ...PANE })
    expect(await ui.find({ text: /^Glide in to a planet$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('filter-')).map(one => one.props.hotkey)).toEqual(['1', '2', '3', '4', '5'])
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
    // the rows above keep their bar, number and the start of their title clear for the pointer moving up.
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
    expect(await ui.find({ text: /^1 active/ })).toBeDefined()
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

const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

test('the hint under the prompt carries the summary, and nothing with nothing open', async ($, on) => {
  let repo = { nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }
  let issues: unknown[] = ISSUES
  let prs: unknown[] = PRS
  const issueCalls: string[][] = []
  on('process.run', async (_$, e) => {
    const kind = e.argv[1]
    if (kind === 'issue') issueCalls.push([...e.argv])
    const stdout = isIssuesQuery(e.argv) ? graphPage(issues as never) : kind === 'repo' ? JSON.stringify(repo) : e.argv.includes('closed') || e.argv.includes('merged') ? '[]' : JSON.stringify(kind === 'issue' ? issues : prs)
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // What the engine draws: its hint, then ` · ` and the tail the plugins added.
  on('ui.render', { component: 'PromptHint' }, async ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{e.props.tail ? `${e.props.hint} · ${e.props.tail}` : e.props.hint}</Text>
  })
  const hint = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...HINT })
  const shows = async (text: string) => expect(await hint.drawn()).toMatchObject({ type: 'Text', children: [text] })

  await $.command.run(REFRESH)
  await shows('? for shortcuts · 2 issues · 1 bug · PR #335✓')

  issues = []
  prs = []
  const reply = await $.command.run(REFRESH)
  await shows('? for shortcuts')
  expect(reply.text).toBe('Refreshed: nothing open.')

  // A repo with issues turned off: no issue calls, and its pull requests still show.
  repo = { ...repo, hasIssuesEnabled: false }
  prs = PRS
  issueCalls.length = 0
  await $.command.run(REFRESH)
  expect(issueCalls).toEqual([])
  await shows('? for shortcuts · PR #335✓')

  await hint.unmount()
})

// The person's Esc reaches plugins as their close of the pane, which a test can't raise: the ui.close hook that turns
// it into a collapse while a card is open is left to the live session.
test('the pane opens to close on Esc, and Collapse folds the card', async ($, on) => {
  on('process.run', async (_$, e) => {
    const kind = e.argv[1]
    const stdout = isIssuesQuery(e.argv) ? graphPage(ISSUES) : kind === 'repo' ? JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }) : e.argv.includes('closed') || e.argv.includes('merged') ? '[]' : JSON.stringify(kind === 'issue' ? ISSUES : PRS)
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const opened: unknown[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e)
    return { value: { isPlaced: true as const } }
  })
  await $.command.run({ command: 'issues', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(opened).toEqual([{ id: 'issue-board', title: 'Issues', focus: true, closeOnEscape: true }])

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
