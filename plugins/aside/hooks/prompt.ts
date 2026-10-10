import type { SessionMessage } from 'claude-code'

import type { CacheTrack, Choice, Effort, Exchange } from '../types'

// A token is taken as 3.5 characters: code and prose sit either side of it.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

const RESULT_CHARS = 2_000
const INPUT_CHARS = 300

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more characters)`
}

// One message of the conversation as transcript text. A tool's result is
// drawn under its call, so a user message that only carries results draws
// nothing. The same message always draws the same text, which is what keeps
// a cached transcript's prefix stable.
export function renderMessage(m: SessionMessage): string {
  if (m.role === 'user') {
    const text = m.text.trim()

    return text === '' ? '' : `## Person\n${text}\n`
  }
  const parts = m.text.trim() === '' ? [] : [m.text.trim()]
  for (const use of m.toolUses) {
    parts.push(`[${use.tool}] ${clip(JSON.stringify(use.input), INPUT_CHARS)}`)
    if (use.text !== undefined) parts.push(`${use.isError ? '(error) ' : ''}${clip(use.text.trim(), RESULT_CHARS)}`)
  }

  return parts.length === 0 ? '' : `## Claude\n${parts.join('\n')}\n`
}

// 32-bit FNV-1a: enough to tell a transcript prefix that changed under a
// compaction from one that did not.
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }

  return h >>> 0
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const span = (rendered: string[], a: number, b: number) => rendered.slice(a, b).join('\n')

// Past this many stretches a transcript starts over as one.
const MAX_STRETCHES = 24

// The transcript cut into stretches for one model's request. Each earlier
// request on the model ended its transcript at an anchor; the stretches run
// between them, then on to the newest message. The request marks the last two
// for the cache: the first ends where the previous request's cache entry
// ended, so it is read, and the second is written for the next. `track` is
// what the next request should remember.
export type Transcript = { stretches: string[]; tokens: number; track: CacheTrack; isFresh: boolean }

export function transcript(rendered: string[], maxTokens: number, was: CacheTrack | undefined, now: number): Transcript {
  const count = rendered.length
  const sizes = rendered.map(estimateTokens)
  let from = 0
  for (let i = count - 1, total = 0; i >= 0; i--) {
    total += sizes[i] ?? 0
    if (total > maxTokens) {
      from = i + 1
      break
    }
  }

  // An earlier track holds while its text is unchanged (no compaction, no
  // clear) and the conversation since has not outgrown the room by a quarter.
  const last = was?.anchors.at(-1)
  const holds =
    was !== undefined &&
    last !== undefined &&
    last <= count &&
    was.anchors.length < MAX_STRETCHES &&
    sum(sizes.slice(was.from)) <= maxTokens * 1.25 &&
    hash(span(rendered, was.from, last)) === was.hash
  const start = holds ? was.from : from
  const anchors = holds ? was.anchors : []
  const edges = [start, ...anchors.filter(a => a < count), count]
  const stretches: string[] = []
  for (let i = 0; i < edges.length - 1; i++) stretches.push(span(rendered, edges[i] ?? 0, edges[i + 1] ?? count))
  const next = anchors.at(-1) === count ? anchors : [...anchors, count]

  return {
    stretches,
    tokens: sum(sizes.slice(start)),
    track: { from: start, anchors: next, hash: hash(span(rendered, start, count)), at: now },
    isFresh: !holds,
  }
}

// How much of the transcript a model's cache likely holds now: what its last
// request covered, for the five minutes such an entry lives.
export function cachedTokens(rendered: string[], track: CacheTrack | undefined, now: number): number {
  const last = track?.anchors.at(-1)
  if (track === undefined || last === undefined || now - track.at > 5 * 60_000) return 0
  if (last > rendered.length || hash(span(rendered, track.from, last)) !== track.hash) return 0

  return sum(rendered.slice(track.from, last).map(estimateTokens))
}

const ROLE = `You are answering a side question the person asked about their Claude Code session. \
This is a separate thread: your answer goes to a side pane, the session's main conversation never sees it, \
and nothing you say changes what the session does next. Answer as an advisor: give your own judgment and \
concrete recommendations, say plainly where you disagree with the direction the session is taking, and keep it \
as short as the question allows.`

const NO_TOOLS = `You cannot use tools here: answer from what the conversation already shows, and name what you \
would need to check where it matters.`

const TOOLS = `You may read files, search the code and the web, and run read-only commands to check things \
before you answer. Change nothing: no edits, no writes, no commands that alter files, git state or anything else. \
Your final message is your answer, written to the person.`

export const SYSTEM = `${ROLE}\n\n${NO_TOOLS}`
export const AGENT_SYSTEM = `${ROLE}\n\n${TOOLS}`

// The earlier exchanges a question carries, oldest first.
export function threadText(thread: Exchange[], turns: number): string {
  const done = turns <= 0 ? [] : thread.filter(x => x.status === 'done' && x.answer !== undefined).slice(-turns)
  if (done.length === 0) return ''
  const rows = done.map(x => `Q: ${x.question}\nA: ${clip(x.answer ?? '', 4_000)}`)

  return `Earlier questions in this side thread, oldest first:\n\n${rows.join('\n\n')}\n\n`
}

// The question as a fork reads it, after the session's own conversation.
export function forkPrompt(thread: string, question: string, tools: boolean): string {
  return `<aside>\n${ROLE}\n\n${tools ? TOOLS : NO_TOOLS}\n\n${thread}The question:\n${question}\n</aside>`
}

// The opening of a request of the aside's own, ahead of the transcript.
export const TRANSCRIPT_HEAD = 'The session so far, as a transcript (tool results cut short):\n\n'

export function askText(thread: string, question: string): string {
  return `\n\n${thread}The question:\n${question}`
}

// What `/aside` was asked to do.
export type Command =
  | { kind: 'open' }
  | { kind: 'ask'; question: string; model?: Choice; effort?: Effort; tools?: boolean }
  | { kind: 'send'; index?: number }
  | { kind: 'edit'; index?: number }
  | { kind: 'clear' }
  | { kind: 'model'; model: Choice }
  | { kind: 'effort'; effort: Effort }
  | { kind: 'tools'; tools: boolean }
  | { kind: 'error'; text: string }

export const CHOICES: readonly Choice[] = ['session', 'fable', 'opus', 'sonnet', 'haiku']
export const EFFORTS: readonly Effort[] = ['default', 'low', 'medium', 'high', 'xhigh', 'max']

const isChoice = (v: string): v is Choice => (CHOICES as readonly string[]).includes(v)
const isEffort = (v: string): v is Effort => (EFFORTS as readonly string[]).includes(v)
const noModel = (v: string): Command => ({ kind: 'error', text: `No model "${v}": ${CHOICES.join(', ')}.` })
const noEffort = (v: string): Command => ({ kind: 'error', text: `No effort "${v}": ${EFFORTS.join(', ')}.` })

export function parse(args: string): Command {
  const text = args.trim()
  if (text === '') return { kind: 'open' }
  const sub = /^(send|edit)(?:\s+(\d+))?$/.exec(text)
  if (sub !== null) return { kind: sub[1] === 'send' ? 'send' : 'edit', index: sub[2] === undefined ? undefined : Number(sub[2]) }
  if (text === 'clear') return { kind: 'clear' }
  const set = /^(model|effort|tools)\s+(\S+)$/.exec(text)
  if (set !== null) {
    const key = set[1]
    const value = set[2] ?? ''
    if (key === 'model') return isChoice(value) ? { kind: 'model', model: value } : noModel(value)
    if (key === 'effort') return isEffort(value) ? { kind: 'effort', effort: value } : noEffort(value)
    if (value === 'on' || value === 'off') return { kind: 'tools', tools: value === 'on' }

    return { kind: 'error', text: 'Tools are on or off.' }
  }

  // Flags lead the question: -m <model>, -e <effort>, -t (tools), -T (no
  // tools). The question after them keeps its own spacing and lines.
  const ask: Extract<Command, { kind: 'ask' }> = { kind: 'ask', question: '' }
  let rest = text
  for (;;) {
    const valued = /^(-m|--model|-e|--effort)\s+(\S+)(?:\s+|$)/.exec(rest)
    const bare = /^(-t|--tools|-T|--no-tools)(?:\s+|$)/.exec(rest)
    if (valued !== null) {
      const flag = valued[1]
      const value = valued[2] ?? ''
      if (flag === '-m' || flag === '--model') {
        if (!isChoice(value)) return noModel(value)
        ask.model = value
      } else {
        if (!isEffort(value)) return noEffort(value)
        ask.effort = value
      }
      rest = rest.slice(valued[0].length)
    } else if (bare !== null) {
      ask.tools = bare[1] === '-t' || bare[1] === '--tools'
      rest = rest.slice(bare[0].length)
    } else break
  }
  ask.question = rest.trim()

  return ask.question === '' ? { kind: 'error', text: 'Ask a question after the flags.' } : ask
}

// Shell commands that only read, each with the arguments that would make it
// write or run something else. Anything not listed is refused.
const READERS: Record<string, RegExp | null> = {
  cat: null, head: null, tail: null, wc: null, ls: null, pwd: null, file: null, stat: null, du: null, df: null,
  echo: null, printf: null, grep: null, egrep: null, ag: null, which: null, type: null, basename: null,
  dirname: null, realpath: null, readlink: null, cut: null, tr: null, column: null, diff: null, cmp: null,
  jq: null, nl: null, od: null, hexdump: null, strings: null, sha256sum: null, md5sum: null, ps: null,
  tree: /^-o$/,
  sort: /^(-o|--output)/,
  rg: /^--pre/,
  fd: /^(-x|-X|--exec|--exec-batch)$/,
  find: /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/,
  awk: /system|getline/,
  uniq: null,
  sed: null,
  git: null,
}
const GIT_READERS = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'branch', 'tag', 'rev-parse', 'ls-files', 'ls-tree', 'shortlog',
  'describe', 'grep', 'remote', 'reflog', 'cat-file', 'merge-base', 'name-rev', 'config',
])

const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2')

function readsOnly(name: string, args: string[]): boolean {
  if (!(name in READERS)) return false
  const deny = READERS[name]
  if (deny !== null && deny !== undefined && args.some(a => deny.test(a))) return false
  const positional = args.filter(a => !a.startsWith('-'))
  // uniq writes its second operand; sed reads only as -n with line ranges.
  if (name === 'uniq') return positional.length <= 1
  if (name === 'sed') return args.includes('-n') && positional.length >= 1 && /^[0-9,$]+p$/.test(unquote(positional[0] ?? ''))
  if (name === 'git') {
    const verb = positional[0]
    if (verb === undefined || !GIT_READERS.has(verb)) return false
    if (args.some(a => /^--output|^-O$|^--open-files-in-pager|^--ext-diff/.test(a))) return false
    if (verb === 'config') return args.some(a => a === '--list' || a === '-l' || a.startsWith('--get'))
    if (verb === 'branch' || verb === 'tag' || verb === 'remote') {
      return args.every(a => a === verb || /^-(v|vv|a|r|l|-list|-all|-verbose|-show-current|-contains|-merged|-no-merged)$/.test(a))
    }
  }

  return true
}

export function isReadOnlyCommand(command: string): boolean {
  // No redirection, substitution, background jobs, sequencing or subshells,
  // quoted or not; only plain pipes between readers.
  if (/[<>`;&(){}\n\\]/.test(command)) return false
  for (const segment of command.split('|')) {
    const [name, ...args] = segment.trim().split(/\s+/)
    if (name === undefined || !readsOnly(name, args)) return false
  }

  return true
}

// The tools an aside's subagent may call; Bash only for read-only commands.
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch', 'LSP', 'NotebookRead', 'TodoWrite'])

// Why an aside's subagent may not make this call, or undefined when it may.
export function refusal(tool: string, input: unknown): string | undefined {
  if (READ_TOOLS.has(tool)) return undefined
  if (tool === 'Bash') {
    const command = (input as { command?: unknown } | null)?.command

    return typeof command === 'string' && isReadOnlyCommand(command)
      ? undefined
      : 'An aside only runs read-only commands: no writes, redirection, chaining or substitution.'
  }

  return `An aside only reads: ${tool} is not one of its tools.`
}
