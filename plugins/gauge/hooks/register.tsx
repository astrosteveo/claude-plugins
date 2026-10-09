import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, SessionMeasureInput } from 'claude-code'

import type { Day, Measure, Spend, Turn } from '../types'
import * as fmt from './format'

const measure = atom({ plugin: 'gauge', key: 'measure' } as const, null)
const turns = atom({ plugin: 'gauge', key: 'turns' } as const, [])
const warned = atom({ plugin: 'gauge', key: 'warned' } as const, [])
const start = atom({ plugin: 'gauge', key: 'start' } as const, null)
const banked = atom({ plugin: 'gauge', key: 'banked' } as const, 0)

const MAX_TURNS = 100
const DAY_MS = 86_400_000

type Settings = {
  warnTokens: number
  warnPercent: number
  limitPercent: number
  compact: 'off' | 'suggest' | 'auto'
  compactTokens: number
  historyDays: number
}

function settings(options: PluginOptions): Settings {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  const compact = options.compact === 'off' || options.compact === 'auto' ? options.compact : 'suggest'
  const warnTokens = num(options.warnTokens, 200_000)

  return {
    warnTokens,
    warnPercent: num(options.warnPercent, 85),
    limitPercent: num(options.limitPercent, 90),
    compact,
    compactTokens: num(options.compactTokens, 0) || warnTokens,
    historyDays: num(options.historyDays, 90),
  }
}

function toMeasure(e: Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>): Measure {
  return {
    tokens: e.context.tokens,
    window: e.context.window,
    percent: e.context.percent,
    limits: e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    usd: e.cost?.usd,
  }
}

// What each threshold says once the figure passes it, keyed so each crossing
// acts once and a figure that drops back re-arms.
function crossings(m: Measure, s: Settings): Map<string, string> {
  const past = new Map<string, string>()
  if (s.warnTokens > 0 && m.tokens !== undefined && m.tokens >= s.warnTokens) {
    past.set('tokens', `Context passed ${fmt.tokens(s.warnTokens)} tokens: now ${fmt.tokens(m.tokens)}.`)
  }
  if (s.warnPercent > 0 && m.percent !== undefined && m.percent >= s.warnPercent) {
    past.set('percent', `Context is ${Math.round(m.percent)}% full.`)
  }
  if (s.compact !== 'off' && s.compactTokens > 0 && m.tokens !== undefined && m.tokens >= s.compactTokens) {
    past.set(
      'compact',
      s.compact === 'auto'
        ? `Context is ${fmt.tokens(m.tokens)} tokens: compacting.`
        : `Context is ${fmt.tokens(m.tokens)} tokens. Run /compact to free it.`,
    )
  }
  for (const l of m.limits) {
    if (s.limitPercent > 0 && l.percentUsed >= s.limitPercent) {
      past.set(`limit:${l.kind}`, `${fmt.limitName(l.kind)} rate limit is ${Math.round(l.percentUsed)}% used.`)
    }
  }

  return past
}

// Whether a main-loop turn is running, and whether an automatic compaction
// waits for it to end. A reload starts both over, between turns.
let isRunning = false
let isCompactDue = false
// History writes run one after another so none reads a day another is writing.
let writing: Promise<void> = Promise.resolve()

function compactNow($: EngineInterface) {
  isCompactDue = false
  void $.session
    .compact()
    .then(r => {
      if (r.skip !== undefined) $.ui.toast(`Compaction skipped: ${r.skip}`)
    })
    .catch(() => $.ui.toast('Gauge could not compact the conversation.'))
}

function addToday($: EngineInterface, add: Partial<Spend>) {
  writing = writing.then(async () => {
    const project = await $.session.root()
    const key = `day:${fmt.dayKey(await $.clock.now())}`
    const day = ((await $.store.get(key)) ?? {}) as Day
    const was = day[project] ?? { usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }
    const next = { ...was }
    for (const k of Object.keys(add) as (keyof Spend)[]) next[k] += add[k] ?? 0
    await $.store.set(key, { ...day, [project]: next })
  }).catch(() => {})

  return writing
}

async function pruneHistory($: EngineInterface, days: number) {
  const cutoff = fmt.dayKey((await $.clock.now()) - days * DAY_MS)
  for (const key of await $.store.keys()) {
    if (key.startsWith('day:') && key.slice(4) < cutoff) await $.store.delete(key)
  }
}

// The cost the running or last turn added: the session total less the total
// as it started.
async function priceTurn($: EngineInterface, usd: number | undefined) {
  const began = await read($, start)
  if (usd === undefined || began === null) return
  await update($, turns, list =>
    list.map(t => (t.turnId === began.turnId ? { ...t, usd: Math.max(0, usd - began.usd) } : t)),
  )
}


export const register: Register = (on, options) => {
  const s = settings(options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      await $.command.register({
        name: 'gauge',
        description: 'Context, cost and rate limits; /gauge context for the breakdown, /gauge history for spend by day',
      })
    } catch {
      // A clash with another command leaves the footer and toasts working.
    }
    const usage = await $.session.usage()
    const m = toMeasure(usage)
    await update($, measure, () => m)
    // A new session banks from the cost it starts at, so a resumed session's
    // earlier spend is not counted twice. A reload keeps what it banked.
    const { version } = await $.state.get({ plugin: 'gauge', key: 'banked' })
    if (version === 0) await update($, banked, () => m.usd ?? 0)
    // The figures draw in the footer; clear the notice an earlier version pinned.
    $.ui.status(undefined)
    await pruneHistory($, s.historyDays).catch(() => {})

    return result
  })

  on('turn.start', async ($, e, next) => {
    isRunning = true
    const m = await read($, measure)
    const usd = m?.usd ?? (await $.session.usage()).cost?.usd
    await update($, start, () => (usd === undefined ? null : { turnId: e.turnId, usd }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const u = e.usage
    if (u !== undefined) {
      void addToday($, {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
        turns: e.agentId === undefined ? 1 : 0,
      })
    }
    if (e.agentId !== undefined) return result

    isRunning = false
    const turn: Turn = {
      turnId: e.turnId,
      at: (await $.clock.now()) - e.durationMs,
      model: u?.model ?? 'unknown',
      input: u?.input_tokens ?? 0,
      cacheRead: u?.cache_read_input_tokens ?? 0,
      cacheWrite: u?.cache_creation_input_tokens ?? 0,
      output: u?.output_tokens ?? 0,
      ms: e.durationMs,
      isAborted: e.isAborted,
    }
    await update($, turns, list => [...list.filter(t => t.turnId !== turn.turnId), turn].slice(-MAX_TURNS))
    // A measurement that came before the turn's end already holds its cost.
    await priceTurn($, (await read($, measure))?.usd)
    if (isCompactDue) compactNow($)

    return result
  })

  on('session.measure', async ($, e, next) => {
    const m = toMeasure(e)
    await update($, measure, () => m)

    if (e.changed.includes('cost') && m.usd !== undefined) {
      await priceTurn($, m.usd)
      const was = await read($, banked)
      // A total below what was banked is a ledger that started over.
      const added = m.usd >= was ? m.usd - was : m.usd
      await update($, banked, () => m.usd ?? 0)
      if (added > 0) void addToday($, { usd: added })
    }

    const past = crossings(m, s)
    const before = new Set(await read($, warned))
    const fresh = [...past.keys()].filter(k => !before.has(k))
    // The compact notice names the tokens already: one toast, not two.
    const shown = fresh.includes('compact') ? fresh.filter(k => k !== 'tokens') : fresh
    for (const key of shown) $.ui.toast(past.get(key) ?? '')
    await update($, warned, () => [...past.keys()])
    if (fresh.includes('compact') && s.compact === 'auto') {
      if (isRunning) isCompactDue = true
      else compactNow($)
    }

    return next(e)
  })

  // The figures at the right of the footer, beside the engine's mode labels:
  // dim, yellow past a warning threshold, red nearly full.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const m = await read($, measure)
    const parts = m === null ? [] : fmt.statusParts(m, s)
    if (parts.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const modes = e.props.modes.join(' & ')

    return (
      <Box>
        {modes !== '' && <Text dimColor>{modes} · </Text>}
        {parts.flatMap((p, i) => [
          ...(i > 0 ? [<Text dimColor> · </Text>] : []),
          p.level === 'ok' ? <Text dimColor>{p.text}</Text> : <Text color={p.level === 'high' ? 'error' : 'warning'}>{p.text}</Text>,
        ])}
      </Box>
    )
  })

  on('command.run', { command: 'gauge' }, async ($, e) => {
    const [what = '', detail = ''] = e.args.trim().split(/\s+/)

    if (what === 'context') {
      const usage = await $.session.usage({
        breakdown: detail === 'full' ? 'full' : 'summary',
        columns: e.presentation.columns,
      })
      const b = usage.context.breakdown
      if (b === undefined) return { text: 'No context breakdown is available in this session.' }

      return { text: fmt.breakdown(b.categories, b.totalTokens, b.rawMaxTokens) }
    }

    if (what === 'history') {
      await writing
      const days: [string, Day][] = []
      const today = await $.clock.now()
      for (let i = 0; i < 14; i++) {
        const key = fmt.dayKey(today - i * DAY_MS)
        const day = (await $.store.get(`day:${key}`)) as Day | undefined
        if (day !== undefined) days.push([key, day])
      }

      return { text: fmt.history(days) }
    }

    if (what !== '') return { text: 'Usage: /gauge, /gauge context [full], /gauge history' }

    const m = await read($, measure)
    const list = await read($, turns)

    return { text: `${fmt.summary(m)}\n\n${fmt.turnTable(list.slice(-20), await $.clock.now())}` }
  })
}
