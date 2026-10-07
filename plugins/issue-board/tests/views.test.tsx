import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Issue, Project, ProjectView } from '../types'
import { groupsOf, parseFilter, parseGraph, tabOf, tabsOf, viewFieldsOf, viewGroupingOf, viewMatchOf } from '../hooks/parse'
import { issuesQuery } from '../hooks/project'
import type { RawView, Views } from './graph'
import { adoptedStore, graphPage, isIssuesQuery } from './graph'

// A project with Status, Priority, an Area field and a number field, for the filter tests that need no pane.
const PROJECT: Project = {
  id: 'PVT_1',
  number: 1,
  title: 'Roadmap',
  url: 'https://github.com/users/astrosteveo/projects/1',
  status: { id: 'F_status', options: ['Inbox', 'Backlog', 'Ready', 'In progress', 'Done'].map((name, index) => ({ id: `S${index}`, name })) },
  priority: { id: 'F_priority', options: ['P0', 'P1', 'P2'].map((name, index) => ({ id: `P${index}`, name })) },
  fields: [
    { id: 'F_area', name: 'Area', kind: 'select', options: [{ id: 'A0', name: 'Engine' }, { id: 'A1', name: 'UI' }] },
    { id: 'F_points', name: 'Story points', kind: 'number' },
  ],
}

const issue = (number: number, more: Partial<Issue> = {}): Issue => ({ number, title: `Issue ${number}`, url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '', ...more })
const label = (name: string) => ({ name, color: '' })

const ISSUES: Issue[] = [
  issue(1, { title: 'Pirates in cruise', status: 'Ready', priority: 'P1', labels: [label('bug')], assignees: ['astrosteveo'], fields: { Area: 'UI', 'Story points': '3' }, type: 'Bug' }),
  issue(2, { status: 'Done', labels: [label('bug'), label('docs')], milestone: 'Launch day' }),
  issue(3, { status: 'Backlog', priority: 'P2', labels: [label('good first issue')], assignees: ['alice'], fields: { Area: 'Engine' }, type: 'Task' }),
  issue(4, { title: 'Asteroids draw late' }),
]

// The numbers of the issues a filter keeps, as the person `astrosteveo`.
const kept = (filter: string, viewer: string | null = 'astrosteveo') => {
  const match = viewMatchOf(filter, PROJECT)
  return ISSUES.filter(one => match.test(one, viewer)).map(one => one.number)
}

test("a view's filter splits into terms: negation, quoted keys and values, and comma lists", () => {
  expect(parseFilter('status:Ready -label:"good first issue" label:bug,docs "story points":3 cruise')).toEqual([
    { key: 'status', values: ['Ready'], negate: false, raw: 'status:Ready' },
    { key: 'label', values: ['good first issue'], negate: true, raw: '-label:"good first issue"' },
    { key: 'label', values: ['bug', 'docs'], negate: false, raw: 'label:bug,docs' },
    { key: 'story points', values: ['3'], negate: false, raw: '"story points":3' },
    { key: null, values: ['cruise'], negate: false, raw: 'cruise' },
  ])
  expect(parseFilter('milestone:"Launch day","Beta 2"')[0]?.values).toEqual(['Launch day', 'Beta 2'])
  expect(parseFilter('   ')).toEqual([])
})

test('each term a view filters by keeps the issues GitHub would', () => {
  // Status, any case, and its negation.
  expect(kept('status:ready')).toEqual([1])
  expect(kept('-status:Done')).toEqual([1, 3, 4])
  // Labels: one, any of a comma list, quoted, and none of them.
  expect(kept('label:bug')).toEqual([1, 2])
  expect(kept('label:docs,"good first issue"')).toEqual([2, 3])
  expect(kept('-label:bug')).toEqual([3, 4])
  expect(kept('-label:bug,docs')).toEqual([3, 4])
  // Assignee by login, and @me as the person signed in; nobody signed in, @me keeps none.
  expect(kept('assignee:alice')).toEqual([3])
  expect(kept('assignee:@me')).toEqual([1])
  expect(kept('assignee:@me', null)).toEqual([])
  expect(kept('-assignee:@me')).toEqual([2, 3, 4])
  // no: and has: for assignee, label, milestone, status, priority and a project field; -no: is has:.
  expect(kept('no:assignee')).toEqual([2, 4])
  expect(kept('no:label')).toEqual([4])
  expect(kept('no:milestone')).toEqual([1, 3, 4])
  expect(kept('no:status')).toEqual([4])
  expect(kept('no:priority')).toEqual([2, 4])
  expect(kept('no:area')).toEqual([2, 4])
  expect(kept('-no:assignee')).toEqual([1, 3])
  expect(kept('has:milestone')).toEqual([2])
  // Priority, and any project field by name, a hyphen for a space, or the name in quotes.
  expect(kept('priority:P1,P2')).toEqual([1, 3])
  expect(kept('area:Engine')).toEqual([3])
  expect(kept('-area:UI')).toEqual([2, 3, 4])
  expect(kept('story-points:3')).toEqual([1])
  expect(kept('"Story points":3')).toEqual([1])
  // Milestone, quoted for its space.
  expect(kept('milestone:"Launch day"')).toEqual([2])
  // The board holds open issues: is:open keeps them all, is:closed none.
  expect(kept('is:open')).toEqual([1, 2, 3, 4])
  expect(kept('is:closed')).toEqual([])
  expect(kept('-is:closed is:issue')).toEqual([1, 2, 3, 4])
  // The issue's type.
  expect(kept('type:bug')).toEqual([1])
  expect(kept('-type:Task')).toEqual([1, 2, 4])
  // Plain words against the title, and a number with or without its #.
  expect(kept('pirates')).toEqual([1])
  expect(kept('"draw late"')).toEqual([4])
  expect(kept('-pirates')).toEqual([2, 3, 4])
  expect(kept('#3')).toEqual([3])
  expect(kept('2')).toEqual([2])
  // Terms together all apply.
  expect(kept('label:bug -status:Done assignee:@me')).toEqual([1])
  // No filter keeps everything.
  expect(kept('')).toEqual([1, 2, 3, 4])
})

test("a term the board can't apply is named, and the rest of the filter still applies", () => {
  const match = viewMatchOf('label:bug updated:>2026-01-01 iteration:@current label:*bug "story points":>2 reason:completed', PROJECT)
  expect(match.unknown).toEqual(['updated:>2026-01-01', 'iteration:@current', 'label:*bug', '"story points":>2', 'reason:completed'])
  expect(ISSUES.filter(one => match.test(one, null)).map(one => one.number)).toEqual([1, 2])
  expect(viewMatchOf('status:Ready', PROJECT).unknown).toEqual([])
  // An empty value, or no: on a field the project hasn't, is one too.
  expect(viewMatchOf('label: no:sprint is:draft', PROJECT).unknown).toEqual(['label:', 'no:sprint', 'is:draft'])
})

const view = (number: number, name: string, filter: string, more: Partial<ProjectView> = {}): ProjectView => ({ name, number, layout: 'table', filter, groupBy: null, ...more })

test("the tabs are the project's filtered table and board views in order, then All and Closed, on keys 1 to 9", () => {
  const views = [
    view(1, 'View 1', ''),
    view(2, 'Ready', 'status:Ready'),
    view(3, 'Bugs', 'label:bug', { layout: 'board', groupBy: 'Status' }),
    view(4, 'Dates', 'label:bug', { layout: 'roadmap' }),
    view(5, 'Mine', 'assignee:@me'),
  ]
  // A project without an Inbox, so no built-in Inbox follows the views.
  const project = { ...PROJECT, views, roles: {} }
  expect(tabsOf(project).map(tab => [tab.hotkey, tab.name, tab.id])).toEqual([
    ['1', 'Ready', 'view:2'],
    ['2', 'Bugs', 'view:3'],
    ['3', 'Mine', 'view:5'],
    ['4', 'All', 'all'],
    ['5', 'Closed', 'closed'],
  ])
  // Seven views at most, so All and Closed stay on 8 and 9.
  const many = { ...PROJECT, roles: {}, views: Array.from({ length: 10 }, (_, index) => view(index + 1, `V${index + 1}`, 'label:bug')) }
  expect(tabsOf(many).map(tab => tab.hotkey + tab.name)).toEqual(['1V1', '2V2', '3V3', '4V4', '5V5', '6V6', '7V7', '8All', '9Closed'])
  // With an Inbox, the built-in Inbox follows the views, unless a view keeps just the Inbox. It takes a key, so one
  // view fewer fits.
  const names = (tabs: { hotkey: string; name: string }[]) => tabs.map(tab => `${tab.hotkey} ${tab.name}`)
  const withRoles = { ...project, roles: { inbox: 'S0' } }
  const inbox = PROJECT.status?.options.find(one => one.id === 'S0')?.name ?? ''
  expect(names(tabsOf(withRoles))).toEqual(['1 Ready', '2 Bugs', '3 Mine', '4 Inbox', '5 All', '6 Closed'])
  expect(tabsOf(withRoles).find(tab => tab.name === 'Inbox')?.id).toBe('inbox')
  expect(names(tabsOf({ ...withRoles, views: [...views, view(6, 'Triage', `status:${inbox} is:open`)] }))).toEqual(['1 Ready', '2 Bugs', '3 Mine', '4 Triage', '5 All', '6 Closed'])
  expect(names(tabsOf({ ...many, roles: { inbox: 'S0' } }))).toEqual(['1 V1', '2 V2', '3 V3', '4 V4', '5 V5', '6 V6', '7 Inbox', '8 All', '9 Closed'])
  // The board's own filters: without views, or when the only view is GitHub's unfiltered default.
  const builtIn = ['1 Now', '2 Later', '3 Bugs', '4 Mine', '5 All', '6 Inbox', '7 Closed']
  expect(names(tabsOf({ ...withRoles, views: [] }))).toEqual(builtIn)
  expect(names(tabsOf({ ...withRoles, views: [view(1, 'View 1', '')] }))).toEqual(builtIn)
  expect(names(tabsOf(null))).toEqual(['1 Active', '2 Future', '3 Bugs', '4 Mine', '5 All', '7 Closed'])

  // A built-in filter chosen before the views became the tabs lands on the first; All keeps its place; a view since
  // removed lands on the first built-in filter.
  expect(tabOf(tabsOf(project), 'active').id).toBe('view:2')
  expect(tabOf(tabsOf(project), 'all').id).toBe('all')
  expect(tabOf(tabsOf({ ...withRoles, views: [] }), 'view:3').id).toBe('active')
})

test("a view's grouping and the fields its filter names are what the board reads and groups by", () => {
  const project = {
    ...PROJECT,
    views: [
      view(1, 'By area', 'area:UI,Engine', { groupBy: 'Area' }),
      view(2, 'Board', 'no:story-points', { layout: 'board', groupBy: 'Status' }),
      view(3, 'Labels', 'label:bug', { groupBy: 'Labels' }),
      view(4, 'Epics', 'is:open', { groupBy: 'Parent issue' }),
    ],
  }
  expect(viewFieldsOf(project)).toEqual(['Area', 'Story points'])
  expect(viewFieldsOf(PROJECT)).toEqual([])
  expect(project.views.map(one => viewGroupingOf(one, project))).toEqual([{ by: 'view', field: 'Area' }, { by: 'status', field: 'Status' }, null, { by: 'epic', field: 'Parent issue' }])
  // Grouped by Area: its options in the project's order, then the issues with none.
  expect(groupsOf(ISSUES, 'view', project, 'Area').map(group => [group.title, group.issues.map(one => one.number)])).toEqual([
    ['Engine', [3]],
    ['UI', [1]],
    ['No Area', [2, 4]],
  ])
})

test('the issues query reads the views, and the field values they need by name, and the answer reads back', () => {
  const query = issuesQuery(true, ['Area', 'Say "hi"'])
  expect(query).toContain('views(first: 20, orderBy: {field: POSITION, direction: ASC}) { nodes { name number layout filter groupByFields')
  expect(query).toContain('f0: fieldValueByName(name: "Area")')
  expect(query).toContain('f1: fieldValueByName(name: "Say \\"hi\\"")')
  expect(issuesQuery(false, ['Area'])).not.toMatch(/views|fieldValueByName/)

  const argv = ['gh', 'api', 'graphql', `query=${issuesQuery(true, ['Area'])}`]
  const views: Views = {
    views: [
      { name: 'Ready', number: 2, layout: 'TABLE_LAYOUT', filter: 'status:Ready', groupBy: 'Area' },
      { name: 'Board', number: 3, layout: 'BOARD_LAYOUT', filter: null, columns: 'Status' },
    ],
    fields: [AREA],
  }
  const { project, issues } = parseGraph([graphPage([{ number: 1, title: 'One', labels: [], body: null, updatedAt: '', status: 'Ready', fields: { Area: 'UI' } }], argv, true, [], views)], undefined, ['Area'])
  expect(project?.views).toEqual([
    { name: 'Ready', number: 2, layout: 'table', filter: 'status:Ready', groupBy: 'Area' },
    { name: 'Board', number: 3, layout: 'board', filter: '', groupBy: 'Status' },
  ])
  expect(issues[0]?.fields).toEqual({ Area: 'UI' })
})

const AREA = { id: 'F_area', name: 'Area', dataType: 'SINGLE_SELECT', options: [{ id: 'A0', name: 'Engine' }, { id: 'A1', name: 'UI' }] }

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const RAW = [
  { number: 1, title: 'Pirates in cruise', labels: [{ name: 'bug', color: '' }], assignees: [{ login: 'astrosteveo' }], body: null, updatedAt: '2026-10-03T20:00:00Z', status: 'Ready', fields: { Area: 'UI' } },
  { number: 2, title: 'Docs for drive', labels: [{ name: 'bug', color: '' }], body: null, updatedAt: '2026-10-03T19:00:00Z', status: 'Done' },
  { number: 3, title: 'Engine idles', labels: [{ name: 'docs', color: '' }], assignees: [{ login: 'alice' }], body: null, updatedAt: '2026-10-03T18:00:00Z', status: 'Backlog', fields: { Area: 'Engine' } },
]

const VIEWS: RawView[] = [
  { name: 'View 1', number: 1, layout: 'TABLE_LAYOUT', filter: null },
  { name: 'Ready', number: 2, layout: 'TABLE_LAYOUT', filter: 'status:Ready' },
  { name: 'Open bugs', number: 3, layout: 'BOARD_LAYOUT', filter: 'label:bug -status:Done', columns: 'Status' },
  { name: 'My work', number: 4, layout: 'TABLE_LAYOUT', filter: 'assignee:@me', groupBy: 'Area' },
  { name: 'Recent docs', number: 6, layout: 'TABLE_LAYOUT', filter: 'label:docs updated:>@today-7d' },
]

// GitHub with the project and its views; each issues query asked is kept.
const world = (on: On, views: RawView[]) => {
  adoptedStore(on)
  const asked: string[][] = []
  on('process.run', async (_$, e) => {
    const argv = e.argv
    let stdout = '[]'
    if (isIssuesQuery(argv)) {
      asked.push([...argv])
      stdout = graphPage(RAW, argv, true, [], { views, fields: [AREA] })
    } else if (argv[1] === 'repo') stdout = JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true })
    else if (argv[1] === 'api' && argv[2] === 'user') stdout = 'astrosteveo\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return asked
}

test("the pane's tabs are the project's views, each with the issues its filter keeps, grouped as the view groups", async ($, on) => {
  const asked = world(on, VIEWS)
  await $.command.run(REFRESH)
  // The first read found a view grouping by Area, so it read the issues again with each one's Area.
  expect(asked.length).toBe(2)
  expect(asked[0]?.some(arg => arg.includes('fieldValueByName(name: "Area")'))).toBe(false)
  expect(asked[1]?.some(arg => arg.includes('f0: fieldValueByName(name: "Area")'))).toBe(true)
  // The next read asks for Area from the start.
  await $.command.run(REFRESH)
  expect(asked.length).toBe(3)
  expect(asked[2]?.some(arg => arg.includes('f0: fieldValueByName(name: "Area")'))).toBe(true)

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  // The unfiltered View 1 is left out: All shows the same.
  const tabs = (await ui.findAll({ type: 'Button' })).filter(button => String(button.props.key ?? '').startsWith('filter-'))
  expect(tabs.map(tab => [tab.props.hotkey, tab.text])).toEqual([
    ['1', 'Ready 1'],
    ['2', 'Open bugs 1'],
    ['3', 'My work 1'],
    ['4', 'Recent docs 1'],
    ['5', 'Inbox 0'],
    ['6', 'All 3'],
    ['7', 'Closed'],
  ])
  // The first view's tab shows first.
  expect(await ui.find({ key: 'filter-view:2' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'issue-1' })).toBeDefined()
  expect(await ui.find({ key: 'issue-3' })).toBeUndefined()

  // My work is the person's issues, grouped by Area as the view is, with Area among the groupings.
  await ui.press({ key: 'filter-view:4' })
  expect(await ui.find({ key: 'issue-1' })).toBeDefined()
  expect(await ui.find({ key: 'issue-2' })).toBeUndefined()
  expect(await ui.find({ key: 'group-view' })).toMatchObject({ text: 'Area', props: { variant: 'primary' } })
  expect((await ui.findAll({ type: 'Text' })).some(text => text.text === 'UI')).toBe(true)
  expect(await ui.find({ key: 'view-note' })).toBeUndefined()

  // A filter term the board can't apply is named, with a link to the view.
  await ui.press({ key: 'filter-view:6' })
  // The view has no grouping, so the tab goes back to Status, where #3 waits in the folded Backlog.
  expect(await ui.find({ key: 'group-status:Backlog' })).toBeDefined()
  expect(await ui.find({ key: 'group-status:Ready' })).toBeUndefined()
  expect((await ui.find({ key: 'view-note' }))?.text).toContain("The board can't apply `updated:>@today-7d` from this view's filter")
  expect((await ui.findAll({ type: 'Link' })).find(link => link.props.label === '↗ Open the view')?.props).toMatchObject({ href: 'https://github.com/users/astrosteveo/projects/8/views/6', label: '↗ Open the view' })

  // The open-bugs board groups by its columns, Status.
  await ui.press({ key: 'filter-view:3' })
  expect(await ui.find({ key: 'group-status' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'group-view' })).toBeUndefined()
  await ui.unmount()

  // /issues help names the tabs in use.
  const help = String((await $.command.run({ ...REFRESH, args: 'help' })).text)
  expect(help).toContain("Filters, from the project's views: 1 Ready, 2 Open bugs, 3 My work, 4 Recent docs, 5 Inbox, 6 All, 7 Closed.")
})

test("a project whose only view is GitHub's unfiltered default keeps the built-in tabs", async ($, on) => {
  const asked = world(on, [VIEWS[0]!])
  await $.command.run(REFRESH)
  // No view needs a field beyond Status, so one read does.
  expect(asked.length).toBe(1)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'filter-active' })).toMatchObject({ props: { hotkey: '1' } })
  expect(await ui.find({ key: 'filter-view:1' })).toBeUndefined()
  await ui.unmount()
  const help = String((await $.command.run({ ...REFRESH, args: 'help' })).text)
  expect(help).toContain('Filters: 1 Now, 2 Later, 3 Bugs, 4 Mine, 5 All, 6 Inbox, 7 Closed.')
})

