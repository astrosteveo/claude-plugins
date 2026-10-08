// What the guard does before the first edit on the default branch.
export type Mode = 'ask' | 'always' | 'never'

declare module 'claude-code' {
  interface PluginState {
    worktree: {
      // Whether this session has already been stopped once. It is never
      // stopped twice: the person has answered, or Claude has moved.
      asked: boolean
    }
  }
}
