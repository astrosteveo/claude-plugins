import type { Worktree } from '../types'

// Porcelain output lists each worktree as a block of lines, blocks split by
// a blank line. The first block is always the main working tree.
export const parseWorktrees = (porcelain: string): Worktree[] =>
  porcelain
    .split(/\n\s*\n/)
    .map(block => block.split('\n').filter(line => line.length > 0))
    .filter(lines => lines.length > 0 && lines[0]!.startsWith('worktree '))
    .map((lines, i) => {
      const field = (name: string) => lines.find(line => line === name || line.startsWith(`${name} `))
      const value = (name: string) => field(name)?.slice(name.length + 1)
      return {
        path: value('worktree') ?? '',
        branch: value('branch')?.replace(/^refs\/heads\//, ''),
        head: value('HEAD') ?? '',
        isMain: i === 0,
        isLocked: field('locked') !== undefined,
        isPrunable: field('prunable') !== undefined,
      }
    })

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

// A short name for a worktree's folder: where it sits next to the main tree.
export const labelOf = (path: string, mainPath: string): string => {
  if (path === mainPath) return 'main checkout'
  if (path.startsWith(`${mainPath}/`)) return path.slice(mainPath.length + 1)
  if (parentOf(path) === parentOf(mainPath)) return `../${baseOf(path)}`
  return path
}

// What EnterWorktree takes as a name: "/"-separated segments of letters,
// digits, dots, underscores and dashes, 64 characters at most.
export const isWorktreeName = (name: string): boolean =>
  name.length > 0 && name.length <= 64 && name.split('/').every(segment => /^[A-Za-z0-9._-]+$/.test(segment))

// What a worktree tool's answer says, for a toast: its refusal or error, or
// the message it gave when it worked.
export const outcomeOf = (ran: { deny?: string; isError?: true; text?: string; result?: unknown }): string => {
  if (ran.deny !== undefined) return ran.deny
  if (ran.isError) return ran.text ?? 'The worktree tool failed.'
  const message = (ran.result as { message?: unknown } | undefined)?.message
  return typeof message === 'string' ? message : 'Done.'
}
