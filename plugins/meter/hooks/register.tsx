import { atom, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, Register, Timer } from 'claude-code'

import { activityOf, changedFile, closingHead, closingParts, emptyMeter, finished, label, started, summarize, summaryOf, withSummary } from './meter'

const meter = atom({ plugin: 'meter', key: 'meter' } as const, null)
const now = atom({ plugin: 'meter', key: 'now' } as const, 0)
const summaries = atom({ plugin: 'meter', key: 'summaries' } as const, [])

const failureOf = (error: HookFailure): string => (error.kind === 'timeout' ? 'ran out of time' : (error.message ?? 'threw'))

// A fault in this mod never stands in the way: the site does what it would
// without it, and the debug log says why.
const fallBack = <E, R>($: EngineInterface, e: E, next: ((e: E) => R) & Caught, site: string): R => {
  $.ui.log(`meter: ${site} failed and was left to the default: ${failureOf(next.error)}`, { to: 'debug' })
  return next(e)
}

// The tick that keeps "last change 12s ago" counting. A reload loses it, so
// a tool call starts it again when none runs.
let tick: Timer | null = null

const startTicking = async ($: EngineInterface) => {
  if (tick !== null) return
  const at = await $.clock.now()
  await update($, now, () => at)
  tick = $.clock.every(1000, () => {
    void $.clock.now().then(at => update($, now, () => at))
  })
}

const stopTicking = () => {
  tick?.cancel()
  tick = null
}

export const register: Register = on => {
  // Only the main loop raises turn.start.
  on('turn.start', async ($, e, next) => {
    await update($, meter, emptyMeter)
    await startTicking($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const input = e as unknown as Record<string, unknown>
    const startedAt = await $.clock.now()
    await update($, meter, held => started(held, activityOf(e.tool_use_id, e.tool, input), startedAt))
    await startTicking($)
    // A call that throws (an interrupt) still leaves the list, so the
    // spinner never names a call that is over.
    let isFailed = true
    try {
      const result = await next(e)
      isFailed = result.deny !== undefined || result.isError === true
      return result
    } finally {
      const at = await $.clock.now()
      await update($, meter, held => finished(held, e.tool_use_id, { isFailed, file: changedFile(e.tool, input), at }))
    }
  }).catch(($, e, next) => fallBack($, e, next, 'tool.call'))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      stopTicking()
      const summary = summarize(await read($, meter), e.durationMs, await $.clock.now())
      await update($, summaries, list => withSummary(list, summary))
      await update($, meter, () => null)
    }
    return next(e)
  })

  // The engine's own message (compacting, retrying) says more than this mod
  // can, so it is left alone.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.props.message !== null) return next(e)
    const text = label(await read($, meter), e.props.mode, await read($, now))
    if (text === null) return next(e)
    return next({ ...e, props: { ...e.props, message: text, suffix: '' } })
  })

  // The line that closes a turn (`Baked for 12s · done 7:56 PM`), with what
  // the turn did.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const summary = summaryOf(await read($, summaries), e.props.durationMs)
    const parts = summary === undefined ? [] : closingParts(summary)
    const line = await next(e)
    if (summary === undefined || parts.length === 0) return line
    const { Box, Text } = $.ui.resolve(e)
    const words = parts.map(part => ` · ${part}`).join('')

    // A plugin beneath drew the line as a row of its own (usage does, with
    // the turn's tokens and cost), so the summary joins the end of that row.
    if (line.type === 'Box') return { ...line, children: [...(line.children ?? []), <Text key="meter" dimColor>{words}</Text>] }
    if (line.type !== 'engine') return line

    // The engine's row fills the width, so nothing fits beside it: the line
    // is drawn whole, in the engine's words, with the summary. The engine
    // opens its row with a margin line, so this one does too.
    return (
      <Box key="meter-closing" marginTop={1}>
        <Text dimColor>
          {closingHead(e.props.word, e.props.durationMs, summary.doneAt)}
          {words}
        </Text>
      </Box>
    )
  })
}
