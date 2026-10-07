import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { KESSIK, fail, fakeGitHub, issueReads } from './github'
import { REFRESH, REPO, pane } from './ui'

const issue = { ...KESSIK, labels: [], body: '- [ ] Layout in place' }

const PANE = pane(100, 40)
const FETCHING = /Fetching issues and pull requests/

// GitHub and git as the board reads them, and how often the board read the issues. `offline`: every gh call fails.
// `late`: the board's first read of the repo waits for the clock to move this far.
const world = (on: On, clock: { sleep: (ms: number) => Promise<void> }) => {
  const state = { offline: false, late: 0 }
  const gh = fakeGitHub(on, {
    issues: [issue],
    routes: [
      async ({ argv }) => {
        if (argv[0] !== 'gh') return undefined
        if (state.offline) return fail('offline')
        if (argv[1] === 'repo' && argv[4] === 'nameWithOwner,hasIssuesEnabled' && state.late > 0) {
          const wait = state.late
          state.late = 0
          await clock.sleep(wait)
        }
        return undefined
      },
    ],
  })
  return Object.assign(state, { reads: () => issueReads(gh) })
}

// The plugins' state, held as the host holds it. The host empties it when /clear starts the session over, just after
// the session.end hooks run; the test's engine doesn't, so `wipe()` stands in for that: every value then reads as never
// written, until it is written again. A drawing isn't drawn again when a value changes, so the tests mount afresh.
const wipeable = (on: On) => {
  const held = new Map<string, { value: unknown; version: number }>()
  // Versions keep counting up across a wipe, as the host's do.
  let floor = 0
  const name = (e: { plugin: string; key: string; id?: string }) => `${e.plugin}/${e.key}/${e.id ?? ''}`
  on('state.get', async (_$, e) => ({ value: held.get(name(e)) ?? { value: undefined, version: floor } }))
  on('state.set', async (_$, e) => {
    const version = held.get(name(e))?.version ?? floor
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false as const, version } }
    held.set(name(e), { value: e.value, version: version + 1 })
    return { value: { isSet: true as const, version: version + 1 } }
  })
  return () => {
    for (const one of held.values()) floor = Math.max(floor, one.version)
    held.clear()
  }
}

// What the engine beneath the board answers in these tests: the repo, the session's ends and starts.
const engine = (on: On) => {
  on('session.repo', async () => ({ value: REPO }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', async () => ({}))
}

// /clear as the board sees it: the session ends with reason `clear`, the host empties the state, and the new
// session's SessionStart hooks run. /new and /reset are other names for /clear, so they reach the board the same way.
const clear = async ($: Engine, wipe: () => void, session: string) => {
  await $.session.end({ reason: 'clear', sessionId: session, resume: { id: session } })
  wipe()
  await $.classic.SessionStart({ source: 'clear' })
}

// What the pane shows: whether it lists #315, says it is fetching, or says it couldn't reach GitHub.
const look = async ($: Engine) => {
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  const seen = {
    listed: (await pane.find({ key: 'issue-315' })) !== undefined,
    fetching: (await pane.find({ text: FETCHING })) !== undefined,
    failed: (await pane.find({ text: /Couldn't reach GitHub/ })) !== undefined,
  }
  await pane.unmount()
  return seen
}

test('after /clear or /new the pane reads GitHub again and lists the board, and Refresh still works', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  engine(on)
  const wipe = wipeable(on)
  const gh = world(on, clock)
  await $.command.run(REFRESH)
  expect(await look($)).toEqual({ listed: true, fetching: false, failed: false })

  for (const [index, command] of ['/clear', '/new'].entries()) {
    const reads = gh.reads()
    await clear($, wipe, `session-${index}`)
    await clock.settle()
    expect({ command, ...(await look($)) }).toEqual({ command, listed: true, fetching: false, failed: false })
    expect(gh.reads()).toBe(reads + 1)
  }

  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  const reads = gh.reads()
  await pane.press({ key: 'refresh' })
  await clock.settle()
  expect(gh.reads()).toBe(reads + 1)
  expect(await pane.find({ key: 'issue-315' })).toBeDefined()
  await pane.unmount()
})

test('a refresh under way when the context is cleared still ends with the board shown', async ($, on) => {
  // A store whose first write waits, so the board is already drawn when /clear empties the state, and the refresh
  // that drew it is still saving.
  const kept = new Map<string, unknown>()
  let writes = 0
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', async (_$, e) => {
    writes += 1
    if (writes === 1) await clock.sleep(1000)
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  engine(on)
  const wipe = wipeable(on)
  const gh = world(on, clock)

  const refreshed = $.command.run(REFRESH)
  await clock.settle()
  expect(gh.reads()).toBe(1)
  await clear($, wipe, 'session-1')
  await clock.advance(1000)
  await refreshed
  await clock.settle()
  expect(await look($)).toEqual({ listed: true, fetching: false, failed: false })
})

test('a refresh that is still reading GitHub when the context is cleared ends with the board shown', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  engine(on)
  const wipe = wipeable(on)
  const gh = world(on, clock)
  gh.late = 1000

  const refreshed = $.command.run(REFRESH)
  await clock.settle()
  await clear($, wipe, 'session-1')
  await clock.settle()
  // Still reading: the pane says so, and the refresh /clear asked for waits on the one under way.
  expect(await look($)).toEqual({ listed: false, fetching: true, failed: false })
  expect(gh.reads()).toBe(0)
  await clock.advance(1000)
  await refreshed
  await clock.settle()
  expect(await look($)).toEqual({ listed: true, fetching: false, failed: false })
})

test('a refresh that fails after /clear shows the error, not the loading line', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  engine(on)
  const wipe = wipeable(on)
  const gh = world(on, clock)
  gh.offline = true
  await $.command.run(REFRESH)
  expect(await look($)).toEqual({ listed: false, fetching: false, failed: true })

  await clear($, wipe, 'session-1')
  await clock.settle()
  expect(await look($)).toEqual({ listed: false, fetching: false, failed: true })

  // A refresh under way when the context is cleared, which then fails, ends in the error too.
  gh.offline = false
  gh.late = 1000
  const refreshed = $.command.run(REFRESH)
  await clock.settle()
  gh.offline = true
  await clear($, wipe, 'session-2')
  await clock.advance(1000)
  await refreshed
  await clock.settle()
  expect(await look($)).toEqual({ listed: false, fetching: false, failed: true })
})

test('without a SessionStart hook after /clear, the next prompt fills the board again', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  engine(on)
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  const wipe = wipeable(on)
  const gh = world(on, clock)
  await $.command.run(REFRESH)

  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
  wipe()
  await clock.settle()
  expect((await look($)).listed).toBe(false)
  const reads = gh.reads()
  await $.prompt.submit({ text: 'What next?', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(await look($)).toEqual({ listed: true, fetching: false, failed: false })
  expect(gh.reads()).toBe(reads + 1)
})
