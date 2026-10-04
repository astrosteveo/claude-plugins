import { expect, test } from 'claude-code/testing'

const PANE_PROPS = {
  title: 'Touched files',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

test('a turn that edits files gets a recap, and /touched lists them', async ($, on) => {
  on('tool.call', ($, e) =>
    e.tool === 'Bash' && e.command === 'false'
      ? { result: { stdout: '', stderr: '', interrupted: false }, isError: true, text: 'exit 1' }
      : { result: {} as never },
  )
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.render', ($, e) => {
    // Stands for the engine's own drawing beneath the plugin.
    const { Text } = $.ui.resolve(e)
    return <Text>engine line</Text>
  })

  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: '' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'y', new_string: 'z' } as never)
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 4200, isAborted: false, turnId: 't1', reason: 'answer' })

  const line = await $.ui.mount({
    plugin: 'turn-recap',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 4200 },
  })
  expect((await line.find({ type: 'Text', text: /Baked for 4s/ }))?.text).toBe(
    '✻ Baked for 4s · 5 tools · 1 failed · edited a.ts, b.ts',
  )
  await line.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'turn-recap',
      surface,
      component: 'Pane',
      requestId: 'touched',
      props: PANE_PROPS,
    })
    expect(await pane.find({ type: 'Text', text: /^2× a\.ts$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^1× b\.ts$/ })).toBeDefined()
    await pane.unmount()
  }
})

test('a turn with no tools keeps the engine line', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    // Stands for the engine's own drawing beneath the plugin.
    const { Text } = $.ui.resolve(e)
    return <Text>engine line</Text>
  })
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await $.turn.complete({ answer: 'hello', durationMs: 900, isAborted: false, turnId: 't2', reason: 'answer' })

  const line = await $.ui.mount({
    plugin: 'turn-recap',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 900 },
  })
  expect(await line.find({ type: 'Text', text: /tools/ })).toBeUndefined()
  expect(await line.find({ type: 'Text', text: 'engine line' })).toBeDefined()
  await line.unmount()
})
