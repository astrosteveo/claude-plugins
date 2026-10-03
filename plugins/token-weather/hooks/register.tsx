import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const readings = atom({ plugin: 'token-weather', key: 'readings' } as const, [])
const contextWindow = atom({ plugin: 'token-weather', key: 'contextWindow' } as const, 0)

const HISTORY = 12
const BLOCKS = '▁▂▃▄▅▆▇█'
// Below these widths the band drops its last parts first
const WITH_WORDS = 72
const WITH_DELTA = 62
const WITH_CHART = 50

export type Weather = { icon: string; word: string; color: string }

export function weatherFor(percent: number): Weather {
  if (percent < 25) return { icon: '☀', word: 'Clear', color: 'yellow' }
  if (percent < 50) return { icon: '☁', word: 'Cloudy', color: 'cyan' }
  if (percent < 75) return { icon: '☂', word: 'Showers', color: 'blue' }
  if (percent < 90) return { icon: '☇', word: 'Storm', color: 'magenta' }
  return { icon: '↯', word: 'Compact soon', color: 'red' }
}

export const percentOf = (tokens: number, size: number) =>
  size > 0 ? Math.round((tokens / size) * 100) : 0

// 134_400 reads as '134.4k', 200_000 as '200k', 1_250_000 as '1.3M'
export function compact(count: number) {
  if (count < 1000) return String(Math.round(count))
  const thousands = Math.round(count / 100) / 10
  if (thousands < 1000) return `${thousands}k`
  return `${Math.round(count / 100_000) / 10}M`
}

// One block per reading, scaled to the whole window so a full block is a full window
export function bars(values: readonly number[], size: number) {
  return values.map(tokens => {
    const fraction = size > 0 ? tokens / size : 0
    return BLOCKS[Math.min(7, Math.max(0, Math.ceil(fraction * 8) - 1))]!
  })
}

export const register: Register = on => {
  // Shows the current fill at once, before the next turn ends
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { context } = await $.session.usage()
    await update($, contextWindow, () => context.window)
    const tokens = context.tokens
    if (tokens !== undefined) {
      await update($, readings, list => (list.length === 0 ? [tokens] : list))
    }
    return result
  })

  // The engine measures after each main-thread turn
  on('session.measure', async ($, e, next) => {
    await update($, contextWindow, () => e.context.window)
    const tokens = e.context.tokens
    if (e.changed.includes('context') && tokens !== undefined) {
      // A fill equal to the last is the reading session.start already took
      await update($, readings, list =>
        list.at(-1) === tokens ? list : [...list, tokens].slice(-HISTORY),
      )
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, readings, () => [])
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [history, size] = await Promise.all([read($, readings), read($, contextWindow)])
    const tokens = history.at(-1)
    if (tokens === undefined || size === 0) return next(e)

    const percent = percentOf(tokens, size)
    const now = weatherFor(percent)
    const previous = history.at(-2)
    const added = previous === undefined ? null : tokens - previous
    const width = e.props.bodyColumns

    // Another mod may draw in this band too: keep its tree above the forecast.
    const above = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const sep = <Text color="inactive">·</Text>

    const chart =
      width < WITH_CHART ? null : (
        <Box flexDirection="row">
          {bars(history, size).map((block, i) => (
            <Text color={weatherFor(percentOf(history[i]!, size)).color}>{block}</Text>
          ))}
        </Box>
      )

    const delta =
      added === null || width < WITH_DELTA ? null : (
        <Text>
          <Text color={added < 0 ? 'green' : now.color}>{added < 0 ? '▼ -' : '▲ +'}</Text>
          <Text>{compact(Math.abs(added))}</Text>
          {width >= WITH_WORDS ? <Text color="inactive"> last turn</Text> : ''}
        </Text>
      )

    return (
      <Box flexDirection="column">
        {above}
        <Box flexDirection="row" columnGap={1}>
          <Text color={now.color} bold>
            {now.icon} {now.word}
          </Text>
          <Text color={now.color}>{percent}%</Text>
          {sep}
          <Text>
            {compact(tokens)} / {compact(size)}
          </Text>
          {chart === null ? null : sep}
          {chart}
          {delta === null ? null : sep}
          {delta}
        </Box>
      </Box>
    )
  })
}
