import { atom, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, Register } from 'claude-code'

import type { Row } from '../types'
import {
  RESOLVE_SCRIPT,
  SNAPSHOT_SCRIPT,
  STOPPED_LABEL,
  UNCHECKED_REASON,
  changedNote,
  checkoutOf,
  isGuarded,
  mainTopOf,
  mayStop,
  normalize,
  noteFor,
  pathOf,
  reasonFor,
  resolvedOf,
  withStopped,
} from './guard'
import { isWorktreeName, labelOf, outcomeOf, parseWorktrees } from './worktrees'

const PANE = 'worktree'
const COMMAND = 'wt'

const rows = atom({ plugin: 'worktree', key: 'rows' } as const, [])
const here = atom({ plugin: 'worktree', key: 'here' } as const, null)
const stopped = atom({ plugin: 'worktree', key: 'stopped' } as const, [])

const failureOf = (error: HookFailure): string => (error.kind === 'timeout' ? 'ran out of time' : (error.message ?? 'threw'))

// A fault in this mod never stands in the way: the site does what it would
// without it, and the debug log says why.
const fallBack = <E, R>($: EngineInterface, e: E, next: ((e: E) => R) & Caught, site: string): R => {
  $.ui.log(`worktree: ${site} failed and was left to the default: ${failureOf(next.error)}`, { to: 'debug' })
  return next(e)
}

// A hook that failed after its tool ran can't run it again, and has no result
// to give: Claude is told to look at what the tool did.
const lostResult = ($: EngineInterface, error: HookFailure) => {
  $.ui.log(`worktree: a tool ran but its result was lost: ${failureOf(error)}`, { to: 'debug' })
  return { deny: 'The tool ran, but its result was lost on the way back. Check what it did before running it again.' }
}

// The checkout `dir` is in: the session's, which changes when it enters a
// worktree, or a file's. Absolute paths, so a git folder compares the same
// however it was reached. Null outside a repository.
const checkoutAt = async ($: EngineInterface, dir: string) => {
  const git = (...args: string[]) => $.process.run(['git', ...args], { cwd: dir, timeoutMs: 5_000 })
  const parsed = await git('rev-parse', '--path-format=absolute', '--show-toplevel', '--abbrev-ref', 'HEAD', '--git-dir', '--git-common-dir')
  if (parsed.exitCode !== 0) return null
  const head = await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  return checkoutOf(parsed.stdout, head.exitCode === 0 ? head.stdout : undefined)
}

const checkoutNow = async ($: EngineInterface) => checkoutAt($, await $.session.cwd())

// The real path an edit writes to, every symlink followed, and the nearest
// folder of it that exists; a relative path is the session's. Throws when the
// lookup fails, so the edit is stopped unchecked.
const resolveTarget = async ($: EngineInterface, path: string, cwd: string) => {
  const ran = await $.process.run(['sh', '-c', RESOLVE_SCRIPT, 'resolve', normalize(path, cwd)], { cwd, timeoutMs: 5_000 })
  const resolved = ran.exitCode === 0 ? resolvedOf(ran.stdout) : null
  if (resolved === null) throw new Error(`the path lookup failed: ${ran.stderr.trim()}`)
  return resolved
}

// What the main checkout holds now, as SNAPSHOT_SCRIPT prints it; null when
// it could not be read.
const snapshotOf = async ($: EngineInterface, top: string) => {
  const ran = await $.process.run(['sh', '-c', SNAPSHOT_SCRIPT], { cwd: top, timeoutMs: 15_000 })
  return ran.exitCode === 0 ? ran.stdout.trim() : null
}

// The main checkout a shell command could change, when edits are kept out of
// it; null otherwise.
const guardedMain = async ($: EngineInterface) => {
  const session = await checkoutNow($)
  const top = session === null ? undefined : mainTopOf(session.commonDir)
  if (top === undefined) return null
  const main = top === session?.top ? session : await checkoutAt($, top)
  return main !== null && isGuarded(main) ? main : null
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
  // Isolation is on unless the person turned it off. Off, only the pane is left.
  const isEnabled = options.enabled !== false

  if (isEnabled) {
    // Every edit to the main checkout on the default branch is stopped, with
    // a reason that tells Claude to move into a worktree, until it has moved.
    // The file's own checkout decides, found from its real path, so a
    // relative path, a symlink or a subagent's edit is held the same. An edit
    // that cannot be checked is stopped.
    on('tool.call', async ($, e, next) => {
      const path = pathOf(e as unknown as Record<string, unknown>)
      if (path === undefined || !mayStop(e.tool)) return next(e)
      const cwd = await $.session.cwd()
      const session = await checkoutAt($, cwd)
      if (session === null) return next(e)
      const target = await resolveTarget($, path, cwd)
      const reason = reasonFor(session, await checkoutAt($, target.dir), target.path, e.agentId !== undefined)
      if (reason === null) return next(e)
      await update($, stopped, ids => withStopped(ids, e.tool_use_id))
      return { deny: reason }
    }).catch(async ($, e, next) => {
      if (next.called) return lostResult($, next.error)
      if (pathOf(e as unknown as Record<string, unknown>) === undefined || !mayStop(e.tool)) return fallBack($, e, next, 'tool.call')
      $.ui.log(`worktree: an edit was stopped unchecked: ${failureOf(next.error)}`, { to: 'debug' })
      return { deny: UNCHECKED_REASON }
    })

    // A shell command can write anywhere, and what it will write can't be
    // read from it beforehand. So the main checkout is read before and after
    // each one, while edits are kept out of it, and a change is told to
    // Claude and shown to the person. It is caught, not stopped. A failed
    // read never stands in the way, and the command runs once whatever fails.
    on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
      const main = await guardedMain($).catch(() => null)
      const before = main === null ? null : await snapshotOf($, main.top).catch(() => null)
      const result = await next(e)
      if (main === null || before === null) return result
      try {
        const after = await snapshotOf($, main.top)
        if (after === null || after === before) return result
        $.ui.toast(`worktree: a shell command changed ${main.top} on ${main.branch ?? 'a detached head'}`)
        if (result.deny !== undefined || result.isError) return result
        return { ...result, context: [...(result.context ?? []), changedNote(main.top, main.branch)] }
      } catch (cause) {
        $.ui.log(`worktree: the main checkout was not read after a shell command: ${String(cause)}`, { to: 'debug' })
        return result
      }
    }).catch(($, e, next) => (next.called ? lostResult($, next.error) : fallBack($, e, next, 'tool.call (Bash)')))

    // Each prompt on the default branch tells Claude to move first, so its
    // edits are made in the worktree and never stopped. The stop above stays
    // for a Claude that does not.
    on('prompt.submit', async ($, e, next) => {
      const checkout = await checkoutNow($)
      const note = checkout === null ? null : noteFor(checkout)
      return next(note === null ? e : { ...e, context: [...(e.context ?? []), note] })
    }).catch(($, e, next) => fallBack($, e, next, 'prompt.submit'))
  }

  // A stopped edit draws as a dim note, not a red error: the stop is the
  // plugin working, and Claude makes the edit again.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, stopped)).includes(e.props.tool_use_id)) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{`○ ${e.props.tool} ${STOPPED_LABEL}`}</Text>
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, stopped)).includes(e.props.tool_use_id)) return next(e)
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
