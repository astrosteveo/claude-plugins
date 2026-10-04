/**
 * The predictions on offer for the draft in the box: `base` is what was typed,
 * `options` the continuations Haiku proposed (most likely first), `selected`
 * the one previewed dim after the text and marked in the band.
 */
export type Pick = {
  base: string
  options: string[]
  selected: number
}

declare module 'claude-code' {
  interface PluginState {
    'type-ahead': { pick: Pick | null }
  }
}
