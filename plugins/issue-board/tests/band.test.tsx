import { expect, test } from 'claude-code/testing'

import { graphPage, isIssuesQuery } from './graph'

const issue = (updatedAt: string) => ({
  number: 315,
  title: 'Lay Kessik out for play',
  url: 'https://github.com/astrosteveo/void-sector/issues/315',
  labels: [{ name: 'area:simulation', color: '0e8a16' }],
  assignees: [],
  body: '- [ ] Goldens regenerated',
  updatedAt,
})

const failing = {
  number: 335,
  title: 'Glide in to a planet',
  url: 'https://github.com/astrosteveo/void-sector/pull/335',
  headRefName: 'fix/planet-glide',
  isDraft: false,
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
  reviewDecision: null,
  additions: 1,
  deletions: 1,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-03T20:00:00Z',
}

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

test('the band raises failing CI, news on the issue Claude is on, and its closing', async ($, on) => {
  let issues: unknown[] = [issue('2026-10-03T20:00:00Z')]
  let prs: unknown[] = [failing]
  on('process.run', async (_$, e) => {
    const kind = e.argv[1]
    const stdout = isIssuesQuery(e.argv) ? graphPage(issues as never) : kind === 'repo' ? JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }) : e.argv.includes('closed') || e.argv.includes('merged') ? '[]' : JSON.stringify(kind === 'issue' ? issues : prs)
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // What the engine draws in the band when no plugin has anything to say.
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)

  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: / ✗ CI / })).toBeDefined()
  await band.press({ key: 'fix-335' })
  expect(sent.at(-1)).toMatch(/^CI is failing on PR #335: Glide in to a planet/)
  await band.press({ key: 'dismiss-ci-335-2026-10-03T20:00:00Z' })
  expect(await band.find({ text: / ✗ CI / })).toBeUndefined()

  // Start hands #315 to Claude; nothing to say about it until it changes.
  prs = []
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  await $.command.run(REFRESH)
  expect(await band.find({ text: / ● NEW / })).toBeUndefined()

  issues = [issue('2026-10-04T08:00:00Z')]
  await $.command.run(REFRESH)
  expect(await band.find({ text: / ● NEW / })).toBeDefined()
  expect((await band.find({ type: 'Link' }))?.props).toMatchObject({ href: 'https://github.com/astrosteveo/void-sector/issues/315', label: '↗ GitHub' })

  issues = []
  await $.command.run(REFRESH)
  expect(await band.find({ text: / ✓ DONE / })).toBeDefined()
  await band.press({ key: 'dismiss-closed-315' })
  expect(await band.find({ text: / ✓ DONE / })).toBeUndefined()

  await pane.unmount()
  await band.unmount()
})

test('the band shows nothing while nothing needs the person, even with an issue under way and CI running', async ($, on) => {
  const running = { ...failing, statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }], body: 'Closes #315' }
  const issues: unknown[] = [issue('2026-10-03T20:00:00Z')]
  let prs: unknown[] = []
  on('process.run', async (_$, e) => {
    const kind = e.argv[1]
    const stdout = isIssuesQuery(e.argv) ? graphPage(issues as never) : kind === 'repo' ? JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }) : e.argv.includes('closed') || e.argv.includes('merged') ? '[]' : JSON.stringify(kind === 'issue' ? issues : prs)
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))

  // No board yet: nothing to say.
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'engine' })).toBeDefined()

  // An open issue and nothing wrong: still nothing.
  await $.command.run(REFRESH)
  expect(await band.find({ key: 'engine' })).toBeDefined()

  // Claude on #315, its pull request's CI running: that is progress, which the pane shows and the band doesn't.
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  prs = [running]
  await $.command.run(REFRESH)
  expect(await band.find({ key: 'engine' })).toBeDefined()
  expect(await band.find({ key: 'stop-315' })).toBeUndefined()
  expect(await pane.find({ text: /▶ Working on/ })).toBeDefined()
  expect(await pane.find({ key: 'stop-315' })).toBeDefined()
  expect(await pane.find({ key: 'pr-335' })).toBeDefined()

  // CI failing is something to act on, so the band speaks up. Waved off, it goes quiet again.
  prs = [{ ...failing, body: 'Closes #315' }]
  await $.command.run(REFRESH)
  expect(await band.find({ key: 'engine' })).toBeUndefined()
  expect(await band.find({ text: / ✗ CI / })).toBeDefined()
  await band.press({ key: 'dismiss-ci-335-2026-10-03T20:00:00Z' })
  expect(await band.find({ key: 'engine' })).toBeDefined()

  // The pane's ✕ on Working on stops tracking the issue, as the band's row used to.
  await pane.press({ key: 'stop-315' })
  expect(await pane.find({ text: /▶ Working on/ })).toBeUndefined()

  await pane.unmount()
  await band.unmount()
})
