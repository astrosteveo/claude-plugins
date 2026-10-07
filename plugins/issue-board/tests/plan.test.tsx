import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseIssues } from '../hooks/parse'
import { changeText, issueOf, kindsText, planAsk, planOf, sizeText } from '../hooks/plan'
import type { Project } from '../types'
import { PRIORITIES, STATUSES, adoptedStore, graphPage, isIssuesQuery, optionId } from './graph'
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
    // The repo's labels, which label writes change, and how many open and closed issues search finds with each.
    labels: ['bug', 'area:ui', 'wontfix'],
    uses: { wontfix: { open: 3, closed: 2 } } as Record<string, { open: number; closed: number }>,
    failSearch: false,
  }
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    const answer = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer('main\n')
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (isIssuesQuery(argv)) {
      state.reads += 1
      return answer(graphPage(state.issues.map(one => ({ ...one, ...state.planned[one.number] })), argv, true, [], {}, state.labels))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv.includes('--input')) {
      const asked = JSON.parse(e.init?.stdin ?? '{}') as { query: string; variables: Record<string, unknown> }
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
    if (argv[1] === 'api' && argv.includes('search/issues')) {
      if (state.failSearch) return answer('', 1, 'API rate limit exceeded')
      const q = argv[argv.indexOf('-f') + 1] ?? ''
      const label = /label:"(.*)"/.exec(q)?.[1] ?? ''
      return answer(`${state.uses[label]?.[q.includes('state:open') ? 'open' : 'closed'] ?? 0}\n`)
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
      return answer('{}')
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
  expect(planOf({}, context)).toEqual({ problems: ['Give issues or labels: lists of changes, each with a reason.'] })
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
  expect(made.changes.map(({ change, reason }) => `#${issueOf(change)} ${changeText(change)} (${reason})`)).toEqual([
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
    '☑ new label needs-info #1d76db “Needs an answer”',
    '☑ label area:ui → area:hud · the saved Bugs marker follows',
    '☑ label bug #d73a4a',
    '☑ delete label wontfix · on 3 open and 2 closed issues · clears the saved Later marker',
  ])

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
  expect(await ui.find({ key: 'plan-pick-label-1' })).toMatchObject({ text: "☑ delete label bug · couldn't count its issues" })
  await ui.unmount()
})
