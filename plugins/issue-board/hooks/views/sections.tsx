import type { ThemeKey } from 'claude-code'

import type { Flagged, Milestone, Project, PullRequest, RunWatch } from '../../types'
import { updateLine } from '../github'
import { fit, prCountsText } from '../layout'
import { flaggedLines } from '../merging'
import { milestoneDue } from '../rest'
import type { Elements } from './parts'
import { partsOf } from './parts'

// What the pane shows before there is a board: why GitHub couldn't be reached, or that it is being read.
export const noBoard = ({ Box, Text }: Elements, { failure }: { failure: string | null }) =>
  failure ? (
    <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1} marginTop={1}>
      <Text color="error" bold>
        ✗ Couldn't reach GitHub
      </Text>
      <Text>{failure}</Text>
      <Text dimColor>Press r to try again, or run /issues check.</Text>
    </Box>
  ) : (
    <Box marginTop={1}>
      <Text dimColor>◌ Fetching issues and pull requests…</Text>
    </Box>
  )

export const projectUpdate = ({ Text }: Elements, { update, clock }: { update: Project['update'] | undefined; clock: number }) =>
  update && (
    // The project's latest status update, colored by how it stands.
    <Text wrap="truncate-end">
      <Text color={{ 'On track': 'success', 'At risk': 'warning', 'Off track': 'error', Complete: 'claude' }[update.status] as ThemeKey | undefined}>{'◉ '}</Text>
      {updateLine(update, clock)}
    </Text>
  )

export type SectionHandlers = {
  // Opens or folds a section above the issues.
  fold: (key: string) => () => unknown
}

// A section's heading, which opens or folds it.
const heading = ({ Box, Button }: Elements, { key, title, open }: { key: string; title: string; open: boolean }, handlers: SectionHandlers) => (
  <Box key={`section-head-${key}`}>
    <Button key={`section-${key}`} plain hover={{ bold: true }} onPress={handlers.fold(key)}>
      {`${open ? '▾' : '▸'} ${title}`}
    </Button>
  </Box>
)

export type PrsHandlers = SectionHandlers & {
  // Shows or takes away Merge all's confirm.
  arm: (to: boolean) => () => unknown
  closeOutAll: (prs: PullRequest[]) => unknown
}

// The pull requests' heading: how many, or their counts while folded, and Merge all.
export const prsHeading = (elements: Elements, { prs, open, arming }: { prs: PullRequest[]; open: boolean; arming: boolean }, handlers: PrsHandlers) => {
  const { Box, Text, Button } = elements
  return (
    prs.length > 0 && (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" gap={1}>
          {heading(elements, { key: 'prs', title: 'Pull requests', open }, handlers)}
          <Text dimColor>
            {open
              ? `${prs.length} open`
              : prCountsText(prs)}
          </Text>
        </Box>
        {!arming && (
          <Button key="close-out-all" dimColor hotkey="m" onPress={handlers.arm(true)}>
            {`⇶ Merge all ${prs.length}…`}
          </Button>
        )}
      </Box>
    )
  )
}

// Merge all's confirm. While the board reads the pull requests' files it says so and offers only Cancel; then it asks,
// with a line under the question for each pull request whose files flagged something.
export const mergeConfirm = ({ Box, Text, Button }: Elements, { prs, flagged }: { prs: PullRequest[]; flagged: Flagged[] | null }, handlers: PrsHandlers) => {
  const lines = flaggedLines(flagged ?? [])
  const plural = prs.length === 1 ? 'PR' : 'PRs'
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {flagged === null && <Text dimColor>{`Checking the files of ${prs.length} open ${plural}…`}</Text>}
        {flagged !== null && (
          <Text color="warning">{`Finish and merge all ${prs.length} open ${plural}?${lines.length > 0 ? ` ${lines.length} ${lines.length === 1 ? 'needs' : 'need'} a look:` : ''}`}</Text>
        )}
        {flagged !== null && (
          <Button key="close-out-all-yes" variant="primary" hotkey="y" onPress={() => void handlers.closeOutAll(prs)}>
            {lines.length > 0 ? 'Yes, merge them anyway' : 'Yes, merge them'}
          </Button>
        )}
        <Button key="close-out-all-no" dimColor hotkey="n" onPress={handlers.arm(false)}>
          Cancel
        </Button>
      </Box>
      {lines.map(line => (
        <Text key={`close-out-all-flag-${line.split(' ')[0]}`} color="warning" wrap="wrap">
          {`  ${line}`}
        </Text>
      ))}
    </Box>
  )
}

// A CI run being watched on the checked-out branch: its workflow, how many jobs are done, and the step under way.
export const runRow = (elements: Elements, { run, width }: { run: RunWatch; width: number }) => {
  const { Box, Text } = elements
  const { meter } = partsOf(elements)
  return (
    <Box key={`run-${run.id}`} flexDirection="row" gap={1}>
      <Text color={run.failed > 0 ? 'error' : 'warning'}>◷</Text>
      <Text>
        <Text bold>{fit(run.workflow, 28)}</Text>
        <Text dimColor>{` on ${fit(run.branch, 28)}`}</Text>
      </Text>
      {run.total > 0 && (
        <Text>
          {meter(run.done, run.total, 8)}
          <Text dimColor>{` ${run.done}/${run.total} jobs${run.failed > 0 ? `, ${run.failed} failed` : ''}`}</Text>
        </Text>
      )}
      {run.running && <Text dimColor>{fit(`${run.running}${run.step ? ` › ${run.step}` : ''}`, Math.max(12, width - 76))}</Text>}
    </Box>
  )
}

export const milestones = (
  elements: Elements,
  { milestones, open, width, clock }: { milestones: Milestone[]; open: boolean; width: number; clock: number },
  handlers: SectionHandlers,
) => {
  const { Box, Text } = elements
  const { meter } = partsOf(elements)
  return (
    milestones.length > 0 && (
      // The open milestones, release scope: how far along each is, and when it is due.
      <Box key="milestones" flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {heading(elements, { key: 'milestones', title: 'Milestones', open }, handlers)}
          <Text dimColor>
            {open
              ? `${milestones.length} open`
              : fit(milestones.map(one => `${one.title} ${one.closed}/${one.open + one.closed}`).join(' · '), Math.max(12, width - 16))}
          </Text>
        </Box>
        {(open ? milestones : []).map(one => {
          const total = one.open + one.closed
          const due = milestoneDue(one, new Date(clock).toISOString().slice(0, 10))
          return (
            <Box key={`milestone-${one.number}`} flexDirection="row" justifyContent="space-between">
              <Text>{fit(one.title, Math.max(12, width - 34))}</Text>
              <Box flexDirection="row" gap={1}>
                {meter(one.closed, total, 8)}
                <Text dimColor>{`${one.closed}/${total}`}</Text>
                <Text color={due.late ? 'error' : undefined} dimColor={!due.late}>
                  {due.text}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  )
}
