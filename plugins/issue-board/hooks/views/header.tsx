import type { ThemeKey } from 'claude-code'

import type { Velocity } from '../../types'
import { WEEKS, ago, spark } from '../layout'
import type { Progress } from '../layout'
import type { Elements } from './parts'
import { partsOf } from './parts'

export type HeaderData = {
  // The board's repo; null before there is a board.
  repo: string | null
  busy: boolean
  // When the board last synced; null before there is a board.
  fetchedAt: number | null
  clock: number
  // The board's totals; null before there is a board, when there is nothing to total yet.
  totals: {
    issues: number
    bugs: number
    prs: number
    failing: number
    // How far along the issues shown are, for the ticked meter.
    overall: Progress
    // Room for the ticked meter.
    wide: boolean
  } | null
  // The project's current iteration and the days left in it, such as `Sprint 14 · 3d left`; absent without one.
  iteration?: string | null
}

export type HeaderHandlers = {
  refresh: () => unknown
}

// The pane's header: the repo and its totals at the left, the sync and Refresh at the right.
export const header = (elements: Elements, data: HeaderData, handlers: HeaderHandlers) => {
  const { Box, Text, Button } = elements
  const { meter } = partsOf(elements)
  const { busy, clock, totals } = data

  // The header's right: when the board last synced, and Refresh. It keeps its width; the repo's name is cut instead.
  const sync = (
    <Box flexDirection="row" gap={1} flexShrink={0}>
      <Text color={busy ? 'warning' : undefined} dimColor={!busy}>
        {busy ? '◌ syncing…' : data.fetchedAt !== null ? `⟳ ${ago(data.fetchedAt, clock)}` : ''}
      </Text>
      <Button key="refresh" hotkey="r" dimColor onPress={() => void handlers.refresh()}>
        Refresh
      </Button>
    </Box>
  )
  const repoName = (
    <Text wrap="truncate-end">
      <Text color="claude">◆ </Text>
      <Text bold>{data.repo ?? 'GitHub'}</Text>
    </Text>
  )
  // Before there is a board: the repo and the sync, nothing to total yet.
  if (!totals)
    return (
      <Box flexDirection="row" justifyContent="space-between">
        {repoName}
        {sync}
      </Box>
    )

  const stat = (glyph: string, color: ThemeKey, value: number, label: string) => (
    <Text>
      <Text color={color}>{glyph}</Text>
      <Text bold>{` ${value}`}</Text>
      <Text dimColor>{` ${label}`}</Text>
    </Text>
  )

  const { issues, bugs, prs, failing, overall, wide } = totals
  // One line: the repo and its totals at the left, the sync at the right. The ticked meter needs the room.
  // The repo and its counts wrap onto a second line in a narrow pane rather than squeeze a count into two; the sync
  // and Refresh keep their place at the right.
  return (
    <Box flexDirection="row" justifyContent="space-between" gap={1}>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap" flexShrink={1}>
        {repoName}
        {stat('●', 'claude', issues, issues === 1 ? 'issue' : 'issues')}
        {stat('▲', bugs > 0 ? 'error' : 'inactive', bugs, bugs === 1 ? 'bug' : 'bugs')}
        {stat('⇄', 'suggestion', prs, prs === 1 ? 'PR' : 'PRs')}
        {failing > 0 && stat('✗', 'error', failing, 'failing')}
        {data.iteration && (
          <Text wrap="truncate-end">
            <Text color="suggestion">◷</Text>
            <Text dimColor>{` ${data.iteration}`}</Text>
          </Text>
        )}
        {wide && overall.total > 0 && (
          <Text>
            {meter(overall.done, overall.total, 6)}
            <Text dimColor>{` ${Math.round((overall.done / overall.total) * 100)}%`}</Text>
          </Text>
        )}
      </Box>
      {sync}
    </Box>
  )
}

// The issues closed and pull requests merged each week, as sparklines, when the pane is wide enough.
export const trends = ({ Box, Text }: Elements, { wide, velocity }: { wide: boolean; velocity: Velocity }) => {
  const trend = (label: string, color: ThemeKey, counts: number[]) => (
    <Text>
      <Text dimColor>{`${label} `}</Text>
      <Text color={color}>{spark(counts)}</Text>
      <Text bold>{` ${counts.reduce((sum, count) => sum + count, 0)}`}</Text>
    </Text>
  )
  return (
    wide &&
    velocity.closed.length > 0 && (
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        {trend('closed', 'success', velocity.closed)}
        {trend('merged', 'suggestion', velocity.merged)}
        <Text dimColor>{`last ${WEEKS} weeks`}</Text>
      </Box>
    )
  )
}
