// What the board costs while it runs, for /issues stats: the GitHub calls it makes, the GraphQL points they spend, and
// the characters it adds to Claude's context. The counts live in memory and start over when the plugin loads.

// How GitHub counts a call. A REST call answered 304, nothing changed, costs nothing against the rate limit.
export type CallKind = 'rest' | 'rest304' | 'graphql'
// Why the board made a call. A write is any call that changes GitHub, unless a tool or setup made it.
export type Cause = 'poll' | 'full read' | 'write' | 'tool' | 'setup' | 'other'
// Where the text the board adds to Claude's context comes from.
export type ContextSource =
  | 'tool definitions'
  | 'tool results'
  | 'working note'
  | 'orchestrator note'
  | 'capture note'
  | 'issue copies'
  | 'moved lines'
  | 'news'
  | 'task note'
  | 'start prompts'
  | 'hand-offs'
  | 'other prompts'

export type Tally = Record<CallKind, number>

export type Stats = {
  startedAt: number
  calls: Partial<Record<Cause, Tally>>
  points: number
  // What GitHub last said is left of the GraphQL limit, and when it resets, as an ISO time.
  remaining: number | null
  resetAt: string | null
  context: Partial<Record<ContextSource, number>>
  // The calls and points of the last full read that finished.
  lastRead: { at: number; calls: Tally; points: number } | null
}

export const CAUSES: readonly Cause[] = ['full read', 'poll', 'write', 'tool', 'setup', 'other']

export const newStats = (startedAt: number): Stats => ({ startedAt, calls: {}, points: 0, remaining: null, resetAt: null, context: {}, lastRead: null })

const zero = (): Tally => ({ rest: 0, rest304: 0, graphql: 0 })

// How GitHub counts one gh command. `gh api` is REST unless it calls graphql. gh's issue, pr and repo view commands,
// and `label list`, ask GraphQL; `label create`, `repo edit`, `run` and `auth` use REST. One command counts as one call,
// though gh may make more than one request for it.
export const kindOf = (args: readonly string[]): 'rest' | 'graphql' => {
  const [command, sub] = args
  if (command === 'api') return args.includes('graphql') ? 'graphql' : 'rest'
  if (command === 'auth' || command === 'run') return 'rest'
  if (command === 'label') return sub === 'list' ? 'graphql' : 'rest'
  if (command === 'repo') return sub === 'edit' ? 'rest' : 'graphql'
  return 'graphql'
}

export const countCall = (stats: Stats, cause: Cause, kind: CallKind): void => {
  const tally = (stats.calls[cause] ??= zero())
  tally[kind] += 1
}

export const countContext = (stats: Stats, source: ContextSource, characters: number): void => {
  if (characters <= 0) return
  stats.context[source] = (stats.context[source] ?? 0) + characters
}

// A page of the issues query: what its `rateLimit` cost, and what is left.
export const countPoints = (stats: Stats, limit: { cost: number; remaining: number; resetAt: string }): void => {
  stats.points += limit.cost
  stats.remaining = limit.remaining
  stats.resetAt = limit.resetAt
}

export const sumOf = (tallies: readonly (Tally | undefined)[]): Tally =>
  tallies.reduce<Tally>((sum, one) => ({ rest: sum.rest + (one?.rest ?? 0), rest304: sum.rest304 + (one?.rest304 ?? 0), graphql: sum.graphql + (one?.graphql ?? 0) }), zero())

export const totalOf = (stats: Stats): Tally => sumOf(Object.values(stats.calls))

export const minus = (after: Tally, before: Tally): Tally => ({ rest: after.rest - before.rest, rest304: after.rest304 - before.rest304, graphql: after.graphql - before.graphql })

const callsOf = (tally: Tally): number => tally.rest + tally.rest304 + tally.graphql

const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// A count per hour over the time since the counts began, a minute at least so the first moments don't swell it.
const hourly = (count: number, elapsed: number): string => {
  const rate = (count * 3_600_000) / Math.max(elapsed, 60_000)
  return rate > 0 && rate < 10 ? rate.toFixed(1) : grouped(Math.round(rate))
}

const ago = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export const tallyText = (tally: Tally): string => `REST ${tally.rest}, REST 304 ${tally.rest304}, GraphQL ${tally.graphql}`

// /issues stats: calls, points and context since the counts began, per hour, and for the last full read.
export const statsText = (stats: Stats, now: number): string => {
  const elapsed = Math.max(0, now - stats.startedAt)
  const total = totalOf(stats)
  const calls = callsOf(total)
  const characters = Object.values(stats.context).reduce((sum, one) => sum + (one ?? 0), 0)
  const causes = CAUSES.flatMap(cause => {
    const tally = stats.calls[cause]
    return tally && callsOf(tally) > 0 ? [`- ${cause}: ${tallyText(tally)}`] : []
  })
  const sources = (Object.entries(stats.context) as [ContextSource, number][]).sort((a, b) => b[1] - a[1]).map(([source, count]) => `- ${source}: ${grouped(count)}`)
  const left = stats.remaining !== null && stats.resetAt ? ` ${grouped(stats.remaining)} left until ${new Date(stats.resetAt).toTimeString().slice(0, 5)}.` : ''
  const last = stats.lastRead
  return [
    `What the issue board cost since it loaded ${ago(elapsed)} ago.`,
    '',
    `GitHub calls: ${grouped(calls)}, ${hourly(calls, elapsed)} an hour (${tallyText(total)})`,
    ...causes,
    `GraphQL points: ${grouped(stats.points)}, ${hourly(stats.points, elapsed)} an hour.${left}`,
    `Context added: ${grouped(characters)} characters, ${hourly(characters, elapsed)} an hour`,
    ...sources,
    last ? `Last full read, ${ago(Math.max(0, now - last.at))} ago: ${tallyText(last.calls)}; ${grouped(last.points)} points.` : 'No full read has finished yet.',
  ].join('\n')
}
