import { atom, read, update } from 'claude-code'
import type { AgentSpawnResult, Caught, EngineInterface, HookFailure, ModelForkResult, Register, Timer, ToolCallResult, UiCopyArgs } from 'claude-code'

import type { Adopted, Adoption, Armed, Board, FieldValues, Flagged, BoxTask, BuiltInFilter, Check, Comment, EpicNote, Issue, Known, LabelChange, Launch, ViewChange, Markers, Milestone, Plan, PlanRow, Problem, Project, Role, Roles, StatusUpdate, PullRequest, RunWatch, Setup, SetupProject, SetupStep, Worker, Working } from '../types'
import type { IssueChanges, NewIssue } from './changes'
import type { Tab } from './filters'
import type { Ended } from './workers'
import type { Settings } from './settings'
import { featuresOff, offText, settingsOf, switchesOf, withOldKeys } from './settings'
import { TOOL_SPECS, WORKER } from './tools'
import type { Linked } from './project'
import { accessKey, authOf, problemsOf, problemsText, repoOf } from './access'
import { isBug, markerAskOf, markerKey, markerOptionsOf, markerText, markersOf } from './markers'
import type { Cause, ContextSource } from './stats'
import { countCall, countContext, countPoints, countPrompt, defineTool, kindOf, loadTool, matchesOf, minus, newStats, statsText, zero } from './stats'
import {
  ADD_ITEM,
  ARCHIVE_ITEM,
  CLEAR_VALUE,
  ISSUE_ITEMS,
  CREATE_VIEW,
  DELETE_VIEW,
  LAYOUT_NAMES,
  UPDATE_VIEW,
  VIEW_ID,
  MOVE_ITEM,
  ITEM_VALUES,
  POST_STATUS,
  SET_FIELD,
  SET_VALUE,
  LINKED_QUERY,
  adoptReason,
  adoptedOf,
  adoptTarget,
  approvedOf,
  adoptText,
  projectKeyOf,
  projectKeysOf,
  projectKeysText,
  grantsOf,
  guessKey,
  guessOf,
  guessText,
  isMutation,
  issuesQuery,
  orderFilter,
  linkedOf,
  optionOf,
  releaseReason,
  roleOf,
  rolesFor,
  startedOf,
  writeRefusal,
} from './project'
import type { Grants } from './project'
import { appliedText, issueChangesOf, planAsk, planOf, problemsOfPlan, rowsOf, rowsToMake, viewDoneText } from './plan'
import type { Planned } from './plan'
import {
  CREATE_FIELD,
  CREATE_PROJECT,
  FACTS_QUERY,
  ITEMS_QUERY,
  PRIORITIES,
  PROJECT_QUERY,
  UPDATE_FIELD,
  NEEDS_PROJECT,
  areaLabelArgs,
  bugLabelArgs,
  choicesAfterSetup,
  inboxOf,
  itemsIn,
  markStep,
  setupDone,
  statusFieldOf,
  factsOf,
  nextItemsOf,
  picksFor,
  projectOf,
  stepsOf,
  suggestAreas,
  templatePrompt,
} from './setup'
import {
  boxOf,
  checksOf,
  noBoxText,
  tickBody,
  addBoxes,
  rewordBoxes,
  withSubIssuesBox,
} from './boxes'
import {
  changedText,
  sameOwner,
  settledOf,
  transferRefusal,
  commandsOf,
  commentCommand,
  sameWorkOf,
  namesText,
  projectPartOf,
  repoChangeOf,
  statusOnly,
  filedText,
  newIssueOf,
  captureOf,
  changesOf,
  textOf,
  NOT_READ,
  NOT_READ_SENTENCE,
  movedText,
  unmovedText,
} from './changes'
import {
  epicChanges,
  epicToStart,
  liveEpicNotes,
} from './epics'
import { candidatesOf, planMoves, questionsOf } from './moves'
import { assigneesOf, filedIssueOf, filedSaid, issueFieldsOf, milestoneNamed, parentAfter, projectStepOf, withFiled } from './filing'
import type { Filed } from './filing'
import type { Answer, Answers, Questions, Unmoved } from './moves'
import {
  inboxTabOf,
  hashRows,
  isInbox,
  listOf,
  currentIterationText,
  noReadyText,
  startTargetOf,
  triageTarget,
  tabOf,
  tabsOf,
  viewFieldsOf,
  viewGroupingOf,
} from './filters'
import {
  THREADS_QUERY,
  OPEN_PRS,
  RATE_LIMITED,
  boardOf,
  rateLimitTexts,
  velocityKept,
  commentsOf,
  graphqlData,
  nextPageOf,
  parseGraph,
  parseIssues,
  threadsOf,
  TOOL_COMMENTS,
  commentsText,
  statusEnumOf,
  updateLine,
  updateWords,
} from './github'
import {
  fit,
  named,
  progress,
  since,
  sumProgress,
  summary,
  roomAbove,
} from './layout'
import type { PaneElements } from './views/parts'
import { issueRow as issueRowView } from './views/issue-row'
import type { IssueRowHandlers } from './views/issue-row'
import { prRow as prRowView } from './views/pr-row'
import type { PrRowHandlers } from './views/pr-row'
import { band as bandView } from './views/band'
import type { BandHandlers } from './views/band'
import { header as headerView, trends as trendsView } from './views/header'
import { issuesHeading as issuesHeadingView } from './views/tabs'
import { issueCard as issueCardView } from './views/card'
import type { CardData, CardHandlers } from './views/card'
import { planCard } from './views/plan'
import type { PlanHandlers } from './views/plan'
import { accessCard, adoptCard, labelsCard, setupCard, statusesCard } from './views/setup'
import { milestones as milestonesView, mergeConfirm, noBoard, projectUpdate, prsHeading, runRow } from './views/sections'
import { closedList, emptyNote, groupList, hint, viewNote } from './views/list'
import type { GroupsHandlers } from './views/list'
import { triageEntries, triageFailed, triageNote } from './views/triage'
import type { TriageHandlers } from './views/triage'
import {
  absorbed,
  alertsOf,
  copiesFor,
  copyKeyOf,
  eventRepoOf,
  greenKey,
  knownOf,
  mentionsOf,
  newsOf,
  nextStepOf,
  liveRunsOf,
  runProgressOf,
  namesIssue,
  wentGreen,
  writesGitHub,
} from './news'
import {
  answerPrompt,
  boardText,
  closeOutAllPrompt,
  closeOutPrompt,
  captureSection,
  draftPrompt,
  issueText,
  labelsOf,
  parseDraft,
  parseTriage,
  prText,
  startPrompt,
  triagePrompt,
  workingSection,
  prKeyword,
  orchestratorSection,
  toolListOf,
  openedText,
  SUBCOMMANDS,
  helpText,
} from './prompts'
import {
  notFoundText,
  foundLine,
  foundOf,
  searchTerms,
  standing,
  restCommentsOf,
  labelColorFor,
  missingLabels,
  milestoneLine,
  milestonesOf,
  itemsAt,
  projectPathOf,
  fieldValueOf,
  itemValuesOf,
  reordered,
  placedAfter,
  projectMoveOf,
  toArchive,
} from './rest'
import {
  ACTIVE,
  backgroundPrompt,
  closeOutRisk,
  endedLine,
  handoffPrompt,
  issueOfBranch,
  startedByClaude,
  workerIssueOf,
  workerOfPr,
  workerPrOf,
  workerPrompt,
} from './workers'
import { FILES_PAGE, PATCHED, fileFlags, flaggedLines } from './merging'
import type { ChangedFile } from './merging'

// ---- Atoms, and the constants the module shares ----

const PANE = 'issue-board'
// This plugin's name, as `next.origin` gives it for a `$` call of its own.
const PLUGIN = 'issue-board'

// The person's settings, from the manifest's userConfig, with what an older board's keys said. See settings.ts.
let settings: Settings = settingsOf(undefined)
// While a pull request's CI runs, the board looks again this often, so its pass or failure shows soon after.
const WATCH_MS = 30 * 1000
// The longest the board goes without a full read, even when the cheap checks see nothing: a change to a project field
// shows in none of them.
const FULL_MS = 15 * 60 * 1000
// How long the weekly counts of closed issues and merged pull requests are kept before they are read again.
const VELOCITY_MS = 60 * 60 * 1000
// `gh issue close 35`, the issue it closes.
const CLOSE = /\bgh\s+issue\s+close\s+#?(\d+)\b/
// Commands that may leave the folder on another branch.
const GIT_MOVE = /\bgit\s+(checkout|switch|worktree)\b|\bgh\s+pr\s+checkout\b/
const ISSUE_FIELDS = 'number,title,url,labels,assignees,body,updatedAt'
const ISSUES_TOOL = 'mcp__issue-board__issues'
const TICK_TOOL = 'mcp__issue-board__tick'
const UPDATE_TOOL = 'mcp__issue-board__issue_update'
const CREATE_TOOL = 'mcp__issue-board__issue_create'
const CAPTURE_TOOL = 'mcp__issue-board__capture'
const MILESTONE_TOOL = 'mcp__issue-board__milestone'
const ARCHIVE_TOOL = 'mcp__issue-board__project_archive'
const STATUS_TOOL = 'mcp__issue-board__project_status'
const ADOPT_TOOL = 'mcp__issue-board__project_adopt'
const PLAN_TOOL = 'mcp__issue-board__project_plan'
// Permission modes that settle a plugin's ask without showing it to the person: auto has a classifier decide, and
// bypassPermissions lets every call through. Adopting a project and applying a plan need the person to read the prompt,
// so project_adopt and project_plan are refused in them.
const UNSEEN_MODES = new Set(['auto', 'bypassPermissions'])

const board = atom({ plugin: 'issue-board', key: 'board' } as const, null)
const error = atom({ plugin: 'issue-board', key: 'error' } as const, null)
const loading = atom({ plugin: 'issue-board', key: 'loading' } as const, false)
const filter = atom({ plugin: 'issue-board', key: 'filter' } as const, 'active')
const expanded = atom({ plugin: 'issue-board', key: 'expanded' } as const, null)
const working = atom({ plugin: 'issue-board', key: 'working' } as const, null)
const dismissed = atom({ plugin: 'issue-board', key: 'dismissed' } as const, [])
// The one confirm waiting on a second press, so arming one cancels any other.
const armed = atom({ plugin: 'issue-board', key: 'armed' } as const, null)
const query = atom({ plugin: 'issue-board', key: 'query' } as const, '')
const viewer = atom({ plugin: 'issue-board', key: 'viewer' } as const, null)
const branch = atom({ plugin: 'issue-board', key: 'branch' } as const, null)
const greened = atom({ plugin: 'issue-board', key: 'greened' } as const, [])
// How many issues were captured to the Inbox since the person last opened it, for the band.
const captured = atom({ plugin: 'issue-board', key: 'captured' } as const, 0)
const editing = atom({ plugin: 'issue-board', key: 'editing' } as const, null)
const palette = atom({ plugin: 'issue-board', key: 'palette' } as const, null)
// What the open card's text fields hold before they are sent, by field.
const typing = atom({ plugin: 'issue-board', key: 'typing' } as const, {})
// The issues closed lately, read when the Closed filter is chosen.
const recent = atom({ plugin: 'issue-board', key: 'recent' } as const, null)
// Each issue's values in the project's other fields, read when its card opens.
const values = atom({ plugin: 'issue-board', key: 'values' } as const, {})
// Which of the pane's sections above the issues the person opened (true) or folded (false); one not set yet follows the
// pane's height. Saved with the board.
const sections = atom({ plugin: 'issue-board', key: 'sections' } as const, {})
// Whether the card's editor shows its rarer rows: type, milestone, the project's fields and closing as a duplicate.
const editorMore = atom({ plugin: 'issue-board', key: 'editorMore' } as const, false)
// Below this many rows, the sections above the issues start folded, so the issues show without scrolling.
const SHORT_ROWS = 24
const talk = atom({ plugin: 'issue-board', key: 'talk' } as const, null)
const openPr = atom({ plugin: 'issue-board', key: 'openPr' } as const, null)
const access = atom({ plugin: 'issue-board', key: 'access' } as const, null)
const groupBy = atom({ plugin: 'issue-board', key: 'groupBy' } as const, null)
const unfolded = atom({ plugin: 'issue-board', key: 'unfolded' } as const, [])
const setup = atom({ plugin: 'issue-board', key: 'setup' } as const, null)
const tasks = atom({ plugin: 'issue-board', key: 'tasks' } as const, [])
const triage = atom({ plugin: 'issue-board', key: 'triage' } as const, { suggestions: [], picks: [], areas: [], asking: false, failed: null })
const runs = atom({ plugin: 'issue-board', key: 'runs' } as const, [])
const workers = atom({ plugin: 'issue-board', key: 'workers' } as const, [])
const launching = atom({ plugin: 'issue-board', key: 'launching' } as const, [])
const epicNotes = atom({ plugin: 'issue-board', key: 'epicNotes' } as const, [])
// The issue whose start message Edit first put in the prompt box, until the person next sends a prompt.
const drafted = atom({ plugin: 'issue-board', key: 'drafted' } as const, null)
// The project the board may write to, as the store last said, and the prompts the person turned down. The prompt and
// setup read it; every write checks the store itself.
const adoption = atom({ plugin: 'issue-board', key: 'adoption' } as const, { adopted: null, declined: [] })
// `/issues statuses` while it shows, and the guessed Status mappings the person answered, as the store last said.
const statusPicks = atom({ plugin: 'issue-board', key: 'statusPicks' } as const, null)
const guessSeen = atom({ plugin: 'issue-board', key: 'guessSeen' } as const, [])
// The plan Claude proposed, shown as a card in the pane until it is applied or discarded.
const proposal = atom({ plugin: 'issue-board', key: 'plan' } as const, null)
// The Bugs and Later markers the person chose, as the store last said, and `/issues labels` while it shows.
const chosenMarkers = atom({ plugin: 'issue-board', key: 'markers' } as const, {})
const markerPicks = atom({ plugin: 'issue-board', key: 'markerPicks' } as const, null)

// The bug and later labels the board goes by: the person's choice, else the repo's own names, else `bug` and `future`.
const markersNow = async ($: EngineInterface, now: Board | null | undefined): Promise<Markers> => markersOf(now, await read($, chosenMarkers))

// Whether a tool's calls may be allowed without asking: an organization can set a ceiling, the most permissive verdict
// a call of the tool may reach. None set, they may.
const mayAllow = (ceiling: 'allow' | 'ask' | 'deny' | undefined): boolean => ceiling === undefined || ceiling === 'allow'

// The pane's tabs as it offers them: the project's views with filters, then Inbox, All and Closed; or else the built-in
// filters.
const filtersFor = (project: Project | null | undefined): Tab[] => tabsOf(project)

// How the pane opens: Esc steps back through it, a card first, then the pane (the ui.close hook).
const OPEN = { id: PANE, title: 'Issues', focus: true, closeOnEscape: true } as const

// What setting an issue's fields in the project needs of it: its number, its node, and its item there if it has one. An
// issue on the board has them; one that isn't, such as one already closed, is read from GitHub.
type Target = Pick<Issue, 'number' | 'id' | 'item'>

// ---- gh and I/O: calls and what they cost, errors, access, the saved board ----

// What the board has cost this session, for /issues stats. In memory only: a reload starts the counts over.
const stats = newStats(Date.now())

// Why the board is calling GitHub right now: the newest of the causes under way, or other. A cause is set around a poll,
// a full read, setup and the board's tools, not passed down to each call. Work that overlaps may take the other's
// cause, which is close enough for a count.
const causes: { cause: Cause }[] = []
const causeNow = (): Cause => causes.at(-1)?.cause ?? 'other'
const within = async <T,>(cause: Cause, work: () => Promise<T>): Promise<T> => {
  const token = { cause }
  causes.push(token)
  try {
    return await work()
  } finally {
    causes.splice(causes.indexOf(token), 1)
  }
}

// The cause a call counts under: one that changes GitHub is a write, unless a tool or setup made it.
const causeOf = (args: readonly string[], stdin?: string): Cause => {
  const now = causeNow()
  return now !== 'tool' && now !== 'setup' && (isMutation(args, stdin) || writesGitHub(['gh', ...args].join(' '))) ? 'write' : now
}

// Counts one gh call as it goes out.
const countGh = (args: readonly string[], stdin?: string): void => countCall(stats, causeOf(args, stdin), kindOf(args))

// Counts text the board adds to Claude's context.
const countText = (source: ContextSource, text: string): void => countContext(stats, source, text.length)

const runGh = async ($: EngineInterface, args: string[], stdin?: string, timeoutMs = 60_000): Promise<string> => {
  countGh(args, stdin)
  const { exitCode, stdout, stderr } = await $.process.run(['gh', ...args], { timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
  if (exitCode !== 0) throw new Error(stderr.trim().split('\n')[0] || `gh ${args[0]} exited ${exitCode}`)
  return stdout
}

// Every gh call but a project write. A GraphQL mutation is refused here, so one written without projectWrite fails
// loudly instead of reaching a project nobody let the board change.
const gh = async ($: EngineInterface, args: string[], stdin?: string, timeoutMs = 60_000): Promise<string> => {
  if (isMutation(args, stdin)) throw new Error('the issue board sends GraphQL mutations only through its project write check')
  return runGh($, args, stdin, timeoutMs)
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

// The time on the engine's clock, which a test can move; the system's where there is none.
const nowOf = ($: EngineInterface): Promise<number> => $.clock.now().catch(() => Date.now())

// Why a hook failed, as its `.catch` handler reads it.
const failureOf = (error: HookFailure): string => (error.kind === 'timeout' ? `ran out of time${error.message ? ` (${error.message})` : ''}` : (error.message ?? 'threw'))

// What a hook that failed falls back to: the site's own behavior, as though the board had no hook there, with why it
// failed in the debug log. In a `.catch` handler `next(e)` replays what the hook's own call settled to, so nothing
// beneath runs twice. A guard falls back the same way: a fault in the board never refuses what Claude Code would let
// run. The engine reads each handler from a function literal, so each `.catch` is one that calls this.
const fallBack = <E, R>($: EngineInterface, e: E, next: ((e: E) => R) & Caught, site: string): R => {
  $.ui.log(`issue-board: ${site} failed and was left to the default: ${failureOf(next.error)}`, { to: 'debug' })
  return next(e)
}

// What one of the board's own tools answers when its hook fails: there is nothing beneath to fall back to, so Claude
// reads why.
const toolFailed = ($: EngineInterface, next: Caught, tool: string) => {
  $.ui.log(`issue-board: the ${tool} tool failed: ${failureOf(next.error)}`, { to: 'debug' })
  return { deny: `The issue board's ${tool} tool failed: ${failureOf(next.error)}` }
}

// How each of the board's tools that changes something acts: ask, then act. A hook that answers a tool call itself
// skips the engine's permission check, which only runs beneath it, so this calls next(e) first. That runs the check,
// with the board's own tool.check verdicts, and the prompt where they leave the call at ask. Only when the call got
// through does the engine go on to find that no hook answered, and only then does `act` run. Anything else, a no
// included, is passed back as it came, and nothing changes on GitHub.
const askThenAct = async <E, R>(e: E, next: (e: E) => Promise<ToolCallResult>, act: () => Promise<R>): Promise<R | ToolCallResult> => {
  const asked = await next(e)
  return approvedOf(asked) ? act() : asked
}

// One of the board's tools at work: its gh calls count under tool, and its answer as context Claude reads.
const asTool = async <R,>(tool: string, work: () => Promise<R>): Promise<R> => {
  // Claude called the tool, so its definition is in context now, if ToolSearch hadn't loaded it already.
  loadTool(stats, tool)
  const answer = await within('tool', work)
  countText('tool results', answerText(answer))
  return answer
}

// The text Claude reads of a tool's answer: what it says, or why it was refused.
const answerText = (answer: unknown): string => {
  const { result, deny } = (answer ?? {}) as { result?: unknown; deny?: unknown }
  if (typeof deny === 'string') return deny
  if (typeof result === 'string') return result
  return result === undefined ? '' : JSON.stringify(result)
}

// What project_adopt's permission check answers when it fails. Falling back to the verdict beneath could let an allow
// rule adopt a project without a prompt, so it refuses, and says why.
const adoptCheckFailed = ($: EngineInterface, next: Caught) => {
  $.ui.log(`issue-board: the project_adopt permission check failed: ${failureOf(next.error)}`, { to: 'debug' })
  return { decision: 'deny' as const, reason: `The issue board couldn't check the project_adopt call: ${failureOf(next.error)}` }
}

// How a command that couldn't start says so, as against one that ran too long.
const MISSING = /ENOENT|not found|no such file/i
// A gh error that may come from a missing permission rather than from the request itself.
const ACCESS_ERROR = /scope|credentials|not accessible|gh auth login|HTTP 40[13]|permission/i

// What one of the board's write tools answers when its work fails: why, and when the error may come from a missing
// permission, what the access check then finds missing.
const deniedBy = async ($: EngineInterface, what: string, cause: unknown): Promise<{ deny: string }> => {
  const message = messageOf(cause)
  const problems = ACCESS_ERROR.test(message) ? await checkAccess($, message) : []
  return { deny: `${what}: ${message}${problems.length > 0 ? `\n${problemsText(problems)}` : ''}` }
}

// What a press that failed shows: a toast saying why, and the access check run when the error may come from a missing
// permission, so the pane says what to fix.
const toastFailure = ($: EngineInterface, what: string, cause: unknown): void => {
  const message = messageOf(cause)
  $.ui.toast(`${what}: ${message}`)
  if (ACCESS_ERROR.test(message)) void checkAccess($, message)
}

// Asks gh who it is signed in as and what it may do in this repository, and keeps what is missing. `message` is an
// error gh just gave, which may name a permission the token lacks. One at a time, so a check asked for during another
// runs after it with its own message.
let checking: Promise<unknown> = Promise.resolve()
const checkAccess = ($: EngineInterface, message?: string): Promise<Problem[]> => {
  const run = checking.then(async () => {
    let installed = true
    // The check runs after whatever asked for it, so it takes no cause from what else is under way.
    const ask = (args: string[]) => {
      countCall(stats, 'other', kindOf(args))
      return $.process.run(['gh', ...args], { timeoutMs: 30_000 }).catch((cause: unknown) => {
        if (MISSING.test(messageOf(cause))) installed = false
        return null
      })
    }
    const [status, view] = await Promise.all([
      ask(['auth', 'status', '--active', '--json', 'hosts']),
      ask(['repo', 'view', '--json', 'nameWithOwner,hasIssuesEnabled,viewerPermission,isArchived,visibility']),
    ])
    const auth = status?.exitCode === 0 ? authOf(status.stdout) : null
    const repo = view?.exitCode === 0 ? repoOf(view.stdout) : null
    // A folder whose repository isn't on GitHub has nothing for the board to show, so nothing is missing there.
    const onGitHub = repo !== null || /github/i.test((await $.session.repo().catch(() => null))?.remote ?? '')
    // The last project refusal counts until Check again clears it, so its fix stays shown while the board reads labels.
    const said = [message, projectRefusal].filter(Boolean).join('\n')
    const problems = onGitHub ? problemsOf({ installed, auth, repo, ...(said ? { message: said } : {}) }) : []
    // The project's "Item closed" workflow marks every closed issue Done, which the board does only for completed ones.
    // A limit, not a blocker: it can be waved off. It only counts when the board moves closed issues to Done itself:
    // with autoMove off, or a project it may not write to, turning the workflow off would leave Done empty.
    const project = (await read($, board))?.project
    if (project?.closesToDone && settings.autoMove && (await mayWrite($, project))) {
      problems.push({
        id: 'item-closed',
        title: `${project.title}'s Item closed workflow is on`,
        detail: 'It marks every closed issue Done, even one closed as not planned or as a duplicate, so Done stops meaning shipped.',
        fix: 'Turn it off in the project\'s Workflows settings: the board moves issues closed as completed to Done by itself.',
        url: `${project.url}/workflows`,
        blocks: false,
      })
    }
    const login = auth?.state === 'signed-in' && auth.login ? auth.login : null
    await update($, access, () => ({ login, repo: repo?.name ?? null, permission: repo?.permission ?? null, problems, checkedAt: Date.now() }))
    if (login && (await read($, viewer)) === null) await update($, viewer, () => login)
    return problems
  })
  checking = run.catch(() => undefined)
  return run
}

// The branch the session's folder has checked out; null on a detached head or outside git.
const currentBranch = async ($: EngineInterface): Promise<string | null> => {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'branch', '--show-current'])
    return exitCode === 0 ? stdout.trim() || null : null
  } catch {
    return null
  }
}

// The /config row for Claude Code's own PR footer ("Show PR status footer"), as `$.config.list()` names it.
const PR_FOOTER = 'prStatus'

// The branch whose pull request Claude Code's footer shows at the start of the hint row: the checked-out one, while
// the footer's row is on. null when it is off or can't be read, so the hint's tail lists every pull request as before.
const footerBranch = async ($: EngineInterface): Promise<string | null> => {
  const here = await read($, branch)
  if (!here) return null
  const rows = await $.config.list().catch(() => [])
  return rows.find(row => row.key === PR_FOOTER)?.value === true ? here : null
}

// What the board keeps between sessions, one entry per repository: a cache of what it can read from GitHub again, and
// nothing else. Every session on the repo rewrites this entry whole, so what the board may write to is a setting
// (writeProjects), and the person's choices live under a key of their own (see Choices). `version` is SAVED_VERSION
// when the entry was written; restore skips an entry of another version, whose board may lack fields this one needs.
type Saved = {
  version?: number
  board: Board | null
  working: Working | null
  dismissed: string[]
  viewer: string | null
  sections?: Record<string, boolean>
}
// Raise this when Saved or the Board it holds changes shape, so a new session reads GitHub rather than paint an old board.
const SAVED_VERSION = 1

let storeRoot: string | undefined
const rootOf = async ($: EngineInterface): Promise<string> => {
  if (storeRoot === undefined) {
    const repo = await $.session.repo().catch(() => null)
    storeRoot = repo?.root ?? (await $.session.root())
  }
  return storeRoot
}
const keyOf = async ($: EngineInterface): Promise<string> => `repo:${await rootOf($)}`

// The one way the board sends GraphQL with variables: the query and its variables as JSON on stdin, which carries
// lists and nulls as they are, and the answer's errors thrown. A read goes through gh(), which refuses a mutation; only
// projectWrite passes `write`, once its check has let the write through.
const postGraphql = async ($: EngineInterface, query: string, variables: Record<string, unknown>, write = false): Promise<Record<string, any>> => {
  const args = ['api', 'graphql', '--input', '-']
  const stdin = JSON.stringify({ query, variables })
  return graphqlData(await (write ? runGh($, args, stdin) : gh($, args, stdin)))
}

// A GraphQL read sent as gh's `-f` fields, as the issues pages and the review threads are, answered as gh gave it once
// its errors are checked.
const getGraphql = async ($: EngineInterface, args: string[]): Promise<string> => {
  const out = await gh($, args)
  graphqlData(out)
  return out
}

const save = async ($: EngineInterface): Promise<void> => {
  try {
    // Without the issues' bodies, which the next refresh brings back, to keep the store small.
    const now = await read($, board)
    const kept = now && { ...now, issues: now.issues.map(issue => ({ ...issue, body: '' })) }
    const saved: Saved = {
      version: SAVED_VERSION,
      board: kept,
      working: await read($, working),
      dismissed: await read($, dismissed),
      viewer: await read($, viewer),
      sections: await read($, sections),
    }
    await $.store.set(await keyOf($), saved)
  } catch (cause) {
    $.ui.log(`issue-board: couldn't save the board: ${messageOf(cause)}`, { to: 'debug' })
  }
}

// A new session paints the last board at once and still knows the issue Claude was on; a reload keeps its own. What a
// refresh wrote meanwhile stays: it is newer than the saved copy.
const restore = async ($: EngineInterface): Promise<void> => {
  await loadAdoption($)
  if ((await read($, board)) !== null) return
  try {
    const saved = (await $.store.get(await keyOf($))) as Partial<Saved> | undefined
    if (!saved || saved.version !== SAVED_VERSION) return
    if (saved.board) await update($, board, now => now ?? saved.board ?? null)
    if (saved.working) await update($, working, now => now ?? saved.working ?? null)
    if (saved.dismissed) await update($, dismissed, now => (now.length > 0 ? now : (saved.dismissed ?? [])))
    if (saved.viewer) await update($, viewer, now => now ?? saved.viewer ?? null)
    if (saved.sections) await update($, sections, now => (Object.keys(now).length > 0 ? now : (saved.sections ?? {})))
  } catch (cause) {
    $.ui.log(`issue-board: couldn't read the saved board: ${messageOf(cause)}`, { to: 'debug' })
  }
}

// Check again: look, say what is left, and read GitHub once nothing is.
const recheck = async ($: EngineInterface): Promise<void> => {
  projectRefusal = undefined
  const left = await checkAccess($)
  $.ui.toast(left.length === 0 ? 'The issue board has what it needs.' : `Still missing: ${left.map(problem => problem.title).join(' · ')}`)
  if (left.length === 0) void refresh($)
}

// Copies a problem's command, or the page its fix happens on, for the person to run or open.
const copyFix = async ($: EngineInterface, problem: Problem, surface?: UiCopyArgs['surface']): Promise<void> => {
  const text = problem.command ?? problem.url ?? problem.fix
  const copied = await $.ui.copy({ text, ...(surface ? { surface } : {}) })
  if (!copied.isCopied) $.ui.toast(`Couldn't copy it. ${problem.fix}`)
  else $.ui.toast(problem.command ? `Copied \`${text}\`. Run it in a terminal, then press Check again.` : `Copied ${text}. Open it in the browser, then press Check again.`)
}

const dismissProblem = async ($: EngineInterface, problem: Problem): Promise<void> => {
  await update($, dismissed, list => [...list.slice(-50), accessKey(problem)])
  await save($)
}

// ---- Adoption and grants, and the person's other choices for the repo ----

// The person's choices for the repo, kept apart from the shared entry, which is only a cache: `declined` the projects
// whose prompt the person turned down, `statuses` the Status mapping setup, /issues statuses or Looks right saved, by
// project id, and `guessSeen` the guessed mappings the person answered (the Bugs and Later guesses among them).
// `markers` are the Bugs and Later labels /issues labels or Looks right saved. `preferred` is the project setup last
// applied to, which the board reads when the repo has several.
type Choices = {
  declined?: string[]
  statuses?: Record<string, Roles>
  guessSeen?: string[]
  markers?: Partial<Markers>
  preferred?: string
}

// The setting that lists the projects the board may write to, as `$.config.set` names it.
const WRITE_PROJECTS = 'issue-board.writeProjects'
// The project last adopted in this module, so the board can name it before it reads it, as after setup made it.
let lastAdopted: Adopted | null = null

const choicesKeyOf = async ($: EngineInterface): Promise<string> => `choices:${await rootOf($)}`

// The person's choices, read fresh. Empty when none are saved.
const choicesOf = async ($: EngineInterface): Promise<Choices> => ((await $.store.get(await choicesKeyOf($))) as Choices | null | undefined) ?? {}

// The person's choices for the readers that carry on without them: empty when the store can't be read.
const savedChoices = async ($: EngineInterface): Promise<Choices> => {
  try {
    return await choicesOf($)
  } catch {
    return {}
  }
}

// The project of this repo the board may write to: the one it reads, when it may write there, or else the one this
// module adopted last, while it still may. Null when neither. `granted` says this repo's own settings grant it.
const adoptedNow = async ($: EngineInterface): Promise<Adopted | null> => {
  const grants = await grantsNow($)
  const reads = (await read($, board))?.project
  const record = reads ? adoptedOf(reads) : null
  const found =
    record && grants.all.includes(record.key)
      ? record
      : lastAdopted && grants.all.includes(lastAdopted.key)
        ? lastAdopted
        : null
  return found && grants.repo.includes(found.key) ? { ...found, granted: true } : found
}

// The board's options one settings file holds, under each name Claude Code keys the board by. Empty when it holds
// none, or can't be read.
const storedIn = async ($: EngineInterface, source: 'user' | 'project' | 'local'): Promise<Record<string, unknown>[]> => {
  try {
    const configs = ((await $.settings.read({ source })) as { pluginConfigs?: Record<string, { options?: Record<string, unknown> }> }).pluginConfigs ?? {}
    return Object.entries(configs).flatMap(([name, config]) => (name === 'issue-board' || name.startsWith('issue-board@') ? [config.options ?? {}] : []))
  } catch {
    // A source that can't be read holds nothing the board could tell.
    return []
  }
}

// The writeProjects values one settings file holds. Empty when it holds none, or can't be read.
const grantsIn = async ($: EngineInterface, source: 'user' | 'project' | 'local'): Promise<string[]> =>
  (await storedIn($, source)).flatMap(options => projectKeysOf(options.writeProjects))

// The board's options as the settings files hold them, a later source over an earlier one, as Claude Code merges them.
// Unlike the options the board is loaded with, they keep keys plugin.json no longer declares, which withOldKeys reads.
const storedOptions = async ($: EngineInterface): Promise<Record<string, unknown>> =>
  Object.assign({}, ...(await storedIn($, 'user')), ...(await storedIn($, 'project')), ...(await storedIn($, 'local')))

// The one answer to which projects the board may write to, for the write gate, the prompt, setup and project_adopt
// alike. The repo's own .claude/settings.json and settings.local.json count, read straight from the files: Claude Code
// may not pass a value to the board's options that it can't show in /config, as with the list the setting used to be.
const grantsNow = async ($: EngineInterface): Promise<Grants> => {
  const repo = [...(await grantsIn($, 'project')), ...(await grantsIn($, 'local'))]
  return grantsOf(settings.writeProjects, await grantsIn($, 'user'), repo)
}

// Sets writeProjects. A plugin's options are fixed for each load, and Claude Code reloads the board with the new value
// after the change, so the module goes by it from here: the change counts at once in this session, before and after
// the reload. Other sessions see it by the next time they load the board.
const writeSetting = async ($: EngineInterface, keys: string[]): Promise<void> => {
  const done = await $.config.set({ key: WRITE_PROJECTS, value: projectKeysText(keys) })
  if (done.deny !== undefined) throw new Error(done.deny)
  settings = { ...settings, writeProjects: keys }
  await loadAdoption($)
}

// The adoption as the setting has it and the declines as the store does, for the prompt and setup to draw.
const loadAdoption = async ($: EngineInterface): Promise<void> => {
  const saved = await savedChoices($)
  const adopted = await adoptedNow($)
  const next = { adopted, declined: saved.declined ?? [] }
  const was = await read($, adoption)
  if (JSON.stringify(was.adopted) !== JSON.stringify(next.adopted) || was.declined.join() !== next.declined.join()) await update($, adoption, () => next)
  const seen = saved.guessSeen ?? []
  if ((await read($, guessSeen)).join() !== seen.join()) await update($, guessSeen, () => seen)
  const marks = saved.markers ?? {}
  if (JSON.stringify(await read($, chosenMarkers)) !== JSON.stringify(marks)) await update($, chosenMarkers, () => marks)
}

// Changes the person's choices: turning a prompt down, a Status mapping, an answered guess. It reads the choices key just
// before writing it, so a change another session made meanwhile to a different field stays.
const changeChoices = async ($: EngineInterface, change: (was: Choices) => Choices): Promise<void> => {
  const was = await choicesOf($)
  await $.store.set(await choicesKeyOf($), change(was))
  await loadAdoption($)
}

// The person let the board write to a project, through its prompt, Apply in setup or project_adopt: writeProjects gets
// its owner/number, and keeps the others. The setting is written last, since the reload it brings may cut short what
// the module does after. Apply passes `later` and writes it once its steps are done, going by the project meanwhile.
const adoptProject = async ($: EngineInterface, project: { id: string; number: number; title: string; url: string }, later = false): Promise<void> => {
  const record = adoptedOf(project)
  if (!record) throw new Error(`the board can't tell who owns ${project.title} from its page, ${project.url || 'which it has none of'}`)
  const key = record.key
  await changeChoices($, was => ({ ...was, declined: (was.declined ?? []).filter(id => id !== project.id) }))
  lastAdopted = record
  const keys = [...(await grantsNow($)).own.filter(one => one !== key), key]
  if (!later) return writeSetting($, keys)
  settings = { ...settings, writeProjects: keys }
  await loadAdoption($)
}

// Release, in setup or project_adopt: that project leaves writeProjects, the others stay, and the board only reads it
// again. A project this repo's own settings grant can't be released here.
const releaseProject = async ($: EngineInterface, project: Adopted): Promise<void> => {
  const grants = await grantsNow($)
  if (grants.repo.includes(project.key)) throw new Error(grantedText(project.title))
  await writeSetting($, grants.own.filter(one => one !== project.key))
}

// Why Release can't take away a project the repo's own settings grant.
const grantedText = (title: string): string =>
  `This repo's .claude/settings.json lets the board write to ${title}, so it can't be released here. To release it, take it out of writeProjects in that file.`

// Keep read-only on the prompt: it isn't asked again for that project. Setup can still adopt it.
const declineProject = async ($: EngineInterface, project: { id: string }): Promise<void> => {
  await changeChoices($, was => ({ ...was, declined: [...(was.declined ?? []).filter(id => id !== project.id), project.id].slice(-20) }))
}

// The one way the board writes to a project. Every mutation, from Start, triage, the tools, the moves a read makes and
// setup, comes here, and is refused unless its project is the one adopted for this repo.
const projectWrite = async (
  $: EngineInterface,
  target: { number: number; title: string; url: string } | 'new',
  query: string,
  variables: Record<string, string | number | boolean | null | object>,
): Promise<Record<string, any>> => {
  const refusal = writeRefusal((await grantsNow($)).all, target)
  if (refusal) throw new Error(refusal)
  return postGraphql($, query, variables, true)
}

// Whether the board may write to a project, for the work it does by itself, which skips a project it may not write
// to without a word: /issues check and /issues help say so.
const mayWrite = async ($: EngineInterface, project: { number: number; title: string; url: string }): Promise<boolean> => writeRefusal((await grantsNow($)).all, project) === null

// Why the board may not write to the project it reads for this repo, or null when it may or reads none. The write tools
// check this before they ask, so the person never approves a change the gate would refuse straight after. A caller
// that has read the board already passes it, so the answer is about the same board it goes on to work with.
const boardRefusal = async ($: EngineInterface, known?: Pick<Board, 'project'> | null): Promise<string | null> => {
  const project = (known === undefined ? await read($, board) : known)?.project
  return project ? writeRefusal((await grantsNow($)).all, project) : null
}

// What the pane and the band ask about the project the board reads, or null: nothing once the board may write to it, or
// once the person kept it read-only.
const adoptAsk = (project: Project, now: Adoption): { title: string; lines: string[] } | null =>
  (now.adopted && now.adopted.key === projectKeyOf(project)) || now.declined.includes(project.id) ? null : adoptText(project, settings.refresh)

// Let it write, on the prompt.
const adoptFromPrompt = async ($: EngineInterface, project: Project): Promise<void> => {
  try {
    await adoptProject($, project)
    $.ui.toast(`The board may write to ${project.title} now. Release it in /issues setup.`)
  } catch (cause) {
    $.ui.toast(`Couldn't save that the board may write to ${project.title}: ${messageOf(cause)}`)
  }
}

// Keep read-only, on the prompt.
const declineFromPrompt = async ($: EngineInterface, project: Project): Promise<void> => {
  try {
    await declineProject($, project)
    $.ui.toast(`The board only reads ${project.title}. To let it write later, run /issues setup and press Apply.`)
  } catch (cause) {
    $.ui.toast(`Couldn't save that: ${messageOf(cause)}`)
  }
}

// Saves which Status option plays each part for a project, in the store only: nothing goes to GitHub, and saving a
// mapping isn't letting the board write to the project. The board goes by it at once.
const saveRoles = async ($: EngineInterface, project: { id: string }, roles: Roles): Promise<void> => {
  await changeChoices($, was => ({ ...was, statuses: { ...(was.statuses ?? {}), [project.id]: roles } }))
  await update($, board, now => (now?.project?.id === project.id ? { ...now, project: { ...now.project, roles: rolesFor(now.project.status, roles), guessed: false } } : now))
}

// A guessed mapping the person answered: the band doesn't show it again, in this session or another.
const seeGuess = async ($: EngineInterface, key: string): Promise<void> => {
  try {
    await changeChoices($, was => ({ ...was, guessSeen: [...(was.guessSeen ?? []).filter(one => one !== key), key].slice(-20) }))
  } catch (cause) {
    $.ui.toast(`Couldn't save that: ${messageOf(cause)}`)
  }
}

// Looks right, on the band's guess: the board keeps going by it, saved so it isn't a guess any more.
const confirmGuess = async ($: EngineInterface, project: Project): Promise<void> => {
  const key = guessKey(project, guessOf(project))
  try {
    await saveRoles($, project, project.roles ?? {})
    await seeGuess($, key)
    $.ui.toast(`Saved which Status is which for ${project.title}. Change it with /issues statuses.`)
  } catch (cause) {
    $.ui.toast(`Couldn't save which Status is which: ${messageOf(cause)}`)
  }
}

// `/issues statuses`, and Change on the band's guess: the Which Status is which step alone, at the top of the pane,
// starting from what the board goes by now. Null when the board has no project with a Status field to map.
const openStatuses = async ($: EngineInterface): Promise<Project | null> => {
  if ((await read($, board)) === null) await refresh($)
  const project = (await read($, board))?.project
  if (!project?.status) return null
  const picks = { ...(project.roles ?? rolesFor(project.status, undefined)) }
  await update($, statusPicks, () => ({ project: { id: project.id, title: project.title }, options: project.status?.options ?? [], picks }))
  await $.ui.open(OPEN)
  return project
}

// Save, in /issues statuses.
const saveStatuses = async ($: EngineInterface): Promise<void> => {
  const shown = await read($, statusPicks)
  if (!shown) return
  try {
    await saveRoles($, shown.project, shown.picks)
    await update($, statusPicks, () => null)
    $.ui.toast(`Saved which Status is which for ${shown.project.title}. Nothing changed on GitHub.`)
  } catch (cause) {
    $.ui.toast(`Couldn't save which Status is which: ${messageOf(cause)}`)
  }
}

// Saves the Bugs and Later markers the person chose, in the store only: nothing goes to GitHub. The board goes by them at
// once, in this session and the next.
const saveMarkers = async ($: EngineInterface, chosen: Partial<Markers>): Promise<void> => {
  await changeChoices($, was => ({ ...was, markers: { ...(was.markers ?? {}), ...chosen } }))
}

// Looks right, on the band's Bugs and Later guess: saved, so it isn't a guess any more.
const confirmMarkers = async ($: EngineInterface, ask: Partial<Markers>): Promise<void> => {
  try {
    await saveMarkers($, ask)
    await seeGuess($, markerKey(ask))
    $.ui.toast('Saved which labels Bugs and Later go by. Change them with /issues labels.')
  } catch (cause) {
    $.ui.toast(`Couldn't save which labels Bugs and Later go by: ${messageOf(cause)}`)
  }
}

// `/issues labels`, and Change on the band's guess: which label or issue type Bugs goes by, and without a project which
// label Later does, at the top of the pane, starting from what the board goes by now.
const openMarkers = async ($: EngineInterface): Promise<void> => {
  if ((await read($, board)) === null) await refresh($)
  const now = await read($, board)
  const picks = await markersNow($, now)
  await update($, markerPicks, () => ({ ...markerOptionsOf(now, picks), later: !now?.project, picks }))
  await $.ui.open(OPEN)
}

// Save, in /issues labels.
const saveMarkerPicks = async ($: EngineInterface): Promise<void> => {
  const shown = await read($, markerPicks)
  if (!shown) return
  try {
    await saveMarkers($, shown.later ? shown.picks : { bug: shown.picks.bug })
    await update($, markerPicks, () => null)
    $.ui.toast('Saved which labels Bugs and Later go by. Nothing changed on GitHub.')
  } catch (cause) {
    $.ui.toast(`Couldn't save which labels Bugs and Later go by: ${messageOf(cause)}`)
  }
}

// Releases the adopted project, and has setup, when it shows, offer to adopt it once more. Release in setup and the
// project_adopt tool both come here.
const releaseNow = async ($: EngineInterface, project: Adopted): Promise<void> => {
  await releaseProject($, project)
  await update($, setup, now =>
    now && 'facts' in now && now.phase !== 'applying'
      ? { ...now, phase: 'ready' as const, facts: { ...now.facts, adopted: null }, steps: stepsOf({ ...now.facts, adopted: null }, now.chosen, now.areas, now.roles) }
      : now,
  )
}

// Release, in setup, of the linked project it says the board may write to: the board only reads it again, and the plan
// offers to adopt it once more.
const releaseFromSetup = async ($: EngineInterface, project: SetupProject | undefined): Promise<void> => {
  const was = project && adoptedOf(project)
  if (!was) return
  try {
    await releaseNow($, was)
  } catch (cause) {
    $.ui.toast(`Couldn't release ${was.title}: ${messageOf(cause)}`)
    return
  }
  $.ui.toast(`Released ${was.title}: the board only reads it now.`)
}

// What a project_adopt call would do: release the adopted project, adopt one, or nothing, with why. It is worked out
// afresh for the permission check and again for the call, so the prompt and the change name the same project.
type AdoptPlan = { release: Adopted } | { adopt: Linked } | { refusal: string }
const adoptPlan = async ($: EngineInterface, input: unknown): Promise<AdoptPlan> => {
  const ask = (input ?? {}) as { number?: unknown; release?: unknown }
  const was = await adoptedNow($)
  if (ask.release === true) {
    if (!was) return { refusal: "The board writes to no project for this repo, so there's nothing to release." }
    return was.granted ? { refusal: grantedText(was.title) } : { release: was }
  }
  const number = ask.number
  if (number !== undefined && !(typeof number === 'number' && Number.isInteger(number) && number > 0)) return { refusal: 'number is a project number, such as 8.' }
  const now = await read($, board)
  if (!now) return { refusal: NOT_READ_SENTENCE }
  const reads = now.project ? { id: now.project.id, number: now.project.number, title: now.project.title, url: now.project.url } : null
  // The linked projects are read only for a number other than the one the board reads.
  let linked: Linked[] = []
  if (number !== undefined && reads?.number !== number) {
    const [owner = '', name = ''] = now.repo.split('/')
    linked = linkedOf(await postGraphql($, LINKED_QUERY, { owner, name }))
  }
  const target = adoptTarget(reads, linked, number, now.repo)
  if (typeof target === 'string') return { refusal: target }
  const key = projectKeyOf(target)
  if (key && (await grantsNow($)).all.includes(key)) return { refusal: `The board already writes to ${target.title}; nothing changed.` }
  return { adopt: target }
}

// The permission mode as the classic hooks last gave it, for project_adopt and project_plan to tell whether their
// prompt would be seen. Undefined until one says.
let permissionMode: string | undefined

// The mode in force when it is one that settles prompts unseen, else undefined.
const unseenMode = (): string | undefined => (permissionMode && UNSEEN_MODES.has(permissionMode) ? permissionMode : undefined)

// What project_plan answers in such a mode. The plan is on the card by then, so the person can still apply it.
const planUnseen = (mode: string): string =>
  `The ${mode} permission mode settles prompts without showing them, and a plan needs the person to read it. ` +
  'The plan is on the card in /issues: ask the person to apply it there with Apply, or to switch to a mode that asks, and try again.'

// `/issues statuses`: picking an option for a part.
const pickStatus = ($: EngineInterface, role: Role, id: string | null): Promise<unknown> =>
  update($, statusPicks, was => {
    if (!was) return was
    // One option plays one part: picking it for this role takes it from any other.
    const picks: Roles = Object.fromEntries(Object.entries(was.picks).filter(([other, one]) => other !== role && one !== id))
    return { ...was, picks: id === null ? picks : { ...picks, [role]: id } }
  })

// ---- Refresh and poll, with the movers ----

// How many times Claude ran git or gh this session, and how many it had when the board last began reading GitHub: a
// turn that ends with more reads it again.
let touches = 0
let readTouches = 0

// The next step the prompt box suggests after Claude's last turn, if any. The engine's own guess gives way to it.
let nextStep: string | null = null

// Makes an issue the one Claude is on in this session: the system prompt names it, and the next prompts note what
// changes on it from here.
const track = async ($: EngineInterface, issue: Issue, started = false): Promise<void> => {
  const sessionId = await $.session.id().catch(() => undefined)
  const known = knownOf(issue, (await read($, board))?.prs ?? [])
  await update($, working, () => ({ number: issue.number, title: issue.title, updatedAt: issue.updatedAt, ...(sessionId ? { sessionId } : {}), known, ...(started ? { started } : {}) }))
  await save($)
}

// The branch the folder has checked out. Moving to a branch named for an issue open on the board, such as
// `fix/315-glide`, makes that issue the one Claude is on, unless it already is in this session.
const followBranch = async ($: EngineInterface, name: string | null): Promise<void> => {
  const was = await read($, branch)
  await update($, branch, () => name)
  // Turned off, the branch still marks its pull request, but names no issue for Claude.
  const number = name === was || !settings.followBranch ? null : issueOfBranch(name)
  const issue = number === null ? undefined : (await read($, board))?.issues.find(one => one.number === number)
  if (!issue) return
  const doing = await read($, working)
  if (doing?.number === issue.number && doing.sessionId !== undefined && doing.sessionId === (await $.session.id().catch(() => undefined))) return
  await track($, issue)
  $.ui.toast(`Working on #${issue.number} now: the branch ${name} is for it`)
}

// The next look at GitHub: soon while a pull request's CI runs, every five minutes otherwise (or as often as set), and
// once the rate limit resets after it ran out. Each look sets the next one. Set to only when asked, there is none: the
// board reads on /issues refresh, r, and after Claude's turns that ran git or gh.
let timer: Timer | undefined
const schedule = async ($: EngineInterface, now: Board | null): Promise<void> => {
  timer?.cancel()
  if (settings.refresh === null) return
  const watching = now?.prs.some(pr => pr.ci === 'pending') ?? false
  const clock = await nowOf($)
  const wait = pausedUntil > clock ? pausedUntil - clock + 5_000 : watching ? WATCH_MS : settings.refresh * 60 * 1000
  timer = $.clock.after(wait, () => void poll($))
}

// Until when GitHub's rate limit has run out for the account, if it has. Every session and agent shares the limit, so
// the board reads nothing until then rather than spend what is left.
let pausedUntil = 0

// The ETag GitHub last answered each cheap check with, by path. A check sends it back, and an answer of 304, nothing
// changed, doesn't count against the rate limit.
const etags = new Map<string, string>()

// What the cheap checks look at: the repo's issues and pull requests by their last change, which moves on a new one, an
// edit, a comment, a label or a close, and the check runs of each pull request whose CI is running.
const cheapChecksOf = (now: Board): string[] => [
  `repos/${now.repo}/issues?state=all&sort=updated&direction=desc&per_page=10`,
  ...now.prs.filter(pr => pr.ci === 'pending' && pr.sha).map(pr => `repos/${now.repo}/commits/${pr.sha}/check-runs?per_page=100`),
]

// Whether a REST read of `path` changed since the board last asked. True when it can't tell, so the board reads.
const changed = async ($: EngineInterface, path: string): Promise<boolean> => {
  const known = etags.get(path)
  // Taken as the call goes out: the cause may be another by the time GitHub answers.
  const cause = causeNow()
  try {
    const { stdout } = await $.process.run(['gh', 'api', '-i', ...(known ? ['-H', `If-None-Match: ${known}`] : []), path], { timeoutMs: 30_000 })
    const status = /^HTTP\/[\d.]+ (\d{3})/m.exec(stdout)?.[1]
    countCall(stats, cause, status === '304' ? 'rest304' : 'rest')
    if (status === '304') return false
    const tag = /^etag: *(.+)$/im.exec(stdout)?.[1]?.trim()
    if (status === '200' && tag) etags.set(path, tag)
    return true
  } catch {
    return true
  }
}

// The timer's look at GitHub. A full read costs GraphQL points; the cheap checks cost none when nothing changed. So the
// board reads in full when a check saw a change, or when its last full read is FULL_MS old. Another session's newer read
// of the same repo is taken as it is.
const poll = ($: EngineInterface): Promise<void> => within('poll', () => look($))

const look = async ($: EngineInterface): Promise<void> => {
  readTouches = touches
  const now = await read($, board)
  const clock = await nowOf($)
  if (pausedUntil > clock) return schedule($, now)
  if (!now || clock - now.fetchedAt >= FULL_MS) return refresh($)
  const shared = await adopt($, now)
  if (shared) return schedule($, shared)
  const seen = await Promise.all(cheapChecksOf(now).map(path => changed($, path)))
  if (seen.some(Boolean)) return refresh($)
  schedule($, now)
}

// After a full read: the cheap checks learn GitHub's answer now, so the next look can tell whether it changed since.
const prime = async ($: EngineInterface, now: Board): Promise<void> => {
  await Promise.all(cheapChecksOf(now).map(path => changed($, path)))
}

// Another session's read of the same repo, saved since this one's: the board takes it rather than read GitHub again.
// The saved copy has no bodies, so each issue keeps the body this board has for it while it is unchanged.
const adopt = async ($: EngineInterface, now: Board): Promise<Board | null> => {
  try {
    const saved = ((await $.store.get(await keyOf($))) as Partial<Saved> | undefined)?.board
    if (!saved || saved.repo !== now.repo || saved.fetchedAt <= now.fetchedAt) return null
    const issues = saved.issues.map(issue => {
      const mine = now.issues.find(one => one.number === issue.number)
      return issue.body === '' && mine && mine.updatedAt === issue.updatedAt ? { ...issue, body: mine.body } : issue
    })
    const taken = { ...saved, issues }
    await land($, now, taken, false)
    return taken
  } catch (cause) {
    $.ui.log(`issue-board: couldn't read another session's board: ${messageOf(cause)}`, { to: 'debug' })
    return null
  }
}

// When the rate limit resets, as GraphQL itself says: it still answers this once the limit has run out. A minute from
// now for a limit on how fast calls come, which resets sooner, or when GraphQL can't say.
const resetOf = async ($: EngineInterface, message: string): Promise<number> => {
  const soon = (await nowOf($)) + 60_000
  if (/secondary/i.test(message)) return soon
  try {
    const data = graphqlData(await gh($, ['api', 'graphql', '-f', 'query={ rateLimit { resetAt } }'])) as { rateLimit?: { resetAt?: string } }
    const at = Date.parse(data.rateLimit?.resetAt ?? '')
    return Number.isNaN(at) ? soon : at
  } catch {
    return soon
  }
}

// What one page of the issues query says about the rate limit: what it cost, and what is left.
const costOf = (page: string): { cost: number; remaining: number; resetAt: string } | null => {
  try {
    const limit = (JSON.parse(page) as { data?: { rateLimit?: { cost: number; remaining: number; resetAt: string } } }).data?.rateLimit
    return limit ?? null
  } catch {
    return null
  }
}

// GitHub refusing to show projects for want of a permission, which reading issues without them answers.
const PROJECT_REFUSED = /read:project|\bproject\b.*\bscope|projectsV2|projectItems/i
const PAGES = 3

// The error GitHub last gave for projects. Until Check again clears it, the board reads issues without projects rather
// than be refused each time, and the permission check keeps saying how to fix it.
let projectRefusal: string | undefined

// The open issues over GraphQL, up to 300, with the repo's project when gh may read it.
const fetchIssues = async ($: EngineInterface, nameWithOwner: string): Promise<{ issues: Issue[]; project: Project | null; types: string[]; labels?: string[] }> => {
  const [owner = '', name = ''] = nameWithOwner.split('/')
  const kept = await savedChoices($)
  const preferred = kept.preferred
  // Another session may have adopted or released the project meanwhile; the prompt follows.
  await loadAdoption($)
  const pull = async (withProject: boolean, fields: readonly string[] = []): Promise<{ issues: Issue[]; project: Project | null; types: string[]; labels?: string[] }> => {
    const pages: string[] = []
    let after: string | null = null
    do {
      const page: string = await getGraphql($, ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, ...(after ? ['-f', `after=${after}`] : []), ...(withProject ? ['-f', `order=${orderFilter(owner, name)}`] : []), '-f', `query=${issuesQuery(withProject, fields)}`])
      pages.push(page)
      after = nextPageOf(page)
    } while (after && pages.length < PAGES)
    const limits = pages.map(costOf).filter(limit => limit !== null)
    for (const limit of limits) countPoints(stats, limit)
    const last = limits.at(-1)
    if (last) {
      const cost = limits.reduce((sum, limit) => sum + limit.cost, 0)
      $.ui.log(`issue-board: the issues query cost ${cost} GraphQL points over ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}; ${last.remaining} left until ${last.resetAt}`, { to: 'debug' })
    }
    const parsed = parseGraph(pages, preferred, fields)
    // The project's views may filter or group by fields beyond Status and Priority. Their values are read with the
    // issues, named from the views the last read found. When the views now name a field that read didn't ask for, as on
    // the first read or after a view changed, the issues are read once more with it.
    const wanted = viewFieldsOf(parsed.project)
    if (withProject && wanted.some(field => !fields.includes(field))) return pull(true, wanted)
    // The board goes by the roles saved for the project it reads, by setup or /issues statuses, or else by the names,
    // which is a guess for the band to confirm.
    if (!parsed.project) return parsed
    const roles = kept.statuses?.[parsed.project.id]
    return { ...parsed, project: { ...parsed.project, roles: rolesFor(parsed.project.status, roles), guessed: roles === undefined } }
  }
  const unread = projectRefusal !== undefined || ((await read($, access))?.problems.some(problem => problem.id === 'scope-project') ?? false)
  if (!unread) {
    try {
      const last = viewFieldsOf((await read($, board))?.project)
      return await pull(true, last)
    } catch (cause) {
      const message = messageOf(cause)
      if (!PROJECT_REFUSED.test(message)) throw cause
      projectRefusal = message
      void checkAccess($, message)
    }
  }
  return pull(false)
}

// The refresh under way, if any. A module variable, not state: /clear empties the state while a refresh may still run,
// and a reload starts the module over while the state stays. Neither must leave the board waiting on a refresh that
// nobody runs.
let refreshing: Promise<void> | undefined

// How many times the session started over in this process, and whether it did since the board last read its saved copy
// and GitHub. A /clear (or /new, its alias) or a /resume starts a new session in the same process: the host empties
// every plugin's state, and no `session.start` follows.
let restarts = 0
let restarted = false

// Reads GitHub into the board. A refresh asked for while one runs waits for that one. `seen`: the refresh follows
// Claude's own gh write, so the issue it is on changed by its hand, not news.
const refresh = ($: EngineInterface, seen = false): Promise<void> => {
  if (refreshing) return refreshing
  const began = restarts
  const run = within('full read', () => readGitHub($, seen)).finally(() => {
    refreshing = undefined
  })
  refreshing = run
  // The session started over while it ran, so some of what it wrote went with the old state: read GitHub again.
  return run.then(() => (restarts === began ? undefined : refresh($, seen)))
}

// A new session in the same process: the board shows its saved copy at once, checks access again, and reads GitHub.
const begin = async ($: EngineInterface): Promise<void> => {
  restarted = false
  await restore($)
  void checkAccess($)
  await refresh($)
}

// The repository the folder is, as gh names it: read once a session, since it doesn't change.
let repoInfo: { nameWithOwner: string; hasIssuesEnabled: boolean } | undefined
const repoNow = async ($: EngineInterface): Promise<{ nameWithOwner: string; hasIssuesEnabled: boolean }> =>
  (repoInfo ??= JSON.parse(await gh($, ['repo', 'view', '--json', 'nameWithOwner,hasIssuesEnabled'])) as { nameWithOwner: string; hasIssuesEnabled: boolean })

const readGitHub = async ($: EngineInterface, seen: boolean): Promise<void> => {
  // The rate limit ran out: the timer set for its reset reads then.
  if (pausedUntil > (await nowOf($))) return
  await update($, loading, () => true)
  readTouches = touches
  // What the board had spent when the read began, so the stats can say what this read cost.
  const spent = { calls: { ...(stats.calls['full read'] ?? zero()) }, points: stats.points }
  const before = await read($, board)
  let after = before
  try {
    const from = since(Date.now())
    const known = await read($, viewer)
    // First, so a folder that isn't a GitHub repo stops at one call, and a repo with issues turned off skips them.
    const repo = await repoNow($)
    const listIssues = (args: string[]) => (repo.hasIssuesEnabled ? gh($, ['issue', 'list', ...args]) : Promise.resolve('[]'))
    const [owner = '', name = ''] = repo.nameWithOwner.split('/')
    // The weekly counts are kept for an hour.
    const kept = velocityKept(before, repo.nameWithOwner, await nowOf($), VELOCITY_MS)
    const [graph, prs, threads, closed, merged, login, current, milestones] = await Promise.all([
      repo.hasIssuesEnabled ? fetchIssues($, repo.nameWithOwner) : Promise.resolve({ issues: [], project: null, types: [], labels: undefined }),
      gh($, OPEN_PRS),
      // Review threads still open on each pull request; without them, the rows just don't count threads.
      getGraphql($, ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${THREADS_QUERY}`]).then(threadsOf, () => new Map<number, number>()),
      kept ? null : listIssues(['--state', 'closed', '--search', `closed:>=${from}`, '--limit', '500', '--json', 'closedAt']),
      kept ? null : gh($, ['pr', 'list', '--state', 'merged', '--search', `merged:>=${from}`, '--limit', '500', '--json', 'mergedAt']),
      // Who Mine means: asked once, then kept.
      known ?? gh($, ['api', 'user', '--jq', '.login']).then(out => out.trim() || null, () => null),
      currentBranch($),
      // The open milestones, over REST; the last read's stand when they can't be read.
      repoMilestones($, repo.nameWithOwner).catch(() => before?.milestones ?? []),
    ])
    const issues = await withSubOrder($, repo.nameWithOwner, graph.issues)
    const fetchedAt = await nowOf($)
    const next = boardOf({ repo: repo.nameWithOwner, graph, issues, prs, threads, closed, merged, milestones, kept, fetchedAt })
    after = next
    if (login !== known) await update($, viewer, () => login)
    await land($, before, next, seen)
    await followBranch($, current)
    // The branch's pull request has CI running: the board watches the run for its progress.
    if (current && next.prs.some(pr => pr.branch === current && pr.ci === 'pending')) void watchRuns($)
    // GitHub answers again: look again too, so a problem fixed since the last check goes.
    if (((await read($, access))?.problems.length ?? 0) > 0) void checkAccess($)
    void prime($, next)
    const calls = stats.calls['full read'] ?? spent.calls
    stats.lastRead = { at: fetchedAt, calls: minus(calls, spent.calls), points: stats.points - spent.points }
  } catch (cause) {
    await readFailed($, messageOf(cause))
  } finally {
    await update($, loading, () => false)
    schedule($, after)
  }
}

// Each open epic's sub-issues in GitHub's order, over REST; an epic whose order can't be read keeps the board's own.
const withSubOrder = ($: EngineInterface, repo: string, issues: Issue[]): Promise<Issue[]> =>
  Promise.all(
    issues.map(async issue => {
      if ((issue.subIssues?.total ?? 0) === 0) return issue
      try {
        const listed = JSON.parse(await gh($, ['api', `repos/${repo}/issues/${issue.number}/sub_issues?per_page=100`])) as { number: number }[]
        return { ...issue, subOrder: listed.map(one => one.number) }
      } catch {
        return issue
      }
    }),
  )

// A full read that failed: a rate limit pauses the board until it resets, and anything else shows, and may be a
// missing permission.
const readFailed = async ($: EngineInterface, message: string): Promise<void> => {
  repoInfo = undefined
  if (RATE_LIMITED.test(message)) {
    const was = pausedUntil
    const clock = await nowOf($)
    pausedUntil = await resetOf($, message)
    const said = rateLimitTexts(pausedUntil)
    await update($, error, () => said.error)
    if (was <= clock) $.ui.toast(said.toast)
  } else {
    await update($, error, () => message)
    void checkAccess($, message)
  }
}

// Lets go of the confirm waiting on a second press when it is of this kind; one of another kind stays armed.
const disarm = async ($: EngineInterface, kind: NonNullable<Armed>['kind']): Promise<void> => {
  await update($, armed, was => (was?.kind === kind ? null : was))
}

// A new read of the board, this session's or another's: it goes on the board, and what follows from the change does.
const land = async ($: EngineInterface, before: Board | null, next: Board, seen: boolean): Promise<void> => {
  await update($, board, () => next)
  // A plan whose every change the board now shows as made, as when Claude made them another way, leaves the card. One
  // being applied is left to its Apply.
  await update($, proposal, was => (was && !was.applying && rowsToMake(was.rows, next).length === 0 ? null : was))
  // Merge all's confirm waits on pull requests that are all gone now.
  if (next.prs.length === 0) await disarm($, 'merge-all')
  const green = wentGreen(before, next)
  if (green.length > 0) await update($, greened, list => [...list.slice(-50), ...green.map(greenKey)])
  if (seen) {
    await update($, working, was => {
      const issue = was && next.issues.find(one => one.number === was.number)
      return was && issue ? { ...was, updatedAt: issue.updatedAt } : was
    })
  }
  await update($, error, () => null)
  await save($)
  // The project the board reads now names the adopted one.
  await loadAdoption($)
  // New issues in the Inbox while it shows: Claude suggests for them too, unless its last answer failed, which waits
  // for Suggest again.
  // The Inbox shows only while it is a tab, which it isn't once the project's views are the tabs.
  const inboxShown = tabOf(filtersFor(next.project), await read($, filter)).id === 'inbox'
  if (inboxShown && !(await read($, triage)).failed) void suggestInbox($)
  // Epic lines that no longer hold on this read go before its moves raise new ones.
  const clock = await nowOf($)
  await update($, epicNotes, list => liveEpicNotes(list, next, clock))
  // The read's Status moves run as one sequence, after the last read's, and the read doesn't wait on them.
  void moveOnRead($, before, next).catch(cause => $.ui.log(`issue-board: the moves after a read failed: ${messageOf(cause)}`, { to: 'debug' }))
}

// What the board moved on its own since the last prompt, which the next prompt notes for Claude.
let moved: string[] = []

// The Status moves the board makes on its own after a read, planned by planMoves in moves.ts and applied here. Asking
// GitHub comes first, then the plan, then the writes, one at a time, so two rules never write the same issue's Status.
// The moves of one read wait for the last read's to finish. Turned off, the board neither moves issues nor asks GitHub
// anything for it.
let moving: Promise<unknown> = Promise.resolve()
const moveOnRead = ($: EngineInterface, before: Board | null, next: Board): Promise<void> => {
  const run = moving.then(() => applyMoves($, before, next))
  moving = run.catch(() => undefined)
  return run
}

// What the planner needs from GitHub, asked over REST: whether each pull request merged, how each issue that left the
// board closed, and each finished epic's body. Only the moves spend GraphQL.
const askForMoves = async ($: EngineInterface, repo: string, questions: Questions): Promise<Answers> => {
  const answers: Answers = { merged: {}, closed: {}, bodies: {} }
  const ask = async <T,>(get: () => Promise<T>): Promise<Answer<T>> => {
    try {
      return { value: await get() }
    } catch (cause) {
      return { error: messageOf(cause) }
    }
  }
  for (const number of questions.closed) {
    answers.closed[number] = await ask(async () => {
      const how = JSON.parse(await gh($, ['api', `repos/${repo}/issues/${number}`, '--jq', '{state, state_reason}'])) as { state?: string; state_reason?: string | null }
      return how.state === 'closed' ? (how.state_reason ?? null) : null
    })
  }
  for (const pr of questions.prs) {
    answers.merged[pr] = await ask(async () => !/^(null)?$/.test((await gh($, ['api', `repos/${repo}/pulls/${pr}`, '--jq', '.merged_at'])).trim()))
  }
  // The body as GitHub has it now, so a box ticked meanwhile counts. The tick takes the same read.
  for (const number of questions.bodies) answers.bodies[number] = await ask(async () => (await readBody($, repo, number)).body)
  return answers
}

// Applies one read's plan in order. An issue that closed as completed moves to Done, wherever it was closed; one closed
// as not planned stays. An issue a merged pull request refers to with `Refs #N`, not `Closes`, moves to Verification:
// merging didn't complete its acceptance. An epic follows its sub-issues: when its last open sub-issue closes, its
// "Every sub-issue is closed" box is ticked, and with every box then ticked it closes as completed and moves to Done
// here, since it leaves the board now and no later read would see it go. With other boxes open, it moves to
// Verification, where a person checks what is left, and the band and the next prompt say why. A sub-issue open again
// under an epic is only noted: reopening an epic or moving it back is a person's call.
const applyMoves = async ($: EngineInterface, before: Board | null, next: Board): Promise<void> => {
  if (!settings.autoMove) return
  const { reopened, orphaned } = epicChanges(before, next)
  const titleOf = (number: number) => next.issues.find(one => one.number === number)?.title ?? next.issues.find(one => one.parent?.number === number)?.parent?.title ?? ''
  const at = await nowOf($)
  const notes: EpicNote[] = [
    ...reopened.map(one => ({ key: `epic-reopened-${one.epic}-${one.number}`, kind: 'reopened' as const, epic: one.epic, number: one.number, title: titleOf(one.epic), text: `#${one.number} reopened under it`, at })),
    ...orphaned.map(one => ({ key: `epic-orphaned-${one.epic}-${one.number}`, kind: 'orphaned' as const, epic: one.epic, number: one.number, title: titleOf(one.epic), text: `#${one.number} is open under it, and it is closed`, at })),
  ]
  // Closing and ticking an epic are the issue's own; the Status moves wait until the person lets the board write to the
  // project.
  const project = next.project
  const write = !!project?.status && (await mayWrite($, project))
  const candidates = candidatesOf(before, next, write)
  const plan = planMoves(before, next, write, candidates.length > 0 ? await askForMoves($, next.repo, questionsOf(candidates)) : { merged: {}, closed: {}, bodies: {} })
  const done: number[] = []
  const verified: number[] = []
  const failed: Unmoved[] = [...plan.failed]
  for (const move of plan.moves) {
    try {
      if (move.rule === 'epic') {
        const epic = next.issues.find(one => one.number === move.number)
        if (!epic) continue
        if (move.tick > 0) await tick($, move.number, [move.tick], true, move.body)
        if (move.close) {
          for (const command of commandsOf(move.number, { close: 'completed' })) await gh($, command.argv, command.stdin)
          if (move.to) await setField($, epic, 'status', move.to)
          moved.push(`#${move.number} closed as completed${move.done ? ` and moved to ${move.done}` : ''}: every sub-issue is closed and every box is ticked.`)
          await update($, board, was => was && { ...was, issues: was.issues.filter(one => one.number !== move.number) })
          await save($)
          $.ui.toast(`Closed epic #${move.number}: every sub-issue is closed and every box is ticked.`)
          continue
        }
        const left = move.open === 1 ? '1 box is still open' : `${move.open} boxes are still open`
        if (move.to) await setField($, epic, 'status', move.to)
        moved.push(`#${move.number} ${move.to ? `moved to ${move.to}` : 'stays open'}: every sub-issue is closed, but ${left}.`)
        notes.push({ key: `epic-verify-${move.number}`, kind: 'verify', epic: move.number, title: move.title, text: `every sub-issue is closed, but ${left}`, at })
        continue
      }
      const option = project?.status && optionOf(project.status, move.to)
      if (!project?.status || !option) continue
      await projectWrite($, project, SET_FIELD, { project: project.id, item: move.item, field: project.status.id, option: option.id })
      if (move.rule === 'closed') {
        done.push(move.number)
        moved.push(`#${move.number} moved to ${move.to}: it closed as completed.`)
      } else {
        await update($, board, was => was && { ...was, issues: was.issues.map(one => (one.number === move.number ? { ...one, status: move.to } : one)) })
        verified.push(move.number)
        moved.push(`#${move.number} moved to ${move.to}: pull request #${move.pr}, which refers to it without closing it, merged.`)
      }
    } catch (cause) {
      failed.push({ rule: move.rule, number: move.number, to: move.to, message: messageOf(cause) })
    }
  }
  // The person sees what the board did on its own, once a read, and what it couldn't.
  const doneName = roleOf(project, 'done')?.name
  const verifyName = roleOf(project, 'verification')?.name
  if (doneName && done.length > 0) $.ui.toast(movedText(doneName, done, 'it closed as completed', 'they closed as completed'))
  if (verifyName && verified.length > 0) {
    $.ui.toast(movedText(verifyName, verified, 'a pull request that refers to it merged without closing it', 'pull requests that refer to them merged without closing them'))
  }
  for (const rule of ['closed', 'refs'] as const) {
    const unmoved = failed.filter(one => one.rule === rule)
    const to = unmoved[0]?.to
    if (to) $.ui.toast(unmovedText(to, unmoved))
  }
  for (const one of failed.filter(one => one.rule === 'epic')) $.ui.toast(`Couldn't move epic #${one.number} on: ${one.message}. /issues check may say why.`)
  // A note raised again replaces the old one, so it shows once.
  if (notes.length > 0) await update($, epicNotes, list => [...list.filter(one => !notes.some(note => note.key === one.key)), ...notes].slice(-20))
}

// Reads GitHub again straight after a change, waiting out a refresh already under way, which may have read GitHub
// before the change. `seen`: the change was the person's or Claude's own, so the band doesn't call it news.
const refreshAfter = async ($: EngineInterface): Promise<void> => {
  await settle($)
  await refresh($, true)
}

// Waits out a refresh under way, up to ten seconds.
const settle = async ($: EngineInterface): Promise<void> => {
  for (let tries = 0; tries < 50 && refreshing; tries += 1) await $.clock.sleep(200)
}

// A GitHub event for a subscribed pull request (CI finished, merged, reviewed, commented): the board reads GitHub at
// once, when the event is about this repo, rather than at its next poll.
const eventArrived = async ($: EngineInterface, data: Record<string, unknown>): Promise<void> => {
  const repo = (await read($, board))?.repo
  const named = eventRepoOf(data)
  if (!repo || (named && named.toLowerCase() !== repo.toLowerCase())) return
  await settle($)
  await refresh($)
}

// The CI runs being watched, by id: one `gh run watch` each, for as long as the run goes. Unloading the module ends
// them, and a new load starts with none.
const watching = new Set<number>()

// Looks for CI runs under way on the branch checked out, and watches each it isn't watching yet. Answers whether any is
// under way.
const watchRuns = async ($: EngineInterface): Promise<boolean> => {
  const here = await read($, branch)
  if (!here) return false
  try {
    const live = liveRunsOf(await gh($, ['run', 'list', '--branch', here, '--limit', '10', '--json', 'databaseId,status,workflowName']))
    for (const run of live.slice(0, 3)) if (!watching.has(run.id)) void watchRun($, run, here)
    return live.length > 0
  } catch (cause) {
    $.ui.log(`issue-board: couldn't list the CI runs on ${here}: ${messageOf(cause)}`, { to: 'debug' })
    return false
  }
}

// A push starts CI a few seconds later: the board looks a few times, until a run turns up.
const lookForRuns = async ($: EngineInterface): Promise<void> => {
  try {
    for (let tries = 0; tries < 4; tries += 1) {
      await $.clock.sleep(15_000)
      if (await watchRuns($)) return
    }
  } catch {
    // The module unloaded while it waited: the next load looks again when CI shows as running.
  }
}

// Watches one run with `gh run watch`, which draws it again every 15 seconds until it ends: each drawing updates the
// run's progress on the board. Its end reads GitHub again, so the pull request shows how it went. Each drawing costs
// about three REST calls, from the same hourly limit as the cheap checks, so it doesn't draw more often.
const watchRun = async ($: EngineInterface, run: { id: number; workflow: string }, runBranch: string): Promise<void> => {
  watching.add(run.id)
  const fresh: RunWatch = { id: run.id, workflow: run.workflow, branch: runBranch, done: 0, total: 0, failed: 0, running: null, step: null }
  await update($, runs, list => [...list.filter(one => one.id !== run.id), fresh])
  try {
    let seen = ''
    for await (const { text } of $.process.spawn({ argv: ['gh', 'run', 'watch', String(run.id), '--interval', '15'] })) {
      // Each drawing opens with this line, and counts as the three REST calls it takes.
      const drawings = text.match(/Refreshing run status/g)?.length ?? 0
      for (let call = 0; call < drawings * 3; call++) countCall(stats, 'other', 'rest')
      seen = (seen + text).slice(-20_000)
      const progress = runProgressOf(seen)
      if (progress) await update($, runs, list => list.map(one => (one.id === run.id ? { ...one, ...progress } : one)))
    }
  } catch (cause) {
    $.ui.log(`issue-board: couldn't watch CI run ${run.id}: ${messageOf(cause)}`, { to: 'debug' })
  } finally {
    watching.delete(run.id)
    await update($, runs, list => list.filter(one => one.id !== run.id))
    await settle($)
    await refresh($)
  }
}

// ---- Project writes, and the other reads and writes of issues ----

// Puts an issue read straight from GitHub on the board. The change is the person's or Claude's own, so the issue
// Claude is on takes its new time and the band doesn't call it news.
const take = async ($: EngineInterface, fresh: Partial<Issue> & Pick<Issue, 'number' | 'updatedAt'>): Promise<void> => {
  // Neither `gh issue view` nor a REST write gives project or sub-issue fields, so the board's own stay.
  await update($, board, now => now && { ...now, issues: now.issues.map(one => (one.number === fresh.number ? { ...one, ...fresh } : one)) })
  await update($, working, was => (was && was.number === fresh.number ? { ...was, updatedAt: fresh.updatedAt } : was))
  await save($)
}

// An issue's body as GitHub has it now, and when the issue last changed, over REST. Every change made to a body starts
// from this read, so an edit made meanwhile isn't lost.
const readBody = async ($: EngineInterface, repo: string, number: number): Promise<{ body: string; updatedAt: string }> => {
  const raw = JSON.parse(await gh($, ['api', `repos/${repo}/issues/${number}`, '--jq', '{body, updated_at}'])) as { body: string | null; updated_at: string }
  return { body: raw.body ?? '', updatedAt: raw.updated_at }
}

// Writes an issue's body, with its title when one is given, over REST, and puts what GitHub then has on the board.
const writeBody = async ($: EngineInterface, repo: string, number: number, fields: { title?: string; body?: string }): Promise<void> => {
  const raw = JSON.parse(await gh($, ['api', '-X', 'PATCH', `repos/${repo}/issues/${number}`, '--input', '-'], JSON.stringify(fields))) as {
    title: string
    body: string | null
    updated_at: string
  }
  await take($, { number, title: raw.title, body: raw.body ?? '', checks: checksOf(raw.body), updatedAt: raw.updated_at })
}

// Ticks or unticks boxes in an issue's body, read fresh from GitHub so an edit made meanwhile isn't lost, unless the
// caller has just read it and passes it as `known`. One at a time: two presses in a row would otherwise each write the
// body the other read. Answers what it did, and the boxes as GitHub had them just before.
let ticking: Promise<unknown> = Promise.resolve()
const tick = ($: EngineInterface, number: number, boxes: number[], done: boolean, known?: string): Promise<{ text: string; before: Check[] }> => {
  const run = ticking.then(async () => {
    const repo = (await read($, board))?.repo
    if (!repo) throw new Error(NOT_READ)
    const body = known ?? (await readBody($, repo, number)).body
    const before = checksOf(body)
    const edit = tickBody(body, boxes, done)
    if (edit.missing.length > 0) throw new Error(noBoxText(number, before.length, edit.missing))
    if (edit.changed.length > 0) await writeBody($, repo, number, { body: edit.body })
    const step = progress(checksOf(edit.body))
    const tally = `#${number} has ${step.done}/${step.total} ticked.`
    if (edit.changed.length === 0) return { text: `Nothing changed: ${boxes.length === 1 ? 'that box was' : 'those boxes were'} already ${done ? 'ticked' : 'unticked'}. ${tally}`, before }
    return { text: `${done ? 'Ticked' : 'Unticked'} ${edit.changed.length === 1 ? 'box' : 'boxes'} ${edit.changed.join(', ')}. ${tally}`, before }
  })
  ticking = run.catch(() => undefined)
  return run
}

// Sets Status or Priority on an issue in the repo's project, adding the issue to the project first when it isn't in it.
// An issue's item in the project, added to the project first when it has none.
const itemFor = async ($: EngineInterface, issue: Target, project: Project): Promise<string> => {
  if (issue.item) return issue.item
  if (!issue.id) throw new Error(`#${issue.number} hasn't been read with its project yet; refresh and try again`)
  const item = await addItem($, project, issue.id)
  await update($, board, was => was && { ...was, issues: was.issues.map(one => (one.number === issue.number ? { ...one, item } : one)) })
  return item
}

// Adds an issue to the project and answers its item. A project with an auto-add workflow may have added a new issue
// already, and GitHub then refuses the add: the item the project has is taken instead.
const addItem = async ($: EngineInterface, project: Project, content: string): Promise<string> => {
  try {
    const added = (await projectWrite($, project, ADD_ITEM, { project: project.id, content })) as { addProjectV2ItemById?: { item?: { id?: string } | null } | null }
    const item = added.addProjectV2ItemById?.item?.id
    if (item) return item
  } catch (cause) {
    if (!/already exists/i.test(messageOf(cause))) throw cause
  }
  const found = (await postGraphql($, ISSUE_ITEMS, { issue: content })) as { node?: { projectItems?: { nodes?: { id: string; project: { id: string } }[] } } }
  const item = found.node?.projectItems?.nodes?.find(one => one.project.id === project.id)?.id
  if (!item) throw new Error(`couldn't add it to ${project.title}`)
  return item
}

// An issue's values for the project's fields, by name, read from GitHub: one item at a time, when its card opens or a
// tool asks, so the board's main read stays cheap.
const readValues = async ($: EngineInterface, issue: Target): Promise<FieldValues> => {
  if (!issue.item) return {}
  try {
    const read$ = itemValuesOf(await postGraphql($, ITEM_VALUES, { item: issue.item }))
    await update($, values, was => ({ ...was, [issue.number]: read$ }))
    return read$
  } catch (cause) {
    $.ui.log(`issue-board: couldn't read #${issue.number}'s fields: ${messageOf(cause)}`, { to: 'debug' })
    return {}
  }
}

// Sets the project's other fields on an issue, by name, each value checked against the field's kind first; null clears
// one. Status and Priority have their own options.
const setFields = async ($: EngineInterface, issue: Target, given: Record<string, string | number | null>): Promise<void> => {
  const project = (await read($, board))?.project
  if (!project) throw new Error("the board reads no project for this repo, so it can't set its fields")
  // A field the board doesn't know may be new since its last read, which a field's change doesn't trigger: read again once.
  const known = (one: Project | null | undefined) => Object.keys(given).every(name => /^(status|priority)$/i.test(name) || one?.fields?.some(field => field.name.toLowerCase() === name.toLowerCase()))
  if (!known(project)) {
    await settle($)
    await refresh($)
  }
  const fresh = (await read($, board))?.project ?? project
  const plan = Object.entries(given).map(([name, value]) => {
    if (/^(status|priority)$/i.test(name)) throw new Error(`set ${name} with ${name.toLowerCase()}, not fields`)
    const field = fresh.fields?.find(one => one.name.toLowerCase() === name.toLowerCase())
    if (!field) throw new Error(`${fresh.title} has no field called ${name}${fresh.fields?.length ? `; it has ${fresh.fields.map(one => one.name).join(', ')}` : ''}`)
    if (value === null) return { field, value: null }
    const fits = fieldValueOf(field, value)
    if (typeof fits === 'string') throw new Error(fits)
    return { field, value: fits.value }
  })
  const item = await itemFor($, issue, fresh)
  for (const one of plan) {
    if (one.value === null) await projectWrite($, fresh, CLEAR_VALUE, { project: fresh.id, item, field: one.field.id })
    else await projectWrite($, fresh, SET_VALUE, { project: fresh.id, item, field: one.field.id, value: one.value })
  }
  await readValues($, { ...issue, item })
}

// Sets Status or Priority on an issue, by the option's name, and answers the option's name as the project spells it.
const setField = async ($: EngineInterface, issue: Target, field: 'status' | 'priority', name: string): Promise<string> => {
  const project = (await read($, board))?.project
  const target = field === 'status' ? project?.status : project?.priority
  const option = optionOf(target, name)
  if (!project || !target || !option) throw new Error(`the project has no ${field === 'status' ? 'Status' : 'Priority'} called ${name}`)
  const item = await itemFor($, issue, project)
  await projectWrite($, project, SET_FIELD, { project: project.id, item, field: target.id, option: option.id })
  const placed = item
  await update($, board, now => now && { ...now, issues: now.issues.map(one => (one.number === issue.number ? { ...one, item: placed, [field]: option.name } : one)) })
  await save($)
  return option.name
}

// An issue's REST id, by number. An issue that doesn't exist fails by its number, so Claude reads which one it was.
const restIssueId = async ($: EngineInterface, repo: string, number: number): Promise<string> => {
  try {
    return (await gh($, ['api', `repos/${repo}/issues/${number}`, '--jq', '.id'])).trim()
  } catch (cause) {
    throw new Error(notFoundText(messageOf(cause), repo, number))
  }
}

// Moves a sub-issue just before or just after a sibling in its epic, over REST, and the epic's order on the board with it.
const reorder = async ($: EngineInterface, repo: string, number: number, beside: number, before: boolean): Promise<void> => {
  const issues = (await read($, board))?.issues ?? []
  const issue = issues.find(one => one.number === number)
  const epic = issue?.parent?.number
  if (!issue || !epic) throw new Error(`#${number} isn't a sub-issue of an open epic on the board`)
  if (issues.find(one => one.number === beside)?.parent?.number !== epic) throw new Error(`#${beside} isn't a sub-issue of #${epic}, as #${number} is`)
  const [id, other] = await Promise.all([number, beside].map(one => restIssueId($, repo, one)))
  await gh($, ['api', '-X', 'PATCH', `repos/${repo}/issues/${epic}/sub_issues/priority`, '-F', `sub_issue_id=${id}`, '-F', `${before ? 'before_id' : 'after_id'}=${other}`])
  await update($, board, was => {
    if (!was) return was
    const siblings = was.issues.filter(one => one.parent?.number === epic).map(one => one.number)
    return { ...was, issues: was.issues.map(one => (one.number === epic ? { ...one, subOrder: reordered(one.subOrder ?? siblings, number, beside, before) } : one)) }
  })
  await save($)
}

// Moves an issue in the project's own order, the one the pane's rows follow: straight after `beside`, or before it, or
// to the top for null. The pane shows the new order at once; the next read confirms it.
const moveInProject = async ($: EngineInterface, number: number, beside: number | null, before: boolean): Promise<void> => {
  const now = await read($, board)
  const project = now?.project
  if (!now || !project) throw new Error("the board reads no project for this repo, so it can't move items in its order")
  const move = projectMoveOf(now.issues, number, beside, before)
  if (typeof move === 'string') throw new Error(move)
  await projectWrite($, project, MOVE_ITEM, { project: project.id, item: move.item, after: move.after?.item ?? null })
  await update($, board, was => was && { ...was, issues: placedAfter(was.issues, number, move.after?.number ?? null) })
  await save($)
}

// The repo's issue type a name stands for, ignoring case; or why it can't be one.
const typeOf = async ($: EngineInterface, name: string): Promise<string> => {
  const types = (await read($, board))?.issueTypes ?? []
  if (types.length === 0) throw new Error("the repo has no issue types; they come with an organization's settings")
  const found = types.find(one => one.toLowerCase() === name.toLowerCase())
  if (!found) throw new Error(`the repo has no issue type called ${name}; it has ${types.join(', ')}`)
  return found
}

// Sets or takes off an issue's type, over REST, and shows it on the board at once.
const setType = async ($: EngineInterface, repo: string, number: number, name: string | null): Promise<void> => {
  const type = name === null ? null : await typeOf($, name)
  await gh($, ['api', '-X', 'PATCH', `repos/${repo}/issues/${number}`, '--input', '-'], JSON.stringify({ type }))
  await update($, board, was => was && { ...was, issues: was.issues.map(one => (one.number === number ? { ...one, type } : one)) })
  await save($)
}

// Posts a comment on an issue: the one way the board comments, as a change's comment does too.
const postComment = async ($: EngineInterface, repo: string, number: number, body: string): Promise<void> => {
  const command = commentCommand(repo, number, body)
  await gh($, command.argv, command.stdin)
}

// Closes an issue as a duplicate of another, over REST: a `Duplicate of #N` comment, which GitHub turns into the link
// between them, then the close with GitHub's duplicate reason, or not planned where GitHub refuses it. The issue leaves
// the board at once. The other issue must exist.
const closeAsDuplicate = async ($: EngineInterface, repo: string, number: number, of: number): Promise<void> => {
  await restIssueId($, repo, of)
  await postComment($, repo, number, `Duplicate of #${of}`)
  const close = (reason: string) => gh($, ['api', '-X', 'PATCH', `repos/${repo}/issues/${number}`, '-f', 'state=closed', '-f', `state_reason=${reason}`])
  await close('duplicate').catch(() => close('not_planned'))
  await update($, board, was => was && { ...was, issues: was.issues.filter(one => one.number !== number) })
  await save($)
}

// The repo's labels with their colors, over REST, which spends nothing of the GraphQL limit. Every label list the board
// reads outside its main query comes from here, up to the same 100 that query reads.
const repoLabels = async ($: EngineInterface, repo: string): Promise<{ name: string; color?: string }[]> =>
  JSON.parse(await gh($, ['api', `repos/${repo}/labels?per_page=100`])) as { name: string; color?: string }[]

// The repo's milestones, the open ones or all of them, over REST, up to 100: every milestone list the board reads.
const repoMilestones = async ($: EngineInterface, repo: string, state: 'open' | 'all' = 'open'): Promise<Milestone[]> =>
  milestonesOf(JSON.parse(await gh($, ['api', `repos/${repo}/milestones?state=${state}&per_page=100`])) as unknown[])

// Makes the labels a change asks for that the repo hasn't got yet, over REST: an `area:` one takes the color the repo's
// other areas have. Answers the names it made, so the answer says so; the card's label picker offers them from then.
const ensureLabels = async ($: EngineInterface, repo: string, names: string[]): Promise<string[]> => {
  let existing: { name: string; color?: string }[]
  try {
    existing = await repoLabels($, repo)
  } catch (cause) {
    // Without the list, nothing is made: the change goes on, and GitHub names a label it hasn't got.
    $.ui.log(`issue-board: couldn't read the repo's labels: ${messageOf(cause)}`, { to: 'debug' })
    return []
  }
  const made: string[] = []
  for (const name of missingLabels(names, existing)) {
    await gh($, ['api', '-X', 'POST', `repos/${repo}/labels`, '-f', `name=${name}`, '-f', `color=${labelColorFor(name, existing)}`])
    made.push(name)
  }
  if (made.length > 0) await update($, palette, was => was && { ...was, labels: [...new Set([...was.labels, ...made])].sort() })
  return made
}

// A new title or body, over REST. Boxes added or reworded go into the body as GitHub has it now, so nothing else in it is
// lost. A whole new body goes in only while GitHub's body is still the one the board read: one changed meanwhile isn't
// overwritten. The board shows the new title and boxes at once.
const rewrite = async ($: EngineInterface, repo: string, number: number, changes: IssueChanges): Promise<void> => {
  let body: string | undefined
  if (changes.body !== undefined || changes.addBoxes?.length || changes.rewordBoxes?.length) {
    const fresh = await readBody($, repo, number)
    body = fresh.body
    if (changes.body !== undefined) {
      const known = (await read($, board))?.issues.find(one => one.number === number)
      if (!known) throw new Error(`the board doesn't hold #${number}, so it can't tell whether its body changed meanwhile; add or reword its boxes instead`)
      // A board saved between sessions has no bodies: then the time of the last change tells.
      const same = known.body ? known.body === body : known.updatedAt === fresh.updatedAt
      if (!same) throw new Error(`#${number}'s body changed on GitHub since the board read it, so it wasn't overwritten. Read it again with the issues tool, then change it`)
      body = changes.body
    }
    if (changes.rewordBoxes?.length) {
      const reworded = rewordBoxes(body, changes.rewordBoxes)
      if (reworded.missing.length > 0) throw new Error(noBoxText(number, checksOf(body).length, reworded.missing))
      body = reworded.body
    }
    if (changes.addBoxes?.length) body = addBoxes(body, changes.addBoxes)
  }
  await writeBody($, repo, number, { ...(changes.title ? { title: changes.title } : {}), ...(body !== undefined ? { body } : {}) })
}

// Makes or takes away an issue's blocked-by links, over REST, which spends none of the GraphQL limit, and shows them on
// the board at once. A blocker that doesn't exist fails, by its number, before any link is made.
const block = async ($: EngineInterface, repo: string, number: number, blockers: number[], on: boolean): Promise<void> => {
  const ids = await Promise.all(blockers.map(async one => ({ number: one, id: await restIssueId($, repo, one) })))
  const path = `repos/${repo}/issues/${number}/dependencies/blocked_by`
  for (const one of ids) await gh($, on ? ['api', '-X', 'POST', path, '-F', `issue_id=${one.id}`] : ['api', '-X', 'DELETE', `${path}/${one.id}`])
  // The board lists the open issues an issue is blocked by: a new link to one it holds shows, a removed one goes.
  await update($, board, was => {
    if (!was) return was
    const open = new Set(was.issues.map(one => one.number))
    const issues = was.issues.map(one => {
      if (one.number !== number) return one
      const kept = (one.blockedBy ?? []).filter(blocker => !blockers.includes(blocker))
      return { ...one, blockedBy: on ? [...kept, ...blockers.filter(blocker => open.has(blocker))] : kept }
    })
    return { ...was, issues }
  })
  await save($)
}

// GitHub's search over every issue of the repo, for the issues tool: one line each, and how many more there are. REST,
// so it spends none of the GraphQL limit.
const searchIssues = async ($: EngineInterface, repo: string, ask: { state?: string; search?: string; label?: string; assignee?: string; milestone?: string }): Promise<string> => {
  const terms = searchTerms(repo, ask)
  const answer = JSON.parse(await gh($, ['api', '-X', 'GET', 'search/issues', '-f', `q=${terms}`, '-f', 'per_page=30', '-f', 'sort=updated'])) as { total_count: number; items: unknown[] }
  const found = foundOf(answer.items)
  if (found.length === 0) return `No issues match \`${terms}\`.`
  const clock = await nowOf($)
  const more = answer.total_count > found.length ? `\nShowing ${found.length} of ${answer.total_count}; narrow the search to see the rest.` : ''
  return `${found.map(one => foundLine(one, clock)).join('\n')}${more}`
}

// An issue the board doesn't hold, read from GitHub over REST: closed, most often, with how and when, and its boxes.
const readClosed = async ($: EngineInterface, repo: string, number: number): Promise<string> => {
  let raw: {
    title: string
    html_url: string
    body: string | null
    state: string
    state_reason: string | null
    closed_at: string | null
    labels: { name: string }[]
    assignees: { login: string }[]
    comments?: number
    pull_request?: unknown
  }
  try {
    raw = JSON.parse(await gh($, ['api', `repos/${repo}/issues/${number}`]))
  } catch (cause) {
    // The reason stands alone here, so it starts with a capital, and a missing issue's words end with a full stop.
    const why = notFoundText(messageOf(cause), repo, number)
    return why.startsWith('#') ? `${why}.` : `${why.charAt(0).toUpperCase()}${why.slice(1)}`
  }
  if (raw.pull_request) return `#${number} is a pull request that isn't open. Read it with \`gh pr view ${number}\`.`
  const [found] = foundOf([{ ...raw, number }])
  const checks = checksOf(raw.body)
  return [
    `#${number} ${raw.title} (${found ? standing(found, await nowOf($)) : raw.state})`,
    raw.html_url,
    `Labels: ${raw.labels.map(label => label.name).join(', ') || 'none'}`,
    `Assignees: ${raw.assignees.map(user => user.login).join(', ') || 'none'}`,
    ...(checks.length > 0 ? [`Boxes (${checks.filter(check => check.done).length}/${checks.length} ticked):`, ...checks.map((check, index) => `${index + 1}. [${check.done ? 'x' : ' '}] ${check.text}`)] : []),
    `Read the whole issue with \`gh issue view ${number}\`.`,
    await latestComments($, repo, number, raw.comments),
  ].join('\n')
}

// An issue's latest comments, for the issues tool, over REST: only the page that holds the latest ones is read, when the
// count is known. A thread that can't be read says so rather than failing the answer.
const latestComments = async ($: EngineInterface, repo: string, number: number, total?: number): Promise<string> => {
  try {
    if (total === 0) return 'No comments.'
    const page = total ? Math.max(1, Math.ceil(total / 100)) : 1
    const read$ = async (at: number) => restCommentsOf(JSON.parse(await gh($, ['api', `repos/${repo}/issues/${number}/comments?per_page=100&page=${at}`])) as unknown[])
    let comments = await read$(page)
    // The last page may hold fewer than are shown: the one before fills it up.
    if (page > 1 && comments.length < TOOL_COMMENTS) comments = [...(await read$(page - 1)), ...comments]
    return commentsText(comments, total ?? comments.length, await nowOf($))
  } catch (cause) {
    return `Couldn't read its comments: ${messageOf(cause)}`
  }
}

// Makes or changes a milestone for Claude's milestone tool, over REST. By its title: one the repo hasn't got is made, and
// one it has, open or closed, is changed. The board's list follows at once.
const saveMilestone = async (
  $: EngineInterface,
  repo: string,
  ask: { title: string; newTitle?: string; due?: string; description?: string; close?: boolean; reopen?: boolean },
): Promise<string> => {
  if (ask.due && !/^\d{4}-\d{2}-\d{2}$/.test(ask.due)) throw new Error('give the due date as YYYY-MM-DD, or an empty string to clear it')
  const all = await repoMilestones($, repo, 'all')
  const found = all.find(one => one.title.toLowerCase() === ask.title.toLowerCase())
  const fields = {
    ...(ask.newTitle ? { title: ask.newTitle } : {}),
    // GitHub keeps a due date in US Pacific time, so midnight UTC would fall on the day before: noon UTC is the same day.
    ...(ask.due !== undefined ? { due_on: ask.due ? `${ask.due}T12:00:00Z` : null } : {}),
    ...(ask.description !== undefined ? { description: ask.description } : {}),
    ...(ask.close ? { state: 'closed' } : ask.reopen ? { state: 'open' } : {}),
  }
  const said = [
    ask.newTitle ? `renamed ${ask.newTitle}` : '',
    ask.due !== undefined ? (ask.due ? `due ${ask.due}` : 'no due date') : '',
    ask.description !== undefined ? 'described' : '',
    ask.close ? 'closed' : ask.reopen ? 'reopened' : '',
  ].filter(Boolean)
  let text: string
  if (!found) {
    if (ask.close || ask.reopen) throw new Error(`the repo has no milestone called ${ask.title}`)
    await gh($, ['api', '-X', 'POST', `repos/${repo}/milestones`, '--input', '-'], JSON.stringify({ title: ask.title, ...fields }))
    text = `Made the milestone ${ask.newTitle ?? ask.title}${said.length > 0 ? `: ${said.join(', ')}` : ''}.`
  } else {
    if (Object.keys(fields).length === 0) return `Nothing to change on the milestone ${found.title}.`
    await gh($, ['api', '-X', 'PATCH', `repos/${repo}/milestones/${found.number}`, '--input', '-'], JSON.stringify(fields))
    text = `Changed the milestone ${found.title}: ${said.join(', ')}.`
  }
  const open = await repoMilestones($, repo)
  await update($, board, was => was && { ...was, milestones: open })
  await update($, palette, was => was && { ...was, milestones: open.map(one => one.title) })
  await save($)
  return text
}

// The project's items over REST, one page of 100, with the Status field's values.
const projectItems = async ($: EngineInterface, path: string, project: Project): Promise<unknown[]> => {
  const fields = JSON.parse(await gh($, ['api', `${path}/fields?per_page=50`])) as { id: number; name: string }[]
  const field = fields.find(one => one.name === 'Status')
  if (!field) throw new Error(`${project.title} has no Status field`)
  return JSON.parse(await gh($, ['api', `${path}/items?per_page=100&fields=${field.id}`])) as unknown[]
}

// Archives project items for the project_archive tool: one issue's, or every one at Done that closed before a date. The
// first call only says how many and which; the archive waits for a call with `confirm`.
const archiveItems = async ($: EngineInterface, project: Project, ask: { number?: number; doneBefore?: string; confirm: boolean }): Promise<string> => {
  const path = projectPathOf(project.url)
  if (!path) throw new Error(`couldn't tell where ${project.title} lives on GitHub`)
  if (ask.number === undefined && !ask.doneBefore) throw new Error('give an issue number, or doneBefore a date')
  if (ask.doneBefore && !/^\d{4}-\d{2}-\d{2}$/.test(ask.doneBefore)) throw new Error('give doneBefore as a date, YYYY-MM-DD')
  const done = roleOf(project, 'done')
  if (ask.number === undefined && !done) throw new Error(`${project.title} has no Done option set; pick one in /issues statuses`)
  const items = await projectItems($, path, project)
  const chosen = toArchive(items, ask, done?.name)
  const what = ask.number !== undefined ? `#${ask.number}` : `the items at ${done?.name ?? 'Done'} that closed before ${ask.doneBefore}`
  if (chosen.length === 0) return ask.number !== undefined ? `#${ask.number} isn't in ${project.title}, or is archived already.` : `Nothing in ${project.title} to archive: no ${what.slice(4)}.`
  const listed = chosen.map(one => `#${one.number} ${one.title}`).join('\n')
  const count = `${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}`
  const partial = items.length >= 100 ? ' Only the first 100 items of the project were read.' : ''
  if (!ask.confirm) return `Archiving ${what} takes ${count} out of the views of ${project.title}:\n${listed}\nThe issues stay as they are.${partial} Call again with confirm: true to archive.`
  for (const one of chosen) await projectWrite($, project, ARCHIVE_ITEM, { project: project.id, item: one.node })
  return `Archived ${count} from ${project.title}:\n${listed}`
}

// Posts a status update on the project for the project_status tool, and shows it in the pane's header at once.
const postStatus = async ($: EngineInterface, project: Project, ask: { status: string; note?: string; start?: string; target?: string }): Promise<string> => {
  const status = statusEnumOf(ask.status)
  if (!status) throw new Error(`a status update is On track, At risk, Off track, Complete or Inactive, not ${ask.status}`)
  for (const [name, date] of [['start', ask.start], ['target', ask.target]] as const) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`give ${name} as a date, YYYY-MM-DD`)
  }
  const posted = await projectWrite($, project, POST_STATUS, { project: project.id, status, body: ask.note ?? null, start: ask.start ?? null, target: ask.target ?? null })
  const latest: StatusUpdate = {
    status: updateWords(status),
    body: ask.note?.trim() ?? '',
    at: (posted as { createProjectV2StatusUpdate?: { statusUpdate?: { createdAt?: string } } }).createProjectV2StatusUpdate?.statusUpdate?.createdAt ?? new Date(await nowOf($)).toISOString(),
    start: ask.start ?? null,
    target: ask.target ?? null,
  }
  await update($, board, now => (now?.project?.id === project.id ? { ...now, project: { ...now.project, update: latest } } : now))
  await save($)
  return `Posted on ${project.title}: ${updateLine(latest, await nowOf($))}.`
}

// The project's issues at a Status, open and closed, for the issues tool: the board's copy holds open issues only, so
// the project is read over REST, with its Status field's values. One page of 100 items.
const readProject = async ($: EngineInterface, project: Project, status: string, since?: string): Promise<string> => {
  const path = projectPathOf(project.url)
  if (!path) return `Couldn't tell where ${project.title} lives on GitHub.`
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return 'Give since as a date, YYYY-MM-DD.'
  try {
    const items = await projectItems($, path, project)
    const found = itemsAt(items, status, since)
    const clock = await nowOf($)
    const scope = `${project.title} at ${status}${since ? `, closed since ${since}` : ''}`
    const more = items.length >= 100 ? '\nRead the first 100 items of the project; there may be more.' : ''
    return found.length > 0 ? `${scope} (${found.length}):\n${found.map(one => foundLine(one, clock)).join('\n')}${more}` : `Nothing in ${scope}.${more}`
  } catch (cause) {
    return `Couldn't read ${project.title}: ${messageOf(cause)}`
  }
}

// A Status or Priority picked on a card.
const pick = async ($: EngineInterface, issue: Issue, field: 'status' | 'priority', name: string): Promise<void> => {
  try {
    await setField($, issue, field, name)
    $.ui.toast(`#${issue.number} is ${name} now`)
  } catch (cause) {
    toastFailure($, `Couldn't change #${issue.number}`, cause)
  }
}

// The task Claude completed, its box ticked from the band.
const tickTask = async ($: EngineInterface, task: BoxTask): Promise<void> => {
  const issue = (await read($, board))?.issues.find(one => one.number === task.number)
  const at = issue && boxOf(issue, task)
  try {
    if (!at) throw new Error(`#${task.number} has no box "${fit(task.text, 40)}" open on the board`)
    await tick($, task.number, [at.box], true)
    await update($, tasks, list => list.filter(one => one.id !== task.id))
    $.ui.toast(`Ticked box ${at.box} on #${task.number}`)
  } catch (cause) {
    toastFailure($, `Couldn't tick the box on #${task.number}`, cause)
  }
}

// An issue the board doesn't hold, such as one a merge just closed: its node and its item in the board's project, read
// from GitHub. It has no item when it was never in the project; setting a field adds it.
const offBoard = async ($: EngineInterface, number: number): Promise<Target> => {
  const project = (await read($, board))?.project
  if (!project) throw new Error("the board reads no project for this repo, so it can't set its fields")
  const { id } = JSON.parse(await gh($, ['issue', 'view', String(number), '--json', 'id'])) as { id: string }
  const found = (await postGraphql($, ISSUE_ITEMS, { issue: id })) as { node?: { projectItems?: { nodes?: { id: string; project: { id: string } }[] } } }
  return { number, id, item: found.node?.projectItems?.nodes?.find(one => one.project.id === project.id)?.id ?? null }
}

// Makes a change to an issue, from its card or from Claude's issue_update tool: Status and Priority in the project,
// then the gh edit, comment and close, then the board read again so it shows. Answers what it did. A plan makes many
// changes and reads the board once after them all, so it passes `refresh` false.
const applyChanges = async ($: EngineInterface, number: number, changes: IssueChanges, refresh$ = true): Promise<string> => {
  const issue = (await read($, board))?.issues.find(one => one.number === number)
  const fields = changes.fields && Object.keys(changes.fields).length > 0 ? changes.fields : null
  // A closed issue is set through its item in the project all the same. Its Status or Priority may already be what was
  // asked, as when the board moved it to Done as it closed: that is said, and nothing is written.
  const target = issue ?? (changes.status || changes.priority || fields ? await offBoard($, number) : null)
  const current = !issue && target?.item ? itemValuesOf(await postGraphql($, ITEM_VALUES, { item: target.item })) : {}
  const settled = settledOf(number, changes, current)
  if (target) for (const [field, value] of settled.set) await setField($, target, field, value)
  if (fields && target) await setFields($, target, fields)
  const repo = (await read($, board))?.repo
  if (repo && (changes.title || changes.body !== undefined || changes.addBoxes?.length || changes.rewordBoxes?.length)) await rewrite($, repo, number, changes)
  const made = repo && changes.addLabels?.length ? await ensureLabels($, repo, changes.addLabels) : []
  if (repo && changes.transferTo) {
    changes.transferTo = sameOwner(repo, changes.transferTo)
    const [from = false, to = false] = await Promise.all([repo, changes.transferTo].map(async one => (await gh($, ['api', `repos/${one}`, '--jq', '.private'])).trim() === 'true'))
    const refusal = transferRefusal(number, repo, changes.transferTo, { from, to }, Boolean(changes.confirmTransfer))
    if (refusal) throw new Error(refusal)
  }
  for (const command of commandsOf(number, changes, repo)) await gh($, command.argv, command.stdin)
  if (changes.transferTo) {
    await update($, board, was => was && { ...was, issues: was.issues.filter(one => one.number !== number) })
    await save($)
  }
  if (repo && changes.type !== undefined) await setType($, repo, number, changes.type)
  if (repo && (changes.moveBefore || changes.moveAfter)) await reorder($, repo, number, (changes.moveBefore ?? changes.moveAfter) as number, Boolean(changes.moveBefore))
  if (changes.projectAfter !== undefined) await moveInProject($, number, changes.projectAfter || null, false)
  if (repo && changes.duplicateOf) await closeAsDuplicate($, repo, number, changes.duplicateOf)
  if (repo && changes.addBlockedBy?.length) await block($, repo, number, changes.addBlockedBy, true)
  if (repo && changes.removeBlockedBy?.length) await block($, repo, number, changes.removeBlockedBy, false)
  if (refresh$) await refreshAfter($)
  return changedText(number, changes, settled, made)
}

// A change made on a card: said in a toast, and an error that may be a missing permission checked.
const change = async ($: EngineInterface, number: number, changes: IssueChanges): Promise<void> => {
  try {
    $.ui.toast(await applyChanges($, number, changes))
  } catch (cause) {
    toastFailure($, `Couldn't change #${number}`, cause)
  }
}

// ---- Capture and filing ----

// Files an issue for Claude's issue_create tool. REST does what it can, which spends nothing of the GraphQL limit the
// board reads with: the issue with its labels, assignees and milestone in one call, then its place under an epic. Only
// the project needs GraphQL: adding the item and setting its Status and Priority. Once the issue exists, a later step
// that fails is named in the answer, and nothing is undone. The issue goes on the board at once, without a read.
const fileIssue = async ($: EngineInterface, spec: NewIssue, quiet = false): Promise<string> => {
  if (!spec.subIssues?.length) return (await fileOne($, spec, quiet)).text
  const epic = await fileOne($, { ...spec, body: withSubIssuesBox(spec.body) }, quiet)
  // An epic's parts, in order, each under it. One that fails leaves the others to be filed.
  const parts: string[] = []
  for (const [index, part] of spec.subIssues.entries()) {
    try {
      parts.push((await fileOne($, { ...part, parent: epic.number }, quiet)).text)
    } catch (cause) {
      parts.push(`Couldn't file sub-issue ${index + 1}, “${part.title}”: ${messageOf(cause)}`)
    }
  }
  return [epic.text, `Its sub-issues:`, ...parts.map(text => `- ${text}`)].join('\n')
}

// Files one issue, as fileIssue says, and answers its number and what to tell Claude. `quiet` leaves the toast to the
// caller, as a capture says its own.
const fileOne = async ($: EngineInterface, spec: NewIssue, quiet = false): Promise<{ number: number; text: string }> => {
  const now = await read($, board)
  if (!now) throw new Error(NOT_READ)
  const repo = now.repo
  const me = await read($, viewer)
  let milestone: Milestone | undefined
  if (spec.milestone) {
    // The board's own list first, as its last read had it; GitHub's when that lacks it, as for one made since.
    const name = spec.milestone
    milestone = milestoneNamed(now.milestones ?? [], name) ?? milestoneNamed(await repoMilestones($, repo), name)
    if (!milestone) throw new Error(`the repo has no open milestone called ${spec.milestone}`)
  }
  const assignees = assigneesOf(spec.assign, me)
  const type = spec.type ? await typeOf($, spec.type) : undefined
  const made = spec.labels?.length ? await ensureLabels($, repo, spec.labels) : []
  const fields = issueFieldsOf(spec, assignees, milestone, type)
  const raw = JSON.parse(await gh($, ['api', '-X', 'POST', `repos/${repo}/issues`, '--input', '-'], JSON.stringify(fields))) as Filed
  const did = filedSaid(spec, raw, milestone, type, made)
  const failed: string[] = []
  const parent = await placeFiled($, now, spec, raw, did, failed)
  const { item, set } = await addFiled($, now, spec, raw, did, failed)
  const issue = filedIssueOf(spec, raw, { item, set, milestone, type, parent, did, held: now.issues })
  await update($, board, was => was && withFiled(was, issue, parent))
  await save($)
  if (!quiet) $.ui.toast(`Filed #${raw.number}`)
  return { number: raw.number, text: filedText(raw.number, did, failed) }
}

// A new issue's place among the others: under its epic and blocked by its blockers, each said in `did` or `failed`.
// Answers the epic it went under, with its new count.
const placeFiled = async ($: EngineInterface, now: Board, spec: NewIssue, raw: Filed, did: string[], failed: string[]): Promise<Issue['parent']> => {
  let parent: Issue['parent'] = null
  if (spec.parent) {
    try {
      await gh($, ['api', '-X', 'POST', `repos/${now.repo}/issues/${spec.parent}/sub_issues`, '-F', `sub_issue_id=${raw.id}`])
      parent = parentAfter(now.issues, spec.parent)
      did.push(`under #${spec.parent}`)
    } catch (cause) {
      failed.push(`put it under #${spec.parent} (${messageOf(cause)})`)
    }
  }

  if (spec.blockedBy?.length) {
    try {
      // The issue isn't on the board yet: the links show with it, below.
      await block($, now.repo, raw.number, spec.blockedBy, true)
      did.push(`blocked by ${spec.blockedBy.map(one => `#${one}`).join(', ')}`)
    } catch (cause) {
      failed.push(`mark it blocked by ${spec.blockedBy.map(one => `#${one}`).join(', ')} (${messageOf(cause)})`)
    }
  }
  return parent
}

// A new issue into the board's project, as projectStepOf plans, each step said in `did` or `failed`. Answers its item
// and the fields set.
const addFiled = async ($: EngineInterface, now: Board, spec: NewIssue, raw: Filed, did: string[], failed: string[]): Promise<{ item: string | null; set: { status?: string; priority?: string } }> => {
  const project = now.project
  let item: string | null = null
  const set: { status?: string; priority?: string } = {}
  const step = projectStepOf(spec, project, await boardRefusal($, now))
  if (!step) return { item, set }
  if ('failed' in step) failed.push(step.failed)
  else if ('did' in step) did.push(step.did)
  else if (project) {
    try {
      item = await addItem($, project, raw.node_id)
      for (const [field, wanted] of step.add) {
        try {
          set[field] = await setField($, { number: raw.number, id: raw.node_id, item }, field, wanted)
        } catch (cause) {
          failed.push(`set its ${field === 'status' ? 'Status' : 'Priority'} (${messageOf(cause)})`)
        }
      }
      did.push([`in ${project.title}`, set.status, set.priority].filter(Boolean).join(', '))
    } catch (cause) {
      failed.push(`add it to ${project.title} (${messageOf(cause)})`)
    }
  }
  return { item, set }
}

// How far back a capture looks for the same work among closed issues.
const CLOSED_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

// An issue that is already the work a capture names: an open one from the board's copy, or else one closed in the last
// 30 days, read over REST, which spends nothing of the GraphQL limit. Null when there is none.
const sameWork = async ($: EngineInterface, repo: string, issues: Issue[], title: string): Promise<{ number: number; title: string; closed: boolean } | null> => {
  const open = sameWorkOf(title, issues)
  if (open) return { number: open.number, title: open.title, closed: false }
  const since = new Date((await nowOf($)) - CLOSED_LOOKBACK_MS).toISOString()
  type Closed = { number: number; title: string; closed_at?: string | null; pull_request?: unknown }
  // Work found is kept even when the closed issues can't be read: a duplicate can be closed in triage, a lost capture
  // can't be found again.
  let raw: Closed[] = []
  try {
    raw = JSON.parse(await gh($, ['api', `repos/${repo}/issues?state=closed&since=${since}&sort=updated&direction=desc&per_page=100`])) as Closed[]
  } catch (cause) {
    $.ui.log(`issue-board: couldn't read the closed issues to compare a capture with: ${messageOf(cause)}`, { to: 'debug' })
  }
  const closed = (Array.isArray(raw) ? raw : []).filter(one => !one.pull_request && one.closed_at && Date.parse(one.closed_at) >= Date.parse(since))
  const found = sameWorkOf(title, closed)
  return found ? { number: found.number, title: found.title, closed: true } : null
}

// Captures work found in conversation, for the capture tool and `/issues new`: files it as issue_create does with no
// Status asked for, so it lands in the Inbox for the person to triage, under an epic when one is given. When an open issue, or one closed in the last
// 30 days, is already that work, it goes there as a comment instead, and the answer says so. A toast says which, and
// the band counts what was filed until the person opens the Inbox.
const capture = async ($: EngineInterface, spec: NewIssue): Promise<string> => {
  const now = await read($, board)
  if (!now) throw new Error(NOT_READ)
  const found = await sameWork($, now.repo, now.issues, spec.title)
  if (found) {
    const parts = (spec.subIssues ?? []).map(part => `- ${part.title}`).join('\n')
    const note = [`Captured again from a conversation: **${spec.title}**`, spec.body.trim(), parts].filter(Boolean).join('\n\n')
    await postComment($, now.repo, found.number, note)
    $.ui.toast(`Added to #${found.number} as a comment: it looks like the same work`)
    return `Not filed: #${found.number} “${found.title}”${found.closed ? ', closed lately,' : ''} looks like the same work, so this went there as a comment instead.`
  }
  const filed = await fileIssue(
    $,
    {
      title: spec.title,
      body: spec.body,
      ...(spec.labels?.length ? { labels: spec.labels } : {}),
      ...(spec.parent ? { parent: spec.parent } : {}),
      ...(spec.subIssues?.length ? { subIssues: spec.subIssues } : {}),
    },
    true,
  )
  const parts = spec.subIssues?.length ?? 0
  await update($, captured, was => was + 1 + parts)
  const number = /^Filed #(\d+)/.exec(filed)?.[1] ?? '?'
  $.ui.toast(parts > 0 ? `Captured epic #${number} and ${parts} sub-issues to the Inbox` : `Captured #${number} to the Inbox`)
  return `Captured to the Inbox for the person to triage. ${filed}`
}

// `/issues new`: Claude writes the issue, or with `epic` a parent and its sub-issues, over the conversation so far,
// and it is captured to the Inbox at once. Toasts say how it went.
const captureFromTalk = async ($: EngineInterface, what: string, epic = false): Promise<void> => {
  const labels = labelsOf((await read($, board))?.issues ?? [])
  const prompt = draftPrompt(what, labels, epic)
  let reply: ModelForkResult = await $.model.fork({ prompt })
  if (!reply.isAnswered && reply.reason === 'nothing-to-fork' && what) reply = await $.model.complete({ model: 'sonnet', prompt, maxTokens: epic ? 4096 : 1024 })
  if (!reply.isAnswered) {
    $.ui.toast(reply.reason === 'nothing-to-fork' ? `Nothing to capture from yet. Say what it is about: /issues new ${epic ? 'epic ' : ''}<what>` : `Couldn't write the issue: ${reply.reason}`)
    return
  }
  const made = parseDraft(reply.text, labels)
  if (!made) {
    $.ui.toast(`Claude's answer didn't come back as ${epic ? 'an epic' : 'an issue'}. Try /issues new again.`)
    return
  }
  try {
    await capture($, made)
  } catch (cause) {
    $.ui.toast(`Couldn't capture the issue: ${messageOf(cause)}`)
  }
}

// Opens the pane at the Inbox, from the band's capture line: the built-in Inbox tab, or the project view whose filter
// is the Inbox. Without one, the pane opens as it was. Either way the count of captures starts again.
const openInbox = async ($: EngineInterface): Promise<void> => {
  const project = (await read($, board))?.project ?? null
  const tab = inboxTabOf(filtersFor(project), project)
  if (tab) await pickTab($, tab, project)
  await update($, captured, () => 0)
  await $.ui.open(OPEN)
}

// ---- Setup ----

// The repo's folders, for the area labels setup suggests: its top level, and the parts under plugins/, packages/ and
// the like.
const foldersOf = async ($: EngineInterface, root: string): Promise<{ top: string[]; nested: Record<string, string[]> }> => {
  const dirs = async (path: string) => (await $.fs.list(path).catch(() => [])).filter(entry => entry.kind === 'dir').map(entry => entry.name)
  const top = await dirs(root)
  const nested: Record<string, string[]> = {}
  for (const group of ['plugins', 'packages', 'apps', 'services', 'src']) if (top.includes(group)) nested[group] = await dirs(`${root}/${group}`)
  return { top, nested }
}

// Whether the repo has an issue template with an Acceptance list already.
const hasTemplate = async ($: EngineInterface, root: string): Promise<boolean> => {
  const folder = `${root}/.github/ISSUE_TEMPLATE`
  for (const entry of await $.fs.list(folder).catch(() => [])) {
    if (entry.kind !== 'file') continue
    const text = await $.fs.read(`${folder}/${entry.name}`).catch(() => '')
    if (typeof text === 'string' && /acceptance/i.test(text)) return true
  }
  return false
}

// `/issues setup`: reads the repo, its projects, labels and open issues, and puts what it would change in the pane.
// Nothing changes until Apply.
const readSetup = async ($: EngineInterface): Promise<void> => {
  await update($, setup, () => ({ phase: 'reading' as const }))
  try {
    const repoName = (await repoNow($)).nameWithOwner
    const [owner = '', name = ''] = repoName.split('/')
    const facts = await postGraphql($, FACTS_QUERY, { owner, name })
    const pages: string[] = []
    let after: string | null = null
    do {
      const page: string = JSON.stringify({ data: await postGraphql($, ITEMS_QUERY, { owner, name, after }) })
      pages.push(page)
      after = nextItemsOf(page)
    } while (after && pages.length < PAGES)
    const root = (await $.session.repo().catch(() => null))?.root ?? (await $.session.root())
    const labels = ((facts.repository?.labels?.nodes ?? []) as { name: string }[]).map(label => label.name)
    const kept = await savedChoices($)
    const read$ = factsOf(JSON.stringify({ data: facts }), pages, suggestAreas(labels, await foldersOf($, root)), await hasTemplate($, root))
    // The project the board already reads, when setup saved one and it's still linked; else the first linked.
    const chosen = read$.projects.find(one => one.id === kept.preferred)?.id ?? read$.projects[0]?.id ?? null
    // The linked project the board may write to: the chosen one when it may write there, else the first it may.
    const grants = await grantsNow($)
    const listed = read$.projects.filter(one => grants.all.includes(projectKeyOf(one) ?? ''))
    const writes = listed.find(one => one.id === chosen) ?? listed[0]
    const granted = writes ? grants.repo.includes(projectKeyOf(writes) ?? '') : false
    const known = { ...read$, adopted: writes?.id ?? null, ...(granted ? { granted } : {}) }
    // The mapping saved for it, by an earlier setup or by /issues statuses, which setup starts from.
    const roles$ = chosen ? kept.statuses?.[chosen] : undefined
    const found = chosen && roles$ ? { ...known, saved: { project: chosen, roles: roles$ } } : known
    const areas = found.suggested.join(', ')
    const roles = picksFor(found, chosen)
    await update($, setup, () => ({ phase: 'ready' as const, facts: found, chosen, areas, roles, steps: stepsOf(found, chosen, areas, roles) }))
  } catch (cause) {
    const message = messageOf(cause)
    await update($, setup, () => ({ phase: 'failed' as const, message }))
    if (ACCESS_ERROR.test(message) || PROJECT_REFUSED.test(message)) void checkAccess($, message)
  }
}

// Apply: each step in turn, marked running, done, failed or skipped as it goes, so the pane shows how far it got. A step
// that fails doesn't stop the ones after it, save those that need what it would have made.
const applySetup = async ($: EngineInterface): Promise<void> => {
  const now = await read($, setup)
  if (now?.phase !== 'ready') return
  const { facts } = now
  const mark = (id: SetupStep['id'], state: NonNullable<SetupStep['state']>, message?: string) => update($, setup, was => markStep(was, id, state, message))
  const run: SetupRun = async (id, work) => {
    if (!now.steps.some(step => step.id === id)) return
    await mark(id, 'running')
    try {
      await work()
      await mark(id, 'done')
    } catch (cause) {
      await mark(id, 'failed', messageOf(cause))
    }
  }
  await update($, setup, was => (was?.phase === 'ready' ? { ...was, phase: 'applying' as const } : was))

  let project: SetupProject | null = facts.projects.find(one => one.id === now.chosen) ?? null
  // First, since the steps that change the project go through the board's write check. Pressing Apply on the plan that
  // says so is the person letting the board write to the project.
  const chosen = project
  // The project Apply adopted, whose setting it writes once its steps are done.
  let adopted: { number: number; title: string } | null = null
  if (chosen) {
    await run('adopt', async () => {
      await adoptProject($, chosen, true)
      adopted = chosen
    })
  }
  await run('issues', async () => {
    await gh($, ['repo', 'edit', facts.repo.name, '--enable-issues'])
    // The repo read setup used says issues are off, so the next read asks GitHub again.
    repoInfo = undefined
  })
  await run('project', async () => {
    const title = facts.repo.name.split('/')[1] ?? facts.repo.name
    const made = await projectWrite($, 'new', CREATE_PROJECT, { owner: facts.repo.ownerId, title, repo: facts.repo.id })
    project = await rereadProject($, made.createProjectV2.projectV2.id)
    // The person asked setup to make it, so the board may write to it, which the steps after need.
    await adoptProject($, project, true)
    adopted = project
  })
  // Without a project, the steps that work in one can't run.
  if (!project) {
    for (const id of NEEDS_PROJECT) if (now.steps.some(step => step.id === id)) await mark(id, 'skipped', 'There is no project to change.')
  } else {
    project = await applyInProject($, now, project, run)
  }
  await run('bug', () => gh($, bugLabelArgs(facts.repo.name)))
  await run('areas', async () => {
    for (const args of areaLabelArgs(facts.repo.name, now.areas, facts.labels)) await gh($, args)
  })
  // Set inside the steps' callbacks, which the compiler can't follow.
  await endSetup($, now, project, adopted as { number: number; title: string } | null)
}

// One of Apply's steps: marked running, then done or failed, and skipped when the plan hasn't got it.
type SetupRun = (id: SetupStep['id'], work: () => Promise<unknown>) => Promise<void>
type SetupPlan = Extract<Setup, { facts: unknown }>

// A project as setup reads it, read again after Apply changed it.
const rereadProject = async ($: EngineInterface, id: string): Promise<SetupProject> => projectOf((await postGraphql($, PROJECT_QUERY, { id })).node)

// Apply's steps in the project: its Status options, its Priority field, an item for each open issue, and the Inbox for
// the items with no Status. Answers the project as it ends.
const applyInProject = async ($: EngineInterface, now: SetupPlan, project: SetupProject, run: SetupRun): Promise<SetupProject> => {
  let current: SetupProject = project
  await run('status', async () => {
    if (!current.status) throw new Error('the project has no Status field')
    await projectWrite($, current, UPDATE_FIELD, { field: current.status.id, options: statusFieldOf(current.status.options, now.roles) })
    current = await rereadProject($, current.id)
  })
  // The roles are saved with the rest once Apply ends.
  await run('roles', async () => undefined)
  await run('priority', async () => {
    await projectWrite($, current, CREATE_FIELD, { project: current.id, name: 'Priority', options: PRIORITIES })
    current = await rereadProject($, current.id)
  })
  // Each open issue's item in the project, the ones already there and the ones added now.
  const items = itemsIn(now.facts, current.id)
  await run('items', async () => {
    for (const issue of now.facts.issues) {
      if (items.has(issue.number)) continue
      const added = await projectWrite($, current, ADD_ITEM, { project: current.id, content: issue.id })
      items.set(issue.number, { project: current.id, item: added.addProjectV2ItemById.item.id, status: null })
    }
  })
  await run('inbox', async () => {
    const inbox = inboxOf(current, now.roles)
    if (typeof inbox === 'string') throw new Error(inbox)
    for (const { item, status } of items.values()) {
      if (status) continue
      await projectWrite($, current, SET_FIELD, { project: current.id, item, field: inbox.field, option: inbox.option })
    }
  })
  return current
}

// Apply's end: the board reads the project setup ended with from now on, and knows which Status means what; the
// project Apply adopted goes in the setting now that its steps are done; and the pane shows the project as it now is.
const endSetup = async ($: EngineInterface, now: SetupPlan, ended: SetupProject | null, adopted: { number: number; title: string } | null): Promise<void> => {
  if (ended) await changeChoices($, was => choicesAfterSetup(was, ended, now.roles))
  if (adopted) {
    try {
      await writeSetting($, (await grantsNow($)).own)
    } catch (cause) {
      $.ui.toast(`Couldn't save that the board may write to ${adopted.title}: ${messageOf(cause)}`)
    }
  }
  const adoptedId = (await adoptedNow($))?.id ?? null
  await update($, setup, was => setupDone(was, ended, adoptedId, now.roles))
  projectRefusal = undefined
  void refresh($)
}

// `/issues setup`: the project picked, the area labels typed and the option picked for a part each work out the
// changes again.
const chooseProject = ($: EngineInterface, id: string | null): Promise<unknown> =>
  update($, setup, was => {
    if (was?.phase !== 'ready') return was
    const roles = picksFor(was.facts, id)
    return { ...was, chosen: id, roles, steps: stepsOf(was.facts, id, was.areas, roles) }
  })
const typeAreas = ($: EngineInterface, text: string): Promise<unknown> =>
  update($, setup, was => (was?.phase === 'ready' ? { ...was, areas: text, steps: stepsOf(was.facts, was.chosen, text, was.roles) } : was))
const pickRole = ($: EngineInterface, role: Role, name: string | null): Promise<unknown> =>
  update($, setup, was => {
    if (was?.phase !== 'ready') return was
    const roles = { ...was.roles, [role]: name }
    return { ...was, roles, steps: stepsOf(was.facts, was.chosen, was.areas, roles) }
  })

// ---- Workers, starting work, and what Claude hears of the issue it is on ----

// Start, on GitHub too: the issue moves to In progress in the project and is assigned to the person, so the project
// says who is on what. Then the issue is read again, so the band doesn't call these changes news. Its epic follows, by
// its own setting.
const claim = async ($: EngineInterface, issue: Issue): Promise<void> => {
  // Turned off, Start leaves the issue's assignees and Status as they are.
  if (settings.claimOnStart) await claimIssue($, issue)
  await startEpic($, issue)
}

// A sub-issue started: its epic, still waiting in the Inbox, Backlog or Ready, moves to In progress with it, so the
// project shows the epic under way. An epic further along stays where it is.
const startEpic = async ($: EngineInterface, issue: Issue): Promise<void> => {
  if (!settings.autoMove) return
  const now = await read($, board)
  const epic = now ? epicToStart(now.issues, issue, now.project) : undefined
  const started = startedOf(now?.project)
  if (!epic || !started || !now?.project || !(await mayWrite($, now.project))) return
  try {
    await setField($, epic, 'status', started.name)
    moved.push(`#${epic.number} moved to ${started.name}: its sub-issue #${issue.number} was started.`)
  } catch (cause) {
    $.ui.toast(unmovedText(started.name, [{ number: epic.number, message: messageOf(cause) }]))
  }
}

const claimIssue = async ($: EngineInterface, issue: Issue): Promise<void> => {
  const failures: string[] = []
  const project = (await read($, board))?.project
  // The Status moves only in a project the person let the board write to; the issue is assigned either way.
  const started = project && (await mayWrite($, project)) ? startedOf(project) : undefined
  if (started && issue.status !== started.name) await setField($, issue, 'status', started.name).catch((cause: unknown) => void failures.push(messageOf(cause)))
  const me = await read($, viewer)
  if (!me || !issue.assignees.includes(me)) {
    await gh($, ['issue', 'edit', String(issue.number), '--add-assignee', '@me']).catch((cause: unknown) => void failures.push(messageOf(cause)))
  }
  try {
    const [fresh] = parseIssues(`[${await gh($, ['issue', 'view', String(issue.number), '--json', ISSUE_FIELDS])}]`)
    if (fresh) await take($, fresh)
  } catch (cause) {
    failures.push(messageOf(cause))
  }
  if (failures.length === 0) return
  $.ui.toast(`Started #${issue.number}, but couldn't update GitHub: ${failures[0]}`)
  if (failures.some(failure => ACCESS_ERROR.test(failure))) void checkAccess($, failures.join('\n'))
}

// Claude starting on an issue in the conversation, by the issue_update tool's `start`: as Start does, the issue becomes
// the one this session is on, moves to In progress and is assigned to the person. A pull request's number starts the
// issue it is for. An epic starts its next ready sub-issue, as the Start button does.
const startHere = async ($: EngineInterface, number: number): Promise<string> => {
  const now = await read($, board)
  const pr = now?.prs.find(one => one.number === number)
  const target = pr ? pr.issues.find(one => now?.issues.some(issue => issue.number === one)) : number
  const asked = now?.issues.find(one => one.number === target)
  if (!asked) throw new Error(pr ? `pull request #${number} names no issue open on the board` : `#${number} isn't open on the board`)
  const issue = startTargetOf(now?.issues ?? [], asked, now?.project ?? null, await markersNow($, now))
  if (!issue) throw new Error(noReadyText(asked.number))
  const epic = issue.number !== asked.number ? `, the next ready sub-issue of epic #${asked.number}` : ''
  await track($, issue, true)
  await claim($, issue)
  $.ui.toast(`Working on #${issue.number} now`)
  const started = now?.project && (await mayWrite($, now.project)) ? startedOf(now.project) : undefined
  const claimed = settings.claimOnStart ? (started ? `, ${started.name} and assigned` : ', assigned') : ''
  return `Started #${issue.number}${pr ? `, the issue pull request #${number} is for` : ''}${epic}: it is the issue this session is on${claimed}.`
}

// The issue Claude is on, when this session started it: the one the notes and the next step are about.
const doingHere = async ($: EngineInterface): Promise<Working | null> => {
  const doing = await read($, working)
  return doing?.sessionId && doing.sessionId === (await $.session.id().catch(() => undefined)) ? doing : null
}

// The board's copy of the issue Claude is on, as Claude's own change to it begins; null before Claude knows it.
const copyOf = async ($: EngineInterface): Promise<Known | null> => {
  const now = await read($, board)
  const doing = await read($, working)
  return now && doing?.known ? knownOf(now.issues.find(one => one.number === doing.number), now.prs) : null
}

// Claude's own change to the issue it is on isn't news to it: what changed from `before` to `after` (the board's copy
// now, when not given) goes into what Claude knows.
const absorb = async ($: EngineInterface, before: Known | null, after?: Known): Promise<void> => {
  const now = await read($, board)
  if (!now || !before) return
  await update($, working, was =>
    was?.known ? { ...was, known: absorbed(was.known, before, after ?? knownOf(now.issues.find(one => one.number === was.number), now.prs)) } : was,
  )
  await save($)
}

// The comments of an issue, when the board counts more than Claude knows of; none when gh can't say in ten seconds,
// and the note then says how to read them.
const newComments = async ($: EngineInterface, number: number, was: Known, now: Known): Promise<Comment[]> => {
  if (now.comments === null || was.comments === null || now.comments <= was.comments) return []
  try {
    return commentsOf(await gh($, ['issue', 'view', String(number), '--json', 'comments'], undefined, 10_000))
  } catch {
    return []
  }
}

// What changed on GitHub to the issue Claude is on since its last prompt, as a note for the next one; what Claude knows
// then moves on to the board's copy. Null with nothing to say, or before Claude knows anything of it.
const newsFor = async ($: EngineInterface, now: Board): Promise<string | null> => {
  const doing = await doingHere($)
  if (!doing) return null
  const current = knownOf(now.issues.find(one => one.number === doing.number), now.prs)
  const note = doing.known ? newsOf(doing.number, doing.known, current, await newComments($, doing.number, doing.known, current)) : null
  if (JSON.stringify(doing.known) !== JSON.stringify(current)) {
    await update($, working, was => (was?.number === doing.number ? { ...was, known: current } : was))
    await save($)
  }
  return note
}

// Start makes a task in Claude's task list for each open box that has none yet, so the list follows the issue; when
// Claude completes one, the band asks whether to tick its box. Answers how many tasks the issue has: none where the
// session keeps no task list.
const makeTasks = async ($: EngineInterface, issue: Issue): Promise<number> => {
  const had = (await read($, tasks)).filter(one => one.number === issue.number)
  const made: BoxTask[] = []
  for (const [index, check] of issue.checks.entries()) {
    if (check.done || had.some(one => one.text === check.text)) continue
    try {
      const answer = await $.tool.call({
        tool: 'TaskCreate',
        subject: fit(check.text, 80),
        description: `Box ${index + 1} of #${issue.number}, ${issue.title}: ${check.text}`,
        metadata: { issue: issue.number, box: index + 1 },
      })
      const id = answer.deny === undefined && !answer.isError ? (answer.result as { task?: { id?: unknown } } | undefined)?.task?.id : undefined
      if (typeof id !== 'string') break
      made.push({ id, number: issue.number, box: index + 1, text: check.text, done: false })
    } catch (cause) {
      $.ui.log(`issue-board: couldn't make a task for a box of #${issue.number}: ${messageOf(cause)}`, { to: 'debug' })
      break
    }
  }
  if (made.length > 0) await update($, tasks, list => [...list, ...made])
  return had.length + made.length
}

// After Claude's turn: the board looks at GitHub again if Claude ran git or gh since it last did, reading in full only
// when the cheap checks see a change (a write to GitHub reads at once by itself). Then the prompt box suggests the next
// step for the issue Claude is on, such as opening its pull request once every box is ticked.
const afterTurn = async ($: EngineInterface): Promise<void> => {
  await settle($)
  if (touches > readTouches) await poll($)
  const now = await read($, board)
  // Turned off, the prompt box keeps Claude Code's own suggestion.
  const step = now && settings.suggestNextStep ? nextStepOf(now, await doingHere($)) : null
  nextStep = step
  // The box takes a suggestion once the turn has wound down: a few tries, while no new prompt has come.
  for (let tries = 0; step && nextStep === step && tries < 3; tries += 1) {
    if ((await $.prompt.suggest({ text: step }).catch(() => ({ isShown: false }))).isShown) break
    await $.clock.sleep(1000)
  }
}

// While a background agent works, the board asks where each stands every 10 seconds, and stops once none works. An
// agent the list shows ended may still answer; when no answer has come 10 seconds later, the board says how it ended
// without one.
let workerTimer: Timer | undefined
const checkWorkers = async ($: EngineInterface): Promise<void> => {
  const listed = await $.agent.list().catch(() => [])
  const moved = (await read($, workers)).flatMap(one => {
    const info = listed.find(agent => agent.id === one.agentId)
    return info && one.status !== info.status && ACTIVE.includes(one.status) ? [{ agentId: one.agentId, status: info.status }] : []
  })
  if (moved.length > 0) await update($, workers, list => list.map(one => ({ ...one, status: moved.find(to => to.agentId === one.agentId)?.status ?? one.status })))
  for (const { agentId, status } of moved) {
    if (status === 'completed' || status === 'failed' || status === 'killed') $.clock.after(10_000, () => void handOff($, agentId, status, null))
  }
  if (!(await read($, workers)).some(one => ACTIVE.includes(one.status))) {
    workerTimer?.cancel()
    workerTimer = undefined
  }
}
const pollWorkers = ($: EngineInterface): void => {
  if (!workerTimer) workerTimer = $.clock.every(10_000, () => void checkWorkers($))
}

// The Starts pressed and not yet under way, read at once so a second press finds the first; `launching` draws them.
const pressed = new Set<string>()

// A Start on an issue is under way, or failed to get there: its button comes back.
const landed = async ($: EngineInterface, number: number, how: Launch['how']): Promise<void> => {
  pressed.delete(`${how}-${number}`)
  await update($, launching, list => list.filter(one => one.number !== number || one.how !== how))
}

// A Start on an issue, from the press until the work is under way: its button says so meanwhile, and another press of
// it does nothing. `work` resolves true once the work is under way, or false when it waits on something else to land it.
const launch = async ($: EngineInterface, issue: Issue, how: Launch['how'], work: () => Promise<boolean>): Promise<void> => {
  const key = `${how}-${issue.number}`
  if (pressed.has(key)) return
  pressed.add(key)
  await update($, launching, list => [...list, { number: issue.number, how }])
  let done = true
  try {
    done = await work()
  } finally {
    if (done) await landed($, issue.number, how)
  }
}

// Whether the start message Edit first fills for the issue will go with the board's copy of it: copies are on and the
// board has the issue. The person sends it, so the prompt.submit hook sees it, and the message leaves the boxes to the
// copy.
const copyGoes = async ($: EngineInterface, issue: Issue): Promise<boolean> => {
  if (!settings.issueCopies) return false
  const now = await read($, board)
  return now ? copyKeyOf(now, issue.number) !== null : false
}

// The person's own prompt, sent after Edit first filled the box with Start's message: when it still names the issue,
// the issue becomes the one Claude is on and gets its tasks, as Start does. Rewritten so it no longer names the issue,
// it is a plain prompt. Answers the issue started, and whether it has tasks, for the hook to claim once it is sent.
const draftedStart = async ($: EngineInterface, e: { text: string; origin: { kind: string } }): Promise<{ issue: Issue; listed: boolean } | null> => {
  if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return null
  const number = await read($, drafted)
  if (number === null) return null
  await update($, drafted, () => null)
  const issue = (await read($, board))?.issues.find(one => one.number === number)
  if (!issue || !namesIssue(e.text, number)) return null
  // The message leans on the issue's copy for its boxes, so it carries a fresh one even if an earlier prompt did.
  sentCopies.delete(number)
  try {
    await track($, issue, true)
    return { issue, listed: (await makeTasks($, issue)) > 0 }
  } catch (cause) {
    $.ui.log(`issue-board: couldn't start #${number} from its edited message: ${messageOf(cause)}`, { to: 'debug' })
    return null
  }
}

// Start in background: the board starts an agent of its own type on the issue, to work it in a git worktree of its own,
// in the background, and leave a pull request. Claude gets no message: the agent's prompt goes to the agent alone. The
// button says it is starting until the agent starts or the spawn is refused or fails, which a toast explains. Once it
// starts, the issue's row follows it, and the issue moves to In progress and is assigned, as Start does.
const startInBackground = ($: EngineInterface, issue: Issue): Promise<void> =>
  launch($, issue, 'background', async () => {
    const description = `#${issue.number} ${issue.title}`
    let started: AgentSpawnResult
    try {
      started = await $.agent.spawn({ subagentType: WORKER, description, prompt: startPrompt(issue) })
    } catch (cause) {
      $.ui.toast(`Couldn't start a background agent on #${issue.number}: ${messageOf(cause)}`)
      return true
    }
    if (started.deny !== undefined) {
      $.ui.toast(`Couldn't start a background agent on #${issue.number}: ${started.deny}`)
      return true
    }
    try {
      const agentId = started.agentId ?? (await workerIdOf($, description))
      if (!agentId) throw new Error('no agent id')
      await workerStarted($, issue.number, agentId, false)
    } catch (cause) {
      $.ui.toast(`Started a background agent on #${issue.number}, but the board couldn't follow it: ${messageOf(cause)}`)
    }
    await claim($, issue)
    return true
  })

// The id of a board agent that just started, when core didn't name it: the session's list does, by the name it was
// given, or by its description when it has none. An earlier agent on the issue may match too, so one that hasn't ended
// comes first.
const workerIdOf = async ($: EngineInterface, description: string, name?: string): Promise<string | undefined> => {
  const matching = (await $.agent.list()).filter(agent => agent.type === WORKER && (name ? agent.name === name : agent.description === description))
  return (matching.findLast(agent => !['completed', 'failed', 'killed'].includes(agent.status)) ?? matching.at(-1))?.id
}

// A spawn of the board's agent, by Claude or anyone: once it starts, the issue's row follows it.
const workerStarted = async ($: EngineInterface, number: number, agentId: string, byClaude: boolean): Promise<void> => {
  const title = (await read($, board))?.issues.find(one => one.number === number)?.title
  const worker: Worker = { number, ...(title ? { title } : {}), agentId, status: 'running', startedAt: Date.now(), answer: null, ...(byClaude ? { byClaude } : {}) }
  await update($, workers, list => [...list.filter(one => one.number !== number), worker])
  pollWorkers($)
  $.ui.toast(`Started a background agent on #${number}`)
}

// A background agent's answer is its loop's last turn: it is done, stopped or failed.
const workerEnded = ($: EngineInterface, agentId: string, answer: string, reason: string): Promise<void> =>
  handOff($, agentId, reason === 'answer' ? 'completed' : reason === 'aborted' ? 'killed' : 'failed', answer)

// The agents whose end the conversation was told of, read at once so the answer and the list's word don't both tell it.
const told = new Set<string>()

// A background agent ended: the board reads GitHub, where it may have opened a pull request, then a line in the
// conversation tells the person how it ended, with what it said and its pull request. When something other than
// Claude's own Agent tool call started it, Claude gets the same as a prompt of the board's, so it can follow up; when
// Claude started it, Claude Code already gives Claude its result, and a second message would only repeat it. An agent
// the board spawned itself gets no task notification from Claude Code, so the hand-off keeps the start of its answer.
const handOff = async ($: EngineInterface, agentId: string, status: Ended, answer: string | null): Promise<void> => {
  if (told.has(agentId)) return
  told.add(agentId)
  const worker = (await read($, workers)).find(one => one.agentId === agentId)
  if (!worker || worker.told) return
  const said = answer?.trim() || null
  await update($, workers, list => list.map(one => (one.agentId === agentId ? { ...one, status, answer: said ? fit(said, 600) : one.answer, told: true } : one)))
  $.ui.toast(`The background agent on #${worker.number} ${status === 'completed' ? 'finished' : status === 'killed' ? 'was stopped' : 'failed'}`)
  await settle($)
  await refresh($)
  const now = await read($, board)
  const issue = { number: worker.number, title: worker.title ?? now?.issues.find(one => one.number === worker.number)?.title ?? '' }
  const pr = workerPrOf(worker.number, now?.prs ?? [], said ?? '')
  $.ui.log(endedLine(issue, status, said, pr))
  if (worker.byClaude) return
  try {
    const sent = await submit($, 'hand-offs', { text: handoffPrompt(issue, status, said, pr, settings.startMode) })
    if (sent.drop !== undefined) throw new Error(sent.drop)
  } catch (cause) {
    $.ui.log(`issue-board: couldn't tell Claude the background agent on #${worker.number} ended: ${messageOf(cause)}`, { to: 'debug' })
  }
}

// Start: the issue is the one Claude is on, and Claude gets it. Its button says so from the press on.
const startFromPane = ($: EngineInterface, issue: Issue): Promise<void> =>
  launch($, issue, 'start', async () => {
    // A start message Edit first left in the prompt box is spent: sending it later doesn't start the issue again.
    await update($, drafted, () => null)
    await track($, issue, true)
    const listed = await makeTasks($, issue)
    // The board's own prompt.submit hook doesn't see a prompt the board submits, so this message goes without the
    // issue's copy and lists the boxes itself.
    await submit($, 'start prompts', { text: startPrompt(issue, listed > 0), asUser: true })
    $.ui.toast(`Sent #${issue.number} to Claude`)
    await claim($, issue)
    return true
  })

// Edit first puts the start message in the prompt box. Sending the foreground message starts the issue, by the
// prompt.submit hook; the background one asks Claude to dispatch the worker, and the agent.spawn hook claims it and
// follows it.
const draftStart = async ($: EngineInterface, target: Issue, background: boolean): Promise<void> => {
  const filled = await $.prompt.fill({ text: background ? backgroundPrompt(target) : startPrompt(target, false, await copyGoes($, target)) })
  if (!filled.isFilled) return
  await update($, drafted, () => (background ? null : target.number))
}

// Stop tracking the issue this session is on: no row has the ▶ until Start or a branch names one again.
const stopTracking = async ($: EngineInterface): Promise<void> => {
  await update($, working, () => null)
  await save($)
}

// The keyword a pull request written now gives the issue this session is on, `Closes #N` or `Refs #N`, from its boxes
// as the board holds them. The tick tool writes what it ticked back to the board, so this asks GitHub nothing: the
// engine may compose the text often.
const prKeywordNow = async ($: EngineInterface): Promise<string> => {
  const now = await read($, working)
  const mine = !!now?.sessionId && now.sessionId === (await $.session.id().catch(() => undefined))
  const issue = mine ? (await read($, board))?.issues.find(one => one.number === now.number) : undefined
  return prKeyword(issue ?? null, await read($, workers), settings.closesWhenTicked)
}

// ---- Plan and triage, and the pane's other actions ----

// The issues closed lately, for the pane's Closed filter: read when the filter is chosen, over REST.
const readRecent = async ($: EngineInterface): Promise<void> => {
  const repo = (await read($, board))?.repo
  if (!repo) return
  try {
    const items = JSON.parse(await gh($, ['api', `repos/${repo}/issues?state=closed&sort=updated&direction=desc&per_page=30`])) as unknown[]
    await update($, recent, () => ({ items: foundOf(items), at: Date.now() }))
  } catch (cause) {
    await update($, recent, was => ({ items: was?.items ?? [], at: Date.now(), failed: messageOf(cause) }))
  }
}

// The plan project_plan's input asks for, checked against the board as it is now. A plan that changes the project is
// refused here, before anything is asked, when the board may not write to it; each write checks again as it goes.
// `count` has each label delete count the issues that carry the label, for its row on the card.
const planFor = async ($: EngineInterface, input: unknown, count = false): Promise<Planned> => {
  const now = await read($, board)
  if (!now) return { problems: [NOT_READ_SENTENCE] }
  const refusal = await boardRefusal($, now)
  const planned = planOf(input, { issues: now.issues, project: now.project, milestones: now.milestones, refusal, labels: now.labels, markers: await read($, chosenMarkers) })
  if (!count || 'problems' in planned) return planned
  const changes = await Promise.all(
    planned.changes.map(async one => (one.change.kind === 'label' && one.change.action === 'delete' ? { ...one, change: { ...one.change, uses: await labelUses($, now.repo, one.change.name) } } : one)),
  )
  return { changes }
}

// How many open and closed issues carry a label, from GitHub's search counts; null when it couldn't count.
const labelUses = async ($: EngineInterface, repo: string, name: string): Promise<{ open: number; closed: number } | null> => {
  try {
    const [open, closed] = await Promise.all(
      (['open', 'closed'] as const).map(async state =>
        Number((await gh($, ['api', '-X', 'GET', 'search/issues', '-f', `q=repo:${repo} is:issue state:${state} label:"${name.replace(/"/g, '')}"`, '-f', 'per_page=1', '--jq', '.total_count'])).trim()),
      ),
    )
    return Number.isFinite(open) && Number.isFinite(closed) ? { open: open as number, closed: closed as number } : null
  } catch (cause) {
    $.ui.log(`issue-board: couldn't count the issues with the label ${name}: ${messageOf(cause)}`, { to: 'debug' })
    return null
  }
}

// Makes, edits or deletes one of the repo's labels over REST, then moves or clears the saved markers that go by it and
// keeps the card's label picker in step. GitHub keeps a renamed label on its issues. Answers what it did.
const applyLabel = async ($: EngineInterface, change: LabelChange): Promise<string> => {
  const repo = (await read($, board))?.repo
  if (!repo) throw new Error(NOT_READ)
  const path = `repos/${repo}/labels/${encodeURIComponent(change.name)}`
  const fields = [
    ...(change.rename ? ['-f', `new_name=${change.rename}`] : []),
    ...(change.color ? ['-f', `color=${change.color}`] : []),
    ...(change.description !== undefined ? ['-f', `description=${change.description}`] : []),
  ]
  let done: string
  if (change.action === 'create') {
    const color = change.color ?? labelColorFor(change.name, ((await read($, board))?.labels ?? []).map(name => ({ name })))
    await gh($, ['api', '-X', 'POST', `repos/${repo}/labels`, '-f', `name=${change.name}`, '-f', `color=${color}`, ...(change.description !== undefined ? ['-f', `description=${change.description}`] : [])])
    done = `Created the label ${change.name}.`
  } else if (change.action === 'delete') {
    await gh($, ['api', '-X', 'DELETE', path])
    done = `Deleted the label ${change.name}.`
  } else {
    await gh($, ['api', '-X', 'PATCH', path, ...fields])
    done = `${change.rename ? `Renamed the label ${change.name} to ${change.rename}` : `Changed the label ${change.name}`}${change.color ? `, its color now #${change.color}` : ''}.`
  }
  const markers = change.markers ?? []
  if (markers.length > 0) {
    const to = change.action === 'edit' ? change.rename : undefined
    await changeChoices($, was => {
      const saved = { ...(was.markers ?? {}) }
      if (markers.includes('bug')) {
        if (to) saved.bug = { label: to }
        else delete saved.bug
      }
      if (markers.includes('later')) {
        if (to) saved.later = to
        else delete saved.later
      }
      return { ...was, markers: saved }
    })
    const names = markers.map(one => (one === 'bug' ? 'Bugs' : 'Later')).join(' and ')
    done += to ? ` The saved ${names} marker goes by ${to} now.` : ` The saved ${names} marker is cleared, so the board guesses it again.`
  }
  await update($, palette, was => {
    if (!was) return was
    const kept = was.labels.filter(name => change.action === 'create' || name.toLowerCase() !== change.name.toLowerCase())
    const added = change.action === 'create' ? [change.name] : change.rename ? [change.rename] : change.action === 'edit' ? [change.name] : []
    return { ...was, labels: [...new Set([...kept, ...added])].sort() }
  })
  return done
}

// Makes a plan's change to one of the project's views, through the project write check. An existing view is found by
// its number, as the board read it. A new view's filter goes in by a change straight after it is made, since creating
// takes none. The board's next read has the views, so the pane's tabs show them. Answers what it did.
const applyView = async ($: EngineInterface, change: ViewChange): Promise<string> => {
  const project = (await read($, board))?.project
  if (!project) throw new Error("the board reads no project for this repo, so it can't change its views")
  const { view, to } = change
  let id: string | undefined
  if (view) {
    const found = (await postGraphql($, VIEW_ID, { project: project.id, number: view.number })) as { node?: { view?: { id?: string } | null } | null }
    id = found.node?.view?.id
    if (!id) throw new Error(`${project.title} has no view ${view.name} any more`)
  }
  if (!to) {
    await projectWrite($, project, DELETE_VIEW, { view: id ?? '' })
    return viewDoneText(change)
  }
  if (!id) {
    const made = (await projectWrite($, project, CREATE_VIEW, { input: { projectId: project.id, name: to.name, layout: LAYOUT_NAMES[to.layout] } })) as {
      createProjectV2View?: { projectV2View?: { id?: string } | null } | null
    }
    const madeId = made.createProjectV2View?.projectV2View?.id
    if (to.filter && !madeId) throw new Error(`GitHub made the view ${to.name} but didn't say which it is, so its filter isn't set`)
    if (to.filter && madeId) await projectWrite($, project, UPDATE_VIEW, { input: { viewId: madeId, filter: to.filter } })
    return viewDoneText(change)
  }
  const was = view as NonNullable<typeof view>
  const input = {
    viewId: id,
    ...(to.name !== was.name ? { name: to.name } : {}),
    ...(to.layout !== was.layout ? { layout: LAYOUT_NAMES[to.layout] } : {}),
    ...(to.filter !== was.filter ? { filter: to.filter } : {}),
  }
  await projectWrite($, project, UPDATE_VIEW, { input })
  return viewDoneText(change)
}

// Puts a plan on the pane's card, every row ticked, in place of any plan before it. Answers its id, which tells it from
// the plan that may replace it while the permission prompt waits.
const propose = async ($: EngineInterface, changes: Extract<Planned, { changes: unknown }>['changes']): Promise<number> => {
  const id = ((await read($, proposal))?.id ?? 0) + 1
  await update($, proposal, () => ({ id, rows: rowsOf(changes), applying: false, note: null }))
  return id
}

// Applies the plan's ticked rows in order, each the way issue_update makes that change, through the project write check
// for the project's fields. The board is read once, after them all. Rows that went through leave the card, as do rows
// left unticked; a row that failed stays, ticked, with why, and the card says how it went. A ticked row the board shows
// as made already, as when Claude made it another way after proposing the plan, is skipped and named. Answers what
// happened.
const applyPlan = async ($: EngineInterface, id: number): Promise<string> => {
  const now = await read($, proposal)
  if (!now || now.id !== id) return 'That plan is gone: it was applied, discarded or replaced meanwhile.'
  if (now.applying) return 'That plan is being applied already.'
  const picked = now.rows.filter(row => row.picked)
  if (picked.length === 0) return 'No change of the plan is ticked, so nothing was applied.'
  const mine = (was: Plan | null): was is Plan => was !== null && was.id === id
  const current = await read($, board)
  const chosen = current ? rowsToMake(picked, current) : picked
  const skipped = picked.filter(row => !chosen.includes(row))
  if (chosen.length === 0) {
    await update($, proposal, was => (mine(was) ? null : was))
    return appliedText([], [], skipped)
  }
  await update($, proposal, was => (mine(was) ? { ...was, applying: true, note: null } : was))
  const done: string[] = []
  const failed: { row: PlanRow; message: string }[] = []
  try {
    for (const row of chosen) {
      try {
        const change = row.change
        done.push(
          change.kind === 'label' ? await applyLabel($, change) : change.kind === 'view' ? await applyView($, change) : await applyChanges($, change.number, issueChangesOf(change), false),
        )
      } catch (cause) {
        failed.push({ row, message: messageOf(cause) })
      }
    }
    await refreshAfter($)
  } finally {
    await update($, proposal, was => (mine(was) && was.applying ? { ...was, applying: false } : was))
  }
  const text = appliedText(done, failed, skipped)
  await update($, proposal, was => (mine(was) ? (failed.length === 0 ? null : { ...was, rows: failed.map(({ row, message }) => ({ ...row, failed: message })), note: text.split('\n')[0] ?? null }) : was))
  const access$ = failed.find(one => ACCESS_ERROR.test(one.message))
  if (access$) void checkAccess($, access$.message)
  return text
}

// Apply on the plan card: the person's own press, so it asks nothing more. A toast says how it went.
const applyFromCard = async ($: EngineInterface, id: number): Promise<void> => {
  try {
    $.ui.toast((await applyPlan($, id)).split('\n')[0] ?? '')
  } catch (cause) {
    $.ui.toast(`Couldn't apply the plan: ${messageOf(cause)}`)
  }
}

// How many Inbox issues one ask covers; more are asked about in turn.
const TRIAGE_BATCH = 15

// The repo's areas, the `area:` labels without the prefix: from the labels the board's last read had, else as GitHub
// lists them, else the ones on the board's issues.
const repoAreas = async ($: EngineInterface, now: Board): Promise<string[]> => {
  const names =
    now.labels ??
    (await repoLabels($, now.repo)
      .then(list => list.map(one => one.name))
      .catch(() => labelsOf(now.issues)))
  return names.filter(name => name.startsWith('area:')).map(name => name.slice('area:'.length)).sort()
}

// Asks Claude for a Priority, an area and a Status for each issue in the Inbox it has no suggestion for since the issue
// last changed, a batch at a time. One ask at a time; the pane shows the suggestions as they come.
let suggesting = false
const suggestInbox = async ($: EngineInterface): Promise<void> => {
  if (suggesting) return
  suggesting = true
  try {
    for (;;) {
      const now = await read($, board)
      const project = now?.project
      if (!now || !project) return
      const known = (await read($, triage)).suggestions
      const due = now.issues.filter(issue => isInbox(issue, now.project) && !known.some(one => one.number === issue.number && one.updatedAt === issue.updatedAt)).slice(0, TRIAGE_BATCH)
      if (due.length === 0) return
      await update($, triage, was => ({ ...was, asking: true, failed: null }))
      // Kept first, so the person can pick any of them should Claude not answer.
      const areas = await repoAreas($, now)
      await update($, triage, was => ({ ...was, areas }))
      const priorities = (project.priority?.options ?? []).map(option => ({ name: option.name, description: PRIORITIES.find(one => one.name === option.name)?.description ?? '' }))
      const reply = await $.model.complete({ model: 'sonnet', prompt: triagePrompt(now.repo, due, priorities, areas), maxTokens: 4096, effort: 'low' })
      if (!reply.isAnswered) throw new Error(`Claude didn't answer (${reply.reason})`)
      const made = parseTriage(reply.text, due, priorities.map(one => one.name), areas, project)
      if (made.length === 0) throw new Error("Claude's answer didn't come back as suggestions")
      await update($, triage, was => ({ ...was, suggestions: [...was.suggestions.filter(one => !made.some(fresh => fresh.number === one.number)), ...made] }))
      // Claude left some out: they wait for Suggest again rather than be asked about over and over.
      if (made.length < due.length) return
    }
  } catch (cause) {
    const message = messageOf(cause)
    await update($, triage, was => ({ ...was, failed: message }))
  } finally {
    suggesting = false
    await update($, triage, was => ({ ...was, asking: false }))
  }
}

// Suggest again: Claude's suggestions for the Inbox are dropped and asked for afresh; the person's picks stay.
const suggestAgain = async ($: EngineInterface): Promise<void> => {
  const now = await read($, board)
  const inbox = (now?.issues ?? []).filter(issue => isInbox(issue, now?.project)).map(issue => issue.number)
  await update($, triage, was => ({ ...was, suggestions: was.suggestions.filter(one => !inbox.includes(one.number)) }))
  await suggestInbox($)
}

// Accept on an Inbox issue: its Priority and area as picked, Claude's suggestion unless changed, and its Status moved
// on to Ready or Backlog, so it leaves the Inbox, where the project has that option. Another area label it had comes off.
// On a project the board only reads, the labels still change, since they are the repo's, not the project's. The Status
// and Priority are skipped and the toast says why. The issue stays in the Inbox then, so the person's picks stay too.
const acceptTriage = async ($: EngineInterface, issue: Issue, choice: { priority: string | null; area: string | null }, status: 'Ready' | 'Backlog'): Promise<void> => {
  const label = choice.area ? `area:${choice.area}` : null
  const others = label ? issue.labels.map(one => one.name).filter(name => name.startsWith('area:') && name !== label) : []
  const project = (await read($, board))?.project
  const refusal = await boardRefusal($, { project })
  const target = triageTarget(project, status)
  const fields: IssueChanges = {
    ...(target ? { status: target } : {}),
    ...(choice.priority && choice.priority !== issue.priority ? { priority: choice.priority } : {}),
  }
  const labels: IssueChanges = {
    ...(label && !issue.labels.some(one => one.name === label) ? { addLabels: [label] } : {}),
    ...(others.length > 0 ? { removeLabels: others } : {}),
  }
  try {
    if (refusal) {
      const done = labels.addLabels || labels.removeLabels ? await applyChanges($, issue.number, labels) : ''
      const skipped = fields.status || fields.priority ? `Skipped its Status and Priority: ${refusal}` : ''
      $.ui.toast([done || (skipped ? `Nothing changed on #${issue.number}.` : `Nothing to change on #${issue.number}.`), skipped].filter(Boolean).join(' '))
      return
    }
    $.ui.toast(await applyChanges($, issue.number, { ...fields, ...labels }))
    await update($, triage, was => ({ ...was, picks: was.picks.filter(one => one.number !== issue.number) }))
  } catch (cause) {
    toastFailure($, `Couldn't triage #${issue.number}`, cause)
  }
}

// What the pane's buttons do, from here on and in the sections above. The pane hook builds its handlers from these and
// hands them to the views.

// How many of an issue's comments a card shows: the latest.
const SHOWN_COMMENTS = 3

// Reads an issue's comments for its card. One card is open at a time, so this holds only its comments; a card opened
// meanwhile keeps the comments it asked for.
const loadComments = async ($: EngineInterface, number: number): Promise<void> => {
  await update($, talk, was => (was?.number === number ? was : { number, comments: null, total: 0 }))
  try {
    const all = commentsOf(await gh($, ['issue', 'view', String(number), '--json', 'comments']))
    await update($, talk, was => (was?.number === number ? { number, comments: all.slice(-SHOWN_COMMENTS), total: all.length } : was))
  } catch (cause) {
    await update($, talk, was => (was?.number === number ? { number, comments: [], total: 0 } : was))
    $.ui.log(`issue-board: couldn't read the comments on #${number}: ${messageOf(cause)}`, { to: 'debug' })
  }
}

// Choosing a tab of the pane. A view's tab takes the view's grouping, as GitHub shows it, when the board can group
// that way; the person can pick another after.
const pickTab = async ($: EngineInterface, tab: Tab, project: Project | null): Promise<void> => {
  await update($, filter, () => tab.id)
  const grouping = viewGroupingOf(tab.view, project)
  if (grouping) await update($, groupBy, () => grouping.by)
  // The Inbox seen: the band stops counting what was captured to it.
  if (inboxTabOf([tab], project)) await update($, captured, () => 0)
  if (tab.id === 'inbox') await suggestInbox($)
  else if (tab.id === 'closed') await readRecent($)
}

// What the card's editor offers: the repo's labels and open milestones, when it opens. The board's last read has both,
// the labels unless the repo's project read failed; only then are the labels read from GitHub.
const loadPalette = async($: EngineInterface): Promise<void> => {
  try {
    const now = await read($, board)
    if (!now) return
    const labels = [...(now.labels ?? (await repoLabels($, now.repo)).map(one => one.name))].sort()
    const milestones = (now.milestones ?? []).map(one => one.title)
    await update($, palette, () => ({ labels, milestones }))
  } catch (cause) {
    $.ui.toast(`Couldn't read the repo's labels and milestones: ${messageOf(cause)}`)
  }
}

const flipBox = async ($: EngineInterface, issue: Issue, box: number, done: boolean): Promise<void> => {
  try {
    await tick($, issue.number, [box], done)
    $.ui.toast(`${done ? 'Ticked' : 'Unticked'} box ${box} on #${issue.number}`)
  } catch (cause) {
    toastFailure($, `Couldn't change box ${box} on #${issue.number}`, cause)
  }
}

// Whether the checkout is a plugin marketplace laid out as this repo is: a .claude-plugin/marketplace.json at its root
// that lists each plugin under plugins/. Asked of git, so it costs no GitHub call.
const isMarketplace = async ($: EngineInterface): Promise<boolean> => {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'ls-files', '--', '.claude-plugin/marketplace.json'])
    return exitCode === 0 && stdout.trim() === '.claude-plugin/marketplace.json'
  } catch {
    return false
  }
}

// What one pull request's changed files flag, from one REST call for the first page of them. jq keeps only the diffs
// of the files the version check reads. A read that fails is flagged too, so the person decides without the check.
const flagsOf = async ($: EngineInterface, repo: string, number: number, marketplace: boolean): Promise<string[]> => {
  try {
    const shape = `[.[] | {path: .filename, status, patch: (if (.filename | test("${PATCHED}")) then .patch else null end)}]`
    const files = JSON.parse(await gh($, ['api', `repos/${repo}/pulls/${number}/files?per_page=${FILES_PAGE}`, '--jq', shape])) as ChangedFile[]
    return fileFlags(files, { marketplace })
  } catch (cause) {
    return [`has files the board couldn't read: ${messageOf(cause)}`]
  }
}

// Finish & merge, on a pull request's row or the band. It reads the pull request's files first, and asks before it
// goes when they flag something, a background agent is still on its branch, or its CI hasn't passed. The ask is the
// row's, so from the band the pane opens on it. A pull request with nothing to ask about goes straight to `go`.
const finishPr = async ($: EngineInterface, pr: PullRequest, go: () => unknown, fromBand = false): Promise<void> => {
  const repo = (await read($, board))?.repo
  const risk = closeOutRisk(pr, workerOfPr(pr, await read($, workers)))
  const found = repo ? await flagsOf($, repo, pr.number, await isMarketplace($)) : []
  if (!risk && found.length === 0) {
    await go()
    return
  }
  await update($, armed, (): Armed => ({ kind: 'pr', number: pr.number, found }))
  if (!fromBand) return
  await update($, sections, was => ({ ...was, prs: true }))
  await $.ui.open(OPEN)
  $.ui.toast(`PR #${pr.number} needs a look before it merges`)
}

const closeOutPr = async ($: EngineInterface, pr: PullRequest, found: string[] = []): Promise<void> => {
  await disarm($, 'pr')
  await submit($, 'other prompts', { text: closeOutPrompt(pr, found), asUser: true })
  $.ui.toast(`Sent PR #${pr.number} to Claude to finish and merge`)
}

// Merge all's confirm. It reads every open pull request's files, one call each, while the confirm says it is checking,
// then names each pull request that flagged something, so the one yes covers what the person saw.
const armMergeAll = async ($: EngineInterface, prs: PullRequest[]): Promise<void> => {
  await update($, armed, (): Armed => ({ kind: 'merge-all', flagged: null }))
  const repo = (await read($, board))?.repo
  const marketplace = await isMarketplace($)
  const flagged = await Promise.all(prs.map(async pr => ({ number: pr.number, found: repo ? await flagsOf($, repo, pr.number, marketplace) : [] })))
  // Cancelled, or another confirm armed, while the files were read: that one stays.
  await update($, armed, (was): Armed => (was?.kind === 'merge-all' ? { kind: 'merge-all', flagged } : was))
}

// Merge all merges every open pull request it checked, so it asks once more before it goes.
const closeOutAll = async ($: EngineInterface, prs: PullRequest[], flagged: Flagged[]): Promise<void> => {
  await disarm($, 'merge-all')
  // The pull requests it was asked for may have merged while it waited on its confirm, and one opened since wasn't
  // checked, so it isn't sent.
  const checked = prs.filter(pr => flagged.some(one => one.number === pr.number))
  if (checked.length === 0) {
    $.ui.toast('No pull requests are open now, so there is nothing to merge.')
    return
  }
  await submit($, 'other prompts', { text: closeOutAllPrompt(checked, flagged), asUser: true })
  $.ui.toast(`Sent ${checked.length} ${checked.length === 1 ? 'PR' : 'PRs'} to Claude to finish and merge`)
}

// One card at a time, so its letter keys always work; an opened card is scrolled into view.
const toggleCard = async ($: EngineInterface, number: number, open: number | null, now: Board | null): Promise<void> => {
  const opening = open !== number
  await update($, expanded, () => (opening ? number : null))
  await update($, editing, () => null)
  if (opening) await $.ui.scroll({ to: { key: `card-${number}` }, in: PANE }).catch(() => undefined)
  if (opening) await loadComments($, number)
  const issue = opening ? now?.issues.find(one => one.number === number) : undefined
  if (issue && (now?.project?.fields ?? []).some(field => !/^(status|priority)$/i.test(field.name))) await readValues($, issue)
}

// Change opens the card's editor, and reads the repo's labels and milestones the first time.
const openEditor = async ($: EngineInterface, number: number, changing: number | null, offered: { labels: string[]; milestones: string[] } | null): Promise<void> => {
  const opening = changing !== number
  await update($, editing, () => (opening ? number : null))
  await disarm($, 'close')
  if (opening && !offered) await loadPalette($)
}

// Close in the card's editor. Closing an epic whose sub-issues are still open takes a second press.
const closeFromCard = async ($: EngineInterface, n: number, open: number, armedClose: number | null, reason: 'completed' | 'not planned'): Promise<void> => {
  if (open > 0 && armedClose !== n) {
    await update($, armed, (): Armed => ({ kind: 'close', number: n }))
    return
  }
  await disarm($, 'close')
  await update($, editing, () => null)
  await change($, n, { close: reason })
}

// ---- Tool registration, and what goes with each prompt ----

// The copies of issues and pull requests sent with a prompt in this session, by number, each with what it stood for
// (copyKeyOf). Kept in memory, not in state or the store: a compaction or /clear empties it, as Claude no longer has
// those copies, and a reload starting it over only means a copy goes once more.
const sentCopies = new Map<number, string>()

// How many `#123`s of one prompt the board looks at: past the copies it carries, the rest are named in one line.
const MENTIONS_READ = 20

// The text of each section the board last added to the system prompt, by id. A section is counted as context when it
// first goes in and each time its text changes, not on every request that carries it again.
const composedSections = new Map<string, string>()
const countSection = (id: string, text: string, source: ContextSource): void => {
  if (composedSections.get(id) === text) return
  composedSections.set(id, text)
  countText(source, text)
}

// Sends Claude a prompt of the board's. What reaches Claude counts as context, and as a prompt, since the board's own
// prompt.submit hook doesn't see it.
const submit = async ($: EngineInterface, source: ContextSource, args: Parameters<EngineInterface['prompt']['submit']>[0]) => {
  const sent = await $.prompt.submit(args)
  if (sent.drop === undefined) {
    countText(source, args.text)
    countPrompt(stats)
  }
  return sent
}

// Registers one of the board's tools. Its name, description and schema count as context only once Claude Code puts
// them in front of Claude: see the tool.describe and tool.call hooks.
const registerTool = ($: EngineInterface, tool: Parameters<EngineInterface['tool']['register']>[0]) => {
  defineTool(stats, `mcp__issue-board__${tool.name}`, JSON.stringify(tool).length)
  return $.tool.register(tool)
}

// ---- register ----

export const register: Register = (on, options) => {
  settings = settingsOf(options)
  on('session.start', async ($, e, next) => {
    stats.startedAt = await nowOf($)
    // Before the background agent is registered, as its prompt follows closesWhenTicked.
    settings = withOldKeys(settings, await storedOptions($))
    await $.command.register({
      name: 'issues',
      description: 'Show open issues and pull requests in a pane',
      argumentHint: `[${SUBCOMMANDS.map(one => one.name.replace(' <what>', '')).filter((one, index, all) => all.indexOf(one) === index).join(' | ')}]`,
    })
    for (const { name, description, inputSchema } of TOOL_SPECS) await registerTool($, { name, description, inputSchema })
    // The agent Start in background runs: in its own worktree, in the background. Claude reads its description among the
    // agent types.
    const workerDescription = "Works one GitHub issue of this repository end to end in its own git worktree, for the issue board's Start in background."
    countText('agent type', workerDescription)
    await $.agent
      .register({
        name: 'worker',
        description: workerDescription,
        prompt: workerPrompt(settings.closesWhenTicked),
        isolation: 'worktree',
        background: true,
      })
      .catch((cause: unknown) => $.ui.log(`issue-board: couldn't register the background agent: ${messageOf(cause)}`, { to: 'debug' }))
    // A reload ended the CI watches; agents still working are looked at again.
    await update($, runs, () => [])
    if ((await read($, workers)).some(one => ACTIVE.includes(one.status))) pollWorkers($)
    // Earlier versions pinned the summary to the status line; a reload would leave it there.
    $.ui.status(undefined)
    await restore($)
    void checkAccess($)
    void refresh($)

    return next(e)
  })

  // A /clear (or /new, its alias) or a /resume ends this session and starts another in the same process. As the old
  // one ends, the host empties the board's state, and no session.start follows.
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    restarts += 1
    restarted = true
    sentCopies.clear()
    return next(e)
  })

  // A compaction of the main conversation that stands drops the copies earlier prompts carried, so the next prompt
  // naming one sends it again. A precompute changes nothing yet, and a subagent's own compaction isn't this one.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.skip === undefined) sentCopies.clear()
    return compacted
  }).catch(($, e, next) => fallBack($, e, next, 'session.compact'))

  // The new session's SessionStart hooks run once its state is empty: the board fills it again.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.permission_mode) permissionMode = e.permission_mode
    if (restarted) void begin($)
    return next(e)
  }).catch(($, e, next) => fallBack($, e, next, 'classic.SessionStart'))

  on('command.run', { command: 'issues' }, async ($, e) => {
    const asked = /^new\b\s*(epic\b)?\s*([\s\S]*)$/.exec(e.args.trim())
    if (asked) {
      const epic = asked[1] !== undefined
      void captureFromTalk($, (asked[2] ?? '').trim(), epic)
      return {
        text: epic
          ? 'Capturing an epic and its sub-issues from the conversation to the Inbox. A toast says when they are filed; triage them in the Inbox.'
          : 'Capturing an issue from the conversation to the Inbox. A toast says when it is filed; triage it in the Inbox.',
      }
    }
    if (e.args.trim() === 'setup') {
      await $.ui.open(OPEN)
      void within('setup', () => readSetup($))
      return { text: 'Reading the repo and its project. What setup would change shows at the top of the issues pane, and nothing changes until you press Apply.' }
    }
    if (e.args.trim() === 'statuses') {
      const project = await openStatuses($)
      if (!project) {
        const now = (await read($, board))?.project
        return { text: now ? `${now.title} has no Status field, so there is nothing to map. Add one in the project, or run /issues setup.` : 'The board reads no GitHub Project for this repo, so there are no Status options to map. /issues setup can link or make one.' }
      }
      return { text: `Which Status is which for ${project.title} shows at the top of the issues pane. Save keeps it here, and nothing changes on GitHub.` }
    }
    if (e.args.trim() === 'labels') {
      await openMarkers($)
      const now = await read($, board)
      const later = now?.project ? '' : ', and which label Later does,'
      return { text: `Which label or issue type Bugs goes by${later} shows at the top of the issues pane. Save keeps it here, and nothing changes on GitHub.` }
    }
    if (e.args.trim() === 'stats') return { text: statsText(stats, await nowOf($)) }
    if (e.args.trim() === 'help') {
      const project = (await read($, board))?.project
      const tabs = filtersFor(project)
      return { text: helpText(tabs, featuresOff(switchesOf(settings), project, !project || (await mayWrite($, project))), tabs.some(tab => tab.view)) }
    }
    if (e.args.trim() === 'check') {
      const problems = await checkAccess($)
      const found = await read($, access)
      // What is off, by a setting or for want of a Status option, is said here and in /issues help, not in the band.
      const project = (await read($, board))?.project
      const off = offText(featuresOff(switchesOf(settings), project, !project || (await mayWrite($, project))))
      // A mapping found by common names, until the person answers it, with how to change it.
      const guess = guessOf(project)
      const guessed = project && guess.length > 0 && !(await read($, guessSeen)).includes(guessKey(project, guess))
      const markerAsk = markerAskOf((await read($, board)) ?? null, await read($, chosenMarkers))
      const marked = Object.keys(markerAsk).length > 0 && !(await read($, guessSeen)).includes(markerKey(markerAsk))
      const said = [
        ...(guessed ? [`The board guessed which Status is which. ${guessText(guess)}. Press Looks right in the band to keep it, or run /issues statuses to change it.`] : []),
        ...(marked ? [`The board guessed which labels Bugs and Later go by. ${markerText(markerAsk)}. Press Looks right in the band to keep it, or run /issues labels to change it.`] : []),
      ]
      const withOff = (text: string) => ({ text: [text, ...(said.length > 0 ? ['', ...said] : []), ...(off.length > 0 ? ['', ...off] : [])].join('\n') })
      if (problems.length > 0) {
        const count = problems.length === 1 ? 'one problem' : `${problems.length} problems`
        return withOff(`The issue board found ${count}:\n${problems.map(problem => `- ${problem.title}. ${problem.detail} ${problem.fix}`).join('\n')}`)
      }
      if (!found?.repo) {
        const remote = (await $.session.repo().catch(() => null))?.remote ?? ''
        return {
          text: /github/i.test(remote)
            ? "gh couldn't read this folder's GitHub repository. Check your connection, then run /issues check again."
            : "The issue board couldn't find a GitHub repository for this folder, so it has nothing to show.",
        }
      }
      void refresh($)
      const who = found.login ? `gh is signed in as ${found.login}` : 'gh is signed in'
      return withOff(`The issue board has what it needs. ${who}${found.permission ? `, with ${found.permission.toLowerCase()} access to ${found.repo}` : ''}.`)
    }
    if (e.args.trim() === 'refresh') {
      await refresh($)
      const now = await read($, board)
      return {
        text: now ? `Refreshed: ${summary(now.issues, now.prs, await markersNow($, now)) ?? 'nothing open'}.` : `Couldn't refresh: ${(await read($, error)) ?? 'unknown error'}`,
      }
    }
    // A mistyped subcommand says so, rather than opening the pane as if nothing had been asked.
    const unknown = e.args.trim().split(/\s+/)[0]
    if (unknown) return { text: `Unknown subcommand ${unknown}; /issues help lists them.` }
    await $.ui.open(OPEN)
    if ((await read($, board)) === null) void refresh($)
    // The pane opening at the Inbox is the Inbox seen: the band stops counting captures.
    const project = (await read($, board))?.project
    const inbox = inboxTabOf(filtersFor(project), project)
    if (inbox && tabOf(filtersFor(project), await read($, filter)).id === inbox.id) await update($, captured, () => 0)

    return {
      text: openedText(filtersFor((await read($, board))?.project)),
    }
  })

  // Esc, or the pane's close mark: with an issue's card or a pull request's details open it folds them and keeps the
  // pane; with nothing open the pane closes. The engine stamps both as the person's close, so they step back alike.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    // /issues statuses steps back first: it shows above setup, and saves nothing on the way out.
    if (await read($, statusPicks)) {
      await update($, statusPicks, () => null)
      return { value: undefined }
    }
    if (await read($, markerPicks)) {
      await update($, markerPicks, () => null)
      return { value: undefined }
    }
    // Setup showing steps back first, unless Apply is running: that keeps the pane open until it's done.
    const shown = await read($, setup)
    if (shown) {
      if (shown.phase !== 'applying') await update($, setup, () => null)
      return { value: undefined }
    }
    const folding = (await read($, expanded)) !== null || (await read($, openPr)) !== null
    if (!folding) return next(e)
    await update($, expanded, () => null)
    await update($, editing, () => null)
    await update($, openPr, () => null)
    return { value: undefined }
  }).catch(($, e, next) => fallBack($, e, next, 'ui.close'))

  // A board tool's definition goes into Claude's context when Claude Code first lists it in front, rather than behind
  // ToolSearch, for /issues stats.
  on('tool.describe', async ($, e, next) => {
    const described = await next(e)
    const deferred = described.isDeferred ?? e.isDeferred === true
    if (!deferred) loadTool(stats, e.tool)
    return described
  }).catch(($, e, next) => fallBack($, e, next, 'tool.describe'))

  // A deferred tool's definition loads when ToolSearch finds it. One Claude calls loads too: see asTool.
  on('tool.call', { tool: 'ToolSearch' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) for (const name of matchesOf(ran.result)) loadTool(stats, name)
    return ran
  }).catch(($, e, next) => fallBack($, e, next, 'tool.call on ToolSearch'))

  // Claude changing GitHub through gh or a push: show the change straight away, and a change Claude made through gh to
  // the issue it is on isn't news to it. A checkout moves the branch marker, and to a branch named for an issue, the
  // issue Claude is on, when the main session moves: a subagent's checkout is its own. Any git or gh has the board read
  // GitHub again when the turn ends.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = (e as { command?: unknown }).command
    if (typeof command !== 'string') return ran
    if (/\b(git|gh)\b/.test(command)) touches += 1
    if (writesGitHub(command)) {
      // What Claude's gh changed can't be told apart from others' changes since the board last read GitHub.
      const copy = /\bgh\b/.test(command) ? await copyOf($) : null
      void refreshAfter($).then(() => absorb($, copy))
      // A push starts CI on the branch: the board watches it once it turns up.
      if (/\bgit\s+push\b/.test(command)) void lookForRuns($)
    } else if (GIT_MOVE.test(command) && e.agentId === undefined) void currentBranch($).then(now => followBranch($, now))

    return ran
  }).catch(($, e, next) => fallBack($, e, next, 'tool.call on Bash'))

  // A worktree is a checkout too: Claude Code names its branch after the worktree, such as `worktree-fix+315-glide`.
  // Only the main session's checkouts count: a subagent's, such as a background agent's in its own worktree, make its
  // issue the agent's, not the one Claude is on.
  on('tool.call', { tool: ['EnterWorktree', 'ExitWorktree'] }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) void currentBranch($).then(now => followBranch($, now))
    return ran
  }).catch(($, e, next) => fallBack($, e, next, 'tool.call on a worktree'))

  // Claude completing or deleting a task Start made for a box: a completed one has the band ask whether to tick it.
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const { taskId, status } = e as { taskId?: unknown; status?: unknown }
    const failed = ran.deny !== undefined || ran.isError === true || (ran.result as { success?: unknown } | undefined)?.success === false
    if (failed || typeof taskId !== 'string' || typeof status !== 'string' || !(await read($, tasks)).some(one => one.id === taskId)) return ran
    await update($, tasks, list => (status === 'deleted' ? list.filter(one => one.id !== taskId) : list.map(one => (one.id === taskId ? { ...one, done: status === 'completed' } : one))))
    return ran
  }).catch(($, e, next) => fallBack($, e, next, 'tool.call on TaskUpdate'))

  // A prompt carries, unseen by the person, the board's copy of each issue or pull request it names as `#123`, and a
  // note of what changed on GitHub to the issue Claude is on since the last prompt. The system prompt stays as it is.
  on('prompt.submit', async ($, e, next) => {
    nextStep = null
    // The session started over and no SessionStart hook has run since: the first prompt fills the board again.
    if (restarted) void begin($)
    // Each line the board adds, with where it came from for /issues stats.
    const lines: [ContextSource, string][] = []
    const add = (source: ContextSource, ...texts: string[]) => lines.push(...texts.map((text): [ContextSource, string] => [source, text]))
    let copied: [number, string][] = []
    // The person sends the start message Edit first filled: while it still names the issue, Start's steps run.
    const starting = await draftedStart($, e)
    if (starting?.listed) add('task note', `Each open acceptance box of #${starting.issue.number} is a task in your task list too: mark it completed when it is done.`)
    try {
      // What the board moved on its own since the last prompt.
      if (moved.length > 0 && e.origin.kind !== 'task-notification') {
        add('moved lines', ...moved)
        moved = []
      }
      const now = await read($, board)
      if (now) {
        const note = await newsFor($, now)
        if (note) add('news', note)
        // A background task's notice quotes its command, which may name an issue nobody asked about.
        if (e.origin.kind !== 'task-notification' && settings.issueCopies) {
          const copies = copiesFor(now, mentionsOf(e.text, MENTIONS_READ), sentCopies, Date.now())
          add('issue copies', ...copies.context)
          copied = copies.keys
        }
      }
    } catch (cause) {
      $.ui.log(`issue-board: couldn't add the board to the prompt: ${messageOf(cause)}`, { to: 'debug' })
    }
    const added = lines.map(([, text]) => text)
    const entered = await next(added.length > 0 ? { ...e, context: [...(e.context ?? []), ...added] } : e)
    // A dropped prompt never reached Claude, so its copies count as unsent, and nothing it carried counts as context.
    if (entered.drop === undefined) for (const [number, key] of copied) sentCopies.set(number, key)
    if (entered.drop === undefined) for (const [source, text] of lines) countText(source, text)
    if (entered.drop === undefined) countPrompt(stats)
    if (starting && entered.drop === undefined) {
      $.ui.toast(`Sent #${starting.issue.number} to Claude`)
      await claim($, starting.issue)
    }
    return entered
  }).catch(($, e, next) => fallBack($, e, next, 'prompt.submit'))

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId === undefined) void afterTurn($)
    else void workerEnded($, e.agentId, e.answer, e.reason)
    return ended
  })

  // Claude dispatches the board's agent, from the conversation or Edit first in background: the issue's row follows the
  // agent it started, and the issue is claimed. Start in background spawns the agent itself and follows it from the
  // spawn's result, so its own spawn is left to it here.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (e.subagentType !== WORKER || next.origin.plugin === PLUGIN) return started
    const number = workerIssueOf(e)
    if (started.deny !== undefined) {
      $.ui.toast(`Couldn't start a background agent${number ? ` on #${number}` : ''}: ${started.deny}`)
      return started
    }
    if (number === undefined) return started
    try {
      const agentId = started.agentId ?? (await workerIdOf($, e.description, e.name))
      if (!agentId) throw new Error('no agent id')
      await workerStarted($, number, agentId, startedByClaude(next.origin, e))
      const issue = (await read($, board))?.issues.find(one => one.number === number)
      if (issue) await claim($, issue)
    } catch (cause) {
      $.ui.toast(`Started a background agent on #${number}, but the board couldn't follow it: ${messageOf(cause)}`)
    }
    return started
  }).catch(($, e, next) => fallBack($, e, next, 'agent.spawn'))

  // A GitHub event for a subscribed pull request reaches Claude as it would, and the board reads GitHub at once.
  on('session.receive', async ($, e, next) => {
    const received = await next(e)
    if (e.event?.source === 'github' && e.agentId === undefined) void eventArrived($, e.event.data)
    return received
  }).catch(($, e, next) => fallBack($, e, next, 'session.receive'))

  // Typing `#` in the prompt box offers the board's open issues and pull requests, from the board already in state, so
  // it costs no gh call. The rows go after any that plugins beneath gave. With no board yet, nothing is added.
  on('prompt.autocomplete', { token: /^#/ }, async ($, e, next) => {
    const now = await read($, board)
    if (!now) return next(e)
    const given = await next(e)
    return { suggestions: [...given.suggestions, ...hashRows(now, e.token)] }
  }).catch(($, e, next) => fallBack($, e, next, 'prompt.autocomplete'))

  // The engine's guess at the next prompt gives way to the board's next step for the issue Claude is on.
  on('prompt.suggest', async ($, e, next) => (e.origin.kind === 'suggestion' && nextStep ? next({ ...e, text: nextStep }) : next(e)))

  on('tool.call', { tool: ISSUES_TOOL }, async ($, e) =>
    asTool(e.tool, async () => {
      const input = e as unknown as {
        number?: number
        filter?: BuiltInFilter
        area?: string
        query?: string
        state?: string
        search?: string
        label?: string
        assignee?: string
        milestone?: string
        milestones?: boolean
        status?: string
        since?: string
      }
      if (input.status?.trim()) {
        const now = await read($, board)
        if (!now?.project) return { result: "The board reads no project for this repo, so it can't list issues by Status." }
        return { result: await readProject($, now.project, input.status.trim(), input.since?.trim()) }
      }
      if (input.milestones) {
        const listed = (await read($, board))?.milestones ?? []
        const today = new Date(await nowOf($)).toISOString().slice(0, 10)
        return { result: listed.length > 0 ? listed.map(one => milestoneLine(one, today)).join('\n') : 'The repo has no open milestones.' }
      }
      // Closed issues, and words searched in every issue, are GitHub's search to answer: the board holds open issues only.
      if (input.number === undefined && (input.state === 'closed' || input.state === 'all' || input.search?.trim())) {
        const repo = (await read($, board))?.repo ?? repoInfo?.nameWithOwner
        if (!repo) return { deny: NOT_READ_SENTENCE }
        return { result: await searchIssues($, repo, input) }
      }
      if ((await read($, board)) === null) await refresh($)
      const now = await read($, board)
      if (!now) {
        const failure = (await read($, error)) ?? 'unknown error'
        const problems = await checkAccess($, failure)
        return { deny: `The issue board couldn't read GitHub: ${failure}${problems.length > 0 ? `\n${problemsText(problems)}` : ''}` }
      }

      if (typeof input.number === 'number') {
        const issue = now.issues.find(one => one.number === input.number)
        if (issue) {
          const set = Object.entries(await readValues($, issue)).filter(([name]) => !/^(status|priority)$/i.test(name))
          const fields = set.length > 0 ? `\nFields: ${set.map(([name, value]) => `${name} ${value}`).join(', ')}` : ''
          return { result: `${issueText(issue)}${fields}\n${await latestComments($, now.repo, issue.number, issue.comments)}` }
        }
        const pr = now.prs.find(one => one.number === input.number)
        if (pr) return { result: `${prText(pr)}\nRead it in full with \`gh pr view ${pr.number}\`.` }
        return { result: await readClosed($, now.repo, input.number) }
      }
      const listed = toolListOf(now.issues, input, await read($, viewer), now.project ?? null, await markersNow($, now))
      return { result: boardText(now, listed.issues, listed.label, Date.now()) }
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'issues'))

  on('tool.call', { tool: TICK_TOOL }, async ($, e, next) =>
    asTool(e.tool, async () => {
      const input = e as unknown as { number?: unknown; boxes?: unknown; done?: unknown }
      const { number, boxes } = input
      if (typeof number !== 'number' || !Array.isArray(boxes) || boxes.length === 0 || !boxes.every(box => Number.isInteger(box))) {
        return { deny: 'Give the issue number and the boxes to tick, counted from 1.' }
      }
      return askThenAct(e, next, async () => {
        try {
          const copy = await copyOf($)
          const { text, before } = await tick($, number, boxes as number[], input.done !== false)
          // Only the boxes Claude changed: the body was read fresh, so what others changed meanwhile stays news.
          if ((await read($, working))?.number === number) await absorb($, copy && { ...copy, checks: before })
          return { result: text }
        } catch (cause) {
          return deniedBy($, `Couldn't tick boxes on #${number}`, cause)
        }
      })
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'tick'))

  on('tool.call', { tool: UPDATE_TOOL }, async ($, e, next) =>
    asTool(e.tool, async () => {
      const changes = changesOf(e)
      if (!changes) return { deny: 'Give the issue number, and what to change on it.' }
      // A lock the board doesn't know is refused, not dropped without a word.
      if ((e as { lock?: unknown }).lock !== undefined && changes.lock === undefined) {
        return { deny: 'lock takes true, false, or one of GitHub\'s reasons: off_topic, resolved, spam, too_heated.' }
      }
      const { number, ...asked } = changes
      const starting = (e as { start?: unknown }).start === true
      // A project the board may not write to: a call that only changes the project is refused here, before it asks, with
      // the gate's reason. One that changes the repo too asks, makes the repo's changes, and says which were skipped.
      const refusal = await boardRefusal($)
      const parts = projectPartOf(asked)
      const skipped = refusal ? parts.project : []
      if (skipped.length > 0 && !starting && !repoChangeOf(parts.repo)) return { deny: `Couldn't set #${number}'s ${namesText(skipped)}. ${refusal}` }
      const rest = skipped.length > 0 ? parts.repo : asked
      const skippedText = skipped.length > 0 ? `\nSkipped its ${namesText(skipped)}: ${refusal}` : ''
      return askThenAct(e, next, async () => {
        try {
          const started = starting ? await startHere($, number) : null
          if (started && Object.keys(rest).length === 0) return { result: `${started}${skippedText}` }
          const copy = (await read($, working))?.number === number ? await copyOf($) : null
          const result = await applyChanges($, number, rest)
          // What the tool changed that Claude is told of: a comment, and closing or reopening.
          if (copy) {
            const closed = rest.close ? true : rest.reopen ? false : copy.closed
            await absorb($, copy, { ...copy, comments: copy.comments === null ? null : copy.comments + (rest.comment ? 1 : 0), closed })
          }
          return { result: `${started ? `${started}\n${result}` : result}${skippedText}` }
        } catch (cause) {
          return deniedBy($, `Couldn't change #${number}`, cause)
        }
      })
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'issue_update'))

  // Claude proposing a plan. An invalid plan is refused with every problem, and nothing is shown or asked. A valid one
  // goes on the pane's card at once, then the call asks, once, with the plan summed up; a yes applies its ticked rows.
  // A no leaves it on the card, for the person to apply some of it or discard it. In a mode that settles prompts unseen,
  // it stays on the card and the call asks nothing.
  on('tool.call', { tool: PLAN_TOOL }, async ($, e, next) =>
    asTool(e.tool, async () => {
      const planned = await planFor($, e, true)
      if ('problems' in planned) return { deny: problemsOfPlan(planned.problems) }
      const id = await propose($, planned.changes)
      const mode = unseenMode()
      if (mode) return { deny: planUnseen(mode) }
      return askThenAct(e, next, async () => {
        try {
          return { result: await applyPlan($, id) }
        } catch (cause) {
          return { deny: `Couldn't apply the plan: ${messageOf(cause)}` }
        }
      })
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'project_plan'))

  // A plan's permission prompt says what it would change: its size and its changes by kind. A rule that allows or denies
  // still stands, as does an organization's ceiling; an invalid plan keeps the verdict, as the call refuses it anyway.
  // Where nobody would see the prompt, in auto or bypass mode, it is refused whatever the verdict beneath, rules included.
  on('tool.check', { tool: PLAN_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'deny') return verdict
    const mode = unseenMode()
    if (mode) return { decision: 'deny' as const, reason: planUnseen(mode) }
    if (verdict.decision !== 'ask') return verdict
    const planned = await planFor($, e.input)
    return 'problems' in planned ? verdict : { ...verdict, reason: planAsk(planned.changes.map(one => one.change)) }
  }).catch(($, e, next) => fallBack($, e, next, 'tool.check on project_plan'))

  // Claude filing an issue. Claude Code asks first, as for any tool that changes something.
  on('tool.call', { tool: CREATE_TOOL }, async ($, e, next) =>
    asTool(e.tool, async () => {
      const spec = newIssueOf(e)
      if (typeof spec === 'string') return { deny: spec }
      return askThenAct(e, next, async () => {
        try {
          return { result: await fileIssue($, spec) }
        } catch (cause) {
          return deniedBy($, `Couldn't file the issue`, cause)
        }
      })
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'issue_create'))

  // Claude capturing work found in conversation to the Inbox. It goes through the permission check like the other
  // writes, which the hook below lets through.
  on('tool.call', { tool: CAPTURE_TOOL }, async ($, e, next) =>
    asTool(e.tool, async () => {
      const spec = captureOf(e)
      if (typeof spec === 'string') return { deny: spec }
      return askThenAct(e, next, async () => {
        try {
          return { result: await capture($, spec) }
        } catch (cause) {
          return deniedBy($, `Couldn't capture it`, cause)
        }
      })
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'capture'))

  // A capture is a small write into the Inbox, where the person triages it, so it needs no permission prompt. A rule
  // that denies it still stands, and so does an organization's ceiling that keeps the tool at asking.
  on('tool.check', { tool: CAPTURE_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    return verdict.decision === 'ask' && mayAllow(e.ceiling) ? { decision: 'allow' as const } : verdict
  }).catch(($, e, next) => fallBack($, e, next, 'tool.check on capture'))

  // Claude reading or posting the project's status update. Reading answers at once; posting asks, then acts.
  on('tool.call', { tool: STATUS_TOOL }, async ($, e, next) =>
    asTool(e.tool, async () => {
      const ask = e as unknown as { status?: unknown; note?: unknown; start?: unknown; target?: unknown }
      const project = (await read($, board))?.project
      if (!project) return { deny: 'The board reads no project for this repo.' }
      if (typeof ask.status !== 'string' || !ask.status.trim()) {
        const latest = project.update
        return { result: latest ? `${project.title}: ${updateLine(latest, await nowOf($))}${latest.body.includes('\n') ? `\n${latest.body}` : ''}` : `${project.title} has no status update yet.` }
      }
      const status = ask.status
      // A post is all project, so a project the board may not write to refuses it here, before anything is asked.
      const refusal = await boardRefusal($)
      if (refusal) return { deny: `Couldn't post the status update. ${refusal}` }
      return askThenAct(e, next, async () => {
        try {
          const note = textOf(ask.note)
          const start = textOf(ask.start)
          const target = textOf(ask.target)
          return { result: await postStatus($, project, { status, ...(note ? { note } : {}), ...(start ? { start } : {}), ...(target ? { target } : {}) }) }
        } catch (cause) {
          return { deny: `Couldn't post the status update: ${messageOf(cause)}` }
        }
      })
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'project_status'))

  // Reading the status update changes nothing, so it needs no permission prompt; posting one asks.
  on('tool.check', { tool: STATUS_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    const status = (e.input as { status?: unknown }).status
    return verdict.decision === 'ask' && mayAllow(e.ceiling) && !(typeof status === 'string' && status.trim()) ? { decision: 'allow' as const } : verdict
  }).catch(($, e, next) => fallBack($, e, next, 'tool.check on project_status'))

  // Claude archiving project items: the first call lists them and answers at once; the second, with confirm, asks and
  // then archives them.
  on('tool.call', { tool: ARCHIVE_TOOL }, async ($, e, next) =>
    asTool(e.tool, async () => {
      const ask = e as unknown as { number?: unknown; doneBefore?: unknown; confirm?: unknown }
      const project = (await read($, board))?.project
      if (!project) return { deny: "The board reads no project for this repo, so there's nothing to archive." }
      const confirm = ask.confirm === true
      const archive = async () => {
        try {
          return {
            result: await archiveItems($, project, {
              ...(typeof ask.number === 'number' ? { number: ask.number } : {}),
              ...(typeof ask.doneBefore === 'string' && ask.doneBefore.trim() ? { doneBefore: ask.doneBefore.trim() } : {}),
              confirm,
            }),
          }
        } catch (cause) {
          return { deny: `Couldn't archive: ${messageOf(cause)}` }
        }
      }
      // Archiving is all project, so a project the board may not write to refuses it here, before anything is asked. The
      // list changes nothing and still answers, saying the archive would be refused.
      const refusal = await boardRefusal($)
      if (confirm && refusal) return { deny: `Couldn't archive. ${refusal}` }
      if (!confirm) {
        const listed = await archive()
        return refusal && 'result' in listed ? { result: `${listed.result}\nThe archive itself would be refused: ${refusal}` } : listed
      }
      return askThenAct(e, next, archive)
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'project_archive'))

  // Listing what an archive would take changes nothing, so it needs no permission prompt; the archive itself asks. A rule
  // that denies still stands, as does an organization's ceiling.
  on('tool.check', { tool: ARCHIVE_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    return verdict.decision === 'ask' && mayAllow(e.ceiling) && (e.input as { confirm?: unknown }).confirm !== true ? { decision: 'allow' as const } : verdict
  }).catch(($, e, next) => fallBack($, e, next, 'tool.check on project_archive'))

  // Claude letting the board write to a project, or releasing it, when the person asked. It asks, then acts, so the
  // check below and its prompt run first, and a no changes nothing.
  on('tool.call', { tool: ADOPT_TOOL }, async ($, e, next) =>
    asTool(e.tool, async () => {
      const plan = await adoptPlan($, e)
      if ('refusal' in plan) return { deny: plan.refusal }
      return askThenAct(e, next, async () => {
        try {
          if ('release' in plan) {
            await releaseNow($, plan.release)
            return { result: `Released ${plan.release.title}: the board only reads it now.` }
          }
          await adoptProject($, plan.adopt)
          return { result: `The board may write to ${plan.adopt.title} now. Release it with project_adopt and release: true, or in /issues setup.` }
        } catch (cause) {
          return { deny: `Couldn't save that: ${messageOf(cause)}` }
        }
      })
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'project_adopt'))

  // Adopting or releasing a project always asks the person, whatever their rules allow, with the pane's warning in the
  // prompt: a hook's ask outranks an allow rule. A rule that denies still stands. Where nobody would see the prompt, it
  // is refused instead: in a subagent, in auto mode, where a classifier settles the ask, and in bypass mode, where nothing
  // asks.
  on('tool.check', { tool: ADOPT_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'deny') return verdict
    const ask = 'Ask the person to press Let it write in /issues, or to run /issues setup.'
    if (e.agentId !== undefined) return { decision: 'deny' as const, reason: `Only the person can let the board write to a project, and nobody watches a subagent's permission prompts. ${ask}` }
    const mode = unseenMode()
    if (mode) {
      return { decision: 'deny' as const, reason: `The ${mode} permission mode settles prompts without showing them, and this one needs the person to read it. ${ask} Or switch to a mode that asks, and try again.` }
    }
    const plan = await adoptPlan($, e.input)
    if ('refusal' in plan) return { decision: 'deny' as const, reason: plan.refusal }
    return { decision: 'ask' as const, reason: 'release' in plan ? releaseReason(plan.release) : adoptReason(plan.adopt, settings.refresh) }
  }).catch(($, _e, next) => adoptCheckFailed($, next))

  // The permission mode, which each prompt's classic hook carries, for project_adopt's and project_plan's checks.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.permission_mode) permissionMode = e.permission_mode
    return next(e)
  }).catch(($, e, next) => fallBack($, e, next, 'classic.UserPromptSubmit'))

  // Claude making or changing a milestone. Claude Code asks first, as for any tool that changes something.
  on('tool.call', { tool: MILESTONE_TOOL }, async ($, e, next) =>
    asTool(e.tool, async () => {
      const ask = e as unknown as { title?: unknown; newTitle?: unknown; due?: unknown; description?: unknown; close?: unknown; reopen?: unknown }
      const title = textOf(ask.title)
      if (!title) return { deny: 'Give the milestone a title.' }
      const repo = (await read($, board))?.repo
      if (!repo) return { deny: NOT_READ_SENTENCE }
      return askThenAct(e, next, async () => {
        try {
          const newTitle = textOf(ask.newTitle)
          return {
            result: await saveMilestone($, repo, {
              title,
              ...(newTitle ? { newTitle } : {}),
              ...(typeof ask.due === 'string' ? { due: ask.due.trim() } : {}),
              ...(typeof ask.description === 'string' ? { description: ask.description } : {}),
              ...(ask.close === true ? { close: true } : {}),
              ...(ask.reopen === true ? { reopen: true } : {}),
            }),
          }
        } catch (cause) {
          return { deny: `Couldn't change the milestone: ${messageOf(cause)}` }
        }
      })
    }),
  ).catch(($, _e, next) => toolFailed($, next, 'milestone'))

  // Moving the Status of the issue the person started is part of working on it, so it doesn't ask, and nor does starting
  // on an issue. Any other change
  // asks, as a tool that changes something does; a rule that allows or denies still stands, and so does an
  // organization's ceiling that keeps the tool at asking.
  on('tool.check', { tool: UPDATE_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision !== 'ask' || !mayAllow(e.ceiling)) return verdict
    const changes = changesOf(e.input)
    if (!changes) return verdict
    // Starting on an issue, with nothing else, is what Start does when pressed: it doesn't ask either.
    const { number, ...rest } = changes
    if ((e.input as { start?: unknown }).start === true && Object.keys(rest).length === 0) return { decision: 'allow' as const }
    const doing = await read($, working)
    return doing && number === doing.number && statusOnly(changes) ? { decision: 'allow' as const } : verdict
  }).catch(($, e, next) => fallBack($, e, next, 'tool.check on issue_update'))

  // Ticking boxes is how work on an issue reports its progress, so it needs no permission prompt, as it never has. A rule
  // that denies it still stands, and so does an organization's ceiling that keeps the tool at asking.
  on('tool.check', { tool: TICK_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    return verdict.decision === 'ask' && mayAllow(e.ceiling) ? { decision: 'allow' as const } : verdict
  }).catch(($, e, next) => fallBack($, e, next, 'tool.check on tick'))

  // Reading the board changes nothing, so it needs no permission prompt; a rule that denies it still stands, and so
  // does an organization's ceiling that keeps the tool at asking.
  on('tool.check', { tool: ISSUES_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    return verdict.decision === 'ask' && mayAllow(e.ceiling) ? { decision: 'allow' as const } : verdict
  }).catch(($, e, next) => fallBack($, e, next, 'tool.check on issues'))

  // Closing an epic whose sub-issues are still open asks the person first, whatever their rules allow: the sub-issues
  // would stay open under a closed parent. A subagent's call is refused instead, since nobody may be watching for the
  // prompt, and the reason tells the agent what to do. A rule that denies the command still stands.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    const command = (e.input as { command?: unknown }).command
    if (verdict.decision === 'deny' || typeof command !== 'string' || !CLOSE.test(command)) return verdict
    const issues = (await read($, board))?.issues ?? []
    const epics = [...command.matchAll(new RegExp(CLOSE.source, 'g'))].flatMap(match => {
      const issue = issues.find(one => one.number === Number(match[1]))
      const open = (issue?.subIssues?.total ?? 0) - (issue?.subIssues?.completed ?? 0)
      return issue && open > 0 ? [`#${issue.number} is an epic with ${open} open ${open === 1 ? 'sub-issue' : 'sub-issues'}`] : []
    })
    if (epics.length === 0) return verdict
    const why = `${epics.join('; ')}. Closing it leaves them open under a closed epic.`
    if (e.agentId !== undefined) return { decision: 'deny' as const, reason: `${why} Close or move the sub-issues first, or leave the epic open and say so in your answer.` }
    return { decision: 'ask' as const, reason: why }
  }).catch(($, e, next) => fallBack($, e, next, 'tool.check on Bash'))

  // While Claude works on an issue the person started in this session, the system prompt names it, so compaction
  // doesn't lose it. The section changes only when the person starts another, to keep the prompt cache. In background
  // start mode, a fixed section before it tells Claude to hand issues to workers and see their pull requests through,
  // with the working note on or off.
  // While the capture setting is on, a fixed section first tells Claude to capture work it finds rather than list it.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const capturing = settings.capture ? [{ id: 'issue-board:capture', text: captureSection(), scope: 'session' as const }] : []
    const orchestrating = settings.startMode === 'background' ? [{ id: 'issue-board:orchestrator', text: orchestratorSection(), scope: 'session' as const }] : []
    const now = settings.workingNote ? await read($, working) : null
    const mine = !!now?.sessionId && now.sessionId === (await $.session.id().catch(() => undefined))
    const doing = now && mine ? [{ id: 'issue-board:working', text: workingSection(now), scope: 'session' as const }] : []
    if (capturing.length === 0 && orchestrating.length === 0 && doing.length === 0) return composed
    for (const section of capturing) countSection(section.id, section.text, 'capture note')
    for (const section of orchestrating) countSection(section.id, section.text, 'orchestrator note')
    for (const section of doing) countSection(section.id, section.text, 'working note')

    return { sections: [...composed.sections, ...capturing, ...orchestrating, ...doing] }
  })

  // The text Claude Code has Claude write into a pull request gains a line for the issue this session is on: `Closes #N`
  // once every box is ticked, `Refs #N` before. It is decided as the text is composed, from the boxes as they stand,
  // rather than left to Claude to work out from a rule in the system prompt.
  on('attribution.text', { kind: 'pr' }, async ($, e, next) => {
    const composed = await next(e)
    const keyword = await prKeywordNow($)
    if (!keyword) return composed
    return { text: composed.text.trim() ? `${composed.text.trimEnd()}\n${keyword}` : keyword }
  }).catch(($, e, next) => fallBack($, e, next, 'attribution.text for pr'))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const problems = (await read($, access))?.problems ?? []
    const width = Math.max(40, e.props.bodyColumns)
    const roomy = width >= 72
    // Room for the sparklines and the ticked meter.
    const wide = width >= 100
    const now = await read($, board)
    const failure = await read($, error)
    const busy = await read($, loading)
    const chosen = await read($, filter)
    const open = await read($, expanded)
    const armedNow = await read($, armed)
    const arming = armedNow?.kind === 'merge-all'
    const armedPr = armedNow?.kind === 'pr' ? armedNow.number : null
    const armedFound = armedNow?.kind === 'pr' ? (armedNow.found ?? []) : []
    // What Merge all's check flagged, or null while it reads the files.
    const flagged = armedNow?.kind === 'merge-all' ? (armedNow.flagged ?? null) : null
    const who = await read($, viewer)
    const typed = await read($, query)
    const here = await read($, branch)
    const doing = await read($, working)
    const changing = await read($, editing)
    const offered = await read($, palette)
    const armedClose = armedNow?.kind === 'close' ? armedNow.number : null
    const fields = await read($, typing)
    const said = await read($, talk)
    const shownPr = await read($, openPr)
    const planned = await read($, setup)
    const picked = await read($, groupBy)
    const opened = await read($, unfolded)
    const triaged = await read($, triage)
    const watched = await read($, runs)
    const working$ = await read($, workers)
    const launches = await read($, launching)
    const adopting = await read($, adoption)
    const proposed = await read($, proposal)
    const mapping = await read($, statusPicks)
    const marking = await read($, markerPicks)
    // The issue Start sent Claude in this session: its Start says so rather than starting it again.
    const startedHere = doing?.started && doing.sessionId !== undefined && doing.sessionId === (await $.session.id().catch(() => undefined)) ? doing.number : null
    const clock = Date.now()
    // The mobile app draws no text field: its table hands out one that draws nothing.
    const Input = 'Input' in elements && e.surface !== 'mobile' ? elements.Input : undefined
    const { Box, Text, Button, Link, Markdown } = elements
    const els: PaneElements = { Box, Text, Button, Link, Markdown, Input }

    const start = (issue: Issue) => startFromPane($, issue)
    const toggle = (number: number) => () => toggleCard($, number, open, now)
    const headerHandlers = { refresh: () => refresh($) }

    // The cards above the board, drawn by views/setup.tsx: what the last permission check found missing, the ask before
    // the board writes to the project it reads, `/issues statuses`, `/issues labels` and `/issues setup`. Setup showing
    // asks the same as the adoption ask through Apply, so that waits.
    const accessNote = accessCard(els, { problems }, { copyFix: (problem, surface) => copyFix($, problem, surface), recheck: () => recheck($) })
    const asked = !planned && now?.project ? now.project : null
    const adoptNote = adoptCard(els, { asked, asking: asked ? adoptAsk(asked, adopting) : null }, { adopt: one => adoptFromPrompt($, one), decline: one => declineFromPrompt($, one) })
    const statusesNote = statusesCard(els, { mapping }, { pick: (role, id) => () => void pickStatus($, role, id), save: () => saveStatuses($), cancel: () => update($, statusPicks, () => null) })
    const labelsNote = labelsCard(
      els,
      { marking },
      { pick: picks => () => void update($, markerPicks, was => was && { ...was, picks: { ...was.picks, ...picks } }), save: () => saveMarkerPicks($), cancel: () => update($, markerPicks, () => null) },
    )
    const setupNote = setupCard(els, { planned, autoMove: settings.autoMove }, {
      choose: id => () => void chooseProject($, id),
      typeAreas: text => typeAreas($, text),
      pickRole: (role, name) => () => void pickRole($, role, name),
      release: one => releaseFromSetup($, one),
      askTemplate: repo => submit($, 'other prompts', { text: templatePrompt(repo), asUser: true }).then(() => $.ui.toast('Asked Claude for an issue template, as a pull request to review')),
      apply: () => within('setup', () => applySetup($)),
      close: () => update($, setup, () => null),
    })

    // Before there is a board: the header with the repo and the sync, the cards, and why there is no board yet.
    if (!now) {
      return (
        <Box flexDirection="column">
          {headerView(els, { repo: null, busy, fetchedAt: null, clock, totals: null }, headerHandlers)}
          {statusesNote}
          {labelsNote}
          {setupNote}
          {accessNote || noBoard(els, { failure })}
        </Box>
      )
    }

    const marks = await markersNow($, now)
    const { project, tabs, tab, kept, shown, triaging, grouping, groupings, tabLabel, groups, unknownTerms } = listOf({ now, chosen, picked, typed, who, open, marks, clock })
    const shownTab = tab.id
    const closedNow = shownTab === 'closed' ? await read($, recent) : null
    const fieldValues = await read($, values)
    const more = await read($, editorMore)
    // The sections above the issues: open or folded as the person left them, else folded on a short pane.
    const opened$ = await read($, sections)
    const sectionOpen = (key: string) => opened$[key] ?? e.props.scroll.bodyRows >= SHORT_ROWS
    const fold = (key: string) => () => void update($, sections, was => ({ ...was, [key]: !sectionOpen(key) })).then(() => save($))
    // One card open: its letter keys work.
    const single = open !== null && shown.some(issue => issue.number === open)
    // Merge all's confirm, while there is still something to merge.
    const confirm = arming && now.prs.length > 0

    // With a board, its totals too. A board kept from before velocity was fetched has none until it refreshes.
    const totals = { issues: now.issues.length, bugs: now.issues.filter(issue => isBug(issue, marks)).length, prs: now.prs.length, failing: now.prs.filter(pr => pr.ci === 'fail').length, overall: sumProgress(shown), wide }
    const trends = trendsView(els, { wide, velocity: now.velocity ?? { closed: [], merged: [] } })

    // The Issues heading, drawn by views/tabs.tsx.
    const issuesHeading = issuesHeadingView(
      els,
      { tabs: tabs.map(one => ({ tab: one, label: tabLabel(one) })), shown: shownTab, typed, groupings, grouping },
      { pickTab: one => pickTab($, one, project), search: text => update($, query, () => text), group: id => update($, groupBy, () => id) },
    )

    // A card above a row too near the pane's top would be pushed down over the row, so each row knows the lines free
    // above it in the window, as roomAbove counts them.
    const roomOf = roomAbove({
      now, width, tabs: tabs.map(tabLabel), groupings: groupings.map(one => one.label), trends: Boolean(trends), failure, sectionOpen, arming, armingLines: flaggedLines(flagged ?? []).length, runs: watched.length,
      unknownTerms: unknownTerms.length, triaging, triageFailed: Boolean(triaged.failed), shown, groups, opened, offset: e.props.scroll.offset,
    })

    // The rows and the open card, drawn by views/pr-row.tsx, views/issue-row.tsx and views/card.tsx with these handlers.
    const prHandlers: PrRowHandlers = {
      toggle: number => () => void update($, openPr, was => (was === number ? null : number)),
      finish: pr => finishPr($, pr, () => closeOutPr($, pr)),
      closeOut: pr => void closeOutPr($, pr, armedPr === pr.number ? armedFound : []),
      cancel: () => void disarm($, 'pr'),
    }
    const prRow = (pr: PullRequest) => prRowView(els, { pr, width, roomy, repo: now.repo, here, shownPr, armedPr, armedFound, workers: working$, clock }, prHandlers)
    const issueHandlers: IssueRowHandlers = { toggle, stop: () => void stopTracking($) }
    const issueRow = (issue: Issue) =>
      issueRowView(els, { issue, width, roomy, open, marks, project, prs: now.prs, workers: working$, doing, clock, room: roomOf(issue.number) }, issueHandlers)
    const cardData: CardData = {
      issues: now.issues, repo: now.repo, project, marks, width, clock, kept, filterName: tab.name, typed, workers: working$, launches, startedHere,
      inBackground: settings.startMode === 'background', changing, who, offered, issueTypes: now.issueTypes ?? [], fields, more, fieldValues, armedClose, talk: said,
      // The project's fields beyond Status and Priority.
      otherFields: (project?.fields ?? []).filter(field => !/^(status|priority)$/i.test(field.name)),
    }
    const cardHandlers: CardHandlers = {
      toggle,
      start,
      pick: (issue, field, name) => pick($, issue, field, name),
      flip: (issue, box, done) => flipBox($, issue, box, done),
      background: issue => startInBackground($, issue),
      draft: (issue, background) => draftStart($, issue, background),
      noReady: number => $.ui.toast(noReadyText(number)),
      openEditor: number => () => openEditor($, number, changing, offered),
      type: (key, text) => update($, typing, was => ({ ...was, [key]: text })),
      submit: (number, key, edit) => update($, typing, was => ({ ...was, [key]: '' })).then(() => change($, number, edit)),
      change: (number, edit) => change($, number, edit),
      fillBody: number => $.prompt.fill({ text: `Edit the body of #${number}: ` }),
      close: (number, left, reason) => closeFromCard($, number, left, armedClose, reason),
      duplicate: (number, of) => update($, typing, was => ({ ...was, duplicate: '' })).then(() => update($, editing, () => null)).then(() => change($, number, { duplicateOf: of })),
      toggleMore: () => update($, editorMore, was => !was),
      reply: (number, text) => update($, typing, was => ({ ...was, comment: '' })).then(() => change($, number, { comment: text })).then(() => loadComments($, number)),
      ask: (issue, last) => submit($, 'other prompts', { text: answerPrompt(issue, last), asUser: true }).then(() => $.ui.toast(`Asked Claude to answer @${last.author} on #${issue.number}`)),
    }
    const issueCard = (issue: Issue, hotkeys: boolean) => issueCardView(els, { ...cardData, issue, hotkeys }, cardHandlers)
    const prsHandlers = { fold, closeOutAll: (prs: PullRequest[]) => closeOutAll($, prs, flagged ?? []), arm: (to: boolean) => () => (to ? armMergeAll($, now.prs) : disarm($, 'merge-all')) }
    const rows = { issueRow, issueCard }
    const planHandlers: PlanHandlers = {
      pickRow: id => () => void update($, proposal, was => was && { ...was, rows: was.rows.map(row => (row.id === id ? { ...row, picked: !row.picked } : row)) }),
      apply: id => applyFromCard($, id),
      discard: () => update($, proposal, () => null),
    }
    const triageHandlers: TriageHandlers = {
      ...rows,
      toggle,
      accept: (issue, choice, status) => acceptTriage($, issue, choice, status),
      again: () => suggestAgain($),
      choose: (number, edit) => () =>
        void update($, triage, was => ({ ...was, picks: [...was.picks.filter(one => one.number !== number), { ...was.picks.find(one => one.number === number), number, ...edit }] })),
    }
    const groupHandlers: GroupsHandlers = {
      ...rows,
      start,
      foldGroup: key => () => void update($, unfolded, list => (list.includes(key) ? list.filter(one => one !== key) : [...list, key])),
    }

    return (
      <Box flexDirection="column">
        {headerView(els, { repo: now.repo, busy, fetchedAt: now.fetchedAt, clock, totals, iteration: currentIterationText(project, clock) }, headerHandlers)}
        {projectUpdate(els, { update: project?.update, clock })}
        {planCard(els, { proposed, now }, planHandlers)}
        {statusesNote}
        {labelsNote}
        {setupNote}
        {trends}
        {accessNote}
        {adoptNote}
        {failure && <Text color="error">{`✗ Last refresh failed: ${failure}`}</Text>}

        {prsHeading(els, { prs: now.prs, open: sectionOpen('prs'), arming }, prsHandlers)}
        {confirm && mergeConfirm(els, { prs: now.prs, flagged }, prsHandlers)}
        {sectionOpen('prs') && now.prs.map(prRow)}
        {watched.map(run => runRow(els, { run, width }))}

        {milestonesView(els, { milestones: now.milestones ?? [], open: sectionOpen('milestones'), width, clock }, { fold })}

        {issuesHeading}

        {viewNote(els, { unknownTerms, view: tab.view, project })}

        {shownTab === 'closed' && closedList(els, { closedNow, width, clock })}
        {shownTab !== 'closed' && shown.length === 0 && emptyNote(els, { filterName: tab.name, typed })}
        {triaging && triageNote(els, { triaged, any: shown.length > 0 }, triageHandlers)}
        {triaging && triageFailed(els, { triaged })}
        {triaging && triageEntries(els, { issues: shown, all: now.issues, triaged, project, width, clock, open, single }, triageHandlers)}
        {groupList(els, { groups, opened, issues: now.issues, project, marks, width, open, single }, groupHandlers)}

        {hint(els, { confirm, single, tabs, prs: now.prs.length, width })}
      </Box>
    )
  })

  // The board in a line, dim at the end of the hint under the prompt; nothing when nothing is open. While the check
  // finds something missing, it says so: always when the board can't read GitHub, otherwise until waved off in the band.
  // The engine puts its own ` · ` between the hint and the tail, so the tail doesn't start with one.
  // Not `$.ui.status`: the status line draws as a warning, and an open issue isn't one.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const now = await read($, board)
    const gone = await read($, dismissed)
    const loud = ((await read($, access))?.problems ?? []).filter(problem => problem.blocks || !gone.includes(accessKey(problem)))
    const note = loud.length > 0 ? `issue board ${loud.some(problem => problem.blocks) ? 'needs setup' : 'is limited'} (/issues check)` : undefined
    const text = [now && summary(now.issues, now.prs, await markersNow($, now), await footerBranch($)), note].filter(Boolean).join(' · ')
    if (!text) return next(e)

    return next({ ...e, props: { ...e.props, tail: e.props.tail ? `${e.props.tail} · ${text}` : text } })
  })

  // The band above the prompt is for what needs the person now (something to fix, merge, tick or look at). It shows
  // nothing otherwise. The main session's progress (the issue Claude is on, CI running) is the pane's, and Claude Code
  // lists running background agents itself, so the band repeats neither. Every line is one row at any width.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Turned off, the band draws nothing of the board's; the pane still shows what needs the person.
    if (e.props.hasSurvey || !settings.band) return next(e)
    const now = await read($, board)
    const gone = await read($, dismissed)
    const problems = ((await read($, access))?.problems ?? []).filter(problem => !gone.includes(accessKey(problem)))
    const doing = await read($, working)
    const alerts = now ? alertsOf(now, doing, gone, await read($, greened)) : []
    // Tasks Claude completed whose boxes are still open: the band asks whether to tick them.
    const offers = (now ? await read($, tasks) : []).flatMap(task => {
      const issue = task.done ? now?.issues.find(one => one.number === task.number) : undefined
      const at = issue && boxOf(issue, task)
      return at && !at.done ? [{ task, box: at.box }] : []
    })
    // What the board noticed about epics: why one moved to Verification, or a sub-issue open again under one. A line
    // past its age limit goes here too, since a quiet board may not read again for a while.
    const notes = now ? liveEpicNotes(await read($, epicNotes), now, await nowOf($)) : []
    // The project the board reads but may not write to yet: the band points at the pane, which has the whole warning.
    const unadopted = now?.project && adoptAsk(now.project, await read($, adoption)) ? now.project : null
    // Which Status is which, when the board found it by common names and the person hasn't answered: once per guess.
    const guess = guessOf(now?.project)
    const guessed = now?.project && guess.length > 0 && !(await read($, guessSeen)).includes(guessKey(now.project, guess)) ? now.project : null
    // A plan Claude proposed that waits on the person: the band points at the pane, where its card is.
    // Only the rows the board doesn't show as made already count.
    const waiting = await read($, proposal)
    const waitingRows = waiting && now ? rowsToMake(waiting.rows, now) : (waiting?.rows ?? [])
    const planned = waiting && waitingRows.length > 0 && !waiting.applying ? { ...waiting, rows: waitingRows } : null
    // Which labels Bugs and Later go by, when the board found them by the repo's names and the person hasn't answered.
    const markerAsk = markerAskOf(now, await read($, chosenMarkers))
    const marked = Object.keys(markerAsk).length > 0 && !(await read($, guessSeen)).includes(markerKey(markerAsk))
    // Issues captured to the Inbox since the person last opened it.
    const caught = await read($, captured)
    if (problems.length === 0 && alerts.length === 0 && offers.length === 0 && notes.length === 0 && !unadopted && !guessed && !marked && !planned && caught === 0)
      return next(e)

    // The lines, drawn by views/band.tsx with these handlers.
    const handlers: BandHandlers = {
      dismiss: async alert => {
        await update($, dismissed, list => [...list.slice(-50), alert.key])
        if (alert.kind === 'closed') await update($, working, () => null)
        await save($)
      },
      // A button that hands Claude a pull request: into the prompt box while Claude is busy, sent otherwise.
      hand: text => (e.props.isWorking ? $.prompt.fill({ text }) : submit($, 'other prompts', { text, asUser: true })),
      // Finish & merge on a pull request whose CI passed: its files checked first, as on the pane's row.
      finish: pr => {
        const text = closeOutPrompt(pr)
        return finishPr($, pr, () => (e.props.isWorking ? $.prompt.fill({ text }) : submit($, 'other prompts', { text, asUser: true })), true)
      },
      tickTask: task => tickTask($, task),
      skipTask: task => update($, tasks, list => list.filter(one => one.id !== task.id)),
      dismissNote: note => update($, epicNotes, list => list.filter(one => one.key !== note.key)),
      copyFix: (problem, surface) => copyFix($, problem, surface),
      recheck: () => recheck($),
      dismissProblem: problem => dismissProblem($, problem),
      review: () => $.ui.open(OPEN),
      decline: project => declineFromPrompt($, project),
      confirmGuess: project => confirmGuess($, project),
      openStatuses: () => openStatuses($),
      confirmMarkers: () => confirmMarkers($, markerAsk),
      openMarkers: () => openMarkers($),
      seeGuess: seen => seeGuess($, seen),
      openInbox: () => openInbox($),
      clearCaptured: () => update($, captured, () => 0),
    }
    return bandView(
      $.ui.resolve(e),
      {
        width: e.props.bodyColumns,
        clock: Date.now(),
        repo: now?.repo ?? '',
        project: now?.project ?? null,
        refresh: settings.refresh,
        problems,
        unadopted,
        planned,
        guessed,
        guess,
        marked,
        markerAsk,
        alerts,
        offers,
        caught,
        notes,
      },
      handlers,
    )
  })
}
