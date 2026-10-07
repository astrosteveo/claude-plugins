import { expect, test } from 'claude-code/testing'

import { KESSIK, fakeGitHub, pr335 } from './github'
import { REFRESH, band, engineBand, pane } from './ui'

const issue = (updatedAt: string) => ({ ...KESSIK, labels: [{ name: 'area:simulation', color: '0e8a16' }], assignees: [], body: '- [ ] Goldens regenerated', updatedAt })

const failing = { ...pr335('fail'), statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }], reviewDecision: null, body: undefined }

const BAND = band(100)
const PANE = pane(100, 40)

test('the band raises failing CI, news on the issue Claude is on, and its closing', async ($, on) => {
  const gh = fakeGitHub(on, { issues: [issue('2026-10-03T20:00:00Z')], prs: [failing] })
  engineBand(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: / ✗ CI / })).toBeDefined()
  await ui.press({ key: 'fix-335' })
  expect(sent.at(-1)).toMatch(/^CI is failing on PR #335: Glide in to a planet/)
  await ui.press({ key: 'dismiss-ci-335-2026-10-03T20:00:00Z' })
  expect(await ui.find({ text: / ✗ CI / })).toBeUndefined()

  // Start hands #315 to Claude; nothing to say about it until it changes.
  gh.prs = []
  const board = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await board.press({ key: 'filter-all' })
  await board.press({ key: 'issue-315' })
  await board.press({ key: 'start-315' })
  await $.command.run(REFRESH)
  expect(await ui.find({ text: / ● NEW / })).toBeUndefined()

  gh.issues = [issue('2026-10-04T08:00:00Z')]
  await $.command.run(REFRESH)
  expect(await ui.find({ text: / ● NEW / })).toBeDefined()
  expect((await ui.find({ type: 'Link' }))?.props).toMatchObject({ href: 'https://github.com/astrosteveo/void-sector/issues/315', label: '↗ GitHub' })

  gh.issues = []
  await $.command.run(REFRESH)
  expect(await ui.find({ text: / ✓ DONE / })).toBeDefined()
  await ui.press({ key: 'dismiss-closed-315' })
  expect(await ui.find({ text: / ✓ DONE / })).toBeUndefined()

  await board.unmount()
  await ui.unmount()
})

test('the band shows nothing while nothing needs the person, even with an issue under way and CI running', async ($, on) => {
  const running = { ...failing, statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }], body: 'Closes #315' }
  const gh = fakeGitHub(on, { issues: [issue('2026-10-03T20:00:00Z')] })
  engineBand(on)
  on('prompt.submit', async (_$, e) => ({ text: e.text }))

  // No board yet: nothing to say.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'engine' })).toBeDefined()

  // An open issue and nothing wrong: still nothing.
  await $.command.run(REFRESH)
  expect(await ui.find({ key: 'engine' })).toBeDefined()

  // Claude on #315, its pull request's CI running: that is progress, which the pane shows and the band doesn't.
  const board = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await board.press({ key: 'filter-all' })
  await board.press({ key: 'issue-315' })
  await board.press({ key: 'start-315' })
  gh.prs = [running]
  await $.command.run(REFRESH)
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ key: 'stop-315' })).toBeUndefined()
  expect(await board.find({ text: /^▶ $/ })).toBeDefined()
  expect(await board.find({ key: 'stop-315' })).toBeDefined()
  expect(await board.find({ key: 'pr-335' })).toBeDefined()

  // CI failing is something to act on, so the band speaks up. Waved off, it goes quiet again.
  gh.prs = [{ ...failing, body: 'Closes #315' }]
  await $.command.run(REFRESH)
  expect(await ui.find({ key: 'engine' })).toBeUndefined()
  expect(await ui.find({ text: / ✗ CI / })).toBeDefined()
  await ui.press({ key: 'dismiss-ci-335-2026-10-03T20:00:00Z' })
  expect(await ui.find({ key: 'engine' })).toBeDefined()

  // The ✕ on the pane's ▶ row stops tracking the issue, as the band's row used to.
  await board.press({ key: 'stop-315' })
  expect(await board.find({ text: /^▶ $/ })).toBeUndefined()

  await board.unmount()
  await ui.unmount()
})

test('with the band turned off, failing CI leaves the band to the engine', { options: { band: false } }, async ($, on) => {
  fakeGitHub(on, { issues: [issue('2026-10-03T20:00:00Z')], prs: [failing] })
  engineBand(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ text: / ✗ CI / })).toBeUndefined()
  await ui.unmount()
})
