import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseIssues } from '../hooks/parse'
import { changeText, kindsText, planAsk, planOf, rowText, sizeText, viewNoteOf } from '../hooks/plan'
import type { Project } from '../types'
import { PRIORITIES, STATUSES, adoptedStore, graphPage, isIssuesQuery, optionId } from './graph'
import type { RawView } from './graph'
import { permissions } from './engine'

const TOOL = 'mcp__issue-board__project_plan'
const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }

const raw = (number: number, title: string, labels: string[] = []) => ({
  number,
  title,
  url: `https://github.com/astrosteveo/void-sector/issues/${number}`,
  labels: labels.map(name => ({ name, color: '0e8a16' })),
  assignees: [],
  body: `${title}.\n\n## Acceptance\n\n- [ ] It works`,
  updatedAt: '2026-10-03T20:00:00Z',
})

const PROJECT: Project = {
  id: 'PVT_8',
  number: 8,
  title: 'Void Sector',
  url: '',
  status: { id: 'F_status', options: STATUSES.map((name, index) => ({ id: `S${index}`, name })) },
  priority: { id: 'F_priority', options: PRIORITIES.map((name, index) => ({ id: `P${index}`, name })) },
  fields: [{ id: 'F_estimate', name: 'Estimate', kind: 'number' }],
}
const ISSUES = parseIssues(JSON.stringify([raw(340, 'Saves drop the hangar'), raw(341, 'The map key hides the legend'), raw(315, 'Lay Kessik out for play')]))
const MILESTONES = [{ number: 3, title: 'Launch', due: null, description: '', open: 0, closed: 0 }]

// The Void Sector project: #340 in the Inbox, #341 in the Backlog, #315 Ready. `failEdit` has gh refuse to edit that
// issue. Every write to GitHub is kept, the project's and the issues' alike.
const world = (on: On, adopted = true) => {
  if (adopted) adoptedStore(on)
  else mock.store(on)
  const state = {
    planned: { 340: { status: 'Inbox' }, 341: { status: 'Backlog', priority: 'P2' }, 315: { status: 'Ready', priority: 'P1' } } as Record<number, { status?: string; priority?: string }>,
    // In the project's own order: #315, #341, then #340.
    issues: [{ ...raw(340, 'Saves drop the hangar'), position: 2 }, { ...raw(341, 'The map key hides the legend', ['area:ui']), position: 1 }, { ...raw(315, 'Lay Kessik out for play'), position: 0 }],
    writes: [] as string[],
    reads: 0,
    failEdit: 0,
    toasts: [] as string[],
    // The project's views, as GitHub keeps them; the view writes change them, so the next read has them.
    views: [] as RawView[],
  }
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    const answer = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer('main\n')
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (isIssuesQuery(argv)) {
      state.reads += 1
      return answer(graphPage(state.issues.map(one => ({ ...one, ...state.planned[one.number] })), argv, true, [], { views: state.views }))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv.includes('--input')) {
      const asked = JSON.parse(e.init?.stdin ?? '{}') as { query: string; variables: Record<string, unknown> }
      const view = viewWrite(state, asked)
      if (view) return answer(JSON.stringify(view))
      if (asked.query.includes('updateProjectV2ItemPosition')) {
        state.writes.push(`move ${String(asked.variables.item)} after ${String(asked.variables.after)}`)
        // The project's order as GitHub keeps it, so the next read has the move.
        const item = (number: number) => `PVTI_${number}`
        const order = [...state.issues].sort((a, b) => a.position - b.position).map(one => one.number).filter(number => item(number) !== asked.variables.item)
        const at = asked.variables.after ? order.findIndex(number => item(number) === asked.variables.after) + 1 : 0
        order.splice(at, 0, Number(String(asked.variables.item).slice('PVTI_'.length)))
        state.issues = state.issues.map(one => ({ ...one, position: order.indexOf(one.number) }))
      }
      else if (/^\s*mutation\b/.test(asked.query)) state.writes.push(`${String(asked.variables.item)} ${String(asked.variables.field)} ${JSON.stringify(asked.variables.value)}`)
      if (asked.query.includes('fieldValues')) return answer(JSON.stringify({ data: { node: { fieldValues: { nodes: [] } } } }))
      return answer(JSON.stringify({ data: {} }))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql') {
      const args = Object.fromEntries(argv.flatMap((arg, index) => (argv[index - 1] === '-f' ? [arg.split(/=(.*)/s).slice(0, 2) as [string, string]] : [])))
      if (args.query?.includes('reviewThreads')) return answer(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }))
      const number = Number(args.item?.slice('PVTI_'.length))
      const name = [...STATUSES, ...PRIORITIES].find(one => optionId(one) === args.option) ?? ''
      state.writes.push(`#${number} ${args.field === 'F_status' ? 'Status' : 'Priority'} ${name}`)
      state.planned[number] = { ...state.planned[number], ...(args.field === 'F_status' ? { status: name } : { priority: name }) }
      return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: args.item } } } }))
    }
    if (argv[1] === 'api' && argv[2]?.includes('/milestones')) return answer(JSON.stringify([{ number: 3, title: 'Launch', state: 'open', due_on: null, open_issues: 0, closed_issues: 0 }]))
    if (argv[1] === 'api' && argv[2]?.endsWith('/labels?per_page=100')) return answer(JSON.stringify([{ name: 'bug' }, { name: 'area:ui' }]))
    if (argv[1] === 'api') return answer('astrosteveo\n')
    if (argv[1] === 'issue' && argv[2] === 'edit') {
      if (Number(argv[3]) === state.failEdit) return answer('', 1, "could not add label: 'wontfix' not found")
      state.writes.push(argv.slice(1).join(' '))
      return answer('')
    }
    return answer('[]')
  })
  const engine = permissions(on)
  // The engine's own band, beneath the board's.
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.log', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  return Object.assign(state, { engine })
}

const PLAN = {
  issues: [
    { number: 340, reason: 'Losing the hangar breaks saves.', status: 'Ready', priority: 'P0' },
    { number: 341, reason: 'It is a bug, not a feature.', addLabels: ['bug'], removeLabels: ['area:ui'] },
    { number: 315, reason: 'Ships with the launch.', milestone: 'Launch' },
  ],
}

test('a plan is checked whole: every problem is listed at once, and a valid plan becomes rows grouped by issue', () => {
  const context = { issues: ISSUES, project: PROJECT, milestones: MILESTONES, refusal: null }
  const refused = planOf(
    {
      issues: [
        { number: 340, reason: 'Soon.', status: 'Someday' },
        { number: 999, reason: 'Gone.', priority: 'P1' },
        { number: 341, priority: 'P1' },
        { number: 315, reason: 'Sized.', fields: { Estimate: 'lots', Colour: 'red' } },
        { number: 315, reason: 'Say so.', comment: 'Hi' },
        { number: 341, reason: 'Later.', milestone: 'Nope' },
        { number: 340, reason: 'Loop.', parent: 340 },
        { number: 340, reason: 'Nothing.' },
        { reason: 'Which?' },
      ],
    },
    context,
  )
  expect(refused).toEqual({
    problems: [
      '#340: Void Sector has no Status called Someday; it has Inbox, Backlog, Ready, In progress, Verification, Done.',
      "#999 isn't an open issue on the board.",
      '#341 has no reason.',
      '#315: Estimate takes a number, not lots.',
      '#315: Void Sector has no field called Colour.',
      "#315: a plan can't change comment; use issue_update for that.",
      '#341: the repo has no open milestone called Nope.',
      "#340 can't be its own parent.",
      '#340 changes nothing.',
      'Entry 9 has no issue number.',
    ],
  })
  expect(planOf({}, context)).toEqual({ problems: ['Give issues or views: lists of changes, each with a reason.'] })
  expect(planOf({ issues: [{ number: 340, reason: 'a', status: 'Ready' }, { number: 340, reason: 'b', status: 'Backlog' }] }, context)).toEqual({
    problems: ["#340's Status is in the plan twice."],
  })

  const made = planOf(
    {
      issues: [
        { number: 340, reason: 'Saves break.', status: 'ready', priority: 'P0', addLabels: ['bug'] },
        { number: 315, reason: 'Small.', fields: { Estimate: 3 }, milestone: 'launch', parent: 0 },
        { number: 340, reason: 'Mine.', assign: ['@me'] },
      ],
    },
    context,
  )
  if (!('changes' in made)) throw new Error(made.problems.join('\n'))
  // Grouped by issue, in the order the issues first come, each with its entry's reason; option names as the project has them.
  expect(made.changes.map(({ change, reason }) => `${rowText(change)} (${reason})`)).toEqual([
    '#340 Status → Ready (Saves break.)',
    '#340 Priority → P0 (Saves break.)',
    '#340 labels +bug (Saves break.)',
    '#340 assignees +@me (Mine.)',
    '#315 Estimate → 3 (Small.)',
    '#315 milestone → Launch (Small.)',
    '#315 out of its epic (Small.)',
  ])
  const changes = made.changes.map(one => one.change)
  expect(kindsText(changes)).toBe('Status 1 · Priority 1 · labels 1 · assignees 1 · fields 1 · milestone 1 · parent 1')
  expect(planAsk(changes)).toBe("Apply Claude's plan: 7 changes to 2 issues?\nStatus 1 · Priority 1 · labels 1 · assignees 1 · fields 1 · milestone 1 · parent 1\nThe /issues pane shows it row by row, to apply only some.")

  // A project the board may not write to refuses a plan that changes it, but not one that only changes the issues.
  const unadopted = { ...context, refusal: 'The issue board only reads Void Sector.' }
  expect(planOf({ issues: [{ number: 340, reason: 'Soon.', status: 'Ready', addLabels: ['bug'] }] }, unadopted)).toEqual({ problems: ['The issue board only reads Void Sector.'] })
  expect('changes' in planOf({ issues: [{ number: 340, reason: 'A bug.', addLabels: ['bug'] }] }, unadopted)).toBe(true)
})

test("Claude's plan asks once with a summary and shows on the card and the band; a no writes nothing, a yes applies it all", async ($, on) => {
  const gh = world(on)
  await $.command.run(REFRESH)

  // The permission prompt sums the plan up.
  const verdict = await $.tool.check({ tool: TOOL, input: PLAN })
  expect(verdict).toMatchObject({ decision: 'ask', reason: "Apply Claude's plan: 4 changes to 3 issues?\nStatus 1 · Priority 1 · labels 1 · milestone 1\nThe /issues pane shows it row by row, to apply only some." })

  // A no changes nothing on GitHub, and leaves the plan on the card for the person.
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'no'
  const no = await $.tool.call({ tool: TOOL, ...PLAN })
  expect(no).toMatchObject({ isError: true, text: `Permission to use ${TOOL} was denied` })
  expect(gh.engine.asked).toEqual([TOOL])
  expect(gh.writes).toEqual([])

  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /^Claude's plan: 4 changes to 3 issues$/ })).toBeDefined()
  expect(await band.find({ key: 'plan-review' })).toBeDefined()
  await band.unmount()

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^Claude's plan · 4 changes to 3 issues$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button', text: /^[☑☐] / })).map(one => one.text)).toEqual(['☑ Status → Ready', '☑ Priority → P0', '☑ labels +bug −area:ui', '☑ milestone → Launch'])
  expect(await ui.find({ text: /^Losing the hangar breaks saves\.$/ })).toBeDefined()
  expect(await ui.find({ key: 'plan-apply' })).toMatchObject({ text: '✓ Apply 4 of 4' })
  expect(await ui.find({ key: 'plan-discard' })).toBeDefined()

  // A yes applies every row, then reads the board once, and the card and the band's line go.
  gh.engine.answer = 'yes'
  const reads = gh.reads
  const yes = await $.tool.call({ tool: TOOL, ...PLAN })
  expect(String(yes.result)).toBe(
    [
      'Applied the plan: 4 changes.',
      '#340 moved to Ready.',
      '#340 set to P0.',
      '#341 labelled bug, unlabelled area:ui.',
      '#315 put on the milestone Launch.',
    ].join('\n'),
  )
  expect(gh.writes).toEqual(['#340 Status Ready', '#340 Priority P0', 'issue edit 341 --add-label bug --remove-label area:ui', 'issue edit 315 --milestone Launch'])
  expect(gh.reads).toBe(reads + 1)
  expect(await ui.find({ key: 'plan-card' })).toBeUndefined()
  await ui.unmount()
  // With nothing else to say, the band draws nothing of the board's, only what the engine beneath draws.
  const after = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await after.find({ key: 'engine' })).toBeDefined()
  expect(await after.find({ key: 'plan-review' })).toBeUndefined()
  await after.unmount()
})

test('Apply on the card writes only the ticked rows, and a row that fails stays with why; Discard drops the plan', async ($, on) => {
  const gh = world(on)
  await $.command.run(REFRESH)
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'no'
  await $.tool.call({ tool: TOOL, ...PLAN })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })

  // The person unticks #340's Priority, and gh refuses #341's labels.
  await ui.press({ key: 'plan-pick-340-2' })
  expect(await ui.find({ key: 'plan-pick-340-2' })).toMatchObject({ text: '☐ Priority → P0' })
  expect(await ui.find({ key: 'plan-apply' })).toMatchObject({ text: '✓ Apply 3 of 4' })
  gh.failEdit = 341
  await ui.press({ key: 'plan-apply' })
  expect(gh.writes).toEqual(['#340 Status Ready', 'issue edit 315 --milestone Launch'])
  expect(gh.planned[340]).toEqual({ status: 'Ready' })
  expect(gh.toasts.at(-1)).toBe('Applied 2 of 3 changes. 1 failed and stays on the plan card in /issues.')

  // Only the failed row is left, ticked, saying why; the unticked one went with the rest.
  expect((await ui.findAll({ type: 'Button', text: /^[☑☐] / })).map(one => one.text)).toEqual(['☑ labels +bug −area:ui'])
  expect(await ui.find({ text: /^✗ could not add label: 'wontfix' not found$/ })).toBeDefined()
  expect(await ui.find({ text: /^Applied 2 of 3 changes\./ })).toBeDefined()

  await ui.press({ key: 'plan-discard' })
  expect(await ui.find({ key: 'plan-card' })).toBeUndefined()
  expect(gh.writes.length).toBe(2)
  await ui.unmount()
})

test("a plan ranks issues in the project's order, each move after the one before it", async ($, on) => {
  const gh = world(on)
  gh.planned = { 340: { status: 'Ready' }, 341: { status: 'Ready' }, 315: { status: 'Ready' } }
  await $.command.run(REFRESH)
  const order = { issues: [{ number: 340, reason: 'Most pressing.', projectAfter: 0 }, { number: 315, reason: 'Next.', projectAfter: 340 }] }
  expect(await $.tool.check({ tool: TOOL, input: order })).toMatchObject({ reason: expect.stringMatching(/^Apply Claude's plan: 2 changes to 2 issues\?\norder 2\n/) })
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'no'
  await $.tool.call({ tool: TOOL, ...order })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  const rows = async () => (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => /^issue-3\d\d$/.test(key))
  expect(await rows()).toEqual(['issue-315', 'issue-341', 'issue-340'])
  expect((await ui.findAll({ type: 'Button', text: /^[☑☐] / })).map(one => one.text)).toEqual(["☑ top of the project's order", '☑ after #340 in the order'])
  await ui.press({ key: 'plan-apply' })
  expect(gh.writes).toEqual(['move PVTI_340 after null', 'move PVTI_315 after PVTI_340'])
  expect(gh.toasts.at(-1)).toBe('Applied the plan: 2 changes.')
  // The pane shows the new order once the plan is applied.
  expect(await rows()).toEqual(['issue-340', 'issue-315', 'issue-341'])
  await ui.unmount()

  // A move the project can't make is refused with the rest of the plan's problems.
  const refused = await $.tool.call({ tool: TOOL, issues: [{ number: 340, reason: 'Loop.', projectAfter: 340 }, { number: 341, reason: 'Gone.', projectAfter: 999 }] })
  expect(refused.deny).toBe(
    [
      "The plan wasn't made. Fix these and call again:",
      "- #340: can't move beside itself.",
      "- #341: #999 isn't an open issue the board has in the project's order.",
    ].join('\n'),
  )
})

test("an invalid plan is refused with every problem, and nothing is shown or asked", async ($, on) => {
  const gh = world(on)
  await $.command.run(REFRESH)
  gh.engine.verdict = 'ask'
  const answer = await $.tool.call({ tool: TOOL, issues: [{ number: 340, reason: 'Soon.', status: 'Someday' }, { number: 999, reason: 'Gone.', priority: 'P1' }] })
  expect(answer.deny).toBe(
    [
      "The plan wasn't made. Fix these and call again:",
      '- #340: Void Sector has no Status called Someday; it has Inbox, Backlog, Ready, In progress, Verification, Done.',
      "- #999 isn't an open issue on the board.",
    ].join('\n'),
  )
  expect(gh.engine.asked).toEqual([])
  expect(gh.writes).toEqual([])
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'plan-card' })).toBeUndefined()
  await ui.unmount()
})

test('a project nobody let the board write to refuses a plan that changes it, before anything is asked', async ($, on) => {
  const gh = world(on, false)
  await $.command.run(REFRESH)
  gh.engine.verdict = 'ask'
  const answer = await $.tool.call({ tool: TOOL, ...PLAN })
  expect(answer.deny).toMatch(/^The plan wasn't made\. Fix this and call again:\n- The issue board only reads Void Sector: nobody has let it write there\./)
  expect(gh.engine.asked).toEqual([])
  expect(gh.writes).toEqual([])
})

// The view reads and writes a plan makes, answered as GitHub would, each write kept. A view's id is PVTV_ and its number.
function viewWrite(state: { views: RawView[]; writes: string[] }, asked: { query: string; variables: Record<string, any> }) {
  const idOf = (number: number) => `PVTV_${number}`
  const numberOf = (id: unknown) => Number(String(id).slice('PVTV_'.length))
  if (asked.query.includes('view(number:')) {
    const found = state.views.find(one => one.number === asked.variables.number)
    return { data: { node: { view: found ? { id: idOf(found.number) } : null } } }
  }
  if (asked.query.includes('createProjectV2View')) {
    const input = asked.variables.input as { projectId: string; name: string; layout: RawView['layout'] }
    const number = Math.max(0, ...state.views.map(one => one.number)) + 1
    state.views = [...state.views, { name: input.name, number, layout: input.layout, filter: null }]
    state.writes.push(`create view ${input.name} ${input.layout} in ${input.projectId}`)
    return { data: { createProjectV2View: { projectV2View: { id: idOf(number), number } } } }
  }
  if (asked.query.includes('updateProjectV2View')) {
    const { viewId, ...rest } = asked.variables.input as { viewId: string; name?: string; layout?: RawView['layout']; filter?: string }
    state.views = state.views.map(one => (one.number === numberOf(viewId) ? { ...one, ...rest } : one))
    state.writes.push(`update view ${viewId} ${JSON.stringify(rest)}`)
    return { data: { updateProjectV2View: { projectV2View: { id: viewId } } } }
  }
  if (asked.query.includes('deleteProjectV2View')) {
    state.views = state.views.filter(one => one.number !== numberOf(asked.variables.view))
    state.writes.push(`delete view ${String(asked.variables.view)}`)
    return { data: { deleteProjectV2View: { projectV2View: { id: asked.variables.view } } } }
  }
  return null
}

// Void Sector's views: Bugs and Old with filters, so they are tabs, and Everything with none.
const VIEWS: RawView[] = [
  { name: 'Bugs', number: 1, layout: 'TABLE_LAYOUT', filter: 'label:bug' },
  { name: 'Old', number: 2, layout: 'BOARD_LAYOUT', filter: 'label:old' },
  { name: 'Everything', number: 3, layout: 'TABLE_LAYOUT', filter: null },
]
const PROJECT_VIEWS = [
  { name: 'Bugs', number: 1, layout: 'table' as const, filter: 'label:bug', groupBy: null },
  { name: 'Old', number: 2, layout: 'board' as const, filter: 'label:old', groupBy: null },
  { name: 'Everything', number: 3, layout: 'table' as const, filter: '', groupBy: null },
]
const VIEW_PLAN = {
  views: [
    { reason: 'Ready work for this sprint.', name: 'Sprint', layout: 'board', filter: 'status:Ready sprint:@current' },
    { view: 'bugs', reason: 'Bugs that are ready.', name: 'Ready bugs', filter: 'label:bug status:Ready' },
    { view: 2, reason: 'Nobody uses it.', delete: true },
  ],
}

test('a plan creates, changes and deletes views, flags filter terms the board cannot apply, and checks each entry', () => {
  const context = { issues: ISSUES, project: { ...PROJECT, views: PROJECT_VIEWS }, milestones: MILESTONES, refusal: null }
  const made = planOf({ ...VIEW_PLAN, issues: [{ number: 340, reason: 'Saves break.', status: 'Ready' }] }, context)
  if (!('changes' in made)) throw new Error(made.problems.join('\n'))
  const changes = made.changes.map(one => one.change)
  // The issues first, then the views in the plan's order. A delete names the view and its filter.
  expect(changes.map(rowText)).toEqual([
    '#340 Status → Ready',
    'new board view Sprint · status:Ready sprint:@current',
    'view Bugs: renamed Ready bugs, filter label:bug status:Ready',
    'delete view Old · label:old',
  ])
  expect(sizeText(changes)).toBe('4 changes to 1 issue and 3 views')
  expect(kindsText(changes)).toBe('Status 1 · views 3')
  // Only the new view's filter holds a term the board can't apply: `@current` is an iteration.
  expect(changes.map(viewNoteOf)).toEqual([
    null,
    "The board can't apply sprint:@current, so its tab in /issues leaves that term out and shows more than GitHub does.",
    null,
    null,
  ])
  expect(changeText({ kind: 'view', view: PROJECT_VIEWS[2] ?? null, to: null, partial: [] })).toBe('delete view Everything · no filter')
  expect(changeText({ kind: 'view', view: PROJECT_VIEWS[0] ?? null, to: { name: 'Bugs', layout: 'table', filter: '' }, partial: [] })).toBe('view Bugs: filter cleared')

  const refused = planOf(
    {
      views: [
        { view: 9, reason: 'Gone.', name: 'Nine' },
        { reason: 'Which?', delete: true },
        { view: 'Old', reason: 'Tidy.', delete: true, name: 'Older' },
        { reason: 'Nameless.', filter: 'label:bug' },
        { name: 'Wide', reason: 'Wide.', layout: 'gantt' },
        { view: 1, reason: 'Same.', name: 'Bugs' },
        { name: 'Docs', filter: 'label:docs', colour: 'red' },
      ],
    },
    context,
  )
  expect(refused).toEqual({
    problems: [
      'View 9: Void Sector has no such view; it has Bugs (1), Old (2), Everything (3).',
      'New view (entry 2): give view, the view to delete.',
      "View Old: a view that's deleted takes no name, layout or filter.",
      'New view (entry 4) has no name.',
      'New view Wide: a layout is table, board or roadmap, not gantt.',
      'View 1 changes nothing.',
      'New view Docs has no reason.',
      "New view Docs: a view entry can't hold colour.",
    ],
  })
  expect(planOf({ views: [{ name: 'A', reason: 'a' }, { name: 'a', reason: 'b' }] }, context)).toEqual({ problems: ['View a is in the plan twice.'] })

  // Views are the project's, so a project the board may not write to refuses them, and with no project there are none.
  expect(planOf(VIEW_PLAN, { ...context, refusal: 'The issue board only reads Void Sector.' })).toEqual({ problems: ['The issue board only reads Void Sector.'] })
  expect(planOf({ views: [{ name: 'Sprint', reason: 'Soon.' }] }, { ...context, project: null })).toEqual({
    problems: ["New view Sprint: the board reads no project, so it can't change its views."],
  })
})

test('applying a plan writes the views through the project write check, and the pane shows them as tabs', async ($, on) => {
  const gh = world(on)
  gh.views = [...VIEWS]
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  const tabs = async () => (await ui.findAll({ type: 'Button' })).filter(one => String(one.key ?? '').startsWith('filter-')).map(one => `${one.key} ${one.text}`)
  expect(await tabs()).toEqual(['filter-view:1 Bugs 0', 'filter-view:2 Old 0', 'filter-all All 3', 'filter-closed Closed'])

  expect(await $.tool.check({ tool: TOOL, input: VIEW_PLAN })).toMatchObject({ reason: expect.stringMatching(/^Apply Claude's plan: 3 changes to 3 views\?\nviews 3\n/) })
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'no'
  await $.tool.call({ tool: TOOL, ...VIEW_PLAN })
  // The card lists the views under the project, and flags the filter the board can only partly apply.
  expect(await ui.find({ text: /^Claude's plan · 3 changes to 3 views$/ })).toBeDefined()
  expect(await ui.find({ text: /^Void Sector views$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button', text: /^[☑☐] / })).map(one => one.text)).toEqual([
    '☑ new board view Sprint · status:Ready sprint:@current',
    '☑ view Bugs: renamed Ready bugs, filter label:bug status:Ready',
    '☑ delete view Old · label:old',
  ])
  expect((await ui.findAll({ type: 'Text', text: /^⚠ / })).map(one => one.text)).toEqual([
    "⚠ The board can't apply sprint:@current, so its tab in /issues leaves that term out and shows more than GitHub does.",
  ])

  await ui.press({ key: 'plan-apply' })
  // A new view's filter goes in by a change straight after it is made; a change sends only what changes.
  expect(gh.writes).toEqual([
    'create view Sprint BOARD_LAYOUT in PVT_8',
    'update view PVTV_4 {"filter":"status:Ready sprint:@current"}',
    'update view PVTV_1 {"name":"Ready bugs","filter":"label:bug status:Ready"}',
    'delete view PVTV_2',
  ])
  expect(gh.toasts.at(-1)).toBe('Applied the plan: 3 changes.')
  expect(await ui.find({ key: 'plan-card' })).toBeUndefined()
  // The new and changed views are tabs now, and the deleted one is gone.
  expect(await tabs()).toEqual(['filter-view:1 Ready bugs 0', 'filter-view:4 Sprint 1', 'filter-all All 3', 'filter-closed Closed'])
  await ui.unmount()
})

test('a project nobody let the board write to refuses view changes, before anything is asked', async ($, on) => {
  const gh = world(on, false)
  gh.views = [...VIEWS]
  await $.command.run(REFRESH)
  gh.engine.verdict = 'ask'
  const answer = await $.tool.call({ tool: TOOL, ...VIEW_PLAN })
  expect(answer.deny).toMatch(/^The plan wasn't made\. Fix this and call again:\n- The issue board only reads Void Sector: nobody has let it write there\./)
  expect(gh.engine.asked).toEqual([])
  expect(gh.writes).toEqual([])
})
