import type { Kind, Segment } from '../types'

// The terminal's own color, for a cell's background where nothing is drawn.
export const DEFAULT = 0x01000000

export const COLOR: Record<Kind, number> = {
  talk: 0x8a8fa3,
  read: 0x4f9dde,
  edit: 0x3fbf7f,
  bash: 0xe0a030,
  agent: 0xb07be0,
  web: 0x3fc1c9,
  other: 0xa0a0a0,
}

export const ERROR = 0xe5484d
export const DIVIDER = 0x6b6f7a

// A turn is a lower half block in its kind's color. A failed turn's top half
// is red, so the mark sits on the cell without hiding what the turn did.
export const TURN_GLYPH = 0x2584 // ▄
export const ABORTED_GLYPH = 0x2582 // ▂
export const DIVIDER_GLYPH = 0x2502 // │

// The dimmest a turn is drawn, for the cheapest; the costliest is full color.
export const FLOOR = 0.35

export type Cell = { glyph: number; fg: number; bg: number }

// One cell's worth of turns: a single turn, or a bucket of them once the
// session has more turns than the band has columns.
type Bucket = Segment

const merge = (turns: Segment[]): Bucket => {
  const heaviest = turns.reduce((a, b) => (b.weight > a.weight ? b : a))
  return {
    turnId: turns[0]!.turnId,
    kind: heaviest.kind,
    errors: turns.reduce((n, t) => n + t.errors, 0),
    weight: turns.reduce((n, t) => n + t.weight, 0),
    isCompacted: turns.some(t => t.isCompacted),
    isAborted: turns.every(t => t.isAborted),
  }
}

const bucket = (turns: Segment[], size: number): Bucket[] => {
  const out: Bucket[] = []
  for (let i = 0; i < turns.length; i += size) out.push(merge(turns.slice(i, i + size)))
  return out
}

const cellsNeeded = (buckets: Bucket[]) => buckets.length + buckets.filter((b, i) => i > 0 && b.isCompacted).length

// The fewest turns per cell that fits the whole session in `width` columns.
export const bucketsFor = (turns: Segment[], width: number): Bucket[] => {
  if (turns.length === 0 || width < 1) return []
  for (let size = 1; ; size++) {
    const buckets = bucket(turns, size)
    if (cellsNeeded(buckets) <= width || buckets.length === 1) return buckets
  }
}

export const scale = (color: number, by: number): number => {
  const channel = (shift: number) => Math.round(((color >> shift) & 0xff) * by)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

// Brightness by rank, not by size, so one huge turn does not leave every
// other turn at the floor.
const brightness = (buckets: Bucket[]): number[] => {
  const order = buckets.map((b, i) => [b.weight, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(buckets.length).fill(FLOOR)
  const top = buckets.length - 1
  order.forEach(([weight, i], rank) => {
    out[i] = weight === 0 || top === 0 ? (weight === 0 ? FLOOR : 1) : FLOOR + ((1 - FLOOR) * rank) / top
  })
  return out
}

// The strip, left to right, oldest first: a divider before a turn that a
// compaction came before, then the turn's own cell.
export const stripOf = (turns: Segment[], width: number): Cell[] => {
  const buckets = bucketsFor(turns, width)
  const light = brightness(buckets)
  const cells: Cell[] = []
  buckets.forEach((b, i) => {
    if (b.isCompacted && i > 0) cells.push({ glyph: DIVIDER_GLYPH, fg: DIVIDER, bg: DEFAULT })
    cells.push({
      glyph: b.isAborted ? ABORTED_GLYPH : TURN_GLYPH,
      fg: scale(COLOR[b.kind], light[i]!),
      bg: b.errors > 0 ? ERROR : DEFAULT,
    })
  })
  return cells
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!
    out += c === undefined ? '=' : ALPHABET[n & 63]!
  }
  return out
}

// The cells as a Raster takes them: little-endian u32 triplets of code point,
// foreground and background, in padded base64.
export const encode = (cells: Cell[]): string => {
  const bytes = new Uint8Array(cells.length * 12)
  const view = new DataView(bytes.buffer)
  cells.forEach((cell, i) => {
    view.setUint32(i * 12, cell.glyph, true)
    view.setUint32(i * 12 + 4, cell.fg, true)
    view.setUint32(i * 12 + 8, cell.bg, true)
  })
  return base64(bytes)
}

export const decode = (text: string): Cell[] => {
  const clean = text.replace(/=+$/, '')
  const bytes: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].reduce((acc, j) => (acc << 6) | (i + j < clean.length ? ALPHABET.indexOf(clean[i + j]!) : 0), 0)
    bytes.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)
  }
  const view = new DataView(Uint8Array.from(bytes).buffer)
  const cells: Cell[] = []
  for (let i = 0; i + 12 <= bytes.length; i += 12) {
    cells.push({ glyph: view.getUint32(i, true), fg: view.getUint32(i + 4, true), bg: view.getUint32(i + 8, true) })
  }
  return cells
}
