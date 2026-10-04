import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LiveTurn, Touched, TurnRecap } from '../types'

const PANE = 'touched'
const TITLE = 'Touched files'

const live = atom({ plugin: 'turn-recap', key: 'live' } as const, null as LiveTurn | null)
const recaps = atom({ plugin: 'turn-recap', key: 'recaps' } as const, [] as TurnRecap[])
const touched = atom({ plugin: 'turn-recap', key: 'touched' } as const, [] as Touched[])

/** The engine's own spelling of a turn's length: `3s`, `1m 4s`, `1h 2m 5s`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** `6 tools · 1 failed · edited a.ts, b.ts` (names past three become a count). */
export function describe(recap: TurnRecap): string {
  const parts = [`${recap.tools} tool${recap.tools === 1 ? '' : 's'}`]
  if (recap.failed > 0) parts.push(`${recap.failed} failed`)
  if (recap.edited.length > 0 && recap.edited.length <= 3) {
    parts.push(`edited ${recap.edited.map(basename).join(', ')}`)
  } else if (recap.edited.length > 3) {
    parts.push(`edited ${recap.edited.length} files`)
  }
  return parts.join(' · ')
}

const relative = (path: string, cwd: string) =>
  path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'touched',
      description: 'Show every file Claude edited this session',
    })
    return next(e)
  })

  on('command.run', { command: 'touched' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    const count = (await read($, touched)).length
    return { text: `${count} file${count === 1 ? '' : 's'} touched this session.` }
  })

  on('turn.start', async ($, e, next) => {
    await update($, live, () => ({ turnId: e.turnId, tools: 0, failed: 0, edited: [] }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path =
      e.tool === 'Edit' || e.tool === 'Write'
        ? e.file_path
        : e.tool === 'NotebookEdit'
          ? e.notebook_path
          : undefined
    const hasFailed = ran.deny !== undefined || ran.isError === true

    await update($, live, turn =>
      turn === null
        ? null
        : {
            ...turn,
            tools: turn.tools + 1,
            failed: turn.failed + (hasFailed ? 1 : 0),
            edited:
              path !== undefined && !hasFailed && !turn.edited.includes(path)
                ? [...turn.edited, path]
                : turn.edited,
          },
    )
    if (path !== undefined && !hasFailed) {
      const at = Date.now()
      await update($, touched, list => {
        const found = list.find(one => one.path === path)
        return found === undefined
          ? [...list, { path, edits: 1, at }]
          : list.map(one => (one.path === path ? { ...one, edits: one.edits + 1, at } : one))
      })
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done

    const turn = await read($, live)
    await update($, live, () => null)
    if (turn !== null && turn.turnId === e.turnId && turn.tools > 0) {
      const recap: TurnRecap = {
        turnId: e.turnId,
        durationMs: e.durationMs,
        tools: turn.tools,
        failed: turn.failed,
        edited: turn.edited,
      }
      await update($, recaps, list => [...list, recap].slice(-200))
    }
    return done
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const list = await read($, recaps)
    // The line carries no turn id: find the recap whose duration it reports.
    let best: TurnRecap | undefined
    for (const one of list) {
      const gap = Math.abs(one.durationMs - e.props.durationMs)
      if (gap <= 1000 && (best === undefined || gap < Math.abs(best.durationMs - e.props.durationMs))) {
        best = one
      }
    }
    if (best === undefined) return next(e)

    const { Text } = $.ui.resolve(e)
    return (
      <Text dimColor wrap="truncate-end">
        ✻ {e.props.word} for {formatDuration(e.props.durationMs)} · {describe(best)}
      </Text>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const cwd = await $.session.cwd()
    const list = [...(await read($, touched))].sort((a, b) => b.at - a.at)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)
    const width = String(Math.max(1, ...list.map(one => one.edits))).length

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No files edited yet this session.</Text>}
        {list.slice(0, room).map(one => (
          <Text wrap="truncate-start">
            <Text dimColor>{String(one.edits).padStart(width)}× </Text>
            {relative(one.path, cwd)}
          </Text>
        ))}
        {list.length > room && <Text dimColor>…and {list.length - room} more</Text>}
        {list.length > 0 && (
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button
              key="copy"
              label="Copy paths"
              hotkey="y"
              onPress={press =>
                void $.ui
                  .copy({ text: list.map(one => one.path).join('\n'), surface: press.surface })
                  .then(r => $.ui.toast(r.isCopied ? `Copied ${list.length} paths` : 'Could not copy'))
              }
            />
            <Button key="clear" label="Clear" hotkey="c" onPress={() => void update($, touched, () => [])} />
          </Box>
        )}
      </Box>
    )
  })
}
