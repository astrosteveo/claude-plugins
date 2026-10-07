import { expect, test } from 'claude-code/testing'

import { closeOutAllPrompt, closeOutPrompt, closeOutRisk, parsePrs, workerOfPr } from '../hooks/parse'
import type { Worker } from '../types'
import { fakeGitHub, heldState } from './github'
import { REFRESH, pane } from './ui'

const pr = (number: number, title: string, branch: string, isDraft = false) => ({
  number,
  title,
  url: `https://github.com/astrosteveo/void-sector/pull/${number}`,
  headRefName: branch,
  isDraft,
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
  reviewDecision: null,
  additions: 1,
  deletions: 1,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-03T20:00:00Z',
})

const PRS = [pr(337, 'Tune the docking lane', 'fix/dock-lane', true), pr(335, 'Glide in to a planet', 'fix/planet-glide')]

test('the close-out prompts name each pull request and ask for a guarded merge', () => {
  const parsed = parsePrs(JSON.stringify(PRS))
  const draft = parsed.find(one => one.isDraft)!
  const ready = parsed.find(one => !one.isDraft)!
  expect(closeOutPrompt(ready)).toMatch(/^Close out PR #335: Glide in to a planet \(branch `fix\/planet-glide`\)\./)
  expect(closeOutPrompt(ready)).toMatch(/don't bypass branch protection or force-push/)
  expect(closeOutPrompt(ready)).not.toMatch(/draft/)
  expect(closeOutPrompt(draft)).toMatch(/It is a draft: finish it and mark it ready first\./)

  const all = closeOutAllPrompt(parsed)
  expect(all).toMatch(/^Merge all 2 open pull requests:\n- #335: .*\n- #337: .*, draft\)\n/)
  expect(all).toMatch(/oldest first/)
  expect(closeOutAllPrompt([ready])).toMatch(/^Merge all 1 open pull request:/)
})

test('Close out sends one pull request, and Close out all asks before sending them all', async ($, on) => {
  fakeGitHub(on, { prs: PRS })
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)

  for (const surface of ['terminal', 'desktop'] as const) {
    sent.length = 0
    const ui = await $.ui.mount({ plugin: 'issue-board', surface, ...pane(100, 40) })
    expect(await ui.find({ key: 'close-out-335' })).toBeDefined()
    expect(await ui.find({ key: 'close-out-337' })).toBeDefined()

    await ui.press({ key: 'close-out-335' })
    expect(sent).toEqual([expect.stringMatching(/^Close out PR #335: /)])

    // The first press only asks; Cancel puts the button back without sending anything.
    expect((await ui.find({ key: 'close-out-all' }))?.text).toBe('⇶ Merge all 2…')
    await ui.press({ key: 'close-out-all' })
    expect(sent).toHaveLength(1)
    expect(await ui.find({ text: /^Finish and merge all 2 open PRs\?$/ })).toBeDefined()
    expect(await ui.find({ text: /^y merge every open PR/ })).toBeDefined()
    await ui.press({ key: 'close-out-all-no' })
    expect(await ui.find({ key: 'close-out-all-yes' })).toBeUndefined()
    expect(sent).toHaveLength(1)

    await ui.press({ key: 'close-out-all' })
    await ui.press({ key: 'close-out-all-yes' })
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatch(/^Merge all 2 open pull requests:\n- #335: Glide in to a planet/)
    expect(await ui.find({ key: 'close-out-all' })).toBeDefined()
    await ui.unmount()
  }
})

// A pull request's row shows a ⚙ while a background agent owns its branch, and its Finish & merge asks first, naming
// why, while that agent works or its CI is running or failing. A clean pull request goes straight to Claude (#264).

const riskyPr = (number: number, title: string, conclusion: string | null, body: string) => ({
  number,
  title,
  url: `https://github.com/astrosteveo/void-sector/pull/${number}`,
  headRefName: `fix/${number}-branch`,
  isDraft: false,
  statusCheckRollup: conclusion ? [{ name: 'test', status: 'COMPLETED', conclusion }] : [{ name: 'test', status: 'IN_PROGRESS' }],
  reviewDecision: null,
  additions: 1,
  deletions: 1,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-03T20:00:00Z',
  body,
})

// #401 is for #50, which a background agent is on; #402's CI is still running; #403 is clean.
const RISKY = [riskyPr(401, 'Show the worker on the card', 'SUCCESS', 'Refs #50'), riskyPr(402, 'Tune the docking lane', null, 'Refs #51'), riskyPr(403, 'Glide in to a planet', 'SUCCESS', 'Closes #52')]

const WORKER: Worker = { number: 50, title: 'Show the worker on the card', agentId: 'agent-1', status: 'running', startedAt: Date.now(), answer: null }

test('the risk of closing out names a working agent and CI that has not passed, and nothing for a clean pull request', () => {
  const [owned, pending, clean] = parsePrs(JSON.stringify(RISKY)) as [ReturnType<typeof parsePrs>[number], ReturnType<typeof parsePrs>[number], ReturnType<typeof parsePrs>[number]]
  expect(workerOfPr(owned, [WORKER])).toEqual(WORKER)
  // An agent that ended no longer owns the branch.
  expect(workerOfPr(owned, [{ ...WORKER, status: 'completed' }])).toBeUndefined()
  expect(workerOfPr(clean, [WORKER])).toBeUndefined()

  expect(closeOutRisk(owned, WORKER)).toBe('A background agent is still on #50 and may push to its branch.')
  expect(closeOutRisk(pending)).toBe('Its CI is still running.')
  expect(closeOutRisk({ ...owned, ci: 'fail' }, WORKER)).toBe('A background agent is still on #50 and may push to its branch, and its CI is failing.')
  expect(closeOutRisk(clean)).toBeNull()
})

test('Finish & merge asks first on a worker-owned or pending pull request, and sends a clean one at once', async ($, on) => {
  fakeGitHub(on, { prs: RISKY })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  // The board's state, held here so the test can put a background agent on it, so each look mounts the pane afresh.
  const held = heldState(on)
  await $.command.run(REFRESH)
  held.set('issue-board/workers', { value: [WORKER], version: 1 })

  const mount = () => $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(110, 60) })
  const look = async (then: (ui: Awaited<ReturnType<typeof mount>>) => Promise<unknown>) => {
    const ui = await mount()
    await then(ui)
    await ui.unmount()
  }

  // Only the worker-owned row shows the ⚙.
  await look(async ui => {
    const marked = async (number: number) => JSON.stringify((await ui.find({ key: `pr-row-${number}` })) ?? null).includes('⚙')
    expect([await marked(401), await marked(402), await marked(403)]).toEqual([true, false, false])
  })

  // The worker-owned pull request asks, names the agent, and Cancel sends nothing.
  await look(ui => ui.press({ key: 'close-out-401' }))
  expect(sent).toEqual([])
  await look(async ui => {
    expect(await ui.find({ text: 'Close out PR #401 anyway? A background agent is still on #50 and may push to its branch.' })).toBeDefined()
    await ui.press({ key: 'close-out-no-401' })
  })
  await look(async ui => expect(await ui.find({ key: 'close-out-ask-401' })).toBeUndefined())
  expect(sent).toEqual([])

  // The pull request whose CI is running asks too, and Close out anyway sends it.
  await look(ui => ui.press({ key: 'close-out-402' }))
  expect(sent).toEqual([])
  await look(async ui => {
    expect(await ui.find({ text: 'Close out PR #402 anyway? Its CI is still running.' })).toBeDefined()
    await ui.press({ key: 'close-out-yes-402' })
  })
  expect(sent).toEqual([expect.stringMatching(/^Close out PR #402: /)])
  await look(async ui => expect(await ui.find({ key: 'close-out-ask-402' })).toBeUndefined())

  // A clean pull request goes at once.
  await look(ui => ui.press({ key: 'close-out-403' }))
  expect(sent).toHaveLength(2)
  expect(sent[1]).toMatch(/^Close out PR #403: /)

  // One confirm waits at a time: arming Merge all cancels a pull request's ask, and arming that ask again cancels Merge
  // all's (#296).
  await look(ui => ui.press({ key: 'close-out-401' }))
  await look(ui => ui.press({ key: 'close-out-all' }))
  await look(async ui => {
    expect(await ui.find({ key: 'close-out-all-yes' })).toBeDefined()
    expect(await ui.find({ key: 'close-out-ask-401' })).toBeUndefined()
    await ui.press({ key: 'close-out-401' })
  })
  await look(async ui => {
    expect(await ui.find({ key: 'close-out-ask-401' })).toBeDefined()
    expect(await ui.find({ key: 'close-out-all-yes' })).toBeUndefined()
  })
  expect(sent).toHaveLength(2)
})
