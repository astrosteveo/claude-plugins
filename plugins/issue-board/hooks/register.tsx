import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Ci, Filter, Issue } from '../types'
import { byArea, ciMark, clockTime, isBug, matches, parseIssues, parsePrs, progressOf, startPrompt, summary } from './parse'

const PANE = 'issue-board'
const REFRESH_MS = 5 * 60 * 1000
const GH_WRITE = /\bgh\s+(issue|pr)\s+(create|edit|close|reopen|merge|comment|ready|review)\b/

const board = atom({ plugin: 'issue-board', key: 'board' } as const, null)
const error = atom({ plugin: 'issue-board', key: 'error' } as const, null)
const loading = atom({ plugin: 'issue-board', key: 'loading' } as const, false)
const filter = atom({ plugin: 'issue-board', key: 'filter' } as const, 'active')
const expanded = atom({ plugin: 'issue-board', key: 'expanded' } as const, [])

const FILTERS: { id: Filter; label: string; hotkey: string }[] = [
  { id: 'active', label: 'Active', hotkey: 'a' },
  { id: 'future', label: 'Future', hotkey: 'f' },
  { id: 'bugs', label: 'Bugs', hotkey: 'b' },
  { id: 'all', label: 'All', hotkey: 'l' },
]

const CI_COLOR: Record<Ci, string> = { pass: 'green', fail: 'red', pending: 'yellow', none: 'gray' }

const gh = async ($: EngineInterface, args: string[]): Promise<string> => {
  const { exitCode, stdout, stderr } = await $.process.run(['gh', ...args], { timeoutMs: 60_000 })
  if (exitCode !== 0) throw new Error(stderr.trim().split('\n')[0] || `gh ${args[0]} exited ${exitCode}`)
  return stdout
}

const refresh = async ($: EngineInterface): Promise<void> => {
  if (await read($, loading)) return
  await update($, loading, () => true)
  try {
    const [repo, issues, prs] = await Promise.all([
      gh($, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
      gh($, ['issue', 'list', '--state', 'open', '--limit', '300', '--json', 'number,title,labels,body,updatedAt']),
      gh($, ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,headRefName,isDraft,statusCheckRollup,reviewDecision']),
    ])
    const next: Board = { repo: repo.trim(), issues: parseIssues(issues), prs: parsePrs(prs), fetchedAt: Date.now() }
    await update($, board, () => next)
    await update($, error, () => null)
    $.ui.status(summary(next.issues, next.prs))
  } catch (cause) {
    await update($, error, () => (cause instanceof Error ? cause.message : String(cause)))
  } finally {
    await update($, loading, () => false)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'issues',
      description: 'Show open issues and pull requests in a pane',
      argumentHint: '[refresh]',
    })
    void refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'issues' }, async ($, e) => {
    if (e.args.trim() === 'refresh') {
      await refresh($)
      const now = await read($, board)
      return { text: now ? `Refreshed: ${summary(now.issues, now.prs)}.` : `Couldn't refresh: ${(await read($, error)) ?? 'unknown error'}` }
    }
    await $.ui.open({ id: PANE, title: 'Issues', focus: true })
    if ((await read($, board)) === null) void refresh($)

    return { text: 'Issues pane opened. a/f/b/l filter, r refreshes, Enter on an issue opens it, then Start sends it to Claude.' }
  })

  // The model filing, editing or merging through gh: show the change straight away.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = (e as { command?: unknown }).command
    if (typeof command === 'string' && GH_WRITE.test(command)) void refresh($)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await read($, board)
    const failure = await read($, error)
    const busy = await read($, loading)
    const chosen = await read($, filter)
    const open = await read($, expanded)

    const start = async (issue: Issue) => {
      await $.prompt.submit({ text: startPrompt(issue), asUser: true })
      $.ui.toast(`Sent #${issue.number} to Claude`)
    }

    const toggle = (number: number) => () =>
      void update($, expanded, list => (list.includes(number) ? list.filter(one => one !== number) : [...list, number]))

    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{now ? now.repo : 'Issues'}</Text>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{busy ? 'refreshing…' : now ? `updated ${clockTime(now.fetchedAt)}` : ''}</Text>
          <Button key="refresh" hotkey="r" dimColor onPress={() => void refresh($)}>
            Refresh
          </Button>
        </Box>
      </Box>
    )

    if (!now) {
      return (
        <Box flexDirection="column">
          {header}
          {failure ? <Text color="red">gh: {failure}</Text> : <Text dimColor>Loading issues…</Text>}
        </Box>
      )
    }

    const shown = now.issues.filter(issue => matches(chosen, issue))
    const row = (issue: Issue) => (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={issue.checks.length > 0 && issue.checks.every(check => check.done) ? 'green' : undefined} dimColor={issue.checks.length === 0}>
            {progressOf(issue.checks)}
          </Text>
          {isBug(issue) && <Text color="red">bug</Text>}
          <Button key={`issue-${issue.number}`} plain dimColor={!open.includes(issue.number)} onPress={toggle(issue.number)}>
            {`#${issue.number} ${issue.title}`}
          </Button>
        </Box>
        {open.includes(issue.number) && (
          <Box flexDirection="column" paddingLeft={6}>
            {issue.checks.length === 0 && <Text dimColor>No acceptance boxes.</Text>}
            {issue.checks.map(check => (
              <Text color={check.done ? 'green' : undefined} dimColor={check.done}>
                {check.done ? '✓' : '○'} {check.text}
              </Text>
            ))}
            <Text dimColor>
              {issue.labels.join(', ')} · updated {issue.updatedAt.slice(0, 10)}
            </Text>
            <Box flexDirection="row" gap={1}>
              <Button key={`start-${issue.number}`} variant="primary" onPress={() => void start(issue)}>
                Start
              </Button>
              <Button key={`draft-${issue.number}`} dimColor onPress={() => void $.prompt.fill({ text: startPrompt(issue) })}>
                Draft
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="row" gap={1} marginBottom={1}>
          {FILTERS.map(one => (
            <Button key={`filter-${one.id}`} hotkey={one.hotkey} variant={one.id === chosen ? 'primary' : undefined} onPress={() => void update($, filter, () => one.id)}>
              {`${one.label} ${now.issues.filter(issue => matches(one.id, issue)).length}`}
            </Button>
          ))}
        </Box>
        {failure && <Text color="red">Last refresh failed: {failure}</Text>}

        <Text bold>Pull requests</Text>
        {now.prs.length === 0 && <Text dimColor>None open.</Text>}
        {now.prs.map(pr => (
          <Box flexDirection="row" gap={1}>
            <Text color={CI_COLOR[pr.ci]}>{ciMark[pr.ci]}</Text>
            <Text>{`#${pr.number} ${pr.title}`}</Text>
            <Text dimColor>
              {pr.branch}
              {pr.isDraft ? ' · draft' : ''}
              {pr.review ? ` · ${pr.review.toLowerCase().replace('_', ' ')}` : ''}
            </Text>
          </Box>
        ))}

        {shown.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>No open issues here.</Text>
          </Box>
        )}
        {byArea(shown).map(([area, issues]) => (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{`${area} (${issues.length})`}</Text>
            {issues.map(row)}
          </Box>
        ))}
      </Box>
    )
  })
}
