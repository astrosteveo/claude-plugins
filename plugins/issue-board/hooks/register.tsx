import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register, Timer, UiCopyArgs } from 'claude-code'

import type { Alert, Board, Draft, Filter, GroupBy, Issue, Problem, Project, PullRequest, SavedSetup, Setup, SetupProject, SetupStep, Working } from '../types'
import { authOf, problemsOf, problemsText, repoOf } from './access'
import { ADD_ITEM, SET_FIELD, issuesQuery, optionOf, startedOf } from './project'
import {
  CREATE_FIELD,
  CREATE_PROJECT,
  FACTS_QUERY,
  ITEMS_QUERY,
  PRIORITIES,
  PROJECT_QUERY,
  UPDATE_FIELD,
  areasOf,
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
  WEEKS,
  ago,
  alertsOf,
  areaOf,
  bar,
  boardText,
  cells,
  checksOf,
  chipsOf,
  ciBadge,
  closeOutAllPrompt,
  closeOutPrompt,
  draftPrompt,
  fit,
  fixPrompt,
  greenKey,
  groupsOf,
  hex,
  isBug,
  nextOf,
  issueText,
  labelsOf,
  nextPageOf,
  pad,
  pageOf,
  proseOf,
  matches,
  parseDraft,
  parseGraph,
  parseIssues,
  parsePrs,
  prText,
  prsFor,
  progress,
  reviewBadge,
  searched,
  since,
  spark,
  startPrompt,
  sumProgress,
  summary,
  tickBody,
  timesOf,
  tone,
  weekly,
  wentGreen,
  workingSection,
} from './parse'

const PANE = 'issue-board'
const REFRESH_MS = 5 * 60 * 1000
// While a pull request's CI runs, the board looks again this often, so its pass or failure shows soon after.
const WATCH_MS = 30 * 1000
const GH_WRITE = /\bgh\s+(issue|pr)\s+(create|edit|close|reopen|merge|comment|ready|review)\b/
// `gh issue close 35`, the issue it closes.
const CLOSE = /\bgh\s+issue\s+close\s+#?(\d+)\b/
// Commands that may leave the folder on another branch.
const GIT_MOVE = /\bgit\s+(checkout|switch|worktree)\b|\bgh\s+pr\s+checkout\b/
const ISSUE_FIELDS = 'number,title,url,labels,assignees,body,updatedAt'
const ISSUES_TOOL = 'mcp__issue-board__issues'
const TICK_TOOL = 'mcp__issue-board__tick'

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
const openPr = atom({ plugin: 'issue-board', key: 'openPr' } as const, null)
const access = atom({ plugin: 'issue-board', key: 'access' } as const, null)
const groupBy = atom({ plugin: 'issue-board', key: 'groupBy' } as const, null)
const unfolded = atom({ plugin: 'issue-board', key: 'unfolded' } as const, [])
const setup = atom({ plugin: 'issue-board', key: 'setup' } as const, null)

// The filters; with a project, the first two read Priority and say so.
const FILTERS: { id: Filter; label: string; planned: string; hotkey: string }[] = [
  { id: 'active', label: 'Active', planned: 'Now', hotkey: '1' },
  { id: 'future', label: 'Future', planned: 'Later', hotkey: '2' },
  { id: 'bugs', label: 'Bugs', planned: 'Bugs', hotkey: '3' },
  { id: 'mine', label: 'Mine', planned: 'Mine', hotkey: '4' },
  { id: 'all', label: 'All', planned: 'All', hotkey: '5' },
]

const GROUPINGS: { id: GroupBy; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'epic', label: 'Epic' },
  { id: 'area', label: 'Area' },
]

const gh = async ($: EngineInterface, args: string[], stdin?: string): Promise<string> => {
  const { exitCode, stdout, stderr } = await $.process.run(['gh', ...args], { timeoutMs: 60_000, ...(stdin === undefined ? {} : { stdin }) })
  if (exitCode !== 0) throw new Error(stderr.trim().split('\n')[0] || `gh ${args[0]} exited ${exitCode}`)
  return stdout
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

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

// The next refresh: soon while a pull request's CI runs, every five minutes otherwise. Each refresh sets the next one.
let timer: Timer | undefined
const schedule = ($: EngineInterface, now: Board | null): void => {
  timer?.cancel()
  const watching = now?.prs.some(pr => pr.ci === 'pending') ?? false
  timer = $.clock.after(watching ? WATCH_MS : REFRESH_MS, () => void refresh($))
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

// A new session paints the last board at once and still knows the issue Claude was on; a reload keeps its own.
const restore = async ($: EngineInterface): Promise<void> => {
  if ((await read($, board)) !== null) return
  try {
    const saved = (await $.store.get(await keyOf($))) as Partial<Saved> | undefined
    if (!saved) return
    if (saved.board) await update($, board, () => saved.board ?? null)
    if (saved.working) await update($, working, () => saved.working ?? null)
    if (saved.dismissed) await update($, dismissed, () => saved.dismissed ?? [])
    if (saved.viewer) await update($, viewer, () => saved.viewer ?? null)
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
const fetchIssues = async ($: EngineInterface, nameWithOwner: string): Promise<{ issues: Issue[]; project: Project | null }> => {
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

// `seen`: the refresh follows Claude's own gh write, so the issue it is on changed by its hand, not news.
const refresh = async ($: EngineInterface, seen = false): Promise<void> => {
  if (await read($, loading)) return
  await update($, loading, () => true)
  const before = await read($, board)
  let after = before
  try {
    const from = since(Date.now())
    const known = await read($, viewer)
    // First, so a folder that isn't a GitHub repo stops at one call, and a repo with issues turned off skips them.
    const repo = JSON.parse(await gh($, ['repo', 'view', '--json', 'nameWithOwner,hasIssuesEnabled'])) as { nameWithOwner: string; hasIssuesEnabled: boolean }
    const listIssues = (args: string[]) => (repo.hasIssuesEnabled ? gh($, ['issue', 'list', ...args]) : Promise.resolve('[]'))
    const [graph, prs, closed, merged, login, current] = await Promise.all([
      repo.hasIssuesEnabled ? fetchIssues($, repo.nameWithOwner) : Promise.resolve({ issues: [], project: null }),
      gh($, [
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        '50',
        '--json',
        'number,title,url,author,headRefName,headRefOid,isDraft,statusCheckRollup,reviewDecision,additions,deletions,updatedAt,body,closingIssuesReferences',
      ]),
      listIssues(['--state', 'closed', '--search', `closed:>=${from}`, '--limit', '500', '--json', 'closedAt']),
      gh($, ['pr', 'list', '--state', 'merged', '--search', `merged:>=${from}`, '--limit', '500', '--json', 'mergedAt']),
      // Who Mine means: asked once, then kept.
      known ?? gh($, ['api', 'user', '--jq', '.login']).then(out => out.trim() || null, () => null),
      currentBranch($),
    ])
    const fetchedAt = Date.now()
    const next: Board = {
      repo: repo.nameWithOwner,
      issues: graph.issues,
      prs: parsePrs(prs),
      velocity: { closed: weekly(timesOf(closed, 'closedAt'), fetchedAt), merged: weekly(timesOf(merged, 'mergedAt'), fetchedAt) },
      fetchedAt,
      project: graph.project,
    }
    after = next
    await update($, board, () => next)
    if (login !== known) await update($, viewer, () => login)
    await update($, branch, () => current)
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
    // GitHub answers again: look again too, so a problem fixed since the last check goes.
    if (((await read($, access))?.problems.length ?? 0) > 0) void checkAccess($)
  } catch (cause) {
    const message = messageOf(cause)
    await update($, error, () => message)
    void checkAccess($, message)
  } finally {
    await update($, loading, () => false)
    schedule($, after)
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
// time: two presses in a row would otherwise each write the body the other read.
let ticking: Promise<unknown> = Promise.resolve()
const tick = ($: EngineInterface, number: number, boxes: number[], done: boolean): Promise<string> => {
  const run = ticking.then(async () => {
    const raw = JSON.parse(await gh($, ['issue', 'view', String(number), '--json', 'body'])) as { body: string | null }
    const edit = tickBody(raw.body ?? '', boxes, done)
    const total = checksOf(raw.body).length
    if (edit.missing.length > 0) throw new Error(`#${number} has ${total} ${total === 1 ? 'box' : 'boxes'}, so there is no box ${edit.missing.join(', ')}`)
    if (edit.changed.length > 0) await gh($, ['issue', 'edit', String(number), '--body-file', '-'], edit.body)
    const [fresh] = parseIssues(`[${await gh($, ['issue', 'view', String(number), '--json', ISSUE_FIELDS])}]`)
    if (fresh) await take($, fresh)
    const step = progress(checksOf(edit.body))
    const tally = `#${number} has ${step.done}/${step.total} ticked.`
    if (edit.changed.length === 0) return `Nothing changed: ${boxes.length === 1 ? 'that box was' : 'those boxes were'} already ${done ? 'ticked' : 'unticked'}. ${tally}`
    return `${done ? 'Ticked' : 'Unticked'} ${edit.changed.length === 1 ? 'box' : 'boxes'} ${edit.changed.join(', ')}. ${tally}`
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

// Creates the draft: the issue, or an epic's parent then each sub-issue under it. Each joins the repo's project, so it
// shows under its Status at once, whether or not the project adds new issues by itself.
const fileDraft = async ($: EngineInterface, made: Draft): Promise<void> => {
  try {
    const number = await createIssue($, made)
    const children: number[] = []
    for (const child of made.children ?? []) children.push(await createIssue($, child, number))
    await update($, draft, () => null)
    const project = (await read($, board))?.project
    if (project) {
      for (const one of [number, ...children]) {
        const { id } = JSON.parse(await gh($, ['issue', 'view', String(one), '--json', 'id'])) as { id: string }
        await gh($, ['api', 'graphql', '-f', `query=${ADD_ITEM}`, '-f', `project=${project.id}`, '-f', `content=${id}`])
      }
    }
    $.ui.toast(children.length > 0 ? `Created epic #${number} with ${children.length} sub-issues` : `Created #${number}`)
    void refresh($)
  } catch (cause) {
    $.ui.toast(`Couldn't create the issue: ${messageOf(cause)}`)
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
const setField = async ($: EngineInterface, issue: Issue, field: 'status' | 'priority', name: string): Promise<void> => {
  const project = (await read($, board))?.project
  const target = field === 'status' ? project?.status : project?.priority
  const option = optionOf(target, name)
  if (!project || !target || !option) throw new Error(`the project has no ${field === 'status' ? 'Status' : 'Priority'} called ${name}`)
  let item = issue.item ?? null
  if (!item) {
    if (!issue.id) throw new Error(`#${issue.number} hasn't been read with its project yet; refresh and try again`)
    const added = JSON.parse(await gh($, ['api', 'graphql', '-f', `query=${ADD_ITEM}`, '-f', `project=${project.id}`, '-f', `content=${issue.id}`])) as {
      data?: { addProjectV2ItemById?: { item?: { id?: string } | null } | null }
    }
    item = added.data?.addProjectV2ItemById?.item?.id ?? null
    if (!item) throw new Error(`couldn't add #${issue.number} to ${project.title}`)
  }
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
        'With `number`, that issue in full as the board has it: labels, assignees and its task-list boxes, numbered as the tick tool counts them. ' +
        "Read an issue's whole text with `gh issue view`.",
      inputSchema: {
        type: 'object',
        properties: {
          number: { type: 'integer', description: 'One issue or pull request to show in full.' },
          filter: {
            type: 'string',
            enum: ['active', 'future', 'bugs', 'mine', 'all'],
            description:
              "Which issues to list: active, future, bugs, mine (assigned to the signed-in user) or all, the default. With the repo's GitHub Project, active is Now (Priority P0 and P1) and future is Later (P2); without one, future means labelled future.",
          },
          area: { type: 'string', description: 'Only issues with this area: label, such as "simulation".' },
          query: { type: 'string', description: 'Only issues whose title, number or labels hold every word of this.' },
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
    // Earlier versions pinned the summary to the status line; a reload would leave it there.
    $.ui.status(undefined)
    await restore($)
    void checkAccess($)
    void refresh($)

    return next(e)
  })

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
    const folding = (await read($, expanded)).length > 0 || (await read($, openPr)) !== null
    if (!folding) return next(e)
    await update($, expanded, () => [])
    await update($, openPr, () => null)
    return { value: undefined }
  })

  // The model filing, editing or merging through gh: show the change straight away. A checkout moves the branch marker.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = (e as { command?: unknown }).command
    if (typeof command === 'string' && GH_WRITE.test(command)) void refresh($, true)
    else if (typeof command === 'string' && GIT_MOVE.test(command)) void currentBranch($).then(now => update($, branch, () => now))

    return ran
  })

  on('tool.call', { tool: ISSUES_TOOL }, async ($, e) => {
    const input = e as unknown as { number?: number; filter?: Filter; area?: string; query?: string }
    if ((await read($, board)) === null) await refresh($)
    const now = await read($, board)
    if (!now) {
      const failure = (await read($, error)) ?? 'unknown error'
      const problems = await checkAccess($, failure)
      return { deny: `The issue board couldn't read GitHub: ${failure}${problems.length > 0 ? `\n${problemsText(problems)}` : ''}` }
    }

    if (typeof input.number === 'number') {
      const issue = now.issues.find(one => one.number === input.number)
      if (issue) return { result: issueText(issue) }
      const pr = now.prs.find(one => one.number === input.number)
      if (pr) return { result: `${prText(pr)}\nRead it in full with \`gh pr view ${pr.number}\`.` }
      return { result: `#${input.number} isn't open on the board. It may be closed: try \`gh issue view ${input.number}\`.` }
    }
    const chosen = input.filter ?? 'all'
    const who = await read($, viewer)
    const area = input.area?.replace(/^area:/, '')
    const project = now.project ?? null
    const kept = groupsOf(
      now.issues.filter(issue => matches(chosen, issue, who, project) && (!area || areaOf(issue) === area) && (!input.query || searched(input.query, issue))),
      project ? 'status' : 'area',
      project,
    ).flatMap(group => group.issues)
    const label = project && (chosen === 'active' || chosen === 'future') ? (chosen === 'active' ? 'now: P0 and P1' : 'later: P2') : chosen
    return { result: boardText(now, kept, label, Date.now()) }
  })

  on('tool.call', { tool: TICK_TOOL }, async ($, e) => {
    const input = e as unknown as { number?: unknown; boxes?: unknown; done?: unknown }
    const { number, boxes } = input
    if (typeof number !== 'number' || !Array.isArray(boxes) || boxes.length === 0 || !boxes.every(box => Number.isInteger(box))) {
      return { deny: 'Give the issue number and the boxes to tick, counted from 1.' }
    }
    try {
      return { result: await tick($, number, boxes as number[], input.done !== false) }
    } catch (cause) {
      const message = messageOf(cause)
      const problems = ACCESS_ERROR.test(message) ? await checkAccess($, message) : []
      return { deny: `Couldn't tick boxes on #${number}: ${message}${problems.length > 0 ? `\n${problemsText(problems)}` : ''}` }
    }
  })

  // Reading the board changes nothing, so it needs no permission prompt; a rule that denies it still stands.
  on('tool.check', { tool: ISSUES_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    return verdict.decision === 'ask' ? { decision: 'allow' as const } : verdict
  })

  // Closing an epic whose sub-issues are still open asks the person first, whatever their rules allow: the sub-issues
  // would stay open under a closed parent. A rule that denies the command still stands.
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
    return { decision: 'ask' as const, reason: `${epics.join('; ')}. Closing it leaves them open under a closed epic.` }
  })

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
    const shownPr = await read($, openPr)
    const planned = await read($, setup)
    const picked = await read($, groupBy)
    const opened = await read($, unfolded)
    const clock = Date.now()
    const elements = $.ui.resolve(e)
    const Input = 'Input' in elements ? elements.Input : undefined
    const Markdown = elements.Markdown

    const start = async (issue: Issue) => {
      const sessionId = await $.session.id().catch(() => undefined)
      await update($, working, () => ({ number: issue.number, title: issue.title, updatedAt: issue.updatedAt, ...(sessionId ? { sessionId } : {}) }))
      await save($)
      await $.prompt.submit({ text: startPrompt(issue), asUser: true })
      $.ui.toast(`Sent #${issue.number} to Claude`)
      await claim($, issue)
    }

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
      if (opening) await $.ui.scroll({ to: { key: `card-${number}` }, in: PANE }).catch(() => undefined)
    }
    const togglePr = (number: number) => () => void update($, openPr, was => (was === number ? null : number))

    // A section's heading: its name, a rule across the pane, and what sits at its right.
    const rule = (title: string, right: string, color = 'claude') => (
      <Box flexDirection="row" marginTop={1}>
        <Text bold color={color}>
          {title}
        </Text>
        <Text dimColor>{` ${'─'.repeat(Math.max(1, width - [...title].length - [...right].length - 2))} `}</Text>
        <Text dimColor>{right}</Text>
      </Box>
    )

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
              {chosenProject && <Link href={chosenProject.url} label="↗ GitHub" />}
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
            {manual.length > 0 && (
              <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
                <Text color="warning" wrap="wrap">{`Turn on by hand, in the project's Workflows settings: ${manual.join(', ')}.`}</Text>
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
    const named = FILTERS.find(one => one.id === chosen)
    const filterName = (project ? named?.planned : named?.label) ?? ''
    const bugs = now.issues.filter(isBug).length
    const failing = now.prs.filter(pr => pr.ci === 'fail').length
    const overall = sumProgress(shown)

    const stat = (glyph: string, color: string, value: number, label: string) => (
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
    const trend = (label: string, color: string, counts: number[]) => (
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
      <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
        <Text bold color="claude">
          Issues
        </Text>
        {FILTERS.map(one => (
          <Button
            key={`filter-${one.id}`}
            hotkey={one.hotkey}
            variant={one.id === chosen ? 'primary' : undefined}
            dimColor={one.id !== chosen}
            onPress={() => void update($, filter, () => one.id)}
          >
            {`${project ? one.planned : one.label} ${now.issues.filter(issue => matches(one.id, issue, who, project)).length}`}
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

    // The issue Claude is on, with how far along it is, and the pull request for it with that pull request's CI.
    const workingIssue = doing ? now.issues.find(issue => issue.number === doing.number) : undefined
    const workingStep = workingIssue && progress(workingIssue.checks)
    const workingPr = workingIssue && now.prs.find(pr => (pr.issues ?? []).includes(workingIssue.number))
    const workingLine = workingIssue && workingStep && (
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text color="claude" bold>
          ▶ Working on
        </Text>
        <Text color="claude">{`#${workingIssue.number}`}</Text>
        <Text>{fit(workingIssue.title, Math.max(12, width - (workingPr ? 52 : 34)))}</Text>
        {workingStep.total > 0 && (
          <Text>
            {meter(workingStep.done, workingStep.total, 8)}
            <Text dimColor>{` ${workingStep.done}/${workingStep.total}`}</Text>
          </Text>
        )}
        {workingPr && (
          <Text>
            <Text dimColor>· </Text>
            <Text color="suggestion" bold>{`PR #${workingPr.number} `}</Text>
            <Text color={ciBadge[workingPr.ci].color}>{ciBadge[workingPr.ci].text.trim()}</Text>
          </Text>
        )}
      </Box>
    )

    // The issue /issues new drafted, to check and file.
    const draftCard = thinking ? (
      <Box marginTop={1}>
        <Text color="warning">◌ Drafting an issue from the conversation…</Text>
      </Box>
    ) : (
      made && (
        <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} marginTop={1}>
          <Text color="suggestion" bold>
            {made.children ? `New epic · draft · ${made.children.length} sub-issues` : 'New issue · draft'}
          </Text>
          <Text bold wrap="wrap">
            {made.title}
          </Text>
          {made.labels.length > 0 && <Text dimColor>{made.labels.join(' · ')}</Text>}
          <Box marginTop={1}>
            <Markdown text={made.body} />
          </Box>
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
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button key="draft-file" variant="primary" hotkey="c" onPress={() => void fileDraft($, made)}>
              {made.children ? `✚ Create the epic and ${made.children.length} sub-issues` : '✚ Create issue'}
            </Button>
            <Button key="draft-discard" dimColor onPress={() => void update($, draft, () => null)}>
              Discard
            </Button>
          </Box>
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
      const titleRoom = width - [...badge.text].length - String(pr.number).length - 3 - (review ? 2 : 0) - (mine ? 2 : 0) - (forText ? forText.length + 1 : 0) - right
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
              <Link href={pageOf(now.repo, 'pull', pr)} label="↗ GitHub" />
            </Box>
          )}
        </Box>
      )
    }

    // A priority as a short tag, the most pressing in the loudest color.
    const priorityColor = (priority: string) => {
      const rank = project?.priority?.options.findIndex(option => option.name === priority) ?? -1
      return rank === 0 ? 'error' : rank === 1 ? 'warning' : 'inactive'
    }

    // One issue on one line: its progress, priority, number, title, its pull request with CI, chips and age; the title
    // opens it.
    const issueRow = (issue: Issue) => {
      const isOpen = open.includes(issue.number)
      const step = progress(issue.checks)
      const bug = isBug(issue)
      const chips = roomy ? chipsOf(issue).slice(0, 2) : []
      const age = ago(issue.updatedAt, clock)
      const count = step.total > 0 ? `${step.done}/${step.total}`.padEnd(5) : '     '
      const linked = prsFor(issue, now.prs)[0]
      const pr = linked ? `⇄ #${linked.number} ${ciBadge[linked.ci].text.trim().split(' ')[0]}` : ''
      const tag = project && issue.priority ? `${fit(issue.priority, 3)} ` : ''
      // The open issue it waits on, if any: the first, and how many more.
      const blockers = issue.blockedBy ?? []
      const blocked = blockers.length > 0 ? `⛔ #${blockers[0]}${blockers.length > 1 ? ` +${blockers.length - 1}` : ''}` : ''
      const right =
        chips.reduce((sum, chip) => sum + cells(chip.name) + 3, 0) + age.padStart(3).length + (pr ? cells(pr) + 1 : 0) + (blocked ? cells(blocked) + 1 : 0)
      const left = 6 + 1 + 5 + 1 + (bug ? 2 : 0) + tag.length + String(issue.number).length + 2
      const [filled, empty] = bar(step, 6)
      return (
        <Box key={`row-${issue.number}`} flexDirection="row" justifyContent="space-between">
          {!isOpen && peek(issue)}
          <Box flexDirection="row">
            <Text color={tone(step)}>{filled}</Text>
            <Text color="inactive" dimColor>
              {empty}
            </Text>
            <Text color={tone(step)} dimColor={step.total === 0}>{` ${count} `}</Text>
            {bug && <Text color="error">▲ </Text>}
            {tag && <Text color={priorityColor(issue.priority ?? '')}>{tag}</Text>}
            <Text color={isOpen ? 'claude' : undefined} dimColor={!isOpen} hover={{ dimColor: false, color: 'claude' }}>
              {`#${issue.number} `}
            </Text>
            <Button key={`issue-${issue.number}`} plain hover={{ bold: true }} onPress={toggle(issue.number)}>
              {fit(issue.title, width - left - right - 1)}
            </Button>
          </Box>
          <Box flexDirection="row" gap={1}>
            {blocked && <Text color="warning">{blocked}</Text>}
            {linked && <Text color={ciBadge[linked.ci].color}>{pr}</Text>}
            {chips.map(chip => (
              <Text>
                <Text color={hex(chip)}>●</Text>
                <Text dimColor>{` ${chip.name}`}</Text>
              </Text>
            ))}
            <Text dimColor>{age.padStart(3)}</Text>
          </Box>
        </Box>
      )
    }

    // What hovering a row shows above it: the title, how far along, and the boxes still open.
    // Every line is padded to the card's width, its margins spaces rather than paddingX, so it covers the rows it is
    // painted over: the surface paints a floating box's text and border but leaves its padding showing what is beneath.
    // It sits at the pane's right, leaving the rows above their bar, number and the start of their title, so the
    // pointer moving up the list reaches the row above rather than the card. A pane without that room shows none.
    const PEEK_CLEAR = 28
    const peek = (issue: Issue) => {
      const step = progress(issue.checks)
      const cardWidth = Math.min(56, width - PEEK_CLEAR)
      if (cardWidth < 30) return null
      const inner = cardWidth - 4
      const todo = issue.checks.filter(check => !check.done)
      const listed = todo.slice(0, 4)
      const lines: { text: string; color?: string; dim?: boolean; bold?: boolean }[] = [
        { text: fit(issue.title, inner), bold: true },
        step.total === 0
          ? { text: 'No acceptance boxes.', dim: true }
          : { text: `${step.done}/${step.total} ticked · ${todo.length} to go`, color: tone(step) },
        ...listed.map(check => ({ text: fit(`☐ ${check.text}`, inner) })),
        ...(todo.length > listed.length ? [{ text: `+${todo.length - listed.length} more`, dim: true }] : []),
        { text: '⏎ open · ▶ Start inside', dim: true },
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

    // An opened issue: a card with its labels, its text, its boxes and what to do with it.
    const issueCard = (issue: Issue, hotkeys: boolean) => {
      const step = progress(issue.checks)
      const prose = proseOf(issue.body ?? '')
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
                  <Text color={check.done ? 'success' : 'warning'}>{check.done ? '✔ ' : '☐ '}</Text>
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
              ))}
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text dimColor italic>
                No acceptance boxes in this issue.
              </Text>
            </Box>
          )}
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button key={`start-${issue.number}`} variant="primary" hotkey={hotkeys ? 's' : undefined} onPress={() => void start(issue)}>
              ▶ Start
            </Button>
            {epicNext && (
              <Button key={`next-${issue.number}`} onPress={() => void start(epicNext)}>
                {`▶ Next: #${epicNext.number}`}
              </Button>
            )}
            <Button key={`draft-${issue.number}`} hotkey={hotkeys ? 'e' : undefined} onPress={() => void $.prompt.fill({ text: startPrompt(issue) })}>
              ✎ Edit first
            </Button>
            <Link href={pageOf(now.repo, 'issues', issue)} label="↗ GitHub" />
            <Button key={`close-${issue.number}`} dimColor hotkey={hotkeys ? 'x' : undefined} onPress={toggle(issue.number)}>
              Collapse
            </Button>
          </Box>
        </Box>
      )
    }

    const single = open.filter(number => shown.some(issue => issue.number === number)).length === 1
    // Merge all's confirm, while there is still something to merge.
    const confirm = arming && now.prs.length > 0

    return (
      <Box flexDirection="column">
        {topLine}
        {setupPlan}
        {trends}
        {workingLine}
        {setupCard}
        {draftCard}
        {failure && (
          <Box marginTop={1}>
            <Text color="error">{`✗ Last refresh failed: ${failure}`}</Text>
          </Box>
        )}

        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Text>
            <Text bold color="suggestion">
              Pull requests
            </Text>
            <Text dimColor>{now.prs.length > 0 ? ` ${now.prs.length} open` : ' none open'}</Text>
          </Text>
          {now.prs.length > 0 && !arming && (
            <Button key="close-out-all" dimColor hotkey="m" onPress={arm(true)}>
              {`⇶ Merge all ${now.prs.length}…`}
            </Button>
          )}
        </Box>
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

        {issuesHeading}

        {shown.length === 0 && (
          <Box flexDirection="column" alignItems="center" marginTop={2}>
            <Text color="success">✓</Text>
            <Text dimColor>{typed.trim() ? `Nothing under ${filterName} matches “${typed.trim()}”.` : `Nothing open under ${filterName}.`}</Text>
          </Box>
        )}
        {groupsOf(shown, grouping, project).map(group => {
          const sum = sumProgress(group.issues)
          const done = sum.total > 0 ? `${Math.round((sum.done / sum.total) * 100)}%` : '—'
          const right = group.epic ? `${group.issues.length} open · ${group.epic.completed}/${group.epic.total} closed` : `${group.issues.length} · ${done}`
          const shut = group.folded && !opened.includes(group.key)
          // A folded group, such as Backlog, is a heading the person opens; open, its heading folds it again.
          const fold = () => void update($, unfolded, list => (list.includes(group.key) ? list.filter(one => one !== group.key) : [...list, group.key]))
          return (
            <Box key={`group-${group.key}`} flexDirection="column">
              {group.folded ? (
                <Box flexDirection="row" marginTop={1} gap={1}>
                  <Button key={`fold-${group.key}`} plain hover={{ bold: true }} onPress={fold}>
                    {`${shut ? '▸' : '▾'} ${group.title}`}
                  </Button>
                  <Text dimColor>{shut ? `${group.issues.length} folded` : right}</Text>
                </Box>
              ) : group.epic ? (
                // An epic: how many of its sub-issues are closed, as a bar, and Next, which starts the first ready one.
                (() => {
                  const epic = group.epic
                  const next = nextOf(now.issues, epic.number, project)
                  const closed = `${epic.completed}/${epic.total} closed`
                  return (
                    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
                      <Text bold color="claude">
                        {fit(group.title, Math.max(12, width - 12 - cells(closed) - (next ? 10 : 0) - 4))}
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
                rule(fit(group.title, Math.max(12, width - right.length - 6)), right)
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

        <Box marginTop={1}>
          <Text dimColor>
            {confirm
              ? 'y merge every open PR · n cancel'
              : single
                ? 's start · e edit first · x or esc collapse · press a box to tick it · r refresh'
                : `${project ? '1 now · 2 later' : '1 active · 2 future'} · 3 bugs · 4 mine · 5 all · r refresh · ⏎ open an issue${now.prs.length > 0 ? ' · m merge all PRs' : ''}${made ? ' · c create the issue' : ''}`}
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

  // The band above the prompt: something the board needs that is missing, a pull request whose CI failed, or news on
  // the issue Claude is on.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = await read($, board)
    const gone = await read($, dismissed)
    const problems = ((await read($, access))?.problems ?? []).filter(problem => !gone.includes(accessKey(problem)))
    const doing = await read($, working)
    const alerts = now ? alertsOf(now, doing, gone, await read($, greened)) : []
    // The issue Claude is on, while it is open and nothing else about it is being said.
    const workingIssue = now && doing && !alerts.some(alert => alert.kind === 'activity') ? now.issues.find(issue => issue.number === doing.number) : undefined
    if (problems.length === 0 && alerts.length === 0 && !workingIssue) return next(e)

    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const clock = Date.now()
    const repo = now?.repo ?? ''
    const dismiss = (alert: Alert) => async () => {
      await update($, dismissed, list => [...list.slice(-50), alert.key])
      if (alert.kind === 'closed') await update($, working, () => null)
      await save($)
    }
    const stop = async () => {
      await update($, working, () => null)
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
              <Link href={pageOf(repo, 'pull', pr)} label="↗ GitHub" />
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
              <Link href={pageOf(repo, 'pull', pr)} label="↗ GitHub" />
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
              <Link href={pageOf(repo, 'issues', issue)} label="↗ GitHub" />
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

    const workingStep = workingIssue && progress(workingIssue.checks)
    const [filled, empty] = workingStep ? bar(workingStep, 8) : ['', '']
    const workingRow = workingIssue && workingStep && (
      <Box flexDirection="row" gap={1}>
        <Text color="claude" bold>
          {' ▶ '}
        </Text>
        <Text>
          <Text color="claude" bold>{`#${workingIssue.number} `}</Text>
          <Text>{fit(workingIssue.title, Math.max(12, width - 40))}</Text>
        </Text>
        {workingStep.total > 0 && (
          <Text>
            <Text color={tone(workingStep)}>{filled}</Text>
            <Text color="inactive" dimColor>
              {empty}
            </Text>
            <Text dimColor>{` ${workingStep.done}/${workingStep.total}`}</Text>
          </Text>
        )}
        <Button key={`stop-${workingIssue.number}`} dimColor onPress={() => void stop()}>
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
          {problem.url && !problem.command && <Link href={problem.url} label="↗ Open page" />}
          <Button key={`recheck-${problem.id}`} dimColor onPress={() => void recheck($)}>
            Check again
          </Button>
          <Button key={`dismiss-${accessKey(problem)}`} dimColor onPress={() => void dismissProblem($, problem)}>
            ✕
          </Button>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {problems.slice(0, 2).map(problemLine)}
        {alerts.slice(0, 3).map(line)}
        {workingRow}
      </Box>
    )
  })
}
