import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register, Timer } from 'claude-code'

import type { Alert, Board, Draft, Filter, Issue, PullRequest, Working } from '../types'
import {
  WEEKS,
  ago,
  alertsOf,
  areaOf,
  bar,
  boardText,
  byArea,
  checksOf,
  chipsOf,
  ciBadge,
  closeOutAllPrompt,
  closeOutPrompt,
  draftPrompt,
  fit,
  fixPrompt,
  greenKey,
  hex,
  isBug,
  issueText,
  labelsOf,
  matches,
  parseDraft,
  parseIssues,
  parsePrs,
  prText,
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

const FILTERS: { id: Filter; label: string; hotkey: string }[] = [
  { id: 'active', label: 'Active', hotkey: 'a' },
  { id: 'future', label: 'Future', hotkey: 'f' },
  { id: 'bugs', label: 'Bugs', hotkey: 'b' },
  { id: 'mine', label: 'Mine', hotkey: 'i' },
  { id: 'all', label: 'All', hotkey: 'l' },
]

const gh = async ($: EngineInterface, args: string[], stdin?: string): Promise<string> => {
  const { exitCode, stdout, stderr } = await $.process.run(['gh', ...args], { timeoutMs: 60_000, ...(stdin === undefined ? {} : { stdin }) })
  if (exitCode !== 0) throw new Error(stderr.trim().split('\n')[0] || `gh ${args[0]} exited ${exitCode}`)
  return stdout
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

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

// What the board keeps between sessions, one entry per repository.
type Saved = { board: Board | null; working: Working | null; dismissed: string[]; viewer: string | null }

let storeKey: string | undefined
const keyOf = async ($: EngineInterface): Promise<string> => {
  if (storeKey === undefined) {
    const repo = await $.session.repo().catch(() => null)
    storeKey = `repo:${repo?.root ?? (await $.session.root())}`
  }
  return storeKey
}

const save = async ($: EngineInterface): Promise<void> => {
  try {
    const saved: Saved = { board: await read($, board), working: await read($, working), dismissed: await read($, dismissed), viewer: await read($, viewer) }
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
    const [issues, prs, closed, merged, login, current] = await Promise.all([
      listIssues(['--state', 'open', '--limit', '300', '--json', ISSUE_FIELDS]),
      gh($, [
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        '50',
        '--json',
        'number,title,url,author,headRefName,headRefOid,isDraft,statusCheckRollup,reviewDecision,additions,deletions,updatedAt',
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
      issues: parseIssues(issues),
      prs: parsePrs(prs),
      velocity: { closed: weekly(timesOf(closed, 'closedAt'), fetchedAt), merged: weekly(timesOf(merged, 'mergedAt'), fetchedAt) },
      fetchedAt,
    }
    after = next
    await update($, board, () => next)
    if (login !== known) await update($, viewer, () => login)
    await update($, branch, () => current)
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
  } catch (cause) {
    await update($, error, () => messageOf(cause))
  } finally {
    await update($, loading, () => false)
    schedule($, after)
  }
}

// Puts an issue read straight from GitHub on the board. The change is the person's or Claude's own, so the issue
// Claude is on takes its new time and the band doesn't call it news.
const take = async ($: EngineInterface, fresh: Issue): Promise<void> => {
  await update($, board, now => now && { ...now, issues: now.issues.map(one => (one.number === fresh.number ? fresh : one)) })
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

// Asks Claude, over the conversation so far, for an issue to file; the draft waits in the pane for the person.
const draftIssue = async ($: EngineInterface, what: string): Promise<void> => {
  if (await read($, drafting)) return
  await update($, drafting, () => true)
  await update($, draft, () => null)
  try {
    const labels = labelsOf((await read($, board))?.issues ?? [])
    const prompt = draftPrompt(what, labels)
    let reply: ModelForkResult = await $.model.fork({ prompt })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork' && what) reply = await $.model.complete({ model: 'sonnet', prompt })
    if (!reply.isAnswered) {
      $.ui.toast(reply.reason === 'nothing-to-fork' ? 'Nothing to draft from yet. Say what it is about: /issues new <what>' : `Couldn't draft the issue: ${reply.reason}`)
      return
    }
    const made = parseDraft(reply.text, labels)
    if (made) await update($, draft, () => made)
    else $.ui.toast("Claude's draft didn't come back as an issue. Try /issues new again.")
  } finally {
    await update($, drafting, () => false)
  }
}

const fileDraft = async ($: EngineInterface, made: Draft): Promise<void> => {
  try {
    const url = (await gh($, ['issue', 'create', '--title', made.title, '--body-file', '-', ...made.labels.flatMap(label => ['--label', label])], made.body)).trim()
    await update($, draft, () => null)
    const number = /\/issues\/(\d+)$/.exec(url)?.[1]
    $.ui.toast(number ? `Filed #${number}` : 'Filed the issue')
    void refresh($)
  } catch (cause) {
    $.ui.toast(`Couldn't file the issue: ${messageOf(cause)}`)
  }
}

const browse = async ($: EngineInterface, kind: 'issue' | 'pr', number: number): Promise<void> => {
  try {
    await gh($, [kind, 'view', String(number), '--web'])
    $.ui.toast(`Opened #${number} in the browser`)
  } catch (cause) {
    $.ui.toast(`Couldn't open #${number}: ${messageOf(cause)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'issues',
      description: 'Show open issues and pull requests in a pane',
      argumentHint: '[refresh | new <what it is about>]',
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
            description: 'Which issues to list: active (not labelled future), future, bugs, mine (assigned to the signed-in user) or all, the default.',
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
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'issues' }, async ($, e) => {
    const asked = /^new\b\s*([\s\S]*)$/.exec(e.args.trim())
    if (asked) {
      await $.ui.open({ id: PANE, title: 'Issues', focus: true })
      void draftIssue($, (asked[1] ?? '').trim())
      return { text: 'Drafting an issue from the conversation. It shows at the top of the issues pane to check before you file it.' }
    }
    if (e.args.trim() === 'refresh') {
      await refresh($)
      const now = await read($, board)
      return {
        text: now ? `Refreshed: ${summary(now.issues, now.prs) ?? 'nothing open'}.` : `Couldn't refresh: ${(await read($, error)) ?? 'unknown error'}`,
      }
    }
    await $.ui.open({ id: PANE, title: 'Issues', focus: true })
    if ((await read($, board)) === null) void refresh($)

    return { text: 'Issues pane opened. a/f/b/i/l filter, r refreshes, Enter on an issue opens it, then Start sends it to Claude. /issues new drafts an issue from the conversation.' }
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
    if (!now) return { deny: `The issue board couldn't read GitHub: ${(await read($, error)) ?? 'unknown error'}` }

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
    const kept = byArea(
      now.issues.filter(issue => matches(chosen, issue, who) && (!area || areaOf(issue) === area) && (!input.query || searched(input.query, issue))),
    ).flatMap(([, issues]) => issues)
    return { result: boardText(now, kept, chosen, Date.now()) }
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
      return { deny: `Couldn't tick boxes on #${number}: ${messageOf(cause)}` }
    }
  })

  // Reading the board changes nothing, so it needs no permission prompt; a rule that denies it still stands.
  on('tool.check', { tool: ISSUES_TOOL }, async ($, e, next) => {
    const verdict = await next(e)
    return verdict.decision === 'ask' ? { decision: 'allow' as const } : verdict
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(40, e.props.bodyColumns)
    const roomy = width >= 72
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
    }

    const flip = async (issue: Issue, box: number, done: boolean) => {
      try {
        await tick($, issue.number, [box], done)
        $.ui.toast(`${done ? 'Ticked' : 'Unticked'} box ${box} on #${issue.number}`)
      } catch (cause) {
        $.ui.toast(`Couldn't change box ${box} on #${issue.number}: ${messageOf(cause)}`)
      }
    }

    const closeOut = async (pr: PullRequest) => {
      await $.prompt.submit({ text: closeOutPrompt(pr), asUser: true })
      $.ui.toast(`Sent PR #${pr.number} to Claude to close out`)
    }

    // Close out all merges every open pull request, so it asks once more before it goes.
    const closeOutAll = async (prs: PullRequest[]) => {
      await update($, confirming, () => false)
      await $.prompt.submit({ text: closeOutAllPrompt(prs), asUser: true })
      $.ui.toast(`Sent ${prs.length} ${prs.length === 1 ? 'PR' : 'PRs'} to Claude to close out`)
    }
    const arm = (to: boolean) => () => void update($, confirming, () => to)

    const toggle = (number: number) => () =>
      void update($, expanded, list => (list.includes(number) ? list.filter(one => one !== number) : [...list, number]))

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

    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color="claude">◆ </Text>
          <Text bold>{now ? now.repo : 'GitHub'}</Text>
          <Text dimColor>{now ? '  issues & pull requests' : ''}</Text>
        </Text>
        <Box flexDirection="row" gap={1}>
          <Text color={busy ? 'warning' : undefined} dimColor={!busy}>
            {busy ? '◌ syncing…' : now ? `⟳ ${ago(new Date(now.fetchedAt).toISOString(), clock)}` : ''}
          </Text>
          <Button key="refresh" hotkey="r" dimColor onPress={() => void refresh($)}>
            Refresh
          </Button>
        </Box>
      </Box>
    )

    if (!now) {
      return (
        <Box flexDirection="column">
          {header}
          {failure ? (
            <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1} marginTop={1}>
              <Text color="error" bold>
                ✗ Couldn't reach GitHub
              </Text>
              <Text>{failure}</Text>
              <Text dimColor>Check `gh auth status`, then press r.</Text>
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text dimColor>◌ Fetching issues and pull requests…</Text>
            </Box>
          )}
        </Box>
      )
    }

    const shown = now.issues.filter(issue => matches(chosen, issue, who) && searched(typed, issue))
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

    const stats = (
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        {stat('●', 'claude', now.issues.length, now.issues.length === 1 ? 'issue' : 'issues')}
        {stat('▲', bugs > 0 ? 'error' : 'inactive', bugs, bugs === 1 ? 'bug' : 'bugs')}
        {stat('⇄', 'suggestion', now.prs.length, now.prs.length === 1 ? 'PR' : 'PRs')}
        {failing > 0 && stat('✗', 'error', failing, 'failing')}
        {overall.total > 0 && (
          <Text>
            {meter(overall.done, overall.total, 10)}
            <Text dimColor>{` ${Math.round((overall.done / overall.total) * 100)}% ticked`}</Text>
          </Text>
        )}
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
    const trends = velocity.closed.length > 0 && (
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        {trend('closed', 'success', velocity.closed)}
        {trend('merged', 'suggestion', velocity.merged)}
        <Text dimColor>{`last ${WEEKS} weeks`}</Text>
      </Box>
    )

    const tabs = (
      <Box flexDirection="row" gap={1} marginTop={1}>
        {FILTERS.map(one => (
          <Button
            key={`filter-${one.id}`}
            hotkey={one.hotkey}
            variant={one.id === chosen ? 'primary' : undefined}
            dimColor={one.id !== chosen}
            onPress={() => void update($, filter, () => one.id)}
          >
            {`${one.label} ${now.issues.filter(issue => matches(one.id, issue, who)).length}`}
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
      </Box>
    )

    // The issue Claude is on, with how far along it is.
    const workingIssue = doing ? now.issues.find(issue => issue.number === doing.number) : undefined
    const workingStep = workingIssue && progress(workingIssue.checks)
    const workingLine = workingIssue && workingStep && (
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text color="claude" bold>
          ▶ Working on
        </Text>
        <Text color="claude">{`#${workingIssue.number}`}</Text>
        <Text>{fit(workingIssue.title, Math.max(12, width - 34))}</Text>
        {workingStep.total > 0 && (
          <Text>
            {meter(workingStep.done, workingStep.total, 8)}
            <Text dimColor>{` ${workingStep.done}/${workingStep.total}`}</Text>
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
            New issue · draft
          </Text>
          <Text bold wrap="wrap">
            {made.title}
          </Text>
          {made.labels.length > 0 && <Text dimColor>{made.labels.join(' · ')}</Text>}
          <Box marginTop={1}>
            <Markdown text={made.body} />
          </Box>
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button key="draft-file" variant="primary" hotkey="c" onPress={() => void fileDraft($, made)}>
              ✚ File it
            </Button>
            <Button key="draft-discard" dimColor onPress={() => void update($, draft, () => null)}>
              Discard
            </Button>
          </Box>
        </Box>
      )
    )

    const prRow = (pr: PullRequest) => {
      const badge = ciBadge[pr.ci]
      const review = reviewBadge(pr)
      const size = `+${pr.additions} −${pr.deletions}`
      const titleRoom = width - [...badge.text].length - String(pr.number).length - 3 - (roomy ? size.length + 2 : 0)
      return (
        <Box key={`pr-row-${pr.number}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" gap={1}>
              <Text color={badge.color} inverse bold>
                {badge.text}
              </Text>
              <Text color="suggestion" bold>{`#${pr.number}`}</Text>
              <Button key={`pr-${pr.number}`} plain hover={{ color: 'claude', bold: true }} onPress={() => void browse($, 'pr', pr.number)}>
                {fit(pr.title, titleRoom)}
              </Button>
            </Box>
            {roomy && (
              <Text>
                <Text color="success">{`+${pr.additions}`}</Text>
                <Text color="error">{` −${pr.deletions}`}</Text>
              </Text>
            )}
          </Box>
          <Box flexDirection="row" justifyContent="space-between" paddingLeft={[...badge.text].length + 1}>
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{`⎇ ${fit(pr.branch, Math.max(10, Math.floor(width / 3)))}`}</Text>
              {pr.author && <Text dimColor>{`· @${pr.author}`}</Text>}
              {pr.updatedAt && <Text dimColor>{`· ${ago(pr.updatedAt, clock)}`}</Text>}
              {review && <Text color={review.color}>{`· ${review.text}`}</Text>}
              {pr.ci === 'fail' && (pr.failing ?? []).length > 0 && <Text color="error">{`· ${fit(pr.failing.join(', '), 30)}`}</Text>}
              {here !== null && pr.branch === here && (
                <Text color="claude" bold>
                  · ◆ this branch
                </Text>
              )}
            </Box>
            <Button key={`close-out-${pr.number}`} dimColor hover={{ dimColor: false, color: 'suggestion' }} onPress={() => void closeOut(pr)}>
              ⇲ Close out
            </Button>
          </Box>
        </Box>
      )
    }

    // One issue on one line: its progress, number, title, chips and age; the title opens it.
    const issueRow = (issue: Issue) => {
      const isOpen = open.includes(issue.number)
      const step = progress(issue.checks)
      const bug = isBug(issue)
      const chips = roomy ? chipsOf(issue).slice(0, 2) : []
      const age = ago(issue.updatedAt, clock)
      const count = step.total > 0 ? `${step.done}/${step.total}`.padEnd(5) : '     '
      const right = chips.reduce((sum, chip) => sum + chip.name.length + 3, 0) + age.padStart(3).length
      const left = 6 + 1 + 5 + 1 + (bug ? 2 : 0) + String(issue.number).length + 2
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
            <Text color={isOpen ? 'claude' : undefined} dimColor={!isOpen} hover={{ dimColor: false, color: 'claude' }}>
              {`#${issue.number} `}
            </Text>
            <Button key={`issue-${issue.number}`} plain hover={{ bold: true }} onPress={toggle(issue.number)}>
              {fit(issue.title, width - left - right - 1)}
            </Button>
          </Box>
          <Box flexDirection="row" gap={1}>
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
    const peek = (issue: Issue) => {
      const step = progress(issue.checks)
      const cardWidth = Math.min(60, width - 14)
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
          left={13}
          width={cardWidth}
          display="none"
          hover={{ display: 'flex' }}
          flexDirection="column"
          borderStyle="round"
          borderColor="claude"
        >
          {lines.map(line => (
            <Text color={line.color} dimColor={line.dim} bold={line.bold}>
              {` ${line.text.padEnd(inner)} `}
            </Text>
          ))}
        </Box>
      )
    }

    // An opened issue: a card with its labels, its boxes and what to do with it.
    const issueCard = (issue: Issue, hotkeys: boolean) => {
      const step = progress(issue.checks)
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginLeft={2} marginBottom={1}>
          <Text bold wrap="wrap">
            {issue.title}
          </Text>
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
          </Box>
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
            <Button key={`draft-${issue.number}`} hotkey={hotkeys ? 'd' : undefined} onPress={() => void $.prompt.fill({ text: startPrompt(issue) })}>
              ✎ Draft
            </Button>
            <Button key={`web-${issue.number}`} dimColor hotkey={hotkeys ? 'o' : undefined} onPress={() => void browse($, 'issue', issue.number)}>
              ↗ GitHub
            </Button>
            <Button key={`close-${issue.number}`} dimColor hotkey={hotkeys ? 'x' : undefined} onPress={toggle(issue.number)}>
              Close
            </Button>
          </Box>
        </Box>
      )
    }

    const single = open.filter(number => shown.some(issue => issue.number === number)).length === 1
    const filterName = FILTERS.find(one => one.id === chosen)?.label ?? ''

    return (
      <Box flexDirection="column">
        {header}
        {stats}
        {trends}
        {workingLine}
        {draftCard}
        {tabs}
        {failure && (
          <Box marginTop={1}>
            <Text color="error">{`✗ Last refresh failed: ${failure}`}</Text>
          </Box>
        )}

        {rule('Pull requests', `${now.prs.length} open`, 'suggestion')}
        {now.prs.length === 0 && <Text dimColor>No pull requests open.</Text>}
        {now.prs.length > 0 &&
          (arming ? (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Text color="warning">{`Close out and merge all ${now.prs.length} open ${now.prs.length === 1 ? 'PR' : 'PRs'}?`}</Text>
              <Button key="close-out-all-yes" variant="primary" hotkey="y" onPress={() => void closeOutAll(now.prs)}>
                Yes, merge them
              </Button>
              <Button key="close-out-all-no" dimColor hotkey="n" onPress={arm(false)}>
                Cancel
              </Button>
            </Box>
          ) : (
            <Box flexDirection="row">
              <Button key="close-out-all" dimColor hotkey="m" onPress={arm(true)}>
                {`⇶ Close out all ${now.prs.length}`}
              </Button>
            </Box>
          ))}
        {now.prs.map(prRow)}

        {shown.length === 0 && (
          <Box flexDirection="column" alignItems="center" marginTop={2}>
            <Text color="success">✓</Text>
            <Text dimColor>{typed.trim() ? `Nothing under ${filterName} matches “${typed.trim()}”.` : `Nothing open under ${filterName}.`}</Text>
          </Box>
        )}
        {byArea(shown).map(([area, issues]) => {
          const sum = sumProgress(issues)
          const right = `${issues.length} · ${sum.total > 0 ? `${Math.round((sum.done / sum.total) * 100)}%` : '—'}`
          return (
            <Box flexDirection="column">
              {rule(area, right)}
              {issues.map(issue => (
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
            {arming
              ? 'y merge every open PR · n cancel'
              : single
                ? 's start · d draft · o open on GitHub · x close · press a box to tick it · r refresh'
                : `a active · f future · b bugs · i mine · l all · r refresh · ⏎ open an issue${now.prs.length > 0 ? ' · m close out all PRs' : ''}${made ? ' · c file the draft' : ''}`}
          </Text>
        </Box>
      </Box>
    )
  })

  // The board in a line, dim at the end of the hint under the prompt; nothing when nothing is open.
  // The engine puts its own ` · ` between the hint and the tail, so the tail doesn't start with one.
  // Not `$.ui.status`: the status line draws as a warning, and an open issue isn't one.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const now = await read($, board)
    const text = now && summary(now.issues, now.prs)
    if (!text) return next(e)

    return next({ ...e, props: { ...e.props, tail: e.props.tail ? `${e.props.tail} · ${text}` : text } })
  })

  // The band above the prompt: a pull request whose CI failed, or news on the issue Claude is on.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, board)
    if (e.props.hasSurvey || !now) return next(e)
    const doing = await read($, working)
    const alerts = alertsOf(now, doing, await read($, dismissed), await read($, greened))
    // The issue Claude is on, while it is open and nothing else about it is being said.
    const workingIssue = doing && !alerts.some(alert => alert.kind === 'activity') ? now.issues.find(issue => issue.number === doing.number) : undefined
    if (alerts.length === 0 && !workingIssue) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const clock = Date.now()
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
              <Button key={`checks-${pr.number}`} dimColor onPress={() => void browse($, 'pr', pr.number)}>
                Open
              </Button>
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
                <Text>{fit(pr.title, Math.max(12, width - 48))}</Text>
                <Text dimColor>{` passed on ${fit(pr.branch, 20)}`}</Text>
              </Text>
              <Button key={`merge-${pr.number}`} variant="primary" onPress={() => void hand(closeOutPrompt(pr))}>
                Merge
              </Button>
              <Button key={`open-${pr.number}`} dimColor onPress={() => void browse($, 'pr', pr.number)}>
                Open
              </Button>
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
              <Button key={`view-${issue.number}`} variant="primary" onPress={() => void browse($, 'issue', issue.number)}>
                View
              </Button>
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

    return (
      <Box flexDirection="column">
        {alerts.slice(0, 3).map(line)}
        {workingRow}
      </Box>
    )
  })
}
