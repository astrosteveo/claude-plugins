import { expect, test } from 'claude-code/testing'

import { ago, bar, checksOf, ciOf, fit, spark, summary, weekly } from '../hooks/parse'

const ISSUES = [
  {
    number: 315,
    title: 'Lay Kessik out for play',
    labels: [{ name: 'enhancement', color: 'a2eeef' }, { name: 'area:simulation', color: '0e8a16' }, { name: 'future', color: 'c5def5' }],
    assignees: [{ login: 'astrosteveo' }],
    body: '## Acceptance\n\n- [x] Layout in place\n- [X] Old saves load\n- [ ] Goldens regenerated',
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
      kind === 'repo'
        ? 'astrosteveo/void-sector\n'
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
    expect((await ui.find({ key: 'pr-335' }))?.text).toBe('Glide in to a planet')
    expect(await ui.find({ text: / ✓ PASS / })).toBeDefined()
    expect(await ui.find({ text: /approved/ })).toBeDefined()
    expect(await ui.find({ key: 'issue-289' })).toBeDefined()
    expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
    expect(await ui.find({ text: /^closed / })).toBeDefined()
    expect((await ui.find({ text: /^ 2$/ }))?.props.bold).toBe(true)
    // The hover preview is drawn hidden beside the row, shown by the surface on hover.
    expect(await ui.find({ text: /^No acceptance boxes\. *$/ })).toBeDefined()

    await ui.press({ key: 'filter-future' })
    expect(await ui.find({ key: 'issue-315' })).toBeDefined()
    expect(await ui.find({ key: 'start-315' })).toBeUndefined()
    await ui.press({ key: 'issue-315' })
    expect(await ui.find({ text: /Goldens regenerated/ })).toBeDefined()
    expect(await ui.find({ text: / 2\/3/ })).toBeDefined()
    expect(await ui.find({ text: /@astrosteveo/ })).toBeDefined()
    expect(await ui.find({ text: /^s start/ })).toBeDefined()

    await ui.press({ key: 'start-315' })
    expect(sent.at(-1)).toMatch(/^Let's start on #315: Lay Kessik out for play\./)
    expect(sent.at(-1)).toMatch(/- Goldens regenerated$/)
    expect(sent.at(-1)).not.toMatch(/Layout in place/)

    // Two cards open: neither takes the s/d/o/x keys, and the tree still draws.
    await ui.press({ key: 'filter-all' })
    await ui.press({ key: 'issue-289' })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    expect((await ui.find({ key: 'start-289' }))?.props.hotkey).toBeUndefined()
    expect(await ui.find({ text: /^a active/ })).toBeDefined()

    await ui.press({ key: 'issue-289' })
    await ui.press({ key: 'issue-315' })
    await ui.press({ key: 'filter-active' })
    await ui.unmount()
  }
})

test('the status line sums up the board', () => {
  expect(summary([], [])).toBe('0 issues')
})
