import { atom, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, Register } from 'claude-code'

import type { Mode, Row } from '../types'
import { checkoutOf, mayStop, noteFor, pathOf, reasonFor, stoppedLabelOf } from './guard'
import { isWorktreeName, labelOf, outcomeOf, parseWorktrees } from './worktrees'

const PANE = 'worktree'
const COMMAND = 'wt'

const asked = atom({ plugin: 'worktree', key: 'asked' } as const, false)
const rows = atom({ plugin: 'worktree', key: 'rows' } as const, [])
const here = atom({ plugin: 'worktree', key: 'here' } as const, null)
const stopped = atom({ plugin: 'worktree', key: 'stopped' } as const, null)

const failureOf = (error: HookFailure): string => (error.kind === 'timeout' ? 'ran out of time' : (error.message ?? 'threw'))

// A fault in this mod never stands in the way: the site does what it would
// without it, and the debug log says why.
const fallBack = <E, R>($: EngineInterface, e: E, next: ((e: E) => R) & Caught, site: string): R => {
  $.ui.log(`worktree: ${site} failed and was left to the default: ${failureOf(next.error)}`, { to: 'debug' })
  return next(e)
}

// The checkout the session is in now, which changes when it enters a worktree.
// Absolute paths, so a git folder compares the same however it was reached.
const checkoutNow = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const git = (...args: string[]) => $.process.run(['git', ...args], { cwd, timeoutMs: 5_000 })
  const parsed = await git('rev-parse', '--path-format=absolute', '--show-toplevel', '--abbrev-ref', 'HEAD', '--git-dir', '--git-common-dir')
  if (parsed.exitCode !== 0) return null
  const head = await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  return checkoutOf(parsed.stdout, head.exitCode === 0 ? head.stdout : undefined)
}

// Read the worktrees and where the session is from git, for the pane.
const refresh = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const git = (dir: string, ...args: string[]) => $.process.run(['git', ...args], { cwd: dir, timeoutMs: 5_000 })
  const listed = await git(cwd, 'worktree', 'list', '--porcelain')
  const top = await git(cwd, 'rev-parse', '--show-toplevel')
  const found: Row[] = []
  for (const tree of listed.exitCode === 0 ? parseWorktrees(listed.stdout) : []) {
    const status = tree.isPrunable ? null : await git(tree.path, 'status', '--porcelain')
    found.push({ ...tree, isDirty: status !== null && status.exitCode === 0 && status.stdout.trim().length > 0 })
  }
  await update($, rows, () => found)
  await update($, here, () => (top.exitCode === 0 ? top.stdout.trim() : null))
}

// Move through Claude Code's own worktree tools, so their checks apply, and
// say how it went. A refusal is a toast, never a failed press.
const act = async ($: EngineInterface, input: { tool: 'EnterWorktree'; path: string } | { tool: 'EnterWorktree'; name: string } | { tool: 'ExitWorktree'; action: 'keep' | 'remove' }) => {
  const ran = await $.tool.call(input).catch((cause: unknown) => ({ isError: true as const, text: String(cause) }))
  $.ui.toast(outcomeOf(ran))
  await refresh($)
}

export const register: Register = (on, options) => {
  const mode = (options.mode ?? 'ask') as Mode

  // The first edit on the default branch is stopped once, with a reason that
  // tells Claude to offer a worktree, or to move into one.
  on('tool.call', async ($, e, next) => {
    const path = pathOf(e as unknown as Record<string, unknown>)
    if (path === undefined || !mayStop(mode, await read($, asked), e.agentId, e.tool)) return next(e)
    const checkout = await checkoutNow($)
    const reason = checkout === null ? null : reasonFor(mode, checkout, path)
    if (reason === null) return next(e)
    await update($, asked, () => true)
    await update($, stopped, () => e.tool_use_id)
    return { deny: reason }
  }).catch(($, e, next) => fallBack($, e, next, 'tool.call'))

  // In always mode each prompt on the default branch tells Claude to move
  // first, so the first edit is made in the worktree and never stopped. The
  // stop above stays for a Claude that does not.
  on('prompt.submit', async ($, e, next) => {
    if (mode !== 'always' || (await read($, asked))) return next(e)
    const checkout = await checkoutNow($)
    const note = checkout === null ? null : noteFor(mode, checkout)
    return next(note === null ? e : { ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => fallBack($, e, next, 'prompt.submit'))

  // The stopped edit draws as a dim note, not a red error: the stop is the
  // plugin working, and Claude makes the edit again.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool_use_id !== (await read($, stopped))) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{`○ ${e.props.tool} ${stoppedLabelOf(mode)}`}</Text>
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool_use_id !== (await read($, stopped))) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{'  ⎿ Claude makes the edit again.'}</Text>
  })

  on('session.start', async ($, e, next) => {
    // A built-in /wt would win, so the pane then goes without a command. A
    // refused name must not stop the session from starting.
    const isTaken = (await $.command.list()).some(one => one.name === COMMAND && one.source === 'builtin')
    if (isTaken) $.ui.log(`worktree: /${COMMAND} is a built-in, so the pane has no command`, { to: 'debug' })
    else {
      await $.command
        .register({ name: COMMAND, description: 'See, switch to, create and leave git worktrees' })
        .catch((cause: unknown) => $.ui.log(`worktree: /${COMMAND} was not registered: ${String(cause)}`, { to: 'debug' }))
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Worktrees' })
    return { text: 'Worktrees pane opened.' }
  }).catch(($, e, next) => fallBack($, e, next, 'command.run'))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, rows)
    const at = await read($, here)
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // Mobile has no text field, so a new worktree is made elsewhere there.
    const Input = 'Input' in elements ? elements.Input : undefined
    const main = list.find(row => row.isMain)
    const current = list.find(row => row.path === at)
    const isInLinked = current !== undefined && !current.isMain

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No git worktrees here.</Text>}
        {list.map((row, i) => (
          <Box key={`row-${i}`} flexDirection="row">
            <Text color={row.path === at ? 'success' : undefined}>{row.path === at ? '● ' : '  '}</Text>
            <Text bold={row.path === at}>{labelOf(row.path, main?.path ?? '')}</Text>
            <Text dimColor>
              {'  '}
              {row.branch ?? `detached ${row.head.slice(0, 7)}`}
              {row.isDirty ? ' · changes' : ''}
              {row.isLocked ? ' · locked' : ''}
              {row.isPrunable ? ' · folder gone' : ''}
            </Text>
            {row.path !== at && !row.isMain && !row.isPrunable && (
              <Box marginLeft={2}>
                <Button key={`switch-${i}`} label="Switch" onPress={() => act($, { tool: 'EnterWorktree', path: row.path })} />
              </Box>
            )}
          </Box>
        ))}
        {isInLinked && (
          <Box key="here" flexDirection="row">
            <Button key="leave" label="Leave, keep it" onPress={() => act($, { tool: 'ExitWorktree', action: 'keep' })} />
            <Box marginLeft={1} />
            <Button key="remove" label="Leave and remove it" onPress={() => act($, { tool: 'ExitWorktree', action: 'remove' })} />
          </Box>
        )}
        {!isInLinked && Input !== undefined && (
          <Input
            key="new"
            label="New worktree"
            placeholder="name, such as s-12-short-title"
            submitLabel="Create"
            onSubmit={(name: string) => {
              const trimmed = name.trim()
              if (!isWorktreeName(trimmed)) {
                $.ui.toast('A worktree name takes letters, digits, dots, dashes and underscores, 64 at most.')
                return
              }
              return act($, { tool: 'EnterWorktree', name: trimmed })
            }}
          />
        )}
        <Button key="refresh" label="Refresh" dimColor onPress={() => refresh($)} />
      </Box>
    )
  })
}
