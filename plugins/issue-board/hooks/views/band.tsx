import type { ButtonProps, RenderChildren, ThemeKey } from 'claude-code'

import type { Alert, BoxTask, EpicNote, Markers, Plan, Problem, Project, Role } from '../../types'
import { accessKey } from '../access'
import { inboxTabOf, tabsOf } from '../filters'
import { agoText, cells, fit } from '../layout'
import { markerKey, markerText } from '../markers'
import { kindsText, sizeText } from '../plan'
import { adoptText, guessKey, guessText } from '../project'
import { closeOutPrompt, fixPrompt } from '../prompts'
import { pageOf } from '../rest'
import type { Elements } from './parts'
import { partsOf } from './parts'

export type BandData = {
  width: number
  clock: number
  repo: string
  // The board's project, for the Inbox's tab.
  project: Project | null
  // How often the board reads GitHub, which the project's ask names.
  refresh: number | null
  // Problems the person hasn't waved off.
  problems: Problem[]
  // The project the board reads but may not write to yet.
  unadopted: Project | null
  // A plan Claude proposed that waits on the person, with only the rows still to make.
  planned: Plan | null
  // The project whose Status guess the person hasn't answered, and the guess.
  guessed: Project | null
  guess: { role: Role; name: string }[]
  // Whether the labels Bugs and Later go by are asked about, and the ask.
  marked: boolean
  markerAsk: Partial<Markers>
  alerts: Alert[]
  // Tasks Claude completed whose boxes are still open.
  offers: { task: BoxTask; box: number }[]
  // Issues captured to the Inbox since the person last opened it.
  caught: number
  notes: EpicNote[]
}

export type BandHandlers = {
  dismiss: (alert: Alert) => Promise<unknown>
  // Hands Claude a prompt: into the prompt box while Claude is busy, sent otherwise.
  hand: (text: string) => unknown
  tickTask: (task: BoxTask) => unknown
  skipTask: (task: BoxTask) => unknown
  dismissNote: (note: EpicNote) => unknown
  copyFix: (problem: Problem, surface: Parameters<NonNullable<ButtonProps['onPress']>>[0]['surface']) => unknown
  recheck: () => unknown
  dismissProblem: (problem: Problem) => unknown
  // Opens the pane.
  review: () => unknown
  decline: (project: Project) => unknown
  confirmGuess: (project: Project) => Promise<unknown>
  openStatuses: () => Promise<unknown>
  confirmMarkers: () => Promise<unknown>
  openMarkers: () => Promise<unknown>
  // Marks a guess as asked, so the band doesn't ask it again.
  seeGuess: (seen: string) => Promise<unknown>
  openInbox: () => unknown
  clearCaptured: () => unknown
}

// The band's lines, most pressing first.
export const band = (elements: Elements, data: BandData, handlers: BandHandlers) => {
  const { Box, Text, Button } = elements
  // Each line keeps its badge, number and buttons whole, as the pane's rows do; its text is cut to what is left.
  const { link, keep } = partsOf(elements)
  const { width, clock, repo, problems, unadopted, planned, guessed, guess, marked, markerAsk, alerts, offers, caught, notes } = data
  const { hand } = handlers

  // One line of the band: `<badge> #<number> <text> <buttons> ✕`. The badge, number, buttons and ✕ keep their width;
  // the text is cut to what is left.
  const bandRow = (row: {
    key?: string
    badge: string
    color: ThemeKey
    number?: { value: number; color: ThemeKey }
    text: RenderChildren
    actions?: RenderChildren[]
    dismiss?: { key: string; onPress: () => void }
  }) => (
    <Box key={row.key} flexDirection="row" gap={1}>
      {keep(
        <Text color={row.color} inverse bold>
          {` ${row.badge} `}
        </Text>,
      )}
      {row.number && keep(<Text color={row.number.color} bold>{`#${row.number.value}`}</Text>)}
      <Text wrap="truncate-end">{row.text}</Text>
      {(row.actions ?? []).map(part => part && keep(part))}
      {row.dismiss &&
        keep(
          <Button key={row.dismiss.key} dimColor onPress={row.dismiss.onPress}>
            ✕
          </Button>,
        )}
    </Box>
  )

  const line = (alert: Alert) => {
    const gone = { key: `dismiss-${alert.key}`, onPress: () => void handlers.dismiss(alert) }
    switch (alert.kind) {
      case 'ci': {
        const { pr } = alert
        const names = pr.failing ?? []
        return bandRow({
          badge: '✗ CI',
          color: 'error',
          number: { value: pr.number, color: 'suggestion' },
          text: [
            <Text>{fit(pr.title, Math.max(12, width - 44))}</Text>,
            <Text dimColor>{` ${names.length > 0 ? fit(names.join(', '), 24) : 'failing'} on ${fit(pr.branch, 20)}`}</Text>,
          ],
          actions: [
            <Button key={`fix-${pr.number}`} variant="primary" onPress={() => void hand(fixPrompt(pr))}>
              Fix
            </Button>,
            link(pageOf(repo, 'pull', pr)),
          ],
          dismiss: gone,
        })
      }
      case 'pass': {
        const { pr } = alert
        return bandRow({
          badge: '✓ CI',
          color: 'success',
          number: { value: pr.number, color: 'suggestion' },
          text: [<Text>{fit(pr.title, Math.max(12, width - 57))}</Text>, <Text dimColor>{` passed on ${fit(pr.branch, 20)}`}</Text>],
          actions: [
            <Button key={`merge-${pr.number}`} variant="primary" onPress={() => void hand(closeOutPrompt(pr))}>
              Finish & merge
            </Button>,
            link(pageOf(repo, 'pull', pr)),
          ],
          dismiss: gone,
        })
      }
      case 'activity': {
        const { issue } = alert
        return bandRow({
          badge: '● NEW',
          color: 'warning',
          number: { value: issue.number, color: 'claude' },
          text: [<Text>{fit(issue.title, Math.max(12, width - 44))}</Text>, <Text dimColor>{` changed ${agoText(issue.updatedAt, clock)}`}</Text>],
          actions: [link(pageOf(repo, 'issues', issue))],
          dismiss: gone,
        })
      }
      case 'closed':
        return bandRow({
          badge: '✓ DONE',
          color: 'success',
          number: { value: alert.working.number, color: 'claude' },
          text: [<Text>{fit(alert.working.title, Math.max(12, width - 30))}</Text>, <Text dimColor> is closed</Text>],
          dismiss: gone,
        })
    }
  }

  const offerLine = ({ task, box }: { task: BoxTask; box: number }) =>
    bandRow({
      key: `offer-${task.id}`,
      badge: '☑ TICK?',
      color: 'success',
      number: { value: task.number, color: 'claude' },
      text: [<Text dimColor>{`box ${box} `}</Text>, <Text>{fit(task.text, Math.max(12, width - 52))}</Text>, <Text dimColor> is done</Text>],
      actions: [
        <Button key={`tick-task-${task.id}`} variant="primary" onPress={() => void handlers.tickTask(task)}>
          {`Tick box ${box}`}
        </Button>,
      ],
      dismiss: { key: `skip-task-${task.id}`, onPress: () => void handlers.skipTask(task) },
    })

  // An epic the board moved on, or that has a sub-issue open again: `◆ EPIC #35 <title> · <what happened>`.
  const epicLine = (note: EpicNote) => {
    const tail = ` · ${note.text}`
    return bandRow({
      key: `epic-row-${note.key}`,
      badge: '◆ EPIC',
      color: 'warning',
      number: { value: note.epic, color: 'claude' },
      text: [<Text>{fit(note.title, Math.max(12, width - cells(tail) - 30))}</Text>, <Text dimColor>{tail}</Text>],
      actions: [link(pageOf(repo, 'issues', { number: note.epic, url: '' }))],
      dismiss: { key: `dismiss-${note.key}`, onPress: () => void handlers.dismissNote(note) },
    })
  }

  // Something missing: what it is, the command or page that fixes it, and a look again once it's done.
  const problemLine = (problem: Problem) => {
    const how = problem.command ? `run ${problem.command}` : problem.fix
    return bandRow({
      key: `problem-row-${problem.id}`,
      badge: '⚠ SETUP',
      color: problem.blocks ? 'error' : 'warning',
      text: [<Text>{fit(problem.title, Math.max(16, width - 64))}</Text>, <Text dimColor>{` · ${fit(how, 32)}`}</Text>],
      actions: [
        problem.command && (
          <Button key={`copy-fix-${problem.id}`} variant="primary" onPress={press => void handlers.copyFix(problem, press.surface)}>
            Copy command
          </Button>
        ),
        problem.url && !problem.command && link(problem.url, '↗ Open page'),
        <Button key={`recheck-${problem.id}`} dimColor onPress={() => void handlers.recheck()}>
          Check again
        </Button>,
      ],
      dismiss: { key: `dismiss-${accessKey(problem)}`, onPress: () => void handlers.dismissProblem(problem) },
    })
  }

  // `⚠ PROJECT Let the board write to <title>, owned by <owner>? · it only reads it until you say yes`. Review opens the
  // pane, where the warning says what it would write; ✕ keeps it read-only.
  const adoptLine = (project: Project) => {
    const tail = ' · it only reads it until you say yes'
    return bandRow({
      key: 'adopt-row',
      badge: '⚠ PROJECT',
      color: 'warning',
      text: [<Text>{fit(adoptText(project, data.refresh).title, Math.max(16, width - cells(tail) - 26))}</Text>, <Text dimColor>{tail}</Text>],
      actions: [
        <Button key="adopt-review" variant="primary" onPress={() => void handlers.review()}>
          Review
        </Button>,
      ],
      dismiss: { key: 'adopt-dismiss', onPress: () => void handlers.decline(project) },
    })
  }

  // `✦ PLAN Claude's plan: 5 changes to 3 issues · Status 3 · Priority 2`. Review opens the pane at the plan's card.
  const planLine = (one: Plan) => {
    const changes = one.rows.map(row => row.change)
    const head = `Claude's plan: ${sizeText(changes)}`
    const tail = ` · ${kindsText(changes)}`
    return bandRow({
      key: 'plan-row',
      badge: '✦ PLAN',
      color: 'suggestion',
      text: [<Text>{fit(head, Math.max(16, width - 22))}</Text>, <Text dimColor>{fit(tail, Math.max(0, width - 22 - cells(head)))}</Text>],
      actions: [
        <Button key="plan-review" variant="primary" onPress={() => void handlers.review()}>
          Review
        </Button>,
      ],
    })
  }

  // A guess the board asks the person to look at: Looks right saves it; Change opens the card that picks it; ✕ leaves
  // it a guess, unasked. `id` names its row and buttons, `seen` the guess.
  const askLine = (id: 'guess' | 'labels', badge: string, text: string, seen: string, confirm: () => Promise<unknown>, change: () => Promise<unknown>) =>
    bandRow({
      key: `${id}-row`,
      badge,
      color: 'suggestion',
      text: fit(text, Math.max(16, width - 44)),
      actions: [
        <Button key={`${id}-yes`} variant="primary" onPress={() => void confirm()}>
          Looks right
        </Button>,
        <Button key={`${id}-change`} dimColor onPress={() => void handlers.seeGuess(seen).then(change)}>
          Change
        </Button>,
      ],
      dismiss: { key: `${id}-dismiss`, onPress: () => void handlers.seeGuess(seen) },
    })
  // `? STATUS Status: Todo is Ready, Doing is In progress, Shipped is Done`, changed in /issues statuses.
  const guessLine = (project: Project) =>
    askLine('guess', '? STATUS', guessText(guess), guessKey(project, guess), () => handlers.confirmGuess(project), () => handlers.openStatuses())
  // `? LABELS Bugs: the Bug issue type · Later: the label someday`, changed in /issues labels.
  const markerLine = () =>
    askLine('labels', '? LABELS', markerText(markerAsk), markerKey(markerAsk), () => handlers.confirmMarkers(), () => handlers.openMarkers())

  // `✚ INBOX 3 captured to the Inbox`. Open Inbox opens the pane at the Inbox tab, which ends the count; ✕ ends it too.
  const capturedLine = () => {
    const project = data.project
    const tab = inboxTabOf(tabsOf(project), project)
    return bandRow({
      key: 'captured-row',
      badge: '✚ INBOX',
      color: 'suggestion',
      text: fit(`${caught} captured to the Inbox`, Math.max(16, width - 32)),
      actions: [
        <Button key="captured-open" variant="primary" onPress={() => void handlers.openInbox()}>
          {tab ? 'Open Inbox' : 'Open issues'}
        </Button>,
      ],
      dismiss: { key: 'captured-dismiss', onPress: () => void handlers.clearCaptured() },
    })
  }

  return (
    <Box flexDirection="column">
      {problems.slice(0, 2).map(problemLine)}
      {unadopted && adoptLine(unadopted)}
      {planned && planLine(planned)}
      {guessed && guessLine(guessed)}
      {marked && markerLine()}
      {alerts.slice(0, 3).map(line)}
      {offers.slice(0, 3).map(offerLine)}
      {caught > 0 && capturedLine()}
      {/* Epic lines come last: they report what happened, and the lines above ask for something now. */}
      {notes.slice(-2).map(epicLine)}
    </Box>
  )
}
