import type { ThemeKey } from 'claude-code'
import type { Issue, PullRequest, Worker } from '../types'
import { WORKER } from './tools'
import type { StartMode } from './settings'
import { cells, fit, named } from './layout'
import { startPrompt } from './prompts'

// The issue a branch is for, by the number a part of its name starts with, such as `fix/315-glide`, `315-glide`,
// `issue-315` or the worktree branch `worktree-fix+315-glide`. Null when it names none.
export const issueOfBranch = (name: string | null): number | null => {
  const match = /(?:^|[/+])(?:issue[-_]?|gh[-_]?)?(\d{1,7})(?=[-_/+]|$)/i.exec(name ?? '')
  return match ? Number(match[1]) : null
}

// The system prompt of the agent Start in background sets on an issue: it works alone, in a worktree of its own, and
// leaves a pull request for the person. The pull request names the issue by the same rule as the working note.
export const workerPrompt = (closesWhenTicked: boolean): string =>
  [
    'You work on one GitHub issue of this repository, in the background, in a git worktree of your own. The person is not watching.',
    "Don't ask the person anything. When something needs their decision, stop and say what it is.",
    '1. Read the issue and its comments with `gh issue view <number> --comments`.',
    "2. Do the work on a new branch from the default branch, following the repository's CLAUDE.md and contributing guidelines for branches, tests and checks.",
    '3. When you finish an acceptance box and have checked it, tick it with the mcp__issue-board__tick tool.',
    closesWhenTicked
      ? '4. Commit, push the branch and open a pull request. Write `Closes #<number>` in its body only if every acceptance box is ticked by then, and `Refs #<number>` otherwise.'
      : '4. Commit, push the branch and open a pull request.',
    "Don't merge, don't force-push, and don't push to the default branch.",
    'End with a short report in plain sentences: the pull request, what you did, and what is left.',
  ].join('\n')

// What Start in background sends Claude: dispatch the board's agent on the issue, and leave the work to it.
export const backgroundPrompt = (issue: Issue): string =>
  [
    `Dispatch a background agent to work on #${issue.number}: ${issue.title}. Don't work on the issue yourself.`,
    `Use the Agent tool with subagent_type \`${WORKER}\`, description \`#${issue.number} ${issue.title}\`, and this prompt:`,
    '',
    startPrompt(issue),
  ].join('\n')

// The issue a spawn of the board's agent works on: by the `#<n>` its description starts with, else the first its prompt
// names. A name `issue-<n>` names it too, for a call that gives one; Start in background asks for none, as the Agent
// tool may take none.
export const workerIssueOf = (spawn: { name?: string; description: string; prompt: string }): number | undefined => {
  const found = /^issue-(\d+)$/.exec(spawn.name ?? '') ?? /^#(\d+)\b/.exec(spawn.description.trim()) ?? /#(\d+)\b/.exec(spawn.prompt)
  return found ? Number(found[1]) : undefined
}

// Whether Claude's own Agent tool call started an agent: the engine raised the spawn, not a plugin's `$.agent.spawn`,
// in the main session's loop, not another agent's. Claude Code then hands Claude the agent's result itself.
export const startedByClaude = (origin: { plugin: string }, spawn: { parentAgentId?: string }): boolean => origin.plugin === 'engine' && spawn.parentAgentId === undefined

// A background agent's status on an issue's row.
export const workerBadge = (status: Worker['status']): { text: string; color: ThemeKey } =>
  status === 'completed'
    ? { text: '⚙ done', color: 'success' }
    : status === 'failed'
      ? { text: '⚙ failed', color: 'error' }
      : status === 'killed'
        ? { text: '⚙ stopped', color: 'inactive' }
        : status === 'waiting' || status === 'idle'
          ? { text: '⚙ waiting', color: 'warning' }
          : { text: '⚙ working', color: 'claude' }

// The line an issue's card shows in place of its start buttons while a background agent is on it, such as
// `⚙ Worker on it · working 4m`. An epic's card names the sub-issue the agent is on.
export const workerOnLine = (status: Worker['status'], age: string, on?: number): string =>
  `⚙ Worker on ${on === undefined ? 'it' : `#${on}`} · ${workerBadge(status).text.replace(/^⚙ /, '')}${age ? ` ${age}` : ''}`

// Where a background agent's loop may still move on from.
export const ACTIVE: readonly Worker['status'][] = ['pending', 'running', 'waiting', 'idle']

// The active background agent that owns a pull request's branch: one on an issue the pull request closes or refers to.
// A worker records its issue but not the branch it made, so the linked issue is how the board tells.
export const workerOfPr = (pr: PullRequest, workers: Worker[]): Worker | undefined =>
  workers.find(one => ACTIVE.includes(one.status) && (pr.issues ?? []).includes(one.number))

// Why closing out a pull request now may go wrong, as one sentence, or null when nothing says so: a background agent
// may still push to its branch, or its CI hasn't passed yet.
export const closeOutRisk = (pr: PullRequest, worker?: Worker): string | null => {
  const reasons = [
    ...(worker ? [`a background agent is still on #${worker.number} and may push to its branch`] : []),
    ...(pr.ci === 'pending' ? ['its CI is still running'] : pr.ci === 'fail' ? ['its CI is failing'] : []),
  ]
  if (reasons.length === 0) return null
  const said = reasons.join(', and ')
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`
}

// How a background agent's loop may end.
export type Ended = 'completed' | 'failed' | 'killed'

const ENDED: Record<Ended, string> = { completed: 'is done', failed: 'failed', killed: 'was stopped' }

const PULL_LINK = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g

// The pull request a background agent left on its issue: of the open ones for the issue, the one its answer names, or
// else the newest; failing those, the first one its answer links to. Null when nothing says.
export const workerPrOf = (number: number, prs: PullRequest[], answer: string): { number: number; url: string } | null => {
  const mentioned = new Set([...answer.matchAll(PULL_LINK)].map(match => Number(match[1])))
  for (const match of answer.matchAll(/#(\d+)\b/g)) mentioned.add(Number(match[1]))
  const linked = prs.filter(pr => (pr.issues ?? []).includes(number)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const pr = linked.find(one => mentioned.has(one.number)) ?? linked[0]
  if (pr) return { number: pr.number, url: pr.url }
  const link = [...answer.matchAll(PULL_LINK)][0]
  return link ? { number: Number(link[1]), url: link[0] } : null
}

// The line in the conversation when a background agent ends: how, on which issue, what it said and its pull request.
// One line, its pull request's address last, so a long answer is cut and the link isn't.
export const endedLine = (issue: { number: number; title?: string }, status: Ended, answer: string | null, pr: { number: number; url: string } | null): string => {
  const said = answer?.replace(/\s+/g, ' ').trim()
  const link = pr ? ` Pull request #${pr.number}${pr.url ? `: ${pr.url}` : ''}` : ''
  return `The background agent on ${named(issue)} ${ENDED[status]}.${said ? ` ${fit(said, 600)}` : ''}${link}`
}

// How much of a background agent's last answer the hand-off keeps. Claude Code sends Claude no task notification for
// an agent a plugin spawned, so the hand-off is the only place Claude reads the answer. The pull request and the
// issue's ticked boxes hold the detail, so the start of the answer is enough to follow up on.
export const HANDOFF_ANSWER = 1000

// What Claude reads when a background agent ends, so it can follow up without the person passing anything on.
// In `background` start mode, a finished agent's pull request is Claude's to review and see through.
export const handoffPrompt = (
  issue: { number: number; title?: string },
  status: Ended,
  answer: string | null,
  pr: { number: number; url: string } | null,
  mode: StartMode = 'main',
): string =>
  [
    `The background agent that Start in background set on ${named(issue)} ${ENDED[status]}.`,
    pr ? `Its pull request: #${pr.number}${pr.url ? ` ${pr.url}` : ''}` : 'The board sees no pull request for the issue.',
    answer?.trim()
      ? `Its last answer${cells(answer.trim()) > HANDOFF_ANSWER ? ', cut short' : ''}:\n${fit(answer.trim(), HANDOFF_ANSWER)}`
      : 'It gave no answer.',
    status === 'completed' && mode === 'background' && pr
      ? `Review pull request #${pr.number}, run the repository's tests and checks on its branch, and watch its CI. Then merge it, if the person's rules let you merge, or tell the person in a few sentences what is left.`
      : status === 'completed'
        ? 'Tell the person in a few sentences what it did and what is left, such as a review of the pull request.'
        : 'Tell the person in a sentence or two, and say what they could do next.',
  ].join('\n\n')
