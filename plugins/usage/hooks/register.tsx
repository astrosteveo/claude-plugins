import { atom, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, Register } from 'claude-code'

import type { Turn } from '../types'
import { HEADER, bandParts, colorOf, columns, crossings, duration, levelOf, limitName, measureOf, resetIn, rowCells, tokens, totals, turnFigures, turnOf, usd, withCost, withTurn } from './format'

const PANE = 'usage'
const COMMAND = 'spend'
const measure = atom({ plugin: 'usage', key: 'measure' } as const, null)
const turns = atom({ plugin: 'usage', key: 'turns' } as const, [])
const warned = atom({ plugin: 'usage', key: 'warned' } as const, [])
const start = atom({ plugin: 'usage', key: 'start' } as const, null)

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Usage' })

const failureOf = (error: HookFailure): string => (error.kind === 'timeout' ? 'ran out of time' : (error.message ?? 'threw'))

// A fault in this mod never stands in the way: the site does what it would
// without it, and the debug log says why.
const fallBack = <E, R>($: EngineInterface, e: E, next: ((e: E) => R) & Caught, site: string): R => {
  $.ui.log(`usage: ${site} failed and was left to the default: ${failureOf(next.error)}`, { to: 'debug' })
  return next(e)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // `/usage` is a built-in, so the pane's command is `/spend`. A refused
    // name must not stop the figures below from loading.
    await $.command
      .register({ name: COMMAND, description: 'Show this session’s tokens, cache hits, cost and rate limits in a pane' })
      .catch((cause: unknown) => $.ui.log(`usage: /${COMMAND} was not registered: ${String(cause)}`, { to: 'debug' }))
    // A reload starts the module over, but the figures are already there to read.
    const now = await $.session.usage()
    await update($, measure, () => measureOf(now))

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await openPane($)

    return { text: 'Usage pane opened.' }
  }).catch(($, e, next) => fallBack($, e, next, 'command.run'))

  on('session.measure', async ($, e, next) => {
    const now = measureOf(e)
    await update($, measure, () => now)
    const crossed = crossings(now, await read($, warned))
    await update($, warned, () => crossed.warned)
    for (const text of crossed.toasts) $.ui.toast(text)
    // The first measurement after a turn prices it.
    const priced = withCost(await read($, turns), await read($, start), now.usd)
    if (priced !== null) {
      await update($, turns, () => priced)
      await update($, start, () => null)
    }

    return next(e)
  })

  // Only the main loop raises turn.start, so this is the cost before one of
  // the person's own turns.
  on('turn.start', async ($, e, next) => {
    const { cost } = await $.session.usage()
    if (cost !== undefined) await update($, start, () => ({ turnId: e.turnId, usd: cost.usd }))

    return next(e)
  })

  // Only the main loop's turns: a subagent's turns are its own work, and
  // their cost already reaches the session total through `session.measure`.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.usage !== undefined) {
      const turn: Turn = {
        turnId: e.turnId,
        at: await $.clock.now(),
        model: e.usage.model,
        input: e.usage.input_tokens,
        cacheRead: e.usage.cache_read_input_tokens,
        cacheWrite: e.usage.cache_creation_input_tokens,
        output: e.usage.output_tokens,
        ms: e.durationMs,
        isAborted: e.isAborted,
      }
      await update($, turns, list => withTurn(list, turn))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const parts = bandParts(await read($, measure))
    if (parts.length === 0) return next(e)
    // What the plugins beneath draw stays under the figures, so another mod's
    // band is not hidden by this one.
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box key="usage-band" flexDirection="column">
        <Box key="usage" flexWrap="wrap">
          {parts.map((part, i) => (
            <Text key={part.key} dimColor={part.level === 'ok'} color={colorOf(part.level)}>
              {i === 0 ? '' : ' · '}
              {part.text}
            </Text>
          ))}
        </Box>
        {below}
      </Box>
    )
  })

  // The line that closes a turn, `Baked for 12s`, with what the turn took.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const turn = turnOf(await read($, turns), e.props.durationMs)
    if (turn === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box key="turn" flexDirection="row" flexWrap="wrap">
        <Text dimColor>
          ✻ {e.props.word} for {duration(e.props.durationMs)}
        </Text>
        {turnFigures(turn).map(figure => (
          <Text key={figure.key} color={figure.key === 'usd' ? 'claude' : 'subtle'} dimColor={figure.key !== 'usd'}>
            {' · '}
            {figure.text}
          </Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await read($, measure)
    const list = await read($, turns)
    const sum = totals(list)
    const at = await $.clock.now()

    return (
      <Box flexDirection="column">
        <Box key="summary" flexDirection="column" marginBottom={1}>
          {now?.context.percent !== undefined && (
            <Text key="context" color={colorOf(levelOf(now.context.percent))}>
              Context: {now.context.percent}% of {tokens(now.context.window)}
              {now.context.tokens === undefined ? '' : ` (${tokens(now.context.tokens)} used)`}
            </Text>
          )}
          {now?.usd !== undefined && <Text key="cost">Cost: {usd(now.usd)}</Text>}
          {(now?.limits ?? []).map(limit => {
            const resets = resetIn(limit.resetsAt, at)
            return (
              <Text key={`limit-${limit.kind}`} color={colorOf(levelOf(limit.percentUsed))}>
                {limitName(limit.kind)} limit: {limit.percentUsed}% used{resets === null ? '' : `, resets in ${resets}`}
              </Text>
            )
          })}
          {now === null && <Text key="waiting" dimColor>No measurement yet. It comes after the first reply.</Text>}
        </Box>
        {list.length === 0 ? (
          <Text key="empty" dimColor>No turns yet.</Text>
        ) : (
          <Box key="turns" flexDirection="column">
            <Text key="header" bold>{columns(HEADER)}</Text>
            {[...list].reverse().map((turn, i) => (
              <Text key={`turn-${list.length - 1 - i}`} dimColor={turn.isAborted}>
                {columns(rowCells(turn))}
              </Text>
            ))}
            <Text key="totals" bold>
              {columns([`${sum.turns} turns`, tokens(sum.input), tokens(sum.cacheRead), tokens(sum.cacheWrite), tokens(sum.output), sum.hit === null ? '-' : `${sum.hit}%`, '', ''])}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
