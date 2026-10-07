import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { PullRequest, Worker, Working } from '../types'
import { parsePrs } from '../hooks/github'
import { completionFlip, keywordFor, prBodyText, prKeywordCheck, switchKeyword } from '../hooks/prompts'
import { prIssueOf, prOfIssue } from '../hooks/workers'
import { letThrough } from './engine'
import { ASTEROIDS, KESSIK, fakeGitHub, heldState, json, line, pr335, session } from './github'
import type { Route } from './github'
import { REFRESH } from './ui'

// Where a pull request is opened or edited, its `Closes #N` or `Refs #N` is held to the boxes of the issue of the loop
// that opens it; and a tick that ticks an issue's last box, or opens one again, switches its open pull request's.

const OPEN = [
  { done: true, text: 'Layout in place' },
  { done: false, text: 'Old saves load' },
  { done: false, text: 'Goldens regenerated' },
]
const TICKED = OPEN.map(box => ({ ...box, done: true }))

const worker = (number: number, agentId: string, status: Worker['status'] = 'running'): Worker => ({ number, agentId, status, startedAt: 0, answer: null })

test('the body of gh pr create or edit is read from --body, -b, or stdin, and not from a file', () => {
  expect(prBodyText('gh pr create --title "Glide" --body "Refs #315"')).toContain('Refs #315')
  expect(prBodyText("gh pr create -t Glide -b 'Closes #315'")).toContain('Closes #315')
  expect(prBodyText('gh pr edit 335 --body="Refs #315"')).toContain('Refs #315')
  const heredoc = "gh pr create --title Glide --body-file - <<'EOF'\nGlides in.\n\nCloses #315\nEOF"
  expect(prBodyText(heredoc)).toBe(heredoc)
  expect(prBodyText('gh pr create --title Glide --body "$(cat <<\'EOF\'\nRefs #315\nEOF\n)"')).toContain('Refs #315')
  // A file the board can't see, no body at all, and a command that isn't a pull request's are left alone.
  expect(prBodyText('gh pr create --title Glide --body-file pr.md')).toBeNull()
  expect(prBodyText('gh pr edit 335 --add-label bug')).toBeNull()
  expect(prBodyText('gh issue create --body "Closes #315"')).toBeNull()
})

test("a body's keyword for an issue: a closing one wins, a longer number isn't the issue's, and another repo's form counts", () => {
  expect(keywordFor('Closes #315', 315)).toEqual({ closes: true, word: 'Closes' })
  expect(keywordFor('fixes: #315', 315)).toEqual({ closes: true, word: 'fixes' })
  expect(keywordFor('Refs #315. Resolves o/r#315', 315)).toEqual({ closes: true, word: 'Resolves' })
  expect(keywordFor('Ref #315', 315)).toEqual({ closes: false, word: 'Ref' })
  expect(keywordFor('Closes #3150', 315)).toBeNull()
  expect(keywordFor('About #315', 315)).toBeNull()
})

test('the check denies a keyword that disagrees with the boxes and names the right one; a body with none gets a reminder; off, it says nothing', () => {
  const open = { number: 315, checks: OPEN }
  const ticked = { number: 315, checks: TICKED }
  expect(prKeywordCheck('Closes #315', open, true)).toEqual({ deny: '#315 has 2 open boxes: write `Refs #315`, not `Closes #315`.' })
  expect(prKeywordCheck('fixes #315', { number: 315, checks: OPEN.slice(0, 2) }, true)).toEqual({ deny: '#315 has 1 open box: write `Refs #315`, not `fixes #315`.' })
  expect(prKeywordCheck('Refs #315', ticked, true)).toEqual({ deny: '#315 has every box ticked: write `Closes #315`, not `Refs #315`.' })
  expect(prKeywordCheck('Refs #315', open, true)).toBeNull()
  expect(prKeywordCheck('Closes #315', ticked, true)).toBeNull()
  // An issue with no boxes is done when its work is.
  expect(prKeywordCheck('Closes #315', { number: 315, checks: [] }, true)).toBeNull()
  // A body with no keyword for the issue.
  expect(prKeywordCheck('Glides in. Closes #289', open, true)).toEqual({ remind: "The pull request doesn't say which issue it is for: add `Refs #315` to its body." })
  // No issue, or the rule off.
  expect(prKeywordCheck('Closes #315', null, true)).toBeNull()
  expect(prKeywordCheck('Closes #315', open, false)).toBeNull()
})

test("the issue of a pull request is the worker's in a worker's loop, even while another runs, and the session's in the main loop", () => {
  const two = [worker(289, 'agent-1'), worker(50, 'agent-2')]
  expect(prIssueOf(undefined, 315, two)).toBe(315)
  expect(prIssueOf('agent-1', 315, two)).toBe(289)
  expect(prIssueOf('agent-2', 315, two)).toBe(50)
  // A subagent that isn't a worker, such as a search the main session sent, has no issue; nor has a session on none.
  expect(prIssueOf('agent-9', 315, two)).toBeNull()
  expect(prIssueOf(undefined, null, two)).toBeNull()
})

test('a tick flips the keyword only when it crosses into every box ticked, or out of it, and the switch changes only that keyword', () => {
  expect(completionFlip(OPEN, TICKED)).toBe(true)
  expect(completionFlip(TICKED, OPEN)).toBe(false)
  expect(completionFlip(OPEN, OPEN.map((box, index) => ({ ...box, done: index < 2 })))).toBeNull()
  expect(completionFlip(TICKED, TICKED)).toBeNull()

  expect(switchKeyword('Glides in.\n\nRefs #315', 315, true)).toBe('Glides in.\n\nCloses #315')
  expect(switchKeyword('Glides in.\n\nCloses #315\n\nRefs #289', 315, false)).toBe('Glides in.\n\nRefs #315\n\nRefs #289')
  expect(switchKeyword('Fixes: #315 and closes o/r#315', 315, false)).toBe('Refs: #315 and Refs o/r#315')
  // Already right, or no keyword for the issue: nothing to write.
  expect(switchKeyword('Closes #315', 315, true)).toBeNull()
  expect(switchKeyword('Refs #3150', 315, true)).toBeNull()
})

test("a tick's pull request is the one for the issue on its branch, the session's branch, or a worker's; none when two could be", () => {
  const prs = parsePrs(
    JSON.stringify([
      { ...pr335('pass'), headRefName: 'fix/315-glide', body: 'Refs #315' },
      { ...pr335('pass'), number: 336, headRefName: 'cleanup', body: 'Refs #315. Refs #289' },
      { ...pr335('pass'), number: 337, headRefName: 'worktree-agent-1', body: 'Refs #50' },
    ]),
  ) as PullRequest[]
  const none = { branch: null, working: null }
  expect(prOfIssue(prs, 315, none, [])?.number).toBe(335)
  expect(prOfIssue(prs, 289, none, [])).toBeNull()
  expect(prOfIssue(prs, 289, { branch: 'cleanup', working: 289 }, [])?.number).toBe(336)
  expect(prOfIssue(prs, 50, none, [worker(50, 'agent-2')])?.number).toBe(337)
  // A worker on #315 makes both #335 and #336 its own: the board can't tell which, so it writes neither.
  expect(prOfIssue(prs, 315, none, [worker(315, 'agent-1')])).toBeNull()
})

// The board's state held here, so a test can put the session on an issue and workers on others.
const world = (on: On, body = KESSIK.body) => {
  const state = { body, prBody: 'Glides in.\n\nRefs #315', prWrites: [] as string[] }
  const route: Route = ({ argv, stdin }) => {
    if (argv[1] === 'api' && argv.includes('{body, updated_at}')) return json({ body: state.body, updated_at: KESSIK.updatedAt })
    if (argv[1] === 'api' && argv[3] === 'PATCH' && /\/issues\/315$/.test(argv[4] ?? '')) {
      state.body = (JSON.parse(stdin ?? '{}') as { body: string }).body
      return json({ title: KESSIK.title, body: state.body, updated_at: '2026-10-04T10:00:00Z' })
    }
    if (argv[1] === 'api' && argv[3] === 'PATCH' && /\/pulls\/335$/.test(argv[4] ?? '')) {
      state.prBody = (JSON.parse(stdin ?? '{}') as { body: string }).body
      state.prWrites.push(state.prBody)
      return json({ number: 335, body: state.prBody })
    }
    return undefined
  }
  const asteroids = { ...ASTEROIDS, body: '- [x] Asteroids draw' }
  const gh = fakeGitHub(on, { issues: [{ ...KESSIK, body }, asteroids], prs: [{ ...pr335('pass'), headRefName: 'fix/315-glide', body: state.prBody }], routes: [route] })
  session(on)
  letThrough(on)
  on('ui.toast', async () => ({ value: undefined }))
  const held = heldState(on)
  const working: Working = { number: 315, title: KESSIK.title, updatedAt: KESSIK.updatedAt, sessionId: 'session-1' }
  const put = () => {
    held.set('issue-board/working', { value: working, version: 1 })
    held.set('issue-board/workers', { value: [worker(289, 'agent-1'), worker(50, 'agent-2')], version: 1 })
  }
  return { gh, state, put }
}

const create = (body: string) => `gh pr create --title "Lay Kessik out" --body "${body}"`

test('opening a pull request is checked against the issue of the loop that opens it: the main session, or a worker while another runs', async ($, on) => {
  const { put } = world(on)
  // Beneath the board, Claude Code would run the command.
  on('tool.check', async () => ({ decision: 'allow' as const }))
  await $.command.run(REFRESH)
  put()
  // `agentId` is what the engine sets on a call in a subagent's loop; a query's input type leaves it out.
  const check = (command: string, agentId?: string) => $.tool.check({ tool: 'Bash', input: { command }, ...(agentId ? { agentId } : {}) } as never)

  // The main session is on #315, with two of three boxes open.
  expect(await check(create('Closes #315'))).toEqual({ decision: 'deny', reason: '#315 has 2 open boxes: write `Refs #315`, not `Closes #315`.' })
  expect((await check(create('Refs #315'))).decision).toBe('allow')
  // The worker on #289, every box ticked, while the worker on #50 runs too.
  expect(await check(create('Refs #289'), 'agent-1')).toEqual({ decision: 'deny', reason: '#289 has every box ticked: write `Closes #289`, not `Refs #289`.' })
  expect((await check(create('Closes #289'), 'agent-1')).decision).toBe('allow')
  // An edit's heredoc body is read too.
  expect((await check("gh pr edit 335 --body-file - <<'EOF'\nCloses #315\nEOF")).decision).toBe('deny')
  // A body with no keyword is allowed, with a reminder.
  expect(await check(create('Glides in.'))).toEqual({ decision: 'allow', reason: "The pull request doesn't say which issue it is for: add `Refs #315` to its body." })
  // A body from a file, and a subagent that is no worker, are left alone.
  expect(await check('gh pr create --title Glide --body-file pr.md')).toEqual({ decision: 'allow' })
  expect(await check(create('Closes #315'), 'agent-9')).toEqual({ decision: 'allow' })
})

test('with the rule off, a pull request is opened as Claude writes it', { options: { closesWhenTicked: false } }, async ($, on) => {
  const { put } = world(on)
  on('tool.check', async () => ({ decision: 'allow' as const }))
  await $.command.run(REFRESH)
  put()
  expect(await $.tool.check({ tool: 'Bash', input: { command: create('Closes #315') } })).toEqual({ decision: 'allow' })
  expect(await $.tool.check({ tool: 'Bash', input: { command: create('Glides in.') } })).toEqual({ decision: 'allow' })
})

test("ticking an issue's last box switches its pull request to Closes, and unticking one switches it back, one write each", async ($, on) => {
  const { gh, state, put } = world(on)
  await $.command.run(REFRESH)
  put()

  // A box that leaves one open changes no pull request.
  const one = await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [2] })
  expect(String(one.result)).toBe('Ticked box 2. #315 has 2/3 ticked.')
  expect(state.prWrites).toEqual([])

  // The last box: one write of the pull request's body.
  const mark = gh.ran.length
  const last = await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [3] })
  expect(String(last.result)).toBe('Ticked box 3. #315 has 3/3 ticked. Pull request #335 now says `Closes #315`.')
  expect(state.prWrites).toEqual(['Glides in.\n\nCloses #315'])
  expect(gh.ran.slice(mark).map(line).filter(call => call.includes('pulls/335'))).toEqual(['gh api -X PATCH repos/astrosteveo/void-sector/pulls/335 --input -'])

  // Unticking one switches it back, from the body the board now holds.
  const back = await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [1], done: false })
  expect(String(back.result)).toBe('Unticked box 1. #315 has 2/3 ticked. Pull request #335 now says `Refs #315`.')
  expect(state.prWrites).toEqual(['Glides in.\n\nCloses #315', 'Glides in.\n\nRefs #315'])
})
