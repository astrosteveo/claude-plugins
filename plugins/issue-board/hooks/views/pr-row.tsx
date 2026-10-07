import type { ButtonProps } from 'claude-code'

import type { PullRequest, Worker } from '../../types'
import { ago, cells, ciBadge, fit, mergeNoteOf, prRowRoom, reviewBadge } from '../layout'
import { flagsText } from '../merging'
import { pageOf } from '../rest'
import { closeOutRisk, workerBadge, workerOfPr, workerOnLine } from '../workers'
import type { Elements } from './parts'
import { partsOf } from './parts'

export type PrRowData = {
  pr: PullRequest
  width: number
  roomy: boolean
  repo: string
  // The branch this session is on.
  here: string | null
  // The pull request whose details are open, if any.
  shownPr: number | null
  // The pull request whose Finish & merge is asking first, if any, and what its files flagged.
  armedPr: number | null
  armedFound: string[]
  workers: Worker[]
  clock: number
}

export type PrRowHandlers = {
  // Opens or closes the pull request's details.
  toggle: (number: number) => ButtonProps['onPress']
  // Finish & merge: checks the pull request's files, then sends it, or has it ask before it goes.
  finish: (pr: PullRequest) => unknown
  // Sends the pull request to Claude to finish and merge.
  closeOut: (pr: PullRequest) => unknown
  // Takes back the ask.
  cancel: () => unknown
}

// A pull request on one row: CI, number, a ⚙ while a background agent owns its branch, title, the issue it is for,
// a review mark, why it can't merge yet and whether it is this branch's, then its diff counts and Finish & merge. Every part but the title keeps its width,
// and the title is cut to what is left; a narrow pane drops parts in prRowRoom's order rather than wrap the row.
// The title opens its details beneath: branch, author, age, review, failing checks and its link.
export const prRow = (elements: Elements, data: PrRowData, handlers: PrRowHandlers) => {
  const { Box, Text, Button } = elements
  const { link, keep } = partsOf(elements)
  const { pr, width, roomy, here, clock } = data
  const badge = ciBadge[pr.ci]
  const review = reviewBadge(pr)
  const isOpen = data.shownPr === pr.number
  const mine = here !== null && pr.branch === here
  // The counts stay on one line, `+12 −3`, never one above the other.
  const size = `+${pr.additions} −${pr.deletions}`
  // The issue it closes or refers to, on the row: the first it names.
  const forIssue = (pr.issues ?? [])[0]
  const forText = forIssue ? `→ #${forIssue}` : ''
  // Why it can't merge yet: conflicts or behind its base, review threads still open, and who is asked to review.
  const merge = mergeNoteOf(pr)
  const threads = pr.openThreads ?? 0
  const threadText = threads > 0 ? `${threads} open ${threads === 1 ? 'thread' : 'threads'}` : ''
  const askedText = (pr.reviewers ?? []).length > 0 ? `asks ${(pr.reviewers ?? []).slice(0, 2).join(', ')}${(pr.reviewers ?? []).length > 2 ? ` +${(pr.reviewers ?? []).length - 2}` : ''}` : ''
  // A background agent that may still push to its branch, and why Finish & merge asks first: that agent, CI
  // that hasn't passed, or what its files flagged.
  const owner = workerOfPr(pr, data.workers)
  const risk = closeOutRisk(pr, owner)
  const found = data.armedPr === pr.number ? data.armedFound : []
  const asking = data.armedPr === pr.number && (risk !== null || found.length > 0)
  const why = [risk ?? '', flagsText(found)].filter(Boolean).join(' ')
  const gapped = (text: string) => (text ? cells(text) + 1 : 0)
  const fits = prRowRoom(width, cells(badge.text) + 1 + cells(`#${pr.number}`) + 1 + (mine ? 2 : 0) + (owner ? 2 : 0), {
    asked: gapped(askedText),
    threads: gapped(threadText),
    size: roomy ? gapped(size) : 0,
    issue: gapped(forText),
    merge: gapped(merge?.text ?? ''),
    review: review ? 2 : 0,
  })
  const { shown } = fits
  return (
    <Box key={`pr-row-${pr.number}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexDirection="row" gap={1} flexShrink={1}>
          {keep(
            <Text color={badge.color} inverse bold>
              {badge.text}
            </Text>,
          )}
          {keep(<Text color="suggestion" bold>{`#${pr.number}`}</Text>)}
          {owner && keep(<Text color={workerBadge(owner.status).color}>⚙</Text>)}
          <Button key={`pr-${pr.number}`} plain hover={{ bold: true }} onPress={handlers.toggle(pr.number)}>
            {fit(pr.title, fits.title)}
          </Button>
          {shown.issue && keep(<Text color="claude">{forText}</Text>)}
          {shown.review && review && keep(<Text color={review.color}>{pr.isDraft ? '◌' : review.text.slice(0, 1)}</Text>)}
          {shown.merge && merge && keep(<Text color={merge.color}>{merge.text}</Text>)}
          {shown.threads && keep(<Text color="warning">{threadText}</Text>)}
          {shown.asked && keep(<Text dimColor>{askedText}</Text>)}
          {mine &&
            keep(
              <Text color="claude" bold>
                ◆
              </Text>,
            )}
        </Box>
        <Box flexDirection="row" gap={1} flexShrink={0}>
          {shown.size && (
            <Text>
              <Text color="success">{`+${pr.additions}`}</Text>
              <Text color="error">{` −${pr.deletions}`}</Text>
            </Text>
          )}
          <Button key={`close-out-${pr.number}`} dimColor hover={{ dimColor: false, color: 'suggestion' }} onPress={() => handlers.finish(pr)}>
            {fits.finish}
          </Button>
        </Box>
      </Box>
      {asking && (
        <Box key={`close-out-ask-${pr.number}`} flexDirection="row" flexWrap="wrap" gap={1} paddingLeft={cells(badge.text) + 1}>
          <Text color="warning" wrap="wrap">{`Close out PR #${pr.number} anyway? ${why}`}</Text>
          <Button key={`close-out-yes-${pr.number}`} variant="primary" onPress={() => void handlers.closeOut(pr)}>
            Close out anyway
          </Button>
          <Button key={`close-out-no-${pr.number}`} dimColor onPress={() => void handlers.cancel()}>
            Cancel
          </Button>
        </Box>
      )}
      {isOpen && (
        <Box key={`pr-detail-${pr.number}`} flexDirection="row" flexWrap="wrap" gap={1} paddingLeft={[...badge.text].length + 1} marginBottom={1}>
          <Text dimColor>{`⎇ ${fit(pr.branch, Math.max(10, Math.floor(width / 3)))}`}</Text>
          {pr.author && <Text dimColor>{`· @${pr.author}`}</Text>}
          {pr.updatedAt && <Text dimColor>{`· ${ago(pr.updatedAt, clock)}`}</Text>}
          {review && <Text color={review.color}>{`· ${review.text}`}</Text>}
          {pr.ci === 'fail' && (pr.failing ?? []).length > 0 && <Text color="error">{`· ${fit(pr.failing.join(', '), 30)}`}</Text>}
          {(pr.issues ?? []).length > 0 && <Text dimColor>{`· for ${pr.issues.map(number => `#${number}`).join(', ')}`}</Text>}
          {owner && <Text color={workerBadge(owner.status).color}>{`· ${workerOnLine(owner.status, ago(owner.startedAt, clock), owner.number)}`}</Text>}
          {mine && (
            <Text color="claude" bold>
              · ◆ this branch
            </Text>
          )}
          {link(pageOf(data.repo, 'pull', pr))}
        </Box>
      )}
    </Box>
  )
}
