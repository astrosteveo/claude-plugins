import { atom, read, update } from 'claude-code'
import type { Caught, EngineInterface, HookFailure, ModelForkResult, Register, ThemeKey, Timer, UiCopyArgs } from 'claude-code'

import type { Alert, Board, BoxTask, Check, Comment, Draft, DraftEdit, Filter, GroupBy, Issue, Known, Launch, Problem, Project, ProjectField, PullRequest, RunWatch, SavedSetup, Setup, SetupProject, SetupStep, Worker, Working } from '../types'
import type { Ended, IssueChanges, NewIssue } from './parse'
import { authOf, problemsOf, problemsText, repoOf } from './access'
import { ADD_ITEM, CLEAR_VALUE, ITEM_VALUES, SET_FIELD, SET_VALUE, issuesQuery, optionOf, startedOf } from './project'
import {
  CREATE_FIELD,
  CREATE_PROJECT,
  FACTS_QUERY,
  ITEMS_QUERY,
  PRIORITIES,
  PROJECT_QUERY,
  UPDATE_FIELD,
  areasOf,
  addsAsTodo,
  automationsOff,
  factsOf,
  mergeStatuses,
  nextItemsOf,
  projectOf,
  rolesOf,
  stepsOf,
  suggestAreas,
  templatePrompt,
} from './setup'
import {
  THREADS_QUERY,
  WEEKS,
  WORKER,
  WORKER_PROMPT,
  absorbed,
  ago,
  alertsOf,
  answerPrompt,
  areaOf,
  backgroundPrompt,
  bar,
  boardText,
  boxOf,
  cells,
  changesText,
  checksOf,
  chipsOf,
  ciBadge,
  closeOutAllPrompt,
  closeOutPrompt,
  commentsOf,
  commandsOf,
  draftBody,
  draftLines,
  draftPrompt,
  endedLine,
  eventRepoOf,
  fit,
  fixPrompt,
  greenKey,
  groupsOf,
  handoffPrompt,
  hex,
  isBug,
  isInbox,
  issueOfBranch,
  knownOf,
  mentionText,
  mentionsOf,
  newsOf,
  nextOf,
  nextStepOf,
  issueText,
  labelsOf,
  liveRunsOf,
  nextPageOf,
  pad,
  pageOf,
  peekPlace,
  proseOf,
  matches,
  mergeNoteOf,
  named,
  parseDraft,
  parseGraph,
  parseIssues,
  parsePrs,
  parseTriage,
  prText,
  prsFor,
  progress,
  reviewBadge,
  runProgressOf,
  searched,
  since,
  spark,
  startPrompt,
  startedByClaude,
  statusFor,
  statusOnly,
  rowRoom,
  sumProgress,
  summary,
  threadsOf,
  tickBody,
  timesOf,
  tone,
  triagePrompt,
  weekly,
  wentGreen,
  wrappedLines,
  workerBadge,
  workerIssueOf,
  workerPrOf,
  workingSection,
  writesGitHub,
  filedText,
  newIssueOf,
  numbersOf,
  leftForDone,
  addBoxes,
  rewordBoxes,
  foundLine,
  foundOf,
  searchTerms,
  standing,
  TOOL_COMMENTS,
  commentsText,
  restCommentsOf,
  labelColorFor,
  missingLabels,
  leftForVerification,
  milestoneLine,
  milestonesOf,
  itemsAt,
  projectPathOf,
  fieldValueOf,
  itemValuesOf,
} from './parse'

const PANE = 'issue-board'
const REFRESH_MS = 5 * 60 * 1000
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
const MILESTONE_TOOL = 'mcp__issue-board__milestone'

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map(one => one.trim()) : undefined

// The issue_update tool's input as a change; null without an issue number. A parent of 0 and an empty milestone remove
// them, as the tool says.
const changesOf = (input: unknown): (IssueChanges & { number: number }) | null => {
  const raw = (input ?? {}) as Record<string, unknown>
  if (typeof raw.number !== 'number' || !Number.isInteger(raw.number) || raw.number < 1) return null
  const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
  const changes: IssueChanges & { number: number } = { number: raw.number }
  const status = text(raw.status)
  const priority = text(raw.priority)
  if (status) changes.status = status
  if (priority) changes.priority = priority
  for (const key of ['addLabels', 'removeLabels', 'assign', 'unassign'] as const) {
    const list = strings(raw[key])
    if (list?.length) changes[key] = list
  }
  if (typeof raw.parent === 'number') changes.parent = raw.parent > 0 ? raw.parent : null
  if (typeof raw.milestone === 'string') changes.milestone = raw.milestone.trim() || null
  const comment = text(raw.comment)
  if (comment) changes.comment = comment
  if (raw.close === 'completed' || raw.close === 'not planned') changes.close = raw.close
  if (raw.reopen === true) changes.reopen = true
  const title = text(raw.title)
  if (title) changes.title = title
  if (typeof raw.body === 'string') changes.body = raw.body
  const boxes = strings(raw.addBoxes)
  if (boxes?.length) changes.addBoxes = boxes
  const rewords = Array.isArray(raw.rewordBoxes)
    ? raw.rewordBoxes.flatMap(one => {
        const edit = one as { box?: unknown; text?: unknown }
        return typeof edit.box === 'number' && Number.isInteger(edit.box) && typeof edit.text === 'string' && edit.text.trim() ? [{ box: edit.box, text: edit.text.trim() }] : []
      })
    : []
  if (rewords.length > 0) changes.rewordBoxes = rewords
  if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) {
    const given = Object.entries(raw.fields as Record<string, unknown>).flatMap(([name, value]) =>
      name.trim() && (value === null || typeof value === 'string' || typeof value === 'number') ? [[name.trim(), value as string | number | null]] : [],
    )
    if (given.length > 0) changes.fields = Object.fromEntries(given)
  }
  if (raw.type === null) changes.type = null
  else if (text(raw.type)) changes.type = text(raw.type)
  if (typeof raw.duplicateOf === 'number' && Number.isInteger(raw.duplicateOf) && raw.duplicateOf > 0 && raw.duplicateOf !== raw.number) changes.duplicateOf = raw.duplicateOf
  const blocking = numbersOf(raw.addBlockedBy)
  const unblocking = numbersOf(raw.removeBlockedBy)
  if (blocking.length > 0) changes.addBlockedBy = blocking
  if (unblocking.length > 0) changes.removeBlockedBy = unblocking
  return changes
}

const board = atom({ plugin: 'issue-board', key: 'board' } as const, null)
const error = atom({ plugin: 'issue-board', key: 'error' } as const, null)
const loading = atom({ plugin: 'issue-board', key: 'loading' } as const, false)
const filter = atom({ plugin: 'issue-board', key: 'filter' } as const, 'active')
const expanded = atom({ plugin: 'issue-board', key: 'expanded' } as const, [])
const working = atom({ plugin: 'issue-board', key: 'working' } as const, null)
const dismissed = atom({ plugin: 'issue-board', key: 'dismissed' } as const, [])
const confirming = atom({ plugin: 'issue-board', key: 'confirming' } as const, false)
const query = atom({ plugin: 'issue-board', key: 'query' } as const, '')
const viewer = atom({ plugin: 'issue-board', key: 'viewer' } as const, null)
const branch = atom({ plugin: 'issue-board', key: 'branch' } as const, null)
const greened = atom({ plugin: 'issue-board', key: 'greened' } as const, [])
const draft = atom({ plugin: 'issue-board', key: 'draft' } as const, null)
const drafting = atom({ plugin: 'issue-board', key: 'drafting' } as const, false)
const revising = atom({ plugin: 'issue-board', key: 'revising' } as const, null)
const ring = atom({ plugin: 'issue-board', key: 'ring' } as const, null)
const creating = atom({ plugin: 'issue-board', key: 'creating' } as const, false)
const editing = atom({ plugin: 'issue-board', key: 'editing' } as const, null)
const palette = atom({ plugin: 'issue-board', key: 'palette' } as const, null)
const closing = atom({ plugin: 'issue-board', key: 'closing' } as const, null)
const typing = atom({ plugin: 'issue-board', key: 'typing' } as const, { comment: '', parent: '', title: '', box: '', label: '', duplicate: '' })
const recent = atom({ plugin: 'issue-board', key: 'recent' } as const, null)
const values = atom({ plugin: 'issue-board', key: 'values' } as const, {})
const typedFields = atom({ plugin: 'issue-board', key: 'typedFields' } as const, {})
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

// Whether a tool's calls may be allowed without asking: an organization can set a ceiling, the most permissive verdict
// a call of the tool may reach. None set, they may.
const mayAllow = (ceiling: 'allow' | 'ask' | 'deny' | undefined): boolean => ceiling === undefined || ceiling === 'allow'

// The filters; with a project, the first two read Priority and say so.
const FILTERS: { id: Filter; label: string; planned: string; hotkey: string }[] = [
  { id: 'active', label: 'Active', planned: 'Now', hotkey: '1' },
  { id: 'future', label: 'Future', planned: 'Later', hotkey: '2' },
  { id: 'bugs', label: 'Bugs', planned: 'Bugs', hotkey: '3' },
  { id: 'mine', label: 'Mine', planned: 'Mine', hotkey: '4' },
  { id: 'all', label: 'All', planned: 'All', hotkey: '5' },
  { id: 'inbox', label: 'Inbox', planned: 'Inbox', hotkey: '6' },
  { id: 'closed', label: 'Closed', planned: 'Closed', hotkey: '7' },
]

const GROUPINGS: { id: GroupBy; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'epic', label: 'Epic' },
  { id: 'area', label: 'Area' },
]

const gh = async ($: EngineInterface, args: string[], stdin?: string, timeoutMs = 60_000): Promise<string> => {
  const { exitCode, stdout, stderr } = await $.process.run(['gh', ...args], { timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
  if (exitCode !== 0) throw new Error(stderr.trim().split('\n')[0] || `gh ${args[0]} exited ${exitCode}`)
  return stdout
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

// How a command that couldn't start says so, as against one that ran too long.
const MISSING = /ENOENT|not found|no such file/i
// A gh error that may come from a missing permission rather than from the request itself.
const ACCESS_ERROR = /scope|credentials|not accessible|gh auth login|HTTP 40[13]|permission/i

// Asks gh who it is signed in as and what it may do in this repository, and keeps what is missing. `message` is an
// error gh just gave, which may name a permission the token lacks. One at a time, so a check asked for during another
// runs after it with its own message.
let checking: Promise<unknown> = Promise.resolve()
const checkAccess = ($: EngineInterface, message?: string): Promise<Problem[]> => {
  const run = checking.then(async () => {
    let installed = true
    const ask = (args: string[]) =>
      $.process.run(['gh', ...args], { timeoutMs: 30_000 }).catch((cause: unknown) => {
        if (MISSING.test(messageOf(cause))) installed = false
        return null
      })
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
    const login = auth?.state === 'signed-in' && auth.login ? auth.login : null
    await update($, access, () => ({ login, repo: repo?.name ?? null, permission: repo?.permission ?? null, problems, checkedAt: Date.now() }))
    if (login && (await read($, viewer)) === null) await update($, viewer, () => login)
    return problems
  })
  checking = run.catch(() => undefined)
  return run
}

// How the dismissed list names a problem waved off from the band.
const accessKey = (problem: Problem): string => `access-${problem.id}`

// The branch the session's folder has checked out; null on a detached head or outside git.
const currentBranch = async ($: EngineInterface): Promise<string | null> => {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'branch', '--show-current'])
    return exitCode === 0 ? stdout.trim() || null : null
  } catch {
    return null
  }
}

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
  const number = name === was ? null : issueOfBranch(name)
  const issue = number === null ? undefined : (await read($, board))?.issues.find(one => one.number === number)
  if (!issue) return
  const doing = await read($, working)
  if (doing?.number === issue.number && doing.sessionId !== undefined && doing.sessionId === (await $.session.id().catch(() => undefined))) return
  await track($, issue)
  $.ui.toast(`Working on #${issue.number} now: the branch ${name} is for it`)
}

// The next look at GitHub: soon while a pull request's CI runs, every five minutes otherwise, and once the rate limit
// resets after it ran out. Each look sets the next one.
let timer: Timer | undefined
const schedule = async ($: EngineInterface, now: Board | null): Promise<void> => {
  timer?.cancel()
  const watching = now?.prs.some(pr => pr.ci === 'pending') ?? false
  const clock = await nowOf($)
  const wait = pausedUntil > clock ? pausedUntil - clock + 5_000 : watching ? WATCH_MS : REFRESH_MS
  timer = $.clock.after(wait, () => void poll($))
}

// Until when GitHub's rate limit has run out for the account, if it has. Every session and agent shares the limit, so
// the board reads nothing until then rather than spend what is left.
let pausedUntil = 0
const RATE_LIMITED = /rate limit/i

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
  try {
    const { stdout } = await $.process.run(['gh', 'api', '-i', ...(known ? ['-H', `If-None-Match: ${known}`] : []), path], { timeoutMs: 30_000 })
    const status = /^HTTP\/[\d.]+ (\d{3})/m.exec(stdout)?.[1]
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
const poll = async ($: EngineInterface): Promise<void> => {
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
    const answer = JSON.parse(await gh($, ['api', 'graphql', '-f', 'query={ rateLimit { resetAt } }'])) as { data?: { rateLimit?: { resetAt?: string } } }
    const at = Date.parse(answer.data?.rateLimit?.resetAt ?? '')
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

// What the board keeps between sessions, one entry per repository; `setup` is what `/issues setup` last saved.
type Saved = { board: Board | null; working: Working | null; dismissed: string[]; viewer: string | null; setup?: SavedSetup }

let storeKey: string | undefined
const keyOf = async ($: EngineInterface): Promise<string> => {
  if (storeKey === undefined) {
    const repo = await $.session.repo().catch(() => null)
    storeKey = `repo:${repo?.root ?? (await $.session.root())}`
  }
  return storeKey
}

// What `/issues setup` saved for this repo, if it has run here.
const savedSetup = async ($: EngineInterface): Promise<SavedSetup | undefined> => {
  try {
    return ((await $.store.get(await keyOf($))) as Partial<Saved> | undefined)?.setup
  } catch {
    return undefined
  }
}

const save = async ($: EngineInterface): Promise<void> => {
  try {
    // Without the issues' bodies, which the next refresh brings back, to keep the store small.
    const now = await read($, board)
    const kept = now && { ...now, issues: now.issues.map(issue => ({ ...issue, body: '' })) }
    const before = await savedSetup($)
    const saved: Saved = { board: kept, working: await read($, working), dismissed: await read($, dismissed), viewer: await read($, viewer), ...(before ? { setup: before } : {}) }
    await $.store.set(await keyOf($), saved)
  } catch (cause) {
    $.ui.log(`issue-board: couldn't save the board: ${messageOf(cause)}`, { to: 'debug' })
  }
}

// A new session paints the last board at once and still knows the issue Claude was on; a reload keeps its own. What a
// refresh wrote meanwhile stays: it is newer than the saved copy.
const restore = async ($: EngineInterface): Promise<void> => {
  if ((await read($, board)) !== null) return
  try {
    const saved = (await $.store.get(await keyOf($))) as Partial<Saved> | undefined
    if (!saved) return
    if (saved.board) await update($, board, now => now ?? saved.board ?? null)
    if (saved.working) await update($, working, now => now ?? saved.working ?? null)
    if (saved.dismissed) await update($, dismissed, now => (now.length > 0 ? now : (saved.dismissed ?? [])))
    if (saved.viewer) await update($, viewer, now => now ?? saved.viewer ?? null)
  } catch (cause) {
    $.ui.log(`issue-board: couldn't read the saved board: ${messageOf(cause)}`, { to: 'debug' })
  }
}

// GitHub refusing to show projects for want of a permission, which reading issues without them answers.
const PROJECT_REFUSED = /read:project|\bproject\b.*\bscope|projectsV2|projectItems/i
const PAGES = 3

// The error GitHub last gave for projects. Until Check again clears it, the board reads issues without projects rather
// than be refused each time, and the permission check keeps saying how to fix it.
let projectRefusal: string | undefined

// The open issues over GraphQL, up to 300, with the repo's project when gh may read it.
const fetchIssues = async ($: EngineInterface, nameWithOwner: string): Promise<{ issues: Issue[]; project: Project | null; types: string[] }> => {
  const [owner = '', name = ''] = nameWithOwner.split('/')
  const saved = await savedSetup($)
  const preferred = saved?.project.id
  const pull = async (withProject: boolean) => {
    const pages: string[] = []
    let after: string | null = null
    do {
      const page: string = await gh($, ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, ...(after ? ['-f', `after=${after}`] : []), '-f', `query=${issuesQuery(withProject)}`])
      pages.push(page)
      after = nextPageOf(page)
    } while (after && pages.length < PAGES)
    const limits = pages.map(costOf).filter(limit => limit !== null)
    const last = limits.at(-1)
    if (last) {
      const cost = limits.reduce((sum, limit) => sum + limit.cost, 0)
      $.ui.log(`issue-board: the issues query cost ${cost} GraphQL points over ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}; ${last.remaining} left until ${last.resetAt}`, { to: 'debug' })
    }
    return parseGraph(pages, preferred)
  }
  const unread = projectRefusal !== undefined || ((await read($, access))?.problems.some(problem => problem.id === 'scope-project') ?? false)
  if (!unread) {
    try {
      return await pull(true)
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
  const run = readGitHub($, seen).finally(() => {
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

const readGitHub = async ($: EngineInterface, seen: boolean): Promise<void> => {
  // The rate limit ran out: the timer set for its reset reads then.
  if (pausedUntil > (await nowOf($))) return
  await update($, loading, () => true)
  readTouches = touches
  const before = await read($, board)
  let after = before
  try {
    const from = since(Date.now())
    const known = await read($, viewer)
    // First, so a folder that isn't a GitHub repo stops at one call, and a repo with issues turned off skips them.
    repoInfo ??= JSON.parse(await gh($, ['repo', 'view', '--json', 'nameWithOwner,hasIssuesEnabled'])) as { nameWithOwner: string; hasIssuesEnabled: boolean }
    const repo = repoInfo
    const listIssues = (args: string[]) => (repo.hasIssuesEnabled ? gh($, ['issue', 'list', ...args]) : Promise.resolve('[]'))
    const [owner = '', name = ''] = repo.nameWithOwner.split('/')
    // The weekly counts change a little a day, and reading them takes up to ten GraphQL searches: kept for an hour.
    const kept = before?.repo === repo.nameWithOwner && before.velocityAt !== undefined && (await nowOf($)) - before.velocityAt < VELOCITY_MS ? before : null
    const [graph, prs, threads, closed, merged, login, current, milestones] = await Promise.all([
      repo.hasIssuesEnabled ? fetchIssues($, repo.nameWithOwner) : Promise.resolve({ issues: [], project: null, types: [] }),
      gh($, [
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        '50',
        '--json',
        'number,title,url,author,headRefName,headRefOid,isDraft,statusCheckRollup,reviewDecision,additions,deletions,updatedAt,body,closingIssuesReferences,mergeStateStatus,reviewRequests',
      ]),
      // Review threads still open on each pull request; without them, the rows just don't count threads.
      gh($, ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${THREADS_QUERY}`]).then(threadsOf, () => new Map<number, number>()),
      kept ? null : listIssues(['--state', 'closed', '--search', `closed:>=${from}`, '--limit', '500', '--json', 'closedAt']),
      kept ? null : gh($, ['pr', 'list', '--state', 'merged', '--search', `merged:>=${from}`, '--limit', '500', '--json', 'mergedAt']),
      // Who Mine means: asked once, then kept.
      known ?? gh($, ['api', 'user', '--jq', '.login']).then(out => out.trim() || null, () => null),
      currentBranch($),
      // The open milestones, over REST; the last read's stand when they can't be read.
      gh($, ['api', `repos/${repo.nameWithOwner}/milestones?state=open&per_page=50`])
        .then(out => milestonesOf(JSON.parse(out) as unknown[]))
        .catch(() => before?.milestones ?? []),
    ])
    const fetchedAt = await nowOf($)
    const next: Board = {
      repo: repo.nameWithOwner,
      issues: graph.issues,
      prs: parsePrs(prs).map(pr => ({ ...pr, openThreads: threads.get(pr.number) ?? 0 })),
      velocity:
        kept && closed === null && merged === null
          ? kept.velocity
          : { closed: weekly(timesOf(closed ?? '[]', 'closedAt'), fetchedAt), merged: weekly(timesOf(merged ?? '[]', 'mergedAt'), fetchedAt) },
      velocityAt: kept?.velocityAt ?? fetchedAt,
      milestones,
      issueTypes: graph.types,
      fetchedAt,
      project: graph.project,
    }
    after = next
    if (login !== known) await update($, viewer, () => login)
    await land($, before, next, seen)
    await followBranch($, current)
    // The branch's pull request has CI running: the board watches the run for its progress.
    if (current && next.prs.some(pr => pr.branch === current && pr.ci === 'pending')) void watchRuns($)
    // GitHub answers again: look again too, so a problem fixed since the last check goes.
    if (((await read($, access))?.problems.length ?? 0) > 0) void checkAccess($)
    void prime($, next)
  } catch (cause) {
    const message = messageOf(cause)
    repoInfo = undefined
    if (RATE_LIMITED.test(message)) {
      const was = pausedUntil
      const clock = await nowOf($)
      pausedUntil = await resetOf($, message)
      const at = new Date(pausedUntil).toTimeString().slice(0, 5)
      await update($, error, () => `GitHub's rate limit for this account ran out. The board reads again at ${at}.`)
      if (was <= clock) $.ui.toast(`GitHub's rate limit ran out; the issue board waits until ${at}`)
    } else {
      await update($, error, () => message)
      void checkAccess($, message)
    }
  } finally {
    await update($, loading, () => false)
    schedule($, after)
  }
}

// A new read of the board, this session's or another's: it goes on the board, and what follows from the change does.
const land = async ($: EngineInterface, before: Board | null, next: Board, seen: boolean): Promise<void> => {
  await update($, board, () => next)
  // Merge all's confirm waits on pull requests that are all gone now.
  if (next.prs.length === 0) await update($, confirming, () => false)
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
  // New issues in the Inbox while it shows: Claude suggests for them too, unless its last answer failed, which waits
  // for Suggest again.
  if ((await read($, filter)) === 'inbox' && !(await read($, triage)).failed) void suggestInbox($)
  void moveToDone($, before, next)
  void moveToVerification($, before, next)
}

// What the board moved on its own since the last prompt, which the next prompt notes for Claude.
let moved: string[] = []

// An issue a merged pull request refers to with `Refs #N`, not `Closes`, moves to Verification: merging didn't complete
// its acceptance, so it waits on a check or sign-off. REST says whether the pull request merged; only the move spends
// GraphQL. An issue already at Verification or Done, or a project without Verification, is left alone.
const moveToVerification = async ($: EngineInterface, before: Board | null, next: Board): Promise<void> => {
  const project = next.project
  const verify = optionOf(project?.status, 'Verification')
  if (!project?.status || !verify) return
  const merged = new Map<number, boolean>()
  for (const left of leftForVerification(before, next)) {
    try {
      if (!merged.has(left.pr)) merged.set(left.pr, !/^(null)?$/.test((await gh($, ['api', `repos/${next.repo}/pulls/${left.pr}`, '--jq', '.merged_at'])).trim()))
      if (!merged.get(left.pr)) continue
      await gh($, ['api', 'graphql', '-f', `query=${SET_FIELD}`, '-f', `project=${project.id}`, '-f', `item=${left.item}`, '-f', `field=${project.status.id}`, '-f', `option=${verify.id}`])
      await update($, board, was => was && { ...was, issues: was.issues.map(one => (one.number === left.number ? { ...one, status: verify.name } : one)) })
      moved.push(`#${left.number} moved to ${verify.name}: pull request #${left.pr}, which refers to it without closing it, merged.`)
    } catch (cause) {
      $.ui.log(`issue-board: couldn't move #${left.number} to ${verify.name}: ${messageOf(cause)}`, { to: 'debug' })
    }
  }
}

// An issue that closed as completed since the last read moves to Done in the project, wherever it was closed: by a
// merge, by Claude, or on GitHub. One closed as not planned stays where it was. REST says how it closed; only the move
// spends GraphQL.
const moveToDone = async ($: EngineInterface, before: Board | null, next: Board): Promise<void> => {
  const project = next.project
  const done = optionOf(project?.status, 'Done')
  if (!project?.status || !done) return
  for (const left of leftForDone(before, next)) {
    try {
      const how = JSON.parse(await gh($, ['api', `repos/${next.repo}/issues/${left.number}`, '--jq', '{state, state_reason}'])) as { state?: string; state_reason?: string | null }
      if (how.state !== 'closed' || how.state_reason !== 'completed') continue
      await gh($, ['api', 'graphql', '-f', `query=${SET_FIELD}`, '-f', `project=${project.id}`, '-f', `item=${left.item}`, '-f', `field=${project.status.id}`, '-f', `option=${done.id}`])
      $.ui.log(`issue-board: #${left.number} closed as completed, so it moved to ${done.name}`, { to: 'debug' })
    } catch (cause) {
      $.ui.log(`issue-board: couldn't move #${left.number} to ${done.name}: ${messageOf(cause)}`, { to: 'debug' })
    }
  }
}

// Puts an issue read straight from GitHub on the board. The change is the person's or Claude's own, so the issue
// Claude is on takes its new time and the band doesn't call it news.
const take = async ($: EngineInterface, fresh: Issue): Promise<void> => {
  // `gh issue view` gives no project or sub-issue fields, so the board's own stay.
  await update($, board, now => now && { ...now, issues: now.issues.map(one => (one.number === fresh.number ? { ...one, ...fresh } : one)) })
  await update($, working, was => (was && was.number === fresh.number ? { ...was, updatedAt: fresh.updatedAt } : was))
  await save($)
}

// Ticks or unticks boxes in an issue's body, read fresh from GitHub so an edit made meanwhile isn't lost. One at a
// time: two presses in a row would otherwise each write the body the other read. Answers what it did, and the boxes as
// GitHub had them just before.
let ticking: Promise<unknown> = Promise.resolve()
const tick = ($: EngineInterface, number: number, boxes: number[], done: boolean): Promise<{ text: string; before: Check[] }> => {
  const run = ticking.then(async () => {
    const raw = JSON.parse(await gh($, ['issue', 'view', String(number), '--json', 'body'])) as { body: string | null }
    const before = checksOf(raw.body)
    const edit = tickBody(raw.body ?? '', boxes, done)
    if (edit.missing.length > 0) throw new Error(`#${number} has ${before.length} ${before.length === 1 ? 'box' : 'boxes'}, so there is no box ${edit.missing.join(', ')}`)
    if (edit.changed.length > 0) await gh($, ['issue', 'edit', String(number), '--body-file', '-'], edit.body)
    const [fresh] = parseIssues(`[${await gh($, ['issue', 'view', String(number), '--json', ISSUE_FIELDS])}]`)
    if (fresh) await take($, fresh)
    const step = progress(checksOf(edit.body))
    const tally = `#${number} has ${step.done}/${step.total} ticked.`
    if (edit.changed.length === 0) return { text: `Nothing changed: ${boxes.length === 1 ? 'that box was' : 'those boxes were'} already ${done ? 'ticked' : 'unticked'}. ${tally}`, before }
    return { text: `${done ? 'Ticked' : 'Unticked'} ${edit.changed.length === 1 ? 'box' : 'boxes'} ${edit.changed.join(', ')}. ${tally}`, before }
  })
  ticking = run.catch(() => undefined)
  return run
}

// Asks Claude, over the conversation so far, for an issue to file, or with `epic` a parent and its sub-issues; the draft
// waits in the pane for the person.
const draftIssue = async ($: EngineInterface, what: string, epic = false): Promise<void> => {
  if (await read($, drafting)) return
  await update($, drafting, () => true)
  await update($, draft, () => null)
  await update($, revising, () => null)
  try {
    const labels = labelsOf((await read($, board))?.issues ?? [])
    const prompt = draftPrompt(what, labels, epic)
    let reply: ModelForkResult = await $.model.fork({ prompt })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork' && what) reply = await $.model.complete({ model: 'sonnet', prompt, maxTokens: epic ? 4096 : 1024 })
    if (!reply.isAnswered) {
      $.ui.toast(reply.reason === 'nothing-to-fork' ? `Nothing to draft from yet. Say what it is about: /issues new ${epic ? 'epic ' : ''}<what>` : `Couldn't draft the issue: ${reply.reason}`)
      return
    }
    const made = parseDraft(reply.text, labels)
    if (made) await update($, draft, () => made)
    else $.ui.toast(`Claude's draft didn't come back as ${epic ? 'an epic' : 'an issue'}. Try /issues new again.`)
  } finally {
    await update($, drafting, () => false)
  }
}

// Creates one issue; with `parent`, as its sub-issue. Answers its number.
const createIssue = async ($: EngineInterface, one: { title: string; body: string; labels: string[] }, parent?: number): Promise<number> => {
  const url = (
    await gh(
      $,
      ['issue', 'create', '--title', one.title, '--body-file', '-', ...one.labels.flatMap(label => ['--label', label]), ...(parent ? ['--parent', String(parent)] : [])],
      one.body,
    )
  ).trim()
  const number = Number(/\/issues\/(\d+)$/.exec(url)?.[1])
  if (!number) throw new Error(`gh didn't say which issue it created: ${url}`)
  return number
}

// The labels the draft's editor offers: the repo's, once they're read, and until then the ones the board's issues
// carry. The draft's own come from those too.
const draftLabelsOf = (offered: { labels: string[] } | null, issues: Issue[], made: Draft): string[] =>
  [...new Set([...(offered?.labels ?? labelsOf(issues)), ...made.labels])].sort()

// Edit opens the draft's editor on a copy of the draft, and reads the repo's labels the first time.
const editDraft = async ($: EngineInterface): Promise<void> => {
  const made = await read($, draft)
  if (!made) return
  await update($, revising, () => ({ title: made.title, lines: draftLines(made.body).map((text, id) => ({ id, text })), labels: made.labels }))
  // The ring from an earlier edit names a field of that one.
  await update($, ring, () => null)
  if (!(await read($, palette))) await loadPalette($)
}

// Save puts the editor's copy on the card, with only labels the repo has. A title left empty can't be saved.
const saveDraft = async ($: EngineInterface): Promise<void> => {
  const edit = await read($, revising)
  const made = await read($, draft)
  if (!edit || !made) return
  if (edit.title.trim() === '') {
    $.ui.toast("The title can't be empty. Write one, then save.")
    return
  }
  const allowed = draftLabelsOf(await read($, palette), (await read($, board))?.issues ?? [], made)
  const labels = [...new Set(edit.labels)].filter(label => allowed.includes(label))
  await update($, draft, was => was && { ...was, title: edit.title.trim(), body: draftBody(edit.lines.map(line => line.text)), labels })
  await update($, revising, () => null)
}

// Creates the draft as the card shows it: the issue, or an epic's parent then each sub-issue under it. Each joins the
// repo's project at Inbox, so it shows under its Status at once. It waits while the editor is open, so an edit not
// saved isn't filed. One creation at a time: a second press while one runs, or a Create that comes in after it's
// done, would make the issues again.
// Checked and set with nothing awaited between, so two presses in a row can't both get through, as two reads of the
// `creating` state can; that state only tells the pane to say so.
let filing = false
const fileDraft = async ($: EngineInterface): Promise<void> => {
  if (filing) return
  filing = true
  const made = await read($, draft)
  if (!made || (await read($, revising))) {
    filing = false
    if (made) $.ui.toast('Save or cancel the edit first.')
    return
  }
  await update($, creating, () => true)
  try {
    const number = await createIssue($, made)
    // The parent exists now: should a sub-issue fail, Create mustn't make the parent again.
    await update($, draft, () => null)
    const children: number[] = []
    for (const child of made.children ?? []) children.push(await createIssue($, child, number))
    const project = (await read($, board))?.project
    const inbox = optionOf(project?.status, 'Inbox')
    if (project) {
      for (const one of [number, ...children]) {
        const { id } = JSON.parse(await gh($, ['issue', 'view', String(one), '--json', 'id'])) as { id: string }
        const added = JSON.parse(await gh($, ['api', 'graphql', '-f', `query=${ADD_ITEM}`, '-f', `project=${project.id}`, '-f', `content=${id}`])) as {
          data?: { addProjectV2ItemById?: { item?: { id?: string } } }
        }
        const item = added.data?.addProjectV2ItemById?.item?.id
        if (item && project.status && inbox) {
          await gh($, ['api', 'graphql', '-f', `query=${SET_FIELD}`, '-f', `project=${project.id}`, '-f', `item=${item}`, '-f', `field=${project.status.id}`, '-f', `option=${inbox.id}`])
        }
      }
    }
    $.ui.toast(children.length > 0 ? `Created epic #${number} with ${children.length} sub-issues` : `Created #${number}`)
  } catch (cause) {
    $.ui.toast(`Couldn't create the issue: ${messageOf(cause)}`)
  } finally {
    filing = false
    await update($, creating, () => false)
    void refresh($)
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

// How the pane opens: Esc steps back through it, a card first, then the pane (the ui.close hook).
const OPEN = { id: PANE, title: 'Issues', focus: true, closeOnEscape: true } as const

// Sets Status or Priority on an issue in the repo's project, adding the issue to the project first when it isn't in it.
// An issue's item in the project, added to the project first when it has none.
const itemFor = async ($: EngineInterface, issue: Issue, project: Project): Promise<string> => {
  if (issue.item) return issue.item
  if (!issue.id) throw new Error(`#${issue.number} hasn't been read with its project yet; refresh and try again`)
  const added = JSON.parse(await gh($, ['api', 'graphql', '-f', `query=${ADD_ITEM}`, '-f', `project=${project.id}`, '-f', `content=${issue.id}`])) as {
    data?: { addProjectV2ItemById?: { item?: { id?: string } | null } | null }
  }
  const item = added.data?.addProjectV2ItemById?.item?.id
  if (!item) throw new Error(`couldn't add #${issue.number} to ${project.title}`)
  await update($, board, was => was && { ...was, issues: was.issues.map(one => (one.number === issue.number ? { ...one, item } : one)) })
  return item
}

// An issue's values for the project's fields, by name, read from GitHub: one item at a time, when its card opens or a
// tool asks, so the board's main read stays cheap.
const readValues = async ($: EngineInterface, issue: Issue): Promise<Record<string, string>> => {
  if (!issue.item) return {}
  try {
    const read$ = itemValuesOf(await graphql($, ITEM_VALUES, { item: issue.item }))
    await update($, values, was => ({ ...was, [issue.number]: read$ }))
    return read$
  } catch (cause) {
    $.ui.log(`issue-board: couldn't read #${issue.number}'s fields: ${messageOf(cause)}`, { to: 'debug' })
    return {}
  }
}

// Sets the project's other fields on an issue, by name, each value checked against the field's kind first; null clears
// one. Status and Priority have their own options.
const setFields = async ($: EngineInterface, issue: Issue, given: Record<string, string | number | null>): Promise<void> => {
  const project = (await read($, board))?.project
  if (!project) throw new Error("the board reads no project for this repo, so it can't set its fields")
  const plan = Object.entries(given).map(([name, value]) => {
    if (/^(status|priority)$/i.test(name)) throw new Error(`set ${name} with ${name.toLowerCase()}, not fields`)
    const field = project.fields?.find(one => one.name.toLowerCase() === name.toLowerCase())
    if (!field) throw new Error(`${project.title} has no field called ${name}${project.fields?.length ? `; it has ${project.fields.map(one => one.name).join(', ')}` : ''}`)
    if (value === null) return { field, value: null }
    const fits = fieldValueOf(field, value)
    if (typeof fits === 'string') throw new Error(fits)
    return { field, value: fits.value }
  })
  const item = await itemFor($, issue, project)
  for (const one of plan) {
    if (one.value === null) await graphql($, CLEAR_VALUE, { project: project.id, item, field: one.field.id })
    else await graphql($, SET_VALUE, { project: project.id, item, field: one.field.id, value: one.value })
  }
  await readValues($, { ...issue, item })
}

const setField = async ($: EngineInterface, issue: Issue, field: 'status' | 'priority', name: string): Promise<void> => {
  const project = (await read($, board))?.project
  const target = field === 'status' ? project?.status : project?.priority
  const option = optionOf(target, name)
  if (!project || !target || !option) throw new Error(`the project has no ${field === 'status' ? 'Status' : 'Priority'} called ${name}`)
  const item = await itemFor($, issue, project)
  await gh($, ['api', 'graphql', '-f', `query=${SET_FIELD}`, '-f', `project=${project.id}`, '-f', `item=${item}`, '-f', `field=${target.id}`, '-f', `option=${option.id}`])
  const placed = item
  await update($, board, now => now && { ...now, issues: now.issues.map(one => (one.number === issue.number ? { ...one, item: placed, [field]: option.name } : one)) })
  await save($)
}

// Start, on GitHub too: the issue moves to In progress in the project and is assigned to the person, so the project
// says who is on what. Then the issue is read again, so the band doesn't call these changes news.
const claim = async ($: EngineInterface, issue: Issue): Promise<void> => {
  const failures: string[] = []
  const started = startedOf((await read($, board))?.project)
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

// Closes an issue as a duplicate of another, over REST: a `Duplicate of #N` comment, which GitHub turns into the link
// between them, then the close with GitHub's duplicate reason, or not planned where GitHub refuses it. The issue leaves
// the board at once. The other issue must exist.
const closeAsDuplicate = async ($: EngineInterface, repo: string, number: number, of: number): Promise<void> => {
  try {
    await gh($, ['api', `repos/${repo}/issues/${of}`, '--jq', '.number'])
  } catch (cause) {
    throw new Error(/HTTP 404|Not Found/i.test(messageOf(cause)) ? `#${of} doesn't exist in ${repo}` : `couldn't read #${of}: ${messageOf(cause)}`)
  }
  await gh($, ['api', '-X', 'POST', `repos/${repo}/issues/${number}/comments`, '-f', `body=Duplicate of #${of}`])
  const close = (reason: string) => gh($, ['api', '-X', 'PATCH', `repos/${repo}/issues/${number}`, '-f', 'state=closed', '-f', `state_reason=${reason}`])
  await close('duplicate').catch(() => close('not_planned'))
  await update($, board, was => was && { ...was, issues: was.issues.filter(one => one.number !== number) })
  await save($)
}

// Makes the labels a change asks for that the repo hasn't got yet, over REST: an `area:` one takes the color the repo's
// other areas have. Answers the names it made, so the answer says so; the card's label picker offers them from then.
const ensureLabels = async ($: EngineInterface, repo: string, names: string[]): Promise<string[]> => {
  let existing: { name: string; color?: string }[]
  try {
    existing = JSON.parse(await gh($, ['api', `repos/${repo}/labels?per_page=100`])) as { name: string; color?: string }[]
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
    const fresh = JSON.parse(await gh($, ['api', `repos/${repo}/issues/${number}`, '--jq', '{body, updated_at}'])) as { body: string | null; updated_at: string }
    body = fresh.body ?? ''
    if (changes.body !== undefined) {
      const known = (await read($, board))?.issues.find(one => one.number === number)
      if (!known) throw new Error(`the board doesn't hold #${number}, so it can't tell whether its body changed meanwhile; add or reword its boxes instead`)
      // A board saved between sessions has no bodies: then the time of the last change tells.
      const same = known.body ? known.body === body : known.updatedAt === fresh.updated_at
      if (!same) throw new Error(`#${number}'s body changed on GitHub since the board read it, so it wasn't overwritten. Read it again with the issues tool, then change it`)
      body = changes.body
    }
    if (changes.rewordBoxes?.length) {
      const reworded = rewordBoxes(body, changes.rewordBoxes)
      if (reworded.missing.length > 0) throw new Error(`#${number} has ${checksOf(body).length} boxes, so there is no box ${reworded.missing.join(', ')}`)
      body = reworded.body
    }
    if (changes.addBoxes?.length) body = addBoxes(body, changes.addBoxes)
  }
  const fields = { ...(changes.title ? { title: changes.title } : {}), ...(body !== undefined ? { body } : {}) }
  const raw = JSON.parse(await gh($, ['api', '-X', 'PATCH', `repos/${repo}/issues/${number}`, '--input', '-'], JSON.stringify(fields))) as {
    title: string
    body: string | null
    updated_at: string
  }
  await update($, board, was => was && { ...was, issues: was.issues.map(one => (one.number === number ? { ...one, title: raw.title, body: raw.body ?? '', checks: checksOf(raw.body), updatedAt: raw.updated_at } : one)) })
  await save($)
}

// Makes or takes away an issue's blocked-by links, over REST, which spends none of the GraphQL limit, and shows them on
// the board at once. A blocker that doesn't exist fails, by its number, before any link is made.
const block = async ($: EngineInterface, repo: string, number: number, blockers: number[], on: boolean): Promise<void> => {
  const ids = await Promise.all(
    blockers.map(async one => {
      try {
        return { number: one, id: (await gh($, ['api', `repos/${repo}/issues/${one}`, '--jq', '.id'])).trim() }
      } catch (cause) {
        throw new Error(/HTTP 404|Not Found/i.test(messageOf(cause)) ? `#${one} doesn't exist in ${repo}` : `couldn't read #${one}: ${messageOf(cause)}`)
      }
    }),
  )
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
    return /HTTP 404|Not Found/i.test(messageOf(cause)) ? `#${number} doesn't exist in ${repo}.` : `Couldn't read #${number}: ${messageOf(cause)}`
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
  const all = JSON.parse(await gh($, ['api', `repos/${repo}/milestones?state=all&per_page=100`])) as { number: number; title: string }[]
  const found = all.find(one => one.title.toLowerCase() === ask.title.toLowerCase())
  const fields = {
    ...(ask.newTitle ? { title: ask.newTitle } : {}),
    ...(ask.due !== undefined ? { due_on: ask.due ? `${ask.due}T00:00:00Z` : null } : {}),
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
  const open = milestonesOf(JSON.parse(await gh($, ['api', `repos/${repo}/milestones?state=open&per_page=50`])) as unknown[])
  await update($, board, was => was && { ...was, milestones: open })
  await update($, palette, was => was && { ...was, milestones: open.map(one => one.title) })
  await save($)
  return text
}

// The project's issues at a Status, open and closed, for the issues tool: the board's copy holds open issues only, so
// the project is read over REST, with its Status field's values. One page of 100 items.
const readProject = async ($: EngineInterface, project: Project, status: string, since?: string): Promise<string> => {
  const path = projectPathOf(project.url)
  if (!path) return `Couldn't tell where ${project.title} lives on GitHub.`
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return 'Give since as a date, YYYY-MM-DD.'
  try {
    const fields = JSON.parse(await gh($, ['api', `${path}/fields?per_page=50`])) as { id: number; name: string }[]
    const field = fields.find(one => one.name === 'Status')
    if (!field) return `${project.title} has no Status field.`
    const items = JSON.parse(await gh($, ['api', `${path}/items?per_page=100&fields=${field.id}`])) as unknown[]
    const found = itemsAt(items, status, since)
    const clock = await nowOf($)
    const scope = `${project.title} at ${status}${since ? `, closed since ${since}` : ''}`
    const more = items.length >= 100 ? '\nRead the first 100 items of the project; there may be more.' : ''
    return found.length > 0 ? `${scope} (${found.length}):\n${found.map(one => foundLine(one, clock)).join('\n')}${more}` : `Nothing in ${scope}.${more}`
  } catch (cause) {
    return `Couldn't read ${project.title}: ${messageOf(cause)}`
  }
}

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

// Files an issue for Claude's issue_create tool. REST does what it can, which spends nothing of the GraphQL limit the
// board reads with: the issue with its labels, assignees and milestone in one call, then its place under an epic. Only
// the project needs GraphQL: adding the item and setting its Status and Priority. Once the issue exists, a later step
// that fails is named in the answer, and nothing is undone. The issue goes on the board at once, without a read.
const fileIssue = async ($: EngineInterface, spec: NewIssue): Promise<string> => {
  const epic = await fileOne($, spec)
  if (!spec.subIssues?.length) return epic.text
  // An epic's parts, in order, each under it. One that fails leaves the others to be filed.
  const parts: string[] = []
  for (const [index, part] of spec.subIssues.entries()) {
    try {
      parts.push((await fileOne($, { ...part, parent: epic.number })).text)
    } catch (cause) {
      parts.push(`Couldn't file sub-issue ${index + 1}, “${part.title}”: ${messageOf(cause)}`)
    }
  }
  return [epic.text, `Its sub-issues:`, ...parts.map(text => `- ${text}`)].join('\n')
}

// Files one issue, as fileIssue says, and answers its number and what to tell Claude.
const fileOne = async ($: EngineInterface, spec: NewIssue): Promise<{ number: number; text: string }> => {
  const now = await read($, board)
  if (!now) throw new Error("the board hasn't read GitHub yet; refresh it and try again")
  const repo = now.repo
  const me = await read($, viewer)
  let milestone: { number: number; title: string } | undefined
  if (spec.milestone) {
    const open = JSON.parse(await gh($, ['api', `repos/${repo}/milestones?state=open&per_page=100`])) as { number: number; title: string }[]
    milestone = open.find(one => one.title.toLowerCase() === spec.milestone?.toLowerCase())
    if (!milestone) throw new Error(`the repo has no open milestone called ${spec.milestone}`)
  }
  const assignees = (spec.assign ?? []).flatMap(login => (login === '@me' ? (me ? [me] : []) : [login]))
  const type = spec.type ? await typeOf($, spec.type) : undefined
  const made = spec.labels?.length ? await ensureLabels($, repo, spec.labels) : []
  const fields = { title: spec.title, body: spec.body, labels: spec.labels ?? [], assignees, ...(milestone ? { milestone: milestone.number } : {}), ...(type ? { type } : {}) }
  const raw = JSON.parse(await gh($, ['api', '-X', 'POST', `repos/${repo}/issues`, '--input', '-'], JSON.stringify(fields))) as {
    number: number
    id: number
    node_id: string
    html_url: string
    updated_at: string
    labels: { name: string; color?: string }[]
    assignees: { login: string }[]
  }
  const did = [`“${spec.title}”`]
  const failed: string[] = []
  if (raw.labels.length > 0) did.push(`labelled ${raw.labels.map(label => label.name).join(', ')}`)
  if (raw.assignees.length > 0) did.push(`assigned ${raw.assignees.map(user => user.login).join(', ')}`)
  if (milestone) did.push(`on ${milestone.title}`)
  if (type) did.push(`typed ${type}`)
  if (made.length > 0) did.push(`with the new ${made.length === 1 ? 'label' : 'labels'} ${made.join(', ')}`)

  let parent: Issue['parent'] = null
  if (spec.parent) {
    try {
      await gh($, ['api', '-X', 'POST', `repos/${repo}/issues/${spec.parent}/sub_issues`, '-F', `sub_issue_id=${raw.id}`])
      const above = now.issues.find(one => one.number === spec.parent)
      parent = { number: spec.parent, title: above?.title ?? '', total: (above?.subIssues?.total ?? 0) + 1, completed: above?.subIssues?.completed ?? 0 }
      did.push(`under #${spec.parent}`)
    } catch (cause) {
      failed.push(`put it under #${spec.parent} (${messageOf(cause)})`)
    }
  }

  if (spec.blockedBy?.length) {
    try {
      // The issue isn't on the board yet: the links show with it, below.
      await block($, repo, raw.number, spec.blockedBy, true)
      did.push(`blocked by ${spec.blockedBy.map(one => `#${one}`).join(', ')}`)
    } catch (cause) {
      failed.push(`mark it blocked by ${spec.blockedBy.map(one => `#${one}`).join(', ')} (${messageOf(cause)})`)
    }
  }

  // Into the project, at the Status asked for, or Inbox where the project has one, to be triaged.
  const project = now.project
  let item: string | null = null
  const set: { status?: string; priority?: string } = {}
  if (project) {
    try {
      const added = JSON.parse(await gh($, ['api', 'graphql', '-f', `query=${ADD_ITEM}`, '-f', `project=${project.id}`, '-f', `content=${raw.node_id}`])) as {
        data?: { addProjectV2ItemById?: { item?: { id?: string } | null } | null }
      }
      item = added.data?.addProjectV2ItemById?.item?.id ?? null
      if (!item) throw new Error('GitHub gave no item')
      for (const [field, wanted] of [['status', spec.status ?? (optionOf(project.status, 'Inbox') ? 'Inbox' : undefined)], ['priority', spec.priority]] as const) {
        if (!wanted) continue
        const target = field === 'status' ? project.status : project.priority
        const option = optionOf(target, wanted)
        const name = field === 'status' ? 'Status' : 'Priority'
        if (!target || !option) {
          failed.push(`set its ${name}: the project has no ${name} called ${wanted}`)
          continue
        }
        try {
          await gh($, ['api', 'graphql', '-f', `query=${SET_FIELD}`, '-f', `project=${project.id}`, '-f', `item=${item}`, '-f', `field=${target.id}`, '-f', `option=${option.id}`])
          set[field] = option.name
        } catch (cause) {
          failed.push(`set its ${name} (${messageOf(cause)})`)
        }
      }
      did.push([`in ${project.title}`, set.status, set.priority].filter(Boolean).join(', '))
    } catch (cause) {
      failed.push(`add it to ${project.title} (${messageOf(cause)})`)
    }
  } else if (spec.status || spec.priority) {
    failed.push('set its Status or Priority: the board reads no project for this repo')
  }

  const issue: Issue = {
    number: raw.number,
    title: spec.title,
    url: raw.html_url,
    labels: raw.labels.map(label => ({ name: label.name, color: label.color ?? '' })),
    assignees: raw.assignees.map(user => user.login),
    checks: checksOf(spec.body),
    updatedAt: raw.updated_at,
    body: spec.body,
    id: raw.node_id,
    item,
    status: set.status ?? null,
    priority: set.priority ?? null,
    milestone: milestone?.title ?? null,
    ...(type ? { type } : {}),
    parent,
    blockedBy: did.some(said => said.startsWith('blocked by')) ? (spec.blockedBy ?? []).filter(one => now.issues.some(issue => issue.number === one)) : [],
  }
  await update($, board, was => {
    if (!was) return was
    // The epic's count, on the epic and on each of its sub-issues, which carry it too.
    const counted = (one: Issue): Issue =>
      !parent
        ? one
        : one.number === parent.number
          ? { ...one, subIssues: { total: parent.total, completed: parent.completed } }
          : one.parent?.number === parent.number
            ? { ...one, parent: { ...one.parent, total: parent.total, completed: parent.completed } }
            : one
    const issues = was.issues.map(counted)
    return { ...was, issues: [issue, ...issues.filter(one => one.number !== issue.number)] }
  })
  await save($)
  $.ui.toast(`Filed #${raw.number}`)
  return { number: raw.number, text: filedText(raw.number, did, failed) }
}

// Claude starting on an issue in the conversation, by the issue_update tool's `start`: as Start does, the issue becomes
// the one this session is on, moves to In progress and is assigned to the person. A pull request's number starts the
// issue it is for.
const startHere = async ($: EngineInterface, number: number): Promise<string> => {
  const now = await read($, board)
  const pr = now?.prs.find(one => one.number === number)
  const target = pr ? pr.issues.find(one => now?.issues.some(issue => issue.number === one)) : number
  const issue = now?.issues.find(one => one.number === target)
  if (!issue) throw new Error(pr ? `pull request #${number} names no issue open on the board` : `#${number} isn't open on the board`)
  await track($, issue, true)
  await claim($, issue)
  $.ui.toast(`Working on #${issue.number} now`)
  return `Started #${issue.number}${pr ? `, the issue pull request #${number} is for` : ''}: it is the issue this session is on, In progress and assigned.`
}

// A GraphQL call with its variables as JSON, which `-f` can't carry for a list such as a field's options.
const graphql = async ($: EngineInterface, query: string, variables: Record<string, unknown>): Promise<Record<string, any>> => {
  const answer = JSON.parse(await gh($, ['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }))) as { data?: Record<string, any>; errors?: { message: string }[] }
  if (answer.errors?.length) throw new Error(answer.errors[0]?.message ?? 'GitHub refused the change')
  return answer.data ?? {}
}

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
    const repoName = (JSON.parse(await gh($, ['repo', 'view', '--json', 'nameWithOwner'])) as { nameWithOwner: string }).nameWithOwner
    const [owner = '', name = ''] = repoName.split('/')
    const facts = await graphql($, FACTS_QUERY, { owner, name })
    const pages: string[] = []
    let after: string | null = null
    do {
      const page: string = JSON.stringify({ data: await graphql($, ITEMS_QUERY, { owner, name, after }) })
      pages.push(page)
      after = nextItemsOf(page)
    } while (after && pages.length < PAGES)
    const root = (await $.session.repo().catch(() => null))?.root ?? (await $.session.root())
    const labels = ((facts.repository?.labels?.nodes ?? []) as { name: string }[]).map(label => label.name)
    const found = factsOf(JSON.stringify({ data: facts }), pages, suggestAreas(labels, await foldersOf($, root)), await hasTemplate($, root))
    // The project the board already reads, when setup saved one and it's still linked; else the first linked.
    const saved = await savedSetup($)
    const chosen = found.projects.find(one => one.id === saved?.project.id)?.id ?? found.projects[0]?.id ?? null
    const areas = found.suggested.join(', ')
    await update($, setup, () => ({ phase: 'ready' as const, facts: found, chosen, areas, steps: stepsOf(found, chosen, areas) }))
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
  const mark = (id: SetupStep['id'], state: NonNullable<SetupStep['state']>, message?: string) =>
    update($, setup, was => (was && 'steps' in was ? { ...was, steps: was.steps.map(step => (step.id === id ? { ...step, state, ...(message ? { message } : {}) } : step)) } : was))
  const run = async (id: SetupStep['id'], work: () => Promise<unknown>): Promise<void> => {
    if (!now.steps.some(step => step.id === id)) return
    await mark(id, 'running')
    try {
      await work()
      await mark(id, 'done')
    } catch (cause) {
      await mark(id, 'failed', messageOf(cause))
    }
  }
  const reread = async (id: string): Promise<SetupProject> => projectOf((await graphql($, PROJECT_QUERY, { id })).node)
  await update($, setup, was => (was?.phase === 'ready' ? { ...was, phase: 'applying' as const } : was))

  let project: SetupProject | null = facts.projects.find(one => one.id === now.chosen) ?? null
  await run('issues', () => gh($, ['repo', 'edit', facts.repo.name, '--enable-issues']))
  await run('project', async () => {
    const title = facts.repo.name.split('/')[1] ?? facts.repo.name
    const made = await graphql($, CREATE_PROJECT, { owner: facts.repo.ownerId, title, repo: facts.repo.id })
    project = await reread(made.createProjectV2.projectV2.id)
  })
  // Without a project, the steps that work in one can't run.
  const needsProject = ['status', 'priority', 'items', 'inbox'] as const
  if (!project) {
    for (const id of needsProject) if (now.steps.some(step => step.id === id)) await mark(id, 'skipped', 'There is no project to change.')
  } else {
    let current: SetupProject = project
    await run('status', async () => {
      if (!current.status) throw new Error('the project has no Status field')
      const { options } = mergeStatuses(current.status.options)
      await graphql($, UPDATE_FIELD, { field: current.status.id, options: options.map(one => ({ ...(one.id ? { id: one.id } : {}), name: one.name, color: one.color, description: one.description })) })
      current = await reread(current.id)
    })
    await run('priority', async () => {
      await graphql($, CREATE_FIELD, { project: current.id, name: 'Priority', options: PRIORITIES })
      current = await reread(current.id)
    })
    // Each open issue's item in the project, the ones already there and the ones added now.
    const items = new Map(facts.issues.flatMap(issue => issue.items.filter(item => item.project === current.id).map(item => [issue.number, item] as const)))
    await run('items', async () => {
      for (const issue of facts.issues) {
        if (items.has(issue.number)) continue
        const added = await graphql($, ADD_ITEM, { project: current.id, content: issue.id })
        items.set(issue.number, { project: current.id, item: added.addProjectV2ItemById.item.id, status: null })
      }
    })
    await run('inbox', async () => {
      const inbox = current.status?.options.find(option => option.name.toLowerCase() === 'inbox')
      if (!current.status || !inbox?.id) throw new Error('the project has no Inbox status')
      for (const { item, status } of items.values()) {
        if (status) continue
        await graphql($, SET_FIELD, { project: current.id, item, field: current.status.id, option: inbox.id })
      }
    })
    project = current
  }
  await run('bug', () => gh($, ['label', 'create', 'bug', '-R', facts.repo.name, '--color', 'd73a4a', '--description', "Something isn't working"]))
  await run('areas', async () => {
    for (const area of areasOf(now.areas, facts.labels)) {
      await gh($, ['label', 'create', `area:${area}`, '-R', facts.repo.name, '--color', '1d76db', '--description', `The ${area} part`])
    }
  })

  // The board reads the project setup ended with from now on, and knows which Status means what.
  const ended: SetupProject | null = project
  if (ended) {
    const kept: SavedSetup = {
      project: { id: ended.id, number: ended.number, title: ended.title },
      status: ended.status ? { id: ended.status.id, roles: rolesOf(ended.status.options) } : null,
      priority: ended.priority ? { id: ended.priority.id } : null,
      at: Date.now(),
    }
    const key = await keyOf($)
    const before = ((await $.store.get(key).catch(() => undefined)) as Partial<Saved> | undefined) ?? {}
    await $.store.set(key, { ...before, setup: kept })
  }
  // Done: the pane shows the project as it now is, a new one included, so its automations still off can be linked.
  await update($, setup, was =>
    was?.phase === 'applying'
      ? { ...was, phase: 'done' as const, ...(ended ? { chosen: ended.id, facts: { ...was.facts, projects: [...was.facts.projects.filter(one => one.id !== ended.id), ended] } } : {}) }
      : was,
  )
  projectRefusal = undefined
  void refresh($)
}

// A Status or Priority picked on a card.
const pick = async ($: EngineInterface, issue: Issue, field: 'status' | 'priority', name: string): Promise<void> => {
  try {
    await setField($, issue, field, name)
    $.ui.toast(`#${issue.number} is ${name} now`)
  } catch (cause) {
    const message = messageOf(cause)
    $.ui.toast(`Couldn't change #${issue.number}: ${message}`)
    if (ACCESS_ERROR.test(message)) void checkAccess($, message)
  }
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
  const step = now ? nextStepOf(now, await doingHere($)) : null
  nextStep = step
  // The box takes a suggestion once the turn has wound down: a few tries, while no new prompt has come.
  for (let tries = 0; step && nextStep === step && tries < 3; tries += 1) {
    if ((await $.prompt.suggest({ text: step }).catch(() => ({ isShown: false }))).isShown) break
    await $.clock.sleep(1000)
  }
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

// Where a background agent's loop may still move on from.
const ACTIVE: readonly Worker['status'][] = ['pending', 'running', 'waiting', 'idle']

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

// How long Start in background waits for Claude to start the agent before its button comes back.
const DISPATCH_MS = 5 * 60 * 1000

// Start in background: Claude dispatches an agent of the board's own type on the issue, to work it in a git worktree
// of its own, in the background, and leave a pull request. The button says it is starting until the agent starts, the
// spawn is refused, or five minutes pass. The issue moves to In progress and is assigned, as Start does.
const startInBackground = ($: EngineInterface, issue: Issue): Promise<void> =>
  launch($, issue, 'background', async () => {
    await $.prompt.submit({ text: backgroundPrompt(issue), asUser: true })
    $.ui.toast(`Asked Claude to start a background agent on #${issue.number}`)
    $.clock.after(DISPATCH_MS, () => void landed($, issue.number, 'background'))
    await claim($, issue)
    return false
  })

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
// Claude started it, Claude Code already gives Claude its result, and a second message would only repeat it. Once an
// agent.
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
    const sent = await $.prompt.submit({ text: handoffPrompt(issue, status, said, pr) })
    if (sent.drop !== undefined) throw new Error(sent.drop)
  } catch (cause) {
    $.ui.log(`issue-board: couldn't tell Claude the background agent on #${worker.number} ended: ${messageOf(cause)}`, { to: 'debug' })
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
    const message = messageOf(cause)
    $.ui.toast(`Couldn't tick the box on #${task.number}: ${message}`)
    if (ACCESS_ERROR.test(message)) void checkAccess($, message)
  }
}

// Makes a change to an issue, from its card or from Claude's issue_update tool: Status and Priority in the project,
// then the gh edit, comment and close, then the board read again so it shows. Answers what it did.
const applyChanges = async ($: EngineInterface, number: number, changes: IssueChanges): Promise<string> => {
  const issue = (await read($, board))?.issues.find(one => one.number === number)
  for (const field of ['status', 'priority'] as const) {
    const value = changes[field]
    if (!value) continue
    if (!issue) throw new Error(`#${number} isn't open on the board, so its ${field === 'status' ? 'Status' : 'Priority'} can't be set`)
    await setField($, issue, field, value)
  }
  if (changes.fields && Object.keys(changes.fields).length > 0) {
    if (!issue) throw new Error(`#${number} isn't open on the board, so its fields can't be set`)
    await setFields($, issue, changes.fields)
  }
  const repo = (await read($, board))?.repo
  if (repo && (changes.title || changes.body !== undefined || changes.addBoxes?.length || changes.rewordBoxes?.length)) await rewrite($, repo, number, changes)
  const made = repo && changes.addLabels?.length ? await ensureLabels($, repo, changes.addLabels) : []
  for (const command of commandsOf(number, changes)) await gh($, command.argv, command.stdin)
  if (repo && changes.type !== undefined) await setType($, repo, number, changes.type)
  if (repo && changes.duplicateOf) await closeAsDuplicate($, repo, number, changes.duplicateOf)
  if (repo && changes.addBlockedBy?.length) await block($, repo, number, changes.addBlockedBy, true)
  if (repo && changes.removeBlockedBy?.length) await block($, repo, number, changes.removeBlockedBy, false)
  await refreshAfter($)
  return `${changesText(number, changes)}${made.length > 0 ? ` Created the ${made.length === 1 ? 'label' : 'labels'} ${made.join(', ')}, new to the repo.` : ''}`
}

// A change made on a card: said in a toast, and an error that may be a missing permission checked.
const change = async ($: EngineInterface, number: number, changes: IssueChanges): Promise<void> => {
  try {
    $.ui.toast(await applyChanges($, number, changes))
  } catch (cause) {
    const message = messageOf(cause)
    $.ui.toast(`Couldn't change #${number}: ${message}`)
    if (ACCESS_ERROR.test(message)) void checkAccess($, message)
  }
}

// How many Inbox issues one ask covers; more are asked about in turn.
const TRIAGE_BATCH = 15

// The repo's areas, the `area:` labels without the prefix; the ones on the board's issues when gh can't list labels.
const repoAreas = async ($: EngineInterface, now: Board): Promise<string[]> => {
  const names = await gh($, ['label', 'list', '-R', now.repo, '--limit', '200', '--json', 'name'])
    .then(out => (JSON.parse(out) as { name: string }[]).map(one => one.name))
    .catch(() => labelsOf(now.issues))
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
      const due = now.issues.filter(issue => isInbox(issue) && !known.some(one => one.number === issue.number && one.updatedAt === issue.updatedAt)).slice(0, TRIAGE_BATCH)
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
  const inbox = ((await read($, board))?.issues ?? []).filter(isInbox).map(issue => issue.number)
  await update($, triage, was => ({ ...was, suggestions: was.suggestions.filter(one => !inbox.includes(one.number)) }))
  await suggestInbox($)
}

// Accept on an Inbox issue: its Priority and area as picked, Claude's suggestion unless changed, and its Status moved
// on to Ready or Backlog, so it leaves the Inbox. Another area label it had comes off.
const acceptTriage = async ($: EngineInterface, issue: Issue, choice: { priority: string | null; area: string | null }, status: 'Ready' | 'Backlog'): Promise<void> => {
  const label = choice.area ? `area:${choice.area}` : null
  const others = label ? issue.labels.map(one => one.name).filter(name => name.startsWith('area:') && name !== label) : []
  const changes: IssueChanges = {
    status,
    ...(choice.priority && choice.priority !== issue.priority ? { priority: choice.priority } : {}),
    ...(label && !issue.labels.some(one => one.name === label) ? { addLabels: [label] } : {}),
    ...(others.length > 0 ? { removeLabels: others } : {}),
  }
  try {
    $.ui.toast(await applyChanges($, issue.number, changes))
    await update($, triage, was => ({ ...was, picks: was.picks.filter(one => one.number !== issue.number) }))
  } catch (cause) {
    const message = messageOf(cause)
    $.ui.toast(`Couldn't triage #${issue.number}: ${message}`)
    if (ACCESS_ERROR.test(message)) void checkAccess($, message)
  }
}

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

// What the card's editor offers: the repo's labels and open milestones, read when it opens.
const loadPalette = async ($: EngineInterface): Promise<void> => {
  try {
    const repo = (await read($, board))?.repo
    if (!repo) return
    const [labels, milestones] = await Promise.all([
      gh($, ['label', 'list', '-R', repo, '--limit', '100', '--json', 'name']).then(out => (JSON.parse(out) as { name: string }[]).map(one => one.name).sort()),
      gh($, ['api', `repos/${repo}/milestones?state=open&per_page=50`]).then(out => (JSON.parse(out) as { title: string }[]).map(one => one.title)),
    ])
    await update($, palette, () => ({ labels, milestones }))
  } catch (cause) {
    $.ui.toast(`Couldn't read the repo's labels and milestones: ${messageOf(cause)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'issues',
      description: 'Show open issues and pull requests in a pane',
      argumentHint: '[refresh | check | setup | new [epic] <what it is about>]',
    })
    await $.tool.register({
      name: 'issues',
      description:
        "Lists this repository's open GitHub issues and pull requests from the issue board's copy, which refreshes every few minutes and after gh changes. " +
        'Without `number`, one line each: number, title, labels and how many task-list boxes are ticked; pull requests also give their branch, CI and review. ' +
        'With `number`, that issue in full as the board has it: labels, assignees and its task-list boxes, numbered as the tick tool counts them; a closed issue is read from GitHub, with how it closed. ' +
        'With `state` closed or all, or `search`, it searches every issue with GitHub\'s own search instead, one line each with how it stands. ' +
        "Read an issue's whole text with `gh issue view`.",
      inputSchema: {
        type: 'object',
        properties: {
          number: { type: 'integer', description: 'One issue or pull request to show in full.' },
          filter: {
            type: 'string',
            enum: ['active', 'future', 'bugs', 'mine', 'all', 'inbox'],
            description:
              "Which issues to list: active, future, bugs, mine (assigned to the signed-in user), inbox, or all, the default. With the repo's GitHub Project, active is Now (Priority P0 and P1), future is Later (P2), and inbox is the issues with Status Inbox or none, waiting to be triaged; without one, future means labelled future and inbox lists nothing.",
          },
          area: { type: 'string', description: 'Only issues with this area: label, such as "simulation".' },
          query: { type: 'string', description: 'Only issues whose title, number or labels hold every word of this.' },
          state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'open (the default) lists the board\'s copy; closed or all search GitHub.' },
          search: { type: 'string', description: "Words to find in any issue's title or body, open or closed, with GitHub's search." },
          label: { type: 'string', description: 'Only issues with this label.' },
          assignee: { type: 'string', description: 'Only issues assigned to this login.' },
          milestone: { type: 'string', description: 'Only issues on this milestone, by title.' },
          milestones: { type: 'boolean', description: 'true lists the open milestones instead: how many of their issues are closed, and when each is due.' },
          status: {
            type: 'string',
            description: "Lists the project's issues at this Status instead, open or closed, read from GitHub: such as Done, to see what shipped, or Verification.",
          },
          since: { type: 'string', description: 'With status: only issues closed on or after this date, YYYY-MM-DD.' },
        },
      },
    })
    await $.tool.register({
      name: 'tick',
      description:
        "Ticks task-list boxes (`- [ ]` lines) in a GitHub issue's body, so the issue board shows the progress. " +
        'Tick a box only once its work is done and checked. Boxes are counted from 1 in the order the body lists them, as the issues tool shows them with `number`. ' +
        'Set `done` to false to untick.',
      inputSchema: {
        type: 'object',
        properties: {
          number: { type: 'integer', description: 'The issue.' },
          boxes: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, description: 'The boxes, counted from 1.' },
          done: { type: 'boolean', description: 'true (the default) ticks them; false unticks them.' },
        },
        required: ['number', 'boxes'],
      },
    })
    await $.tool.register({
      name: 'issue_update',
      description:
        "Changes a GitHub issue of this repository and updates the issue board at once: its title and body, its acceptance boxes, its Status and Priority in the repo's GitHub Project, labels, assignees, " +
        'parent (the epic it is a sub-issue of), milestone, a comment, closing it as completed or not planned, or reopening it. Give only what changes. ' +
        'Moving the Status of the issue the person started needs no permission; any other change asks. ' +
        'When you start work on an issue or pull request in this conversation, without the board\'s Start, call this with start: true, so the board shows it under way. ' +
        "To work one in the background, dispatch the issue-board:worker agent with a description that starts with the issue's #number: the board follows it on its own.",
      inputSchema: {
        type: 'object',
        properties: {
          number: { type: 'integer', description: 'The issue; with start, a pull request starts the issue it is for.' },
          start: {
            type: 'boolean',
            description: 'true when you start work on it here: it becomes the issue this session is on, moves to In progress and is assigned, as the Start button does. Needs no permission.',
          },
          status: { type: 'string', description: "A Status option of the repo's project, such as In progress, Verification or Done." },
          priority: { type: 'string', description: "A Priority option of the repo's project, such as P0, P1 or P2." },
          addLabels: { type: 'array', items: { type: 'string' }, description: "Labels to add. One the repo hasn't got yet is created first, and the answer says so." },
          removeLabels: { type: 'array', items: { type: 'string' }, description: 'Labels to take off.' },
          assign: { type: 'array', items: { type: 'string' }, description: 'GitHub logins to assign; @me for the signed-in user.' },
          unassign: { type: 'array', items: { type: 'string' }, description: 'GitHub logins to unassign; @me for the signed-in user.' },
          parent: { type: 'integer', minimum: 0, description: 'The epic to put it under, by number; 0 takes it out of its epic.' },
          milestone: { type: 'string', description: 'The milestone to put it on, by title; an empty string takes it off its milestone.' },
          comment: { type: 'string', description: 'A comment to add, in Markdown.' },
          close: { type: 'string', enum: ['completed', 'not planned'], description: 'Close it, saying why.' },
          duplicateOf: { type: 'integer', minimum: 1, description: 'Close it as a duplicate of this issue, by number; GitHub links the two.' },
          type: { type: ['string', 'null'], description: "Its issue type, such as Bug or Task, where the repo's organization has types; null takes it off." },
          fields: {
            type: 'object',
            additionalProperties: { type: ['string', 'number', 'null'] },
            description:
              "The project's other fields to set, by name, such as {\"Estimate\": 3, \"Sprint\": \"Iteration 2\", \"Due\": \"2026-10-20\"}: a number, a date (YYYY-MM-DD), text, an iteration's title or an option's name; null clears one.",
          },
          reopen: { type: 'boolean', description: 'true reopens a closed issue.' },
          title: { type: 'string', description: 'A new title.' },
          body: {
            type: 'string',
            description: 'A whole new body, in Markdown. Refused if the body changed on GitHub since the board read it. To add or reword boxes, use addBoxes or rewordBoxes.',
          },
          addBoxes: { type: 'array', items: { type: 'string' }, description: 'Acceptance boxes to add, after the last box, or under a new Acceptance heading.' },
          rewordBoxes: {
            type: 'array',
            items: { type: 'object', properties: { box: { type: 'integer', minimum: 1 }, text: { type: 'string' } }, required: ['box', 'text'] },
            description: 'Boxes to reword, by number as the issues tool counts them; ticked ones stay ticked.',
          },
          addBlockedBy: { type: 'array', items: { type: 'integer' }, description: 'Issues it is blocked by, by number, to link.' },
          removeBlockedBy: { type: 'array', items: { type: 'integer' }, description: 'Issues it is no longer blocked by, by number.' },
        },
        required: ['number'],
      },
    })
    await $.tool.register({
      name: 'milestone',
      description:
        "Makes or changes a milestone of this repository, by its title: one the repo hasn't got is made, with an optional due date and description; " +
        'one it has is renamed, given a new due date or description, closed or reopened. The issue board shows open milestones with their progress. ' +
        'List them with the issues tool and `milestones`. Changing a milestone asks for permission.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The milestone, by title.' },
          newTitle: { type: 'string', description: 'A new title.' },
          due: { type: 'string', description: 'The due date, YYYY-MM-DD; an empty string clears it.' },
          description: { type: 'string', description: 'What the milestone is for.' },
          close: { type: 'boolean', description: 'true closes it.' },
          reopen: { type: 'boolean', description: 'true reopens a closed one.' },
        },
        required: ['title'],
      },
    })
    await $.tool.register({
      name: 'issue_create',
      description:
        "Files a new GitHub issue in this repository and puts it on the issue board at once: its title and body, labels, assignees, milestone, the epic it is a sub-issue of, " +
        "and its Status and Priority in the repo's GitHub Project. Without a Status it goes to the project's Inbox. Write the body in Markdown, with an Acceptance list of " +
        "`- [ ]` boxes. For an epic, give its sub-issues too: each is filed under it, in order, with the same fields. " +
        "Filing asks for permission. If a step after filing fails, the answer says which, and gives the new issue's number.",
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The title.' },
          body: { type: 'string', description: 'The body, in Markdown.' },
          labels: { type: 'array', items: { type: 'string' }, description: "Labels to put on it. One the repo hasn't got yet is created first, and the answer says so." },
          assign: { type: 'array', items: { type: 'string' }, description: 'GitHub logins to assign; @me for the signed-in user.' },
          milestone: { type: 'string', description: 'An open milestone to put it on, by title.' },
          parent: { type: 'integer', minimum: 1, description: 'The epic to file it under, as a sub-issue, by number.' },
          blockedBy: { type: 'array', items: { type: 'integer' }, description: 'Issues it is blocked by, by number.' },
          type: { type: 'string', description: "Its issue type, such as Bug or Task, where the repo's organization has types." },
          status: { type: 'string', description: "A Status option of the repo's project, such as Backlog or Ready." },
          priority: { type: 'string', description: "A Priority option of the repo's project, such as P0, P1 or P2." },
          subIssues: {
            type: 'array',
            description: 'For an epic: its sub-issues, filed under it in this order. Each takes the fields above, but no sub-issues of its own.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                body: { type: 'string' },
                labels: { type: 'array', items: { type: 'string' } },
                assign: { type: 'array', items: { type: 'string' } },
                milestone: { type: 'string' },
                status: { type: 'string' },
                priority: { type: 'string' },
                blockedBy: { type: 'array', items: { type: 'integer' } },
              },
              required: ['title'],
            },
          },
        },
        required: ['title'],
      },
    })
    // The agent Start in background runs: in its own worktree, in the background.
    await $.agent
      .register({
        name: 'worker',
        description: "Works one GitHub issue of this repository end to end in its own git worktree, for the issue board's Start in background.",
        prompt: WORKER_PROMPT,
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
    return next(e)
  })

  // The new session's SessionStart hooks run once its state is empty: the board fills it again.
  on('classic.SessionStart', async ($, e, next) => {
    if (restarted) void begin($)
    return next(e)
  }).catch(($, e, next) => fallBack($, e, next, 'classic.SessionStart'))

  on('command.run', { command: 'issues' }, async ($, e) => {
    const asked = /^new\b\s*(epic\b)?\s*([\s\S]*)$/.exec(e.args.trim())
    if (asked) {
      const epic = asked[1] !== undefined
      await $.ui.open(OPEN)
      void draftIssue($, (asked[2] ?? '').trim(), epic)
      return {
        text: epic
          ? 'Drafting an epic and its sub-issues from the conversation. They show at the top of the issues pane to check before you create them.'
          : 'Drafting an issue from the conversation. It shows at the top of the issues pane to check before you create it.',
      }
    }
    if (e.args.trim() === 'setup') {
      await $.ui.open(OPEN)
      void readSetup($)
      return { text: 'Reading the repo and its project. What setup would change shows at the top of the issues pane, and nothing changes until you press Apply.' }
    }
    if (e.args.trim() === 'check') {
      const problems = await checkAccess($)
      const found = await read($, access)
      if (problems.length > 0) {
        const count = problems.length === 1 ? 'one problem' : `${problems.length} problems`
        return { text: `The issue board found ${count}:\n${problems.map(problem => `- ${problem.title}. ${problem.detail} ${problem.fix}`).join('\n')}` }
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
      return { text: `The issue board has what it needs. ${who}${found.permission ? `, with ${found.permission.toLowerCase()} access to ${found.repo}` : ''}.` }
    }
    if (e.args.trim() === 'refresh') {
      await refresh($)
      const now = await read($, board)
      return {
        text: now ? `Refreshed: ${summary(now.issues, now.prs) ?? 'nothing open'}.` : `Couldn't refresh: ${(await read($, error)) ?? 'unknown error'}`,
      }
    }
    await $.ui.open(OPEN)
    if ((await read($, board)) === null) void refresh($)

    return {
      text: 'Issues pane opened. 1-5 filter, r refreshes, Enter on an issue opens it, then Start sends it to Claude, and Esc collapses it. /issues new drafts an issue from the conversation.',
    }
  })

  // Where the pane's focus ring is while the draft's editor is open, so it can show the whole of a long line while it's
  // typed in. With the editor closed it stays null, so moving the ring doesn't draw the pane again.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny) return moved
    const key = (await read($, revising)) ? (e.element ?? null) : null
    if ((await read($, ring)) !== key) await update($, ring, () => key)
    return moved
  }).catch(($, e, next) => fallBack($, e, next, 'ui.focus'))

  // Esc, or the pane's close mark: with an issue's card or a pull request's details open it folds them and keeps the
  // pane; with nothing open the pane closes. The engine stamps both as the person's close, so they step back alike.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    // Setup showing steps back first, unless Apply is running: that keeps the pane open until it's done.
    const shown = await read($, setup)
    if (shown) {
      if (shown.phase !== 'applying') await update($, setup, () => null)
      return { value: undefined }
    }
    // The draft's editor open: Esc cancels the edit, and the draft stays as it was.
    if (await read($, revising)) {
      await update($, revising, () => null)
      return { value: undefined }
    }
    const folding = (await read($, expanded)).length > 0 || (await read($, openPr)) !== null
    if (!folding) return next(e)
    await update($, expanded, () => [])
    await update($, editing, () => null)
    await update($, openPr, () => null)
    return { value: undefined }
  }).catch(($, e, next) => fallBack($, e, next, 'ui.close'))

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
    const added: string[] = []
    try {
      // What the board moved on its own since the last prompt.
      if (moved.length > 0 && e.origin.kind !== 'task-notification') {
        added.push(...moved)
        moved = []
      }
      const now = await read($, board)
      if (now) {
        const note = await newsFor($, now)
        if (note) added.push(note)
        // A background task's notice quotes its command, which may name an issue nobody asked about.
        for (const number of e.origin.kind === 'task-notification' ? [] : mentionsOf(e.text)) {
          const copy = mentionText(now, number, Date.now())
          if (copy) added.push(copy)
        }
      }
    } catch (cause) {
      $.ui.log(`issue-board: couldn't add the board to the prompt: ${messageOf(cause)}`, { to: 'debug' })
    }
    return next(added.length > 0 ? { ...e, context: [...(e.context ?? []), ...added] } : e)
  }).catch(($, e, next) => fallBack($, e, next, 'prompt.submit'))

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId === undefined) void afterTurn($)
    else void workerEnded($, e.agentId, e.answer, e.reason)
    return ended
  })

  // Claude dispatches the board's agent, from Start in background: the issue's row follows the agent it started.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (e.subagentType !== WORKER) return started
    const number = workerIssueOf(e)
    // Start in background claimed the issue when pressed; a dispatch from the conversation claims it here.
    const fromPress = number !== undefined && pressed.has(`background-${number}`)
    if (number !== undefined) await landed($, number, 'background')
    if (started.deny !== undefined) {
      $.ui.toast(`Couldn't start a background agent${number ? ` on #${number}` : ''}: ${started.deny}`)
      return started
    }
    if (number === undefined) return started
    try {
      // Core names the agent it started; failing that, the session's list does, by the name it was given, or by its
      // description when it has none. An earlier agent on the issue may match too, so one that hasn't ended comes first.
      const listed = async () => {
        const matching = (await $.agent.list()).filter(agent => agent.type === WORKER && (e.name ? agent.name === e.name : agent.description === e.description))
        return (matching.findLast(agent => !['completed', 'failed', 'killed'].includes(agent.status)) ?? matching.at(-1))?.id
      }
      const agentId = started.agentId ?? (await listed())
      if (!agentId) throw new Error('no agent id')
      await workerStarted($, number, agentId, startedByClaude(next.origin, e))
      const issue = fromPress ? undefined : (await read($, board))?.issues.find(one => one.number === number)
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

  // The engine's guess at the next prompt gives way to the board's next step for the issue Claude is on.
  on('prompt.suggest', async ($, e, next) => (e.origin.kind === 'suggestion' && nextStep ? next({ ...e, text: nextStep }) : next(e)))

  on('tool.call', { tool: ISSUES_TOOL }, async ($, e) => {
    const input = e as unknown as {
      number?: number
      filter?: Filter
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
      if (!repo) return { deny: "The issue board hasn't read GitHub yet; refresh it and try again." }
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
    const chosen = input.filter ?? 'all'
    const who = await read($, viewer)
    const area = input.area?.replace(/^area:/, '')
    const project = now.project ?? null
    const kept = groupsOf(
      now.issues.filter(
        issue =>
          matches(chosen, issue, who, project) &&
          (!area || areaOf(issue) === area) &&
          (!input.query || searched(input.query, issue)) &&
          (!input.label || issue.labels.some(label => label.name.toLowerCase() === input.label?.toLowerCase())) &&
          (!input.assignee || issue.assignees.includes(input.assignee.replace(/^@/, ''))) &&
          (!input.milestone || issue.milestone?.toLowerCase() === input.milestone.toLowerCase()),
      ),
      project ? 'status' : 'area',
      project,
    ).flatMap(group => group.issues)
    const label =
      project && (chosen === 'active' || chosen === 'future') ? (chosen === 'active' ? 'now: P0 and P1' : 'later: P2') : chosen === 'inbox' ? 'inbox: Status Inbox or none' : chosen
    return { result: boardText(now, kept, label, Date.now()) }
  }).catch(($, _e, next) => toolFailed($, next, 'issues'))

  on('tool.call', { tool: TICK_TOOL }, async ($, e) => {
    const input = e as unknown as { number?: unknown; boxes?: unknown; done?: unknown }
    const { number, boxes } = input
    if (typeof number !== 'number' || !Array.isArray(boxes) || boxes.length === 0 || !boxes.every(box => Number.isInteger(box))) {
      return { deny: 'Give the issue number and the boxes to tick, counted from 1.' }
    }
    try {
      const copy = await copyOf($)
      const { text, before } = await tick($, number, boxes as number[], input.done !== false)
      // Only the boxes Claude changed: the body was read fresh, so what others changed meanwhile stays news.
      if ((await read($, working))?.number === number) await absorb($, copy && { ...copy, checks: before })
      return { result: text }
    } catch (cause) {
      const message = messageOf(cause)
      const problems = ACCESS_ERROR.test(message) ? await checkAccess($, message) : []
      return { deny: `Couldn't tick boxes on #${number}: ${message}${problems.length > 0 ? `\n${problemsText(problems)}` : ''}` }
    }
  }).catch(($, _e, next) => toolFailed($, next, 'tick'))

  on('tool.call', { tool: UPDATE_TOOL }, async ($, e) => {
    const changes = changesOf(e)
    if (!changes) return { deny: 'Give the issue number, and what to change on it.' }
    const { number, ...rest } = changes
    const starting = (e as { start?: unknown }).start === true
    try {
      const started = starting ? await startHere($, number) : null
      if (started && Object.keys(rest).length === 0) return { result: started }
      const copy = (await read($, working))?.number === number ? await copyOf($) : null
      const result = await applyChanges($, number, rest)
      // What the tool changed that Claude is told of: a comment, and closing or reopening.
      if (copy) {
        const closed = rest.close ? true : rest.reopen ? false : copy.closed
        await absorb($, copy, { ...copy, comments: copy.comments === null ? null : copy.comments + (rest.comment ? 1 : 0), closed })
      }
      return { result: started ? `${started}\n${result}` : result }
    } catch (cause) {
      const message = messageOf(cause)
      const problems = ACCESS_ERROR.test(message) ? await checkAccess($, message) : []
      return { deny: `Couldn't change #${number}: ${message}${problems.length > 0 ? `\n${problemsText(problems)}` : ''}` }
    }
  }).catch(($, _e, next) => toolFailed($, next, 'issue_update'))

  // Claude filing an issue. Claude Code asks first, as for any tool that changes something.
  on('tool.call', { tool: CREATE_TOOL }, async ($, e) => {
    const spec = newIssueOf(e)
    if (typeof spec === 'string') return { deny: spec }
    try {
      return { result: await fileIssue($, spec) }
    } catch (cause) {
      const message = messageOf(cause)
      const problems = ACCESS_ERROR.test(message) ? await checkAccess($, message) : []
      return { deny: `Couldn't file the issue: ${message}${problems.length > 0 ? `\n${problemsText(problems)}` : ''}` }
    }
  }).catch(($, _e, next) => toolFailed($, next, 'issue_create'))

  // Claude making or changing a milestone. Claude Code asks first, as for any tool that changes something.
  on('tool.call', { tool: MILESTONE_TOOL }, async ($, e) => {
    const ask = e as unknown as { title?: unknown; newTitle?: unknown; due?: unknown; description?: unknown; close?: unknown; reopen?: unknown }
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
    const title = text(ask.title)
    if (!title) return { deny: 'Give the milestone a title.' }
    const repo = (await read($, board))?.repo
    if (!repo) return { deny: "The issue board hasn't read GitHub yet; refresh it and try again." }
    try {
      const newTitle = text(ask.newTitle)
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
  }).catch(($, _e, next) => toolFailed($, next, 'milestone'))

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
  // doesn't lose it. The section changes only when the person starts another, to keep the prompt cache.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const now = await read($, working)
    if (!now?.sessionId || now.sessionId !== (await $.session.id().catch(() => undefined))) return composed

    return { sections: [...composed.sections, { id: 'issue-board:working', text: workingSection(now), scope: 'session' as const }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
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
    const arming = await read($, confirming)
    const who = await read($, viewer)
    const typed = await read($, query)
    const here = await read($, branch)
    const doing = await read($, working)
    const made = await read($, draft)
    const thinking = await read($, drafting)
    const revised = await read($, revising)
    const focusKey = await read($, ring)
    const making = await read($, creating)
    const changing = await read($, editing)
    const offered = await read($, palette)
    const armedClose = await read($, closing)
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
    // The issue Start sent Claude in this session: its Start says so rather than starting it again.
    const startedHere = doing?.started && doing.sessionId !== undefined && doing.sessionId === (await $.session.id().catch(() => undefined)) ? doing.number : null
    const clock = Date.now()
    const elements = $.ui.resolve(e)
    // The mobile app draws no text field: its table hands out one that draws nothing.
    const Input = 'Input' in elements && e.surface !== 'mobile' ? elements.Input : undefined
    const Markdown = elements.Markdown
    // A link in a row stays on one line: squeezed, it ends in an ellipsis rather than breaking down the pane a letter a
    // line. A click still opens the whole address.
    const link = (href: string, label = '↗ GitHub') => (
      <Text wrap="truncate-end">
        <Link href={href} label={label} />
      </Text>
    )

    // Start: the issue is the one Claude is on, and Claude gets it. Its button says so from the press on.
    const start = (issue: Issue) =>
      launch($, issue, 'start', async () => {
        await track($, issue, true)
        const listed = await makeTasks($, issue)
        await $.prompt.submit({ text: startPrompt(issue, listed > 0), asUser: true })
        $.ui.toast(`Sent #${issue.number} to Claude`)
        await claim($, issue)
        return true
      })

    const flip = async (issue: Issue, box: number, done: boolean) => {
      try {
        await tick($, issue.number, [box], done)
        $.ui.toast(`${done ? 'Ticked' : 'Unticked'} box ${box} on #${issue.number}`)
      } catch (cause) {
        const message = messageOf(cause)
        $.ui.toast(`Couldn't change box ${box} on #${issue.number}: ${message}`)
        if (ACCESS_ERROR.test(message)) void checkAccess($, message)
      }
    }

    const closeOut = async (pr: PullRequest) => {
      await $.prompt.submit({ text: closeOutPrompt(pr), asUser: true })
      $.ui.toast(`Sent PR #${pr.number} to Claude to finish and merge`)
    }

    // Merge all merges every open pull request, so it asks once more before it goes.
    const closeOutAll = async (prs: PullRequest[]) => {
      await update($, confirming, () => false)
      // The pull requests it was asked for may have merged while it waited on its confirm.
      if (prs.length === 0) {
        $.ui.toast('No pull requests are open now, so there is nothing to merge.')
        return
      }
      await $.prompt.submit({ text: closeOutAllPrompt(prs), asUser: true })
      $.ui.toast(`Sent ${prs.length} ${prs.length === 1 ? 'PR' : 'PRs'} to Claude to finish and merge`)
    }
    const arm = (to: boolean) => () => void update($, confirming, () => to)

    // One card at a time, so its letter keys always work; an opened card is scrolled into view.
    const toggle = (number: number) => async () => {
      const opening = !open.includes(number)
      await update($, expanded, () => (opening ? [number] : []))
      await update($, editing, () => null)
      if (opening) await $.ui.scroll({ to: { key: `card-${number}` }, in: PANE }).catch(() => undefined)
      if (opening) await loadComments($, number)
      const issue = opening ? now?.issues.find(one => one.number === number) : undefined
      if (issue && (project?.fields ?? []).some(field => !/^(status|priority)$/i.test(field.name))) await readValues($, issue)
    }
    const togglePr = (number: number) => () => void update($, openPr, was => (was === number ? null : number))

    const meter = (done: number, total: number, cells: number) => {
      const [filled, empty] = bar({ done, total }, cells)
      return (
        <Text>
          <Text color={tone({ done, total })}>{filled}</Text>
          <Text color="inactive" dimColor>
            {empty}
          </Text>
        </Text>
      )
    }

    // The header's right: when the board last synced, and Refresh.
    const sync = (
      <Box flexDirection="row" gap={1}>
        <Text color={busy ? 'warning' : undefined} dimColor={!busy}>
          {busy ? '◌ syncing…' : now ? `⟳ ${ago(new Date(now.fetchedAt).toISOString(), clock)}` : ''}
        </Text>
        <Button key="refresh" hotkey="r" dimColor onPress={() => void refresh($)}>
          Refresh
        </Button>
      </Box>
    )
    const repoName = (
      <Text>
        <Text color="claude">◆ </Text>
        <Text bold>{now ? now.repo : 'GitHub'}</Text>
      </Text>
    )
    // Before there is a board: the repo and the sync, nothing to total yet.
    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        {repoName}
        {sync}
      </Box>
    )

    // What the last permission check found missing, each with its fix.
    const blocked = problems.some(problem => problem.blocks)
    const setupCard = problems.length > 0 && (
      <Box flexDirection="column" borderStyle="round" borderColor={blocked ? 'error' : 'warning'} paddingX={1} marginTop={1}>
        <Text color={blocked ? 'error' : 'warning'} bold>
          {blocked ? '✗ Setup needed' : '⚠ The board is limited'}
        </Text>
        {problems.map(problem => (
          <Box key={`problem-${problem.id}`} flexDirection="column" marginTop={1}>
            <Text bold wrap="wrap">
              {problem.title}
            </Text>
            <Text dimColor wrap="wrap">
              {problem.detail}
            </Text>
            <Text wrap="wrap">{problem.fix}</Text>
            {problem.command && (
              <Box flexDirection="row">
                <Button key={`copy-fix-${problem.id}`} onPress={press => void copyFix($, problem, press.surface)}>
                  Copy command
                </Button>
              </Box>
            )}
            {problem.url && !problem.command && <Link href={problem.url} label={`↗ ${problem.url.replace(/^https:\/\//, '')}`} />}
          </Box>
        ))}
        <Box flexDirection="row" marginTop={1}>
          <Button key="recheck" variant="primary" onPress={() => void recheck($)}>
            Check again
          </Button>
        </Box>
      </Box>
    )

    // `/issues setup`: the project it would use, what it would change, what only the project's settings can turn on,
    // and Apply, the one ask before anything changes. While Apply runs, each change is marked as it goes.
    const MARKS = { running: ['◌', 'warning'], done: ['✓', 'success'], failed: ['✗', 'error'], skipped: ['–', 'inactive'] } as const
    const facts = planned && 'facts' in planned ? planned.facts : undefined
    const chosenProject = facts && planned && 'chosen' in planned ? facts.projects.find(one => one.id === planned.chosen) : undefined
    const choose = (id: string | null) => () =>
      void update($, setup, was => (was?.phase === 'ready' ? { ...was, chosen: id, steps: stepsOf(was.facts, id, was.areas) } : was))
    const typeAreas = (text: string) =>
      void update($, setup, was => (was?.phase === 'ready' ? { ...was, areas: text, steps: stepsOf(was.facts, was.chosen, text) } : was))
    const manual = facts ? automationsOff(chosenProject) : []
    const setupPlan = planned && (
      <Box key="setup-plan" flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} marginTop={1}>
        <Text color="suggestion" bold>
          {`⚙ Set up ${facts?.repo.name ?? 'the repo'} for the board`}
        </Text>
        {planned.phase === 'reading' && <Text dimColor>◌ Reading the repo, its project and its issues…</Text>}
        {planned.phase === 'failed' && (
          <Box flexDirection="column">
            <Text color="error" wrap="wrap">{`Couldn't read what setup needs: ${planned.message}`}</Text>
            <Text dimColor>/issues check says what is missing and how to fix it.</Text>
          </Box>
        )}
        {facts && 'steps' in planned && (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
              <Text dimColor>Project</Text>
              {facts.projects.length === 0 && <Text>{`none is linked to ${facts.repo.name}`}</Text>}
              {facts.projects.length === 1 && chosenProject && <Text bold>{`${chosenProject.title} (#${chosenProject.number})`}</Text>}
              {facts.projects.length > 1 &&
                facts.projects.map(one => (
                  <Button
                    key={`setup-project-${one.number}`}
                    variant={one.id === planned.chosen ? 'primary' : undefined}
                    dimColor={one.id !== planned.chosen}
                    onPress={planned.phase === 'ready' ? choose(one.id) : () => undefined}
                  >
                    {`${one.title} #${one.number}`}
                  </Button>
                ))}
              {chosenProject && link(chosenProject.url)}
            </Box>
            {planned.steps.length === 0 ? (
              <Text color="success">✓ Nothing to change: the repo and its project are set up for the board.</Text>
            ) : (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>{planned.phase === 'ready' ? 'Apply will:' : 'Changes:'}</Text>
                {planned.steps.map(step => {
                  const [mark, color] = step.state ? MARKS[step.state] : (['✚', 'suggestion'] as const)
                  return (
                    <Box key={`setup-step-${step.id}`} flexDirection="column">
                      <Text wrap="wrap">
                        <Text color={color}>{`${mark} `}</Text>
                        <Text>{step.title}</Text>
                      </Text>
                      {step.message && (
                        <Text dimColor wrap="wrap">
                          {`  ${step.message}`}
                        </Text>
                      )}
                    </Box>
                  )
                })}
              </Box>
            )}
            {planned.phase === 'ready' && Input && !facts.labels.some(label => label.startsWith('area:')) && (
              <Box flexDirection="row" marginTop={1}>
                <Input
                  key="setup-areas"
                  label="area labels to create: "
                  placeholder="such as simulation, interface"
                  value={planned.areas}
                  submitLabel="update"
                  onInput={typeAreas}
                  onSubmit={typeAreas}
                />
              </Box>
            )}
            {(manual.length > 0 || addsAsTodo(chosenProject)) && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="warning">In the project's Workflows settings, by hand:</Text>
                {manual.length > 0 && <Text color="warning" wrap="wrap">{`  · turn on ${manual.join(', ')}`}</Text>}
                {addsAsTodo(chosenProject) && (
                  <Text color="warning" wrap="wrap">
                    {"  · set Item added to project to Inbox: it sets GitHub's Todo on new issues"}
                  </Text>
                )}
                {chosenProject && <Link href={`${chosenProject.url}/workflows`} label="↗ Workflows" />}
              </Box>
            )}
            {!facts.hasTemplate && (
              <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
                <Text dimColor>No issue template has an Acceptance list.</Text>
                <Button
                  key="setup-template"
                  dimColor
                  onPress={() => void $.prompt.submit({ text: templatePrompt(facts.repo.name), asUser: true }).then(() => $.ui.toast('Asked Claude for an issue template, as a pull request to review'))}
                >
                  Have Claude add one
                </Button>
              </Box>
            )}
            <Box flexDirection="row" gap={1} marginTop={1}>
              {planned.phase === 'ready' && planned.steps.length > 0 && (
                <Button key="setup-apply" variant="primary" onPress={() => void applySetup($)}>
                  Apply
                </Button>
              )}
              {planned.phase === 'applying' && <Text color="warning">◌ Applying…</Text>}
              {planned.phase !== 'applying' && (
                <Button key="setup-close" dimColor onPress={() => void update($, setup, () => null)}>
                  {planned.phase === 'ready' && planned.steps.length > 0 ? 'Cancel' : 'Close'}
                </Button>
              )}
            </Box>
          </Box>
        )}
        {planned.phase === 'failed' && (
          <Box flexDirection="row" marginTop={1}>
            <Button key="setup-close" dimColor onPress={() => void update($, setup, () => null)}>
              Close
            </Button>
          </Box>
        )}
      </Box>
    )

    if (!now) {
      return (
        <Box flexDirection="column">
          {header}
          {setupPlan}
          {setupCard ||
            (failure ? (
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
          ))}
        </Box>
      )
    }

    // Without a project the board works from labels: Active and Future, grouped by area.
    const project = now.project ?? null
    const grouping: GroupBy = picked && (picked !== 'status' || project) ? picked : project ? 'status' : 'area'
    // Whether an issue is under the filter and the search. The open card stays in the list whether or not, until it is
    // collapsed, so setting its Priority or Status doesn't take it away while it's being changed.
    const kept = (issue: Issue) => matches(chosen, issue, who, project) && searched(typed, issue)
    const shown = now.issues.filter(issue => open.includes(issue.number) || kept(issue))
    const closedNow = chosen === 'closed' ? await read($, recent) : null
    // The project's fields beyond Status and Priority, and what the open card's issue has in them.
    const otherFields = (project?.fields ?? []).filter(field => !/^(status|priority)$/i.test(field.name))
    const fieldValues = await read($, values)
    const typedField = await read($, typedFields)
    // One card open: its letter keys work.
    const single = open.filter(number => shown.some(issue => issue.number === number)).length === 1
    const named = FILTERS.find(one => one.id === chosen)
    const filterName = (project ? named?.planned : named?.label) ?? ''
    const bugs = now.issues.filter(isBug).length
    const failing = now.prs.filter(pr => pr.ci === 'fail').length
    const overall = sumProgress(shown)

    const stat = (glyph: string, color: ThemeKey, value: number, label: string) => (
      <Text>
        <Text color={color}>{glyph}</Text>
        <Text bold>{` ${value}`}</Text>
        <Text dimColor>{` ${label}`}</Text>
      </Text>
    )

    // One line: the repo and its totals at the left, the sync at the right. The ticked meter needs the room.
    const topLine = (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" gap={2}>
          {repoName}
          {stat('●', 'claude', now.issues.length, now.issues.length === 1 ? 'issue' : 'issues')}
          {stat('▲', bugs > 0 ? 'error' : 'inactive', bugs, bugs === 1 ? 'bug' : 'bugs')}
          {stat('⇄', 'suggestion', now.prs.length, now.prs.length === 1 ? 'PR' : 'PRs')}
          {failing > 0 && stat('✗', 'error', failing, 'failing')}
          {wide && overall.total > 0 && (
            <Text>
              {meter(overall.done, overall.total, 6)}
              <Text dimColor>{` ${Math.round((overall.done / overall.total) * 100)}%`}</Text>
            </Text>
          )}
        </Box>
        {sync}
      </Box>
    )

    // A board kept from before velocity was fetched has none until it refreshes.
    const velocity = now.velocity ?? { closed: [], merged: [] }
    const trend = (label: string, color: ThemeKey, counts: number[]) => (
      <Text>
        <Text dimColor>{`${label} `}</Text>
        <Text color={color}>{spark(counts)}</Text>
        <Text bold>{` ${counts.reduce((sum, count) => sum + count, 0)}`}</Text>
      </Text>
    )
    const trends = wide && velocity.closed.length > 0 && (
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        {trend('closed', 'success', velocity.closed)}
        {trend('merged', 'suggestion', velocity.merged)}
        <Text dimColor>{`last ${WEEKS} weeks`}</Text>
      </Box>
    )

    // The Issues heading: its filters, the search and the grouping, which act on the issues below it alone. With a
    // project the first two filters read Priority, and the grouping can be Status.
    const groupings = GROUPINGS.filter(one => one.id !== 'status' || project)
    const issuesHeading = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text bold color="claude">
          Issues
        </Text>
        {FILTERS.filter(one => one.id !== 'inbox' || project).map(one => (
          <Button
            key={`filter-${one.id}`}
            hotkey={one.hotkey}
            variant={one.id === chosen ? 'primary' : undefined}
            dimColor={one.id !== chosen}
            onPress={() => void update($, filter, () => one.id).then(() => (one.id === 'inbox' ? suggestInbox($) : one.id === 'closed' ? readRecent($) : undefined))}
          >
            {one.id === 'closed' ? one.label : `${project ? one.planned : one.label} ${now.issues.filter(issue => matches(one.id, issue, who, project)).length}`}
          </Button>
        ))}
        {Input && (
          <Input
            key="search"
            label="⌕ "
            placeholder="search titles, #numbers, labels"
            value={typed}
            submitLabel="search"
            onInput={text => void update($, query, () => text)}
            onSubmit={text => void update($, query, () => text)}
          />
        )}
        <Text dimColor>by</Text>
        {groupings.map(one => (
          <Button
            key={`group-${one.id}`}
            variant={one.id === grouping ? 'primary' : undefined}
            dimColor={one.id !== grouping}
            onPress={() => void update($, groupBy, () => one.id)}
          >
            {one.label}
          </Button>
        ))}
      </Box>
    )

    // The draft card's editor, on a copy of the draft: the title, the body a line a field, and the repo's labels to
    // pick from. Save puts the copy on the card; Cancel or Esc drops it. A surface with no text field can change only
    // the labels.
    // Enter in a line of the body adds a line below it, and the focus moves to the new line. A field can empty itself on
    // Enter, so the line's text gets a fresh field, drawn with the text.
    // A field shows one line, cut off where it runs out of room, so the field with the focus shows its whole text
    // beneath it when it's longer than that.
    const draftEditor = (one: Draft, edit: DraftEdit) => {
      const labels = draftLabelsOf(offered, now.issues, one)
      const untitled = edit.title.trim() === ''
      const revise = (step: (was: DraftEdit) => DraftEdit) => update($, revising, was => was && step(was))
      const setLine = (id: number, text: string) => revise(was => ({ ...was, lines: was.lines.map(line => (line.id === id ? { id, text } : line)) }))
      const breakLine = async (id: number, text: string) => {
        let fresh = 0
        await revise(was => {
          fresh = Math.max(...was.lines.map(line => line.id)) + 1
          return { ...was, lines: was.lines.flatMap(line => (line.id === id ? [{ id: fresh, text }, { id: fresh + 1, text: '' }] : [line])) }
        })
        if (fresh > 0) void $.ui.focus({ requestId: PANE, key: `draft-line-${fresh + 1}` }).catch(() => undefined)
      }
      const whole = (key: string, text: string, room: number) =>
        focusKey === key && [...text].length > room ? (
          <Text key={`${key}-whole`} dimColor wrap="wrap">
            {text}
          </Text>
        ) : undefined
      return (
        <Box key="draft-editor" flexDirection="column" marginTop={1}>
          {Input ? (
            <Input
              key="draft-title"
              label="Title  "
              placeholder="a short, plain sentence"
              value={edit.title}
              submitLabel="save"
              onInput={text => void revise(was => ({ ...was, title: text }))}
              onSubmit={text => void revise(was => ({ ...was, title: text })).then(() => saveDraft($))}
            />
          ) : (
            <Text bold wrap="wrap">
              {edit.title}
            </Text>
          )}
          {Input && whole('draft-title', edit.title, width - 18)}
          {untitled && <Text color="warning">The title can't be empty. Write one to save.</Text>}
          <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
            <Text dimColor>Labels </Text>
            {labels.length === 0 && <Text dimColor>{offered ? 'none in this repo' : 'reading…'}</Text>}
            {labels.map(name => {
              const has = edit.labels.includes(name)
              return (
                <Button
                  key={`draft-label-${name}`}
                  variant={has ? 'primary' : undefined}
                  dimColor={!has}
                  onPress={() => void revise(was => ({ ...was, labels: has ? was.labels.filter(label => label !== name) : [...was.labels, name] }))}
                >
                  {name}
                </Button>
              )
            })}
          </Box>
          {Input ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor wrap="wrap">
                Body · Enter adds a line below. A line you empty is left out when you save.
              </Text>
              {edit.lines.flatMap(({ id, text: line }) =>
                line === null
                  ? [<Text key={`draft-gap-${id}`}> </Text>]
                  : [
                      <Input
                        key={`draft-line-${id}`}
                        placeholder="empty: left out when you save"
                        value={line}
                        submitLabel="new line"
                        onInput={text => void setLine(id, text)}
                        onSubmit={text => void breakLine(id, text)}
                      />,
                      whole(`draft-line-${id}`, line, width - 16),
                    ],
              )}
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <Markdown text={one.body} />
              <Text dimColor wrap="wrap">
                This app has no text field, so only the labels can change here.
              </Text>
            </Box>
          )}
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button key="draft-save" variant="primary" dimColor={untitled} onPress={() => void saveDraft($)}>
              ✓ Save
            </Button>
            <Button key="draft-cancel" dimColor onPress={() => void update($, revising, () => null)}>
              Cancel
            </Button>
          </Box>
        </Box>
      )
    }

    // The issue /issues new drafted, to check, edit and file. While its editor is open, Create and Discard wait, so
    // what's created is what the card shows.
    const draftCard = thinking ? (
      <Box marginTop={1}>
        <Text color="warning">◌ Drafting an issue from the conversation…</Text>
      </Box>
    ) : (
      made && (
        <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} marginTop={1}>
          <Text color="suggestion" bold>
            {`${made.children ? `New epic · draft · ${made.children.length} sub-issues` : 'New issue · draft'}${revised ? ' · editing' : ''}`}
          </Text>
          {revised ? (
            draftEditor(made, revised)
          ) : (
            <Box flexDirection="column">
              <Text bold wrap="wrap">
                {made.title}
              </Text>
              {made.labels.length > 0 && <Text dimColor>{made.labels.join(' · ')}</Text>}
              <Box marginTop={1}>
                <Markdown text={made.body} />
              </Box>
            </Box>
          )}
          {made.children && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Sub-issues</Text>
              {made.children.map((child, index) => {
                const boxes = checksOf(child.body).length
                return (
                  <Text key={`draft-child-${index + 1}`} wrap="wrap">
                    <Text dimColor>{`${index + 1}. `}</Text>
                    <Text>{child.title}</Text>
                    <Text dimColor>{boxes > 0 ? ` · ${boxes} ${boxes === 1 ? 'box' : 'boxes'}` : ''}</Text>
                  </Text>
                )
              })}
            </Box>
          )}
          {making ? (
            <Box marginTop={1}>
              <Text color="warning">{made.children ? '◌ Creating the epic and its sub-issues…' : '◌ Creating the issue…'}</Text>
            </Box>
          ) : (
            !revised && (
              <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
                <Button key="draft-file" variant="primary" hotkey="c" onPress={() => void fileDraft($)}>
                  {made.children ? `✚ Create the epic and ${made.children.length} sub-issues` : '✚ Create issue'}
                </Button>
                <Button key="draft-edit" hotkey={single ? undefined : 'e'} onPress={() => void editDraft($)}>
                  ✎ Edit
                </Button>
                <Button key="draft-discard" dimColor onPress={() => void update($, draft, () => null)}>
                  Discard
                </Button>
              </Box>
            )
          )}
        </Box>
      )
    )

    // A pull request on one row: CI, number, title, a review mark and whether it is this branch's, then Finish & merge.
    // The title opens its details beneath: branch, author, age, review, failing checks and its link.
    const prRow = (pr: PullRequest) => {
      const badge = ciBadge[pr.ci]
      const review = reviewBadge(pr)
      const isOpen = shownPr === pr.number
      const mine = here !== null && pr.branch === here
      const size = `+${pr.additions} −${pr.deletions}`
      const right = 18 + (roomy ? size.length + 1 : 0)
      // The issue it closes or refers to, on the row: the first it names.
      const forIssue = (pr.issues ?? [])[0]
      const forText = forIssue ? `→ #${forIssue}` : ''
      // Why it can't merge yet: conflicts or behind its base, review threads still open, and who is asked to review.
      const merge = mergeNoteOf(pr)
      const threads = pr.openThreads ?? 0
      const threadText = threads > 0 ? `${threads} open ${threads === 1 ? 'thread' : 'threads'}` : ''
      const askedText = (pr.reviewers ?? []).length > 0 ? `asks ${(pr.reviewers ?? []).slice(0, 2).join(', ')}${(pr.reviewers ?? []).length > 2 ? ` +${(pr.reviewers ?? []).length - 2}` : ''}` : ''
      const notes = [merge?.text ?? '', threadText, askedText].filter(Boolean)
      const titleRoom =
        width - [...badge.text].length - String(pr.number).length - 3 - (review ? 2 : 0) - (mine ? 2 : 0) - (forText ? forText.length + 1 : 0) - notes.reduce((sum, note) => sum + cells(note) + 1, 0) - right
      return (
        <Box key={`pr-row-${pr.number}`} flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" gap={1}>
              <Text color={badge.color} inverse bold>
                {badge.text}
              </Text>
              <Text color="suggestion" bold>{`#${pr.number}`}</Text>
              <Button key={`pr-${pr.number}`} plain hover={{ bold: true }} onPress={togglePr(pr.number)}>
                {fit(pr.title, Math.max(12, titleRoom))}
              </Button>
              {forText && <Text color="claude">{forText}</Text>}
              {review && <Text color={review.color}>{pr.isDraft ? '◌' : review.text.slice(0, 1)}</Text>}
              {merge && <Text color={merge.color}>{merge.text}</Text>}
              {threadText && <Text color="warning">{threadText}</Text>}
              {askedText && <Text dimColor>{askedText}</Text>}
              {mine && (
                <Text color="claude" bold>
                  ◆
                </Text>
              )}
            </Box>
            <Box flexDirection="row" gap={1}>
              {roomy && (
                <Text>
                  <Text color="success">{`+${pr.additions}`}</Text>
                  <Text color="error">{` −${pr.deletions}`}</Text>
                </Text>
              )}
              <Button key={`close-out-${pr.number}`} dimColor hover={{ dimColor: false, color: 'suggestion' }} onPress={() => void closeOut(pr)}>
                ⇲ Finish & merge
              </Button>
            </Box>
          </Box>
          {isOpen && (
            <Box key={`pr-detail-${pr.number}`} flexDirection="row" flexWrap="wrap" gap={1} paddingLeft={[...badge.text].length + 1} marginBottom={1}>
              <Text dimColor>{`⎇ ${fit(pr.branch, Math.max(10, Math.floor(width / 3)))}`}</Text>
              {pr.author && <Text dimColor>{`· @${pr.author}`}</Text>}
              {pr.updatedAt && <Text dimColor>{`· ${ago(pr.updatedAt, clock)}`}</Text>}
              {review && <Text color={review.color}>{`· ${review.text}`}</Text>}
              {pr.ci === 'fail' && (pr.failing ?? []).length > 0 && <Text color="error">{`· ${fit(pr.failing.join(', '), 30)}`}</Text>}
              {(pr.issues ?? []).length > 0 && <Text dimColor>{`· for ${pr.issues.map(number => `#${number}`).join(', ')}`}</Text>}
              {mine && (
                <Text color="claude" bold>
                  · ◆ this branch
                </Text>
              )}
              {link(pageOf(now.repo, 'pull', pr))}
            </Box>
          )}
        </Box>
      )
    }

    // A priority as a short tag, the most pressing in the loudest color.
    const priorityColor = (priority: string): ThemeKey => {
      const rank = project?.priority?.options.findIndex(option => option.name === priority) ?? -1
      return rank === 0 ? 'error' : rank === 1 ? 'warning' : 'inactive'
    }

    // Stop tracking the issue this session is on: no row has the ▶ until Start or a branch names one again.
    const stopTracking = async () => {
      await update($, working, () => null)
      await save($)
    }

    // One issue on one line: a mark, its priority, number and title at the left, which opens it; at the right its agent,
    // what blocks it, its pull request with CI, chips, a short progress bar with the count, and its age. The mark is ▶
    // on the issue this session is on and ▲ on a bug.
    const issueRow = (issue: Issue) => {
      const isOpen = open.includes(issue.number)
      const step = progress(issue.checks)
      const bug = isBug(issue)
      const chipList = roomy ? chipsOf(issue).slice(0, 2) : []
      const age = ago(issue.updatedAt, clock)
      const count = `${step.done}/${step.total}`.padEnd(5)
      const linked = prsFor(issue, now.prs)[0]
      const pr = linked ? `⇄ #${linked.number} ${ciBadge[linked.ci].text.trim().split(' ')[0]}` : ''
      const tag = project && issue.priority ? `${fit(issue.priority, 3)} ` : ''
      // The open issue it waits on, if any: the first, and how many more.
      const blockers = issue.blockedBy ?? []
      const blocked = blockers.length > 0 ? `⛔ #${blockers[0]}${blockers.length > 1 ? ` +${blockers.length - 1}` : ''}` : ''
      // The background agent on it, if Start in background set one going.
      const worker = working$.find(one => one.number === issue.number)
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
          {!isOpen && peek(issue)}
          <Box flexDirection="row">
            {onIt ? (
              <Text color="claude" bold>
                {'▶ '}
              </Text>
            ) : (
              <Text color="error">{bug ? '▲ ' : '  '}</Text>
            )}
            {onIt && bug && <Text color="error">▲ </Text>}
            {tag && <Text color={priorityColor(issue.priority ?? '')}>{tag}</Text>}
            <Text color={isOpen || onIt ? 'claude' : undefined} dimColor={!isOpen && !onIt} hover={{ dimColor: false, color: 'claude' }}>
              {`#${issue.number} `}
            </Text>
            <Button key={`issue-${issue.number}`} plain hover={{ bold: true }} onPress={toggle(issue.number)}>
              {fit(issue.title, fits.title)}
            </Button>
          </Box>
          <Box flexDirection="row" gap={1}>
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
              <Button key={`stop-${issue.number}`} dimColor onPress={() => void stopTracking()}>
                ✕
              </Button>
            )}
          </Box>
        </Box>
      )
    }

    // The Inbox shows each issue with what Claude suggests for it: a row of Priority buttons and one of areas, the picked
    // one highlighted, Claude's reason, and Accept, which moves it on to the Status Claude suggests, or the other.
    const triaging = chosen === 'inbox' && project !== null
    const areaNames = [...new Set([...triaged.areas, ...labelsOf(now.issues).filter(name => name.startsWith('area:')).map(name => name.slice('area:'.length))])].sort()
    const triageRow = (issue: Issue) => {
      const said = triaged.suggestions.find(one => one.number === issue.number)
      const mine = triaged.picks.find(one => one.number === issue.number)
      const had = areaOf(issue)
      const priority = mine?.priority ?? said?.priority ?? issue.priority ?? null
      const area = mine && 'area' in mine ? (mine.area ?? null) : said ? said.area : had === 'other' ? null : had
      const status = said?.status ?? statusFor(project, priority)
      const other = status === 'Ready' ? 'Backlog' : 'Ready'
      const choosing = (edit: { priority?: string; area?: string | null }) => () =>
        void update($, triage, was => ({ ...was, picks: [...was.picks.filter(one => one.number !== issue.number), { ...was.picks.find(one => one.number === issue.number), number: issue.number, ...edit }] }))
      const option = (key: string, label: string, chosen: boolean, onPress: () => void) => (
        <Button key={key} variant={chosen ? 'primary' : undefined} dimColor={!chosen} onPress={onPress}>
          {label}
        </Button>
      )
      const age = ago(issue.updatedAt, clock)
      return (
        <Box key={`triage-${issue.number}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" gap={1}>
              <Text color="claude">{`#${issue.number}`}</Text>
              <Button key={`issue-${issue.number}`} plain hover={{ bold: true }} onPress={toggle(issue.number)}>
                {fit(issue.title, Math.max(12, width - String(issue.number).length - age.length - 4))}
              </Button>
            </Box>
            <Text dimColor>{age}</Text>
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap" paddingLeft={2}>
            {(project?.priority?.options ?? []).map(one => option(`triage-${issue.number}-priority-${one.name}`, one.name, one.name === priority, choosing({ priority: one.name })))}
            <Text dimColor>·</Text>
            {areaNames.map(name => option(`triage-${issue.number}-area-${name}`, name, name === area, choosing({ area: name })))}
            {option(`triage-${issue.number}-area-none`, 'no area', area === null, choosing({ area: null }))}
            <Text dimColor>·</Text>
            <Button key={`triage-${issue.number}-accept`} variant="primary" onPress={() => void acceptTriage($, issue, { priority, area }, status)}>
              {`✓ Accept → ${status}`}
            </Button>
            <Button key={`triage-${issue.number}-${other.toLowerCase()}`} dimColor onPress={() => void acceptTriage($, issue, { priority, area }, other)}>
              {`→ ${other}`}
            </Button>
          </Box>
          <Box paddingLeft={2}>
            <Text dimColor wrap="wrap">
              {said ? `✦ ${said.reason || 'No reason given.'}` : triaged.asking ? '◌ waiting on Claude' : '✦ No suggestion yet: pick, then accept.'}
            </Text>
          </Box>
        </Box>
      )
    }

    // What hovering a row shows above it: the title, how far along, and the boxes still open.
    // Every line is padded to the card's width, its margins spaces rather than paddingX, so it covers the rows it is
    // painted over: the surface paints a floating box's text and border but leaves its padding showing what is beneath.
    // It sits at the pane's right, leaving the rows above their mark, number and the start of their title, so the
    // pointer moving up the list reaches the row above rather than the card. A pane without that room shows none.
    // A card above a row too near the pane's top would be pushed down over the row, so each row knows the lines free
    // above it in the window. They are at least these: each line of the board above the list, each heading and row one
    // line, an open card none. Counting short leaves a card smaller than its room, never bigger.
    const PEEK_CLEAR = 28
    const groups = triaging ? [] : groupsOf(shown, grouping, project)
    const listed$ = triaging
      ? shown.map(issue => issue.number)
      : groups.flatMap(group => [null, ...(group.folded && !opened.includes(group.key) ? [] : group.issues.map(issue => issue.number))])
    // The Issues heading wraps its buttons, each its label and four cells of brackets; the search field, of no known
    // width, isn't counted.
    const heading$ = wrappedLines(
      [
        cells('Issues'),
        ...FILTERS.filter(one => one.id !== 'inbox' || project).map(
          one => cells(one.id === 'closed' ? one.label : `${project ? one.planned : one.label} ${now.issues.filter(issue => matches(one.id, issue, who, project)).length}`) + 4,
        ),
        cells('by'),
        ...groupings.map(one => cells(one.label) + 4),
      ],
      width,
    )
    const above$ =
      1 +
      heading$ +
      (trends ? 1 : 0) +
      (failure ? 1 : 0) +
      (now.prs.length > 0 ? 1 + now.prs.length : 0) +
      ((now.milestones ?? []).length > 0 ? 1 + (now.milestones ?? []).length : 0) +
      (arming && now.prs.length > 0 ? 1 : 0) +
      watched.length +
      (triaging ? 1 + (triaged.failed ? 1 : 0) : 0)
    const { offset } = e.props.scroll
    const roomOf = (number: number) => Math.max(0, above$ + listed$.indexOf(number) - offset)
    const peek = (issue: Issue) => {
      const step = progress(issue.checks)
      const cardWidth = Math.min(56, width - PEEK_CLEAR)
      if (cardWidth < 30) return null
      const inner = cardWidth - 4
      const todo = issue.checks.filter(check => !check.done)
      const place = peekPlace(roomOf(issue.number), todo.length)
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

    // A project field on a card: its options as buttons, the one set drawn as the primary. Buttons rather than a
    // Select, which the terminal opens by keyboard alone: a click on its options does nothing.
    const picker = (issue: Issue, field: 'status' | 'priority', label: string, options: { id: string; name: string }[], value: string | null | undefined) => (
      <Box key={`${field}-${issue.number}`} flexDirection="row" gap={1} flexWrap="wrap">
        <Text dimColor>{label}</Text>
        {options.map(option => (
          <Button
            key={`${field}-${issue.number}-${option.id}`}
            variant={option.name === value ? 'primary' : undefined}
            dimColor={option.name !== value}
            onPress={() => void (option.name === value ? undefined : pick($, issue, field, option.name))}
          >
            {option.name}
          </Button>
        ))}
      </Box>
    )

    // Change opens the card's editor, and reads the repo's labels and milestones the first time.
    const openEditor = (number: number) => async () => {
      const opening = changing !== number
      await update($, editing, () => (opening ? number : null))
      await update($, closing, () => null)
      if (opening && !offered) await loadPalette($)
    }

    // The card's editor: each row a change made on GitHub as soon as it's pressed or entered. Closing an epic whose
    // sub-issues are still open takes a second press.
    const editor = (issue: Issue) => {
      const n = issue.number
      const me = who ?? '@me'
      const mine = issue.assignees.includes(me)
      const open = (issue.subIssues?.total ?? 0) - (issue.subIssues?.completed ?? 0)
      const labels = [...new Set([...(offered?.labels ?? labelsOf(now.issues)), ...issue.labels.map(label => label.name)])].sort()
      const closeAs = (reason: 'completed' | 'not planned') => async () => {
        if (open > 0 && armedClose !== n) {
          await update($, closing, () => n)
          return
        }
        await update($, closing, () => null)
        await update($, editing, () => null)
        await change($, n, { close: reason })
      }
      const row = (label: string) => <Text dimColor>{label.padEnd(9)}</Text>
      return (
        <Box key={`editor-${n}`} flexDirection="column" marginTop={1}>
          {Input && (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {row('Title')}
              <Input
                key={`title-${n}`}
                label=""
                placeholder={fit(issue.title, 50)}
                value={fields.title}
                submitLabel="rename"
                onInput={text => void update($, typing, was => ({ ...was, title: text }))}
                onSubmit={text => {
                  if (!text.trim() || text.trim() === issue.title) return
                  void update($, typing, was => ({ ...was, title: '' })).then(() => change($, n, { title: text.trim() }))
                }}
              />
            </Box>
          )}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {row('Boxes')}
            {Input && (
              <Input
                key={`box-${n}`}
                label="+ "
                placeholder="add an acceptance box"
                value={fields.box}
                submitLabel="add"
                onInput={text => void update($, typing, was => ({ ...was, box: text }))}
                onSubmit={text => {
                  if (!text.trim()) return
                  void update($, typing, was => ({ ...was, box: '' })).then(() => change($, n, { addBoxes: [text.trim()] }))
                }}
              />
            )}
            <Button key={`body-${n}`} dimColor onPress={() => void $.prompt.fill({ text: `Edit the body of #${n}: ` })}>
              ✎ Edit the body with Claude
            </Button>
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {row('Labels')}
            {labels.map(name => {
              const has = issue.labels.some(label => label.name === name)
              return (
                <Button key={`label-${n}-${name}`} variant={has ? 'primary' : undefined} dimColor={!has} onPress={() => void change($, n, has ? { removeLabels: [name] } : { addLabels: [name] })}>
                  {name}
                </Button>
              )
            })}
            {Input && (
              // A label the repo hasn't got yet is made, then put on the issue; Claude Code doesn't ask, as the person typed it.
              <Input
                key={`new-label-${n}`}
                label="+ "
                placeholder="new label"
                value={fields.label}
                submitLabel="add"
                onInput={text => void update($, typing, was => ({ ...was, label: text }))}
                onSubmit={text => {
                  if (!text.trim()) return
                  void update($, typing, was => ({ ...was, label: '' })).then(() => change($, n, { addLabels: [text.trim()] }))
                }}
              />
            )}
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {row('Assignee')}
            {issue.assignees.filter(login => login !== me).map(login => (
              <Text color="suggestion">{`@${login}`}</Text>
            ))}
            <Button key={`assign-${n}`} dimColor={mine} onPress={() => void change($, n, mine ? { unassign: ['@me'] } : { assign: ['@me'] })}>
              {mine ? `Unassign me (@${me})` : 'Assign me'}
            </Button>
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {row('Epic')}
            <Text>{issue.parent ? `#${issue.parent.number} ${fit(issue.parent.title, 30)}` : 'none'}</Text>
            {issue.parent && (
              <Button key={`unparent-${n}`} dimColor onPress={() => void change($, n, { parent: null })}>
                Take out
              </Button>
            )}
            {Input && (
              <Input
                key={`parent-${n}`}
                label="put under #"
                placeholder="epic number"
                value={fields.parent}
                submitLabel="set"
                onInput={text => void update($, typing, was => ({ ...was, parent: text }))}
                onSubmit={text => {
                  const parent = Number(text.replace(/^#/, '').trim())
                  if (!Number.isInteger(parent) || parent < 1) return
                  void update($, typing, was => ({ ...was, parent: '' })).then(() => change($, n, { parent }))
                }}
              />
            )}
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {row('Milestone')}
            {!offered && <Text dimColor>reading…</Text>}
            {offered && offered.milestones.length === 0 && <Text dimColor>none in this repo</Text>}
            {(offered?.milestones ?? []).map(title => {
              const has = issue.milestone === title
              return (
                <Button key={`milestone-${n}-${title}`} variant={has ? 'primary' : undefined} dimColor={!has} onPress={() => void change($, n, { milestone: has ? null : title })}>
                  {title}
                </Button>
              )
            })}
          </Box>
          {(now.issueTypes ?? []).length > 0 && (
            <Box key={`type-row-${n}`} flexDirection="row" gap={1} flexWrap="wrap">
              {row('Type')}
              {(now.issueTypes ?? []).map(name => (
                <Button
                  key={`type-${n}-${name}`}
                  variant={name === issue.type ? 'primary' : undefined}
                  dimColor={name !== issue.type}
                  onPress={() => void change($, n, { type: name === issue.type ? null : name })}
                >
                  {name}
                </Button>
              ))}
            </Box>
          )}
          {otherFields.map(field => {
            const now$ = fieldValues[n]?.[field.name]
            const key = `${n}-${field.id}`
            return (
              <Box key={`field-row-${key}`} flexDirection="row" gap={1} flexWrap="wrap">
                {row(fit(field.name, 9))}
                {field.kind === 'select' || field.kind === 'iteration'
                  ? (field.options ?? []).map(option => (
                      <Button
                        key={`field-${key}-${option.id}`}
                        variant={option.name === now$ ? 'primary' : undefined}
                        dimColor={option.name !== now$}
                        onPress={() => void change($, n, { fields: { [field.name]: option.name === now$ ? null : option.name } })}
                      >
                        {option.name}
                      </Button>
                    ))
                  : Input && (
                      <Input
                        key={`field-${key}`}
                        label=""
                        placeholder={now$ ?? (field.kind === 'date' ? 'YYYY-MM-DD' : field.kind === 'number' ? 'a number' : 'text')}
                        value={typedField[key] ?? ''}
                        submitLabel="set"
                        onInput={text => void update($, typedFields, was => ({ ...was, [key]: text }))}
                        onSubmit={text => {
                          if (!text.trim()) return
                          void update($, typedFields, was => ({ ...was, [key]: '' })).then(() => change($, n, { fields: { [field.name]: text.trim() } }))
                        }}
                      />
                    )}
                {now$ !== undefined && (
                  <Button key={`field-clear-${key}`} dimColor onPress={() => void change($, n, { fields: { [field.name]: null } })}>
                    clear
                  </Button>
                )}
              </Box>
            )
          })}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {row('Close')}
            <Button key={`close-completed-${n}`} dimColor onPress={() => void closeAs('completed')()}>
              as completed
            </Button>
            <Button key={`close-not-planned-${n}`} dimColor onPress={() => void closeAs('not planned')()}>
              as not planned
            </Button>
            {Input && (
              <Input
                key={`duplicate-${n}`}
                label="as duplicate of #"
                placeholder="issue number"
                value={fields.duplicate}
                submitLabel="close"
                onInput={text => void update($, typing, was => ({ ...was, duplicate: text }))}
                onSubmit={text => {
                  const of = Number(text.replace(/^#/, '').trim())
                  if (!Number.isInteger(of) || of < 1 || of === n) return
                  void update($, typing, was => ({ ...was, duplicate: '' }))
                    .then(() => update($, editing, () => null))
                    .then(() => change($, n, { duplicateOf: of }))
                }}
              />
            )}
          </Box>
          {armedClose === n && (
            <Text color="warning" wrap="wrap">{`#${n} is an epic with ${open} open ${open === 1 ? 'sub-issue' : 'sub-issues'}. Closing it leaves them open under a closed epic. Press again to close it anyway.`}</Text>
          )}
        </Box>
      )
    }

    // The card's comments: the latest few, a field to reply in, and Ask Claude to answer, which hands Claude the last
    // comment with how to reply. A reply posted here reads the comments again.
    const conversation = (issue: Issue) => {
      const n = issue.number
      const mine = said?.number === n ? said : null
      const comments = mine?.comments
      const last = comments?.at(-1)
      const reply = (text: string) => {
        if (!text.trim()) return
        void update($, typing, was => ({ ...was, comment: '' }))
          .then(() => change($, n, { comment: text }))
          .then(() => loadComments($, n))
      }
      return (
        <Box key={`talk-${n}`} flexDirection="column" marginTop={1}>
          <Text bold>
            {comments === undefined || comments === null
              ? 'Comments'
              : mine && mine.total > comments.length
                ? `Comments · latest ${comments.length} of ${mine.total}`
                : `Comments · ${comments.length}`}
          </Text>
          {(comments === undefined || comments === null) && <Text dimColor>◌ reading…</Text>}
          {comments?.length === 0 && <Text dimColor>None yet.</Text>}
          {comments?.map((comment, index) => (
            <Box key={`comment-${n}-${index}`} flexDirection="column" marginTop={index > 0 ? 1 : 0}>
              <Text>
                <Text color="suggestion">{`@${comment.author}`}</Text>
                <Text dimColor>{` · ${ago(comment.at, clock)} ago`}</Text>
              </Text>
              <Markdown text={comment.body.length > 800 ? `${comment.body.slice(0, 799)}…` : comment.body || '(empty)'} />
            </Box>
          ))}
          <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
            {Input && (
              <Input
                key={`reply-${n}`}
                label="reply "
                placeholder="write a comment, Enter posts it"
                value={fields.comment}
                submitLabel="post"
                onInput={text => void update($, typing, was => ({ ...was, comment: text }))}
                onSubmit={reply}
              />
            )}
            {last && (
              <Button key={`ask-${n}`} dimColor onPress={() => void $.prompt.submit({ text: answerPrompt(issue, last), asUser: true }).then(() => $.ui.toast(`Asked Claude to answer @${last.author} on #${n}`))}>
                Ask Claude to answer
              </Button>
            )}
          </Box>
        </Box>
      )
    }

    // An opened issue: a card with its labels, its text, its boxes and what to do with it.
    const issueCard = (issue: Issue, hotkeys: boolean) => {
      const step = progress(issue.checks)
      const prose = proseOf(issue.body ?? '')
      // The background agent Start in background set on it, with what it last said.
      const worker = working$.find(one => one.number === issue.number)
      const workerAge = worker ? ago(new Date(worker.startedAt).toISOString(), clock) : ''
      // An epic's card: Next starts its first ready sub-issue.
      const epicNext = (issue.subIssues?.total ?? 0) > 0 ? nextOf(now.issues, issue.number, project) : undefined
      return (
        <Box key={`card-${issue.number}`} flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginLeft={2} marginBottom={1}>
          <Text bold wrap="wrap">
            {issue.title}
          </Text>
          {!kept(issue) && (
            <Text color="warning" wrap="wrap">{`Not under ${filterName}${typed.trim() ? ` or the search` : ''} any more. It leaves the list when you collapse it.`}</Text>
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
            <Text dimColor>{`updated ${ago(issue.updatedAt, clock)} ago`}</Text>
            {issue.parent && <Text dimColor>{`in #${issue.parent.number}`}</Text>}
            {(issue.subIssues?.total ?? 0) > 0 && <Text dimColor>{`epic · ${issue.subIssues?.completed}/${issue.subIssues?.total} sub-issues closed`}</Text>}
            {issue.milestone && <Text dimColor>{`⚑ ${issue.milestone}`}</Text>}
            {(issue.blockedBy ?? []).length > 0 && <Text color="warning">{`blocked by ${issue.blockedBy?.map(number => `#${number}`).join(', ')}`}</Text>}
          </Box>
          {project && (project.status || project.priority) && (
            <Box flexDirection="column" marginTop={1}>
              {project.status && picker(issue, 'status', 'Status  ', project.status.options, issue.status)}
              {project.priority && picker(issue, 'priority', 'Priority', project.priority.options, issue.priority)}
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
                      onPress={() => void flip(issue, index + 1, !check.done)}
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
            const set = Object.entries(fieldValues[issue.number] ?? {}).filter(([name]) => otherFields.some(field => field.name === name))
            return set.length > 0 ? (
              <Text wrap="wrap">
                <Text dimColor>Fields </Text>
                {set.map(([name, value]) => `${name} ${value}`).join(' · ')}
              </Text>
            ) : null
          })()}
          {conversation(issue)}
          {worker && (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                <Text color={workerBadge(worker.status).color}>{`${workerBadge(worker.status).text} `}</Text>
                <Text dimColor>{`a background agent, started ${workerAge === 'now' || workerAge === '' ? 'just now' : `${workerAge} ago`}`}</Text>
              </Text>
              {worker.answer && (
                <Text dimColor wrap="wrap">
                  {worker.answer}
                </Text>
              )}
            </Box>
          )}
          <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
            {launches.some(one => one.number === issue.number && one.how === 'start') ? (
              <Text key={`starting-${issue.number}`} color="claude">
                ▶ Starting…
              </Text>
            ) : startedHere === issue.number ? (
              <Text key={`started-${issue.number}`} color="claude">
                ▶ Started
              </Text>
            ) : (
              <Button key={`start-${issue.number}`} variant="primary" hotkey={hotkeys ? 's' : undefined} onPress={() => void start(issue)}>
                ▶ Start
              </Button>
            )}
            {(worker && ACTIVE.includes(worker.status)) || startedHere === issue.number ? null : launches.some(one => one.number === issue.number && one.how === 'background') ? (
              <Text key={`starting-background-${issue.number}`} color="claude">
                ⚙ Starting in background…
              </Text>
            ) : (
              <Button key={`background-${issue.number}`} hotkey={hotkeys ? 'b' : undefined} onPress={() => void startInBackground($, issue)}>
                ⚙ Start in background
              </Button>
            )}
            {epicNext && (
              <Button key={`next-${issue.number}`} onPress={() => void start(epicNext)}>
                {`▶ Next: #${epicNext.number}`}
              </Button>
            )}
            <Button key={`draft-${issue.number}`} hotkey={hotkeys ? 'e' : undefined} onPress={() => void $.prompt.fill({ text: startPrompt(issue) })}>
              ✎ Edit first
            </Button>
            <Button key={`edit-${issue.number}`} variant={changing === issue.number ? 'primary' : undefined} dimColor={changing !== issue.number} onPress={openEditor(issue.number)}>
              ⚙ Change
            </Button>
            {link(pageOf(now.repo, 'issues', issue))}
            <Button key={`close-${issue.number}`} dimColor hotkey={hotkeys ? 'x' : undefined} onPress={toggle(issue.number)}>
              Collapse
            </Button>
          </Box>
          {changing === issue.number && editor(issue)}
        </Box>
      )
    }

    // Merge all's confirm, while there is still something to merge.
    const confirm = arming && now.prs.length > 0

    return (
      <Box flexDirection="column">
        {topLine}
        {setupPlan}
        {trends}
        {setupCard}
        {draftCard}
        {failure && <Text color="error">{`✗ Last refresh failed: ${failure}`}</Text>}

        {now.prs.length > 0 && (
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              <Text bold color="suggestion">
                Pull requests
              </Text>
              <Text dimColor>{` ${now.prs.length} open`}</Text>
            </Text>
            {!arming && (
              <Button key="close-out-all" dimColor hotkey="m" onPress={arm(true)}>
                {`⇶ Merge all ${now.prs.length}…`}
              </Button>
            )}
          </Box>
        )}
        {confirm && (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text color="warning">{`Finish and merge all ${now.prs.length} open ${now.prs.length === 1 ? 'PR' : 'PRs'}?`}</Text>
            <Button key="close-out-all-yes" variant="primary" hotkey="y" onPress={() => void closeOutAll(now.prs)}>
              Yes, merge them
            </Button>
            <Button key="close-out-all-no" dimColor hotkey="n" onPress={arm(false)}>
              Cancel
            </Button>
          </Box>
        )}
        {now.prs.map(prRow)}
        {watched.map(run => (
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
        ))}

        {(now.milestones ?? []).length > 0 && (
          // The open milestones, release scope: how far along each is, and when it is due.
          <Box key="milestones" flexDirection="column">
            <Text>
              <Text bold color="suggestion">
                Milestones
              </Text>
              <Text dimColor>{` ${(now.milestones ?? []).length} open`}</Text>
            </Text>
            {(now.milestones ?? []).map(one => {
              const total = one.open + one.closed
              const late = one.due !== null && one.due < new Date(clock).toISOString().slice(0, 10) && one.open > 0
              return (
                <Box key={`milestone-${one.number}`} flexDirection="row" justifyContent="space-between">
                  <Text>{fit(one.title, Math.max(12, width - 34))}</Text>
                  <Box flexDirection="row" gap={1}>
                    {meter(one.closed, total, 8)}
                    <Text dimColor>{`${one.closed}/${total}`}</Text>
                    <Text color={late ? 'error' : undefined} dimColor={!late}>
                      {one.due ? (late ? `was due ${one.due}` : `due ${one.due}`) : 'no due date'}
                    </Text>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}

        {issuesHeading}

        {chosen === 'closed' && (
          // The issues closed lately, newest change first, each with how it closed: GitHub's, not the board's copy.
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
        )}
        {chosen !== 'closed' && shown.length === 0 && (
          <Box flexDirection="column" alignItems="center">
            <Text color="success">✓</Text>
            <Text dimColor>{typed.trim() ? `Nothing under ${filterName} matches “${typed.trim()}”.` : `Nothing open under ${filterName}.`}</Text>
          </Box>
        )}
        {triaging && (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text color={triaged.asking ? 'warning' : undefined} dimColor={!triaged.asking}>
              {triaged.asking ? '◌ Claude is suggesting a Priority, area and Status for each…' : '✦ Claude suggests a Priority, area and Status for each. Change any, then accept.'}
            </Text>
            {!triaged.asking && shown.length > 0 && (
              <Button key="triage-again" dimColor onPress={() => void suggestAgain($)}>
                Suggest again
              </Button>
            )}
          </Box>
        )}
        {triaging && triaged.failed && <Text color="error" wrap="wrap">{`Couldn't get suggestions: ${triaged.failed}`}</Text>}
        {triaging &&
          shown.map(issue => (
            <Box key={`triage-entry-${issue.number}`} flexDirection="column">
              {isInbox(issue) ? triageRow(issue) : issueRow(issue)}
              {open.includes(issue.number) && issueCard(issue, single)}
            </Box>
          ))}
        {groups.map(group => {
          const count = String(group.issues.length)
          const shut = group.folded && !opened.includes(group.key)
          // A folded group, such as Backlog, is a heading the person opens; open, its heading folds it again.
          const fold = () => void update($, unfolded, list => (list.includes(group.key) ? list.filter(one => one !== group.key) : [...list, group.key]))
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
                  const next = nextOf(now.issues, epic.number, project)
                  const closed = `${epic.completed}/${epic.total} closed`
                  return (
                    <Box flexDirection="row" justifyContent="space-between">
                      <Text>
                        <Text bold color="claude">
                          {fit(group.title, Math.max(12, width - 12 - cells(closed) - (next ? 10 : 0) - 5 - count.length))}
                        </Text>
                        <Text dimColor>{` ${count}`}</Text>
                      </Text>
                      <Box flexDirection="row" gap={1}>
                        {meter(epic.completed, epic.total, 10)}
                        <Text dimColor>{closed}</Text>
                        {next && (
                          <Button key={`next-${epic.number}`} dimColor hover={{ dimColor: false, color: 'claude' }} onPress={() => void start(next)}>
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
                    {issueRow(issue)}
                    {open.includes(issue.number) && issueCard(issue, single)}
                  </Box>
                ))}
            </Box>
          )
        })}

        <Box>
          <Text dimColor>
            {confirm
              ? 'y merge every open PR · n cancel'
              : revised
                ? 'tab next field · ⏎ in the body adds a line · esc cancel the edit'
                : single
                  ? 's start · e edit first · x or esc collapse · press a box to tick it · r refresh'
                  : `${project ? '1 now · 2 later' : '1 active · 2 future'} · 3 bugs · 4 mine · 5 all${project ? ' · 6 inbox' : ''} · 7 closed · r refresh · ⏎ open an issue${now.prs.length > 0 ? ' · m merge all PRs' : ''}${made ? ' · c create the issue · e edit it' : ''}`}
          </Text>
        </Box>
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
    const text = [now && summary(now.issues, now.prs), note].filter(Boolean).join(' · ')
    if (!text) return next(e)

    return next({ ...e, props: { ...e.props, tail: e.props.tail ? `${e.props.tail} · ${text}` : text } })
  })

  // The band above the prompt is for what needs the person now (something to fix, merge, tick or look at) and the work
  // going on out of sight, in background agents. It shows nothing otherwise. The main session's progress (the issue
  // Claude is on, CI running) is the pane's: the band doesn't repeat it. Every line is one row at any width.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
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
    // Background agents still at work. One that ended drops out: the conversation line and Claude's handoff say so.
    const agents = (await read($, workers)).filter(one => ACTIVE.includes(one.status))
    if (problems.length === 0 && alerts.length === 0 && offers.length === 0 && agents.length === 0) return next(e)

    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    // A link on one line, as in the pane: an ellipsis where the row is short of room.
    const link = (href: string, label = '↗ GitHub') => (
      <Text wrap="truncate-end">
        <Link href={href} label={label} />
      </Text>
    )
    const clock = Date.now()
    const repo = now?.repo ?? ''
    const dismiss = (alert: Alert) => async () => {
      await update($, dismissed, list => [...list.slice(-50), alert.key])
      if (alert.kind === 'closed') await update($, working, () => null)
      await save($)
    }
    // A button that hands Claude a pull request: into the prompt box while Claude is busy, sent otherwise.
    const hand = (text: string) => (e.props.isWorking ? $.prompt.fill({ text }) : $.prompt.submit({ text, asUser: true }))

    const line = (alert: Alert) => {
      switch (alert.kind) {
        case 'ci': {
          const { pr } = alert
          const names = pr.failing ?? []
          return (
            <Box flexDirection="row" gap={1}>
              <Text color="error" inverse bold>
                {' ✗ CI '}
              </Text>
              <Text>
                <Text color="suggestion" bold>{`#${pr.number} `}</Text>
                <Text>{fit(pr.title, Math.max(12, width - 44))}</Text>
                <Text dimColor>{` ${names.length > 0 ? fit(names.join(', '), 24) : 'failing'} on ${fit(pr.branch, 20)}`}</Text>
              </Text>
              <Button key={`fix-${pr.number}`} variant="primary" onPress={() => void hand(fixPrompt(pr))}>
                Fix
              </Button>
              {link(pageOf(repo, 'pull', pr))}
              <Button key={`dismiss-${alert.key}`} dimColor onPress={() => void dismiss(alert)()}>
                ✕
              </Button>
            </Box>
          )
        }
        case 'pass': {
          const { pr } = alert
          return (
            <Box flexDirection="row" gap={1}>
              <Text color="success" inverse bold>
                {' ✓ CI '}
              </Text>
              <Text>
                <Text color="suggestion" bold>{`#${pr.number} `}</Text>
                <Text>{fit(pr.title, Math.max(12, width - 57))}</Text>
                <Text dimColor>{` passed on ${fit(pr.branch, 20)}`}</Text>
              </Text>
              <Button key={`merge-${pr.number}`} variant="primary" onPress={() => void hand(closeOutPrompt(pr))}>
                Finish & merge
              </Button>
              {link(pageOf(repo, 'pull', pr))}
              <Button key={`dismiss-${alert.key}`} dimColor onPress={() => void dismiss(alert)()}>
                ✕
              </Button>
            </Box>
          )
        }
        case 'activity': {
          const { issue } = alert
          return (
            <Box flexDirection="row" gap={1}>
              <Text color="warning" inverse bold>
                {' ● NEW '}
              </Text>
              <Text>
                <Text color="claude" bold>{`#${issue.number} `}</Text>
                <Text>{fit(issue.title, Math.max(12, width - 44))}</Text>
                <Text dimColor>{` changed ${ago(issue.updatedAt, clock)} ago`}</Text>
              </Text>
              {link(pageOf(repo, 'issues', issue))}
              <Button key={`dismiss-${alert.key}`} dimColor onPress={() => void dismiss(alert)()}>
                ✕
              </Button>
            </Box>
          )
        }
        case 'closed':
          return (
            <Box flexDirection="row" gap={1}>
              <Text color="success" inverse bold>
                {' ✓ DONE '}
              </Text>
              <Text>
                <Text color="claude" bold>{`#${alert.working.number} `}</Text>
                <Text>{fit(alert.working.title, Math.max(12, width - 30))}</Text>
                <Text dimColor> is closed</Text>
              </Text>
              <Button key={`dismiss-${alert.key}`} dimColor onPress={() => void dismiss(alert)()}>
                ✕
              </Button>
            </Box>
          )
      }
    }

    const offerLine = ({ task, box }: { task: BoxTask; box: number }) => (
      <Box key={`offer-${task.id}`} flexDirection="row" gap={1}>
        <Text color="success" inverse bold>
          {' ☑ TICK? '}
        </Text>
        <Text>
          <Text color="claude" bold>{`#${task.number} `}</Text>
          <Text dimColor>{`box ${box} `}</Text>
          <Text>{fit(task.text, Math.max(12, width - 52))}</Text>
          <Text dimColor> is done</Text>
        </Text>
        <Button key={`tick-task-${task.id}`} variant="primary" onPress={() => void tickTask($, task)}>
          {`Tick box ${box}`}
        </Button>
        <Button key={`skip-task-${task.id}`} dimColor onPress={() => void update($, tasks, list => list.filter(one => one.id !== task.id))}>
          ✕
        </Button>
      </Box>
    )

    // Something missing: what it is, the command or page that fixes it, and a look again once it's done.
    const problemLine = (problem: Problem) => {
      const how = problem.command ? `run ${problem.command}` : problem.fix
      return (
        <Box key={`problem-row-${problem.id}`} flexDirection="row" gap={1}>
          <Text color={problem.blocks ? 'error' : 'warning'} inverse bold>
            {' ⚠ SETUP '}
          </Text>
          <Text>
            <Text>{fit(problem.title, Math.max(16, width - 64))}</Text>
            <Text dimColor>{` · ${fit(how, 32)}`}</Text>
          </Text>
          {problem.command && (
            <Button key={`copy-fix-${problem.id}`} variant="primary" onPress={press => void copyFix($, problem, press.surface)}>
              Copy command
            </Button>
          )}
          {problem.url && !problem.command && link(problem.url, '↗ Open page')}
          <Button key={`recheck-${problem.id}`} dimColor onPress={() => void recheck($)}>
            Check again
          </Button>
          <Button key={`dismiss-${accessKey(problem)}`} dimColor onPress={() => void dismissProblem($, problem)}>
            ✕
          </Button>
        </Box>
      )
    }

    // A background agent at work: `⚙ #90 <title> · working · ━━━━━━ 0/4`, the bar only when the issue has boxes.
    const agentLine = (worker: Worker) => {
      const issue = now?.issues.find(one => one.number === worker.number)
      const step = issue ? progress(issue.checks) : { done: 0, total: 0 }
      const badge = workerBadge(worker.status)
      const word = badge.text.replace(/^⚙ /, '')
      const [filled, empty] = step.total > 0 ? bar(step, 6) : ['', '']
      const count = step.total > 0 ? ` ${step.done}/${step.total}` : ''
      const tail = ` · ${word}${step.total > 0 ? ` · ${filled}${empty}${count}` : ''}`
      const head = `⚙ #${worker.number} `
      const title = fit(issue?.title ?? worker.title ?? '', Math.max(0, width - cells(head) - cells(tail) - 1))
      return (
        <Box key={`agent-row-${worker.agentId}`} flexDirection="row">
          <Text wrap="truncate-end">
            <Text color={badge.color} bold>
              ⚙
            </Text>
            <Text color="claude" bold>{` #${worker.number} `}</Text>
            <Text>{title}</Text>
            <Text dimColor>{' · '}</Text>
            <Text color={badge.color}>{word}</Text>
            {step.total > 0 && (
              <Text>
                <Text dimColor>{' · '}</Text>
                <Text color={tone(step)}>{filled}</Text>
                <Text color="inactive" dimColor>
                  {empty}
                </Text>
                <Text dimColor>{count}</Text>
              </Text>
            )}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {problems.slice(0, 2).map(problemLine)}
        {alerts.slice(0, 3).map(line)}
        {offers.slice(0, 3).map(offerLine)}
        {agents.slice(0, 3).map(agentLine)}
      </Box>
    )
  })
}
