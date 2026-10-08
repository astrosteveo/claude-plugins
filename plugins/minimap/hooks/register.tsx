import { atom, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, Register } from 'claude-code'

import { COLOR, ERROR, encode, stripOf } from './paint'
import { KIND_LABEL, LEGEND, LIST_CHARS, callsOf, clip, costRank, flagsOf, gridOf, hex, oneLine } from './pane'
import { closeTurn, startTurn, withCall, withCompaction, withTurn } from './turns'

const turns = atom({ plugin: 'minimap', key: 'turns' } as const, [])
const draft = atom({ plugin: 'minimap', key: 'draft' } as const, null)
const picked = atom({ plugin: 'minimap', key: 'picked' } as const, null)

const PANE = 'minimap'
const COMMAND = 'minimap'

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Minimap' })

const failureOf = (error: HookFailure): string => (error.kind === 'timeout' ? 'ran out of time' : (error.message ?? 'threw'))

// A fault in this mod never stands in the way: the site does what it would
// without it, and the debug log says why.
const fallBack = <E, R>($: EngineInterface, e: E, next: ((e: E) => R) & Caught, site: string): R => {
  $.ui.log(`minimap: ${site} failed and was left to the default: ${failureOf(next.error)}`, { to: 'debug' })
  return next(e)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A refused name must not stop the session from starting.
    await $.command
      .register({ name: COMMAND, description: 'Show the session map with a legend and the list of turns' })
      .catch((cause: unknown) => $.ui.log(`minimap: /${COMMAND} was not registered: ${String(cause)}`, { to: 'debug' }))
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await openPane($)
    return { text: 'Minimap pane opened.' }
  }).catch(($, e, next) => fallBack($, e, next, 'command.run'))

  // Only the main loop raises turn.start. The prompt names the turn in the pane.
  on('turn.start', async ($, e, next) => {
    await update($, draft, held => startTurn(held, e.text))
    return next(e)
  })

  // Only the main loop's calls count. A subagent's calls are the work of its
  // Agent call, which is counted here as one.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && result.deny === undefined) {
      await update($, draft, held => withCall(held, e.tool, result.isError === true))
    }
    return result
  }).catch(($, e, next) => fallBack($, e, next, 'tool.call'))

  // A compaction marks the turn it happened in, or the next one when it ran
  // between turns, as /compact does.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await update($, draft, withCompaction)
    return result
  }).catch(($, e, next) => fallBack($, e, next, 'session.compact'))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const held = await read($, draft)
      await update($, draft, () => null)
      const segment = closeTurn(held, { turnId: e.turnId, reason: e.reason, usage: e.usage })
      await update($, turns, list => withTurn(list, segment))
    }
    return next(e)
  })

  // The strip sits above whatever the band draws beneath it. It reads the
  // turns, so each new turn redraws it. Raster is the terminal's alone, so
  // elsewhere the band is left as it was.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const cells = stripOf(await read($, turns), e.props.bodyColumns)
    const below = await next(e)
    if (cells.length === 0) return below
    const { Box, Raster } = $.ui.resolve(e)

    return (
      <Box key="minimap" flexDirection="column">
        <Raster key="strip" columns={cells.length} rows={1} cells={encode(cells)} />
        {below}
      </Box>
    )
  })

  // The pane: the map at the pane's width, a legend, and one row per turn
  // that scrolls to the turn's details below.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, turns)
    const chosen = await read($, picked)
    const { Box, Button, Text } = $.ui.resolve(e)
    const legend = (
      <Box key="legend" flexDirection="row" flexWrap="wrap">
        {LEGEND.map(kind => (
          <Text key={`legend-${kind}`}>
            <Text color={hex(COLOR[kind])}>▄</Text> {KIND_LABEL[kind]}{'  '}
          </Text>
        ))}
        <Text key="legend-error">
          <Text color={hex(ERROR)}>▀</Text> failed{'  '}
        </Text>
        <Text key="legend-rest" dimColor>
          ▂ interrupted · │ compaction · brighter costs more
        </Text>
      </Box>
    )
    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          {legend}
          <Text dimColor>No turns yet. Each turn adds a cell once it ends.</Text>
        </Box>
      )
    }
    const grid = gridOf(list, e.props.bodyColumns)
    const map =
      e.surface === 'terminal'
        ? (() => {
            const { Raster } = $.ui.resolve(e)
            return <Raster key="map" columns={grid.columns} rows={grid.rows} cells={encode(grid.cells)} />
          })()
        : null

    return (
      <Box flexDirection="column">
        {map}
        {legend}
        <Text bold>Turns</Text>
        {list.map((turn, i) => (
          <Box key={`row-${turn.turnId}`} flexDirection="row">
            <Text color={hex(COLOR[turn.kind])}>{turn.errors > 0 ? '▀' : '▄'} </Text>
            <Button
              key={`go-${turn.turnId}`}
              plain
              label={`${i + 1}. ${clip(oneLine(turn.prompt), LIST_CHARS)} · ${flagsOf(turn).join(' · ')}`}
              onPress={async () => {
                await update($, picked, () => turn.turnId)
                await $.ui
                  .scroll({ to: { key: `turn-${turn.turnId}` }, in: PANE, block: 'start' })
                  .catch((cause: unknown) => $.ui.log(`minimap: the pane did not scroll: ${String(cause)}`, { to: 'debug' }))
              }}
            />
          </Box>
        ))}
        <Text bold>Details</Text>
        {list.map((turn, i) => (
          <Box key={`turn-${turn.turnId}`} flexDirection="column" marginBottom={1}>
            <Text bold inverse={turn.turnId === chosen} color={hex(COLOR[turn.kind])}>
              Turn {i + 1} · {flagsOf(turn).join(' · ')}
            </Text>
            <Text>{turn.prompt ?? '(no prompt recorded)'}</Text>
            <Text dimColor>
              {callsOf(turn)} · cost rank {costRank(list, turn)} of {list.length}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
