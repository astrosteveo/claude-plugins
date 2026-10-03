// Context tokens after each of the last turns, oldest first
export type TokenWeatherReadings = number[]

declare module 'claude-code' {
  interface PluginState {
    'token-weather': {
      readings: TokenWeatherReadings
      // The session model's context window, in tokens
      contextWindow: number
    }
  }
}
