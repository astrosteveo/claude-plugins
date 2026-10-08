import { atom, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, Register } from 'claude-code'

import type { Mode } from '../types'
import { checkoutOf, mayStop, pathOf, reasonFor } from './guard'

const asked = atom({ plugin: 'worktree', key: 'asked' } as const, false)

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
    return { deny: reason }
  }).catch(($, e, next) => fallBack($, e, next, 'tool.call'))
}
