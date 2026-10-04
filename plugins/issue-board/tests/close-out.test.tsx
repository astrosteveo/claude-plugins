import { expect, test } from 'claude-code/testing'

import { closeOutAllPrompt, closeOutPrompt, parsePrs } from '../hooks/parse'

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

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

test('the close-out prompts name each pull request and ask for a guarded merge', () => {
  const parsed = parsePrs(JSON.stringify(PRS))
  const draft = parsed.find(one => one.isDraft)!
  const ready = parsed.find(one => !one.isDraft)!
  expect(closeOutPrompt(ready)).toMatch(/^Close out PR #335: Glide in to a planet \(branch `fix\/planet-glide`\)\./)
  expect(closeOutPrompt(ready)).toMatch(/don't bypass branch protection or force-push/)
  expect(closeOutPrompt(ready)).not.toMatch(/draft/)
  expect(closeOutPrompt(draft)).toMatch(/It is a draft: finish it and mark it ready first\./)

  const all = closeOutAllPrompt(parsed)
  expect(all).toMatch(/^Close out all 2 open pull requests and merge them:\n- #335: .*\n- #337: .*, draft\)\n/)
  expect(all).toMatch(/oldest first/)
  expect(closeOutAllPrompt([ready])).toMatch(/^Close out all 1 open pull request and/)
})

test('Close out sends one pull request, and Close out all asks before sending them all', async ($, on) => {
  on('process.run', async (_$, e) => {
    const kind = e.argv[1]
    const stdout = kind === 'repo' ? 'astrosteveo/void-sector\n' : e.argv.includes('open') ? JSON.stringify(kind === 'pr' ? PRS : []) : '[]'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)

  for (const surface of ['terminal', 'desktop'] as const) {
    sent.length = 0
    const ui = await $.ui.mount({ plugin: 'issue-board', surface, ...PANE })
    expect(await ui.find({ key: 'close-out-335' })).toBeDefined()
    expect(await ui.find({ key: 'close-out-337' })).toBeDefined()

    await ui.press({ key: 'close-out-335' })
    expect(sent).toEqual([expect.stringMatching(/^Close out PR #335: /)])

    // The first press only asks; Cancel puts the button back without sending anything.
    expect((await ui.find({ key: 'close-out-all' }))?.text).toBe('⇶ Close out all 2')
    await ui.press({ key: 'close-out-all' })
    expect(sent).toHaveLength(1)
    expect(await ui.find({ text: /^Close out and merge all 2 open PRs\?$/ })).toBeDefined()
    expect(await ui.find({ text: /^y merge every open PR/ })).toBeDefined()
    await ui.press({ key: 'close-out-all-no' })
    expect(await ui.find({ key: 'close-out-all-yes' })).toBeUndefined()
    expect(sent).toHaveLength(1)

    await ui.press({ key: 'close-out-all' })
    await ui.press({ key: 'close-out-all-yes' })
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatch(/^Close out all 2 open pull requests and merge them:\n- #335: Glide in to a planet/)
    expect(await ui.find({ key: 'close-out-all' })).toBeDefined()
    await ui.unmount()
  }
})
