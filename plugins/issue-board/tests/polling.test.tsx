import { expect, mock, test } from 'claude-code/testing'

import { parseIssues } from '../hooks/github'
import { letThrough } from './engine'
import { KESSIK_BODY, adoptedStore, fail, fakeGitHub, pr335 } from './github'
import { COMPOSE, REFRESH, REPO } from './ui'
import { PANE, issue, world } from './void-sector'

// Reading GitHub by itself: the saved board a new session paints, the timer and its cheap checks, the weekly counts,
// the rate limit, and another session's newer read.

test('a new session paints the saved board and keeps the issue Claude was on', async ($, on) => {
  const saved = {
    version: 1,
    board: {
      repo: 'astrosteveo/void-sector',
      issues: parseIssues(JSON.stringify([issue(KESSIK_BODY)])),
      prs: [],
      velocity: { closed: [], merged: [] },
      fetchedAt: Date.parse('2026-10-03T20:00:00Z'),
    },
    working: { number: 315, title: 'Lay Kessik out for play', updatedAt: '2026-10-03T20:00:00Z', sessionId: 'an-earlier-session' },
    dismissed: [],
    viewer: 'astrosteveo',
  }
  adoptedStore(on, { [`repo:${REPO.root}`]: saved })
  on('session.id', async () => ({ value: 'session-2' }))
  letThrough(on)
  on('session.repo', async () => ({ value: REPO }))
  // GitHub can't be reached yet: what shows is what was saved.
  fakeGitHub(on, { routes: [() => fail('offline')] })
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'stop-315' })).toBeDefined()
  // Another session started it, so this session's system prompt doesn't claim it.
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro', 'issue-board:capture'])
  await pane.unmount()
})

test('the board looks every 30 seconds while CI runs, and every 5 minutes otherwise, reading in full when something changed', async ($, on) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.prs = [pr335('pending')]
  await $.command.run(REFRESH)
  expect(gh.prLists).toBe(1)

  // While nothing changes, the look every 30 seconds is a cheap check that GitHub answers 304: nothing more is read.
  await clock.advance(30_000)
  expect(gh.prLists).toBe(1)

  // CI finishes, so its check runs change: the next look reads in full, and then every 5 minutes.
  gh.prs = [pr335('pass')]
  gh.etag = 'E2'
  await clock.advance(30_000)
  expect(gh.prLists).toBe(2)
  gh.etag = 'E3'
  await clock.advance(4 * 60_000)
  expect(gh.prLists).toBe(2)
  await clock.advance(60_000)
  expect(gh.prLists).toBe(3)
})

test('the timer reads GitHub in full only when a cheap check sees a change, and at least every 15 minutes', async ($, on) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  const logged: string[] = []
  on('ui.log', async (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)
  await clock.settle()
  expect(gh.issueReads).toBe(1)
  // Each full read logs what its GraphQL query cost.
  expect(logged).toContain('issue-board: the issues query cost 1 GraphQL points over 1 page; 4999 left until 2026-10-04T11:00:00Z')

  // Five minutes on, nothing changed: GitHub answers 304, which costs nothing, and the board reads no more.
  await clock.advance(5 * 60_000)
  expect(gh.issueReads).toBe(1)
  expect(gh.looks).toBeGreaterThan(1)

  // Something changed: the next look reads in full.
  gh.etag = 'E2'
  await clock.advance(5 * 60_000)
  expect(gh.issueReads).toBe(2)

  // Nothing changes again, but a project field's change shows in no cheap check: 15 minutes on, it reads anyway.
  await clock.advance(10 * 60_000)
  expect(gh.issueReads).toBe(2)
  await clock.advance(5 * 60_000)
  expect(gh.issueReads).toBe(3)
})

test('the weekly counts are read again only after an hour', async ($, on) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  await $.command.run(REFRESH)
  expect(gh.searches).toBe(2)
  await $.command.run(REFRESH)
  expect(gh.searches).toBe(2)
  await clock.advance(61 * 60_000)
  await $.command.run(REFRESH)
  expect(gh.searches).toBe(4)
})

test("when GitHub's rate limit runs out, the board says when it resets, says so once, and reads nothing until then", async ($, on) => {
  adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  gh.limited = '2026-10-04T10:20:00Z'
  const at = new Date(Date.parse(gh.limited)).toTimeString().slice(0, 5)
  const said = await $.command.run(REFRESH)
  expect(said.text).toBe(`Couldn't refresh: GitHub's rate limit for this account ran out. The board reads again at ${at}.`)
  expect(toasts.filter(text => text.includes('rate limit'))).toEqual([`GitHub's rate limit ran out; the issue board waits until ${at}`])
  const reads = gh.issueReads

  // Until the reset, neither the timer nor a refresh asked for reads GitHub.
  await clock.advance(15 * 60_000)
  await $.command.run(REFRESH)
  expect(gh.issueReads).toBe(reads)

  // Once it resets, the board reads again by itself, and the error goes.
  gh.limited = ''
  await clock.advance(6 * 60_000)
  expect(gh.issueReads).toBe(reads + 1)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /rate limit/ })).toBeUndefined()
  expect(await ui.find({ key: 'issue-315' })).toBeDefined()
  await ui.unmount()
  expect(toasts.filter(text => text.includes('rate limit'))).toHaveLength(1)
})

test("another session's newer read of the same repo is taken rather than reading GitHub again", async ($, on) => {
  // The store every session on the machine shares.
  const stored = adoptedStore(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  await $.command.run(REFRESH)
  await clock.settle()
  expect(gh.issueReads).toBe(1)

  // Another session on the same repo reads GitHub a minute later and saves its board.
  await clock.advance(60_000)
  const [key = ''] = [...stored.keys()].filter(one => one.startsWith('repo:'))
  const saved = stored.get(key) as { board: { fetchedAt: number; issues: { number: number; title: string }[] } }
  const renamed = saved.board.issues.map(one => (one.number === 315 ? { ...one, title: 'Lay Kessik out for play, renamed' } : one))
  stored.set(key, { ...saved, board: { ...saved.board, fetchedAt: Date.parse('2026-10-04T10:01:00Z'), issues: renamed } })

  // This session's next look takes it: the new title shows, and GitHub isn't read.
  await clock.advance(5 * 60_000)
  expect(gh.issueReads).toBe(1)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  expect(await ui.find({ text: /renamed/ })).toBeDefined()
  await ui.unmount()
})
