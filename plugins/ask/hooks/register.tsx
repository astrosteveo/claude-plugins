import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type { Ask } from '../types'
import type { Exchange } from './parse'
import { SUGGEST, earlier, fit, framed, pendingLine, split } from './parse'

const PANE = 'ask'
const KEEP = 30
const asks = atom({ plugin: 'ask', key: 'asks' } as const, [])
const draft = atom({ plugin: 'ask', key: 'draft' } as const, '')

function why(reply: ModelForkResult): string {
  if (reply.isAnswered) return ''
  switch (reply.reason) {
    case 'api-error':
      return `The API answered ${reply.status} (${reply.error}).`
    case 'empty-reply':
      return 'Claude sent back no text.'
    case 'aborted':
      return 'Stopped before it finished.'
    default:
      return 'No answer.'
  }
}

// Forks the session so the answer reads the whole conversation from the
// prompt cache; the pane's own earlier asks ride after it, in the question.
// Before the first reply there is nothing to fork, so the question goes to a
// plain completion instead.
async function answer($: EngineInterface, question: string, before: readonly Exchange[]): Promise<Partial<Ask>> {
  const prompt = framed(question, before)
  let reply: ModelForkResult = await $.model.fork({ prompt })
  if (!reply.isAnswered && reply.reason === 'nothing-to-fork') {
    reply = await $.model.complete({ model: 'sonnet', prompt })
  }
  if (!reply.isAnswered) return { status: 'failed', error: why(reply) }

  return { status: 'answered', ...split(reply.text) }
}

async function showPending($: EngineInterface) {
  const list = await read($, asks)
  $.ui.status(pendingLine(list.filter(one => one.status === 'pending').length))
}

// Keeps the question box in view as the list above it grows. A move that
// does not land (a closed pane, a host that cannot scroll) never stops an ask.
async function toEnd($: EngineInterface) {
  let why: string | undefined
  try {
    why = (await $.ui.scroll({ in: PANE, to: 'end', block: 'end' })).deny
  } catch (error) {
    why = error instanceof Error ? error.message : String(error)
  }
  if (why !== undefined) $.ui.log(`ask: scroll to end: ${why}`, { to: 'debug' })
}

// Oldest first, so the newest ask sits just above the question box.
async function run($: EngineInterface, ask: Ask) {
  await update($, asks, list => [...list.filter(one => one.id !== ask.id), ask].slice(-KEEP))
  await showPending($)
  await toEnd($)

  let change: Partial<Ask>
  try {
    change = await answer($, ask.question, earlier(await read($, asks), ask.id))
  } catch (error) {
    change = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }

  // Removed while it ran: drop the answer.
  if (!(await read($, asks)).some(one => one.id === ask.id)) {
    await showPending($)
    return
  }
  await update($, asks, list => list.map(one => (one.id === ask.id ? { ...one, ...change } : one)))
  await showPending($)
  await toEnd($)
  $.ui.toast(
    change.status === 'answered'
      ? `Answer ready: ${fit(ask.question, 48)}`
      : `Ask failed: ${change.error ?? 'no answer'}`,
  )
}

async function start($: EngineInterface, question: string) {
  const ask: Ask = {
    id: crypto.randomUUID(),
    question,
    status: 'pending',
    prompts: [],
    askedAt: await $.clock.now(),
  }
  await run($, ask)
}

async function use($: EngineInterface, prompt: string) {
  const filled = await $.prompt.fill({ text: prompt })
  $.ui.toast(filled.isFilled ? 'The prompt is in the box. Esc to get back to it.' : 'The prompt box could not take it right now.')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ask',
      description: 'Ask Claude on the side; the answer shows in a pane, not the chat',
      argumentHint: '[question]',
    })
    // A reload drops the old module's calls, so their answers never arrive.
    await update($, asks, list =>
      list.map(one => (one.status === 'pending' ? { ...one, status: 'failed', error: 'Stopped when the mod reloaded.' } : one)),
    )
    $.ui.status(undefined)

    return next(e)
  })

  on('command.run', { command: 'ask' }, async ($, e) => {
    const question = e.args.trim()
    if (question === '') {
      await $.ui.open({ id: PANE, title: 'Ask', focus: true })
      return {}
    }
    await $.ui.open({ id: PANE, title: 'Ask' })
    void start($, question)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = ui
    const list = await read($, asks)
    const typed = await read($, draft)
    const width = Math.max(20, e.props.bodyColumns)

    // A chat: the asks fill the room above the question box, oldest first, so
    // the box and its buttons sit at the bottom of the pane.
    return (
      <Box flexDirection="column" minHeight={e.props.scroll.bodyRows}>
        <Text dimColor>Side questions. Answers stay here, out of the chat.</Text>
        <Box key="asks" flexDirection="column" flexGrow={1} justifyContent="flex-end">
          {list.length === 0 && <Text dimColor>Nothing asked yet.</Text>}
          {list.map(one => (
            <Box key={`ask-${one.id}`} flexDirection="column" marginTop={1}>
              <Text dimColor>{'─'.repeat(width)}</Text>
              <Text bold>› {one.question}</Text>
              {one.status === 'pending' && <Text dimColor>thinking…</Text>}
              {one.status === 'failed' && <Text color="error">{one.error ?? 'No answer.'}</Text>}
              {one.status === 'answered' && <Markdown key={`answer-${one.id}`} text={one.answer || '(empty)'} />}
              <Box key={`actions-${one.id}`} gap={1} flexWrap="wrap">
                {one.prompts.map((prompt, i) => (
                  <Button
                    key={`use-${one.id}-${i}`}
                    label={one.prompts.length === 1 ? 'Use prompt' : `Use ${i + 1}`}
                    variant="primary"
                    onPress={() => void use($, prompt)}
                  />
                ))}
                {one.status === 'answered' && (
                  <Button
                    key={`copy-${one.id}`}
                    label="Copy"
                    onPress={press => void $.ui.copy({ text: one.answer ?? '', surface: press.surface })}
                  />
                )}
                {one.status === 'failed' && (
                  <Button
                    key={`retry-${one.id}`}
                    label="Retry"
                    onPress={() => void run($, { ...one, status: 'pending', answer: undefined, prompts: [], error: undefined })}
                  />
                )}
                <Button
                  key={`remove-${one.id}`}
                  label="Remove"
                  onPress={async () => {
                    await update($, asks, all => all.filter(other => other.id !== one.id))
                    await showPending($)
                  }}
                />
              </Box>
            </Box>
          ))}
        </Box>
        <Text dimColor>{'─'.repeat(width)}</Text>
        {'Input' in ui && (
          <ui.Input
            key="question"
            placeholder="Ask Claude something…"
            submitLabel="ask"
            value={typed}
            autoFocus
            onInput={value => void update($, draft, () => value)}
            onSubmit={value => {
              void update($, draft, () => '')
              if (value.trim() !== '') void start($, value.trim())
            }}
          />
        )}
        <Box key="controls" gap={1} flexWrap="wrap">
          <Button key="suggest" label="Suggest next prompts" onPress={() => void start($, SUGGEST)} />
          {list.some(one => one.status !== 'pending') && (
            <Button
              key="clear"
              label="Clear answered"
              onPress={() => void update($, asks, all => all.filter(one => one.status === 'pending'))}
            />
          )}
        </Box>
      </Box>
    )
  })
}
