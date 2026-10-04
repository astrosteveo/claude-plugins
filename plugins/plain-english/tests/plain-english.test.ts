import { expect, mock, test } from 'claude-code/testing'

const ENGINE_SECTIONS = [
  { id: 'intro', text: 'You are Claude Code.', scope: 'shared' },
  { id: 'env_info_simple', text: 'cwd: /repo', scope: 'session' },
] as const

const REQUEST = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const

const COMMAND = {
  command: 'plain-english',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

test('the style goes last in the system prompt, and /plain-english turns it off and on', async ($, on) => {
  mock.store(on)
  on('prompt.compose', () => ({ sections: ENGINE_SECTIONS }))

  const ids = async () => (await $.prompt.compose(REQUEST)).sections.map(section => section.id)
  const run = async (args: string) => (await $.command.run({ ...COMMAND, args })).text

  expect(await ids()).toEqual(['intro', 'env_info_simple', 'plain-english:style'])
  const style = (await $.prompt.compose(REQUEST)).sections.at(-1)
  expect(style?.scope).toBe('session')
  expect(style?.text).toMatch(/Start with the result/)
  expect(style?.text).toMatch(/Habits to drop/)
  expect(await run('')).toBe('Plain English is on. The end-of-reply check is on.')

  await run('off')
  expect(await ids()).toEqual(['intro', 'env_info_simple'])
  expect(await run('')).toBe('Plain English is off. The end-of-reply check is on.')

  await run('ON')
  expect(await ids()).toEqual(['intro', 'env_info_simple', 'plain-english:style'])
  expect(await run('maybe')).toMatch(/^Use \/plain-english on/)
})

// A test's own $.tool.call sees a refusal as { deny }.
const denied = (result: unknown) => (result as { deny?: string }).deny

const CLAUDISH_COMMIT = `git commit -m "$(cat <<'EOF'
Add the gate

The gate is genuinely useful — it blocks Claudish.
EOF
)"`

test('a commit message with Claudish is refused, and a clean one runs', async ($, on) => {
  mock.store(on)
  const ran: string[] = []
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })

  const refused = await $.tool.call({ tool: 'Bash', command: CLAUDISH_COMMIT } as never)
  expect(denied(refused)).toMatch(/em dash/)
  expect(denied(refused)).toMatch(/stock word: genuinely/)
  expect(ran).toEqual([])

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the gate"' } as never)
  await $.tool.call({ tool: 'Bash', command: 'echo genuinely — not a commit' } as never)
  expect(ran).toHaveLength(2)

  await $.command.run({ ...COMMAND, args: 'off' })
  await $.tool.call({ tool: 'Bash', command: CLAUDISH_COMMIT } as never)
  expect(ran).toHaveLength(3)
})

test('Markdown files are checked, other files are not', async ($, on) => {
  mock.store(on)
  on('tool.call', () => ({ result: {} }) as never)

  const doc = await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: 'The catch: it is slow.' } as never)
  expect(denied(doc)).toMatch(/reveal label/)

  const code = await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: '// The catch: it is slow.' } as never)
  expect(denied(code)).toBeUndefined()

  const edit = await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/docs/guide.md',
    old_string: 'x',
    new_string: 'Here is what happened:',
  } as never)
  expect(denied(edit)).toMatch(/announcing sentence/)
})

test('a reply with Claudish gets one rewrite, and the switch turns it off', async ($, on) => {
  mock.store(on)
  on('classic.Stop', () => ({}))

  const slipped = { last_assistant_message: 'Great question! Use SQLite.', stop_hook_active: false } as never
  expect((await $.classic.Stop(slipped)).block).toMatch(/filler: Great question/)

  const clean = { last_assistant_message: 'Use SQLite.', stop_hook_active: false } as never
  expect((await $.classic.Stop(clean)).block).toBeUndefined()

  const rewritten = { last_assistant_message: 'Great question! Use SQLite.', stop_hook_active: true } as never
  expect((await $.classic.Stop(rewritten)).block).toBeUndefined()

  expect(await (await $.command.run({ ...COMMAND, args: 'rewrite off' })).text).toBe('The end-of-reply check is now off.')
  expect((await $.classic.Stop(slipped)).block).toBeUndefined()
})
