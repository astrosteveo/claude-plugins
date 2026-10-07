import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Issue, Project, ProjectField } from '../types'
import { currentIterationText, iterationsAt, viewMatchOf } from '../hooks/filters'
import { parseGraph } from '../hooks/github'
import { issuesQuery } from '../hooks/project'
import type { RawIteration } from './graph'
import { graphPage } from './graph'
import { adoptedStore, fakeGitHub } from './github'
import { REFRESH, pane } from './ui'

// A time on the person's own calendar: iterations start at local midnight, as GitHub's page has them.
const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour).getTime()

// Two-week sprints: Sprint 1 ended on 5 October, Sprint 2 runs to the 18th, then a two-day gap before Sprint 3, and
// Sprint 4 after it. Sprint 1 is a completed iteration, which GitHub lists apart.
const SPRINT: ProjectField = {
  id: 'F_sprint',
  name: 'Sprint',
  kind: 'iteration',
  options: [
    { id: 'IT2', name: 'Sprint 2' },
    { id: 'IT3', name: 'Sprint 3' },
    { id: 'IT4', name: 'Sprint 4' },
  ],
  iterations: [
    { id: 'IT2', title: 'Sprint 2', start: '2026-10-05', days: 14 },
    { id: 'IT3', title: 'Sprint 3', start: '2026-10-21', days: 14 },
    { id: 'IT4', title: 'Sprint 4', start: '2026-11-04', days: 14 },
    { id: 'IT1', title: 'Sprint 1', start: '2026-09-21', days: 14 },
  ],
}

const projectWith = (fields: ProjectField[]): Project => ({ id: 'PVT_1', number: 1, title: 'Roadmap', url: 'https://github.com/users/astrosteveo/projects/1', status: null, priority: null, fields })
const PROJECT = projectWith([SPRINT])

const issue = (number: number, sprint?: string): Issue => ({
  number,
  title: `Issue ${number}`,
  url: '',
  labels: [],
  assignees: [],
  checks: [],
  updatedAt: '',
  body: '',
  ...(sprint ? { fields: { Sprint: sprint } } : {}),
})
const ISSUES = [issue(11, 'Sprint 1'), issue(12, 'Sprint 2'), issue(13, 'Sprint 3'), issue(14, 'Sprint 4'), issue(15)]

// The numbers of the issues a filter keeps at `clock`, and the terms it can't apply.
const kept = (filter: string, clock: number, project: Project = PROJECT) => {
  const match = viewMatchOf(filter, project, clock)
  return { kept: ISSUES.filter(one => match.test(one, null)).map(one => one.number), unknown: match.unknown }
}

test('@current, @next and @previous keep the issues in those iterations, and a range keeps the ones between', () => {
  const clock = at(10, 7)
  expect(kept('sprint:@current', clock)).toEqual({ kept: [12], unknown: [] })
  expect(kept('sprint:@next', clock)).toEqual({ kept: [13], unknown: [] })
  expect(kept('Sprint:@Previous', clock)).toEqual({ kept: [11], unknown: [] })
  expect(kept('sprint:@current..@next', clock)).toEqual({ kept: [12, 13], unknown: [] })
  expect(kept('sprint:@previous..@current', clock)).toEqual({ kept: [11, 12], unknown: [] })
  // Negated, and mixed with an iteration by its title.
  expect(kept('-sprint:@current', clock)).toEqual({ kept: [11, 13, 14, 15], unknown: [] })
  expect(kept('sprint:@previous,"Sprint 4"', clock)).toEqual({ kept: [11, 14], unknown: [] })
  // The first day of an iteration is in it; the day after its last is not.
  expect(kept('sprint:@current', at(10, 5, 0))).toEqual({ kept: [12], unknown: [] })
  expect(kept('sprint:@current', at(10, 21, 0))).toEqual({ kept: [13], unknown: [] })
  // Terms the board still can't apply stay named: other `@` words, and `@` terms on a field that isn't an iteration.
  expect(kept('sprint:@today sprint:@current+1', clock).unknown).toEqual(['sprint:@today', 'sprint:@current+1'])
  expect(kept('sprint:@current', clock, projectWith([{ id: 'F_s', name: 'Sprint', kind: 'text' }])).unknown).toEqual(['sprint:@current'])
})

test('between two iterations there is no current one, and the next and previous are either side of the gap', () => {
  const clock = at(10, 20)
  expect(iterationsAt(SPRINT, clock).current).toBeUndefined()
  expect(kept('sprint:@current', clock)).toEqual({ kept: [], unknown: [] })
  expect(kept('sprint:@next', clock)).toEqual({ kept: [13], unknown: [] })
  expect(kept('sprint:@previous', clock)).toEqual({ kept: [12], unknown: [] })
  expect(kept('sprint:@current..@next', clock)).toEqual({ kept: [13], unknown: [] })
  expect(kept('sprint:@previous..@current', clock)).toEqual({ kept: [12], unknown: [] })
  expect(currentIterationText(PROJECT, clock)).toBeNull()
})

test('a project with no current iteration keeps no issue for @current, and its header shows none', () => {
  // Every iteration is over: there is no current or next one.
  const clock = at(12, 1)
  expect(kept('sprint:@current', clock)).toEqual({ kept: [], unknown: [] })
  expect(kept('sprint:@next', clock)).toEqual({ kept: [], unknown: [] })
  expect(kept('sprint:@previous', clock)).toEqual({ kept: [14], unknown: [] })
  expect(kept('sprint:@previous..@next', clock)).toEqual({ kept: [14], unknown: [] })
  expect(currentIterationText(PROJECT, clock)).toBeNull()
  // An older board read no dates, so it knows no iteration's place.
  const undated = projectWith([{ ...SPRINT, iterations: undefined }])
  expect(kept('sprint:@current', at(10, 7), undated)).toEqual({ kept: [], unknown: [] })
  expect(currentIterationText(undated, at(10, 7))).toBeNull()
  expect(currentIterationText(projectWith([]), at(10, 7))).toBeNull()
  expect(currentIterationText(null, at(10, 7))).toBeNull()
})

test("the header's note is the current iteration and the days left in it, the last day counting as one", () => {
  expect(currentIterationText(PROJECT, at(10, 7))).toBe('Sprint 2 · 12d left')
  expect(currentIterationText(PROJECT, at(10, 5, 0))).toBe('Sprint 2 · 14d left')
  expect(currentIterationText(PROJECT, at(10, 18, 23))).toBe('Sprint 2 · 1d left')
  // The first iteration field with a current iteration speaks for the project.
  const cycle: ProjectField = { ...SPRINT, id: 'F_cycle', name: 'Cycle', iterations: [{ id: 'C1', title: 'Cycle 7', start: '2026-10-01', days: 7 }] }
  expect(currentIterationText(projectWith([{ id: 'F_due', name: 'Due', kind: 'date' }, cycle, SPRINT]), at(10, 7))).toBe('Cycle 7 · 1d left')
  expect(currentIterationText(projectWith([cycle, SPRINT]), at(10, 9))).toBe('Sprint 2 · 10d left')
})

// The day `days` from today on the person's calendar, as YYYY-MM-DD.
const dayFromToday = (days: number): string => {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

// A Cycle field around today: Cycle 1 is over, Cycle 2 began three days ago and runs two weeks, Cycle 3 follows.
const CYCLE_ITERATIONS: { iterations: RawIteration[]; completedIterations: RawIteration[] } = {
  iterations: [
    { id: 'C2', title: 'Cycle 2', startDate: dayFromToday(-3), duration: 14 },
    { id: 'C3', title: 'Cycle 3', startDate: dayFromToday(11), duration: 14 },
  ],
  completedIterations: [{ id: 'C1', title: 'Cycle 1', startDate: dayFromToday(-17), duration: 14 }],
}
const CYCLE = { id: 'F_cycle', name: 'Cycle', dataType: 'ITERATION', configuration: CYCLE_ITERATIONS }

test('the project query reads each iteration with its dates, the completed ones too', () => {
  const query = issuesQuery(true)
  expect(query).toContain('iterations { id title startDate duration } completedIterations { id title startDate duration }')
  const argv = ['gh', 'api', 'graphql', `query=${query}`]
  const { project } = parseGraph([graphPage([], argv, true, [], { fields: [CYCLE] })])
  const cycle = project?.fields?.find(field => field.name === 'Cycle')
  // The options are the iterations an issue can be set to; the dated list holds the completed ones too.
  expect(cycle?.options).toEqual([
    { id: 'C2', name: 'Cycle 2' },
    { id: 'C3', name: 'Cycle 3' },
  ])
  expect(cycle?.iterations?.map(one => [one.title, one.days])).toEqual([
    ['Cycle 2', 14],
    ['Cycle 3', 14],
    ['Cycle 1', 14],
  ])
  // An iteration answered without dates, as setup's read has it, is left out of the dated list.
  const undated = { ...CYCLE, configuration: { iterations: [{ id: 'C9', title: 'Cycle 9' }] } }
  const { project: older } = parseGraph([graphPage([], argv, true, [], { fields: [undated as typeof CYCLE] })])
  expect(older?.fields?.find(field => field.name === 'Cycle')?.iterations).toBeUndefined()
})

const RAW = [
  { number: 1, title: 'Warp drive', labels: [], body: null, updatedAt: '2026-10-03T20:00:00Z', status: 'Ready', fields: { Cycle: 'Cycle 2' } },
  { number: 2, title: 'Shield tuning', labels: [], body: null, updatedAt: '2026-10-03T19:00:00Z', status: 'Ready', fields: { Cycle: 'Cycle 3' } },
  { number: 3, title: 'Old cargo', labels: [], body: null, updatedAt: '2026-10-03T18:00:00Z', status: 'Ready', fields: { Cycle: 'Cycle 1' } },
]

const world = (on: On) => {
  adoptedStore(on)
  fakeGitHub(on, {
    issues: RAW,
    project: true,
    views: { views: [{ name: 'This cycle', number: 2, layout: 'TABLE_LAYOUT', filter: 'cycle:@current' }, { name: 'Coming up', number: 3, layout: 'TABLE_LAYOUT', filter: 'cycle:@current..@next' }], fields: [CYCLE] },
  })
}

test("a view's @current tab keeps the current iteration's issues, and the header shows it with the days left", async ($, on) => {
  world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...pane(100, 40) })
  const tabs = (await ui.findAll({ type: 'Button' })).filter(button => String(button.props.key ?? '').startsWith('filter-'))
  expect(tabs.slice(0, 2).map(tab => tab.text)).toEqual(['This cycle 1', 'Coming up 2'])
  expect(await ui.find({ key: 'issue-1' })).toBeDefined()
  expect(await ui.find({ key: 'issue-2' })).toBeUndefined()
  expect(await ui.find({ key: 'issue-3' })).toBeUndefined()
  // The term is applied, so no note says it isn't.
  expect(await ui.find({ key: 'view-note' })).toBeUndefined()
  expect(await ui.find({ text: /Cycle 2 · 11d left/ })).toBeDefined()
  await ui.press({ key: 'filter-view:3' })
  expect(await ui.find({ key: 'issue-1' })).toBeDefined()
  expect(await ui.find({ key: 'issue-2' })).toBeDefined()
  expect(await ui.find({ key: 'issue-3' })).toBeUndefined()
  await ui.unmount()
})
