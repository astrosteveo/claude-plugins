import { atom, memberOf, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, Register, RenderElement } from 'claude-code'

import type { Badge } from './format'
import { WIDTH, clock, colorOf, groupBadge, keyOf, timingBadge } from './format'

const timings = atom({ plugin: 'gutter', key: 'timings' } as const, null)
const sent = atom({ plugin: 'gutter', key: 'sent' } as const, null)

const failureOf = (error: HookFailure): string => (error.kind === 'timeout' ? 'ran out of time' : (error.message ?? 'threw'))

// A fault in this mod never stands in the way: the site does what it would
// without it, and the debug log says why.
const fallBack = <E, R>($: EngineInterface, e: E, next: ((e: E) => R) & Caught, site: string): R => {
  $.ui.log(`gutter: ${site} failed and was left to the default: ${failureOf(next.error)}`, { to: 'debug' })
  return next(e)
}

const record = async ($: EngineInterface, id: string, ms: number | undefined, isErrored: boolean) => {
  if (ms === undefined) return
  await update($, memberOf(timings, { requestId: id }), () => ({ ms, isErrored }))
}

// The engine's own row, narrowed by the gutter, with the badge right-aligned
// in the gutter. It sits on the row's last line: the engine opens most rows
// with a blank margin line, and a one-line row's text is its last line.
const withGutter = ($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], row: RenderElement, badge: Badge) => {
  const { Box, Text } = $.ui.resolve(e)

  return (
    <Box flexDirection="row" alignItems="flex-end">
      <Box flexGrow={1} flexShrink={1}>
        {row}
      </Box>
      <Box flexShrink={0} width={WIDTH} justifyContent="flex-end">
        <Text color={colorOf(badge)} dimColor={badge.tone === 'quiet'}>
          {badge.text}
        </Text>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  // The classic post-tool events carry how long the tool itself ran, without
  // the permission prompt or the hooks around it.
  on('classic.PostToolUse', async ($, e, next) => {
    await record($, e.tool_use_id, e.duration_ms, false)
    return next(e)
  }).catch(($, e, next) => fallBack($, e, next, 'PostToolUse'))

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await record($, e.tool_use_id, e.duration_ms, true)
    return next(e)
  }).catch(($, e, next) => fallBack($, e, next, 'PostToolUseFailure'))

  // A row the person sees as typed is stored under the id its UserMessage
  // row is drawn with, so the time is found by that id once it is kept.
  on('session.append', async ($, e, next) => {
    if (e.message.type === 'user' && e.message.isMeta !== true && e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, memberOf(sent, { requestId: e.uuid }), held => held ?? at)
    }
    return next(e)
  }).catch(($, e, next) => fallBack($, e, next, 'session.append'))

  // The text is the fallback key, for a row whose id the append did not see.
  on('prompt.submit', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, memberOf(sent, { requestId: keyOf(e.text) }), held => held ?? at)
    return next(e)
  }).catch(($, e, next) => fallBack($, e, next, 'prompt.submit'))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const at = e.props.isExpanded
      ? null
      : ((await read($, memberOf(sent, e))) ?? (await read($, memberOf(sent, { requestId: keyOf(e.props.text) }))))
    const row = await next(e)
    if (at === null) return row
    return withGutter($, e, row, { text: clock(at), tone: 'quiet' })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const badge = e.props.isRunning ? null : timingBadge(await read($, memberOf(timings, e)))
    const row = await next(e)
    if (badge === null) return row
    return withGutter($, e, row, badge)
  })

  // An unfolded group draws each call as its own ToolUse row, which carries
  // its own badge, so only the folded line gets the total.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const { calls, isActive, isExpanded } = e.props
    const isFolded = !isExpanded && !isActive
    const ids = isFolded ? calls.map(call => call.tool_use_id) : []
    const known = ids.every(id => id !== undefined)
    const held = known ? await Promise.all(ids.map(id => read($, memberOf(timings, { requestId: id! })))) : []
    const badge = known ? groupBadge(held) : null
    const row = await next(e)
    if (badge === null) return row
    return withGutter($, e, row, badge)
  })
}
