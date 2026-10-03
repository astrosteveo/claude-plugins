import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, SessionMessage } from 'claude-code'

import type { CacheMark, ConsultMode, Route, Thread, Turn } from '../types'

const PANE = 'consult'
const threadAtom = atom({ plugin: 'consult', key: 'thread' } as const, null)
const cacheAtom = atom({ plugin: 'consult', key: 'cache' } as const, null)

// The reply puts this line between the advice and the draft.
export const MARK = '===DRAFT==='
// Claude Code caches the main thread for an hour; stop just short of that.
export const DEFAULT_TTL = 55 * 60_000
const MIN_TTL = 4 * 60_000
// About 15K tokens of condensed transcript for the Sonnet route.
export const SONNET_BUDGET = 60_000
const QUOTE_LIMIT = 8000
const RESULT_LIMIT = 500

const RULES = [
  'This is a private side consult from the user. It is not part of the main task.',
  'Do not continue the task. Do not call any tools. Answer in plain text only.',
  'Write in plain language: short sentences, common words, the answer first.',
].join('\n')

const SONNET_SYSTEM = [
  'You are the Claude assistant from a Claude Code session, consulted on the side.',
  'The user message holds a condensed transcript of that session: your conversation with the user so far.',
  'Tool calls are cut short, so say so when an answer depends on a detail you cannot see.',
].join('\n')

export function parseArgs(args: string): { mode: ConsultMode; ask: string } | 'close' {
  const text = args.trim()
  if (text === 'close') return 'close'
  const match = /^prompt\b\s*/i.exec(text)
  if (match) return { mode: 'prompt', ask: text.slice(match[0].length) }

  return { mode: 'advice', ask: text }
}

/** Fork while the main thread's cache is warm; otherwise Sonnet is far cheaper. */
export function pickRoute(cache: CacheMark | null, now: number): Route {
  if (!cache) return 'sonnet'
  return now - cache.at < cache.ttlMs ? 'fork' : 'sonnet'
}

/** A warm fork refreshes the cache; a cold one means the cache lasts less than we thought. */
export function learnCache(cache: CacheMark | null, usage: ModelUsage, now: number): CacheMark | null {
  if (!cache) return cache
  const total = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  if (total > 0 && usage.cache_read_input_tokens >= total / 2) return { ...cache, at: now }

  return { at: cache.at, ttlMs: Math.max(MIN_TTL, Math.min(cache.ttlMs, Math.floor((now - cache.at) * 0.9))) }
}

const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

/** The session as text, newest kept, with tool calls cut to one short line each. */
export function condense(messages: readonly SessionMessage[], budget = SONNET_BUDGET): string {
  const blocks: string[] = []
  for (const m of messages) {
    const lines: string[] = []
    if (m.text.trim()) lines.push(`${m.role === 'user' ? 'User' : 'Claude'}: ${m.text.trim()}`)
    for (const use of m.toolUses) {
      const outcome = use.text ? ` → ${cut(use.text.replace(/\s+/g, ' '), RESULT_LIMIT)}` : ''
      lines.push(`  [${use.tool}] ${cut(JSON.stringify(use.input), 200)}${outcome}`)
    }
    if (lines.length) blocks.push(lines.join('\n'))
  }

  const kept: string[] = []
  let size = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!
    if (size + block.length > budget) {
      kept.unshift('(earlier messages left out)')
      break
    }
    kept.unshift(block)
    size += block.length
  }
  return kept.join('\n\n')
}

export function buildPrompt(mode: ConsultMode, turns: readonly Turn[], lastReply: string): string {
  const quoted = lastReply.length > QUOTE_LIMIT ? `…${lastReply.slice(-QUOTE_LIMIT)}` : lastReply
  const said = quoted
    ? `Your last message to the user was:\n<last_message>\n${quoted}\n</last_message>`
    : 'You have not sent the user a message yet.'
  const first = turns[0]?.text ?? ''

  const task =
    mode === 'prompt'
      ? [
          `The user wants to ask you for this next, in their own rough words:\n<idea>\n${first || '(no idea given: suggest the most useful next step)'}\n</idea>`,
          'Turn the idea into one prompt they can send you. Scope it to this project and this conversation.',
          'Say what to do, which files or parts it touches, the limits to respect, and what "done" looks like.',
          'Leave out anything you already know from this conversation. Keep it short. Do not do the work.',
        ]
      : [
          `The user's question to you about it:\n<question>\n${first || 'What are you asking me, and what should I answer?'}\n</question>`,
          'Help them answer you well. Explain in plain words what you need from them and why it matters.',
          'Give your recommendation and the main tradeoff. If they lack a fact only they can know, say which one.',
        ]

  const later = turns.slice(1)
  const thread = later.length
    ? [
        `This consult so far, after that first ${mode === 'prompt' ? 'idea' : 'question'}:\n<consult>\n${later
          .slice(0, -1)
          .map(t => `${t.who === 'you' ? 'User' : 'You'}: ${t.text}`)
          .join('\n\n')}\n</consult>`,
        `The user's follow-up:\n<follow_up>\n${later.at(-1)?.text ?? ''}\n</follow_up>`,
        'Answer the follow-up.',
      ]
    : []

  const draft = mode === 'prompt' ? 'the prompt' : 'the exact reply they should send you, in their voice'
  return [
    RULES,
    said,
    ...task,
    ...thread,
    `End with a line holding only ${MARK}, then ${draft}, updated for anything this consult changed, and nothing after it.`,
  ].join('\n\n')
}

// Only a line holding the mark alone splits: a draft about this mod may quote the mark inline.
const MARK_LINE = new RegExp(`^[ \\t]*${MARK}[ \\t]*$`, 'm')

export function splitReply(text: string): { advice: string; draft: string } {
  const found = MARK_LINE.exec(text)
  if (!found) return { advice: text.trim(), draft: '' }

  return { advice: text.slice(0, found.index).trim(), draft: text.slice(found.index + found[0].length).trim() }
}

const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

const FAILED: Record<string, string> = {
  'empty-reply': 'The side call came back empty. Try again.',
  aborted: 'The side call was cut off. Try again.',
}

type Answer = { text: string; via: string } | { error: string }

async function ask($: EngineInterface, thread: Thread): Promise<Answer> {
  const messages = await $.session.messages()
  const lastReply = messages.filter(m => m.role === 'assistant' && m.text.trim()).at(-1)?.text ?? ''
  const prompt = buildPrompt(thread.mode, thread.turns, lastReply)
  const now = await $.clock.now()

  if (pickRoute(await read($, cacheAtom), now) === 'fork') {
    const r = await $.model.fork({ prompt })
    if (r.isAnswered) {
      await update($, cacheAtom, cache => learnCache(cache, r.usage, now))
      return { text: r.text, via: `fork · ${kilo(r.usage.cache_read_input_tokens)} cached, ${kilo(r.usage.input_tokens + r.usage.cache_creation_input_tokens)} uncached` }
    }
    if (r.reason !== 'nothing-to-fork') return { error: failure(r) }
  }

  const transcript = condense(messages)
  const r = await $.model.complete({
    model: 'sonnet',
    system: SONNET_SYSTEM,
    prompt: `<session_transcript>\n${transcript}\n</session_transcript>\n\n${prompt}`,
    maxTokens: 4000,
    effort: 'medium',
    timeoutMs: 120_000,
  })
  if (!r.isAnswered) return { error: failure(r) }

  return { text: r.text, via: `Sonnet · ${kilo(r.usage.input_tokens)} sent` }
}

function failure(r: { reason: string; status?: number | null; error?: string }): string {
  if (r.reason === 'api-error') return `The side call failed (${r.error}${r.status ? `, HTTP ${r.status}` : ''}).`
  return FAILED[r.reason] ?? `No reply: ${r.reason}.`
}

/** Asks for the latest turn of the thread and records the answer. */
async function answer($: EngineInterface, run: number) {
  const thread = await read($, threadAtom)
  if (!thread || thread.run !== run) return

  const got = await ask($, thread)
  let done: Partial<Thread>
  if ('error' in got) {
    done = { status: 'error', error: got.error }
  } else {
    const { advice, draft } = splitReply(got.text)
    const turns = [...thread.turns, { who: 'claude' as const, text: advice, via: got.via }]
    done = { status: 'done', error: '', turns, draft: draft || thread.draft, isFilled: false }
    if (draft) {
      // Only an empty box or our own last fill is ours to replace.
      const box = await $.prompt.read()
      if (!box.text.trim() || box.text === thread.filled) {
        const filled = await $.prompt.fill({ text: draft, mode: 'replace' })
        if (filled.isFilled) done = { ...done, isFilled: true, filled: draft }
      }
      if (done.isFilled) $.ui.toast(thread.mode === 'prompt' ? 'Prompt is in your prompt box.' : 'Suggested reply is in your prompt box.')
    }
  }

  await update($, threadAtom, cur => (cur && cur.run === run ? { ...cur, ...done } : cur))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'consult',
      description: 'Ask a side Claude how to answer, or `prompt <idea>` to draft a prompt (kept out of the chat)',
      argumentHint: '[question] | prompt <idea> | close',
      immediate: true,
    })

    return next(e)
  })

  // The main thread's requests keep its prompt cache warm.
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cacheAtom, cache => ({ at: now, ttlMs: cache?.ttlMs ?? DEFAULT_TTL }))
    }
    return next(e)
  })

  // Answers for itself with no text: command output is a row the model reads.
  on('command.run', { command: 'consult' }, async ($, e) => {
    const parsed = parseArgs(e.args)
    if (parsed === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }

    const prev = await read($, threadAtom)
    const run = (prev?.run ?? 0) + 1
    await update($, threadAtom, () => ({
      run,
      mode: parsed.mode,
      status: 'thinking',
      turns: [{ who: 'you', text: parsed.ask }],
      error: '',
      draft: '',
      filled: '',
      isFilled: false,
    }))
    await $.ui.open({ id: PANE, title: parsed.mode === 'prompt' ? 'Consult: prompt' : 'Consult' })
    void answer($, run)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    // Mobile draws no Input; follow-ups need another surface there.
    const Input = 'Input' in els ? els.Input : undefined
    const t = await read($, threadAtom)
    if (!t) return <Text dimColor>Run /consult to ask something.</Text>

    const followUp = async (value: string) => {
      const text = value.trim()
      let run = 0
      await update($, threadAtom, (c): Thread | null => {
        if (!text || !c || c.status === 'thinking') return c
        run = c.run
        return { ...c, status: 'thinking', error: '', turns: [...c.turns, { who: 'you' as const, text }] }
      })
      if (run) void answer($, run)
    }

    const firstLabel = t.mode === 'prompt' ? 'Idea' : 'You'
    const draftLabel = t.mode === 'prompt' ? 'Prompt' : 'Suggested reply'
    const draftNote = t.isFilled ? 'in your prompt box, edit then send' : t.filled ? 'kept your edits in the prompt box, copy from here' : 'prompt box was busy, copy from here'
    return (
      <Box flexDirection="column" gap={1}>
        {t.turns.map((turn, i) =>
          turn.who === 'you' ? (
            <Text bold>
              {i === 0 ? firstLabel : 'You'}: {turn.text || '(explain your last message)'}
            </Text>
          ) : (
            <Box flexDirection="column">
              <Text>{turn.text}</Text>
              {turn.via && <Text dimColor>via {turn.via}</Text>}
            </Box>
          ),
        )}
        {t.status === 'thinking' && <Text dimColor>Thinking…</Text>}
        {t.status === 'error' && <Text color="red">{t.error}</Text>}
        {t.draft && t.status !== 'thinking' && (
          <Box flexDirection="column">
            <Text bold>
              {draftLabel} ({draftNote})
            </Text>
            <Text>{t.draft}</Text>
          </Box>
        )}
        {Input && (
          <Input key={`followup-${t.turns.length}`} placeholder="Ask a follow-up" submitLabel="ask" onSubmit={followUp} />
        )}
        <Text dimColor>Click or ctrl+x tab to type a follow-up. /consult close hides this pane.</Text>
      </Box>
    )
  })
}
