import type { ButtonProps } from 'claude-code'

import type { Issue, Launch, Markers, Project, Worker } from '../../types'
import { startTargetOf } from '../filters'
import { proseOf } from '../github'
import { ago, agoText, hex, progress } from '../layout'
import { pageOf } from '../rest'
import { ACTIVE, workerBadge, workerOnLine } from '../workers'
import type { CommentsData, CommentsHandlers } from './comments'
import { conversation } from './comments'
import type { EditorData, EditorHandlers } from './editor'
import { editor } from './editor'
import type { PaneElements } from './parts'
import { partsOf } from './parts'

export type CardData = Omit<EditorData, 'issue'> &
  Omit<CommentsData, 'issue'> & {
    repo: string
    project: Project | null
    marks: Markers
    width: number
    // Whether the issue is under the tab and the search.
    kept: (issue: Issue) => boolean
    // The tab's name and the search, for the note on a card no longer under them.
    filterName: string
    typed: string
    workers: Worker[]
    // The Starts pressed that aren't under way yet.
    launches: Launch[]
    // The issue Start sent Claude in this session.
    startedHere: number | null
    // In background start mode the background start is the card's first and primary one: `s`, and `e` for its Edit
    // first. The main-chat start moves to `b`, one key away.
    inBackground: boolean
    // The issue whose card has its editor open.
    changing: number | null
  }

export type CardHandlers = EditorHandlers &
  CommentsHandlers & {
    // Opens or closes the issue's card.
    toggle: (number: number) => ButtonProps['onPress']
    // Sets a project field from the card's buttons.
    pick: (issue: Issue, field: 'status' | 'priority', name: string) => unknown
    flip: (issue: Issue, box: number, done: boolean) => unknown
    start: (issue: Issue) => unknown
    background: (issue: Issue) => unknown
    // Puts the start message in the prompt box.
    draft: (issue: Issue, background: boolean) => unknown
    // Says an epic has no sub-issue ready to start.
    noReady: (number: number) => unknown
    // Opens or closes the card's editor.
    openEditor: (number: number) => () => unknown
  }

// A project field on a card: its options as buttons, the one set drawn as the primary. Buttons rather than a
// Select, which the terminal opens by keyboard alone: a click on its options does nothing.
const picker = (
  elements: PaneElements,
  { issue, field, label, options, value }: { issue: Issue; field: 'status' | 'priority'; label: string; options: { id: string; name: string }[]; value: string | null | undefined },
  handlers: Pick<CardHandlers, 'pick'>,
) => {
  const { Box, Text } = elements
  const { choice } = partsOf(elements)
  return (
    <Box key={`${field}-${issue.number}`} flexDirection="row" gap={1} flexWrap="wrap">
      <Text dimColor>{label}</Text>
      {options.map(option =>
        choice(`${field}-${issue.number}-${option.id}`, option.name, option.name === value, () => void (option.name === value ? undefined : handlers.pick(issue, field, option.name))),
      )}
    </Box>
  )
}

// An opened issue: a card with its labels, its text, its boxes and what to do with it.
export const issueCard = (elements: PaneElements, data: CardData & { issue: Issue; hotkeys: boolean }, handlers: CardHandlers) => {
  const { Box, Text, Button, Markdown } = elements
  const { link, choice, meter } = partsOf(elements)
  const { issue, hotkeys, project, clock, width, launches, startedHere, inBackground, changing } = data
  const step = progress(issue.checks)
  const prose = proseOf(issue.body ?? '')
  // The background agent Start in background set on it, with what it last said.
  const worker = data.workers.find(one => one.number === issue.number)
  const workerAge = worker ? agoText(worker.startedAt, clock) : ''
  // What Start starts: on an epic's card, its first ready sub-issue, which the button names; null when none is.
  const isEpic = (issue.subIssues?.total ?? 0) > 0
  const target = startTargetOf(data.issues, issue, project, data.marks)
  const goes = target ?? issue
  const startLabel = isEpic && target && target.number !== issue.number ? `▶ Start #${target.number}` : '▶ Start'
  const startIt = () => (target ? handlers.start(target) : handlers.noReady(issue.number))
  const backgroundIt = () => (target ? handlers.background(target) : handlers.noReady(issue.number))
  const draftIt = (background: boolean) => (target ? handlers.draft(target, background) : handlers.noReady(issue.number))
  // A background agent at work on what Start would start, whether Start in background set it going or Claude
  // dispatched it: the card shows it in place of every start button, so the issue isn't started a second time.
  const busy = data.workers.find(one => one.number === goes.number && ACTIVE.includes(one.status))
  const startButton = launches.some(one => one.number === goes.number && one.how === 'start') ? (
    <Text key={`starting-${issue.number}`} color="claude">
      ▶ Starting…
    </Text>
  ) : startedHere === goes.number ? (
    <Text key={`started-${issue.number}`} color="claude">
      ▶ Started
    </Text>
  ) : (
    <Button key={`start-${issue.number}`} variant={inBackground ? undefined : 'primary'} hotkey={hotkeys ? (inBackground ? 'b' : 's') : undefined} onPress={() => void startIt()}>
      {startLabel}
    </Button>
  )
  const backgroundButton =
    startedHere === goes.number ? null : launches.some(one => one.number === goes.number && one.how === 'background') ? (
      <Text key={`starting-background-${issue.number}`} color="claude">
        ⚙ Starting in background…
      </Text>
    ) : (
      <Button key={`background-${issue.number}`} variant={inBackground ? 'primary' : undefined} hotkey={hotkeys ? (inBackground ? 's' : 'b') : undefined} onPress={() => void backgroundIt()}>
        {isEpic && target && target.number !== issue.number ? `⚙ Start #${target.number} in background` : '⚙ Start in background'}
      </Button>
    )
  const draftButton = (
    <Button key={`draft-${issue.number}`} dimColor={inBackground} hotkey={hotkeys && !inBackground ? 'e' : undefined} onPress={() => void draftIt(false)}>
      ✎ Edit first
    </Button>
  )
  const draftBackgroundButton = (
    <Button key={`draft-background-${issue.number}`} dimColor={!inBackground} hotkey={hotkeys && inBackground ? 'e' : undefined} onPress={() => void draftIt(true)}>
      ✎ Edit first in background
    </Button>
  )
  return (
    <Box key={`card-${issue.number}`} flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginLeft={2} marginBottom={1}>
      <Text bold wrap="wrap">
        {issue.title}
      </Text>
      {!data.kept(issue) && (
        <Text color="warning" wrap="wrap">{`Not under ${data.filterName}${data.typed.trim() ? ` or the search` : ''} any more. It leaves the list when you collapse it.`}</Text>
      )}
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
        <Text dimColor>{`updated ${agoText(issue.updatedAt, clock)}`}</Text>
        {issue.parent && <Text dimColor>{`in #${issue.parent.number}`}</Text>}
        {(issue.subIssues?.total ?? 0) > 0 && <Text dimColor>{`epic · ${issue.subIssues?.completed}/${issue.subIssues?.total} sub-issues closed`}</Text>}
        {issue.milestone && <Text dimColor>{`⚑ ${issue.milestone}`}</Text>}
        {(issue.blockedBy ?? []).length > 0 && <Text color="warning">{`blocked by ${issue.blockedBy?.map(number => `#${number}`).join(', ')}`}</Text>}
      </Box>
      {project && (project.status || project.priority) && (
        <Box flexDirection="column" marginTop={1}>
          {project.status && picker(elements, { issue, field: 'status', label: 'Status  ', options: project.status.options, value: issue.status }, handlers)}
          {project.priority && picker(elements, { issue, field: 'priority', label: 'Priority', options: project.priority.options, value: issue.priority }, handlers)}
        </Box>
      )}
      {prose && (
        <Box marginTop={1}>
          <Markdown key={`body-${issue.number}`} text={prose} />
        </Box>
      )}
      {step.total > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {meter(step.done, step.total, Math.max(10, Math.min(30, width - 24)))}
            <Text bold>{` ${step.done}/${step.total}`}</Text>
            <Text dimColor>{` · ${Math.round((step.done / step.total) * 100)}%`}</Text>
          </Text>
          {issue.checks.map((check, index) => (
            <Box key={`box-row-${issue.number}-${index + 1}`} flexDirection="row">
              <Box flexShrink={0}>
                <Text color={check.done ? 'success' : 'warning'}>{check.done ? '✔ ' : '☐ '}</Text>
              </Box>
              <Box flexShrink={1}>
                <Button
                  key={`box-${issue.number}-${index + 1}`}
                  plain
                  dimColor={check.done}
                  hover={{ bold: true }}
                  onPress={() => void handlers.flip(issue, index + 1, !check.done)}
                >
                  {check.text}
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor italic>
            No acceptance boxes in this issue.
          </Text>
        </Box>
      )}
      {issue.type && (
        <Text>
          <Text dimColor>Type </Text>
          {issue.type}
        </Text>
      )}
      {(() => {
        const set = Object.entries(data.fieldValues[issue.number] ?? {}).filter(([name]) => data.otherFields.some(field => field.name === name))
        return set.length > 0 ? (
          <Text wrap="wrap">
            <Text dimColor>Fields </Text>
            {set.map(([name, value]) => `${name} ${value}`).join(' · ')}
          </Text>
        ) : null
      })()}
      {conversation(elements, { ...data, issue }, handlers)}
      {worker && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color={workerBadge(worker.status).color}>{`${workerBadge(worker.status).text} `}</Text>
            <Text dimColor>{`a background agent, started ${workerAge}`}</Text>
          </Text>
          {worker.answer && (
            <Text dimColor wrap="wrap">
              {worker.answer}
            </Text>
          )}
        </Box>
      )}
      <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
        {busy ? (
          <Text key={`worker-on-${issue.number}`} color={workerBadge(busy.status).color}>
            {workerOnLine(busy.status, ago(busy.startedAt, clock), goes.number === issue.number ? undefined : goes.number)}
          </Text>
        ) : inBackground ? (
          [backgroundButton, startButton, draftBackgroundButton, draftButton]
        ) : (
          [startButton, backgroundButton, draftButton, draftBackgroundButton]
        )}
        {choice(`edit-${issue.number}`, '⚙ Change', changing === issue.number, handlers.openEditor(issue.number))}
        {link(pageOf(data.repo, 'issues', issue))}
        <Button key={`close-${issue.number}`} dimColor hotkey={hotkeys ? 'x' : undefined} onPress={handlers.toggle(issue.number)}>
          Collapse
        </Button>
      </Box>
      {changing === issue.number && editor(elements, { ...data, issue }, handlers)}
    </Box>
  )
}
