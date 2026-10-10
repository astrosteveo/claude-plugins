import type { Spent, Ttl } from '../types'

// List prices on the Claude API in US dollars per million tokens: uncached
// input, output and a cache read. A cache write is input times WRITE.
export type Price = { input: number; output: number; read: number }

export type Model = {
  id: string
  name: string
  family: string
  price: Price
  // A price that takes over once a request's prompt passes `at` tokens.
  over?: { at: number; price: Price }
  // The shortest prefix the API caches.
  minCache: number
}

const FABLE_51 = { input: 10, output: 50, read: 0.25 }
const FABLE = { input: 10, output: 50, read: 1 }
const OPUS_55 = { input: 4, output: 20, read: 0.2 }
const OPUS = { input: 5, output: 25, read: 0.5 }
const SONNET_5 = { input: 2, output: 10, read: 0.2 }
const SONNET_4 = { input: 3, output: 15, read: 0.3 }

// Newest first within each family, so an alias resolves to its first entry.
const MODELS: Model[] = [
  { id: 'claude-fable-5-1', name: 'Fable 5.1', family: 'fable', price: FABLE_51, minCache: 512 },
  { id: 'claude-fable-5', name: 'Fable 5', family: 'fable', price: FABLE, minCache: 512 },
  { id: 'claude-mythos-5-1', name: 'Mythos 5.1', family: 'mythos', price: FABLE_51, minCache: 512 },
  { id: 'claude-mythos-5', name: 'Mythos 5', family: 'mythos', price: FABLE, minCache: 512 },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', family: 'opus', price: OPUS_55, minCache: 512 },
  { id: 'claude-opus-5', name: 'Opus 5', family: 'opus', price: OPUS, minCache: 512 },
  { id: 'claude-opus-4-8', name: 'Opus 4.8', family: 'opus', price: OPUS, minCache: 1024 },
  { id: 'claude-opus-4-7', name: 'Opus 4.7', family: 'opus', price: OPUS, minCache: 2048 },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', family: 'opus', price: OPUS, minCache: 4096 },
  { id: 'claude-opus-4-5', name: 'Opus 4.5', family: 'opus', price: OPUS, minCache: 4096 },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', family: 'sonnet', price: SONNET_5, minCache: 512 },
  { id: 'claude-sonnet-5', name: 'Sonnet 5', family: 'sonnet', price: SONNET_5, minCache: 1024 },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', family: 'sonnet', price: SONNET_4, minCache: 1024 },
  { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', family: 'sonnet', price: SONNET_4, minCache: 1024 },
  {
    id: 'claude-haiku-5-5',
    name: 'Haiku 5.5',
    family: 'haiku',
    price: { input: 0.1, output: 0.5, read: 0.01 },
    over: { at: 100_000, price: { input: 0.5, output: 2.5, read: 0.05 } },
    minCache: 512,
  },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', family: 'haiku', price: { input: 1, output: 5, read: 0.1 }, minCache: 4096 },
]

const WRITE: Record<Ttl, number> = { '5m': 1.25, '1h': 2 }
export const TTL_MS: Record<Ttl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

// The model a name means: a full id (any provider prefix, date or context
// suffix), a display name, or a bare alias, which means the family's newest.
// Undefined for a name of no family it knows.
export function resolve(name: string): Model | undefined {
  const m = /(fable|mythos|opus|sonnet|haiku)(?:[-_ ]?(\d)(?:[-._](\d)(?!\d))?)?/i.exec(name)
  if (m === null) return undefined
  const family = (m[1] ?? '').toLowerCase()
  const inFamily = MODELS.filter(x => x.family === family)
  if (m[2] === undefined) return inFamily[0]
  const id = `claude-${family}-${m[2]}${m[3] === undefined ? '' : `-${m[3]}`}`

  return inFamily.find(x => x.id === id) ?? inFamily[0]
}

function priceAt(model: Model, promptTokens: number): Price {
  return model.over !== undefined && promptTokens > model.over.at ? model.over.price : model.price
}

// What a request cost: its four token counts at the model's prices, cache
// writes at the given lifetime's rate.
export function usd(model: Model, t: Spent, ttl: Ttl = '5m'): number {
  const p = priceAt(model, t.input + t.read + t.write)

  return (t.input * p.input + t.read * p.read + t.write * p.input * WRITE[ttl] + t.output * p.output) / 1e6
}

// What an answer is assumed to run to, for the estimate; thinking included.
export const ANSWER_TOKENS = 1_500
// What a fresh subagent's own system prompt and tool list come to.
export const AGENT_OVERHEAD = 10_000
// The aside's own instructions on a request of its own.
export const SYSTEM_TOKENS = 300

// The figures an estimate reads.
export type Situation = {
  session: Model
  // What the main thread's last request carried, and whether its cache is
  // likely still held.
  contextTokens: number
  isMainWarm: boolean
  ttl: Ttl
  // The conversation as a transcript for another model, and how much of it
  // each model's cache likely holds now, by model id.
  transcriptTokens: number
  cached: Record<string, number>
  // The question and the side thread it carries.
  askTokens: number
  // Real tokens per estimated one, as earlier answers on each model counted
  // them, by model id; `*` across models. A model with no count uses `*`.
  scale: Record<string, number>
  // How long each model's answers have run, in output tokens, by model id.
  answers: Record<string, number>
  // What subagent runs cost against their first-request estimate, by
  // `<route>:<model id>`, and by route across models.
  runs: Record<string, number>
}

export function runFactor(s: Pick<Situation, 'runs'>, route: string, id: string): number {
  return s.runs[`${route}:${id}`] ?? s.runs[route] ?? 1
}

// Folds one subagent run's cost, against what was estimated with the factor
// then in force, into the factor for its route and model.
export function rerun(runs: Record<string, number>, route: string, id: string, actual: number, estimated: number): Record<string, number> {
  if (actual <= 0 || estimated <= 0) return runs
  const used = runFactor({ runs }, route, id)
  const target = Math.min(5, Math.max(0.5, (used * actual) / estimated))
  const fold = (was: number | undefined) => (was === undefined ? target : (was + target) / 2)

  return { ...runs, [`${route}:${id}`]: fold(runs[`${route}:${id}`]), [route]: fold(runs[route]) }
}

// Folds one answer's length into a model's running figure.
export function lengthen(answers: Record<string, number>, id: string, output: number): Record<string, number> {
  if (output <= 0) return answers
  const was = answers[id]

  return { ...answers, [id]: was === undefined ? output : Math.round((was + output) / 2) }
}

export function scaleFor(s: Pick<Situation, 'scale'>, id: string): number {
  return s.scale[id] ?? s.scale['*'] ?? 1
}

// Folds one answer's count of real against estimated tokens into the scale.
export function rescale(scale: Record<string, number>, id: string, actual: number, estimated: number): Record<string, number> {
  if (actual <= 0 || estimated <= 0) return scale
  const ratio = Math.min(3, Math.max(0.5, actual / estimated))
  const fold = (was: number | undefined) => (was === undefined ? ratio : (was + ratio) / 2)

  return { ...scale, [id]: fold(scale[id]), '*': fold(scale['*']) }
}

export type Plan = { route: 'fork' | 'model' | 'fork-agent' | 'agent'; model: Model }

// The estimated cost of one aside before it is asked. A subagent's is its
// first request scaled by what earlier runs on its route and model cost
// against theirs, which takes in its tool calls once it has run before.
export function estimate(plan: Plan, s: Situation): number {
  const first = request(plan, s)

  return plan.route === 'agent' || plan.route === 'fork-agent' ? first * runFactor(s, plan.route, plan.model.id) : first
}

function request(plan: Plan, s: Situation): number {
  const output = s.answers[plan.model.id] ?? ANSWER_TOKENS
  if (plan.route === 'fork' || plan.route === 'fork-agent') {
    const prefix = s.contextTokens
    const t = s.isMainWarm
      ? { input: s.askTokens, read: prefix, write: 0, output }
      : { input: s.askTokens, read: 0, write: prefix, output }

    return usd(plan.model, t, s.ttl)
  }
  const k = scaleFor(s, plan.model.id)
  const overhead = plan.route === 'agent' ? AGENT_OVERHEAD : SYSTEM_TOKENS
  const prefix = overhead + s.transcriptTokens * k
  const input = s.askTokens * k
  if (prefix < plan.model.minCache) return usd(plan.model, { input: prefix + input, read: 0, write: 0, output })
  const read = plan.route === 'model' ? Math.min((s.cached[plan.model.id] ?? 0) * k, prefix) : 0

  return usd(plan.model, { input, read, write: prefix - read, output })
}

// Under a tenth of a cent reads as such; under ten cents to the tenth of a
// cent, since that is where asides differ; dollars to the cent past that.
export function money(x: number): string {
  if (x < 0.001) return '<$0.001'
  if (x < 0.1) return `$${x.toFixed(3)}`

  return `$${x.toFixed(2)}`
}

export function tokens(n: number): string {
  if (n < 1_000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// Why an aside on `model` costs more than the session's own model would,
// in a sentence for the person, or undefined when it does not.
export function warning(plan: Plan, mine: number, stay: number, s: Situation): string | undefined {
  if (mine <= stay * 1.05 || mine - stay < 0.001) return undefined
  const how = plan.route === 'agent' ? 'a fresh subagent' : 'a request of its own'
  const cold = plan.route === 'model' && (s.cached[plan.model.id] ?? 0) > 0 ? '' : ' cold'
  const own = plan.model.id === s.session.id ? `${plan.model.name} at another effort` : plan.model.name
  const read = tokens(s.transcriptTokens * scaleFor(s, plan.model.id))
  const context = `its whole ${tokens(s.contextTokens)}-token context`
  const stays = s.isMainWarm ? `reads ${context} from cache` : `would re-cache ${context}`

  return (
    `${own} costs about ${money(mine)}: ${how} reads ${read} tokens of this conversation${cold}. ` +
    `${s.session.name}, the session's model, ${stays} for about ${money(stay)}.`
  )
}
