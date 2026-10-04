import { expect, test } from 'claude-code/testing'

import { checksOf, ciOf, summary } from '../hooks/parse'

const ISSUES = [
  {
    number: 315,
    title: 'Lay Kessik out for play',
    labels: [{ name: 'enhancement' }, { name: 'area:simulation' }, { name: 'future' }],
    body: '## Acceptance\n\n- [x] Layout in place\n- [X] Old saves load\n- [ ] Goldens regenerated',
    updatedAt: '2026-10-03T20:00:00Z',
  },
  {
    number: 289,
    title: "Asteroids didn't draw",
    labels: [{ name: 'bug' }, { name: 'area:art-audio' }],
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
    reviewDecision: null,
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

test('the pane lists the issues by filter and opens one to its boxes', async ($, on) => {
  on('process.run', async (_$, e) => {
    const kind = e.argv[1]
    const stdout = kind === 'repo' ? 'astrosteveo/void-sector\n' : JSON.stringify(kind === 'issue' ? ISSUES : PRS)
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
    expect(await ui.find({ text: /#335 Glide in to a planet/ })).toBeDefined()
    expect(await ui.find({ key: 'issue-289' })).toBeDefined()
    expect(await ui.find({ key: 'issue-315' })).toBeUndefined()

    await ui.press({ key: 'filter-future' })
    expect(await ui.find({ key: 'issue-315' })).toBeDefined()
    expect(await ui.find({ text: /Goldens regenerated/ })).toBeUndefined()
    await ui.press({ key: 'issue-315' })
    expect(await ui.find({ text: /Goldens regenerated/ })).toBeDefined()
    expect(await ui.find({ text: / 2\/3/ })).toBeDefined()

    await ui.press({ key: 'start-315' })
    expect(sent.at(-1)).toMatch(/^Let's start on #315: Lay Kessik out for play\./)
    expect(sent.at(-1)).toMatch(/- Goldens regenerated$/)
    expect(sent.at(-1)).not.toMatch(/Layout in place/)

    await ui.press({ key: 'issue-315' })
    await ui.press({ key: 'filter-active' })
    await ui.unmount()
  }
})

test('the status line sums up the board', () => {
  expect(summary([], [])).toBe('0 issues')
})
