import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelTextBlock, ModelUsage, PluginOptions, Register } from 'claude-code'

import type { Choice, Effort, Exchange, Route, Picks, Spent, Ttl } from '../types'
import * as cost from './cost'
import * as p from './prompt'

const PANE = 'aside'
const thread = atom({ plugin: 'aside', key: 'thread' } as const, [])
const chosen = atom({ plugin: 'aside', key: 'defaults' } as const, null)
const pending = atom({ plugin: 'aside', key: 'pending' } as const, null)
const quote = atom({ plugin: 'aside', key: 'quote' } as const, null)
const caches = atom({ plugin: 'aside', key: 'caches' } as const, {})
const agents = atom({ plugin: 'aside', key: 'agents' } as const, [])
const main = atom({ plugin: 'aside', key: 'main' } as const, { at: null, isRunning: false })

const MAX_THREAD = 50
const MAX_TOKENS = 8_000

type Options = {
  model: Choice
  tools: boolean
  confirmSwitch: boolean
  cacheTtl: 'auto' | Ttl
  transcriptTokens: number
  threadTurns: number
}

function optionsOf(o: PluginOptions): Options {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)

  return {
    model: p.CHOICES.includes(o.model as Choice) ? (o.model as Choice) : 'session',
    tools: o.tools === true,
    confirmSwitch: o.confirmSwitch !== false,
    cacheTtl: o.cacheTtl === '5m' || o.cacheTtl === '1h' ? o.cacheTtl : 'auto',
    transcriptTokens: num(o.transcriptTokens, 100_000),
    threadTurns: num(o.threadTurns, 10),
  }
}

// The subagents asides started: their tool calls are held to reading, and
// their reports are kept out of the session. Restored from state on each load.
const ours = new Set<string>()
// Spawns in flight, whose subagent may call a tool before its id is known.
const spawning = new Set<Promise<unknown>>()
let counter = 0

const ADVISOR = 'advisor'
const advisorType = (effort: Effort) => `aside:${effort === 'default' ? ADVISOR : `${ADVISOR}-${effort}`}`

function spentOf(u: ModelUsage | undefined): Spent | undefined {
  if (u === undefined) return undefined

  return { input: u.input_tokens, output: u.output_tokens, read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens }
}

async function settingsOf($: EngineInterface, o: Options): Promise<Picks> {
  return (await read($, chosen)) ?? { model: o.model, effort: 'default', tools: o.tools }
}

// Figures by model id kept across sessions: `scale`, real tokens per
// estimated one; `answers`, how long answers run; `runs`, what subagent runs
// cost against their estimate.
async function figures($: EngineInterface, key: 'scale' | 'answers' | 'runs'): Promise<Record<string, number>> {
  const v = await $.store.get(key)

  return typeof v === 'object' && v !== null ? (v as Record<string, number>) : {}
}

const scaleOf = ($: EngineInterface) => figures($, 'scale')

async function ttlOf($: EngineInterface, o: Options): Promise<Ttl> {
  if (o.cacheTtl !== 'auto') return o.cacheTtl

  return (await $.store.get('ttl')) === '1h' ? '1h' : '5m'
}

async function sessionModel($: EngineInterface): Promise<cost.Model> {
  const name = await $.session.model()
  // A model of no family the table knows is priced as the newest Opus.
  const opus = cost.resolve('opus') as cost.Model

  return cost.resolve(name) ?? { ...opus, id: name, name }
}

// Who answers and how, for these settings: the session's own model at its
// own effort forks the session's request and reads its cache; anything else
// is a request or a subagent of the aside's own.
function planOf(s: Picks, session: cost.Model): { plan: cost.Plan; modelArg: string } {
  const model = s.model === 'session' ? session : (cost.resolve(s.model) ?? session)
  const isFork = model.id === session.id && s.effort === 'default'
  const route: Route = isFork ? (s.tools ? 'fork-agent' : 'fork') : s.tools ? 'agent' : 'model'

  return { plan: { route, model }, modelArg: model.id === session.id ? session.id : s.model }
}

type Situation = { s: cost.Situation; rendered: string[]; now: number; mainAt: number | null; isMainRunning: boolean }

async function situation($: EngineInterface, o: Options, askTokens: number): Promise<Situation> {
  const [session, usage, messages, m, tracks, ttl, now, scale, answers, runs] = await Promise.all([
    sessionModel($),
    $.session.usage(),
    $.session.messages(),
    read($, main),
    read($, caches),
    ttlOf($, o),
    $.clock.now(),
    scaleOf($),
    figures($, 'answers'),
    figures($, 'runs'),
  ])
  const rendered = messages.map(p.renderMessage)
  const cached: Record<string, number> = {}
  for (const [id, track] of Object.entries(tracks)) cached[id] = p.cachedTokens(rendered, track, now)

  return {
    s: {
      session,
      contextTokens: usage.context.tokens ?? 0,
      isMainWarm: m.isRunning || (m.at !== null && now - m.at < cost.TTL_MS[ttl]),
      ttl,
      transcriptTokens: p.transcript(rendered, o.transcriptTokens, undefined, now).tokens,
      cached,
      askTokens,
      scale,
      answers,
      runs,
    },
    rendered,
    now,
    mainAt: m.at,
    isMainRunning: m.isRunning,
  }
}

const stayPlan = (s: Picks, session: cost.Model): cost.Plan => ({ route: s.tools ? 'fork-agent' : 'fork', model: session })

// What the next question would cost on each choice, for the pane.
async function refreshQuote($: EngineInterface, o: Options) {
  const [s, list] = await Promise.all([settingsOf($, o), read($, thread)])
  const at = await situation($, o, p.estimateTokens(p.threadText(list, o.threadTurns)) + 100)
  const costs: Partial<Record<Choice, number>> = {}
  for (const c of p.CHOICES) costs[c] = cost.estimate(planOf({ ...s, model: c }, at.s.session).plan, at.s)
  await update($, quote, () => ({
    at: at.now,
    session: at.s.session.name,
    contextTokens: at.s.contextTokens,
    transcriptTokens: at.s.transcriptTokens,
    isMainWarm: at.s.isMainWarm,
    ttl: at.s.ttl,
    costs,
  }))
}

async function patch($: EngineInterface, id: string, change: Partial<Exchange>) {
  await update($, thread, list => list.map(x => (x.id === id ? { ...x, ...change } : x)))
}

async function settle($: EngineInterface, o: Options, id: string, change: Partial<Exchange>) {
  const now = await $.clock.now()
  const was = (await read($, thread)).find(x => x.id === id)
  await patch($, id, { ...change, ms: was === undefined ? undefined : now - was.at })
  // A single request's answer length, for the next estimate; a subagent's
  // output runs through its tool calls too, so it says nothing of one answer.
  const model = was === undefined ? undefined : cost.resolve(was.model)
  const route = change.route ?? was?.route
  if (change.status === 'done' && change.spent !== undefined && model !== undefined && (route === 'fork' || route === 'model')) {
    await $.store.set('answers', cost.lengthen(await figures($, 'answers'), model.id, change.spent.output))
  }
  if (!isShown) $.ui.toast(change.status === 'done' ? `Aside answered. /aside shows it.` : `Aside failed: ${change.error ?? 'no answer'}`)
  void refreshQuote($, o).catch(() => {})
}

// Asks one question with these settings. A pricier pick than the session's
// own cache waits for the person's word unless `force` gives it.
async function ask($: EngineInterface, o: Options, question: string, settings: Picks, force = false) {
  const list = await read($, thread)
  const carried = p.threadText(list, o.threadTurns)
  const at = await situation($, o, p.estimateTokens(carried + question) + 100)
  const { plan, modelArg } = planOf(settings, at.s.session)
  const mine = cost.estimate(plan, at.s)
  const stay = cost.estimate(stayPlan(settings, at.s.session), at.s)
  if (!force && o.confirmSwitch && plan.route !== 'fork' && plan.route !== 'fork-agent') {
    const why = cost.warning(plan, mine, stay, at.s)
    if (why !== undefined) {
      await update($, pending, () => ({ question, settings, usd: mine, stayUsd: stay, model: plan.model.name, session: at.s.session.name, why }))
      await openPane($)
      if (!isShown) $.ui.toast(`Aside held: ${why} /aside to choose.`)

      return
    }
  }
  await update($, pending, () => null)
  const ex: Exchange = {
    id: `${at.now.toString(36)}-${++counter}`,
    at: at.now,
    question,
    model: plan.model.name,
    route: plan.route,
    tools: settings.tools,
    effort: settings.effort,
    status: 'running',
    estimate: mine,
    stayEstimate: stay,
    ...(force ? { forced: true } : {}),
  }
  await update($, thread, l => [...l, ex].slice(-MAX_THREAD))
  void run($, o, ex, plan, modelArg, carried, at).catch(err => settle($, o, ex.id, { status: 'failed', error: String(err) }))
}

async function run($: EngineInterface, o: Options, ex: Exchange, plan: cost.Plan, modelArg: string, carried: string, at: Situation) {
  if (plan.route === 'fork') {
    const gap = at.isMainRunning ? 0 : at.mainAt === null ? undefined : at.now - at.mainAt
    const r = await $.model.fork({ prompt: p.forkPrompt(carried, ex.question, false) })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') {
      // No conversation yet: ask the session's model on its own.
      await patch($, ex.id, { route: 'model' })

      return run($, o, { ...ex, route: 'model' }, { route: 'model', model: plan.model }, modelArg, carried, at)
    }
    const spent = spentOf(r.usage)
    // A fork reads the session's cache entry, which refreshes it.
    if (spent !== undefined && spent.read > 0) await update($, main, m => ({ ...m, at: Math.max(m.at ?? 0, ex.at) }))
    await learnTtl($, o, gap, spent, at.s.contextTokens)
    const usd = spent === undefined ? undefined : cost.usd(plan.model, spent, at.s.ttl)
    if (r.isAnswered) return settle($, o, ex.id, { status: 'done', answer: r.text, spent, usd })

    return settle($, o, ex.id, { status: 'failed', error: failure(r), spent, usd })
  }

  if (plan.route === 'model') {
    const tracks = await read($, caches)
    const t = p.transcript(at.rendered, o.transcriptTokens, tracks[plan.model.id], at.now)
    const marked = (i: number) => i >= t.stretches.length - 2
    const prompt: ModelTextBlock[] = [
      { text: p.TRANSCRIPT_HEAD },
      ...t.stretches.map((text, i) => (marked(i) ? { text: text || '…', cache: true as const } : { text: text || '…' })),
      { text: p.askText(carried, ex.question) },
    ]
    const r = await $.model.complete({
      model: modelArg,
      system: p.SYSTEM,
      prompt,
      maxTokens: MAX_TOKENS,
      ...(ex.effort === 'default' ? {} : { effort: ex.effort }),
    })
    const spent = spentOf(r.usage)
    const usd = spent === undefined ? undefined : cost.usd(plan.model, spent, '5m')
    if (!r.isAnswered) return settle($, o, ex.id, { status: 'failed', error: failure(r), spent, usd })
    await update($, caches, all => ({ ...all, [plan.model.id]: t.track }))
    // What the model counted against what was estimated, for the next estimate.
    if (spent !== undefined) {
      const estimated = cost.SYSTEM_TOKENS + t.tokens + p.estimateTokens(p.TRANSCRIPT_HEAD + p.askText(carried, ex.question))
      await $.store.set('scale', cost.rescale(await scaleOf($), plan.model.id, spent.input + spent.read + spent.write, estimated))
    }

    return settle($, o, ex.id, { status: 'done', answer: r.text, spent, usd })
  }

  // A subagent with read-only tools: a fork of the session, which reads its
  // cache, or a fresh advisor on another model or effort, handed a transcript.
  const brief = () => {
    const t = p.transcript(at.rendered, o.transcriptTokens, undefined, at.now)

    return `${p.TRANSCRIPT_HEAD}${t.stretches.join('\n')}${p.askText(carried, ex.question)}`
  }
  const description = `Aside: ${ex.question.slice(0, 40)}`
  const spawn = async (args: Parameters<EngineInterface['agent']['spawn']>[0]) => {
    const call = $.agent.spawn(args)
    spawning.add(call)
    try {
      const r = await call
      if (r.agentId !== undefined) {
        ours.add(r.agentId)
        await update($, agents, l => [...l, r.agentId as string].slice(-100))
      }

      return r
    } finally {
      spawning.delete(call)
    }
  }
  let r = plan.route === 'fork-agent'
    ? await spawn({ subagentType: 'fork', prompt: p.forkPrompt(carried, ex.question, true), description }).catch(() => undefined)
    : await spawn({ subagentType: advisorType(ex.effort), model: modelArg, prompt: brief(), description })
  if (plan.route === 'fork-agent' && (r === undefined || r.agentId === undefined)) {
    // No fork to be had: an advisor on the session's model, handed a transcript.
    await patch($, ex.id, { route: 'agent' })
    r = await spawn({ subagentType: advisorType(ex.effort), model: modelArg, prompt: brief(), description })
  }
  if (r === undefined || r.agentId === undefined) {
    return settle($, o, ex.id, { status: 'failed', error: r?.deny ?? 'The subagent did not start.' })
  }
  await patch($, ex.id, { agentId: r.agentId })
}

function failure(r: { reason: string; status?: number | null; error?: unknown }): string {
  if (r.reason === 'api-error') return `API error${r.status ? ` ${r.status}` : ''}${r.error ? `: ${String(r.error)}` : ''}`
  if (r.reason === 'empty-reply') return 'The model gave no answer.'
  if (r.reason === 'aborted') return 'Cut short.'

  return r.reason
}

// Whether this load has read the session cache's lifetime from the transcript.
let isTtlRead = false

// The session's cache lifetime, as the transcript records its last cache
// write: no call on `$` reports it. A transcript past what one read takes
// (4 MiB) is left to what the forks show.
async function readTtl($: EngineInterface, path: string) {
  const lines = (await $.fs.read(path)).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (!line.includes('"ephemeral_')) continue
    const hour = Number(/"ephemeral_1h_input_tokens":\s*(\d+)/.exec(line)?.[1] ?? 0)
    const five = Number(/"ephemeral_5m_input_tokens":\s*(\d+)/.exec(line)?.[1] ?? 0)
    if (hour === 0 && five === 0) continue
    await $.store.set('ttl', hour > 0 ? '1h' : '5m')
    isTtlRead = true

    return
  }
}

// What a fork's cache read says about the session cache's lifetime, where
// the transcript did not say: a read past five minutes means an hour; a miss
// well inside an hour means five.
async function learnTtl($: EngineInterface, o: Options, gap: number | undefined, spent: Spent | undefined, prefix: number) {
  if (o.cacheTtl !== 'auto' || isTtlRead || gap === undefined || spent === undefined || prefix === 0) return
  if (gap <= cost.TTL_MS['5m'] || gap >= cost.TTL_MS['1h']) return
  if (spent.read > prefix / 2) await $.store.set('ttl', '1h')
  else if (spent.read < prefix / 10) await $.store.set('ttl', '5m')
}

// Hands an answer to the session: sent as a prompt of its own, or put in the
// prompt box to edit first.
async function handOff($: EngineInterface, how: 'send' | 'edit', index: number | undefined) {
  const list = await read($, thread)
  const ex = index === undefined ? list.filter(x => x.status === 'done').at(-1) : list[index - 1]
  if (ex === undefined || ex.status !== 'done' || ex.answer === undefined) {
    $.ui.toast(index === undefined ? 'No answered aside to hand over yet.' : `Aside ${index} has no answer.`)

    return
  }
  const text = `I asked ${ex.model} on the side: ${ex.question}\n\nIts answer:\n\n${ex.answer}`
  if (how === 'edit') {
    const r = await $.prompt.fill({ text, mode: 'insert' })
    if (!r.isFilled) {
      $.ui.toast('The prompt box could not take the answer.')

      return
    }
  } else void $.prompt.submit({ text })
  await patch($, ex.id, { handedOff: how === 'send' ? 'sent' : 'edited' })
}

let isShown = false

async function openPane($: EngineInterface, focus = false) {
  const r = await $.ui.open({ id: PANE, title: 'Aside', ...(focus ? { focus: true as const } : {}) })
  isShown = r.isPlaced
}

async function setSettings($: EngineInterface, o: Options, change: Partial<Picks>) {
  const s = await settingsOf($, o)
  await update($, chosen, () => ({ ...s, ...change }))
  void refreshQuote($, o).catch(() => {})
}

function choiceName(c: Choice, session: string | undefined): string {
  if (c === 'session') return session === undefined ? 'Session' : `Session (${session})`

  return cost.resolve(c)?.name ?? c
}

function meta(x: Exchange): string {
  const parts = [x.model]
  if (x.tools) parts.push('tools')
  if (x.effort !== 'default') parts.push(x.effort)
  if (x.route === 'fork' || x.route === 'fork-agent') parts.push('session cache')
  if (x.ms !== undefined) parts.push(`${Math.round(x.ms / 1000)}s`)
  if (x.usd !== undefined) parts.push(x.route === 'model' || x.route === 'fork' ? cost.money(x.usd) : `${cost.money(x.usd)} incl. tools`)
  // Off the session's cache, what it was estimated at against staying, and
  // whether a hold was overridden, so a pricier answer says how it got here.
  if (x.route === 'model' || x.route === 'agent') {
    const vs = x.stayEstimate === undefined ? '' : ` vs ≈${cost.money(x.stayEstimate)} staying`
    if (x.estimate !== undefined) parts.push(`est. ≈${cost.money(x.estimate)}${vs}`)
    if (x.forced) parts.push('asked anyway after a hold')
  } else if (x.usd === undefined && x.estimate !== undefined) parts.push(`≈${cost.money(x.estimate)}`)
  if (x.spent !== undefined) {
    const { input, read, write, output } = x.spent
    parts.push(`${cost.tokens(input + read + write)} in${read > 0 ? ` (${cost.tokens(read)} cached)` : ''} · ${cost.tokens(output)} out`)
  }
  if (x.handedOff !== undefined) parts.push(x.handedOff === 'sent' ? 'sent to the session' : 'put in the prompt')

  return parts.join(' · ')
}

export const register: Register = (on, options) => {
  const o = optionsOf(options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    for (const id of await read($, agents)) ours.add(id)
    try {
      await $.command.register({
        name: 'aside',
        description: 'Ask a side question without touching the session: any model, read-only tools, a pane of its own',
        argumentHint: '[-m model] [-e effort] [-t] question | send | edit | clear',
        immediate: true,
      })
    } catch {
      // A clash with another command leaves the pane's own input working.
    }
    for (const effort of p.EFFORTS) {
      await $.agent
        .register({
          name: effort === 'default' ? ADVISOR : `${ADVISOR}-${effort}`,
          description: 'Answers a side question for /aside. Started by the aside mod only.',
          prompt: p.AGENT_SYSTEM,
          permissionMode: 'dontAsk',
          disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Agent'],
          maxTurns: 40,
          ...(effort === 'default' ? {} : { effort }),
        })
        .catch(() => {})
    }
    void refreshQuote($, o).catch(() => {})

    return result
  })

  // The advisor types are the mod's own: the session's model never sees them.
  on('agent.offer', async ($, e, next) => (e.agent.startsWith('aside:') ? { isOffered: false } : next(e)))

  on('turn.start', async ($, e, next) => {
    await update($, main, m => ({ ...m, isRunning: true }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, main, () => ({ at: now, isRunning: false }))
      void refreshQuote($, o).catch(() => {})

      return result
    }
    if (!ours.has(e.agentId)) return result
    const ex = (await read($, thread)).find(x => x.agentId === e.agentId)
    if (ex === undefined || ex.status !== 'running') return result
    const spent = spentOf(e.usage)
    const model = (e.usage?.model !== undefined ? cost.resolve(e.usage.model) : undefined) ?? cost.resolve(ex.model)
    const ttl = ex.route === 'fork-agent' ? await ttlOf($, o) : '5m'
    const usd = spent === undefined || model === undefined ? undefined : cost.usd(model, spent, ttl)
    if (e.reason === 'answer' && usd !== undefined && model !== undefined && ex.estimate !== undefined) {
      await $.store.set('runs', cost.rerun(await figures($, 'runs'), ex.route, model.id, usd, ex.estimate))
    }
    if (e.reason === 'answer' && e.answer.trim() !== '') await settle($, o, ex.id, { status: 'done', answer: e.answer, spent, usd })
    else await settle($, o, ex.id, { status: 'failed', error: e.reason === 'aborted' ? 'Stopped.' : 'The subagent gave no answer.', spent, usd })

    return result
  })

  // A subagent's report would reach the session as a task notification:
  // an aside's stays in its pane.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      for (const id of ours) if (e.text.includes(id)) return { drop: 'An aside finished: its answer is in the aside pane.' }
    }

    return next(e)
  })

  // An aside's subagent only reads. While one of its spawns is in flight, a
  // subagent the mod cannot place yet waits for it before it is judged.
  const judged = (agentId: string | undefined, tool: string, input: unknown): string | undefined =>
    agentId !== undefined && (ours.has(agentId) || spawning.size > 0) ? p.refusal(tool, input) : undefined
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined && !ours.has(e.agentId) && spawning.size > 0) await Promise.allSettled([...spawning])
    const why = e.agentId !== undefined && ours.has(e.agentId) ? p.refusal(String(e.tool), e) : undefined

    return why === undefined ? next(e) : { deny: why }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    const why = judged(e.agentId, String(e.tool), e)

    return why === undefined ? next(e) : { deny: why }
  })

  // Nor does it ever stop to ask the person for permission.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.agentId === undefined || !ours.has(e.agentId) || verdict.decision !== 'ask') return verdict

    return { decision: 'deny', reason: 'An aside never asks for permission.' }
  })

  on('command.run', { command: 'aside' }, async ($, e) => {
    const c = p.parse(e.args)
    if (c.kind === 'open') await openPane($, true)
    else if (c.kind === 'ask') {
      const s = await settingsOf($, o)
      const settings: Picks = { model: c.model ?? s.model, effort: c.effort ?? s.effort, tools: c.tools ?? s.tools }
      await openPane($)
      void ask($, o, c.question, settings).catch(err => $.ui.toast(`Aside failed: ${String(err)}`))
    } else if (c.kind === 'send' || c.kind === 'edit') await handOff($, c.kind, c.index)
    else if (c.kind === 'clear') {
      await update($, thread, () => [])
      await update($, pending, () => null)
      $.ui.toast('Aside thread cleared.')
    } else if (c.kind === 'model') await setSettings($, o, { model: c.model })
    else if (c.kind === 'effort') await setSettings($, o, { effort: c.effort })
    else if (c.kind === 'tools') await setSettings($, o, { tools: c.tools })
    else $.ui.toast(c.text)

    // Nothing of the command reaches the transcript.
    return {}
  })

  // At the end of a main turn, until this load has it, the cache lifetime.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (o.cacheTtl === 'auto' && !isTtlRead) {
      await readTtl($, e.transcript_path).catch(() => {})
      void refreshQuote($, o).catch(() => {})
    }

    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isShown = false

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const [list, s, held, q] = await Promise.all([read($, thread), settingsOf($, o), read($, pending), read($, quote)])
    const asked = (question: string, settings: Picks, force = false) =>
      void ask($, o, question, settings, force).catch(err => $.ui.toast(`Aside failed: ${String(err)}`))
    const priced = (c: Choice) => {
      const usd = q?.costs[c]

      return `${choiceName(c, q?.session)}${usd === undefined ? '' : ` ≈${cost.money(usd)}`}`
    }

    const controls =
      e.surface === 'mobile' ? (
        <Text dimColor>Ask with /aside from a terminal or the desktop.</Text>
      ) : (
        (() => {
          const { Input, Select } = $.ui.resolve(e)

          return (
            <Box flexDirection="column">
              <Input key="ask" label="Ask" placeholder="a side question" submitLabel="ask" autoFocus onSubmit={v => (v.trim() === '' ? undefined : asked(v.trim(), s))} />
              <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                <Select
                  key="model"
                  label="Model"
                  value={s.model}
                  options={p.CHOICES.map(c => ({ value: c, label: priced(c) }))}
                  onSelect={v => void setSettings($, o, { model: v as Choice })}
                />
                <Select
                  key="effort"
                  label="Effort"
                  value={s.effort}
                  options={p.EFFORTS.map(x => ({ value: x }))}
                  onSelect={v => void setSettings($, o, { effort: v as Effort })}
                />
                <Button key="tools" hotkey="t" onPress={() => void setSettings($, o, { tools: !s.tools })}>
                  {s.tools ? 'Tools: read-only' : 'Tools: off'}
                </Button>
              </Box>
            </Box>
          )
        })()
      )

    const cacheLine =
      q === null
        ? undefined
        : q.contextTokens === 0
          ? 'No conversation yet.'
          : `${cost.tokens(q.contextTokens)} tokens in context, ${q.isMainWarm ? 'cache warm' : 'cache likely cold'} (${q.ttl} cache).`

    const latest = list.filter(x => x.status === 'done').at(-1)?.id
    const rows = list
      .map((x, i) => ({ x, n: i + 1 }))
      .reverse()
      .map(({ x, n }) => {
        const isLatest = x.id === latest

        return (
          <Box key={x.id} flexDirection="column" marginTop={1}>
            <Text bold>
              {n}. {x.question}
            </Text>
            {x.status === 'running' && <Text dimColor>{x.model} is thinking…</Text>}
            {x.status === 'done' && <Markdown text={x.answer ?? ''} />}
            {x.status === 'failed' && <Text color="error">{x.error ?? 'No answer.'}</Text>}
            <Text dimColor>{meta(x)}</Text>
            {/* Only the newest answer has buttons, so a press can't land on an older one by mistake. */}
            {x.status === 'done' && isLatest && (
              <Box flexDirection="row" columnGap={1}>
                <Button key="send" hotkey="s" onPress={() => void handOff($, 'send', n)}>
                  {x.handedOff === 'sent' ? 'Send again' : 'Send to session'}
                </Button>
                <Button key="edit" hotkey="e" onPress={() => void handOff($, 'edit', n)}>
                  Edit in prompt
                </Button>
                <Button key="copy" hotkey="c" onPress={pe => void $.ui.copy({ text: x.answer ?? '', surface: pe.surface })}>
                  Copy
                </Button>
              </Box>
            )}
            {x.status === 'done' && !isLatest && (
              <Text dimColor>
                /aside send {n} · /aside edit {n}
              </Text>
            )}
          </Box>
        )
      })

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {controls}
        {cacheLine !== undefined && <Text dimColor>{cacheLine}</Text>}
        {held !== null && (
          <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="warning" paddingX={1}>
            <Text color="warning">{held.why}</Text>
            <Text>Held: {held.question}</Text>
            <Box flexDirection="row" columnGap={1}>
              <Button key="stay" hotkey="y" variant="primary" onPress={() => asked(held.question, { ...held.settings, model: 'session', effort: 'default' })}>
                Ask {held.session} instead
              </Button>
              <Button key="anyway" hotkey="a" onPress={() => asked(held.question, held.settings, true)}>
                Ask {held.model} anyway
              </Button>
              <Button key="drop" hotkey="x" onPress={() => void update($, pending, () => null)}>
                Drop it
              </Button>
            </Box>
          </Box>
        )}
        {list.length === 0 && held === null && <Text dimColor>Nothing asked yet. Nothing here reaches the session unless you send it.</Text>}
        {rows}
      </Box>
    )
  })
}
