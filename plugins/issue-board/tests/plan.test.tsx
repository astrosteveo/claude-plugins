import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseIssues } from '../hooks/github'
import { PLAN_LIMIT, alreadyTrue, cardParts, changeText, kindsText, planAsk, planOf, rowText, rowsOf, sizeText, viewDoneText, viewNoteOf } from '../hooks/plan'
import type { PlanChange, Project } from '../types'
import { permissions } from './engine'
import { adoptedStore, fail, fakeGitHub, json, ok, session } from './github'
import type { Route } from './github'
import { PRIORITIES, STATUSES, graphArgs, graphPage, isIssuesQuery, isItemWrite, optionId } from './graph'
import type { RawView } from './graph'
import { REFRESH, REPO, band, engineBand, pane } from './ui'

const TOOL = 'mcp__issue-board__project_plan'
const PANE = pane(120, 80)
const BAND = band(120)

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
    // The repo's labels, which label writes change, and how many open and closed issues search finds with each.
    labels: ['bug', 'area:ui', 'wontfix'],
    uses: { wontfix: { open: 3, closed: 2 } } as Record<string, { open: number; closed: number }>,
    failSearch: false,
  }
  const route: Route = ({ argv, stdin }) => {
    if (isIssuesQuery(argv)) {
      state.reads += 1
      return ok(graphPage(state.issues.map(one => ({ ...one, ...state.planned[one.number] })), argv, true, [], { views: state.views }, state.labels))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv.includes('--input') && !isItemWrite(argv, stdin)) {
      const asked = JSON.parse(stdin ?? '{}') as { query: string; variables: Record<string, unknown> }
      const view = viewWrite(state, asked)
      if (view) return json(view)
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
      if (asked.query.includes('fieldValues')) return json({ data: { node: { fieldValues: { nodes: [] } } } })
      return json({ data: {} })
    }
    if (argv[1] === 'api' && argv[2] === 'graphql') {
      const args = graphArgs(argv, stdin)
      if (args.query?.includes('reviewThreads')) return undefined
      const number = Number(args.item?.slice('PVTI_'.length))
      const name = [...STATUSES, ...PRIORITIES].find(one => optionId(one) === args.option) ?? ''
      state.writes.push(`#${number} ${args.field === 'F_status' ? 'Status' : 'Priority'} ${name}`)
      state.planned[number] = { ...state.planned[number], ...(args.field === 'F_status' ? { status: name } : { priority: name }) }
      return json({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: args.item } } } })
    }
    if (argv[1] === 'api' && argv.includes('search/issues')) {
      if (state.failSearch) return fail('API rate limit exceeded')
      const q = argv[argv.indexOf('-f') + 1] ?? ''
      const label = /label:"(.*)"/.exec(q)?.[1] ?? ''
      return ok(`${state.uses[label]?.[q.includes('state:open') ? 'open' : 'closed'] ?? 0}\n`)
    }
    if (argv[1] === 'api' && argv[2] === '-X' && /\/labels(\/|$)/.test(argv[4] ?? '')) {
      const name = decodeURIComponent(argv[4]?.split('/labels/')[1] ?? '')
      const fields = argv.flatMap((arg, index) => (argv[index - 1] === '-f' ? [arg] : []))
      state.writes.push(`label ${argv[3]} ${name}${name ? ' ' : ''}${fields.join(' ')}`.trim())
      const renamed = fields.find(one => one.startsWith('new_name='))?.slice('new_name='.length)
      if (argv[3] === 'POST') state.labels = [...state.labels, fields[0]?.slice('name='.length) ?? '']
      if (argv[3] === 'DELETE') state.labels = state.labels.filter(one => one !== name)
      if (renamed) {
        state.labels = state.labels.map(one => (one === name ? renamed : one))
        state.issues = state.issues.map(one => ({ ...one, labels: one.labels.map(label => (label.name === name ? { ...label, name: renamed } : label)) }))
      }
      return ok('{}')
    }
    if (argv[1] === 'api' && argv[2]?.includes('/milestones')) return json([{ number: 3, title: 'Launch', state: 'open', due_on: null, open_issues: 0, closed_issues: 0 }])
    if (argv[1] === 'api' && argv[2]?.endsWith('/labels?per_page=100')) return json([{ name: 'bug' }, { name: 'area:ui' }])
    if (argv[1] === 'issue' && argv[2] === 'edit') {
      if (Number(argv[3]) === state.failEdit) return fail("could not add label: 'wontfix' not found")
      state.writes.push(argv.slice(1).join(' '))
      return ok('')
    }
    return undefined
  }
  fakeGitHub(on, { routes: [route] })
  const engine = permissions(on)
  // The engine's own band, beneath the board's.
  engineBand(on)
  session(on)
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
  expect(planOf({}, context)).toEqual({ problems: ['Give issues, labels or views: lists of changes, each with a reason.'] })
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

test('a plan is refused past its size limit, and for the label, parent, view and project problems each check names', () => {
  const context = { issues: ISSUES, project: PROJECT, milestones: MILESTONES, refusal: null }
  // One change past the limit is refused with the count; at the limit the plan is made.
  const labels = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `area:${index}`, reason: 'A new area.', create: true }))
  expect(PLAN_LIMIT).toBe(100)
  expect(planOf({ labels: labels(101) }, context)).toEqual({ problems: ['A plan holds at most 100 changes; this one has 101. Split it.'] })
  expect('changes' in planOf({ labels: labels(100) }, context)).toBe(true)

  // A label made and deleted at once, and a new label given a rename.
  expect(planOf({ labels: [{ name: 'area:net', reason: 'Both.', create: true, delete: true }, { name: 'area:hud', reason: 'New.', create: true, rename: 'area:ui' }] }, { ...context, labels: ['bug'] })).toEqual({
    problems: ["Label area:net can't be made and deleted at once.", 'Label area:hud: name a new label as you want it, without rename.'],
  })

  // A parent that isn't open on the board.
  expect(planOf({ issues: [{ number: 340, reason: 'Under the old epic.', parent: 999 }] }, context)).toEqual({ problems: ["#340: its parent #999 isn't an open issue on the board."] })

  // A view filter that isn't text, and a view named by a name two views share.
  const twins = { ...context, project: { ...PROJECT, views: [...PROJECT_VIEWS, { name: 'bugs', number: 4, layout: 'board' as const, filter: 'label:bug', groupBy: null }] } }
  expect(planOf({ views: [{ name: 'Sprint', reason: 'Soon.', filter: 5 }, { view: 'Bugs', reason: 'Wider.', filter: 'label:bug,defect' }] }, twins)).toEqual({
    problems: ['New view Sprint: give its filter as text.', 'View Bugs: Void Sector has 2 views called Bugs; name it by number.'],
  })

  // With no project, nothing that lives in it can be set: Status, Priority, a field or the order.
  expect(planOf({ issues: [{ number: 340, reason: 'Soon.', status: 'Ready', priority: 'P0', fields: { Estimate: 3 }, projectAfter: 0 }] }, { ...context, project: null })).toEqual({
    problems: [
      "#340: the board reads no project, so it can't set Status.",
      "#340: the board reads no project, so it can't set Priority.",
      "#340: the board reads no project, so it can't set Estimate.",
      "#340: the board reads no project, so it can't move it in the project's order.",
    ],
  })
})

test('an applied view change says what was made, and names the filter terms its tab leaves out', () => {
  const [bugs, old] = PROJECT_VIEWS
  if (!bugs || !old) throw new Error('no views')
  expect(viewDoneText({ kind: 'view', view: null, to: { name: 'Sprint', layout: 'board', filter: 'status:Ready updated:>@today-7d' }, partial: ['updated:>@today-7d'] })).toBe(
    "Created the board view Sprint with the filter status:Ready updated:>@today-7d. Its tab leaves out updated:>@today-7d, which the board can't apply.",
  )
  expect(viewDoneText({ kind: 'view', view: null, to: { name: 'Everything', layout: 'table', filter: '' }, partial: [] })).toBe('Created the table view Everything.')
  expect(viewDoneText({ kind: 'view', view: bugs, to: { name: 'Ready bugs', layout: 'table', filter: 'label:bug status:Ready' }, partial: [] })).toBe(
    'Changed the view Bugs: renamed Ready bugs, filter label:bug status:Ready.',
  )
  expect(viewDoneText({ kind: 'view', view: bugs, to: { name: 'Bugs', layout: 'roadmap', filter: 'label:bug' }, partial: [] })).toBe('Changed the view Bugs: roadmap layout.')
  expect(viewDoneText({ kind: 'view', view: old, to: null, partial: [] })).toBe('Deleted the view Old.')
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

test('in bypass or auto mode a plan is refused, stays on the card to apply in /issues, and writes nothing; default mode asks', async ($, on) => {
  const gh = world(on)
  on('classic.UserPromptSubmit', async () => ({}))
  await $.command.run(REFRESH)
  // A rule that allows the tool doesn't let a plan through unseen.
  gh.engine.beneath = 'allow'

  for (const mode of ['bypassPermissions', 'auto']) {
    await $.classic.UserPromptSubmit({ prompt: 'tidy the board', permission_mode: mode } as never)
    const reason =
      `The ${mode} permission mode settles prompts without showing them, and a plan needs the person to read it. ` +
      'The plan is on the card in /issues: ask the person to apply it there with Apply, or to switch to a mode that asks, and try again.'
    expect(await $.tool.check({ tool: TOOL, input: PLAN })).toEqual({ decision: 'deny', reason })
    gh.engine.verdict = 'allow'
    expect(await $.tool.call({ tool: TOOL, ...PLAN })).toMatchObject({ deny: reason })
    // Nothing reached the engine's prompt or GitHub.
    expect(gh.engine.asked).toEqual([])
    expect(gh.writes).toEqual([])
  }

  // The plan waits on the card.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^Claude's plan · 4 changes to 3 issues$/ })).toBeDefined()
  expect(await ui.find({ key: 'plan-apply' })).toMatchObject({ text: '✓ Apply 4 of 4' })

  // Back in default mode, the call asks with the summary again. A rule that denies still stands in every mode.
  await $.classic.UserPromptSubmit({ prompt: 'and now?', permission_mode: 'default' } as never)
  gh.engine.beneath = 'ask'
  expect(await $.tool.check({ tool: TOOL, input: PLAN })).toMatchObject({ decision: 'ask', reason: expect.stringMatching(/^Apply Claude's plan: 4 changes to 3 issues\?/) })
  gh.engine.beneath = 'deny'
  await $.classic.UserPromptSubmit({ prompt: 'again', permission_mode: 'bypassPermissions' } as never)
  expect(await $.tool.check({ tool: TOOL, input: PLAN })).toEqual({ decision: 'deny', reason: 'Denied by a rule.' })
  await $.classic.UserPromptSubmit({ prompt: 'back', permission_mode: 'default' } as never)

  // Apply on the card writes it, as the person chose there.
  await ui.press({ key: 'plan-apply' })
  expect(gh.writes).toEqual(['#340 Status Ready', '#340 Priority P0', 'issue edit 341 --add-label bug --remove-label area:ui', 'issue edit 315 --milestone Launch'])
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

test("a plan's label changes are checked against the repo's labels, come first, and say what they do to a saved marker", () => {
  const context = { issues: ISSUES, project: PROJECT, milestones: MILESTONES, refusal: null, labels: ['bug', 'area:ui', 'wontfix'], markers: { bug: { label: 'bug' }, later: 'wontfix' } }
  const refused = planOf(
    {
      labels: [
        { name: 'Bug', reason: 'Have it.', create: true },
        { name: 'nope', reason: 'Gone.', delete: true },
        { name: 'area:ui', reason: 'Clash.', rename: 'BUG' },
        { name: 'wontfix', reason: 'Red.', color: 'red' },
        { name: 'wontfix', reason: 'Again.', delete: true },
        { name: 'bug', reason: 'Both.', delete: true, color: 'ffffff' },
        { name: 'area:ui', reason: 'Nothing.' },
        { name: 'area:net', create: true, owner: 'me' },
        { reason: 'Which?' },
      ],
    },
    context,
  )
  expect(refused).toEqual({
    problems: [
      'The repo already has a label called bug.',
      'The repo has no label called nope.',
      'Label wontfix: color takes six hex digits, such as d73a4a, not red.',
      'Label bug: a delete changes nothing else.',
      'Label area:ui changes nothing.',
      'Label area:net has no reason.',
      "Label area:net: a plan can't change its owner.",
      'Label 9 has no name.',
      'Label wontfix is in the plan twice.',
      'Label bug is in the plan twice.',
      'Label area:ui is in the plan twice.',
    ],
  })

  const made = planOf(
    {
      issues: [{ number: 340, reason: 'Networking.', addLabels: ['area:net'] }],
      labels: [
        { name: 'area:net', reason: 'A new area.', create: true, color: '#1D76DB', description: 'Networking' },
        { name: 'BUG', reason: 'Our word.', rename: 'defect' },
        { name: 'area:ui', reason: 'Match the rest.', color: 'c5def5' },
        { name: 'wontfix', reason: 'Unused.', delete: true },
      ],
    },
    context,
  )
  if (!('changes' in made)) throw new Error(made.problems.join('\n'))
  // The labels come first, so #340 can take area:net; names are as the repo has them.
  expect(made.changes.map(({ change }) => changeText(change))).toEqual([
    'new label area:net #1d76db “Networking”',
    'label bug → defect · the saved Bugs marker follows',
    'label area:ui #c5def5',
    'delete label wontfix · clears the saved Later marker',
    'labels +area:net',
  ])
  const changes = made.changes.map(one => one.change)
  expect(sizeText(changes)).toBe('5 changes to 1 issue and 4 labels')
  expect(sizeText(changes.slice(0, 2))).toBe('2 changes to 2 labels')
  expect(kindsText(changes)).toBe('repo labels 4 · labels 1')
  // A delete's count of the issues that carry the label, once the board has it.
  const wontfix = changes[3]
  if (wontfix?.kind !== 'label') throw new Error('no delete')
  expect(changeText({ ...wontfix, markers: undefined, uses: { open: 3, closed: 2 } })).toBe('delete label wontfix · on 3 open and 2 closed issues')
  expect(changeText({ ...wontfix, markers: undefined, uses: { open: 0, closed: 1 } })).toBe('delete label wontfix · on 0 open and 1 closed issue')
  expect(changeText({ ...wontfix, markers: undefined, uses: null })).toBe("delete label wontfix · couldn't count its issues")
  // Label changes don't touch the project, so a project the board only reads doesn't stop them.
  expect('changes' in planOf({ labels: [{ name: 'wontfix', reason: 'Unused.', delete: true }] }, { ...context, refusal: 'The issue board only reads Void Sector.' })).toBe(true)
})

const LABELS = {
  labels: [
    { name: 'needs-info', reason: 'Waiting on the reporter.', create: true, color: '1d76db', description: 'Needs an answer' },
    { name: 'area:ui', reason: 'A clearer name.', rename: 'area:hud' },
    { name: 'bug', reason: 'Match GitHub.', color: 'd73a4a' },
    { name: 'wontfix', reason: 'Nobody uses it.', delete: true },
  ],
}
const CHOICES = `choices:${REPO.root}`

test('a plan makes, renames, recolors and deletes labels, counts what a delete touches, and moves or clears the saved markers', async ($, on) => {
  const store = adoptedStore(on, { [CHOICES]: { markers: { bug: { label: 'area:ui' }, later: 'wontfix' } } })
  const gh = world(on)
  await $.command.run(REFRESH)

  expect(await $.tool.check({ tool: TOOL, input: LABELS })).toMatchObject({ reason: expect.stringMatching(/^Apply Claude's plan: 4 changes to 4 labels\?\nrepo labels 4\n/) })
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'no'
  await $.tool.call({ tool: TOOL, ...LABELS })
  expect(gh.writes).toEqual([])

  // The card shows the labels under their own heading, the delete with its count, and the markers that follow.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^Claude's plan · 4 changes to 4 labels$/ })).toBeDefined()
  expect(await ui.find({ text: /^The repo's labels$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button', text: /^[☑☐] / })).map(one => one.text)).toEqual([
    '☑ new label needs-info',
    '☑ label area:ui → area:hud',
    '☑ label bug',
    '☑ delete label wontfix',
  ])
  // What each does beyond its name goes beside its button, where it can wrap.
  for (const text of ['#1d76db “Needs an answer”', 'the saved Bugs marker follows', '#d73a4a', 'on 3 open and 2 closed issues · clears the saved Later marker']) {
    expect(await ui.find({ type: 'Text', text }), text).toBeDefined()
  }

  await ui.press({ key: 'plan-apply' })
  expect(gh.writes).toEqual([
    'label POST name=needs-info color=1d76db description=Needs an answer',
    'label PATCH area:ui new_name=area:hud',
    'label PATCH bug color=d73a4a',
    'label DELETE wontfix',
  ])
  expect(gh.toasts.at(-1)).toBe('Applied the plan: 4 changes.')
  expect((store.get(CHOICES) as { markers: unknown }).markers).toEqual({ bug: { label: 'area:hud' } })
  expect(await ui.find({ key: 'plan-card' })).toBeUndefined()

  // The board read the repo again: /issues labels offers the new label and the renamed one the Bugs marker goes by,
  // and not the deleted one.
  await $.command.run({ ...REFRESH, args: 'labels' })
  expect(await ui.find({ key: 'labels-bug-needs-info' })).toBeDefined()
  expect(await ui.find({ key: 'labels-bug-area:hud' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'labels-bug-wontfix' })).toBeUndefined()
  expect(await ui.find({ key: 'labels-later-wontfix' })).toBeUndefined()
  await ui.press({ key: 'labels-cancel' })
  // #341 carries the renamed label, which the saved Bugs marker now goes by, so it is the one bug.
  expect(await ui.find({ key: 'filter-bugs' })).toMatchObject({ text: 'Bugs 1' })
  await ui.press({ key: 'filter-bugs' })
  await ui.press({ key: 'fold-status:Backlog' })
  expect(await ui.find({ key: 'issue-341' })).toBeDefined()
  await ui.unmount()
  expect(gh.labels).toEqual(['bug', 'area:hud', 'needs-info'])
})

test("a delete row says when it couldn't count the label's issues", async ($, on) => {
  const gh = world(on)
  gh.failSearch = true
  await $.command.run(REFRESH)
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'yes'
  const answer = await $.tool.call({ tool: TOOL, labels: [{ name: 'wontfix', reason: 'Nobody uses it.', delete: true }] })
  expect(String(answer.result)).toBe('Applied the plan: 1 change.\nDeleted the label wontfix.')
  gh.engine.answer = 'no'
  await $.tool.call({ tool: TOOL, labels: [{ name: 'bug', reason: 'Gone.', delete: true }] })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'plan-pick-label-1' })).toMatchObject({ text: '☑ delete label bug' })
  expect(await ui.find({ type: 'Text', text: "couldn't count its issues" })).toBeDefined()
  await ui.unmount()
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
    { reason: 'Ready work changed this week.', name: 'Sprint', layout: 'board', filter: 'status:Ready comments:>2' },
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
    'new board view Sprint · status:Ready comments:>2',
    'view Bugs: renamed Ready bugs, filter label:bug status:Ready',
    'delete view Old · label:old',
  ])
  expect(sizeText(changes)).toBe('4 changes to 1 issue and 3 views')
  // On the card the button says which view, and the text beside it the rest.
  expect(changes.map(cardParts)).toEqual([
    { head: 'Status → Ready', detail: '' },
    { head: 'new board view Sprint', detail: 'status:Ready comments:>2' },
    { head: 'view Bugs', detail: 'renamed Ready bugs, filter label:bug status:Ready' },
    { head: 'delete view Old', detail: 'label:old' },
  ])
  expect(sizeText([...changes, { kind: 'label', action: 'create', name: 'area:net' }])).toBe('5 changes to 1 issue, 1 label and 3 views')
  expect(sizeText(changes.slice(1))).toBe('3 changes to 3 views')
  // Label changes come first on the card, then the issues, then the views.
  const all = planOf({ ...VIEW_PLAN, issues: [{ number: 340, reason: 'Saves break.', status: 'Ready' }], labels: [{ name: 'area:net', reason: 'New area.', create: true }] }, context)
  if (!('changes' in all)) throw new Error(all.problems.join('\n'))
  expect(all.changes.map(({ change }) => change.kind)).toEqual(['label', 'status', 'view', 'view', 'view'])
  expect(rowsOf(all.changes).map(row => row.id)).toEqual(['label-1', '340-2', 'view-3', 'view-4', 'view-5'])
  expect(kindsText(changes)).toBe('Status 1 · views 3')
  // Only the new view's filter holds a term the board can't apply: `updated:` compares dates.
  expect(changes.map(viewNoteOf)).toEqual([
    null,
    "The board can't apply comments:>2, so its tab in /issues leaves that term out and shows more than GitHub does.",
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
  expect(await tabs()).toEqual(['filter-view:1 Bugs 0', 'filter-view:2 Old 0', 'filter-inbox Inbox 1', 'filter-all All 3', 'filter-closed Closed'])

  expect(await $.tool.check({ tool: TOOL, input: VIEW_PLAN })).toMatchObject({ reason: expect.stringMatching(/^Apply Claude's plan: 3 changes to 3 views\?\nviews 3\n/) })
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'no'
  await $.tool.call({ tool: TOOL, ...VIEW_PLAN })
  // The card lists the views under the project, and flags the filter the board can only partly apply.
  expect(await ui.find({ text: /^Claude's plan · 3 changes to 3 views$/ })).toBeDefined()
  expect(await ui.find({ text: /^Void Sector views$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button', text: /^[☑☐] / })).map(one => one.text)).toEqual([
    '☑ new board view Sprint',
    '☑ view Bugs',
    '☑ delete view Old',
  ])
  // The filters and what changes go beside the buttons, where they can wrap; a delete names the filter it takes.
  for (const text of ['status:Ready comments:>2', 'renamed Ready bugs, filter label:bug status:Ready', 'label:old']) expect(await ui.find({ type: 'Text', text }), text).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^⚠ / })).map(one => one.text)).toEqual([
    "⚠ The board can't apply comments:>2, so its tab in /issues leaves that term out and shows more than GitHub does.",
  ])

  await ui.press({ key: 'plan-apply' })
  // A new view's filter goes in by a change straight after it is made; a change sends only what changes.
  expect(gh.writes).toEqual([
    'create view Sprint BOARD_LAYOUT in PVT_8',
    'update view PVTV_4 {"filter":"status:Ready comments:>2"}',
    'update view PVTV_1 {"name":"Ready bugs","filter":"label:bug status:Ready"}',
    'delete view PVTV_2',
  ])
  expect(gh.toasts.at(-1)).toBe('Applied the plan: 3 changes.')
  expect(await ui.find({ key: 'plan-card' })).toBeUndefined()
  // The new and changed views are tabs now, and the deleted one is gone.
  expect(await tabs()).toEqual(['filter-view:1 Ready bugs 0', 'filter-view:4 Sprint 1', 'filter-inbox Inbox 1', 'filter-all All 3', 'filter-closed Closed'])
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

test("a change counts as made already when the board shows it, and one the board can't check counts as not made", () => {
  const issues = parseIssues(JSON.stringify([{ ...raw(340, 'Saves drop the hangar', ['bug']), assignees: [{ login: 'astrosteveo' }] }, raw(341, 'The map key hides the legend'), raw(315, 'Lay Kessik out for play')])).map(one =>
    one.number === 340
      ? { ...one, status: 'Ready', priority: 'P0', milestone: 'Launch', parent: { number: 315, title: 'Kessik', total: 1, completed: 0 }, position: 1, fields: { Estimate: '3' } }
      : { ...one, status: 'Inbox', milestone: null, parent: null, position: one.number === 315 ? 0 : 2 },
  )
  const views: NonNullable<Project['views']> = [{ name: 'Bugs', number: 2, layout: 'table', filter: 'label:bug', groupBy: null }]
  const state = { issues, project: { ...PROJECT, views }, labels: ['bug', 'defect'] }
  const made = (change: PlanChange) => alreadyTrue(change, state)

  expect(made({ kind: 'status', number: 340, value: 'ready' })).toBe(true)
  expect(made({ kind: 'status', number: 341, value: 'Ready' })).toBe(false)
  expect(made({ kind: 'priority', number: 340, value: 'P0' })).toBe(true)
  expect(made({ kind: 'field', number: 340, field: 'Estimate', value: 3 })).toBe(true)
  // A field the board doesn't read, and a clear, can't be checked.
  expect(made({ kind: 'field', number: 341, field: 'Estimate', value: 3 })).toBe(false)
  expect(made({ kind: 'field', number: 340, field: 'Estimate', value: null })).toBe(false)
  expect(made({ kind: 'labels', number: 340, add: ['Bug'], remove: ['area:ui'] })).toBe(true)
  expect(made({ kind: 'labels', number: 341, add: ['bug'], remove: [] })).toBe(false)
  expect(made({ kind: 'assignees', number: 340, add: ['astrosteveo'], remove: [] })).toBe(true)
  expect(made({ kind: 'milestone', number: 340, value: 'launch' })).toBe(true)
  expect(made({ kind: 'milestone', number: 341, value: null })).toBe(true)
  expect(made({ kind: 'parent', number: 340, value: 315 })).toBe(true)
  expect(made({ kind: 'parent', number: 341, value: 315 })).toBe(false)
  expect(made({ kind: 'order', number: 340, after: 315 })).toBe(true)
  expect(made({ kind: 'order', number: 315, after: null })).toBe(true)
  expect(made({ kind: 'order', number: 341, after: null })).toBe(false)
  // An issue the board no longer holds can't be checked.
  expect(made({ kind: 'status', number: 999, value: 'Ready' })).toBe(false)

  expect(made({ kind: 'label', action: 'create', name: 'Defect' })).toBe(true)
  expect(made({ kind: 'label', action: 'delete', name: 'wontfix' })).toBe(true)
  expect(made({ kind: 'label', action: 'edit', name: 'wontfix', rename: 'defect' })).toBe(true)
  // A color the board doesn't read can't be checked, nor can anything when the board hasn't read the repo's labels.
  expect(made({ kind: 'label', action: 'edit', name: 'wontfix', rename: 'defect', color: 'ffffff' })).toBe(false)
  expect(alreadyTrue({ kind: 'label', action: 'create', name: 'bug' }, { ...state, labels: undefined })).toBe(false)

  const bugs = views[0] as NonNullable<Project['views']>[number]
  expect(made({ kind: 'view', view: null, to: { name: 'Bugs', layout: 'board', filter: 'label:bug' }, partial: [] })).toBe(false)
  expect(made({ kind: 'view', view: null, to: { name: 'Bugs', layout: 'table', filter: 'label:bug' }, partial: [] })).toBe(true)
  expect(made({ kind: 'view', view: { ...bugs, filter: '' }, to: { name: 'Bugs', layout: 'table', filter: 'label:bug' }, partial: [] })).toBe(true)
  expect(made({ kind: 'view', view: { ...bugs, number: 5 }, to: null, partial: [] })).toBe(true)
  expect(made({ kind: 'view', view: bugs, to: null, partial: [] })).toBe(false)
})

test('a row Claude made with issue_update after the plan leaves the card and the band, and Apply skips it and says so', async ($, on) => {
  const gh = world(on)
  await $.command.run(REFRESH)
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'no'
  await $.tool.call({ tool: TOOL, ...PLAN })

  // Claude moves #340 to Ready itself.
  gh.engine.verdict = 'allow'
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 340, status: 'Ready' })
  expect(gh.writes).toEqual(['#340 Status Ready'])

  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /^Claude's plan: 3 changes to 3 issues$/ })).toBeDefined()
  await band.unmount()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^Claude's plan · 3 changes to 3 issues$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button', text: /^[☑☐] / })).map(one => one.text)).toEqual(['☑ Priority → P0', '☑ labels +bug −area:ui', '☑ milestone → Launch'])
  expect(await ui.find({ key: 'plan-apply' })).toMatchObject({ text: '✓ Apply 3 of 3' })

  // A yes to the same plan writes the rest, and names the row it skipped.
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'yes'
  const yes = await $.tool.call({ tool: TOOL, ...PLAN })
  expect(String(yes.result)).toBe(
    [
      'Applied the plan: 3 changes. Skipped 1 made already.',
      '#340 set to P0.',
      '#341 labelled bug, unlabelled area:ui.',
      '#315 put on the milestone Launch.',
      'Skipped, made already: #340 Status → Ready',
    ].join('\n'),
  )
  expect(gh.writes).toEqual(['#340 Status Ready', '#340 Priority P0', 'issue edit 341 --add-label bug --remove-label area:ui', 'issue edit 315 --milestone Launch'])
  expect(await ui.find({ key: 'plan-card' })).toBeUndefined()
  await ui.unmount()
})

test('a plan made true in full leaves the card and the band, and applying it writes nothing', async ($, on) => {
  const gh = world(on)
  await $.command.run(REFRESH)
  const moves = { issues: [{ number: 340, reason: 'Saves break.', status: 'Ready' }, { number: 341, reason: 'Soon.', status: 'Ready' }] }
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'no'
  await $.tool.call({ tool: TOOL, ...moves })
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^Claude's plan · 2 changes to 2 issues$/ })).toBeDefined()

  gh.engine.verdict = 'allow'
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 340, status: 'Ready' })
  await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 341, status: 'Ready' })
  expect(await ui.find({ key: 'plan-card' })).toBeUndefined()
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'plan-review' })).toBeUndefined()
  await band.unmount()

  // The plan left state, not just the card: a later read that undoes a row doesn't bring it back.
  gh.planned[340] = { status: 'Inbox' }
  await $.command.run(REFRESH)
  expect(await ui.find({ key: 'plan-card' })).toBeUndefined()
  await ui.unmount()

  // A plan already true when it is approved writes nothing, and says so.
  gh.planned[340] = { status: 'Ready' }
  await $.command.run(REFRESH)
  const writes = gh.writes.length
  gh.engine.verdict = 'ask'
  gh.engine.answer = 'yes'
  const yes = await $.tool.call({ tool: TOOL, ...moves })
  expect(String(yes.result)).toBe(['Nothing was applied: all 2 ticked changes were made already.', 'Skipped, made already: #340 Status → Ready', 'Skipped, made already: #341 Status → Ready'].join('\n'))
  expect(gh.writes.length).toBe(writes)
})
