import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Alert, Board, Filter, Issue, PullRequest } from '../types'
import {
  WEEKS,
  ago,
  alertsOf,
  bar,
  byArea,
  chipsOf,
  ciBadge,
  fit,
  fixPrompt,
  hex,
  isBug,
  matches,
  parseIssues,
  parsePrs,
  progress,
  reviewBadge,
  since,
  spark,
  startPrompt,
  sumProgress,
  summary,
  timesOf,
  tone,
  weekly,
} from './parse'

const PANE = 'issue-board'
const REFRESH_MS = 5 * 60 * 1000
const GH_WRITE = /\bgh\s+(issue|pr)\s+(create|edit|close|reopen|merge|comment|ready|review)\b/

const board = atom({ plugin: 'issue-board', key: 'board' } as const, null)
const error = atom({ plugin: 'issue-board', key: 'error' } as const, null)
const loading = atom({ plugin: 'issue-board', key: 'loading' } as const, false)
const filter = atom({ plugin: 'issue-board', key: 'filter' } as const, 'active')
const expanded = atom({ plugin: 'issue-board', key: 'expanded' } as const, [])
const working = atom({ plugin: 'issue-board', key: 'working' } as const, null)
const dismissed = atom({ plugin: 'issue-board', key: 'dismissed' } as const, [])

const FILTERS: { id: Filter; label: string; hotkey: string }[] = [
  { id: 'active', label: 'Active', hotkey: 'a' },
  { id: 'future', label: 'Future', hotkey: 'f' },
  { id: 'bugs', label: 'Bugs', hotkey: 'b' },
  { id: 'all', label: 'All', hotkey: 'l' },
]

const gh = async ($: EngineInterface, args: string[]): Promise<string> => {
  const { exitCode, stdout, stderr } = await $.process.run(['gh', ...args], { timeoutMs: 60_000 })
  if (exitCode !== 0) throw new Error(stderr.trim().split('\n')[0] || `gh ${args[0]} exited ${exitCode}`)
  return stdout
}

// `seen`: the refresh follows Claude's own gh write, so the issue it is on changed by its hand, not news.
const refresh = async ($: EngineInterface, seen = false): Promise<void> => {
  if (await read($, loading)) return
  await update($, loading, () => true)
  try {
    const from = since(Date.now())
    const [repo, issues, prs, closed, merged] = await Promise.all([
      gh($, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
      gh($, ['issue', 'list', '--state', 'open', '--limit', '300', '--json', 'number,title,url,labels,assignees,body,updatedAt']),
      gh($, [
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        '50',
        '--json',
        'number,title,url,author,headRefName,isDraft,statusCheckRollup,reviewDecision,additions,deletions,updatedAt',
      ]),
      gh($, ['issue', 'list', '--state', 'closed', '--search', `closed:>=${from}`, '--limit', '500', '--json', 'closedAt']),
      gh($, ['pr', 'list', '--state', 'merged', '--search', `merged:>=${from}`, '--limit', '500', '--json', 'mergedAt']),
    ])
    const fetchedAt = Date.now()
    const next: Board = {
      repo: repo.trim(),
      issues: parseIssues(issues),
      prs: parsePrs(prs),
      velocity: { closed: weekly(timesOf(closed, 'closedAt'), fetchedAt), merged: weekly(timesOf(merged, 'mergedAt'), fetchedAt) },
      fetchedAt,
    }
    await update($, board, () => next)
    if (seen) {
      await update($, working, was => {
        const issue = was && next.issues.find(one => one.number === was.number)
        return was && issue ? { ...was, updatedAt: issue.updatedAt } : was
      })
    }
    await update($, error, () => null)
    $.ui.status(summary(next.issues, next.prs))
  } catch (cause) {
    await update($, error, () => (cause instanceof Error ? cause.message : String(cause)))
  } finally {
    await update($, loading, () => false)
  }
}

const browse = async ($: EngineInterface, kind: 'issue' | 'pr', number: number): Promise<void> => {
  try {
    await gh($, [kind, 'view', String(number), '--web'])
    $.ui.toast(`Opened #${number} in the browser`)
  } catch (cause) {
    $.ui.toast(`Couldn't open #${number}: ${cause instanceof Error ? cause.message : String(cause)}`)
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
    if (typeof command === 'string' && GH_WRITE.test(command)) void refresh($, true)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(40, e.props.bodyColumns)
    const roomy = width >= 72
    const now = await read($, board)
    const failure = await read($, error)
    const busy = await read($, loading)
    const chosen = await read($, filter)
    const open = await read($, expanded)
    const clock = Date.now()

    const start = async (issue: Issue) => {
      await update($, working, () => ({ number: issue.number, title: issue.title, updatedAt: issue.updatedAt }))
      await $.prompt.submit({ text: startPrompt(issue), asUser: true })
      $.ui.toast(`Sent #${issue.number} to Claude`)
    }

    const toggle = (number: number) => () =>
      void update($, expanded, list => (list.includes(number) ? list.filter(one => one !== number) : [...list, number]))

    // A section's heading: its name, a rule across the pane, and what sits at its right.
    const rule = (title: string, right: string, color = 'claude') => (
      <Box flexDirection="row" marginTop={1}>
        <Text bold color={color}>
          {title}
        </Text>
        <Text dimColor>{` ${'─'.repeat(Math.max(1, width - [...title].length - [...right].length - 2))} `}</Text>
        <Text dimColor>{right}</Text>
      </Box>
    )

    const meter = (done: number, total: number, cells: number) => {
      const [filled, empty] = bar({ done, total }, cells)
      return (
        <Text>
          <Text color={tone({ done, total })}>{filled}</Text>
          <Text color="inactive" dimColor>
            {empty}
          </Text>
        </Text>
      )
    }

    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color="claude">◆ </Text>
          <Text bold>{now ? now.repo : 'GitHub'}</Text>
          <Text dimColor>{now ? '  issues & pull requests' : ''}</Text>
        </Text>
        <Box flexDirection="row" gap={1}>
          <Text color={busy ? 'warning' : undefined} dimColor={!busy}>
            {busy ? '◌ syncing…' : now ? `⟳ ${ago(new Date(now.fetchedAt).toISOString(), clock)}` : ''}
          </Text>
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
          {failure ? (
            <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1} marginTop={1}>
              <Text color="error" bold>
                ✗ Couldn't reach GitHub
              </Text>
              <Text>{failure}</Text>
              <Text dimColor>Check `gh auth status`, then press r.</Text>
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text dimColor>◌ Fetching issues and pull requests…</Text>
            </Box>
          )}
        </Box>
      )
    }

    const shown = now.issues.filter(issue => matches(chosen, issue))
    const bugs = now.issues.filter(isBug).length
    const failing = now.prs.filter(pr => pr.ci === 'fail').length
    const overall = sumProgress(shown)

    const stat = (glyph: string, color: string, value: number, label: string) => (
      <Text>
        <Text color={color}>{glyph}</Text>
        <Text bold>{` ${value}`}</Text>
        <Text dimColor>{` ${label}`}</Text>
      </Text>
    )

    const stats = (
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        {stat('●', 'claude', now.issues.length, now.issues.length === 1 ? 'issue' : 'issues')}
        {stat('▲', bugs > 0 ? 'error' : 'inactive', bugs, bugs === 1 ? 'bug' : 'bugs')}
        {stat('⇄', 'suggestion', now.prs.length, now.prs.length === 1 ? 'PR' : 'PRs')}
        {failing > 0 && stat('✗', 'error', failing, 'failing')}
        {overall.total > 0 && (
          <Text>
            {meter(overall.done, overall.total, 10)}
            <Text dimColor>{` ${Math.round((overall.done / overall.total) * 100)}% ticked`}</Text>
          </Text>
        )}
      </Box>
    )

    // A board kept from before velocity was fetched has none until it refreshes.
    const velocity = now.velocity ?? { closed: [], merged: [] }
    const trend = (label: string, color: string, counts: number[]) => (
      <Text>
        <Text dimColor>{`${label} `}</Text>
        <Text color={color}>{spark(counts)}</Text>
        <Text bold>{` ${counts.reduce((sum, count) => sum + count, 0)}`}</Text>
      </Text>
    )
    const trends = velocity.closed.length > 0 && (
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        {trend('closed', 'success', velocity.closed)}
        {trend('merged', 'suggestion', velocity.merged)}
        <Text dimColor>{`last ${WEEKS} weeks`}</Text>
      </Box>
    )

    const tabs = (
      <Box flexDirection="row" gap={1} marginTop={1}>
        {FILTERS.map(one => (
          <Button
            key={`filter-${one.id}`}
            hotkey={one.hotkey}
            variant={one.id === chosen ? 'primary' : undefined}
            dimColor={one.id !== chosen}
            onPress={() => void update($, filter, () => one.id)}
          >
            {`${one.label} ${now.issues.filter(issue => matches(one.id, issue)).length}`}
          </Button>
        ))}
      </Box>
    )

    const prRow = (pr: PullRequest) => {
      const badge = ciBadge[pr.ci]
      const review = reviewBadge(pr)
      const size = `+${pr.additions} −${pr.deletions}`
      const titleRoom = width - [...badge.text].length - String(pr.number).length - 3 - (roomy ? size.length + 2 : 0)
      return (
        <Box key={`pr-row-${pr.number}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" gap={1}>
              <Text color={badge.color} inverse bold>
                {badge.text}
              </Text>
              <Text color="suggestion" bold>{`#${pr.number}`}</Text>
              <Button key={`pr-${pr.number}`} plain hover={{ color: 'claude', bold: true }} onPress={() => void browse($, 'pr', pr.number)}>
                {fit(pr.title, titleRoom)}
              </Button>
            </Box>
            {roomy && (
              <Text>
                <Text color="success">{`+${pr.additions}`}</Text>
                <Text color="error">{` −${pr.deletions}`}</Text>
              </Text>
            )}
          </Box>
          <Box flexDirection="row" gap={1} paddingLeft={[...badge.text].length + 1}>
            <Text dimColor>{`⎇ ${fit(pr.branch, Math.max(10, Math.floor(width / 3)))}`}</Text>
            {pr.author && <Text dimColor>{`· @${pr.author}`}</Text>}
            {pr.updatedAt && <Text dimColor>{`· ${ago(pr.updatedAt, clock)}`}</Text>}
            {review && <Text color={review.color}>{`· ${review.text}`}</Text>}
          </Box>
        </Box>
      )
    }

    // One issue on one line: its progress, number, title, chips and age; the title opens it.
    const issueRow = (issue: Issue) => {
      const isOpen = open.includes(issue.number)
      const step = progress(issue.checks)
      const bug = isBug(issue)
      const chips = roomy ? chipsOf(issue).slice(0, 2) : []
      const age = ago(issue.updatedAt, clock)
      const count = step.total > 0 ? `${step.done}/${step.total}`.padEnd(5) : '     '
      const right = chips.reduce((sum, chip) => sum + chip.name.length + 3, 0) + age.padStart(3).length
      const left = 6 + 1 + 5 + 1 + (bug ? 2 : 0) + String(issue.number).length + 2
      const [filled, empty] = bar(step, 6)
      return (
        <Box key={`row-${issue.number}`} flexDirection="row" justifyContent="space-between">
          {!isOpen && peek(issue)}
          <Box flexDirection="row">
            <Text color={tone(step)}>{filled}</Text>
            <Text color="inactive" dimColor>
              {empty}
            </Text>
            <Text color={tone(step)} dimColor={step.total === 0}>{` ${count} `}</Text>
            {bug && <Text color="error">▲ </Text>}
            <Text color={isOpen ? 'claude' : undefined} dimColor={!isOpen} hover={{ dimColor: false, color: 'claude' }}>
              {`#${issue.number} `}
            </Text>
            <Button key={`issue-${issue.number}`} plain hover={{ bold: true }} onPress={toggle(issue.number)}>
              {fit(issue.title, width - left - right - 1)}
            </Button>
          </Box>
          <Box flexDirection="row" gap={1}>
            {chips.map(chip => (
              <Text>
                <Text color={hex(chip)}>●</Text>
                <Text dimColor>{` ${chip.name}`}</Text>
              </Text>
            ))}
            <Text dimColor>{age.padStart(3)}</Text>
          </Box>
        </Box>
      )
    }

    // What hovering a row shows above it: the title, how far along, and the boxes still open.
    // Every line is padded to the card's width, its margins spaces rather than paddingX, so it covers the rows it is
    // painted over: the surface paints a floating box's text and border but leaves its padding showing what is beneath.
    const peek = (issue: Issue) => {
      const step = progress(issue.checks)
      const cardWidth = Math.min(60, width - 14)
      const inner = cardWidth - 4
      const todo = issue.checks.filter(check => !check.done)
      const listed = todo.slice(0, 4)
      const lines: { text: string; color?: string; dim?: boolean; bold?: boolean }[] = [
        { text: fit(issue.title, inner), bold: true },
        step.total === 0
          ? { text: 'No acceptance boxes.', dim: true }
          : { text: `${step.done}/${step.total} ticked · ${todo.length} to go`, color: tone(step) },
        ...listed.map(check => ({ text: fit(`☐ ${check.text}`, inner) })),
        ...(todo.length > listed.length ? [{ text: `+${todo.length - listed.length} more`, dim: true }] : []),
        { text: '⏎ open · ▶ Start inside', dim: true },
      ]
      return (
        <Box
          position="absolute"
          top={-(lines.length + 2)}
          left={13}
          width={cardWidth}
          display="none"
          hover={{ display: 'flex' }}
          flexDirection="column"
          borderStyle="round"
          borderColor="claude"
        >
          {lines.map(line => (
            <Text color={line.color} dimColor={line.dim} bold={line.bold}>
              {` ${line.text.padEnd(inner)} `}
            </Text>
          ))}
        </Box>
      )
    }

    // An opened issue: a card with its labels, its boxes and what to do with it.
    const issueCard = (issue: Issue, hotkeys: boolean) => {
      const step = progress(issue.checks)
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginLeft={2} marginBottom={1}>
          <Text bold wrap="wrap">
            {issue.title}
          </Text>
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            {issue.labels.map(label => (
              <Text>
                <Text color={hex(label)}>●</Text>
                <Text dimColor>{` ${label.name}`}</Text>
              </Text>
            ))}
            {issue.assignees.map(login => (
              <Text color="suggestion">{`@${login}`}</Text>
            ))}
            <Text dimColor>{`updated ${ago(issue.updatedAt, clock)} ago`}</Text>
          </Box>
          {step.total > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                {meter(step.done, step.total, Math.max(10, Math.min(30, width - 24)))}
                <Text bold>{` ${step.done}/${step.total}`}</Text>
                <Text dimColor>{` · ${Math.round((step.done / step.total) * 100)}%`}</Text>
              </Text>
              {issue.checks.map(check =>
                check.done ? (
                  <Text>
                    <Text color="success">{'✔ '}</Text>
                    <Text dimColor strikethrough>
                      {check.text}
                    </Text>
                  </Text>
                ) : (
                  <Text>
                    <Text color="warning">{'☐ '}</Text>
                    <Text>{check.text}</Text>
                  </Text>
                ),
              )}
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text dimColor italic>
                No acceptance boxes in this issue.
              </Text>
            </Box>
          )}
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button key={`start-${issue.number}`} variant="primary" hotkey={hotkeys ? 's' : undefined} onPress={() => void start(issue)}>
              ▶ Start
            </Button>
            <Button key={`draft-${issue.number}`} hotkey={hotkeys ? 'd' : undefined} onPress={() => void $.prompt.fill({ text: startPrompt(issue) })}>
              ✎ Draft
            </Button>
            <Button key={`web-${issue.number}`} dimColor hotkey={hotkeys ? 'o' : undefined} onPress={() => void browse($, 'issue', issue.number)}>
              ↗ GitHub
            </Button>
            <Button key={`close-${issue.number}`} dimColor hotkey={hotkeys ? 'x' : undefined} onPress={toggle(issue.number)}>
              Close
            </Button>
          </Box>
        </Box>
      )
    }

    const single = open.filter(number => shown.some(issue => issue.number === number)).length === 1
    const filterName = FILTERS.find(one => one.id === chosen)?.label ?? ''

    return (
      <Box flexDirection="column">
        {header}
        {stats}
        {trends}
        {tabs}
        {failure && (
          <Box marginTop={1}>
            <Text color="error">{`✗ Last refresh failed: ${failure}`}</Text>
          </Box>
        )}

        {rule('Pull requests', `${now.prs.length} open`, 'suggestion')}
        {now.prs.length === 0 && <Text dimColor>No pull requests open.</Text>}
        {now.prs.map(prRow)}

        {shown.length === 0 && (
          <Box flexDirection="column" alignItems="center" marginTop={2}>
            <Text color="success">✓</Text>
            <Text dimColor>{`Nothing open under ${filterName}.`}</Text>
          </Box>
        )}
        {byArea(shown).map(([area, issues]) => {
          const sum = sumProgress(issues)
          const right = `${issues.length} · ${sum.total > 0 ? `${Math.round((sum.done / sum.total) * 100)}%` : '—'}`
          return (
            <Box flexDirection="column">
              {rule(area, right)}
              {issues.map(issue => (
                <Box flexDirection="column">
                  {issueRow(issue)}
                  {open.includes(issue.number) && issueCard(issue, single)}
                </Box>
              ))}
            </Box>
          )
        })}

        <Box marginTop={1}>
          <Text dimColor>
            {single
              ? 's start · d draft · o open on GitHub · x close · r refresh'
              : 'a active · f future · b bugs · l all · r refresh · ⏎ open an issue'}
          </Text>
        </Box>
      </Box>
    )
  })

  // The band above the prompt: a pull request whose CI failed, or news on the issue Claude is on.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, board)
    if (e.props.hasSurvey || !now) return next(e)
    const alerts = alertsOf(now, await read($, working), await read($, dismissed))
    if (alerts.length === 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const clock = Date.now()
    const dismiss = (alert: Alert) => async () => {
      await update($, dismissed, list => [...list.slice(-50), alert.key])
      if (alert.kind === 'closed') await update($, working, () => null)
    }

    const line = (alert: Alert) => {
      switch (alert.kind) {
        case 'ci': {
          const { pr } = alert
          const fix = () => (e.props.isWorking ? $.prompt.fill({ text: fixPrompt(pr) }) : $.prompt.submit({ text: fixPrompt(pr), asUser: true }))
          return (
            <Box flexDirection="row" gap={1}>
              <Text color="error" inverse bold>
                {' ✗ CI '}
              </Text>
              <Text>
                <Text color="suggestion" bold>{`#${pr.number} `}</Text>
                <Text>{fit(pr.title, Math.max(12, width - 44))}</Text>
                <Text dimColor>{` failing on ${fit(pr.branch, 20)}`}</Text>
              </Text>
              <Button key={`fix-${pr.number}`} variant="primary" onPress={() => void fix()}>
                Fix
              </Button>
              <Button key={`checks-${pr.number}`} dimColor onPress={() => void browse($, 'pr', pr.number)}>
                Open
              </Button>
              <Button key={`dismiss-${alert.key}`} dimColor onPress={() => void dismiss(alert)()}>
                ✕
              </Button>
            </Box>
          )
        }
        case 'activity': {
          const { issue } = alert
          return (
            <Box flexDirection="row" gap={1}>
              <Text color="warning" inverse bold>
                {' ● NEW '}
              </Text>
              <Text>
                <Text color="claude" bold>{`#${issue.number} `}</Text>
                <Text>{fit(issue.title, Math.max(12, width - 44))}</Text>
                <Text dimColor>{` changed ${ago(issue.updatedAt, clock)} ago`}</Text>
              </Text>
              <Button key={`view-${issue.number}`} variant="primary" onPress={() => void browse($, 'issue', issue.number)}>
                View
              </Button>
              <Button key={`dismiss-${alert.key}`} dimColor onPress={() => void dismiss(alert)()}>
                ✕
              </Button>
            </Box>
          )
        }
        case 'closed':
          return (
            <Box flexDirection="row" gap={1}>
              <Text color="success" inverse bold>
                {' ✓ DONE '}
              </Text>
              <Text>
                <Text color="claude" bold>{`#${alert.working.number} `}</Text>
                <Text>{fit(alert.working.title, Math.max(12, width - 30))}</Text>
                <Text dimColor> is closed</Text>
              </Text>
              <Button key={`dismiss-${alert.key}`} dimColor onPress={() => void dismiss(alert)()}>
                ✕
              </Button>
            </Box>
          )
      }
    }

    return <Box flexDirection="column">{alerts.slice(0, 3).map(line)}</Box>
  })
}
