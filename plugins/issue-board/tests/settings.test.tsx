import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { SETTING_TITLES, featuresOff, settingsOf, switchesOf, withOldKeys } from '../hooks/settings'
import { fakeGitHub } from './github'
import { RUN } from './ui'

const AUTO_MOVE_OFF = 'turned off in /config by Move issues on their own (autoMove)'
const RULE_OFF = 'turned off in /config by Closes only when every box is ticked (closesWhenTicked)'

// scripts/settings-titles.test.mjs holds the keys and titles to plugin.json, which a plugin test can't read.
test('every setting but where Start works and the projects the board may write to is a switch', () => {
  expect(Object.keys(switchesOf(settingsOf(undefined))).sort()).toEqual(Object.keys(SETTING_TITLES).filter(key => key !== 'startMode' && key !== 'writeProjects').sort())
})

test('the defaults: moves off, the PR rule and following the branch on, the next step off, a read every 5 minutes', () => {
  const settings = settingsOf(undefined)
  expect(settings).toMatchObject({ autoMove: false, closesWhenTicked: true, followBranch: true, suggestNextStep: false, startMode: 'main', refresh: 5, writeProjects: [] })
  const off = featuresOff(switchesOf(settings), null).map(one => one.why)
  // autoMove turns three features off, said once.
  expect(off.filter(why => why === AUTO_MOVE_OFF).length).toBe(1)
  expect(switchesOf(settingsOf({ refresh: 'manual' })).refresh).toBe(false)
})

test("an older board's keys count for one release where the new key isn't set", () => {
  const settings = settingsOf(undefined)
  // Any of the three moves turns autoMove on; a set autoMove wins.
  expect(withOldKeys(settings, { moveToDone: true }).autoMove).toBe(true)
  expect(withOldKeys(settings, { advanceEpics: true }).autoMove).toBe(true)
  expect(withOldKeys(settings, { moveToVerification: false }).autoMove).toBe(false)
  expect(withOldKeys(settings, { autoMove: false, moveToDone: true }).autoMove).toBe(false)
  // prRule: only closes-when-ticked keeps the rule on; a set closesWhenTicked wins.
  expect(withOldKeys(settings, { prRule: 'closes-when-ticked' }).closesWhenTicked).toBe(true)
  expect(withOldKeys(settings, { prRule: 'always-closes' }).closesWhenTicked).toBe(false)
  expect(withOldKeys(settings, { prRule: 'none' }).closesWhenTicked).toBe(false)
  expect(withOldKeys(settings, { prRule: 'none', closesWhenTicked: true }).closesWhenTicked).toBe(true)
  expect(withOldKeys(settings, {})).toEqual(settings)
})

// GitHub with no issues, and settings files that hold `stored` as the board's options in this repo's settings.
const world = (on: On, stored: Record<string, unknown>) => {
  const prompts: string[] = []
  fakeGitHub(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  on('settings.read', async (_$, e) => ({ value: e.source === 'project' ? { pluginConfigs: { 'issue-board@astrosteveo-plugins': { options: stored } } } : {} }))
  on('agent.register', async (_$, e) => {
    prompts.push(e.prompt)
    return { value: { agent: `issue-board:${e.name}` } }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  return prompts
}

test("the old keys in a settings file turn autoMove on and set the background agent's PR rule", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const prompts = world(on, { moveToVerification: true, prRule: 'none' })
  await $.session.start({ cwd: '/work/void-sector', surface: 'terminal', isInteractive: true })
  expect(prompts.at(-1)).not.toMatch(/Closes|Refs/)
  const help = String((await $.command.run({ ...RUN, args: 'help' })).text)
  expect(help).not.toContain(AUTO_MOVE_OFF)
  expect(help).toContain(RULE_OFF)
  await clock.settle()
})

test('without old keys, the defaults stand', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const prompts = world(on, { writeProjects: 'astrosteveo/9' })
  await $.session.start({ cwd: '/work/void-sector', surface: 'terminal', isInteractive: true })
  expect(prompts.at(-1)).toMatch(/Write `Closes #<number>` in its body only if every acceptance box is ticked by then/)
  const help = String((await $.command.run({ ...RUN, args: 'help' })).text)
  expect(help).toContain(AUTO_MOVE_OFF)
  expect(help).not.toContain(RULE_OFF)
  await clock.settle()
})
