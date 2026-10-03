import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { bars, compact, weatherFor } from '../hooks/register'

type $ = Parameters<TestBody>[0]

const WINDOW = 200_000

const band = (bodyColumns: number, hasSurvey = false) =>
  ({
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

function setup(on: Parameters<TestBody>[1], seed?: number) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: seed === undefined ? { window: WINDOW } : { window: WINDOW, tokens: seed }, rateLimits: [] },
  }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  // Stands for whatever draws beneath the band, so a pass shows through
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
}

const start = ($: $) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
const measure = ($: $, tokens: number, changed: ('context' | 'rateLimits')[] = ['context']) =>
  $.session.measure({ context: { window: WINDOW, tokens }, rateLimits: [], changed })
const mount = ($: $, width = 120, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'token-weather', surface, ...band(width) })
const blocks = /^[▁▂▃▄▅▆▇█]$/

test('the band shows the current fill as soon as it loads', async ($, on) => {
  setup(on, 36_100)
  await start($)

  const ui = await mount($)
  expect((await ui.find({ type: 'Text', text: '☀ Clear' }))?.props['color']).toBe('yellow')
  expect(await ui.find({ type: 'Text', text: '18%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '36.1k / 200k' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: blocks })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeUndefined()
  await ui.unmount()
})

test('a turn adds a bar and says what it added', async ($, on) => {
  setup(on, 36_100)
  await start($)
  await measure($, 134_400)

  const ui = await mount($)
  expect((await ui.find({ type: 'Text', text: '☂ Showers' }))?.props['color']).toBe('blue')
  expect(await ui.find({ type: 'Text', text: '67%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '134.4k / 200k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▲ +' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '98.3k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' last turn' })).toBeDefined()
  const chart = await ui.findAll({ type: 'Text', text: blocks })
  expect(chart.map(bar => bar.text).join('')).toBe('▂▆')
  expect(chart.map(bar => bar.props['color'])).toEqual(['yellow', 'blue'])
  await ui.unmount()
})

test('the chart keeps the last 12 turns', async ($, on) => {
  setup(on)
  await start($)
  for (let i = 1; i <= 15; i++) await measure($, i * 10_000)

  const ui = await mount($)
  expect(await ui.findAll({ type: 'Text', text: blocks })).toHaveLength(12)
  expect(await ui.find({ type: 'Text', text: '150k / 200k' })).toBeDefined()
  await ui.unmount()
})

test('a measurement with no context change adds no bar', async ($, on) => {
  setup(on, 50_000)
  await start($)
  await measure($, 50_000, ['rateLimits'])

  const ui = await mount($)
  expect(await ui.findAll({ type: 'Text', text: blocks })).toHaveLength(1)
  await ui.unmount()
})

test('a measurement of the fill the mod loaded with adds no bar', async ($, on) => {
  setup(on, 36_100)
  await start($)
  await measure($, 36_100)

  const ui = await mount($)
  expect(await ui.findAll({ type: 'Text', text: blocks })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^▲ \+$/ })).toBeUndefined()
  await ui.unmount()
})

test('a compaction shows as a drop', async ($, on) => {
  setup(on, 180_000)
  await start($)
  await measure($, 40_000)

  const ui = await mount($)
  expect((await ui.find({ type: 'Text', text: /^▼ -$/ }))?.props['color']).toBe('green')
  expect(await ui.find({ type: 'Text', text: '140k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '☀ Clear' })).toBeDefined()
  await ui.unmount()
})

test('/clear empties the band until the next turn', async ($, on) => {
  setup(on, 120_000)
  await start($)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /%$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
  await ui.unmount()
})

test('a narrower band drops the words, then the change, then the chart', async ($, on) => {
  setup(on, 36_100)
  await start($)
  await measure($, 134_400)

  const at65 = await mount($, 65)
  expect(await at65.find({ type: 'Text', text: ' last turn' })).toBeUndefined()
  expect(await at65.find({ type: 'Text', text: '98.3k' })).toBeDefined()
  await at65.unmount()

  const at55 = await mount($, 55)
  expect(await at55.find({ type: 'Text', text: '98.3k' })).toBeUndefined()
  expect(await at55.findAll({ type: 'Text', text: blocks })).toHaveLength(2)
  await at55.unmount()

  const at45 = await mount($, 45)
  expect(await at45.findAll({ type: 'Text', text: blocks })).toHaveLength(0)
  expect(await at45.find({ type: 'Text', text: '134.4k / 200k' })).toBeDefined()
  await at45.unmount()
})

test('a survey takes the band, and the desktop draws it too', async ($, on) => {
  setup(on, 36_100)
  await start($)

  const survey = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...band(120, true) })
  expect(await survey.find({ type: 'Text', text: 'beneath' })).toBeDefined()
  await survey.unmount()

  const desktop = await mount($, 120, 'desktop')
  expect(await desktop.find({ type: 'Text', text: '☀ Clear' })).toBeDefined()
  await desktop.unmount()
})

test('weather, counts and bars', () => {
  const forecast = (percent: number) => `${weatherFor(percent).icon} ${weatherFor(percent).word} ${weatherFor(percent).color}`
  expect(forecast(0)).toBe('☀ Clear yellow')
  expect(forecast(24)).toBe('☀ Clear yellow')
  expect(forecast(25)).toBe('☁ Cloudy cyan')
  expect(forecast(49)).toBe('☁ Cloudy cyan')
  expect(forecast(50)).toBe('☂ Showers blue')
  expect(forecast(74)).toBe('☂ Showers blue')
  expect(forecast(75)).toBe('☇ Storm magenta')
  expect(forecast(89)).toBe('☇ Storm magenta')
  expect(forecast(90)).toBe('↯ Compact soon red')
  expect(forecast(100)).toBe('↯ Compact soon red')

  expect(compact(999)).toBe('999')
  expect(compact(98_300)).toBe('98.3k')
  expect(compact(134_400)).toBe('134.4k')
  expect(compact(200_000)).toBe('200k')
  expect(compact(999_960)).toBe('1M')
  expect(compact(1_250_000)).toBe('1.3M')

  expect(bars([0, 100_000, 200_000], 200_000)).toEqual(['▁', '▄', '█'])
})
