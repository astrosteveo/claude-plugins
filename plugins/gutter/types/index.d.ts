// How long one tool call ran, without the permission wait, and whether it failed.
export type Timing = { ms: number; isErrored: boolean }

declare module 'claude-code' {
  interface PluginState {
    gutter: {
      // Each tool call's run, by its tool_use_id.
      timings: StateFamily<Timing | null>
      // When each prompt was sent, by its message id and by a hash of its text.
      sent: StateFamily<number | null>
    }
  }
}
