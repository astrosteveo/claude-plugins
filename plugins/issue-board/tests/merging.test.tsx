import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { parsePrs } from '../hooks/github'
import { FILES_PAGE, fileFlags, flaggedLines, flagsText } from '../hooks/merging'
import type { ChangedFile } from '../hooks/merging'
import { closeOutAllPrompt, closeOutPrompt } from '../hooks/prompts'
import { fakeGitHub, line, pr335 } from './github'
import { REFRESH, band, engineBand, pane } from './ui'

// Before Finish & merge or Merge all hands a pull request to Claude, the board reads its changed files and asks first
// when they change CI, settings or lockfiles, delete files, look like secrets, or change a plugin without its version
// bumped (#347).

const changed = (path: string, status = 'modified', patch?: string | null): ChangedFile => ({ path, status, ...(patch === undefined ? {} : { patch }) })

// The diffs a version bump makes in this repo's layout: the plugin's own plugin.json, and its entry in marketplace.json.
const pluginBump = '@@ -1,6 +1,6 @@\n {\n   "name": "issue-board",\n-  "version": "0.71.8",\n+  "version": "0.72.0",\n   "description": "…",'
const marketplaceBump = (plugin: string) =>
  `@@ -11,7 +11,7 @@\n       "source": "./plugins/${plugin}",\n       "description": "…",\n-      "version": "0.71.8",\n+      "version": "0.72.0",\n       "author": {`

test('the files that ask first: CI workflows, settings, lockfiles, deletions and secrets; a clean change flags nothing', () => {
  expect(fileFlags([changed('src/game.ts'), changed('README.md', 'added'), changed('.env.example', 'added')], { marketplace: false })).toEqual([])
  expect(
    fileFlags(
      [
        changed('.github/workflows/validate.yml'),
        changed('.claude/settings.json'),
        changed('.claude/settings.local.json', 'added'),
        changed('package-lock.json'),
        changed('web/yarn.lock'),
        changed('src/old.ts', 'removed'),
        changed('.env', 'added'),
        changed('certs/server.pem', 'added'),
        changed('deploy/id_ed25519', 'added'),
      ],
      { marketplace: false },
    ),
  ).toEqual([
    'changes CI workflows: .github/workflows/validate.yml',
    'changes Claude Code settings: .claude/settings.json, .claude/settings.local.json',
    'changes lockfiles: package-lock.json, web/yarn.lock',
    'deletes: src/old.ts',
    'adds or changes what may be secrets: .env, certs/server.pem, deploy/id_ed25519',
  ])
  // A deleted secret is a deletion, not a new secret; a long list is cut to three and a count.
  expect(fileFlags([changed('.env', 'removed')], { marketplace: false })).toEqual(['deletes: .env'])
  expect(fileFlags(['a', 'b', 'c', 'd', 'e'].map(name => changed(`${name}.ts`, 'removed')), { marketplace: false })).toEqual(['deletes: a.ts, b.ts, c.ts and 2 more'])
  // A full page of files may hide more, so it says only the first page was checked.
  const page = Array.from({ length: FILES_PAGE }, (_, at) => changed(`src/${at}.ts`))
  expect(fileFlags(page, { marketplace: false })).toEqual([`changes ${FILES_PAGE} or more files, and only the first ${FILES_PAGE} were checked`])
})

test('in a plugin marketplace, a plugin changed without a version bump in both plugin.json and marketplace.json is flagged', () => {
  const code = changed('plugins/issue-board/hooks/register.tsx')
  const plugin = changed('plugins/issue-board/.claude-plugin/plugin.json', 'modified', pluginBump)
  const market = changed('.claude-plugin/marketplace.json', 'modified', marketplaceBump('issue-board'))
  expect(fileFlags([code, plugin, market], { marketplace: true })).toEqual([])
  expect(fileFlags([code], { marketplace: true })).toEqual(['changes issue-board without a version bump in plugin.json and marketplace.json'])
  expect(fileFlags([code, plugin], { marketplace: true })).toEqual(['changes issue-board without a version bump in marketplace.json'])
  expect(fileFlags([code, market], { marketplace: true })).toEqual(['changes issue-board without a version bump in plugin.json'])
  // Another plugin's entry bumped doesn't count for this one.
  expect(fileFlags([code, plugin, changed('.claude-plugin/marketplace.json', 'modified', marketplaceBump('ask'))], { marketplace: true })).toEqual([
    'changes issue-board without a version bump in marketplace.json',
  ])
  // plugin.json changed but its version not: its description, say.
  expect(fileFlags([code, changed('plugins/issue-board/.claude-plugin/plugin.json', 'modified', '@@ -2 +2 @@\n-  "description": "a"\n+  "description": "b"'), market], { marketplace: true })).toEqual([
    'changes issue-board without a version bump in plugin.json',
  ])
  // A diff GitHub left out can't be read, so it counts as bumped.
  expect(fileFlags([code, changed('plugins/issue-board/.claude-plugin/plugin.json', 'modified', null), changed('.claude-plugin/marketplace.json', 'modified', null)], { marketplace: true })).toEqual([])
  // Outside a marketplace laid out this way, plugins/ is just a folder.
  expect(fileFlags([code], { marketplace: false })).toEqual([])
})

test("Merge all's ask lists each flagged pull request, oldest first; the prompts carry what was flagged and wait for every check", () => {
  expect(flaggedLines([{ number: 402, found: ['deletes: a.ts'] }, { number: 401, found: [] }, { number: 400, found: ['changes lockfiles: go.sum', 'deletes: b.ts'] }])).toEqual([
    '#400 changes lockfiles: go.sum; deletes: b.ts',
    '#402 deletes: a.ts',
  ])
  expect(flagsText(['deletes: a.ts', 'changes lockfiles: go.sum'])).toBe('It deletes: a.ts; it changes lockfiles: go.sum.')
  expect(flagsText([])).toBe('')

  const [pr] = parsePrs(JSON.stringify([pr335('pass')]))
  expect(closeOutPrompt(pr!)).toMatch(/Merge only once every check has passed, not just the required ones/)
  expect(closeOutPrompt(pr!)).not.toMatch(/flagged/)
  expect(closeOutPrompt(pr!, ['deletes: a.ts'])).toMatch(/The board flagged its files, and the person chose to merge it anyway: it deletes: a\.ts\./)
  const all = closeOutAllPrompt([pr!], [{ number: 335, found: ['deletes: a.ts'] }])
  expect(all).toMatch(/^- #335: .*; flagged: it deletes: a\.ts$/m)
  expect(all).toMatch(/merge it once every one of its checks has passed/)
  expect(all).toMatch(/not just the required ones/)
})

// Two pull requests whose CI passed: #335 deletes a file and changes the workflows, #336 is clean.
const pr336 = { ...pr335('pass'), number: 336, title: 'Tune the docking lane', url: 'https://github.com/astrosteveo/void-sector/pull/336', headRefName: 'fix/dock-lane', body: 'Refs #316.' }
const FILES = { 335: [changed('src/old.ts', 'removed'), changed('.github/workflows/ci.yml')], 336: [changed('src/dock.ts')] }

const world = (on: On) => {
  const gh = fakeGitHub(on, { prs: [pr335('pass'), pr336], files: FILES })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const filesRead = () => gh.ran.filter(call => /\/pulls\/\d+\/files/.test(line(call))).map(call => Number(/\/pulls\/(\d+)\//.exec(line(call))?.[1]))
  return { gh, sent, filesRead }
}

test('Finish & merge reads the files first: a flagged pull request asks and lists what it found, a clean one goes at once', async ($, on) => {
  const { sent, filesRead } = world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(120, 60) })

  await ui.press({ key: 'close-out-336' })
  expect(filesRead()).toEqual([336])
  expect(sent).toEqual([expect.stringMatching(/^Close out PR #336: /)])

  await ui.press({ key: 'close-out-335' })
  expect(filesRead()).toEqual([336, 335])
  expect(sent).toHaveLength(1)
  expect(await ui.find({ text: 'Close out PR #335 anyway? It changes CI workflows: .github/workflows/ci.yml; it deletes: src/old.ts.' })).toBeDefined()
  await ui.press({ key: 'close-out-yes-335' })
  expect(sent).toHaveLength(2)
  expect(sent[1]).toMatch(/^Close out PR #335: .*the person chose to merge it anyway: it changes CI workflows: \.github\/workflows\/ci\.yml; it deletes: src\/old\.ts\./)
  expect(await ui.find({ key: 'close-out-ask-335' })).toBeUndefined()
  await ui.unmount()
})

test('Merge all reads each pull request\'s files once and asks once, naming each flagged pull request', async ($, on) => {
  const { sent, filesRead } = world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(120, 60) })

  await ui.press({ key: 'close-out-all' })
  expect(filesRead().sort()).toEqual([335, 336])
  expect(sent).toEqual([])
  expect(await ui.find({ text: /^Finish and merge all 2 open PRs\? 1 needs a look:$/ })).toBeDefined()
  expect(await ui.find({ text: '  #335 changes CI workflows: .github/workflows/ci.yml; deletes: src/old.ts' })).toBeDefined()
  expect(await ui.find({ key: 'close-out-all-flag-#336' })).toBeUndefined()
  expect((await ui.find({ key: 'close-out-all-yes' }))?.text).toBe('Yes, merge them anyway')

  await ui.press({ key: 'close-out-all-yes' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/^Merge all 2 open pull requests:\n- #335: .*; flagged: it changes CI workflows/)
  expect(sent[0]).toMatch(/^- #336: Tune the docking lane \(`fix\/dock-lane`, CI pass\)$/m)
  await ui.unmount()
})

test("the band's Finish & merge checks the files too, and a flagged pull request opens the pane on its ask", async ($, on) => {
  const { gh, sent, filesRead } = world(on)
  engineBand(on)
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  gh.prs = [pr335('pending')]
  await $.command.run(REFRESH)
  const strip = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...band(120) })
  gh.prs = [pr335('pass')]
  await $.command.run(REFRESH)

  await strip.press({ key: 'merge-335' })
  expect(filesRead()).toEqual([335])
  expect(sent).toEqual([])
  expect(opened).toEqual(['issue-board'])
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(120, 20) })
  expect(await ui.find({ key: 'close-out-ask-335' })).toBeDefined()
  await ui.unmount()

  // With nothing flagged, it goes straight to Claude.
  gh.files = {}
  await strip.press({ key: 'merge-335' })
  expect(sent).toEqual([expect.stringMatching(/^Close out PR #335: /)])
  await strip.unmount()
})
