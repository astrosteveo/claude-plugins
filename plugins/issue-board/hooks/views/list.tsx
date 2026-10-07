import type { RenderChildren } from 'claude-code'

import type { Found, Issue, Markers, Project } from '../../types'
import type { Group, Tab } from '../filters'
import { nextOf, viewUrl } from '../filters'
import { cells, filterKeys, fit, hintFit } from '../layout'
import { standing } from '../rest'
import type { Elements } from './parts'
import { partsOf } from './parts'

// A term of the view's filter the board can't apply is left out, so the tab may hold more than the view.
export const viewNote = ({ Box, Text, Link }: Elements, { unknownTerms, view, project }: { unknownTerms: string[]; view: Tab['view']; project: Project | null }) =>
  unknownTerms.length > 0 &&
  view &&
  project && (
    <Box key="view-note" flexDirection="row" gap={1} flexWrap="wrap">
      <Text color="warning" wrap="wrap">{`The board can't apply ${unknownTerms.map(term => `\`${term}\``).join(', ')} from this view's filter, so it may list more than GitHub does.`}</Text>
      <Link href={viewUrl(project, view)} label="↗ Open the view" />
    </Box>
  )

// The issues closed lately, newest change first, each with how it closed: GitHub's, not the board's copy.
export const closedList = (
  { Box, Text }: Elements,
  { closedNow, width, clock }: { closedNow: { items: Found[]; at: number; failed?: string } | null; width: number; clock: number },
) => (
  <Box key="closed-list" flexDirection="column">
    {!closedNow && <Text dimColor>◌ Reading the issues closed lately…</Text>}
    {closedNow?.failed && <Text color="error" wrap="wrap">{`Couldn't read closed issues: ${closedNow.failed}`}</Text>}
    {closedNow && !closedNow.failed && closedNow.items.length === 0 && <Text dimColor>Nothing closed yet.</Text>}
    {(closedNow?.items ?? []).map(one => (
      <Box key={`closed-${one.number}`} flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={one.reason === 'not_planned' ? 'inactive' : 'success'}>{one.reason === 'not_planned' ? '⊘ ' : '✓ '}</Text>
          <Text dimColor>{`#${one.number} `}</Text>
          {fit(one.title, Math.max(12, width - 30))}
        </Text>
        <Text dimColor>{standing(one, clock).replace(/^closed /, '')}</Text>
      </Box>
    ))}
  </Box>
)

// Nothing under the tab, or nothing under it that matches the search.
export const emptyNote = ({ Box, Text }: Elements, { filterName, typed }: { filterName: string; typed: string }) => (
  <Box flexDirection="column" alignItems="center">
    <Text color="success">✓</Text>
    <Text dimColor>{typed.trim() ? `Nothing under ${filterName} matches “${typed.trim()}”.` : `Nothing open under ${filterName}.`}</Text>
  </Box>
)

export type GroupsData = {
  groups: Group[]
  // The folded groups the person unfolded.
  opened: string[]
  // Every issue on the board, for an epic's next sub-issue.
  issues: Issue[]
  project: Project | null
  marks: Markers
  width: number
  // The issue whose card is open, and whether its letter keys work.
  open: number | null
  single: boolean
}

export type GroupsHandlers = {
  // Opens or folds a folded group.
  foldGroup: (key: string) => () => unknown
  start: (issue: Issue) => unknown
  // The board's own row and card for an issue.
  issueRow: (issue: Issue) => RenderChildren
  issueCard: (issue: Issue, hotkeys: boolean) => RenderChildren
}

// The issues in their groups, each under its heading.
export const groupList = (elements: Elements, data: GroupsData, handlers: GroupsHandlers) => {
  const { Box, Text, Button } = elements
  const { meter } = partsOf(elements)
  const { width, project, marks } = data
  return data.groups.map(group => {
    const count = String(group.issues.length)
    const shut = group.folded && !data.opened.includes(group.key)
    // A folded group, such as Backlog, is a heading the person opens; open, its heading folds it again.
    const fold = handlers.foldGroup(group.key)
    return (
      <Box key={`group-${group.key}`} flexDirection="column">
        {group.folded ? (
          <Box flexDirection="row" gap={1}>
            <Button key={`fold-${group.key}`} plain hover={{ bold: true }} onPress={fold}>
              {`${shut ? '▸' : '▾'} ${group.title}`}
            </Button>
            <Text dimColor>{shut ? `${count} folded` : count}</Text>
          </Box>
        ) : group.epic ? (
          // An epic: how many of its sub-issues are closed, as a bar, and Next, which starts the first ready one.
          (() => {
            const epic = group.epic
            const next = nextOf(data.issues, epic.number, project, marks)
            const closed = `${epic.completed}/${epic.total} closed`
            return (
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Text wrap="truncate-end">
                  <Text bold color="claude">
                    {fit(group.title, Math.max(12, width - 12 - cells(closed) - (next ? 10 : 0) - 5 - count.length))}
                  </Text>
                  <Text dimColor>{` ${count}`}</Text>
                </Text>
                <Box flexDirection="row" gap={1} flexShrink={0}>
                  {meter(epic.completed, epic.total, 10)}
                  <Text dimColor>{closed}</Text>
                  {next && (
                    <Button key={`next-${epic.number}`} dimColor hover={{ dimColor: false, color: 'claude' }} onPress={() => void handlers.start(next)}>
                      ▶ Next
                    </Button>
                  )}
                </Box>
              </Box>
            )
          })()
        ) : (
          // One short label with its count, such as `In Progress 1`.
          <Box flexDirection="row" gap={1}>
            <Text bold color="claude">
              {fit(group.title, Math.max(12, width - count.length - 1))}
            </Text>
            <Text dimColor>{count}</Text>
          </Box>
        )}
        {!shut &&
          group.issues.map(issue => (
            <Box flexDirection="column">
              {handlers.issueRow(issue)}
              {data.open === issue.number && handlers.issueCard(issue, data.single)}
            </Box>
          ))}
      </Box>
    )
  })
}

// The keys for what shows, most useful first, cut to the pane's width rather than wrapped.
export const hint = (
  { Box, Text }: Elements,
  { confirm, single, tabs, prs, width }: { confirm: boolean; single: boolean; tabs: Tab[]; prs: number; width: number },
) => (
  <Box>
    <Text dimColor>
      {hintFit(
        confirm
          ? ['y merge every open PR', 'n cancel']
          : single
              ? ['s start', 'e edit first', 'x or esc collapse', 'press a box to tick it', 'r refresh']
              : [
                  '⏎ open an issue',
                  filterKeys(tabs),
                  'r refresh',
                  ...(prs > 0 ? ['m merge all PRs'] : []),
                ],
        width,
      )}
    </Text>
  </Box>
)
