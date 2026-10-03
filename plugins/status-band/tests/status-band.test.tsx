import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { bar, modelLabel, parseGitStatus, resetLabel } from '../hooks/register'

const ROOT = '/home/me/Projects/claude-plugins'
const NOW = Date.parse('2026-10-03T12:00:00Z')

const STATUS = [
  '# branch.oid 3bdc584aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 a b README.md',
  '1 .M N... 100644 100644 100644 a b hooks/register.tsx',
  '1 MM N... 100644 100644 100644 a b types/index.d.ts',
  '? notes.txt',
  '',
].join('\n')

const band = (bodyColumns: number) =>
  ({
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

function setup(on: Parameters<TestBody>[1], percent = 42) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: ROOT }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 80 },
        { kind: 'seven_day', percentUsed: percent, resetsAt: '2026-10-05T15:00:00Z' },
      ],
    },
  }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: STATUS, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  return mock.clock(on, { now: NOW })
}

test('the band shows model, effort, project, git state and 7-day usage', async ($, on) => {
  const clock = setup(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  // Git refreshes in the background
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'status-band', surface, ...band(140) })
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /high/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'claude-plugins' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\?1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2d 3h/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.text).toBe('─'.repeat(140))
    await ui.unmount()
  }
})

test('a narrow band drops the bar and the reset time but keeps the percent', async ($, on) => {
  const clock = setup(on, 91)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'status-band', surface: 'terminal', ...band(60) })
  expect(await ui.find({ type: 'Text', text: '91%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2d 3h/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
  await ui.unmount()
})

test('model ids read as names', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 1M')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('opus')).toBe('Opus')
})

test('git porcelain v2 parses into counts', () => {
  expect(parseGitStatus(STATUS)).toEqual({
    branch: 'main',
    ahead: 2,
    behind: 1,
    staged: 2,
    modified: 2,
    untracked: 1,
    conflicts: 0,
  })
  expect(parseGitStatus('# branch.oid abcdef1234\n# branch.head (detached)\n').branch).toBe('abcdef1')
})

test('reset times and bars', () => {
  expect(resetLabel('2026-10-03T15:30:00Z', NOW)).toBe('3h')
  expect(resetLabel('2026-10-03T12:20:00Z', NOW)).toBe('20m')
  expect(resetLabel('2026-10-01T00:00:00Z', NOW)).toBe('')
  expect(bar(50, 10)).toEqual({ fill: '█████', track: '█████' })
  expect(bar(0, 10).fill).toBe('')
  expect(bar(100, 10).track).toBe('')
})
