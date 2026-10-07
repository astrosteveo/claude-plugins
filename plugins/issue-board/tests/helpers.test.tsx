import { expect, test } from 'claude-code/testing'

import type { Issue, Milestone, PullRequest } from '../types'
import {
  NOT_READ,
  NOT_READ_SENTENCE,
  captureOf,
  changesOf,
  issueNumberIn,
  stringsOf,
  textOf,
} from '../hooks/changes'
import { groupingOf } from '../hooks/filters'
import { parseGraph } from '../hooks/github'
import { ciGlyph, prCountsText } from '../hooks/layout'
import { helpText, toolListOf } from '../hooks/prompts'
import { milestoneDue, milestoneLine, notFoundText } from '../hooks/rest'
import { same } from '../hooks/markers'
import { adoptedOf } from '../hooks/project'
import { zero } from '../hooks/stats'
import { TOOL_SPECS } from '../hooks/tools'
import { graphPage } from './graph'

const issue = (number: number, more: Partial<Issue> = {}): Issue => ({ number, title: `Issue ${number}`, url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '', ...more })

test("a tool input's text and list of names are trimmed, and blank or non-text values drop out", () => {
  expect([textOf(' Done '), textOf('   '), textOf(''), textOf(3), textOf(undefined)]).toEqual(['Done', undefined, undefined, undefined, undefined])
  expect(stringsOf([' bug ', '', '  ', 4, null, 'area:saves'])).toEqual(['bug', 'area:saves'])
  expect(stringsOf('bug')).toEqual([])
  expect(stringsOf(undefined)).toEqual([])
})

test("the capture tool's input needs a title and a body, keeps its labels, and files under an epic", () => {
  expect(captureOf({ title: ' Saves drop ', body: ' Seen while loading. ', labels: [' bug ', ''], epic: 35 })).toEqual({ title: 'Saves drop', body: 'Seen while loading.', labels: ['bug'], parent: 35 })
  expect(captureOf({ title: 'Saves drop', body: 'Why.' })).toEqual({ title: 'Saves drop', body: 'Why.' })
  expect(captureOf({ title: 'Saves drop', body: 'Why.', epic: 0 })).toEqual({ title: 'Saves drop', body: 'Why.' })
  expect(captureOf({ title: 'Saves drop', body: 'Why.', epic: 1.5 })).toEqual({ title: 'Saves drop', body: 'Why.' })
  expect(captureOf({ title: '  ', body: 'Why.' })).toBe('Give the capture a title.')
  expect(captureOf({ title: 'Saves drop', body: ' ' })).toBe('Say in body what the work is and why it came up.')
  expect(captureOf(undefined)).toBe('Give the capture a title.')
})

test("the issue_update tool's input becomes a change, keeping only what it can use", () => {
  expect(changesOf({})).toBeNull()
  expect(changesOf({ number: 0 })).toBeNull()
  expect(changesOf({ number: 4.5 })).toBeNull()
  expect(changesOf({ number: 43 })).toEqual({ number: 43 })
  expect(
    changesOf({
      number: 43,
      status: ' Done ',
      priority: '',
      addLabels: [' bug ', ''],
      removeLabels: [],
      assign: ['@me'],
      parent: 0,
      milestone: '  ',
      comment: ' Shipped. ',
      close: 'completed',
      reopen: true,
      title: ' New title ',
      body: ' kept as is ',
      addBoxes: [' One more '],
      rewordBoxes: [{ box: 2, text: ' Reworded ' }, { box: 1.5, text: 'x' }, { box: 3, text: ' ' }],
      fields: { ' Estimate ': 3, Due: '2026-10-20', Gone: null, Bad: true, ' ': 'x' },
      pin: false,
      lock: 'true',
      transferTo: ' other ',
      confirmTransfer: true,
      moveBefore: 44,
      moveAfter: 45,
      projectAfter: 0,
      type: ' Bug ',
      duplicateOf: 43,
      addBlockedBy: [35, 35, -1],
      removeBlockedBy: [12],
    }),
  ).toEqual({
    number: 43,
    status: 'Done',
    addLabels: ['bug'],
    assign: ['@me'],
    parent: null,
    milestone: null,
    comment: 'Shipped.',
    close: 'completed',
    reopen: true,
    title: 'New title',
    body: ' kept as is ',
    addBoxes: ['One more'],
    rewordBoxes: [{ box: 2, text: 'Reworded' }],
    fields: { Estimate: 3, Due: '2026-10-20', Gone: null },
    pin: false,
    lock: true,
    transferTo: 'other',
    confirmTransfer: true,
    moveBefore: 44,
    projectAfter: 0,
    type: 'Bug',
    addBlockedBy: [35],
    removeBlockedBy: [12],
  })
  expect(changesOf({ number: 43, parent: 35, milestone: ' Launch ', lock: 'spam', moveAfter: 45, type: null, duplicateOf: 35, close: 'later' })).toEqual({
    number: 43,
    parent: 35,
    milestone: 'Launch',
    lock: 'spam',
    moveAfter: 45,
    type: null,
    duplicateOf: 35,
  })
  expect(changesOf({ number: 43, lock: 'false', projectAfter: -1 })).toEqual({ number: 43, lock: false })
  expect(changesOf({ number: 43, lock: 'nope' })).toEqual({ number: 43 })
})

test('reading an issue over REST names a missing one by its number, and passes on any other failure', () => {
  expect(notFoundText('gh: Not Found (HTTP 404)', 'o/r', 45)).toBe("#45 doesn't exist in o/r")
  expect(notFoundText('HTTP 404', 'o/r', 45)).toBe("#45 doesn't exist in o/r")
  expect(notFoundText('gh: Server Error (HTTP 502)', 'o/r', 45)).toBe("couldn't read #45: gh: Server Error (HTTP 502)")
})

test('the board says the same thing wherever it has not read GitHub yet', () => {
  expect(NOT_READ).toBe("the issue board hasn't read GitHub yet; refresh it and try again")
  expect(NOT_READ_SENTENCE).toBe("The issue board hasn't read GitHub yet; refresh it and try again.")
})

test("a milestone's due date reads as late only while it is past and has open issues", () => {
  const one: Milestone = { number: 1, title: 'Launch', due: '2026-10-01', description: '', open: 2, closed: 3 }
  expect(milestoneDue(one, '2026-10-05')).toEqual({ text: 'was due 2026-10-01', late: true })
  expect(milestoneDue(one, '2026-10-01')).toEqual({ text: 'due 2026-10-01', late: false })
  expect(milestoneDue({ ...one, open: 0 }, '2026-10-05')).toEqual({ text: 'due 2026-10-01', late: false })
  expect(milestoneDue({ ...one, due: null }, '2026-10-05')).toEqual({ text: 'no due date', late: false })
  expect(milestoneLine(one, '2026-10-05')).toBe('Launch · 3/5 closed · was due 2026-10-01')
})

test('the issues group as picked while that applies, else as the view does, else by Status or area', () => {
  const view = { by: 'view' as const, field: 'Team' }
  const epic = { by: 'epic' as const, field: 'Parent issue' }
  expect(groupingOf(null, null, true)).toBe('status')
  expect(groupingOf(null, null, false)).toBe('area')
  expect(groupingOf(null, epic, false)).toBe('epic')
  expect(groupingOf('epic', view, true)).toBe('epic')
  // A pick of Status needs a project; without one the view's grouping, or area, stands in.
  expect(groupingOf('status', null, true)).toBe('status')
  expect(groupingOf('status', epic, false)).toBe('epic')
  expect(groupingOf('status', null, false)).toBe('area')
  // The view's field grouping holds only while a view groups by a field.
  expect(groupingOf('view', view, true)).toBe('view')
  expect(groupingOf('view', epic, true)).toBe('status')
  expect(groupingOf('view', null, false)).toBe('area')
})

test('an issue number typed into a field may start with #; anything else is no number', () => {
  expect(['35', '#35', ' 35 ', '#0', '-2', '3.5', 'x', '', '# 35'].map(issueNumberIn)).toEqual([35, 35, 35, null, null, null, null, null, 35])
})

test("CI's mark, and the folded pull request heading's counts", () => {
  expect([ciGlyph('pass'), ciGlyph('fail'), ciGlyph('pending'), ciGlyph('none')]).toEqual(['✓', '✗', '◷', '·'])
  const pr = (ci: PullRequest['ci']) => ({ ci }) as PullRequest
  expect(prCountsText([pr('pass'), pr('fail'), pr('pass'), pr('none')])).toBe('4 open · ✓ 2 · ✗ 1')
  expect(prCountsText([pr('pending')])).toBe('1 open · ◷ 1')
  expect(prCountsText([])).toBe('0 open')
})

test("the issues tool's list narrows the board's issues and names the filter", () => {
  const bug = { name: 'bug', color: '' }
  const issues = [
    issue(1, { labels: [{ name: 'area:saves', color: '' }, bug], assignees: ['astrosteveo'], milestone: 'Launch' }),
    issue(2, { labels: [{ name: 'area:ui', color: '' }], title: 'Draw the hangar' }),
    issue(3, { labels: [{ name: 'area:saves', color: '' }], assignees: ['other'] }),
  ]
  const markers = { bug: { label: 'bug' }, later: 'future' }
  const numbers = (ask: Parameters<typeof toolListOf>[1], viewer: string | null = null) => toolListOf(issues, ask, viewer, null, markers).issues.map(one => one.number)
  expect(numbers({})).toEqual([1, 3, 2])
  expect(numbers({ area: 'area:saves' })).toEqual([1, 3])
  expect(numbers({ query: 'hangar' })).toEqual([2])
  expect(numbers({ label: 'BUG' })).toEqual([1])
  expect(numbers({ assignee: '@other' })).toEqual([3])
  expect(numbers({ milestone: 'launch' })).toEqual([1])
  expect(numbers({ filter: 'bugs' })).toEqual([1])
  expect(numbers({ filter: 'mine' }, 'astrosteveo')).toEqual([1])
  expect(toolListOf(issues, {}, null, null, markers).label).toBe('all')
  expect(toolListOf(issues, { filter: 'active' }, null, null, markers).label).toBe('active')

  // With a project, Now and Later name their priorities and the Inbox its Status.
  const { project } = parseGraph([graphPage([], ['gh', 'api', 'graphql', 'query=projectsV2'], true)])
  expect(toolListOf([], { filter: 'active' }, null, project, markers).label).toBe('now: P0 and P1')
  expect(toolListOf([], { filter: 'future' }, null, project, markers).label).toBe('later: P2')
  expect(toolListOf([], { filter: 'inbox' }, null, project, markers).label).toBe('inbox: Status Inbox or none')
})

test('label, option and field names match in any case, without the space around them', () => {
  expect([same('Bug', 'bug'), same(' In progress ', 'in progress'), same('bug', 'bugs')]).toEqual([true, true, false])
})

test('an adopted project is keyed by its owner, in lower case, and its number; a page without an owner gives none', () => {
  const project = { id: 'PVT_9', number: 9, title: 'claude-plugins', url: 'https://github.com/users/AstroSteveo/projects/9' }
  expect(adoptedOf(project)).toEqual({ key: 'astrosteveo/9', number: 9, id: 'PVT_9', title: 'claude-plugins', owner: 'AstroSteveo' })
  expect(adoptedOf({ ...project, url: '' })).toBeNull()
})

test('a tally starts at zero, a fresh one each time', () => {
  const one = zero()
  one.rest += 1
  expect(zero()).toEqual({ rest: 0, rest304: 0, graphql: 0 })
})

test('/issues help lists every tool the board registers, each with its line', () => {
  const help = helpText([])
  for (const tool of TOOL_SPECS) expect(help).toContain(`- ${tool.name}: ${tool.what}.`)
})
