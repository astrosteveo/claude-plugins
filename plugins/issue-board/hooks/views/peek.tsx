import type { ThemeKey } from 'claude-code'

import type { Issue } from '../../types'
import { fit, pad, peekPlace, progress, tone } from '../layout'
import type { Elements } from './parts'

// What hovering a row shows above it: the title, how far along, and the boxes still open.
// Every line is padded to the card's width, its margins spaces rather than paddingX, so it covers the rows it is
// painted over: the surface paints a floating box's text and border but leaves its padding showing what is beneath.
// It sits at the pane's right, leaving the rows above their mark, number and the start of their title, so the
// pointer moving up the list reaches the row above rather than the card. A pane without that room shows none.
// `room` is the lines free above the row in the window.
const PEEK_CLEAR = 28

export const peek = ({ Box, Text }: Elements, { issue, width, room }: { issue: Issue; width: number; room: number }) => {
  const step = progress(issue.checks)
  const cardWidth = Math.min(56, width - PEEK_CLEAR)
  if (cardWidth < 30) return null
  const inner = cardWidth - 4
  const todo = issue.checks.filter(check => !check.done)
  const place = peekPlace(room, todo.length)
  if (!place) return null
  const listed = todo.slice(0, place.listed)
  const lines: { text: string; color?: ThemeKey; dim?: boolean; bold?: boolean }[] = [
    { text: fit(issue.title, inner), bold: true },
    step.total === 0
      ? { text: 'No acceptance boxes.', dim: true }
      : { text: `${step.done}/${step.total} ticked · ${todo.length} to go`, color: tone(step) },
    ...listed.map(check => ({ text: fit(`☐ ${check.text}`, inner) })),
    ...(place.more ? [{ text: `+${todo.length - listed.length} more`, dim: true }] : []),
    ...(place.hint ? [{ text: '⏎ open · ▶ Start inside', dim: true }] : []),
  ]
  return (
    <Box
      position="absolute"
      top={-(lines.length + 2)}
      left={width - cardWidth}
      width={cardWidth}
      display="none"
      hover={{ display: 'flex' }}
      flexDirection="column"
      borderStyle="round"
      borderColor="claude"
    >
      {lines.map(line => (
        // Padded in cells, and cut rather than wrapped should a character still be measured wrong: a wrapped line
        // would leave the rows beneath showing through and make the card a line taller than its place above the row.
        <Text color={line.color} dimColor={line.dim} bold={line.bold} wrap="truncate-end">
          {` ${pad(fit(line.text, inner), inner)} `}
        </Text>
      ))}
    </Box>
  )
}
