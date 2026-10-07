import type { On, PromptAutocompleteInput, PromptAutocompleteResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { HASH_ROWS, hashRows, parseGraph, parsePrs } from '../hooks/parse'
import type { Board } from '../types'
import { graphPage, isIssuesQuery } from './graph'

const raw = (number: number, title: string, status?: string, priority?: string, labels: string[] = []) => ({
  number,
  title,
  labels: labels.map(name => ({ name, color: 'ededed' })),
  body: '',
  updatedAt: '2026-10-05T00:00:00Z',
  status,
  priority,
})

const ISSUES = [
  raw(120, 'Dock the board', 'Backlog', 'P0'),
  raw(12, 'Fix the band', 'Ready', 'P1', ['bug', 'area:issue-board']),
  raw(13, 'Dock layout at narrow widths', 'In progress', 'P2'),
  raw(14, 'Triage the inbox', 'Inbox'),
  raw(15, 'Ready and urgent', 'Ready', 'P0'),
  raw(16, 'Something with no project values'),
]

const PR = {
  number: 125,
  title: 'Dock the pane',
  url: 'https://github.com/astrosteveo/claude-plugins/pull/125',
  headRefName: 'feat/120-dock',
  isDraft: false,
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
  reviewDecision: null,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-05T00:00:00Z',
}

// A board as the board reads it, with the project's Status and Priority on each issue.
const boardOf = (issues: ReturnType<typeof raw>[], prs: unknown[] = []): Board => {
  const { issues: read, project } = parseGraph([graphPage(issues, ['projectsV2'], true)])
  return { repo: 'astrosteveo/claude-plugins', issues: read, prs: parsePrs(JSON.stringify(prs)), velocity: { closed: [], merged: [] }, fetchedAt: 0, project }
}

test('# matches by number prefix and by title', () => {
  const board = boardOf(ISSUES, [PR])
  expect(hashRows(board, '#12').map(row => row.text).sort()).toEqual(['#12', '#120', '#125'])
  expect(hashRows(board, '#dock').map(row => row.text)).toEqual(['#13', '#125', '#120'])
  expect(hashRows(board, '#DOCK').length).toBe(3)
  expect(hashRows(board, '#nothing')).toEqual([])
})

test('rows show the title, then Status, Priority and labels, or CI for a pull request', () => {
  const board = boardOf(ISSUES, [PR, { ...PR, number: 126, isDraft: true, statusCheckRollup: [] }])
  expect(hashRows(board, '#12').find(row => row.text === '#12')).toEqual({ text: '#12', label: '#12 Fix the band', description: 'Ready · P1 · bug, area:issue-board' })
  expect(hashRows(board, '#16')[0]?.description).toBe('')
  expect(hashRows(board, '#125')[0]).toEqual({ text: '#125', label: '#125 Dock the pane', description: 'pull request · CI failing' })
  expect(hashRows(board, '#126')[0]?.description).toBe('pull request · draft · no CI')
})

test('rows go by Status, then Priority, then newest, and stop at the cap', () => {
  const board = boardOf(ISSUES, [PR])
  // In progress, then the pull request, then Ready by priority, Backlog, Inbox, and no Status last.
  expect(hashRows(board, '#').map(row => row.text)).toEqual(['#13', '#125', '#15', '#12', '#120', '#14', '#16'])

  const many = Array.from({ length: 20 }, (_, at) => raw(200 + at, `Issue ${at}`, 'Ready', 'P1'))
  const rows = hashRows(boardOf(many), '#')
  expect(rows.length).toBe(HASH_ROWS)
  expect(rows[0]?.text).toBe('#219')
})

test('without a project, issues go newest first and pull requests before them', () => {
  const { issues } = parseGraph([graphPage(ISSUES)])
  const board: Board = { repo: 'astrosteveo/claude-plugins', issues, prs: parsePrs(JSON.stringify([PR])), velocity: { closed: [], merged: [] }, fetchedAt: 0, project: null }
  expect(hashRows(board, '#1').map(row => row.text)).toEqual(['#125', '#120', '#16', '#15', '#14', '#13', '#12'])
})

const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

type Autocomplete = (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult>

// The prompt box as the person left it, with the token at the cursor, raised as the engine raises it.
const typed = (text: string): PromptAutocompleteInput => ({ text, cursor: text.length, token: text.split(' ').at(-1) ?? text, start: text.lastIndexOf(' ') + 1 })

// gh answering with the board's issues, and a plugin beneath with a row of its own, so the board's rows go after it.
// The test kit's typings in v2.1.292 leave `autocomplete` off the test's `$.prompt`, though the engine carries it.
const promptBox = ($: Engine, on: On): Autocomplete => {
  on('process.run', async (_$, e) => {
    const stdout = isIssuesQuery(e.argv) ? graphPage(ISSUES) : e.argv[1] === 'repo' ? JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }) : '[]'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.autocomplete', async () => ({ suggestions: [{ text: '#beneath' }] }))
  return ($.prompt as unknown as { autocomplete: Autocomplete }).autocomplete
}

test('typing # offers the board, and nothing before there is one', async ($, on) => {
  const autocomplete = promptBox($, on)

  // No board yet: only what was beneath.
  expect(await autocomplete(typed('look at #12'))).toEqual({ suggestions: [{ text: '#beneath' }] })

  await $.command.run(REFRESH)
  const { suggestions } = await autocomplete(typed('look at #12'))
  expect(suggestions.map(row => row.text)).toEqual(['#beneath', '#120', '#12'])
  expect(suggestions[2]).toMatchObject({ label: '#12 Fix the band' })

  // A token that doesn't start with # isn't the board's.
  expect(await autocomplete(typed('look at 12'))).toEqual({ suggestions: [{ text: '#beneath' }] })
})
