import type { ModelTextBlock } from 'claude-code'
import type { Board, BuiltInFilter, Check, Comment, Flagged, Issue, Markers, Project, PullRequest, Suggestion, Worker, Working } from '../types'
import { TOOLS, WORKER } from './tools'
import { NOW_COUNT, nowNames, priorityRank, roleOf } from './project'
import { offText } from './settings'
import type { NewIssue } from './changes'
import { areaOf, groupsOf, matches, searched } from './filters'
import type { Progress } from './layout'
import { agoText, fit, progress, reviewBadge } from './layout'

// What Ask Claude to answer hands Claude: the issue, the comment to answer, and how to reply.
export const answerPrompt = (issue: Issue, comment: Comment): string => {
  const quoted = comment.body.length > 400 ? `${comment.body.slice(0, 399)}…` : comment.body
  return (
    `Answer the latest comment on #${issue.number}: ${issue.title}. @${comment.author} wrote:\n\n${quoted.replace(/^/gm, '> ')}\n\n` +
    `Read the whole thread with \`gh issue view ${issue.number} --comments\` first. Then reply on the issue with the mcp__issue-board__issue_update tool's comment.`
  )
}

// The Status an issue moves to out of the Inbox when Claude didn't say: Ready for Now's priorities, Backlog otherwise.
export const statusFor = (project: Project | null, priority: string | null): 'Ready' | 'Backlog' => (priorityRank(project, priority) < NOW_COUNT ? 'Ready' : 'Backlog')

// How much of an issue's text Claude reads to triage it.
const TRIAGE_TEXT = 1500

// What the Inbox asks Claude: a Priority, an area and a Status for each issue, as JSON. The rules come first, marked
// for the prompt cache, and hold nothing that changes from one ask to the next, so a retry or the next batch within five
// minutes reads them from the cache. The repo and the issues follow in a second block. The engine joins the blocks with
// nothing between them, so the second opens with its own blank line.
export const triagePrompt = (repo: string, issues: Issue[], priorities: { name: string; description: string }[], areas: string[]): ModelTextBlock[] => [
  {
    text: [
      'Triage the new GitHub issues listed below. For each, suggest:',
      priorities.length > 0
        ? `- priority: one of ${priorities.map(one => (one.description ? `${one.name} (${one.description})` : one.name)).join(', ')};`
        : '- priority: null, as the project has no Priority field;',
      areas.length > 0 ? `- area: the part of the repository it is about, one of ${areas.join(', ')}, or null when none fits;` : '- area: null, as the repository has no area labels;',
      '- status: "Ready" when it is clear enough to start on now, "Backlog" when it should wait;',
      '- reason: one short, plain sentence saying why.',
      'Keep a Priority or area the issue already has unless it is clearly wrong.',
      'Answer with one JSON array and nothing else: [{"number": 1, "priority": "P1", "area": "...", "status": "Ready", "reason": "..."}].',
    ].join('\n'),
    cache: true,
  },
  {
    text: [
      '',
      '',
      `The issues, of ${repo}:`,
      ...issues.flatMap(issue => {
        const text = issue.body.trim()
        return [
          '',
          `#${issue.number} ${issue.title}`,
          `Labels: ${issue.labels.map(label => label.name).join(', ') || 'none'}. Priority: ${issue.priority ?? 'none'}.`,
          ...(text ? [text.length > TRIAGE_TEXT ? `${text.slice(0, TRIAGE_TEXT - 1)}…` : text] : []),
        ]
      }),
    ].join('\n'),
  },
]

// Claude's suggestions read back from its answer, one per issue asked about, keeping only the priorities and areas
// offered; a Status it didn't give follows the priority.
export const parseTriage = (text: string, issues: Issue[], priorities: string[], areas: string[], project: Project | null = null): Suggestion[] => {
  const json = /\[[\s\S]*\]/.exec(text)?.[0]
  let raw: unknown
  try {
    raw = json ? JSON.parse(json) : null
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const named = (list: string[], value: unknown) => (typeof value === 'string' ? (list.find(one => one.toLowerCase() === value.replace(/^area:/i, '').trim().toLowerCase()) ?? null) : null)
  const made: Suggestion[] = []
  for (const one of raw as Record<string, unknown>[]) {
    const issue = issues.find(each => each.number === one?.number)
    if (!issue || made.some(each => each.number === issue.number)) continue
    const priority = named(priorities, one.priority)
    const status = typeof one.status === 'string' && /^backlog$/i.test(one.status.trim()) ? 'Backlog' : typeof one.status === 'string' && /^ready$/i.test(one.status.trim()) ? 'Ready' : statusFor(project, priority)
    const reason = typeof one.reason === 'string' ? fit(one.reason.replace(/\s+/g, ' ').trim(), 200) : ''
    made.push({ number: issue.number, priority, area: named(areas, one.area), status, reason, updatedAt: issue.updatedAt })
  }
  return made
}

// The message the Start and Edit first buttons hand Claude for an issue. `tasks`: Start made a task for each open box.
// `copied`: the board's copy of the issue goes with the message, carrying its body and boxes, so the message only names
// it. Without one it lists the boxes: with copies off, in the message Start submits, which the board's own
// prompt.submit hook doesn't see, and in a worker's prompt, which goes to the agent alone.
export const startPrompt = (issue: Issue, tasks = false, copied = false): string => {
  const open = issue.checks.filter(check => !check.done)
  if (copied) {
    const each = tasks && open.length > 0 ? ' Each of its open acceptance boxes is a task in your task list: mark it completed when it is done.' : ''
    return `Let's start on #${issue.number}: ${issue.title}. The board's copy of it is attached.${each}`
  }
  const listed = tasks ? '\n\nEach is a task in your task list too: mark it completed when it is done.' : ''
  const boxes = open.length > 0 ? `\n\nIts open acceptance boxes:\n${open.map(check => `- ${check.text}`).join('\n')}${listed}` : ''
  return `Let's start on #${issue.number}: ${issue.title}. Read it with \`gh issue view ${issue.number}\` first.${boxes}`
}

// The message the band's Fix button hands Claude for a pull request whose CI failed.
export const fixPrompt = (pr: PullRequest): string => {
  const names = pr.failing ?? []
  const runs = pr.runs ?? []
  const which = names.length > 0 ? ` The failing ${names.length === 1 ? 'check is' : 'checks are'} ${names.join(', ')}.` : ''
  const logs =
    runs.length > 0
      ? `Read the failure with ${runs.map(run => `\`gh run view ${run} --log-failed\``).join(' and ')}`
      : `Look at \`gh pr checks ${pr.number}\` and the failing run's log`
  return `CI is failing on PR #${pr.number}: ${pr.title} (branch \`${pr.branch}\`).${which} ${logs}, then fix it.`
}

const CLOSE_OUT_RULES =
  "Follow the repository's contributing guidelines. Merge only once every check has passed, not just the required ones: wait for the pending ones with `gh pr checks --watch`. Don't bypass branch protection or force-push. If it can't be merged, say what's blocking it."

// What the board flagged in a pull request's files, which the person saw and chose to merge anyway.
const flaggedNote = (found: string[]): string => (found.length > 0 ? ` The board flagged its files, and the person chose to merge it anyway: it ${found.join('; it ')}.` : '')

// One pull request handed to Claude to see through: CI green, review answered, merged. `found` is what the board
// flagged in its files.
export const closeOutPrompt = (pr: PullRequest, found: string[] = []): string => {
  const draft = pr.isDraft ? ' It is a draft: finish it and mark it ready first.' : ''
  return (
    `Close out PR #${pr.number}: ${pr.title} (branch \`${pr.branch}\`). Read it with \`gh pr view ${pr.number}\` and \`gh pr checks ${pr.number}\`, ` +
    `fix any failing CI and answer any review on its branch, then merge it.${draft}${flaggedNote(found)} ${CLOSE_OUT_RULES}`
  )
}

// Every open pull request, merged one at a time, oldest first, each brought up to date with what merged before it.
// `flagged` is what the board flagged in their files, which the person saw before saying yes.
export const closeOutAllPrompt = (prs: PullRequest[], flagged: Flagged[] = []): string => {
  const foundOf = (number: number): string[] => flagged.find(one => one.number === number)?.found ?? []
  const list = [...prs]
    .sort((a, b) => a.number - b.number)
    .map(pr => {
      const found = foundOf(pr.number)
      return `- #${pr.number}: ${pr.title} (\`${pr.branch}\`, CI ${pr.ci}${pr.isDraft ? ', draft' : ''})${found.length > 0 ? `; flagged: it ${found.join('; it ')}` : ''}`
    })
    .join('\n')
  const seen = prs.some(pr => foundOf(pr.number).length > 0) ? 'The person saw what the board flagged in their files and chose to merge them anyway. ' : ''
  return (
    `Merge all ${prs.length} open pull ${prs.length === 1 ? 'request' : 'requests'}:\n${list}\n\n` +
    'Take them one at a time, oldest first. For each, read it with `gh pr view` and `gh pr checks`, fix any failing CI and answer any review, ' +
    'bring its branch up to date with what merged before it, and merge it once every one of its checks has passed. Finish a draft and mark it ready first. ' +
    `${seen}${CLOSE_OUT_RULES} Then move on to the next, and end with which merged and which didn't.`
  )
}

// What the board knows of one issue, a fact a line, its boxes numbered as the tick tool counts them.
export const issueLines = (issue: Issue): string[] => {
  const step = progress(issue.checks)
  return [
    `#${issue.number} ${issue.title}`,
    issue.url,
    `Labels: ${issue.labels.map(label => label.name).join(', ') || 'none'}`,
    `Assignees: ${issue.assignees.join(', ') || 'none'}`,
    issue.status || issue.priority ? `Status: ${issue.status ?? 'none'}. Priority: ${issue.priority ?? 'none'}.` : '',
    issue.milestone ? `Milestone: ${issue.milestone}` : '',
    issue.type ? `Type: ${issue.type}` : '',
    issue.parent ? `Sub-issue of #${issue.parent.number}: ${issue.parent.title}` : '',
    (issue.subIssues?.total ?? 0) > 0 ? `Sub-issues: ${issue.subIssues?.completed}/${issue.subIssues?.total} closed` : '',
    (issue.blockedBy ?? []).length > 0 ? `Blocked by: ${issue.blockedBy?.map(number => `#${number}`).join(', ')}` : '',
    `Updated: ${issue.updatedAt}`,
    step.total > 0 ? `Boxes (${step.done}/${step.total} ticked):` : 'Boxes: none',
    ...issue.checks.map((check, index) => `${index + 1}. [${check.done ? 'x' : ' '}] ${check.text}`),
  ].filter(line => line !== '')
}

// One issue as the issues tool answers it.
export const issueText = (issue: Issue): string =>
  [...issueLines(issue), `This is the board's copy, without the body's other text. Read the whole issue with \`gh issue view ${issue.number}\`.`].join('\n')

// One pull request as the issues tool answers it.
export const prText = (pr: PullRequest): string => {
  const review = reviewBadge(pr)
  const parts = [`branch ${pr.branch}`, `CI ${pr.ci}`, ...(review ? [review.text.replace(/^[●○] /, '')] : []), `+${pr.additions} −${pr.deletions}`]
  const failing = pr.ci === 'fail' && (pr.failing ?? []).length > 0 ? ` Failing: ${pr.failing.join(', ')}.` : ''
  return `#${pr.number} ${pr.title} [${parts.join(', ')}]${failing}`
}

const LISTED = 150

// The issues tool's list: the board's issues under the filter and the narrowing asked for, in the pane's order, and
// the words that name the filter for Claude. A project groups them by Status, else by area.
export const toolListOf = (
  issues: Issue[],
  ask: { filter?: BuiltInFilter; area?: string; query?: string; label?: string; assignee?: string; milestone?: string },
  viewer: string | null,
  project: Project | null,
  markers: Markers,
): { issues: Issue[]; label: string } => {
  const chosen = ask.filter ?? 'all'
  const area = ask.area?.replace(/^area:/, '')
  const kept = groupsOf(
    issues.filter(
      issue =>
        matches(chosen, issue, viewer, project, markers) &&
        (!area || areaOf(issue) === area) &&
        (!ask.query || searched(ask.query, issue)) &&
        (!ask.label || issue.labels.some(label => label.name.toLowerCase() === ask.label?.toLowerCase())) &&
        (!ask.assignee || issue.assignees.includes(ask.assignee.replace(/^@/, ''))) &&
        (!ask.milestone || issue.milestone?.toLowerCase() === ask.milestone.toLowerCase()),
    ),
    project ? 'status' : 'area',
    project,
    null,
    markers,
  ).flatMap(group => group.issues)
  const label =
    project && (chosen === 'active' || chosen === 'future')
      ? `${chosen === 'active' ? 'now' : 'later'}: ${nowNames(project)[chosen === 'active' ? 'now' : 'later'].join(' and ') || 'none'}`
      : chosen === 'inbox'
        ? `inbox: Status ${roleOf(project, 'inbox')?.name ?? 'Inbox'} or none`
        : chosen
  return { issues: kept, label }
}

// The board as the issues tool answers it: its pull requests, then the issues the filter keeps, one line each.
export const boardText = (board: Board, issues: Issue[], label: string, clock: number): string => {
  const line = (issue: Issue) => {
    const step = progress(issue.checks)
    const labels = issue.labels.map(one => one.name).join(', ')
    const planned = [issue.status, issue.priority].filter(Boolean).join(' ')
    const parts = [planned, labels, step.total > 0 ? `${step.done}/${step.total} boxes` : ''].filter(Boolean)
    return `#${issue.number} ${issue.title}${parts.length > 0 ? ` [${parts.join('; ')}]` : ''}`
  }
  const listed = issues.slice(0, LISTED)
  return [
    `${board.repo}: ${board.issues.length} open issues, ${board.prs.length} open pull requests (synced ${agoText(board.fetchedAt, clock)}).`,
    '',
    'Pull requests:',
    ...(board.prs.length > 0 ? board.prs.map(prText) : ['none']),
    '',
    `Issues (${label}, ${issues.length}):`,
    ...(listed.length > 0 ? listed.map(line) : ['none']),
    ...(issues.length > listed.length ? [`…and ${issues.length - listed.length} more; narrow with filter, area or query.`] : []),
  ].join('\n')
}

// The line a pull request's text gains for the issue Claude is on, through the engine's `attribution.text` for `pr`:
// `Closes #N` when every acceptance box is ticked, as the board last read them, so merging closes the issue; `Refs #N`
// while a box is open, so the issue stays open for what is left. Some repos keep an issue open for verification, and
// say `Refs` until then. Nothing with the rule off, which leaves it to the repository's own rules. Nothing either while
// a background worker is on another issue: the engine composes the same text for the worker's pull request and says
// nothing of whose it is, and the worker's prompt carries its own rule.
export const prKeyword = (issue: { number: number; checks: Check[] } | null, others: Worker[], closesWhenTicked: boolean): string => {
  if (!closesWhenTicked || !issue) return ''
  if (others.some(worker => worker.number !== issue.number && !WORKER_ENDED.includes(worker.status))) return ''
  const step = progress(issue.checks)
  return `${step.done === step.total ? 'Closes' : 'Refs'} #${issue.number}`
}

// A worker in one of these states writes no more pull requests.
const WORKER_ENDED: Worker['status'][] = ['completed', 'failed', 'killed']

// The system prompt's section while Claude works on an issue the person started this session. It names the issue and
// nothing that changes as the work goes on, so the prompt cache holds until the person starts another. Whether a pull
// request says `Closes` or `Refs` changes as boxes are ticked, so it isn't here: prKeyword puts it in the pull request's
// own text.
export const workingSection = (working: Working): string =>
  [
    `The person is working on GitHub issue #${working.number}: ${working.title}. They handed it to you from the issue board.`,
    `When you finish and check an acceptance box of #${working.number}, tick it with the mcp__issue-board__tick tool.`,
    `Change it with the mcp__issue-board__issue_update tool; moving its Status needs no permission.`,
  ].join(' ')

// What Claude does when a background agent it handed an issue to ends, in `background` start mode. It follows the
// person's own rules on merging, since some want to merge by hand.
const reviewText =
  "When a worker ends, review its pull request, run the repository's tests and checks on its branch, and watch its CI. Then merge it, if the person's rules let you merge, or tell the person what is left."

// The system prompt's section in `background` start mode: Claude orchestrates. It hands issues to the board's agent and
// keeps the main context small, doing only small changes itself. It never changes, so the prompt cache holds.
export const orchestratorSection = (): string =>
  [
    'The person wants you to work as an orchestrator. Hand each GitHub issue of this repository to a background worker instead of working on it here.',
    `Dispatch one with the Agent tool, subagent_type \`${WORKER}\`, a description that starts with the issue's #number, and a prompt that starts on the issue.`,
    'Do only small changes yourself, such as a one-line fix or a typo in the docs.',
    reviewText,
  ].join(' ')

// What `/issues new` asks Claude for, over the conversation so far, to capture to the Inbox. With `epic`, a parent issue
// and its sub-issues.
export const draftPrompt = (what: string, labels: string[], epic = false): string =>
  [
    epic
      ? `Draft an epic for this repository${what ? ` about: ${what}` : ' from what we have discussed'}: a parent GitHub issue and the sub-issues that, closed, finish it.`
      : `Draft a GitHub issue for this repository${what ? ` about: ${what}` : ' from what we have discussed'}.`,
    epic
      ? 'Answer with one JSON object and nothing else: {"title": "...", "body": "...", "labels": ["..."], "children": [{"title": "...", "body": "...", "labels": ["..."]}]}.'
      : 'Answer with one JSON object and nothing else: {"title": "...", "body": "...", "labels": ["..."]}.',
    'Write each title as a short, plain sentence. In each body, say what is wrong or wanted and why, in plain sentences.',
    epic
      ? 'The parent body says what the whole is for and the order to do the parts in. Each sub-issue is one piece of work, and its body ends with a "## Acceptance" section of task-list boxes ("- [ ] ..."), one checkable outcome each.'
      : 'End the body with a "## Acceptance" section of task-list boxes ("- [ ] ..."), one checkable outcome each.',
    labels.length > 0 ? `Choose labels only from this list, or none: ${labels.join(', ')}.` : 'Leave labels empty.',
  ].join(' ')

type RawDraft = { title?: unknown; body?: unknown; labels?: unknown }

// One issue of a draft, its labels kept to the ones the repository has; null when it has no title or body.
const draftOf = (raw: RawDraft, labels: string[]): NewIssue | null => {
  if (typeof raw.title !== 'string' || raw.title.trim() === '' || typeof raw.body !== 'string') return null
  const picked = Array.isArray(raw.labels) ? raw.labels.filter((one): one is string => typeof one === 'string' && labels.includes(one)) : []
  return { title: raw.title.trim(), body: raw.body.trim(), labels: [...new Set(picked)] }
}

// The draft in Claude's reply as an issue to capture; null when the reply holds none. An epic's sub-issues come as
// `children` in the reply and go to `subIssues`.
export const parseDraft = (text: string, labels: string[]): NewIssue | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as RawDraft & { children?: unknown }
    const parent = draftOf(raw, labels)
    if (!parent) return null
    const children = Array.isArray(raw.children) ? raw.children.flatMap(child => (child && typeof child === 'object' ? [draftOf(child as RawDraft, labels)] : [])).filter(one => one !== null) : []
    return children.length > 0 ? { ...parent, subIssues: children } : parent
  } catch {
    return null
  }
}

// Every label the board's issues carry, sorted: the ones a draft may use.
export const labelsOf = (issues: Issue[]): string[] => [...new Set(issues.flatMap(issue => issue.labels.map(label => label.name)))].sort()

// The system prompt's capture section. Its text never changes, so the prompt cache holds it.
export const captureSection = (): string =>
  'When you find work that will not be done in this turn, such as a follow-up, a bug noticed in passing or an idea, ' +
  "file it with the issue board's capture tool instead of listing it in your answer. Skip trivia."

// What opening the pane says: the keys that matter most, from the board's own lists, and the subcommands.
export const openedText = (filters: { hotkey: string; name: string }[]): string =>
  [
    'Issues pane opened.',
    `Filters: ${filters.map(one => `${one.hotkey} ${one.name}`).join(', ')}.`,
    'Enter opens an issue: Start hands it to Claude, Change edits it, and Esc folds it. r refreshes.',
    'Also: /issues new [epic] captures an issue to the Inbox, /issues setup links a project, /issues check says what is missing. /issues help lists everything.',
  ].join(' ')

// The subcommands of /issues, what each does: the argument hint and /issues help both come from here.
export const SUBCOMMANDS: { name: string; what: string }[] = [
  { name: 'refresh', what: 'reads GitHub again and answers with the summary' },
  { name: 'new <what>', what: 'captures an issue from the conversation to the Inbox, to triage there' },
  { name: 'new epic <what>', what: 'captures an epic and its sub-issues to the Inbox' },
  { name: 'setup', what: 'links or makes a project with Status and Priority, and says what it would change first' },
  { name: 'statuses', what: "picks which of the project's Status options plays each part, saved here and not on GitHub" },
  { name: 'labels', what: 'picks the label or issue type Bugs goes by, and the label Later goes by without a project, saved here and not on GitHub' },
  { name: 'check', what: 'says what the board is missing, such as a gh permission, and how to fix it' },
  { name: 'stats', what: "counts the board's GitHub calls, the GraphQL points they spent, and the text it added to Claude's context" },
  { name: 'help', what: 'this list' },
]

// /issues help: the pane and its keys, the card, the band and hint, the subcommands, and Claude's tools.
export const helpText = (filters: { hotkey: string; name: string }[], off: { feature: string; why: string }[] = [], views = false): string =>
  [
    'The issue board',
    '',
    'The pane (/issues)',
    `- Filters${views ? ", from the project's views" : ''}: ${filters.map(one => `${one.hotkey} ${one.name}`).join(', ')}. Type in the search field to narrow the list.`,
    '- Group by Status, Epic or Area with the buttons after the search.',
    '- r refreshes. m merges every open pull request, after asking. Hover a row to preview its boxes.',
    '- Enter, or a click, opens an issue.',
    '',
    'An open issue',
    '- s Start hands it to Claude here; b Start in background hands it to an agent in its own worktree. On an epic, both start its first ready sub-issue.',
    '- e Edit first puts the message in the prompt box; sending it still starts the issue while it names it. Edit first in background does the same for a background start.',
    '- x or Esc folds it. Press a box to tick it.',
    '- Change opens the editor: title, boxes, labels, assignee, epic, milestone, type, project fields, and closing.',
    '',
    'Under the prompt',
    `- The band above the prompt shows what needs you: setup problems, failing CI, pull requests to merge, news on your issue, boxes to tick, a plan to approve, notes on epics, a project to adopt, the board's guesses at Status names and labels, and issues captured to the Inbox.${off.some(one => one.feature === 'The band above the prompt') ? ' (off)' : ''}`,
    '- The hint line sums up what is open.',
    "- # in the prompt box offers the board's issues and pull requests.",
    '',
    'Subcommands',
    ...SUBCOMMANDS.map(one => `- /issues ${one.name}: ${one.what}.`),
    '',
    "Claude's tools",
    ...TOOLS.map(one => `- ${one.name}: ${one.what}.`),
    ...(off.length > 0 ? ['', ...offText(off)] : []),
  ].join('\n')
