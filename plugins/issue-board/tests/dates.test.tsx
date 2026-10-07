import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Issue, Project } from '../types'
import { dayOf, rangeTestOf, viewMatchOf } from '../hooks/filters'
import { parseGraph } from '../hooks/github'
import { issuesQuery } from '../hooks/project'
import { graphPage } from './graph'
import { adoptedStore, fakeGitHub } from './github'
import { REFRESH, pane } from './ui'

// A time on the person's own calendar, as an ISO time the way GitHub answers one.
const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour)
const iso = (month: number, day: number, hour = 12) => at(month, day, hour).toISOString()

// Today is 7 October 2026, at noon.
const CLOCK = at(10, 7).getTime()

const PROJECT: Project = {
  id: 'PVT_1',
  number: 1,
  title: 'Roadmap',
  url: 'https://github.com/users/astrosteveo/projects/1',
  status: null,
  priority: null,
  fields: [
    { id: 'F_due', name: 'Due', kind: 'date' },
    { id: 'F_points', name: 'Story points', kind: 'number' },
    { id: 'F_notes', name: 'Notes', kind: 'text' },
  ],
}

const issue = (number: number, more: Partial<Issue> = {}): Issue => ({ number, title: `Issue ${number}`, url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '', ...more })

// #1 was opened long ago and changed today; #2 opened and changed a week ago; #3 opened yesterday, changed late last
// night; #4 has no dates the board read, as an issue read with `gh issue view` has none.
const ISSUES: Issue[] = [
  issue(1, { createdAt: iso(1, 15), updatedAt: iso(10, 7, 9), fields: { Due: '2026-10-01', 'Story points': '5' } }),
  issue(2, { createdAt: iso(9, 30), updatedAt: iso(9, 30), fields: { Due: '2026-10-07', 'Story points': '3' } }),
  issue(3, { createdAt: iso(10, 6), updatedAt: iso(10, 6, 23), fields: { Due: '2026-10-14', 'Story points': '1.5' } }),
  issue(4),
]

// The numbers of the issues a filter keeps today, and the terms it can't apply.
const kept = (filter: string, clock = CLOCK) => {
  const match = viewMatchOf(filter, PROJECT, clock)
  return { kept: ISSUES.filter(one => match.test(one, null)).map(one => one.number), unknown: match.unknown }
}
const only = (filter: string) => {
  const { kept: numbers, unknown } = kept(filter)
  expect(unknown, filter).toEqual([])
  return numbers
}

test('@today and @today with days or weeks compare with >, >=, < and <= on the issue dates and date fields', () => {
  // updated: today is the 7th; the 30th of September is seven days before.
  expect(only('updated:@today')).toEqual([1])
  expect(only('updated:>@today-7d')).toEqual([1, 3])
  expect(only('updated:>=@today-7d')).toEqual([1, 2, 3])
  expect(only('updated:<@today')).toEqual([2, 3])
  expect(only('updated:<=@today-1d')).toEqual([2, 3])
  expect(only('updated:>=@today-1w')).toEqual([1, 2, 3])
  // created, by a day as written and by @today.
  expect(only('created:>2026-09-01')).toEqual([2, 3])
  expect(only('created:2026-10-06')).toEqual([3])
  expect(only('created:@today-1d')).toEqual([3])
  expect(only('-created:<@today-30d')).toEqual([2, 3, 4])
  // The board holds open issues, so none has a closed date.
  expect(only('closed:<@today')).toEqual([])
  expect(only('-closed:>@today-7d')).toEqual([1, 2, 3, 4])
  // A project date field, any case, and moved forward.
  expect(only('due:<@today')).toEqual([1])
  expect(only('Due:<=@today')).toEqual([1, 2])
  expect(only('due:>@today')).toEqual([3])
  expect(only('due:@today+7d')).toEqual([3])
  expect(only('due:<@today+1w')).toEqual([1, 2])
  // A comma list keeps an issue any value keeps.
  expect(only('due:<@today,>@today')).toEqual([1, 3])
  // @today moves with the board's clock.
  expect(kept('updated:@today', at(10, 6, 8).getTime())).toEqual({ kept: [3], unknown: [] })
})

test('a range a..b holds both ends, on number and date fields and the issue dates, with * for an open end', () => {
  expect(only('due:2026-10-01..2026-10-07')).toEqual([1, 2])
  expect(only('due:@today..@today+7d')).toEqual([2, 3])
  expect(only('due:*..@today-1d')).toEqual([1])
  expect(only('updated:@today-7d..@today-1d')).toEqual([2, 3])
  expect(only('created:2026-10-01..*')).toEqual([3])
  expect(only('story-points:1..3')).toEqual([2, 3])
  expect(only('"story points":3..*')).toEqual([1, 2])
  expect(only('-story-points:2..4')).toEqual([1, 3, 4])
})

test('a number field compares as numbers', () => {
  expect(only('story-points:>3')).toEqual([1])
  expect(only('story-points:>=3')).toEqual([1, 2])
  expect(only('story-points:<3')).toEqual([3])
  expect(only('story-points:<=1.5')).toEqual([3])
  expect(only('story-points:3.0')).toEqual([2])
  // A plain value still matches as text, as before.
  expect(only('story-points:5')).toEqual([1])
})

test("a date or range term the board still can't apply keeps its note, and the rest of the filter applies", () => {
  expect(kept('story-points:>3 updated:>@yesterday due:>soon story-points:>three notes:>3 created:2026-10 due:1..2..3 updated:recent')).toEqual({
    kept: [1],
    unknown: ['updated:>@yesterday', 'due:>soon', 'story-points:>three', 'notes:>3', 'created:2026-10', 'due:1..2..3', 'updated:recent'],
  })
  // A date on a number field, or a number on a date field, isn't one either.
  expect(kept('story-points:>@today due:>3').unknown).toEqual(['story-points:>@today', 'due:>3'])
})

test("a day is the one a time falls on in the person's own calendar", () => {
  expect(dayOf(iso(10, 7, 0))).toBe(dayOf('2026-10-07'))
  expect(dayOf(iso(10, 7, 23))).toBe(dayOf('2026-10-07'))
  expect(dayOf('2026-10-08')! - dayOf('2026-10-07')!).toBe(1)
  expect(dayOf('')).toBeNull()
  expect(dayOf('soon')).toBeNull()
  expect(rangeTestOf('>2', 'number', CLOCK)?.('')).toBe(false)
  expect(rangeTestOf('>2', 'number', CLOCK)?.('2.5')).toBe(true)
})

test('the issues query reads when each issue was opened, in the same request', () => {
  const query = issuesQuery(true)
  expect(query).toContain('nodes { id number title url body updatedAt createdAt')
  const argv = ['gh', 'api', 'graphql', `query=${query}`]
  const raw = { number: 9, title: 'New', labels: [], body: null, updatedAt: '2026-10-07T10:00:00Z', createdAt: '2026-10-01T08:00:00Z' }
  expect(parseGraph([graphPage([raw], argv, true)]).issues[0]?.createdAt).toBe('2026-10-01T08:00:00Z')
  // An answer without it leaves it out.
  expect(parseGraph([graphPage([{ ...raw, createdAt: undefined }], argv, true)]).issues[0]).not.toHaveProperty('createdAt')
})

// Times from the real clock, which the pane's tabs use.
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const RAW = [
  { number: 1, title: 'Warp drive', labels: [], body: null, updatedAt: ago(0), createdAt: ago(40), status: 'Ready', fields: { Points: '8' } },
  { number: 2, title: 'Shield tuning', labels: [], body: null, updatedAt: ago(2), createdAt: ago(3), status: 'Ready', fields: { Points: '2' } },
  { number: 3, title: 'Old cargo', labels: [], body: null, updatedAt: ago(30), createdAt: ago(60), status: 'Ready', fields: { Points: '5' } },
]

const world = (on: On) => {
  adoptedStore(on)
  fakeGitHub(on, {
    issues: RAW,
    project: true,
    views: {
      views: [
        { name: 'This week', number: 2, layout: 'TABLE_LAYOUT', filter: 'updated:>@today-7d' },
        { name: 'Big', number: 3, layout: 'TABLE_LAYOUT', filter: 'points:>3 created:<@today-14d' },
      ],
      fields: [{ id: 'F_points', name: 'Points', dataType: 'NUMBER' }],
    },
  })
}

test("a view's date and number terms decide its tab, with no note", async ($, on) => {
  world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(100, 40) })
  const tabs = (await ui.findAll({ type: 'Button' })).filter(button => String(button.props.key ?? '').startsWith('filter-'))
  expect(tabs.slice(0, 2).map(tab => tab.text)).toEqual(['This week 2', 'Big 2'])
  expect(await ui.find({ key: 'issue-1' })).toBeDefined()
  expect(await ui.find({ key: 'issue-2' })).toBeDefined()
  expect(await ui.find({ key: 'issue-3' })).toBeUndefined()
  expect(await ui.find({ key: 'view-note' })).toBeUndefined()
  await ui.press({ key: 'filter-view:3' })
  expect(await ui.find({ key: 'issue-1' })).toBeDefined()
  expect(await ui.find({ key: 'issue-2' })).toBeUndefined()
  expect(await ui.find({ key: 'issue-3' })).toBeDefined()
  expect(await ui.find({ key: 'view-note' })).toBeUndefined()
  await ui.unmount()
})
