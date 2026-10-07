import type { ButtonProps, ThemeKey } from 'claude-code'

import type { Issue, Markers, Project, PullRequest, Worker, Working } from '../../types'
import { prsFor } from '../github'
import { ago, cells, chipsOf, ciBadge, ciGlyph, fit, hex, progress, rowRoom, tone } from '../layout'
import { isBug } from '../markers'
import { ACTIVE, workerBadge } from '../workers'
import type { Elements } from './parts'
import { partsOf } from './parts'
import { peek } from './peek'

export type IssueRowData = {
  issue: Issue
  width: number
  roomy: boolean
  // The issue whose card is open, if any.
  open: number | null
  marks: Markers
  project: Project | null
  prs: PullRequest[]
  workers: Worker[]
  // The issue this session is on.
  doing: Working | null
  clock: number
  // The lines free above the row in the window, for its peek.
  room: number
}

export type IssueRowHandlers = {
  // Opens or closes the issue's card.
  toggle: (number: number) => ButtonProps['onPress']
  // Stops tracking the issue this session is on.
  stop: () => unknown
}

// A priority as a short tag, the most pressing in the loudest color.
const priorityColor = (project: Project | null, priority: string): ThemeKey => {
  const rank = project?.priority?.options.findIndex(option => option.name === priority) ?? -1
  return rank === 0 ? 'error' : rank === 1 ? 'warning' : 'inactive'
}

// One issue on one line: a mark, its priority, number and title at the left, which opens it; at the right its agent,
// what blocks it, its pull request with CI, chips, a short progress bar with the count, and its age. The mark is ▶
// on the issue this session is on and ▲ on a bug.
export const issueRow = (elements: Elements, data: IssueRowData, handlers: IssueRowHandlers) => {
  const { Box, Text, Button } = elements
  const { meter } = partsOf(elements)
  const { issue, width, roomy, open, marks, project, clock, doing } = data
  const isOpen = open === issue.number
  const step = progress(issue.checks)
  const bug = isBug(issue, marks)
  const chipList = roomy ? chipsOf(issue, marks).slice(0, 2) : []
  const age = ago(issue.updatedAt, clock)
  const count = `${step.done}/${step.total}`.padEnd(5)
  const linked = prsFor(issue, data.prs)[0]
  const pr = linked ? `⇄ #${linked.number} ${ciGlyph(linked.ci)}` : ''
  const tag = project && issue.priority ? `${fit(issue.priority, 3)} ` : ''
  // The open issue it waits on, if any: the first, and how many more.
  const blockers = issue.blockedBy ?? []
  const blocked = blockers.length > 0 ? `⛔ #${blockers[0]}${blockers.length > 1 ? ` +${blockers.length - 1}` : ''}` : ''
  // The background agent on it, if Start in background set one going.
  const worker = data.workers.find(one => one.number === issue.number)
  const badge = worker && workerBadge(worker.status)
  // The issue this session is on, unless a background agent is at work on it: then the row shows the agent instead.
  // Its ✕ at the row's end stops tracking it.
  const onIt = doing?.number === issue.number && !(worker && ACTIVE.includes(worker.status))
  // Each right-hand part with the cell of gap before it. A narrow pane drops the chips, then the bar, then the age.
  const fits = rowRoom(width, 2 + (onIt && bug ? 2 : 0) + tag.length + String(issue.number).length + 2, {
    chips: chipList.reduce((sum, chip) => sum + cells(chip.name) + 3, 0),
    bar: step.total > 0 ? 3 + 1 + 5 + 1 : 0,
    age: age ? 3 + 1 : 0,
    rest: (pr ? cells(pr) + 1 : 0) + (blocked ? cells(blocked) + 1 : 0) + (badge ? cells(badge.text) + 1 : 0) + (onIt ? 2 : 0),
  })
  const chips = fits.chips ? chipList : []
  return (
    <Box key={`row-${issue.number}`} flexDirection="row" justifyContent="space-between">
      {!isOpen && peek(elements, { issue, width, room: data.room })}
      {/* The marks, priority and number keep their width; were the row ever short of room, the title gives way. */}
      <Box flexDirection="row" flexShrink={1}>
        <Box flexDirection="row" flexShrink={0}>
          {onIt ? (
            <Text color="claude" bold>
              {'▶ '}
            </Text>
          ) : (
            <Text color="error">{bug ? '▲ ' : '  '}</Text>
          )}
          {onIt && bug && <Text color="error">▲ </Text>}
          {tag && <Text color={priorityColor(project, issue.priority ?? '')}>{tag}</Text>}
          <Text color={isOpen || onIt ? 'claude' : undefined} dimColor={!isOpen && !onIt} hover={{ dimColor: false, color: 'claude' }}>
            {`#${issue.number} `}
          </Text>
        </Box>
        <Button key={`issue-${issue.number}`} plain hover={{ bold: true }} onPress={handlers.toggle(issue.number)}>
          {fit(issue.title, fits.title)}
        </Button>
      </Box>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        {badge && <Text color={badge.color}>{badge.text}</Text>}
        {blocked && <Text color="warning">{blocked}</Text>}
        {linked && <Text color={ciBadge[linked.ci].color}>{pr}</Text>}
        {chips.map(chip => (
          <Text>
            <Text color={hex(chip)}>●</Text>
            <Text dimColor>{` ${chip.name}`}</Text>
          </Text>
        ))}
        {fits.bar && (
          <Text key={`progress-${issue.number}`}>
            {meter(step.done, step.total, 3)}
            <Text color={tone(step)}>{` ${count}`}</Text>
          </Text>
        )}
        {fits.age && <Text dimColor>{age.padStart(3)}</Text>}
        {onIt && (
          <Button key={`stop-${issue.number}`} dimColor onPress={() => void handlers.stop()}>
            ✕
          </Button>
        )}
      </Box>
    </Box>
  )
}
