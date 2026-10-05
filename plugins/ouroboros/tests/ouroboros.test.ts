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

test('a new install adopts the genome of the copy it replaces and merges friction', async ($, on) => {
  const old = {
    genome: [{ id: 'old-gene', title: 'An inherited gene', why: 'It evolved before', acceptedAt: 1 }],
    friction: [{ at: 10, turn: 1, kind: 'error', tool: 'Bash', detail: 'from the old copy' }],
  }
  mock.store(on, { auto: false, friction: [{ at: 20, turn: 2, kind: 'correction', detail: 'from this copy' }] })
  mock.clock(on)
  mock.env(on, { HOME: '/home/someone' })
  on('command.register', () => ({ value: { command: 'ouroboros' } }))
  on('agent.register', () => ({ value: { agent: 'ouroboros:geneticist' } }))
  on('fs.list', () => ({
    value: [{ name: 'ouroboros_inline-abc.json', kind: 'file', size: 1, mtimeMs: 1, isLink: false }],
  }))
  on('fs.read', () => ({ value: JSON.stringify(old) }))
  on('fs.exists', () => ({ value: false }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /An inherited gene/ })).toBeDefined()
  expect(await ui.find({ text: /2 friction/ })).toBeDefined()
  await ui.unmount()
})
