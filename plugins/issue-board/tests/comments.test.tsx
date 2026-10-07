import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { answerPrompt, commentsOf, mergeNoteOf, parsePrs, threadsOf } from '../hooks/parse'
import { fakeGitHub, ok, session } from './github'
import type { Call } from './github'
import { REFRESH, pane } from './ui'

const PANE = pane(140, 80)

const pr = (number: number, mergeStateStatus: string, reviewRequests: unknown[] = []) => ({
  number,
  title: `Pull request ${number}`,
  url: '',
  headRefName: `branch-${number}`,
  isDraft: false,
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
  reviewDecision: 'REVIEW_REQUIRED',
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-05T00:00:00Z',
  body: '',
  closingIssuesReferences: [],
  mergeStateStatus,
  reviewRequests,
})

const THREADS = JSON.stringify({
  data: {
    repository: {
      pullRequests: {
        nodes: [
          { number: 71, reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] } },
          { number: 72, reviewThreads: { nodes: [] } },
        ],
      },
    },
  },
})

const COMMENTS = JSON.stringify({
  comments: [
    { author: { login: 'astrosteveo' }, body: 'First.', createdAt: '2026-10-05T00:00:00Z' },
    { author: { login: 'alice' }, body: 'Second.', createdAt: '2026-10-05T01:00:00Z' },
    { author: { login: 'bob' }, body: 'Third.', createdAt: '2026-10-05T02:00:00Z' },
    { author: null, body: 'Does the reply field post here?', createdAt: '2026-10-05T03:00:00Z' },
  ],
})

test("why a pull request can't merge: its merge state, its open review threads and who is asked to review", () => {
  const [dirty, behind, clean] = parsePrs(JSON.stringify([pr(71, 'DIRTY', [{ login: 'alice' }, { name: 'Core team', slug: 'core' }]), pr(72, 'BEHIND'), pr(73, 'CLEAN')]))
  expect([mergeNoteOf(dirty!), mergeNoteOf(behind!), mergeNoteOf(clean!)]).toEqual([{ text: '⚠ conflicts', color: 'error' }, { text: '↓ behind', color: 'warning' }, null])
  expect(dirty?.reviewers).toEqual(['@alice', 'Core team'])
  expect([...threadsOf(THREADS)]).toEqual([
    [71, 2],
    [72, 0],
  ])
  expect([...threadsOf('not json')]).toEqual([])
})

test('comments read back, and Ask Claude to answer quotes the last one with how to reply', () => {
  const comments = commentsOf(COMMENTS)
  expect(comments.map(one => one.author)).toEqual(['astrosteveo', 'alice', 'bob', 'ghost'])
  const prompt = answerPrompt({ number: 43, title: 'Edit issues', url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '' }, comments.at(-1)!)
  expect(prompt).toBe(
    'Answer the latest comment on #43: Edit issues. @ghost wrote:\n\n> Does the reply field post here?\n\n' +
      "Read the whole thread with `gh issue view 43 --comments` first. Then reply on the issue with the mcp__issue-board__issue_update tool's comment.",
  )
})

// A read of an issue's comments.
const readsComments = ({ argv }: Call) => argv[1] === 'issue' && argv[2] === 'view' && argv.includes('comments')

// GitHub with one issue and three pull requests, its review threads and the issue's comments.
const github = (on: On) => {
  const gh = fakeGitHub(on, {
    repo: 'astrosteveo/claude-plugins',
    issues: [{ number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit', updatedAt: '2026-10-05T00:00:00Z' }],
    prs: [pr(71, 'DIRTY', [{ login: 'alice' }]), pr(72, 'BEHIND'), pr(73, 'CLEAN')],
    routes: [call => (call.argv.some(arg => arg.includes('reviewThreads')) ? ok(THREADS) : readsComments(call) ? ok(COMMENTS) : undefined)],
  })
  session(on)
  return gh
}

test("a pull request row says when it has conflicts or is behind, its open review threads, and who's asked to review", async ($, on) => {
  mock.store(on)
  github(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^⚠ conflicts$/ })).toBeDefined()
  expect(await ui.find({ text: /^2 open threads$/ })).toBeDefined()
  expect(await ui.find({ text: /^asks @alice$/ })).toBeDefined()
  expect(await ui.find({ text: /^↓ behind$/ })).toBeDefined()
  // #73 is clean, with no threads and no one asked.
  expect((await ui.findAll({ type: 'Text' })).filter(text => /threads?$|^asks /.test(text.text)).length).toBe(2)
  await ui.unmount()
})

test('opening a card reads its latest comments; a reply posts and reads them again; Ask Claude to answer hands Claude the last', async ($, on) => {
  mock.store(on)
  const gh = github(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-43' })

  expect(await ui.find({ text: /^Comments · latest 3 of 4$/ })).toBeDefined()
  expect(await ui.find({ text: /^@alice$/ })).toBeDefined()
  expect(await ui.find({ text: /^@ghost$/ })).toBeDefined()
  // The oldest of the four isn't shown.
  expect((await ui.findAll({ type: 'Markdown' })).map(one => one.props.text)).not.toContain('First.')

  const reads = gh.ran.filter(readsComments).length
  await ui.input({ key: 'reply-43', text: 'Yes, it does.', kind: 'change' })
  await ui.input({ key: 'reply-43', text: 'Yes, it does.', kind: 'submit' })
  expect(gh.writes).toEqual([{ argv: ['gh', 'api', '-X', 'POST', 'repos/astrosteveo/claude-plugins/issues/43/comments', '--input', '-'], stdin: '{"body":"Yes, it does."}' }])
  expect(gh.ran.filter(readsComments).length).toBeGreaterThan(reads)

  await ui.press({ key: 'ask-43' })
  expect(sent.at(-1)).toMatch(/^Answer the latest comment on #43: Edit issues from the board\. @ghost wrote:\n\n> Does the reply field post here\?/)
  await ui.unmount()
})
