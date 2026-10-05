import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'ouroboros',
  component: 'Pane',
  requestId: 'genome',
  props: {
    title: 'Genome',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('a denied tool call becomes friction in the Genome pane', async ($, on) => {
  mock.store(on, { auto: false })
  mock.clock(on)
  on('tool.call', () => ({ deny: 'The user said no.' }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran.deny).toBe('The user said no.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ text: /1 friction/ }))?.text).toContain('GENOME')
    expect(await ui.find({ text: /rm -rf build/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a correction is friction, a plain prompt is not', async ($, on) => {
  mock.store(on, { auto: false })
  mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'add a README', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: "no, I said run the tests first", origin: { kind: 'composer' }, wait: false })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /1 friction/ })).toBeDefined()
  expect(await ui.find({ text: /run the tests first/ })).toBeDefined()
  await ui.unmount()
})
