import type { Alert, Board, Check, Comment, Issue, Known, PullRequest, RunWatch, Working } from '../types'
import { proseOf, prsFor } from './github'
import { agoText, fit, progress } from './layout'
import { issueLines, prText } from './prompts'

// Whether a prompt still names the issue: an Edit-first message the person rewrote may no longer be about it.
export const namesIssue = (text: string, number: number): boolean => mentionsOf(text, Infinity).includes(number)

// What the band above the prompt raises, minus what the person waved off: failing CI, CI that went green while the board
// watched, then the issue Claude is on.
export const alertsOf = (board: Board, working: Working | null, dismissed: string[], greened: string[] = []): Alert[] => {
  const alerts: Alert[] = [
    ...board.prs.filter(pr => pr.ci === 'fail').map(pr => ({ kind: 'ci' as const, key: `ci-${pr.number}-${pr.updatedAt}`, pr })),
    ...board.prs
      .filter(pr => pr.ci === 'pass' && greened.includes(greenKey(pr)))
      .map(pr => ({ kind: 'pass' as const, key: `pass-${greenKey(pr)}`, pr })),
  ]
  if (working) {
    const issue = board.issues.find(one => one.number === working.number)
    if (!issue) alerts.push({ kind: 'closed', key: `closed-${working.number}`, working })
    else if (issue.updatedAt > working.updatedAt) alerts.push({ kind: 'activity', key: `activity-${issue.number}-${issue.updatedAt}`, issue })
  }
  return alerts.filter(alert => !dismissed.includes(alert.key))
}

// How `greened` names one CI run of a pull request.
export const greenKey = (pr: PullRequest): string => `${pr.number}-${pr.sha}`

// The pull requests whose CI was running on the last board and passes on this one.
export const wentGreen = (before: Board | null, after: Board): PullRequest[] =>
  after.prs.filter(pr => pr.ci === 'pass' && before?.prs.some(old => old.number === pr.number && old.ci === 'pending'))

// The issues and pull requests a prompt names as `#123`, each once, in order, up to `limit`. Not `&#123;`, a URL's
// `/#123` or a word run into it.
export const mentionsOf = (text: string, limit = 3): number[] =>
  [...new Set([...text.matchAll(/(?<![\w&/#])#(\d{1,7})\b/g)].map(match => Number(match[1])))].slice(0, limit)

// How much of an issue's text a prompt that names it carries.
const MENTION_TEXT = 2000

// What a prompt that names `#number` carries for Claude, unseen by the person: the board's copy of that issue, with the
// pull requests for it and its text, or of that pull request. Null when the board has neither open.
export const mentionText = (board: Board, number: number, clock: number): string | null => {
  const as = `the issue board's copy, synced ${agoText(board.fetchedAt, clock)}`
  const issue = board.issues.find(one => one.number === number)
  if (issue) {
    const prs = prsFor(issue, board.prs)
    const prose = proseOf(issue.body)
    const cut = prose.length > MENTION_TEXT
    const text = cut ? `${prose.slice(0, MENTION_TEXT - 1)}…` : prose
    return [
      `The prompt names #${number}. This is ${as}:`,
      ...issueLines(issue),
      ...(prs.length > 0 ? ['Pull requests for it:', ...prs.map(prText)] : []),
      ...(text ? [cut ? `Text, without the boxes, cut to its first ${MENTION_TEXT} of ${prose.length} characters:` : 'Text, without the boxes:', text] : []),
      cut || !issue.body
        ? `Read the whole issue with \`gh issue view ${number}\`.`
        : `Its comments aren't here: the issues tool shows them with its \`number\`.`,
    ].join('\n')
  }
  const pr = board.prs.find(one => one.number === number)
  return pr ? `The prompt names pull request #${number}. This is ${as}:\n${prText(pr)}\nRead it in full with \`gh pr view ${number}\`.` : null
}

// What a copy of `#number` stands for: the issue or pull request as last updated, and for an issue its pull requests
// and their CI, which change without touching the issue. A copy is sent again only once this differs. Null when the
// board has neither open.
export const copyKeyOf = (board: Board, number: number): string | null => {
  const prKey = (pr: PullRequest) => `${pr.number}:${pr.updatedAt}:${pr.ci}`
  const issue = board.issues.find(one => one.number === number)
  if (issue) return [issue.updatedAt, ...prsFor(issue, board.prs).map(prKey)].join('|')
  const pr = board.prs.find(one => one.number === number)
  return pr ? prKey(pr) : null
}

// How many copies one prompt carries at most, so naming many issues doesn't fill the context.
export const COPY_CAP = 3

// What a prompt naming `numbers` carries: the copies not sent yet this session, or changed since (`sent` maps a number
// to the key its copy had), up to COPY_CAP; a line for those already sent and unchanged, so Claude knows it has them;
// and a line naming those past the cap. `keys` is what to record once the prompt goes.
export const copiesFor = (
  board: Board,
  numbers: number[],
  sent: ReadonlyMap<number, string>,
  clock: number,
): { context: string[]; keys: [number, string][] } => {
  const copies: string[] = []
  const keys: [number, string][] = []
  const same: number[] = []
  const over: number[] = []
  for (const number of numbers) {
    const key = copyKeyOf(board, number)
    const copy = key === null || sent.get(number) === key || copies.length >= COPY_CAP ? null : mentionText(board, number, clock)
    if (key === null) continue
    if (sent.get(number) === key) same.push(number)
    else if (copy === null) over.push(number)
    else {
      copies.push(copy)
      keys.push([number, key])
    }
  }
  const list = (all: number[]) => all.map(one => `#${one}`).join(', ')
  const unchanged = same.length === 1 ? "it hasn't" : "they haven't"
  return {
    context: [
      ...copies,
      ...(same.length > 0 ? [`An earlier prompt in this session carried the board's copy of ${list(same)}, and ${unchanged} changed since.`] : []),
      ...(over.length > 0 ? [`The prompt names ${list(over)} too, past the ${COPY_CAP} copies a prompt carries: the issues tool shows each with its \`number\`.`] : []),
    ],
    keys,
  }
}

// What Claude knows of an issue as the board has it now; `issue` undefined once it's closed, as it leaves the board.
export const knownOf = (issue: Issue | undefined, prs: PullRequest[]): Known => ({
  checks: issue?.checks ?? [],
  comments: issue?.comments ?? null,
  prs: issue ? prsFor(issue, prs).map(pr => ({ number: pr.number, ci: pr.ci, sha: pr.sha })) : [],
  closed: issue === undefined,
})

// What Claude knows once its own action changed the issue: what changed from `before` to `after` while the action ran
// goes into `known`, so it isn't noted, and what changed earlier stays to be noted. CI runs on its own, so a pull
// request keeps the CI Claude knew; one opened or closed during the action is taken as it is now.
export const absorbed = (known: Known, before: Known, after: Known): Known => {
  const has = (list: Check[], check: Check) => list.some(one => one.text === check.text)
  let checks = known.checks.filter(check => !has(before.checks, check) || has(after.checks, check))
  for (const check of after.checks) {
    const old = before.checks.find(one => one.text === check.text)
    if (old && old.done === check.done) continue
    checks = has(checks, check) ? checks.map(one => (one.text === check.text ? check : one)) : [...checks, check]
  }
  const opened = (pr: { number: number }, list: Known['prs']) => list.some(one => one.number === pr.number)
  const added = after.comments !== null && before.comments !== null ? after.comments - before.comments : 0
  return {
    checks,
    comments: known.comments === null ? after.comments : known.comments + added,
    prs: [
      ...known.prs.filter(pr => !opened(pr, before.prs) || opened(pr, after.prs)),
      ...after.prs.filter(pr => !opened(pr, before.prs) && !opened(pr, known.prs)),
    ],
    closed: before.closed === after.closed ? known.closed : after.closed,
  }
}

const COMMENT_TEXT = 300

// The note a prompt carries when the issue Claude is on changed on GitHub since its last prompt: boxes ticked, added or
// gone, new comments (with `comments`, the newest, when gh could read them), CI that failed or passed, the issue closed.
// Null when nothing it tracks changed.
export const newsOf = (number: number, was: Known, now: Known, comments: Comment[] = []): string | null => {
  const lines: string[] = []
  if (now.closed && !was.closed) lines.push(`#${number} is closed.`)
  if (!now.closed) {
    now.checks.forEach((check, index) => {
      const old = was.checks.find(one => one.text === check.text)
      if (!old) lines.push(`Box ${index + 1} is new: ${check.text}`)
      else if (old.done !== check.done) lines.push(`Box ${index + 1} was ${check.done ? 'ticked' : 'unticked'}: ${check.text}`)
    })
    for (const old of was.checks) if (!now.checks.some(check => check.text === old.text)) lines.push(`A box was taken out: ${old.text}`)
    const added = now.comments !== null && was.comments !== null ? now.comments - was.comments : 0
    if (added > 0) {
      const shown = comments.slice(-Math.min(added, 3))
      lines.push(`${added === 1 ? 'A new comment' : `${added} new comments`}${shown.length > 0 ? ':' : `. Read ${added === 1 ? 'it' : 'them'} with \`gh issue view ${number} --comments\`.`}`)
      for (const comment of shown) lines.push(`  @${comment.author}: ${fit(comment.body.replace(/\s+/g, ' ').trim(), COMMENT_TEXT)}`)
    }
    // A closed issue leaves the board, and the board then knows none of its pull requests.
    for (const pr of now.prs) {
      const old = was.prs.find(one => one.number === pr.number)
      if (old && old.ci === pr.ci && old.sha === pr.sha) continue
      if (pr.ci === 'fail') lines.push(`CI fails on PR #${pr.number}. \`gh pr checks ${pr.number}\` says where.`)
      else if (pr.ci === 'pass') lines.push(`CI passes on PR #${pr.number}.`)
    }
    for (const old of was.prs) if (!now.prs.some(pr => pr.number === old.number)) lines.push(`PR #${old.number} isn't open any more: it merged or closed.`)
  }
  if (lines.length === 0) return null
  return [`#${number}, the issue you're working on, changed on GitHub since the last prompt:`, ...lines.map(line => (line.startsWith('  ') ? line : `- ${line}`))].join('\n')
}

// What the prompt box suggests after a turn, for the issue Claude is on: fix CI that fails on its pull request; once
// every box is ticked, open a pull request for it, or merge the one whose CI passes. Null when nothing is due.
export const nextStepOf = (board: Board, working: Working | null): string | null => {
  const issue = working && board.issues.find(one => one.number === working.number)
  if (!issue) return null
  const prs = prsFor(issue, board.prs)
  const failing = prs.find(pr => pr.ci === 'fail')
  if (failing) return `Fix the failing CI on PR #${failing.number}`
  const { done, total } = progress(issue.checks)
  if (total === 0 || done < total) return null
  if (prs.length === 0) return `Open a PR for #${issue.number}`
  const ready = prs.find(pr => pr.ci === 'pass' && !pr.isDraft)
  return ready ? `Finish and merge PR #${ready.number}` : null
}

// Commands that change something on GitHub, so the board reads it again: gh issue and pr writes, project item edits,
// a push, and gh api calls that write. gh sends a POST when fields are given with no method.
const GH_WRITE = /\bgh\s+(issue|pr)\s+(create|edit|close|reopen|merge|comment|ready|review|develop)\b|\bgh\s+project\s+item-(add|create|edit|archive|delete)\b|\bgit\s+push\b/
const API_CALL = /\bgh\s+api\b[^;&|]*/g
export const writesGitHub = (command: string): boolean =>
  GH_WRITE.test(command) ||
  [...command.matchAll(API_CALL)].some(([call]) => {
    if (/\bgraphql\b/.test(call)) return /\bmutation\b/.test(call)
    const method = /(?:^|\s)(?:-X|--method)[\s=]*['"]?([A-Za-z]+)/.exec(call)?.[1]
    if (method) return method.toUpperCase() !== 'GET'
    return /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?=[\s=])/.test(call)
  })

// The repository a GitHub relay event is about, from the `owner/name#12` it names its pull request by, or its repo
// field; null when it names none.
export const eventRepoOf = (data: Record<string, unknown>): string | null => {
  for (const key of ['pr', 'pull_request', 'repo', 'repository']) {
    const value = data[key]
    const named = typeof value === 'string' ? /^([\w.-]+\/[\w.-]+?)(?:#\d+)?$/.exec(value.trim())?.[1] : undefined
    if (named) return named
  }
  return null
}

// The runs `gh run list --json databaseId,status,workflowName` lists that haven't completed.
export const liveRunsOf = (json: string): { id: number; workflow: string }[] =>
  (JSON.parse(json) as { databaseId?: unknown; status?: unknown; workflowName?: unknown }[]).flatMap(run =>
    typeof run.databaseId === 'number' && typeof run.status === 'string' && run.status !== 'completed'
      ? [{ id: run.databaseId, workflow: typeof run.workflowName === 'string' ? run.workflowName : 'CI' }]
      : [],
  )

// How far a run has got, from what `gh run watch` has written so far: it draws the run again every few seconds, so
// the last drawing's JOBS list counts. Each job is a line, `✓ build in 32s (ID 1)`, its steps indented under it; `✓`
// passed, `X` failed, `-` skipped, `*` still running. Null before it has drawn a job.
export const runProgressOf = (output: string): Pick<RunWatch, 'done' | 'total' | 'failed' | 'running' | 'step'> | null => {
  const text = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
  const at = text.lastIndexOf('JOBS\n')
  if (at < 0) return null
  const jobs: { mark: string; name: string; step: string | null }[] = []
  for (const line of text.slice(at + 'JOBS\n'.length).split('\n')) {
    if (/^(ANNOTATIONS|Refreshing run status)/.test(line)) break
    const job = /^([✓X*\-!]) (.+?)(?: in \S+)? \(ID \d+\)\s*$/.exec(line)
    if (job) {
      jobs.push({ mark: job[1] ?? '', name: job[2] ?? '', step: null })
      continue
    }
    const step = /^\s+\* (.+?)\s*$/.exec(line)
    const last = jobs.at(-1)
    if (step && last && last.mark === '*' && !last.step) last.step = step[1] ?? null
  }
  if (jobs.length === 0) return null
  const running = jobs.find(job => job.mark === '*')
  return {
    done: jobs.filter(job => job.mark !== '*').length,
    total: jobs.length,
    failed: jobs.filter(job => job.mark === 'X').length,
    running: running?.name ?? null,
    step: running?.step ?? null,
  }
}
