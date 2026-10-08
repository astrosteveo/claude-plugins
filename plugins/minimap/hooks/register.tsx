import { atom, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, Register } from 'claude-code'

import { encode, stripOf } from './paint'
import { closeTurn, withCall, withCompaction, withTurn } from './turns'

const turns = atom({ plugin: 'minimap', key: 'turns' } as const, [])
const draft = atom({ plugin: 'minimap', key: 'draft' } as const, null)

const failureOf = (error: HookFailure): string => (error.kind === 'timeout' ? 'ran out of time' : (error.message ?? 'threw'))

// A fault in this mod never stands in the way: the site does what it would
// without it, and the debug log says why.
const fallBack = <E, R>($: EngineInterface, e: E, next: ((e: E) => R) & Caught, site: string): R => {
  $.ui.log(`minimap: ${site} failed and was left to the default: ${failureOf(next.error)}`, { to: 'debug' })
  return next(e)
}

export const register: Register = on => {
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
}
