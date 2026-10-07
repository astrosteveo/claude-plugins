// What the board costs while it runs, for /issues stats: the GitHub calls it makes, the GraphQL points they spend, and
// the characters it adds to Claude's context. The counts live in memory and start over when the plugin loads.

// Per-hour rates show only after this long. Scaled up from a few seconds, a handful of calls reads as hundreds an hour.
export const RATE_AFTER = 10 * 60_000

// How GitHub counts a call. A REST call answered 304, nothing changed, costs nothing against the rate limit.
export type CallKind = 'rest' | 'rest304' | 'graphql'
// Why the board made a call. A write is any call that changes GitHub, unless a tool or setup made it.
export type Cause = 'poll' | 'full read' | 'write' | 'tool' | 'setup' | 'other'
// Where the text the board adds to Claude's context comes from.
export type ContextSource =
  | 'tool definitions'
  | 'agent type'
  | 'tool results'
  | 'working note'
  | 'orchestrator note'
  | 'issue copies'
  | 'moved lines'
  | 'news'
  | 'task note'
  | 'start prompts'
  | 'hand-offs'
  | 'other prompts'

export type Tally = Record<CallKind, number>

// One of the board's tools: the size of its name, description and schema, and whether that text is in Claude's
// context yet. Claude Code defers the board's tools, so only their names are listed until Claude loads one.
export type ToolDefinition = { characters: number; loaded: boolean }

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
  // The board's tools by the name Claude calls them.
  tools: Record<string, ToolDefinition>
  // The prompts Claude received, the person's and the board's own.
  prompts: number
}

export const CAUSES: readonly Cause[] = ['full read', 'poll', 'write', 'tool', 'setup', 'other']

export const newStats = (startedAt: number): Stats => ({ startedAt, calls: {}, points: 0, remaining: null, resetAt: null, context: {}, lastRead: null, tools: {}, prompts: 0 })

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

// A tool the board registered. Its text counts as context only once it is loaded.
export const defineTool = (stats: Stats, name: string, characters: number): void => {
  stats.tools[name] = { characters, loaded: stats.tools[name]?.loaded ?? false }
}

// A tool's definition went into Claude's context: listed in the prompt, found through ToolSearch, or called. It
// counts once, though a new conversation may need it loaded again.
export const loadTool = (stats: Stats, name: string): void => {
  const tool = stats.tools[name]
  if (!tool || tool.loaded) return
  tool.loaded = true
  countContext(stats, 'tool definitions', tool.characters)
}

// The tools a ToolSearch call loaded, from its result's `matches`.
export const matchesOf = (result: unknown): string[] => {
  const matches = (result as { matches?: unknown } | null | undefined)?.matches
  return Array.isArray(matches) ? matches.filter((one): one is string => typeof one === 'string') : []
}

export const countPrompt = (stats: Stats): void => {
  stats.prompts += 1
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

// A count per hour over the time since the counts began, or nothing before RATE_AFTER.
const hourly = (count: number, elapsed: number): string[] => {
  if (elapsed < RATE_AFTER) return []
  const rate = (count * 3_600_000) / elapsed
  return [`${rate > 0 && rate < 10 ? rate.toFixed(1) : grouped(Math.round(rate))} an hour`]
}

const plural = (count: number, one: string): string => `${grouped(count)} ${one}${count === 1 ? '' : 's'}`

const ago = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export const tallyText = (tally: Tally): string => `REST ${tally.rest}, REST 304 ${tally.rest304}, GraphQL ${tally.graphql}`

// What the board's tools take: all of them, and those loaded into Claude's context so far.
export const toolsText = (stats: Stats): string => {
  const tools = Object.values(stats.tools)
  if (tools.length === 0) return 'Tool definitions: none registered.'
  const all = tools.reduce((sum, one) => sum + one.characters, 0)
  const loaded = tools.filter(one => one.loaded)
  const inContext = loaded.reduce((sum, one) => sum + one.characters, 0)
  const sofar = loaded.length === 0 ? 'none loaded yet' : `${loaded.length} loaded so far, ${grouped(inContext)} characters, counted in context added`
  return `Tool definitions: ${grouped(all)} characters for ${plural(tools.length, 'tool')}, loaded when a tool is first used; ${sofar}.`
}

// /issues stats: calls, points and context since the counts began, per hour once the board has run RATE_AFTER, and
// for the last full read. Context is also per prompt, which doesn't swell in the first minutes.
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
  const perPrompt = stats.prompts > 0 ? [`${grouped(Math.round(characters / stats.prompts))} a prompt over ${plural(stats.prompts, 'prompt')}`] : []
  const last = stats.lastRead
  return [
    `What the issue board cost since it loaded ${ago(elapsed)} ago.`,
    ...(elapsed < RATE_AFTER ? [`Per-hour rates show once it has been loaded ${RATE_AFTER / 60_000} minutes.`] : []),
    '',
    `GitHub calls: ${[grouped(calls), ...hourly(calls, elapsed)].join(', ')} (${tallyText(total)})`,
    ...causes,
    `GraphQL points: ${[grouped(stats.points), ...hourly(stats.points, elapsed)].join(', ')}.${left}`,
    `Context added: ${[`${grouped(characters)} characters`, ...perPrompt, ...hourly(characters, elapsed)].join(', ')}`,
    ...sources,
    toolsText(stats),
    last ? `Last full read, ${ago(Math.max(0, now - last.at))} ago: ${tallyText(last.calls)}; ${grouped(last.points)} points.` : 'No full read has finished yet.',
  ].join('\n')
}
