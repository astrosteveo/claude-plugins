import type { Kind, Segment } from '../types'
import { COLOR, DEFAULT, stripOf } from './paint'
import type { Cell } from './paint'

// The most rows the pane's map takes. Past this, turns share cells as the
// band's do.
export const MAP_ROWS = 6

const BLANK: Cell = { glyph: 0x20, fg: DEFAULT, bg: DEFAULT }

// The band's strip, wrapped into rows of the pane's width, the last row
// padded so the Raster is a full rectangle.
export const gridOf = (turns: Segment[], width: number): { columns: number; rows: number; cells: Cell[] } => {
  const columns = Math.max(1, width)
  const cells = stripOf(turns, columns * MAP_ROWS)
  if (cells.length <= columns) return { columns: Math.max(1, cells.length), rows: 1, cells }
  const rows = Math.ceil(cells.length / columns)
  return { columns, rows, cells: [...cells, ...new Array<Cell>(rows * columns - cells.length).fill(BLANK)] }
}

export const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

export const KIND_LABEL: Record<Kind, string> = {
  edit: 'edits',
  bash: 'shell',
  read: 'reads',
  agent: 'agents',
  web: 'web',
  other: 'other tools',
  talk: 'talk only',
}

export const LEGEND: Kind[] = ['edit', 'bash', 'read', 'agent', 'web', 'other', 'talk']

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

// What one call of each kind is called, for counting them.
const CALL_NOUN: Record<Kind, string> = {
  edit: 'edit',
  bash: 'shell command',
  read: 'read',
  agent: 'agent',
  web: 'web call',
  other: 'other call',
  talk: 'reply',
}

// A prompt on one line, for the list.
export const oneLine = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim() || '(no prompt)'

// The most of a prompt a list row shows, so a row stays on one line.
export const LIST_CHARS = 60

export const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

// What the list says of a turn after its number: its kind and how it ended.
export const flagsOf = (turn: Segment): string[] => [
  KIND_LABEL[turn.kind],
  ...(turn.errors > 0 ? [plural(turn.errors, 'error')] : []),
  ...(turn.isAborted ? ['interrupted'] : []),
  ...(turn.isCompacted ? ['after a compaction'] : []),
]

// The turn's calls by kind, most first, as `4 edits · 2 shell`.
export const callsOf = (turn: Segment): string => {
  const entries = Object.entries(turn.calls ?? {}) as [Kind, number][]
  if (entries.length === 0) return 'no tool calls'
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => plural(n, CALL_NOUN[kind]))
    .join(' · ')
}

// Where the turn ranks by cost, 1 the costliest.
export const costRank = (turns: Segment[], turn: Segment): number => turns.filter(t => t.weight > turn.weight).length + 1
