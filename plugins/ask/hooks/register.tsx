import { atom, memberOf, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, ModelForkResult, Register, RenderSurface } from 'claude-code'

import type { Advice, Ask, Decision, Offer, Question, Take } from '../types'
import type { Exchange } from './parse'
import { SUGGEST, earlier, fit, framed, pendingLine, split } from './parse'
import {
  ROWS_AROUND_DIALOG,
  agreed,
  agreement,
  agreementLines,
  answerOf,
  awayContext,
  awayNotice,
  awayPicks,
  clip,
  decisionsOf,
  decorate,
  keyOf,
  logMarkdown,
  matches,
  meter,
  parseTakes,
  rememberedOf,
  sureColor,
  sureness,
  takeLines,
  takePrompt,
  idleTimeout,
  timedOut,
  when,
  withDecisions,
  withRemembered,
  withoutRemembered,
  withoutRoot,
} from './decide'

const PANE = 'ask'
const KEEP = 30
const asks = atom({ plugin: 'ask', key: 'asks' } as const, [])
const draft = atom({ plugin: 'ask', key: 'draft' } as const, '')

const DECISIONS = 'decisions'
const advice = atom({ plugin: 'ask', key: 'advice' } as const, null)
const offer = atom({ plugin: 'ask', key: 'offer' } as const, null)
const away = atom({ plugin: 'ask', key: 'away' } as const, null)
const log = atom({ plugin: 'ask', key: 'log' } as const, [])
const remembered = atom({ plugin: 'ask', key: 'remembered' } as const, [])
const search = atom({ plugin: 'ask', key: 'search' } as const, '')

const failureOf = (error: HookFailure): string => (error.kind === 'timeout' ? 'ran out of time' : (error.message ?? 'threw'))

// A fault in this mod never stands between Claude and the person: the
// question goes to the engine's own dialog, as if the mod weren't there.
const fallBack = <E, R>($: EngineInterface, e: E, next: ((e: E) => R) & Caught, site: string): R => {
  $.ui.log(`ask: ${site} failed and was left to the default: ${failureOf(next.error)}`, { to: 'debug' })
  return next(e)
}

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

function shortWhy(reply: ModelForkResult): string {
  if (reply.isAnswered) return ''
  switch (reply.reason) {
    case 'api-error':
      return `the API answered ${reply.status}`
    case 'empty-reply':
      return 'no text came back'
    case 'aborted':
      return 'stopped'
    default:
      return 'no answer'
  }
}

// Asks a fork of the session which option it would pick. The fork reads the
// conversation from the prompt cache, so it knows why the question came up.
async function think($: EngineInterface, id: string, questions: readonly Question[]) {
  const slot = memberOf(advice, { requestId: id })
  await update($, slot, () => ({ status: 'thinking' }))
  let next: Advice
  try {
    const prompt = takePrompt(questions)
    let reply: ModelForkResult = await $.model.fork({ prompt })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork') reply = await $.model.complete({ model: 'sonnet', prompt })
    if (!reply.isAnswered) next = { status: 'failed', error: shortWhy(reply) }
    else {
      const takes = parseTakes(reply.text, questions)
      next = takes.some(Boolean) ? { status: 'ready', takes } : { status: 'failed', error: 'the reply could not be read' }
    }
  } catch (error) {
    next = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
  // Answered already: the slot was cleared, so leave it empty.
  if ((await read($, slot)) === null) return
  await update($, slot, () => next)
}

// The store is shared by every session. Each write reads what is stored now,
// changes only the entries it touches, and writes that back, so another
// session's answers since this one loaded are kept.
async function changeLog($: EngineInterface, change: (stored: unknown) => Decision[]) {
  const merged = change(await $.store.get('log'))
  await $.store.set('log', merged)
  await update($, log, () => merged)
}

async function changeRemembered($: EngineInterface, change: (stored: unknown) => ReturnType<typeof rememberedOf>) {
  const merged = change(await $.store.get('remembered'))
  await $.store.set('remembered', merged)
  await update($, remembered, () => merged)
  return merged
}

async function save($: EngineInterface, entries: readonly Decision[]) {
  if (entries.length === 0) return
  await changeLog($, stored => withDecisions(stored, entries))
}

async function remember($: EngineInterface, held: Offer) {
  const at = await $.clock.now()
  await changeRemembered($, stored => withRemembered(stored, held, at))
  await update($, offer, () => null)
  $.ui.toast(held.items.length === 1 ? 'Remembered. Claude gets that answer next time without asking.' : `Remembered ${held.items.length} answers.`)
}

// The idle timeout the dialog runs under, or null when it never fires or the
// settings can't be read. Then the take box just says nothing about it.
async function timeoutOf($: EngineInterface): Promise<string | null> {
  try {
    return idleTimeout(await $.settings.read())
  } catch (error) {
    $.ui.log(`ask: settings.read: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    return null
  }
}

async function loadDecisions($: EngineInterface) {
  const [savedLog, savedRemembered] = await Promise.all([$.store.get('log'), $.store.get('remembered')])
  await update($, log, () => decisionsOf(savedLog))
  await update($, remembered, () => rememberedOf(savedRemembered))
}

// The project's log as markdown, on the clipboard. Nothing is written into
// the project: the log lives in the plugin's store alone.
async function copyLog($: EngineInterface, surface: RenderSurface) {
  const root = await $.session.root()
  const mine = decisionsOf(await $.store.get('log')).filter(d => d.root === root)
  const copied = await $.ui.copy({ text: logMarkdown(mine), surface })
  $.ui.toast(copied.isCopied ? `Copied ${mine.length} decisions as Markdown` : `Could not copy: ${copied.reason}`)
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

    await $.command.register({ name: 'decisions', description: 'Show the decision log and the answers Claude reuses' })
    await loadDecisions($)

    return next(e)
  })

  // Another session may have answered since this one loaded, so the pane
  // starts from what is stored.
  on('command.run', { command: 'decisions' }, async $ => {
    await loadDecisions($)
    await $.ui.open({ id: DECISIONS, title: 'Decisions', focus: true, closeOnEscape: true })
    return {}
  })

  // The band is about the last answer; a new prompt moves on.
  on('prompt.submit', async ($, e, next) => {
    if ((await read($, offer)) !== null) await update($, offer, () => null)
    if ((await read($, away)) !== null) await update($, away, () => null)
    return next(e)
  }).catch(($, e, next) => fallBack($, e, next, 'prompt.submit'))

  // A hook's own time is capped at 10 s, so this hook never waits for the
  // person itself: the engine's dialog does, inside next(e).
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const root = await $.session.root()
    const questions = e.questions as Question[]
    // Read from the store, so an answer remembered in another session counts.
    const known = rememberedOf(await $.store.get('remembered'))
    const now = await $.clock.now()

    // Questions answered before, and marked to remember, aren't asked again.
    const given: Record<string, string> = {}
    for (const q of questions) {
      const hit = known.find(one => one.key === keyOf(root, q))
      if (hit) given[q.question] = hit.answer
    }
    const asked = questions.filter(q => given[q.question] === undefined)
    const fromMemory: Decision[] = questions.flatMap(q => {
      const answer = given[q.question]
      return answer === undefined ? [] : [{ root, header: q.header, question: q.question, answer, source: 'remembered' as const, at: now }]
    })
    if (fromMemory.length > 0) {
      await save($, fromMemory)
      $.ui.toast(fromMemory.length === 1 ? `Answered from memory: ${fromMemory[0]?.answer}` : `Answered ${fromMemory.length} questions from memory`)
    }
    if (asked.length === 0) return { result: { questions, answers: given } as never }

    const id = e.tool_use_id
    void think($, id, asked)
    const ran = await next(asked.length === questions.length ? e : { ...e, questions: asked })

    const slot = memberOf(advice, { requestId: id })
    const held = await read($, slot)
    await update($, slot, () => null)
    if (ran.deny !== undefined || ran.isError) return ran

    const result = ran.result as { answers?: Record<string, string> }
    const takes = held?.status === 'ready' ? held.takes : []
    // Timed out with nobody at the keyboard: Claude goes with its own pick
    // for each question left open. With no ready take there are no picks, and
    // the timeout reaches Claude as it would without this plugin.
    const picks = timedOut(ran.result) ? awayPicks(asked, result.answers, takes) : []
    const entries: Decision[] = []
    const items: Offer['items'] = []
    asked.forEach((q, i) => {
      const answer = answerOf(result.answers, q)
      if (answer === undefined) return
      const take: Take | null = takes[i] ?? null
      entries.push({ root, header: q.header, question: q.question, answer, pick: take?.pick, confidence: take?.confidence, source: 'you', at: now })
      items.push({ key: keyOf(root, q), question: q.question, answer })
    })
    // Logged as away picks, and never offered to remember: nobody chose them.
    for (const { question: q, take } of picks) {
      entries.push({ root, header: q.header, question: q.question, answer: take.pick, pick: take.pick, confidence: take.confidence, source: 'away', at: now })
    }
    await save($, entries)
    if (items.length > 0) await update($, offer, () => ({ root, items }))
    const context = [...(ran.context ?? [])]
    if (picks.length > 0) {
      const noted = picks.map(({ question: q, take }) => ({ question: q.question, pick: take.pick }))
      await update($, away, () => ({ items: noted }))
      $.ui.toast(awayNotice(noted))
      context.push(awayContext(picks))
    }

    if (fromMemory.length === 0) return picks.length === 0 ? ran : { ...ran, context }
    return {
      result: { ...(ran.result as object), questions, answers: { ...given, ...result.answers } } as never,
      ...(context.length > 0 ? { context } : {}),
    }
  }).catch(($, e, next) => fallBack($, e, next, 'tool.call on AskUserQuestion'))

  // The engine's dialog, with Claude's take above it and in the option
  // descriptions. The dialog itself, its keys and its answer, stay the
  // engine's: the tree holds exactly one engine node. Around the dialog a Box
  // can't take a width and the tree gets at most 12 rows, which takeLines
  // budgets for.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const held = await read($, memberOf(advice, e))
    const questions = e.props.questions as Question[]
    const takes = held?.status === 'ready' ? held.takes : []
    const dialog = await next(takes.length > 0 ? { ...e, props: { ...e.props, questions: decorate(questions, takes) } } : e)
    if (held === null) return dialog

    const { Box, Text } = $.ui.resolve(e)
    // The border and the title take three of the rows.
    const timeout = held.status === 'ready' ? await timeoutOf($) : null
    const lines = held.status === 'ready' ? takeLines(questions, takes, ROWS_AROUND_DIALOG - 3, timeout) : []
    return (
      <Box flexDirection="column">
        <Box key="take" flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Text bold color="claude">
            ✦ Claude's take
          </Text>
          {held.status === 'thinking' && <Text dimColor>Working out my pick…</Text>}
          {held.status === 'failed' && <Text dimColor>{clip(`No take this time (${held.error}).`, 70)}</Text>}
          {lines.map((line, i) =>
            line.kind === 'pick' ? (
              <Text key={`line-${i}`}>
                {line.header !== '' && <Text inverse> {line.header} </Text>}
                {line.header !== '' && '  '}
                I'd pick <Text bold>{line.pick}</Text>
                {'  '}
                <Text color={sureColor(line.confidence)}>
                  {meter(line.confidence)} {line.confidence}%
                </Text>
                <Text dimColor> {sureness(line.confidence)}</Text>
              </Text>
            ) : (
              <Text key={`line-${i}`} dimColor>
                {line.text}
              </Text>
            ),
          )}
        </Box>
        {dialog}
      </Box>
    )
  })

  // After an answer: offer to give the same answer next time without asking.
  // After a timeout: say which picks Claude went with while the person was away.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const held = await read($, offer)
    const gone = await read($, away)
    if ((held === null && gone === null) || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const [first] = held?.items ?? []
    const what = held?.items.length === 1 && first ? `"${first.question}" → ${first.answer}` : `your ${held?.items.length} answers`
    return (
      <Box flexDirection="column">
        {gone !== null && (
          <Box key="away" gap={1} flexWrap="wrap">
            <Text color="claude">✦</Text>
            <Text>{awayNotice(gone.items)}</Text>
            <Button key="got-it" label="Got it" hotkey="g" role="dismiss" onPress={() => void update($, away, () => null)} />
          </Box>
        )}
        {held !== null && (
          <Box key="offer" gap={1} flexWrap="wrap">
            <Text color="claude">✦</Text>
            <Text>Remember {what} for next time?</Text>
            <Button key="remember" label="Remember" hotkey="r" variant="primary" onPress={() => void remember($, held)} />
            <Button key="dismiss" label="Not now" hotkey="n" role="dismiss" onPress={() => void update($, offer, () => null)} />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: DECISIONS }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const root = await $.session.root()
    const query = await read($, search)
    const allKept = (await read($, remembered)).filter(one => one.root === root)
    const all = (await read($, log)).filter(d => d.root === root).sort((a, b) => b.at - a.at)
    const kept = allKept.filter(one => matches(query, one.question, one.answer))
    const mine = all.filter(d => matches(query, d.header, d.question, d.answer, d.pick))
    // The stats are over the whole log, whatever the search shows.
    const stats = agreementLines(agreement(all))
    const width = Math.max(20, e.props.bodyColumns)
    const rule = <Text dimColor>{'─'.repeat(width)}</Text>

    return (
      <Box flexDirection="column">
        {'Input' in ui && (
          <ui.Input
            key="search"
            label="Search "
            placeholder="Filter by question or answer…"
            submitLabel="filter"
            value={query}
            autoFocus
            onInput={value => void update($, search, () => value)}
            onSubmit={value => void update($, search, () => value)}
          />
        )}
        <Text bold color="claude">
          ✦ Answers Claude reuses
        </Text>
        <Text dimColor>Asked again, these are answered for you. Forget one to be asked again.</Text>
        {allKept.length === 0 && <Text dimColor>None yet. Press Remember on the band after you answer.</Text>}
        {allKept.length > 0 && kept.length === 0 && <Text dimColor>None match the search.</Text>}
        {kept.map(one => (
          <Box key={`kept-${one.key}`} gap={1}>
            <Button
              key={`forget-${one.at}-${one.question}`}
              label="Forget"
              dimColor
              onPress={() => void changeRemembered($, stored => withoutRemembered(stored, one.key))}
            />
            <Text wrap="truncate-end">
              {one.question} <Text color="success">→ {one.answer}</Text>
            </Text>
          </Box>
        ))}
        <Box marginTop={1}>{rule}</Box>
        <Text bold color="claude">
          ✦ Decision log
        </Text>
        <Text dimColor>
          {all.length} answered in this project
          {query.trim() !== '' && ` · ${mine.length} match the search`}
        </Text>
        {stats.map((line, i) => (
          <Text key={`stats-${i}`} dimColor>
            {line}
          </Text>
        ))}
        {all.length === 0 && <Text dimColor>Nothing yet. Answers to Claude's questions show here.</Text>}
        {mine.slice(0, 50).map((d, i) => (
          <Box key={`d-${d.at}-${i}`} flexDirection="column" marginTop={1}>
            <Text>
              <Text dimColor>{when(d.at)}</Text> <Text inverse> {d.header} </Text> {d.question}
            </Text>
            <Text>
              {'  '}→ <Text bold>{d.answer}</Text>
              {d.source === 'remembered' && <Text dimColor> (remembered)</Text>}
              {d.source === 'away' && <Text color="warning"> · picked while you were away ({d.confidence}%)</Text>}
              {agreed(d) === true && <Text color="success"> ✓ Claude agreed ({d.confidence}%)</Text>}
              {agreed(d) === false && (
                <Text dimColor>
                  {' '}
                  · Claude would have picked {d.pick} ({d.confidence}%)
                </Text>
              )}
            </Text>
          </Box>
        ))}
        <Box marginTop={1}>{rule}</Box>
        <Box key="decision-controls" gap={1} flexWrap="wrap">
          <Button key="copy" label="Copy as Markdown" onPress={press => void copyLog($, press.surface)} />
          {all.length > 0 && <Button key="clear" label="Clear log" dimColor onPress={() => void changeLog($, stored => withoutRoot(stored, root))} />}
        </Box>
      </Box>
    )
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
