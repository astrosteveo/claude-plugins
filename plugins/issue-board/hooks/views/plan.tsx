import type { Board, Plan } from '../../types'
import { cardParts, groupOf, kindsText, rowsToMake, sizeText, viewNoteOf } from '../plan'
import type { Elements } from './parts'
import { partsOf } from './parts'

export type PlanHandlers = {
  // Ticks or unticks a row.
  pickRow: (id: string) => () => unknown
  apply: (id: number) => unknown
  discard: () => unknown
}

// The plan Claude proposed with project_plan: a row per change, grouped by issue, each with a box to tick and
// Claude's reason. Apply writes the ticked rows; Discard drops the plan. A row that failed stays, saying why. A row
// the board shows as made already, as when Claude made it another way, isn't drawn.
export const planCard = (elements: Elements, { proposed, now }: { proposed: Plan | null; now: Board }, handlers: PlanHandlers) => {
  const { Box, Text, Button } = elements
  const { choice } = partsOf(elements)
  const planRows = proposed ? rowsToMake(proposed.rows, now) : []
  const planTicked = planRows.filter(row => row.picked).length
  // The rows grouped: the repo's labels first, then each issue, then the project's views.
  const planGroups = [...new Set(planRows.map(row => groupOf(row.change)))]
  return (
    proposed &&
    planRows.length > 0 && (
      <Box key="plan-card" flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} marginTop={1}>
        <Text color="suggestion" bold>{`Claude's plan · ${sizeText(planRows.map(row => row.change))}`}</Text>
        <Text dimColor wrap="wrap">
          {kindsText(planRows.map(row => row.change))}
        </Text>
        {planGroups.map(group => (
          <Box key={`plan-${typeof group === 'number' ? `issue-${group}` : `${group}s`}`} flexDirection="column" marginTop={1}>
            {group === 'label' ? (
              <Text color="claude" bold>
                {"The repo's labels"}
              </Text>
            ) : group === 'view' ? (
              <Text color="claude" bold wrap="truncate-end">{`${now.project?.title ?? 'Project'} views`}</Text>
            ) : (
              <Text wrap="truncate-end">
                <Text color="claude" bold>{`#${group} `}</Text>
                {now.issues.find(one => one.number === group)?.title ?? ''}
              </Text>
            )}
            {planRows
              .filter(row => groupOf(row.change) === group)
              .map(row => (
                <Box key={`plan-row-${row.id}`} flexDirection="column">
                  <Box flexDirection="row" gap={1} flexWrap="wrap">
                    {choice(`plan-pick-${row.id}`, `${row.picked ? '☑' : '☐'} ${cardParts(row.change).head}`, row.picked, handlers.pickRow(row.id))}
                    {cardParts(row.change).detail && <Text wrap="wrap">{cardParts(row.change).detail}</Text>}
                    <Text dimColor wrap="wrap">
                      {row.reason}
                    </Text>
                  </Box>
                  {viewNoteOf(row.change) && (
                    <Text color="warning" wrap="wrap">
                      {`⚠ ${viewNoteOf(row.change)}`}
                    </Text>
                  )}
                  {row.failed && <Text color="error" wrap="wrap">{`✗ ${row.failed}`}</Text>}
                </Box>
              ))}
          </Box>
        ))}
        {proposed.note && (
          <Box marginTop={1}>
            <Text color="warning" wrap="wrap">
              {proposed.note}
            </Text>
          </Box>
        )}
        {proposed.applying ? (
          <Box marginTop={1}>
            <Text color="warning">◌ Applying the plan…</Text>
          </Box>
        ) : (
          <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
            <Button key="plan-apply" variant="primary" dimColor={planTicked === 0} onPress={() => void handlers.apply(proposed.id)}>
              {`✓ Apply ${planTicked} of ${planRows.length}`}
            </Button>
            <Button key="plan-discard" dimColor onPress={() => void handlers.discard()}>
              Discard
            </Button>
          </Box>
        )}
      </Box>
    )
  )
}
