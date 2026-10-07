import type { ButtonProps, RenderChildren } from 'claude-code'

import type { Issue, Project, Triage } from '../../types'
import { areaOf, isInbox, triageTarget } from '../filters'
import { ago, fit } from '../layout'
import { labelsOf, statusFor } from '../prompts'
import type { Elements } from './parts'
import { partsOf } from './parts'

export type TriageData = {
  // The issues shown, each an Inbox row or an ordinary one.
  issues: Issue[]
  // Every issue on the board, whose area labels are offered.
  all: Issue[]
  triaged: Triage
  project: Project | null
  width: number
  clock: number
  // The issue whose card is open, and whether its letter keys work.
  open: number | null
  single: boolean
}

export type TriageHandlers = {
  // Opens or closes the issue's card.
  toggle: (number: number) => ButtonProps['onPress']
  // Keeps a Priority or area picked for an issue.
  choose: (number: number, edit: { priority?: string; area?: string | null }) => () => unknown
  accept: (issue: Issue, picks: { priority: string | null; area: string | null }, status: 'Ready' | 'Backlog') => unknown
  again: () => unknown
  // The board's own row and card for an issue.
  issueRow: (issue: Issue) => RenderChildren
  issueCard: (issue: Issue, hotkeys: boolean) => RenderChildren
}

// What the Inbox says above its rows: that Claude suggests, or is suggesting, and Suggest again.
export const triageNote = ({ Box, Text, Button }: Elements, { triaged, any }: { triaged: Triage; any: boolean }, handlers: Pick<TriageHandlers, 'again'>) => (
  <Box flexDirection="row" gap={1} flexWrap="wrap">
    <Text color={triaged.asking ? 'warning' : undefined} dimColor={!triaged.asking}>
      {triaged.asking ? '◌ Claude is suggesting a Priority, area and Status for each…' : '✦ Claude suggests a Priority, area and Status for each. Change any, then accept.'}
    </Text>
    {!triaged.asking && any && (
      <Button key="triage-again" dimColor onPress={() => void handlers.again()}>
        Suggest again
      </Button>
    )}
  </Box>
)

// Why the last suggestions failed.
export const triageFailed = ({ Text }: Elements, { triaged }: { triaged: Triage }) => triaged.failed && <Text color="error" wrap="wrap">{`Couldn't get suggestions: ${triaged.failed}`}</Text>

// The Inbox shows each issue with what Claude suggests for it: a row of Priority buttons and one of areas, the picked
// one highlighted, Claude's reason, and Accept, which moves it on to the Status Claude suggests, or the other.
export const triageEntries = (elements: Elements, data: TriageData, handlers: TriageHandlers) => {
  const { Box, Text, Button } = elements
  const { choice } = partsOf(elements)
  const { triaged, project, width, clock } = data
  const areaNames = [...new Set([...triaged.areas, ...labelsOf(data.all).filter(name => name.startsWith('area:')).map(name => name.slice('area:'.length))])].sort()
  const triageRow = (issue: Issue) => {
    const said = triaged.suggestions.find(one => one.number === issue.number)
    const mine = triaged.picks.find(one => one.number === issue.number)
    const had = areaOf(issue)
    const priority = mine?.priority ?? said?.priority ?? issue.priority ?? null
    const area = mine && 'area' in mine ? (mine.area ?? null) : said ? said.area : had === 'other' ? null : had
    const status = said?.status ?? statusFor(project, priority)
    const other = status === 'Ready' ? 'Backlog' : 'Ready'
    const target = triageTarget(project, status)
    const otherTarget = triageTarget(project, other)
    const choosing = (edit: { priority?: string; area?: string | null }) => handlers.choose(issue.number, edit)
    const age = ago(issue.updatedAt, clock)
    return (
      <Box key={`triage-${issue.number}`} flexDirection="column" marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={1}>
            <Text color="claude">{`#${issue.number}`}</Text>
            <Button key={`issue-${issue.number}`} plain hover={{ bold: true }} onPress={handlers.toggle(issue.number)}>
              {fit(issue.title, Math.max(12, width - String(issue.number).length - age.length - 4))}
            </Button>
          </Box>
          <Text dimColor>{age}</Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap" paddingLeft={2}>
          {(project?.priority?.options ?? []).map(one => choice(`triage-${issue.number}-priority-${one.name}`, one.name, one.name === priority, choosing({ priority: one.name })))}
          <Text dimColor>·</Text>
          {areaNames.map(name => choice(`triage-${issue.number}-area-${name}`, name, name === area, choosing({ area: name })))}
          {choice(`triage-${issue.number}-area-none`, 'no area', area === null, choosing({ area: null }))}
          <Text dimColor>·</Text>
          <Button key={`triage-${issue.number}-accept`} variant="primary" onPress={() => void handlers.accept(issue, { priority, area }, status)}>
            {target ? `✓ Accept → ${target}` : '✓ Accept'}
          </Button>
          {otherTarget && (
            <Button key={`triage-${issue.number}-${other.toLowerCase()}`} dimColor onPress={() => void handlers.accept(issue, { priority, area }, other)}>
              {`→ ${otherTarget}`}
            </Button>
          )}
        </Box>
        <Box paddingLeft={2}>
          <Text dimColor wrap="wrap">
            {said ? `✦ ${said.reason || 'No reason given.'}` : triaged.asking ? '◌ waiting on Claude' : '✦ No suggestion yet: pick, then accept.'}
          </Text>
        </Box>
      </Box>
    )
  }
  return data.issues.map(issue => (
    <Box key={`triage-entry-${issue.number}`} flexDirection="column">
      {isInbox(issue, project) ? triageRow(issue) : handlers.issueRow(issue)}
      {data.open === issue.number && handlers.issueCard(issue, data.single)}
    </Box>
  ))
}
