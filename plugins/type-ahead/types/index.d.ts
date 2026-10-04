/**
 * The predictions on offer for the draft in the box: `base` is what was typed,
 * `options` the continuations Haiku proposed (most likely first), `selected`
 * the one previewed dim after the text and marked in the band.
 *
 * An empty `base` is the empty box after a turn: `options` are whole next
 * prompts, Claude Code's own guess first and Haiku's after it, `selected` the
 * one shown as Claude Code's suggestion for Tab to take.
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
