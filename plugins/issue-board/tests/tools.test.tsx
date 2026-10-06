import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  alertsOf,
  draftPrompt,
  fixPrompt,
  matches,
  parseDraft,
  parseIssues,
  parsePrs,
  searched,
  tickBody,
  wentGreen,
  workerPrompt,
  workingSection,
  projectPathOf,
} from '../hooks/parse'
import { PRIORITIES, STATUSES, asksProject, graphPage, isIssuesQuery, optionId } from './graph'

const BODY = '## Acceptance\r\n\r\n- [x] Layout in place\r\n- [ ] Old saves load\r\n- [ ] Goldens regenerated\r\n'

const issue = (body: string, updatedAt = '2026-10-03T20:00:00Z') => ({
  number: 315,
  title: 'Lay Kessik out for play',
  url: 'https://github.com/astrosteveo/void-sector/issues/315',
  labels: [{ name: 'area:simulation', color: '0e8a16' }, { name: 'enhancement', color: 'a2eeef' }],
  assignees: [{ login: 'astrosteveo' }],
  body,
  updatedAt,
})

const other = {
  number: 289,
  title: "Asteroids didn't draw",
  url: 'https://github.com/astrosteveo/void-sector/issues/289',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: [],
  body: null,
  updatedAt: '2026-10-02T20:00:00Z',
  comments: 1,
}

const pr = (ci: 'pass' | 'pending' | 'fail', sha = 'abc123') => ({
  number: 335,
  title: 'Glide in to a planet',
  url: 'https://github.com/astrosteveo/void-sector/pull/335',
  headRefName: 'fix/planet-glide',
  headRefOid: sha,
  isDraft: false,
  statusCheckRollup:
    ci === 'pass'
      ? [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }]
      : ci === 'pending'
        ? [{ name: 'build', status: 'IN_PROGRESS' }]
        : [
            { name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/987/job/1' },
            { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/987/job/2' },
          ],
  reviewDecision: 'APPROVED',
  additions: 1,
  deletions: 1,
  author: { login: 'astrosteveo' },
  updatedAt: '2026-10-03T20:00:00Z',
  body: 'Glides in from cruise. Refs #315.',
  closingIssuesReferences: [],
})

const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

// GitHub and git as the board reads them, with what the tests change and what gh was asked to write.
// `project`: the repo has the Void Sector project, and `planned` is each issue's Status and Priority in it.
// `refuseProject`: what GitHub says to a query that asks for projects, as to a token without read:project.
// An issue closed as completed, as GitHub's REST answers it.
const CLOSED = {
  number: 290,
  title: 'Dock the shuttle',
  html_url: 'https://github.com/astrosteveo/void-sector/issues/290',
  state: 'closed',
  state_reason: 'completed',
  closed_at: '2026-10-03T10:00:00Z',
  labels: [{ name: 'enhancement' }],
}

const world = (on: On) => {
  const state = {
    body: BODY,
    prs: [pr('pass')] as unknown[],
    branch: 'fix/planet-glide',
    edits: [] as string[],
    created: [] as { argv: string[]; stdin?: string }[],
    prLists: 0,
    project: false,
    // The project's own names for its Status options, S0 to S5, in place of the board's.
    statusNames: null as string[] | null,
    planned: {} as Record<number, { status?: string; priority?: string }>,
    refuseProject: '',
    fields: [] as Record<string, string>[],
    assigned: [] as number[],
    // What the cheap checks see: GitHub answers 304 while the ETag sent is this one.
    etag: 'E1',
    looks: 0,
    issueReads: 0,
    searches: 0,
    // When set, GraphQL refuses for a rate limit that resets then.
    limited: '',
    // Issues filed over REST, and sub-issue links made, as [epic, the sub-issue's id]; `failLink` refuses the link.
    filed: [] as Record<string, unknown>[],
    linked: [] as [number, string][],
    failLink: false,
    // When set, the project's own auto-add has the new issue already, so GitHub refuses the board's add.
    autoAdded: false,
    // A field the project gained since the board's last read: its next read sees it.
    newField: null as Record<string, unknown> | null,
    // Whether the project's Item closed workflow is on.
    itemClosed: false,
    // The number the next filed issue gets, and the blocked-by links made, as `<issue> <blocker's id>`.
    next: 340,
    blocks: [] as string[],
    // GitHub's search terms asked for, and each issue's comments as REST gives them, oldest first.
    searched: [] as string[],
    comments: {
      290: Array.from({ length: 12 }, (_, index) => ({ user: { login: index % 2 ? 'alice' : 'astrosteveo' }, body: `Note ${index + 1}.`, created_at: '2026-10-04T09:00:00Z' })),
    } as Record<number, unknown[]>,
    commentReads: [] as string[],
    // The repo's milestones as REST has them, and what each POST or PATCH to them sent.
    milestones: [{ number: 3, title: 'Launch', state: 'open', due_on: '2026-10-20T00:00:00Z', description: '', open_issues: 2, closed_issues: 5 }] as Record<string, unknown>[],
    milestoneWrites: [] as string[],
    // Each item's field values by name, and the field writes made, as `item field value`.
    values: {} as Record<string, Record<string, unknown>>,
    valueWrites: [] as string[],
    // The repo's issue types, #315's type, and each PATCH of an issue over REST, as `<number> <fields>`.
    types: [] as string[],
    type315: '',
    // Project items archived, by node id; status updates posted, as their variables.
    archived: [] as string[],
    statusPosts: [] as Record<string, unknown>[],
    patches: [] as string[],
  }
  on('process.run', async (_$, e) => {
    const argv = e.argv
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') return answer(`${state.branch}\n`)
    if (argv[1] === 'api' && argv[2] === '-i') {
      state.looks += 1
      if (argv.includes(`If-None-Match: ${state.etag}`)) return { value: { exitCode: 1, stdout: 'HTTP/2.0 304 Not Modified\n', stderr: 'gh: HTTP 304', isStdoutTruncated: false, isStderrTruncated: false } }
      return answer(`HTTP/2.0 200 OK\nEtag: ${state.etag}\n\n[]`)
    }
    if (argv[1] === 'repo') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }))
    if (isIssuesQuery(argv)) {
      state.issueReads += 1
      if (state.limited) return { value: { exitCode: 1, stdout: '', stderr: 'GraphQL: API rate limit already exceeded for user ID 1.', isStdoutTruncated: false, isStderrTruncated: false } }
      if (state.refuseProject && asksProject(argv)) return { value: { exitCode: 1, stdout: '', stderr: state.refuseProject, isStdoutTruncated: false, isStderrTruncated: false } }
      const page = JSON.parse(
        graphPage([{ ...issue(state.body), ...state.planned[315], ...(state.type315 ? { type: state.type315 } : {}) }, { ...other, ...state.planned[289] }], argv, state.project, state.types),
      ) as { data: { repository: { projectsV2?: { nodes: { fields: { nodes: unknown[] } }[] } } } }
      if (state.newField) page.data.repository.projectsV2?.nodes[0]?.fields.nodes.push(state.newField)
      const statusField = page.data.repository.projectsV2?.nodes[0]?.fields.nodes[0] as { options?: { id: string; name: string }[] } | undefined
      if (state.statusNames && statusField) statusField.options = state.statusNames.map((name, index) => ({ id: `S${index}`, name }))
      const linked = page.data.repository.projectsV2?.nodes[0] as Record<string, unknown> | undefined
      if (linked) linked.workflows = { nodes: [{ name: 'Item closed', enabled: state.itemClosed }] }
      return answer(JSON.stringify(page))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv[3] === '--input') {
      const asked = JSON.parse(e.init?.stdin ?? '{}') as { query: string; variables: Record<string, unknown> }
      const item = String(asked.variables.item)
      if (asked.query.includes('projectItems')) {
        const issue = String(asked.variables.issue)
        return answer(JSON.stringify({ data: { node: { projectItems: { nodes: [{ id: `PVTI_auto_${issue.slice(2)}`, project: { id: 'PVT_8' } }] } } } }))
      }
      if (asked.query.includes('createProjectV2StatusUpdate')) {
        state.statusPosts.push(asked.variables)
        return answer(JSON.stringify({ data: { createProjectV2StatusUpdate: { statusUpdate: { id: 'SU_1', createdAt: '2026-10-04T10:00:00Z' } } } }))
      }
      if (asked.query.includes('archiveProjectV2Item')) {
        state.archived.push(item)
        return answer(JSON.stringify({ data: { archiveProjectV2Item: { item: { id: item } } } }))
      }
      if (asked.query.includes('fieldValues')) {
        const nodes = Object.entries(state.values[item] ?? {}).map(([name, value]) => ({ [typeof value === 'number' ? 'number' : 'text']: value, field: { name } }))
        return answer(JSON.stringify({ data: { node: { fieldValues: { nodes } } } }))
      }
      const field = String(asked.variables.field)
      const value = asked.query.includes('clearProjectV2') ? null : (asked.variables.value as Record<string, unknown>)
      state.valueWrites.push(`${item} ${field} ${JSON.stringify(value)}`)
      const name = { F_estimate: 'Estimate', F_sprint: 'Sprint', F_due: 'Due', F_notes: 'Notes' }[field] ?? field
      const shown = value === null ? undefined : (value.number ?? value.date ?? value.text ?? (value.iterationId === 'IT2' ? 'Iteration 2' : 'Iteration 1'))
      state.values[item] = { ...state.values[item], [name]: shown }
      if (shown === undefined) delete state.values[item]?.[name]
      return answer(JSON.stringify({ data: {} }))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql') {
      // A mutation: its `-f name=value` arguments, and the change it makes to the project.
      const args = Object.fromEntries(argv.flatMap((arg, index) => (argv[index - 1] === '-f' ? [arg.split(/=(.*)/s).slice(0, 2) as [string, string]] : [])))
      if (args.query?.startsWith('{ rateLimit')) return answer(JSON.stringify({ data: { rateLimit: { resetAt: state.limited } } }))
      // The pull requests' review threads: a read, not a change.
      if (args.query?.includes('reviewThreads')) return answer(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }))
      state.fields.push(args)
      if (args.query?.includes('addProjectV2ItemById')) {
        if (state.autoAdded) return { value: { exitCode: 1, stdout: '', stderr: 'gh: Content already exists in this project', isStdoutTruncated: false, isStderrTruncated: false } }
        return answer(JSON.stringify({ data: { addProjectV2ItemById: { item: { id: `PVTI_${args.content?.slice(2)}` } } } }))
      }
      const number = Number(args.item?.slice('PVTI_'.length))
      const name = (state.statusNames && args.field === 'F_status' ? state.statusNames[Number(args.option?.slice(1))] : [...STATUSES, ...PRIORITIES].find(one => optionId(one) === args.option)) ?? ''
      state.planned[number] = { ...state.planned[number], ...(args.field === 'F_status' ? { status: name } : { priority: name }) }
      return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: args.item } } } }))
    }
    if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'POST' && /^repos\/.*\/issues$/.test(argv[4] ?? '')) {
      const fields = JSON.parse(e.init?.stdin ?? '{}') as { title: string; labels: string[]; assignees: string[] }
      if (fields.title.includes('refused')) return { value: { exitCode: 1, stdout: '', stderr: 'gh: Validation Failed (HTTP 422)', isStdoutTruncated: false, isStderrTruncated: false } }
      state.filed.push(fields)
      const number = state.next++
      return answer(
        JSON.stringify({
          number,
          id: 9000 + number,
          node_id: `I_${number}`,
          html_url: `https://github.com/astrosteveo/void-sector/issues/${number}`,
          updated_at: '2026-10-04T10:00:00Z',
          labels: fields.labels.map(name => ({ name, color: 'ededed' })),
          assignees: fields.assignees.map(login => ({ login })),
        }),
      )
    }
    if (argv[1] === 'api' && argv[2] === '-X' && /\/sub_issues$/.test(argv[4] ?? '')) {
      if (state.failLink) return { value: { exitCode: 1, stdout: '', stderr: 'gh: Sub issue may only have one parent (HTTP 422)', isStdoutTruncated: false, isStderrTruncated: false } }
      state.linked.push([Number(/issues\/(\d+)\//.exec(argv[4] ?? '')?.[1]), argv[argv.length - 1]?.split('=')[1] ?? ''])
      return answer('{}')
    }
    const thread = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments\?per_page=100&page=(\d+)$/.exec(argv[2] ?? '')
    if (argv[1] === 'api' && thread) {
      state.commentReads.push(`${thread[1]} page ${thread[2]}`)
      const all = state.comments[Number(thread[1])] ?? []
      const page = Number(thread[2])
      return answer(JSON.stringify(all.slice((page - 1) * 100, page * 100)))
    }
    const one = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(argv[2] ?? '')
    if (argv[1] === 'api' && one && argv.includes('.id')) return answer(`90${one[1]}\n`)
    // An issue the board doesn't hold: #290 closed as completed; nothing else exists.
    if (argv[1] === 'api' && one) {
      if (one[1] !== '290') return { value: { exitCode: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)', isStdoutTruncated: false, isStderrTruncated: false } }
      return answer(JSON.stringify({ ...CLOSED, body: '- [x] Shipped\n- [ ] Follow up', assignees: [{ login: 'astrosteveo' }], comments: 12 }))
    }
    if (argv[1] === 'api' && argv[2] === '-X' && argv[4] === 'search/issues') {
      state.searched.push(argv[argv.indexOf('-f') + 1]?.slice(2) ?? '')
      return answer(JSON.stringify({ total_count: 45, items: [CLOSED, { ...CLOSED, number: 291, title: 'A pull request', pull_request: {} }] }))
    }
    if (argv[1] === 'api' && argv[2]?.includes('/issues?state=closed')) return answer(JSON.stringify([CLOSED]))
    if (argv[1] === 'api' && argv[2] === '-X' && argv[4]?.includes('/dependencies/blocked_by')) {
      state.blocks.push(`${/issues\/(\d+)\//.exec(argv[4])?.[1]} ${argv[6]?.split('=')[1]}`)
      return answer('{}')
    }
    // The project over REST: its fields, and its items with the Status field's values.
    if (argv[1] === 'api' && argv[2] === 'users/astrosteveo/projectsV2/8/fields?per_page=50') return answer(JSON.stringify([{ id: 111, name: 'Status' }]))
    if (argv[1] === 'api' && argv[2] === 'users/astrosteveo/projectsV2/8/items?per_page=100&fields=111') {
      const item = (status: string, content: Record<string, unknown>, type = 'Issue') => ({
        node_id: `PVTI_${String(content.number)}`,
        archived_at: state.archived.includes(`PVTI_${String(content.number)}`) ? '2026-10-04T10:00:00Z' : null,
        content_type: type,
        content,
        fields: [{ name: 'Status', value: { name: { raw: status } } }],
      })
      return answer(
        JSON.stringify([
          item('Done', { number: 290, title: 'Dock the shuttle', state: 'closed', state_reason: 'completed', closed_at: '2026-10-03T10:00:00Z' }),
          item('Done', { number: 250, title: 'Old work', state: 'closed', state_reason: 'completed', closed_at: '2026-09-01T10:00:00Z' }),
          item('Verification', { number: 315, title: 'Lay Kessik out for play', state: 'open' }),
          item('Done', { number: 335, title: 'Glide in to a planet', state: 'closed' }, 'PullRequest'),
        ]),
      )
    }
    if (argv[1] === 'api' && argv[2]?.endsWith('/labels?per_page=100')) return answer(JSON.stringify([{ name: 'bug' }, { name: 'enhancement' }, { name: 'area:simulation' }]))
    if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'PATCH' && /\/issues\/\d+$/.test(argv[4] ?? '')) {
      const fields = JSON.parse(e.init?.stdin ?? '{}') as { type?: string | null }
      state.patches.push(`${/(\d+)$/.exec(argv[4] ?? '')?.[1]} ${JSON.stringify(fields)}`)
      if ('type' in fields) state.type315 = fields.type ?? ''
      return answer('{}')
    }
    if (argv[1] === 'api' && argv[2] === '-X' && argv[4]?.includes('/milestones')) {
      const fields = JSON.parse(e.init?.stdin ?? '{}') as Record<string, unknown>
      state.milestoneWrites.push(`${argv[3]} ${argv[4].replace(/^repos\/[^/]+\/[^/]+\//, '')} ${JSON.stringify(fields)}`)
      if (argv[3] === 'POST') state.milestones.push({ number: 4, state: 'open', description: '', open_issues: 0, closed_issues: 0, due_on: null, ...fields })
      else state.milestones = state.milestones.map(one => (argv[4]?.endsWith(`/${String(one.number)}`) ? { ...one, ...fields } : one))
      return answer('{}')
    }
    if (argv[1] === 'api' && argv[2]?.includes('/milestones')) {
      const open = argv[2].includes('state=open')
      return answer(JSON.stringify(state.milestones.filter(one => !open || one.state === 'open')))
    }
    if (argv[1] === 'api') return answer('astrosteveo\n')
    if (argv[1] === 'issue' && argv[2] === 'edit' && argv.includes('--add-assignee')) {
      state.assigned.push(Number(argv[3]))
      return answer('')
    }
    if (argv[1] === 'issue' && argv[2] === 'edit') {
      state.body = e.init?.stdin ?? ''
      state.edits.push(state.body)
      return answer('')
    }
    if (argv[1] === 'issue' && argv[2] === 'create') {
      state.created.push({ argv: [...argv], stdin: e.init?.stdin })
      return answer('https://github.com/astrosteveo/void-sector/issues/340\n')
    }
    if (argv[1] === 'issue' && argv[2] === 'view') {
      const fields = argv[argv.indexOf('--json') + 1]
      if (fields === 'id') return answer(JSON.stringify({ id: `I_${argv[3]}` }))
      return answer(JSON.stringify(fields === 'body' ? { body: state.body } : issue(state.body, '2026-10-04T09:00:00Z')))
    }
    if (argv[1] === 'label' && argv[2] === 'list') return answer(JSON.stringify([{ name: 'bug' }, { name: 'enhancement' }, { name: 'area:simulation' }]))
    if (argv.includes('closed') || argv.includes('merged')) {
      state.searches += 1
      return answer('[]')
    }
    if (argv[1] === 'pr') state.prLists += 1
    return answer(JSON.stringify(argv[1] === 'issue' ? [issue(state.body), other] : state.prs))
  })
  on('session.id', async () => ({ value: 'session-1' }))
  on('session.repo', async () => ({ value: REPO }))
  on('session.root', async () => ({ value: REPO.root }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  return state
}

test('boxes tick in place, CRLF bodies included, and say which were missing', () => {
  const ticked = tickBody(BODY, [2, 3], true)
  expect(ticked.changed).toEqual([2, 3])
  expect(ticked.missing).toEqual([])
  expect(ticked.body).toBe('## Acceptance\r\n\r\n- [x] Layout in place\r\n- [x] Old saves load\r\n- [x] Goldens regenerated\r\n')
  expect(tickBody(BODY, [1], true).changed).toEqual([])
  expect(tickBody(BODY, [1], false).body).toMatch(/^- \[ \] Layout in place\r$/m)
  expect(tickBody(BODY, [4], true).missing).toEqual([4])
  expect(parseIssues(JSON.stringify([issue(BODY)]))[0]?.checks.map(check => check.done)).toEqual([true, false, false])
})

test('failing checks name their runs, and the Fix prompt hands Claude the log', () => {
  const [failing] = parsePrs(JSON.stringify([pr('fail')]))
  expect(failing?.failing).toEqual(['build', 'lint'])
  expect(failing?.runs).toEqual([987])
  expect(failing?.sha).toBe('abc123')
  expect(fixPrompt(failing!)).toMatch(/The failing checks are build, lint\. Read the failure with `gh run view 987 --log-failed`, then fix it\.$/)
})

test('search, Mine, and CI that goes green', () => {
  const [kessik, asteroids] = parseIssues(JSON.stringify([issue(BODY), other]))
  expect(searched('kessik play', kessik!)).toBe(true)
  expect(searched('#289', asteroids!)).toBe(true)
  expect(searched('simulation', kessik!)).toBe(true)
  expect(searched('kessik bug', kessik!)).toBe(false)
  expect(matches('mine', kessik!, 'astrosteveo')).toBe(true)
  expect(matches('mine', asteroids!, 'astrosteveo')).toBe(false)
  expect(matches('mine', kessik!, null)).toBe(false)

  const board = (ci: 'pass' | 'pending') => ({ repo: 'r', issues: [], prs: parsePrs(JSON.stringify([pr(ci)])), velocity: { closed: [], merged: [] }, fetchedAt: 0 })
  expect(wentGreen(board('pending'), board('pass')).map(one => one.number)).toEqual([335])
  expect(wentGreen(board('pass'), board('pass'))).toEqual([])
  expect(wentGreen(null, board('pass'))).toEqual([])
  expect(alertsOf(board('pass'), null, [], ['335-abc123']).map(alert => alert.key)).toEqual(['pass-335-abc123'])
  expect(alertsOf(board('pass'), null, ['pass-335-abc123'], ['335-abc123'])).toEqual([])
})

test('a draft reads back from JSON, keeping only labels the repository has', () => {
  expect(draftPrompt('', ['bug'])).toMatch(/from what we have discussed\..*only from this list, or none: bug\./)
  const reply = 'Here it is:\n{"title": "Saves drop the hangar", "body": "Loading loses it.\\n\\n## Acceptance\\n- [ ] Hangar loads", "labels": ["bug", "made-up"]}'
  expect(parseDraft(reply, ['bug', 'area:saves'])).toEqual({ title: 'Saves drop the hangar', body: 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads', labels: ['bug'] })
  expect(parseDraft('no json here', ['bug'])).toBeNull()
  expect(parseDraft('{"body": "no title"}', ['bug'])).toBeNull()
})

test('the working note says Closes only when every box is ticked, always Closes, or nothing, as its PR rule says', () => {
  const issue = { number: 315, title: 'Lay Kessik out', updatedAt: '' }
  const ticked = workingSection(issue, 'closes-when-ticked')
  expect(ticked).toMatch(/^The person is working on GitHub issue #315: Lay Kessik out\./)
  expect(ticked).toMatch(/write `Closes #315` in its body only if every acceptance box of #315 is ticked by then\. Otherwise write `Refs #315`, so the issue stays open for what is left\./)
  expect(ticked).toMatch(/If the repository's contributing guidelines say otherwise, follow them\.$/)

  const always = workingSection(issue, 'always-closes')
  expect(always).toMatch(/When you open a pull request for #315, write `Closes #315` in its body\. If the repository's contributing guidelines say otherwise, follow them\.$/)
  expect(always).not.toMatch(/Refs/)

  const none = workingSection(issue, 'none')
  expect(none).toMatch(/^The person is working on GitHub issue #315: Lay Kessik out\./)
  expect(none).toMatch(/moving its Status needs no permission\.$/)
  expect(none).not.toMatch(/Closes|Refs|pull request/)

  // The background agent follows the same rule.
  expect(workerPrompt('closes-when-ticked')).toMatch(/Write `Closes #<number>` in its body only if every acceptance box is ticked by then, and `Refs #<number>` otherwise\./)
  expect(workerPrompt('always-closes')).toMatch(/open a pull request\. Write `Closes #<number>` in its body\.\n/)
  expect(workerPrompt('none')).not.toMatch(/Closes|Refs/)
})

test('the issues tool lists the board, and the tick tool ticks a box on GitHub', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  await $.command.run(REFRESH)

  const listed = await $.tool.call({ tool: 'mcp__issue-board__issues' })
  expect(listed.text ?? String(listed.result)).toMatch(/^astrosteveo\/void-sector: 2 open issues, 1 open pull requests/)
  expect(String(listed.result)).toMatch(/#335 Glide in to a planet \[branch fix\/planet-glide, CI pass, approved/)
  expect(String(listed.result)).toMatch(/#315 Lay Kessik out for play \[area:simulation, enhancement; 1\/3 boxes\]/)

  const bugs = await $.tool.call({ tool: 'mcp__issue-board__issues', filter: 'bugs' })
  expect(String(bugs.result)).not.toMatch(/#315/)

  const one = await $.tool.call({ tool: 'mcp__issue-board__issues', number: 315 })
  expect(String(one.result)).toMatch(/Boxes \(1\/3 ticked\):\n1\. \[x\] Layout in place\n2\. \[ \] Old saves load\n3\. \[ \] Goldens regenerated/)

  const ticked = await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [2] })
  expect(String(ticked.result)).toBe('Ticked box 2. #315 has 2/3 ticked.')
  expect(gh.edits).toEqual(['## Acceptance\r\n\r\n- [x] Layout in place\r\n- [x] Old saves load\r\n- [ ] Goldens regenerated\r\n'])

  const again = await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [2] })
  expect(String(again.result)).toMatch(/^Nothing changed: that box was already ticked\./)
  expect(gh.edits.length).toBe(1)

  const missing = await $.tool.call({ tool: 'mcp__issue-board__tick', number: 315, boxes: [9] })
  expect(missing.deny).toMatch(/^Couldn't tick boxes on #315: #315 has 3 boxes, so there is no box 9$/)

  const after = await $.tool.call({ tool: 'mcp__issue-board__issues', number: 315 })
  expect(String(after.result)).toMatch(/Boxes \(2\/3 ticked\)/)
})

test('Start names the issue in the system prompt; the pane searches, filters Mine, marks the branch and ticks boxes', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  await $.command.run(REFRESH)
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  // The row marks this branch's pull request; its details say so in words, and which issue it is for.
  expect(await ui.find({ text: /^◆$/ })).toBeDefined()
  await ui.press({ key: 'pr-335' })
  expect(await ui.find({ text: /^· ◆ this branch$/ })).toBeDefined()
  expect(await ui.find({ text: /^· for #315$/ })).toBeDefined()
  await ui.press({ key: 'pr-335' })

  await ui.press({ key: 'filter-mine' })
  expect(await ui.find({ key: 'issue-315' })).toBeDefined()
  expect(await ui.find({ key: 'issue-289' })).toBeUndefined()

  await ui.press({ key: 'filter-all' })
  await ui.input({ key: 'search', text: 'asteroids', kind: 'change' })
  expect(await ui.find({ key: 'issue-289' })).toBeDefined()
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  await ui.input({ key: 'search', text: '', kind: 'change' })

  await ui.press({ key: 'issue-315' })
  await ui.press({ key: 'box-315-3' })
  expect(gh.edits.at(-1)).toMatch(/- \[x\] Goldens regenerated/)
  expect(await ui.find({ text: / 2\/3/ })).toBeDefined()

  await ui.press({ key: 'start-315' })
  expect(sent.at(-1)).toMatch(/^Let's start on #315/)
  const sections = (await $.prompt.compose(COMPOSE)).sections
  expect(sections.map(section => section.id)).toEqual(['intro', 'issue-board:working'])
  expect(sections.at(-1)?.text).toMatch(/^The person is working on GitHub issue #315: Lay Kessik out for play\./)
  // Its own row starts with ▶, and no separate line says so. The row shows its pull request with CI, and its boxes as a
  // short bar and a count.
  expect(await ui.find({ text: /Working on/ })).toBeUndefined()
  expect((await ui.find({ key: 'row-315' }))?.text).toMatch(/^▶ #315 Lay Kessik out for play⇄ #335 ✓.*━━━ 2\/3 +1d✕$/)
  expect((await ui.findAll({ type: 'Text' })).filter(text => text.text === '▶ ')).toHaveLength(1)

  // Ticking the last box changes the issue, not the note, so the prompt cache holds.
  await ui.press({ key: 'box-315-2' })
  expect(await ui.find({ text: / 3\/3/ })).toBeDefined()
  expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toBe(sections.at(-1)?.text)

  // The ✕ at the end of the ▶ row stops tracking the issue: the ▶ and the ✕ go, and the prompt no longer names it.
  expect(await ui.find({ key: 'stop-289' })).toBeUndefined()
  await ui.press({ key: 'stop-315' })
  expect((await ui.find({ key: 'row-315' }))?.text).toMatch(/^ {2}#315 /)
  expect((await ui.findAll({ type: 'Text' })).filter(text => text.text === '▶ ')).toHaveLength(0)
  expect(await ui.find({ key: 'stop-315' })).toBeUndefined()
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])
  await ui.unmount()
})

test('the band says when CI passes and offers Merge; the issue Claude is on is in the pane, not the band', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  gh.prs = [pr('pending')]
  await $.command.run(REFRESH)
  const band = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...BAND })
  expect(await band.find({ text: / ✓ CI / })).toBeUndefined()

  gh.prs = [pr('pass')]
  await $.command.run(REFRESH)
  expect(await band.find({ text: / ✓ CI / })).toBeDefined()
  await band.press({ key: 'merge-335' })
  expect(sent.at(-1)).toMatch(/^Close out PR #335: Glide in to a planet/)
  await band.press({ key: 'dismiss-pass-335-abc123' })
  expect(await band.find({ text: / ✓ CI / })).toBeUndefined()

  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'issue-315' })
  await pane.press({ key: 'start-315' })
  // Progress isn't something to act on, so the band says nothing about it; the issue's ▶ row in the pane does.
  expect(await band.find({ key: 'engine' })).toBeDefined()
  expect(await band.find({ key: 'stop-315' })).toBeUndefined()
  expect(await pane.find({ text: /^▶ $/ })).toBeDefined()
  await pane.press({ key: 'stop-315' })
  expect(await pane.find({ key: 'stop-315' })).toBeUndefined()
  expect(await pane.find({ text: /^▶ $/ })).toBeUndefined()

  await pane.unmount()
  await band.unmount()
})

test('/issues new drafts an issue from the conversation and files it on request, into the project at Inbox', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  const asked: string[] = []
  on('model.fork', async (_$, e) => {
    asked.push(e.prompt)
    const text = JSON.stringify({ title: 'Saves drop the hangar', body: 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads', labels: ['enhancement', 'nope'] })
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.command.run(REFRESH)

  const reply = await $.command.run({ ...REFRESH, args: 'new the hangar vanishing on load' })
  expect(reply.text).toMatch(/^Drafting an issue/)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(asked.at(-1)).toMatch(/about: the hangar vanishing on load\./)
  expect(await ui.find({ text: /New issue · draft/ })).toBeDefined()
  expect(await ui.find({ text: /^Saves drop the hangar$/ })).toBeDefined()

  await ui.press({ key: 'draft-file' })
  expect(gh.created).toEqual([
    {
      argv: ['gh', 'issue', 'create', '--title', 'Saves drop the hangar', '--body-file', '-', '--label', 'enhancement'],
      stdin: 'Loading loses it.\n\n## Acceptance\n- [ ] Hangar loads',
    },
  ])
  // Added to the project, then set to Inbox, whatever the project's own automation would set.
  expect(gh.fields.map(one => [one.content ?? one.item, one.option ?? null])).toEqual([
    ['I_340', null],
    ['PVTI_340', optionId('Inbox')],
  ])
  expect(await ui.find({ text: /New issue · draft/ })).toBeUndefined()
  await ui.unmount()
})

test('a new session paints the saved board and keeps the issue Claude was on', async ($, on) => {
  const saved = {
    board: {
      repo: 'astrosteveo/void-sector',
      issues: parseIssues(JSON.stringify([issue(BODY)])),
      prs: [],
      velocity: { closed: [], merged: [] },
      fetchedAt: Date.parse('2026-10-03T20:00:00Z'),
    },
    working: { number: 315, title: 'Lay Kessik out for play', updatedAt: '2026-10-03T20:00:00Z', sessionId: 'an-earlier-session' },
    dismissed: [],
    viewer: 'astrosteveo',
  }
  mock.store(on, { [`repo:${REPO.root}`]: saved })
  on('session.id', async () => ({ value: 'session-2' }))
  on('session.repo', async () => ({ value: REPO }))
  // GitHub can't be reached yet: what shows is what was saved.
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__issue-board__${e.name}` } }))
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'stop-315' })).toBeDefined()
  // Another session started it, so this session's system prompt doesn't claim it.
  expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])
  await pane.unmount()
})

test('the board looks every 30 seconds while CI runs, and every 5 minutes otherwise, reading in full when something changed', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.prs = [pr('pending')]
  await $.command.run(REFRESH)
  expect(gh.prLists).toBe(1)

  // While nothing changes, the look every 30 seconds is a cheap check that GitHub answers 304: nothing more is read.
  await clock.advance(30_000)
  expect(gh.prLists).toBe(1)

  // CI finishes, so its check runs change: the next look reads in full, and then every 5 minutes.
  gh.prs = [pr('pass')]
  gh.etag = 'E2'
  await clock.advance(30_000)
  expect(gh.prLists).toBe(2)
  gh.etag = 'E3'
  await clock.advance(4 * 60_000)
  expect(gh.prLists).toBe(2)
  await clock.advance(60_000)
  expect(gh.prLists).toBe(3)
})

test('the timer reads GitHub in full only when a cheap check sees a change, and at least every 15 minutes', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  const logged: string[] = []
  on('ui.log', async (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  await $.command.run(REFRESH)
  await clock.settle()
  expect(gh.issueReads).toBe(1)
  // Each full read logs what its GraphQL query cost.
  expect(logged).toContain('issue-board: the issues query cost 1 GraphQL points over 1 page; 4999 left until 2026-10-04T11:00:00Z')

  // Five minutes on, nothing changed: GitHub answers 304, which costs nothing, and the board reads no more.
  await clock.advance(5 * 60_000)
  expect(gh.issueReads).toBe(1)
  expect(gh.looks).toBeGreaterThan(1)

  // Something changed: the next look reads in full.
  gh.etag = 'E2'
  await clock.advance(5 * 60_000)
  expect(gh.issueReads).toBe(2)

  // Nothing changes again, but a project field's change shows in no cheap check: 15 minutes on, it reads anyway.
  await clock.advance(10 * 60_000)
  expect(gh.issueReads).toBe(2)
  await clock.advance(5 * 60_000)
  expect(gh.issueReads).toBe(3)
})

test('the weekly counts are read again only after an hour', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  await $.command.run(REFRESH)
  expect(gh.searches).toBe(2)
  await $.command.run(REFRESH)
  expect(gh.searches).toBe(2)
  await clock.advance(61 * 60_000)
  await $.command.run(REFRESH)
  expect(gh.searches).toBe(4)
})

test("when GitHub's rate limit runs out, the board says when it resets, says so once, and reads nothing until then", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  gh.limited = '2026-10-04T10:20:00Z'
  const at = new Date(Date.parse(gh.limited)).toTimeString().slice(0, 5)
  const said = await $.command.run(REFRESH)
  expect(said.text).toBe(`Couldn't refresh: GitHub's rate limit for this account ran out. The board reads again at ${at}.`)
  expect(toasts.filter(text => text.includes('rate limit'))).toEqual([`GitHub's rate limit ran out; the issue board waits until ${at}`])
  const reads = gh.issueReads

  // Until the reset, neither the timer nor a refresh asked for reads GitHub.
  await clock.advance(15 * 60_000)
  await $.command.run(REFRESH)
  expect(gh.issueReads).toBe(reads)

  // Once it resets, the board reads again by itself, and the error goes.
  gh.limited = ''
  await clock.advance(6 * 60_000)
  expect(gh.issueReads).toBe(reads + 1)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /rate limit/ })).toBeUndefined()
  expect(await ui.find({ key: 'issue-315' })).toBeDefined()
  await ui.unmount()
  expect(toasts.filter(text => text.includes('rate limit'))).toHaveLength(1)
})

test("another session's newer read of the same repo is taken rather than reading GitHub again", async ($, on) => {
  // The store every session on the machine shares.
  const stored = new Map<string, unknown>()
  on('store.get', async (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', async (_$, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  await $.command.run(REFRESH)
  await clock.settle()
  expect(gh.issueReads).toBe(1)

  // Another session on the same repo reads GitHub a minute later and saves its board.
  await clock.advance(60_000)
  const [key = ''] = [...stored.keys()].filter(one => one.startsWith('repo:'))
  const saved = stored.get(key) as { board: { fetchedAt: number; issues: { number: number; title: string }[] } }
  const renamed = saved.board.issues.map(one => (one.number === 315 ? { ...one, title: 'Lay Kessik out for play, renamed' } : one))
  stored.set(key, { ...saved, board: { ...saved.board, fetchedAt: Date.parse('2026-10-04T10:01:00Z'), issues: renamed } })

  // This session's next look takes it: the new title shows, and GitHub isn't read.
  await clock.advance(5 * 60_000)
  expect(gh.issueReads).toBe(1)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  expect(await ui.find({ text: /renamed/ })).toBeDefined()
  await ui.unmount()
})

test('issue_create files an issue with every option over REST, puts it in the project, and on the board at once', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  on('tool.check', async () => ({ decision: 'ask' as const }))
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const reads = gh.issueReads

  // Filing changes something, so Claude Code asks first, as it does for any such tool.
  expect((await $.tool.check({ tool: 'mcp__issue-board__issue_create', input: { title: 'x' } })).decision).toBe('ask')

  const filed = await $.tool.call({
    tool: 'mcp__issue-board__issue_create',
    title: 'Dock at a station',
    body: '## Acceptance\n- [ ] Docking works',
    labels: ['enhancement'],
    assign: ['@me'],
    milestone: 'launch',
    parent: 315,
    status: 'Ready',
    priority: 'P1',
  })
  expect(String(filed.result)).toBe('Filed #340: “Dock at a station”, labelled enhancement, assigned astrosteveo, on Launch, under #315, in Void Sector, Ready, P1.')
  // One REST call made the issue with its labels, assignee and milestone; one more put it under the epic.
  expect(gh.filed).toEqual([{ title: 'Dock at a station', body: '## Acceptance\n- [ ] Docking works', labels: ['enhancement'], assignees: ['astrosteveo'], milestone: 3 }])
  expect(gh.linked).toEqual([[315, '9340']])
  expect(gh.planned[340]).toEqual({ status: 'Ready', priority: 'P1' })

  // It shows at once, with its box, without the board reading GitHub again.
  expect(gh.issueReads).toBe(reads)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-340' })
  expect(await ui.find({ text: /Docking works/ })).toBeDefined()
  await ui.unmount()
})

test("issue_create takes the item a project's own auto-add made, and goes on to set its fields", async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  gh.autoAdded = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const filed = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Added already', priority: 'P2' })
  expect(String(filed.result)).toBe('Filed #340: “Added already”, in Void Sector, Inbox, P2.')
  expect(gh.fields.filter(one => one.item === 'PVTI_auto_340').map(one => one.option)).toEqual([optionId('Inbox'), optionId('P2')])
})

test('issue_create with only a title files it to the Inbox, and a step that fails after filing is named with the number', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)

  const bare = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Look into lag' })
  expect(String(bare.result)).toBe('Filed #340: “Look into lag”, in Void Sector, Inbox.')
  expect(gh.filed.at(-1)).toEqual({ title: 'Look into lag', body: '', labels: [], assignees: [] })

  // The link to the epic fails once the issue exists: the answer says so, and gives the issue's number.
  gh.failLink = true
  const partly = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Look into lag again', parent: 315, priority: 'P9' })
  expect(String(partly.result)).toBe(
    "Filed #341: “Look into lag again”, in Void Sector, Inbox. The issue exists, but the board couldn't put it under #315 (gh: Sub issue may only have one parent (HTTP 422)); nor set its Priority: the project has no Priority called P9.",
  )

  // Without a title, or with a milestone the repo hasn't, nothing is filed.
  const filed = gh.filed.length
  expect((await $.tool.call({ tool: 'mcp__issue-board__issue_create', body: 'x' })).deny).toBe('Give the issue a title.')
  expect((await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'x', milestone: 'Someday' })).deny).toBe("Couldn't file the issue: the repo has no open milestone called Someday")
  expect(gh.filed).toHaveLength(filed)
})

test('issue_create files an epic and its sub-issues in order, each under it and in the project, and goes on past one that fails', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const reads = gh.issueReads

  const filed = await $.tool.call({
    tool: 'mcp__issue-board__issue_create',
    title: 'Stations',
    body: 'Docking and trade.',
    status: 'Backlog',
    subIssues: [
      { title: 'Dock at a station', body: '- [ ] Docking works', priority: 'P1' },
      { title: 'A sub-issue GitHub refused' },
      { title: 'Trade at a station', labels: ['enhancement'] },
    ],
  })
  expect(String(filed.result)).toBe(
    [
      'Filed #340: “Stations”, in Void Sector, Backlog.',
      'Its sub-issues:',
      '- Filed #341: “Dock at a station”, under #340, in Void Sector, Inbox, P1.',
      "- Couldn't file sub-issue 2, “A sub-issue GitHub refused”: gh: Validation Failed (HTTP 422)",
      '- Filed #342: “Trade at a station”, labelled enhancement, under #340, in Void Sector, Inbox.',
    ].join('\n'),
  )
  expect(gh.linked).toEqual([
    [340, '9341'],
    [340, '9342'],
  ])

  // The epic and its parts show at once, grouped under it, without a read.
  expect(gh.issueReads).toBe(reads)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'group-epic' })
  expect(await ui.find({ text: /^#340 Stations/ })).toBeDefined()
  expect(await ui.find({ text: /0\/2 closed/ })).toBeDefined()
  await ui.unmount()

  // An issue filed as blocked by another shows so at once.
  const blocked = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'Refuel at a station', blockedBy: [289] })
  expect(String(blocked.result)).toBe('Filed #343: “Refuel at a station”, blocked by #289, in Void Sector, Inbox.')
  expect(gh.blocks).toEqual(['343 90289'])
  const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await pane.press({ key: 'filter-all' })
  expect(await pane.find({ text: /⛔ #289/ })).toBeDefined()
  await pane.unmount()

  // A sub-issue can't have sub-issues of its own.
  const nested = await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'x', subIssues: [{ title: 'y', subIssues: [{ title: 'z' }] }] })
  expect(nested.deny).toBe('Sub-issue 1: A sub-issue takes no sub-issues of its own.')
})

test('the issues tool reads a closed issue from GitHub, searches every issue, and filters the open ones by label', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  await $.command.run(REFRESH)

  // An issue the board doesn't hold is read from GitHub, with how it closed and its boxes.
  const closed = await $.tool.call({ tool: 'mcp__issue-board__issues', number: 290 })
  expect(String(closed.result)).toBe(
    [
      '#290 Dock the shuttle (closed as completed 1d ago)',
      'https://github.com/astrosteveo/void-sector/issues/290',
      'Labels: enhancement',
      'Assignees: astrosteveo',
      'Boxes (1/2 ticked):',
      '1. [x] Shipped',
      '2. [ ] Follow up',
      'Read the whole issue with `gh issue view 290`.',
      // A long thread: the latest ten, newest last, and how many earlier ones are left out.
      'Comments (the latest 10 of 12; 2 earlier left out):',
      ...Array.from({ length: 10 }, (_, index) => `— @${(index + 2) % 2 ? 'alice' : 'astrosteveo'}, 1h ago:\n  Note ${index + 3}.`),
    ].join('\n'),
  )
  // One read of the thread, of the page that holds its latest comments.
  expect(gh.commentReads).toEqual(['290 page 1'])

  // An open issue in full carries its comments too. One the board counts none on says so without reading GitHub.
  gh.comments[289] = [{ user: { login: 'alice' }, body: 'Seen it too.', created_at: '2026-10-04T09:30:00Z' }]
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', number: 289 })).result)).toMatch(/\nComments \(1\):\n— @alice, 30m ago:\n  Seen it too\.$/)
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', number: 315 })).result)).toMatch(/\nNo comments\.$/)
  expect(gh.commentReads).toEqual(['290 page 1', '289 page 1'])
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', number: 999 })).result)).toBe("#999 doesn't exist in astrosteveo/void-sector.")

  // Closed issues are GitHub's search to answer, one line each, without pull requests, and how many more there are.
  const found = await $.tool.call({ tool: 'mcp__issue-board__issues', state: 'closed', label: 'needs design' })
  expect(gh.searched.at(-1)).toBe('repo:astrosteveo/void-sector is:issue state:closed label:"needs design"')
  expect(String(found.result)).toBe('#290 Dock the shuttle · closed as completed 1d ago · enhancement\nShowing 1 of 45; narrow the search to see the rest.')
  await $.tool.call({ tool: 'mcp__issue-board__issues', search: 'shuttle dock', assignee: 'astrosteveo' })
  expect(gh.searched.at(-1)).toBe('repo:astrosteveo/void-sector is:issue assignee:astrosteveo shuttle dock')

  // Open issues still come from the board's copy, which a label or an assignee narrows.
  const open = await $.tool.call({ tool: 'mcp__issue-board__issues', label: 'bug' })
  expect(String(open.result)).toMatch(/#289/)
  expect(String(open.result)).not.toMatch(/#315 /)
})

test("the pane's Closed filter lists the issues closed lately, read from GitHub when chosen", async ($, on) => {
  mock.store(on)
  world(on)
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-closed' })
  expect(await ui.find({ text: /Dock the shuttle/ })).toBeDefined()
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  await ui.unmount()
})

test('the milestone tool makes and changes milestones over REST, and the pane and the issues tool show their progress', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  on('tool.check', async () => ({ decision: 'ask' as const }))
  await $.command.run(REFRESH)

  // Reading them is the issues tool's, with no permission prompt; changing one asks.
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', milestones: true })).result)).toBe('Launch · 5/7 closed · due 2026-10-20')
  expect((await $.tool.check({ tool: 'mcp__issue-board__milestone', input: { title: 'Beta' } })).decision).toBe('ask')

  const made = await $.tool.call({ tool: 'mcp__issue-board__milestone', title: 'Beta', due: '2026-11-01', description: 'Playable start to end.' })
  expect(String(made.result)).toBe('Made the milestone Beta: due 2026-11-01, described.')
  expect(gh.milestoneWrites.at(-1)).toBe('POST milestones {"title":"Beta","due_on":"2026-11-01T12:00:00Z","description":"Playable start to end."}')

  const changed = await $.tool.call({ tool: 'mcp__issue-board__milestone', title: 'launch', due: '', close: true })
  expect(String(changed.result)).toBe('Changed the milestone Launch: no due date, closed.')
  expect(gh.milestoneWrites.at(-1)).toBe('PATCH milestones/3 {"due_on":null,"state":"closed"}')

  // A due date not written as a date, and closing one the repo hasn't got, change nothing.
  const writes = gh.milestoneWrites.length
  expect((await $.tool.call({ tool: 'mcp__issue-board__milestone', title: 'Beta', due: 'next week' })).deny).toBe(
    "Couldn't change the milestone: give the due date as YYYY-MM-DD, or an empty string to clear it",
  )
  expect((await $.tool.call({ tool: 'mcp__issue-board__milestone', title: 'Gamma', close: true })).deny).toBe("Couldn't change the milestone: the repo has no milestone called Gamma")
  expect(gh.milestoneWrites).toHaveLength(writes)

  // The pane lists the open ones at once: Launch closed, Beta made.
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^Beta$/ })).toBeDefined()
  expect(await ui.find({ text: /^Launch$/ })).toBeUndefined()
  expect(await ui.find({ text: 'due 2026-11-01' })).toBeDefined()
  await ui.unmount()
})

test("the issues tool lists the project's issues at a Status, closed ones included, read over REST", async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  await $.command.run(REFRESH)
  const list = async (fields: Record<string, unknown>) => String((await $.tool.call({ tool: 'mcp__issue-board__issues', ...fields })).result)

  // What shipped since a date: Done, closed on or after it, without pull requests.
  expect(await list({ status: 'Done', since: '2026-10-01' })).toBe('Void Sector at Done, closed since 2026-10-01 (1):\n#290 Dock the shuttle · closed as completed 1d ago')
  expect(await list({ status: 'verification' })).toBe('Void Sector at verification (1):\n#315 Lay Kessik out for play · open')
  expect(await list({ status: 'Ready' })).toBe('Nothing in Void Sector at Ready.')
  expect(await list({ status: 'Done', since: 'last week' })).toBe('Give since as a date, YYYY-MM-DD.')
})

test("a project's REST path comes from its page, for a user's project or an organization's", () => {
  expect(projectPathOf('https://github.com/users/astrosteveo/projects/9')).toBe('users/astrosteveo/projectsV2/9')
  expect(projectPathOf('https://github.com/orgs/anthropics/projects/12')).toBe('orgs/anthropics/projectsV2/12')
  expect(projectPathOf('https://example.com/elsewhere')).toBeNull()
})

test("issue_update sets the project's other fields by name, checked against each field's kind, and the card shows them", async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Ready', priority: 'P1' }
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const set = (fields: Record<string, unknown>) => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, fields })

  const done = await set({ Estimate: 3, Sprint: 'iteration 2', Due: '2026-10-20', Notes: 'Pairs with #289.' })
  expect(String(done.result)).toBe('#315 Estimate set to 3, Sprint set to iteration 2, Due set to 2026-10-20, Notes set to Pairs with #289..')
  expect(gh.valueWrites).toEqual([
    'PVTI_315 F_estimate {"number":3}',
    'PVTI_315 F_sprint {"iterationId":"IT2"}',
    'PVTI_315 F_due {"date":"2026-10-20"}',
    'PVTI_315 F_notes {"text":"Pairs with #289."}',
  ])
  expect(String((await set({ Notes: null })).result)).toBe('#315 Notes cleared.')
  expect(gh.valueWrites.at(-1)).toBe('PVTI_315 F_notes null')

  // A value that doesn't fit its field, a field the project hasn't got, or Status by this road, sets nothing.
  const writes = gh.valueWrites.length
  expect((await set({ Estimate: 'lots' })).deny).toBe("Couldn't change #315: Estimate takes a number, not lots")
  expect((await set({ Due: 'Friday' })).deny).toBe("Couldn't change #315: Due takes a date, YYYY-MM-DD, not Friday")
  expect((await set({ Sprint: 'Iteration 9' })).deny).toBe("Couldn't change #315: Sprint has no iteration called Iteration 9; it has Iteration 1, Iteration 2")
  expect((await set({ Effort: 1 })).deny).toBe("Couldn't change #315: Void Sector has no field called Effort; it has Status, Priority, Estimate, Sprint, Due, Notes")
  expect((await set({ Status: 'Done' })).deny).toBe("Couldn't change #315: set Status with status, not fields")
  expect(gh.valueWrites).toHaveLength(writes)

  // One issue in full lists its fields; the card shows them, and its editor sets them.
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', number: 315 })).result)).toMatch(/\nFields: Estimate 3, Sprint Iteration 2, Due 2026-10-20\n/)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  expect(await ui.find({ text: /Estimate 3 · Sprint Iteration 2 · Due 2026-10-20/ })).toBeDefined()
  await ui.press({ key: 'edit-315' })
  await ui.press({ key: 'more-315' })
  await ui.press({ key: 'field-315-F_sprint-IT1' })
  expect(gh.valueWrites.at(-1)).toBe('PVTI_315 F_sprint {"iterationId":"IT1"}')
  await ui.input({ key: 'field-315-F_estimate', text: '5' })
  expect(gh.valueWrites.at(-1)).toBe('PVTI_315 F_estimate {"number":5}')
  await ui.unmount()
})

test("an issue's type shows on its card and is set by name, where the repo has types, and offered nowhere else", async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.types = ['Bug', 'Task']
  gh.type315 = 'Task'
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const update = (type: string | null) => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, type })

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  expect(await ui.find({ text: /^Type Task$/ })).toBeDefined()

  expect(String((await update('bug')).result)).toBe('#315 typed bug.')
  expect(gh.patches.at(-1)).toBe('315 {"type":"Bug"}')
  expect(String((await update(null)).result)).toBe('#315 its type taken off.')
  expect(gh.patches.at(-1)).toBe('315 {"type":null}')
  expect((await update('Epic')).deny).toBe("Couldn't change #315: the repo has no issue type called Epic; it has Bug, Task")

  // The card's editor offers the repo's types; filing takes one too.
  await ui.press({ key: 'edit-315' })
  await ui.press({ key: 'more-315' })
  await ui.press({ key: 'type-315-Bug' })
  expect(gh.patches.at(-1)).toBe('315 {"type":"Bug"}')
  await ui.unmount()
  await $.tool.call({ tool: 'mcp__issue-board__issue_create', title: 'A task', type: 'task' })
  expect(gh.filed.at(-1)).toMatchObject({ title: 'A task', type: 'Task' })
})

test('a repo without issue types offers none, and setting one says why it cannot', async ($, on) => {
  mock.store(on)
  world(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  expect((await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, type: 'Bug' })).deny).toBe(
    "Couldn't change #315: the repo has no issue types; they come with an organization's settings",
  )
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })
  await ui.press({ key: 'issue-315' })
  await ui.press({ key: 'edit-315' })
  await ui.press({ key: 'more-315' })
  expect(await ui.find({ key: 'type-315-Bug' })).toBeUndefined()
  await ui.unmount()
})

test('project_archive says how many items it would take first, without asking, and archives them on confirm', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  on('tool.check', async () => ({ decision: 'ask' as const }))
  await $.command.run(REFRESH)
  const archive = (input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__issue-board__project_archive', ...input })
  const check = (input: Record<string, unknown>) => $.tool.check({ tool: 'mcp__issue-board__project_archive', input })

  // Listing changes nothing, so it doesn't ask; archiving does.
  expect((await check({ doneBefore: '2026-10-01' })).decision).toBe('allow')
  expect((await check({ doneBefore: '2026-10-01', confirm: true })).decision).toBe('ask')

  expect(String((await archive({ doneBefore: '2026-10-01' })).result)).toBe(
    "Archiving the items at Done that closed before 2026-10-01 takes 1 item out of the views of Void Sector:\n#250 Old work\nThe issues stay as they are. Call again with confirm: true to archive.",
  )
  expect(gh.archived).toEqual([])
  expect(String((await archive({ doneBefore: '2026-10-01', confirm: true })).result)).toBe('Archived 1 item from Void Sector:\n#250 Old work')
  expect(gh.archived).toEqual(['PVTI_250'])
  // Once archived, it isn't taken again.
  expect(String((await archive({ doneBefore: '2026-10-01' })).result)).toBe('Nothing in Void Sector to archive: no items at Done that closed before 2026-10-01.')

  // One issue's item, by number.
  expect(String((await archive({ number: 290, confirm: true })).result)).toBe('Archived 1 item from Void Sector:\n#290 Dock the shuttle')
  expect(String((await archive({ number: 999 })).result)).toBe("#999 isn't in Void Sector, or is archived already.")
  expect((await archive({ doneBefore: 'soon' })).deny).toBe("Couldn't archive: give doneBefore as a date, YYYY-MM-DD")
})

test("project_status reads the project's latest update without asking, posts one when asked, and the pane shows it", async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  on('tool.check', async () => ({ decision: 'ask' as const }))
  await $.command.run(REFRESH)
  const status = (input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__issue-board__project_status', ...input })

  expect((await $.tool.check({ tool: 'mcp__issue-board__project_status', input: {} })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'mcp__issue-board__project_status', input: { status: 'At risk' } })).decision).toBe('ask')
  expect(String((await status({})).result)).toBe('Void Sector has no status update yet.')

  const posted = await status({ status: 'at risk', note: 'Docking slipped.\nThe glide needs another pass.', target: '2026-10-20' })
  expect(String(posted.result)).toBe('Posted on Void Sector: At risk · Docking slipped. · target 2026-10-20 · just now.')
  expect(gh.statusPosts).toEqual([{ project: 'PVT_8', status: 'AT_RISK', body: 'Docking slipped.\nThe glide needs another pass.', start: null, target: '2026-10-20' }])
  expect(String((await status({})).result)).toBe('Void Sector: At risk · Docking slipped. · target 2026-10-20 · just now\nDocking slipped.\nThe glide needs another pass.')

  // A status GitHub hasn't got, or a date not written as one, posts nothing.
  expect((await status({ status: 'Great' })).deny).toBe("Couldn't post the status update: a status update is On track, At risk, Off track, Complete or Inactive, not Great")
  expect((await status({ status: 'On track', start: 'Monday' })).deny).toBe("Couldn't post the status update: give start as a date, YYYY-MM-DD")
  expect(gh.statusPosts).toHaveLength(1)

  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /At risk · Docking slipped\./ })).toBeDefined()
  await ui.unmount()
})

test('a field the project gained since the last read is read before setting it, rather than refused', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Ready', priority: 'P1' }
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const reads = gh.issueReads
  gh.newField = { id: 'F_effort', name: 'Effort', dataType: 'NUMBER' }
  const set = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, fields: { Effort: 2 } })
  expect(String(set.result)).toBe('#315 Effort set to 2.')
  expect(gh.valueWrites.at(-1)).toBe('PVTI_315 F_effort {"number":2}')
  expect(gh.issueReads).toBeGreaterThan(reads)
})

test('/issues help names every filter, subcommand and tool the board has, and the argument hint every subcommand', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  world(on)
  const tools: string[] = []
  let hint = ''
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => {
    hint = e.argumentHint ?? ''
    return { value: { command: e.name } }
  })
  on('tool.register', async (_$, e) => {
    tools.push(e.name)
    return { value: { tool: `mcp__issue-board__${e.name}` } }
  })
  on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }))
  await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const help = String((await $.command.run({ ...REFRESH, args: 'help' })).text)

  expect(tools.length).toBeGreaterThan(5)
  for (const tool of tools) expect(help).toContain(`- ${tool}: `)
  for (const sub of ['refresh', 'new <what>', 'new epic <what>', 'setup', 'check', 'help']) expect(help).toContain(`- /issues ${sub}: `)
  // Without a project there is no Inbox; every other filter is there.
  expect(help).toContain('Filters: 1 Active, 2 Future, 3 Bugs, 4 Mine, 5 All, 7 Closed.')
  expect(hint).toBe('[refresh | new | new epic | setup | check | help]')
  await clock.settle()
})

test("/issues check notes the project's Item closed workflow when it's on, as a limit that doesn't block", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  const gh = world(on)
  gh.project = true
  gh.itemClosed = true
  await $.command.run(REFRESH)
  const said = String((await $.command.run({ ...REFRESH, args: 'check' })).text)
  expect(said).toContain("Void Sector's Item closed workflow is on.")
  expect(said).toContain('the board moves issues closed as completed to Done by itself.')

  gh.itemClosed = false
  await $.command.run(REFRESH)
  expect(String((await $.command.run({ ...REFRESH, args: 'check' })).text)).not.toContain('Item closed')
  await clock.settle()
})

test('on a short pane the sections above the issues start folded to a summary, and stay as the person leaves them', async ($, on) => {
  mock.store(on)
  world(on)
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const mount = (bodyRows: number) => $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows } } })

  // Short: folded, each a line that sums it up, and the rows beneath hidden.
  const short = await mount(20)
  expect(await short.find({ text: '▸ Pull requests' })).toBeDefined()
  expect(await short.find({ text: /^1 open · ✓ 1$/ })).toBeDefined()
  expect(await short.find({ text: '▸ Milestones' })).toBeDefined()
  expect(await short.find({ text: /^Launch 5\/7$/ })).toBeDefined()
  expect(await short.find({ key: 'pr-335' })).toBeUndefined()

  // Opened, the pull requests show, and stay open on a taller pane and a short one alike.
  await short.press({ key: 'section-prs' })
  expect(await short.find({ key: 'pr-335' })).toBeDefined()
  await short.unmount()
  const tall = await mount(60)
  expect(await tall.find({ key: 'pr-335' })).toBeDefined()
  expect(await tall.find({ text: '▾ Milestones' })).toBeDefined()
  // Folded on the tall pane, it stays folded.
  await tall.press({ key: 'section-milestones' })
  expect(await tall.find({ text: '▸ Milestones' })).toBeDefined()
  await tall.unmount()
})

test('the pane draws on every surface, with search where the surface has a text field', async ($, on) => {
  mock.store(on)
  world(on)
  await $.command.run(REFRESH)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'issue-board', surface, ...PANE })
    expect(await ui.find({ key: 'issue-315' })).toBeDefined()
    expect((await ui.find({ key: 'search' })) !== undefined).toBe(surface !== 'mobile')
    await ui.unmount()
  }
})

test("the project's Status groups the issues, Priority filters them, and the card and Start change both on GitHub", async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  // #315 is planned; #289 isn't in the project yet.
  gh.planned[315] = { status: 'Ready', priority: 'P1' }
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })

  // Priority filters: Now is P0 and P1, Later is P2; an issue with none is in neither.
  expect(await ui.find({ key: 'filter-active' })).toMatchObject({ text: 'Now 1' })
  expect(await ui.find({ key: 'filter-future' })).toMatchObject({ text: 'Later 0' })
  await ui.press({ key: 'filter-all' })

  // Grouped by Status by default, in the project's order, then No status.
  expect(await ui.find({ key: 'group-status' })).toMatchObject({ props: { variant: 'primary' } })
  const headings = async () => (await ui.findAll({ type: 'Text' })).map(text => text.text).filter(text => ['Ready', 'No status', 'simulation', 'other'].includes(text))
  expect(await headings()).toEqual(['Ready', 'No status'])
  // The row: its priority, and the pull request that refers to it with that pull request's CI. The pull request's row
  // names the issue.
  expect(await ui.find({ text: /^P1 $/ })).toBeDefined()
  expect(await ui.find({ text: /^⇄ #335 ✓$/ })).toBeDefined()
  expect(await ui.find({ text: /^→ #315$/ })).toBeDefined()

  await ui.press({ key: 'group-area' })
  expect(await headings()).toEqual(['simulation', 'other'])
  await ui.press({ key: 'group-status' })

  // The card's pickers set Priority on GitHub.
  await ui.press({ key: 'issue-315' })
  expect(await ui.find({ key: 'status-315-S2' })).toMatchObject({ text: 'Ready', props: { variant: 'primary' } })
  await ui.press({ key: 'priority-315-P0' })
  expect(gh.fields.at(-1)).toMatchObject({ project: 'PVT_8', item: 'PVTI_315', field: 'F_priority', option: optionId('P0') })
  expect(await ui.find({ text: /^P0 $/ })).toBeDefined()

  // Start on #289: it joins the project, moves to In progress, and is assigned to the person.
  await ui.press({ key: 'issue-289' })
  await ui.press({ key: 'start-289' })
  expect(sent.at(-1)).toMatch(/^Let's start on #289/)
  expect(gh.fields.at(-2)).toMatchObject({ project: 'PVT_8', content: 'I_289' })
  expect(gh.fields.at(-1)).toMatchObject({ item: 'PVTI_289', field: 'F_status', option: optionId('In progress') })
  expect(gh.assigned).toEqual([289])
  await ui.unmount()
})

test('Backlog is folded until opened, and Epic groups the issues under the epic they belong to', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Backlog', priority: 'P2' }
  gh.planned[289] = { status: 'Ready', priority: 'P1' }
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })

  expect(await ui.find({ key: 'fold-status:Backlog' })).toMatchObject({ text: '▸ Backlog' })
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  expect(await ui.find({ key: 'issue-289' })).toBeDefined()
  await ui.press({ key: 'fold-status:Backlog' })
  expect(await ui.find({ key: 'issue-315' })).toBeDefined()

  await ui.press({ key: 'group-epic' })
  expect(await ui.find({ text: /^No epic$/ })).toBeDefined()
  await ui.unmount()
})

test('a card stays open when a new Priority takes it out of the filter, and leaves when collapsed', async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Ready', priority: 'P1' }
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'filter-active' })).toMatchObject({ text: 'Now 1' })

  await ui.press({ key: 'issue-315' })
  await ui.press({ key: 'priority-315-P2' })
  // P2 is Later, but the card being changed stays, saying so.
  expect(await ui.find({ key: 'start-315' })).toBeDefined()
  expect(await ui.find({ text: /^Not under Now any more\. It leaves the list when you collapse it\.$/ })).toBeDefined()
  expect(await ui.find({ key: 'filter-active' })).toMatchObject({ text: 'Now 0' })

  await ui.press({ key: 'close-315' })
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  await ui.unmount()
})

test("Merge all's confirm goes when the pull requests it waited on have merged, and sends nothing", async ($, on) => {
  mock.store(on)
  const gh = world(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'close-out-all' })
  expect(await ui.find({ key: 'close-out-all-yes' })).toBeDefined()

  // The pull request merges elsewhere while the confirm waits.
  gh.prs = []
  await $.command.run(REFRESH)
  expect(await ui.find({ key: 'close-out-all-yes' })).toBeUndefined()
  expect(await ui.find({ text: /^y merge every open PR/ })).toBeUndefined()
  expect(sent).toEqual([])
  await ui.unmount()
})

// What setup saved for the repo, with the roles given: which Status option, S0 to S5, is which.
const savedRoles = (roles: Record<string, string>) => ({
  [`repo:${REPO.root}`]: { setup: { project: { id: 'PVT_8', number: 8, title: 'Void Sector' }, status: { id: 'F_status', roles }, priority: { id: 'F_priority' }, at: 0 } },
})

test('a project with its own Status names goes by the roles setup saved: its Inbox, the one that folds, and where Start moves', async ($, on) => {
  mock.store(on, savedRoles({ inbox: 'S0', ready: 'S1', backlog: 'S2', started: 'S3', verification: 'S4', done: 'S5' }))
  const gh = world(on)
  gh.project = true
  gh.statusNames = ['Todo', 'Next', 'Someday', 'Doing', 'Review', 'Shipped']
  gh.planned[315] = { status: 'Someday', priority: 'P2' }
  gh.planned[289] = { status: 'Todo', priority: 'P1' }
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'filter-all' })

  // Someday has the Backlog's role, so it folds.
  expect(await ui.find({ key: 'fold-status:Someday' })).toMatchObject({ text: '▸ Someday' })
  expect(await ui.find({ key: 'issue-315' })).toBeUndefined()
  expect(await ui.find({ key: 'issue-289' })).toBeDefined()

  // Todo is the Inbox: #289 waits there, #315 doesn't.
  await ui.press({ key: 'filter-inbox' })
  expect(await ui.find({ key: 'triage-289' })).toBeDefined()
  expect(await ui.find({ key: 'triage-315' })).toBeUndefined()
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', filter: 'inbox' })).result)).toMatch(/Issues \(inbox: Status Todo or none, 1\):\n#289 /)
  await ui.unmount()

  // Start moves #289 to Doing, the option for In progress.
  const started = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 289, start: true })
  expect(String(started.result)).toBe('Started #289: it is the issue this session is on, Doing and assigned.')
  expect(gh.planned[289]?.status).toBe('Doing')
})

test("a role setup left unset turns its part off, even where an option has the board's name, and /issues check says how to set it", async ($, on) => {
  mock.store(on, savedRoles({ ready: 'S2', backlog: 'S1', started: 'S3', done: 'S5' }))
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Inbox', priority: 'P1' }
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  // No Inbox: no filter for it, and #315 is an issue like any other.
  expect(await ui.find({ key: 'filter-inbox' })).toBeUndefined()
  expect(await ui.find({ key: 'filter-all' })).toBeDefined()
  await ui.unmount()

  const said = String((await $.command.run({ ...REFRESH, args: 'check' })).text)
  expect(said).toContain('Void Sector has no Inbox Status set')
  expect(said).toContain("New issues don't land in the Inbox, and the Inbox filter and its triage are gone")
  expect(said).toContain('Void Sector has no Verification Status set')
  expect(said).toContain('Run /issues setup and pick the option for Verification under "Which Status is which"')
  expect(said).not.toContain('no Done Status set')

  // Archiving what is done still works by the saved Done, and Start by the saved In progress.
  const started = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 315, start: true })
  expect(String(started.result)).toMatch(/, In progress and assigned\.$/)
})

test('a board with no Done set archives one issue, but not by doneBefore', async ($, on) => {
  mock.store(on, savedRoles({ inbox: 'S0', started: 'S3' }))
  const gh = world(on)
  gh.project = true
  await $.command.run(REFRESH)
  const by = await $.tool.call({ tool: 'mcp__issue-board__project_archive', doneBefore: '2026-10-01' })
  expect(by.deny).toBe("Couldn't archive: Void Sector has no Done option set; pick one in /issues setup")
  const one = await $.tool.call({ tool: 'mcp__issue-board__project_archive', number: 290 })
  expect(String(one.result)).toMatch(/^Archiving #290 takes 1 item/)
})

test('how many priorities count as Now is a setting', { options: { nowCount: 1 } }, async ($, on) => {
  mock.store(on)
  const gh = world(on)
  gh.project = true
  gh.planned[315] = { status: 'Ready', priority: 'P1' }
  gh.planned[289] = { status: 'Ready', priority: 'P0' }
  await $.command.run(REFRESH)
  const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'filter-active' })).toMatchObject({ text: 'Now 1' })
  expect(await ui.find({ key: 'filter-future' })).toMatchObject({ text: 'Later 1' })
  await ui.unmount()
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', filter: 'active' })).result)).toMatch(/Issues \(now: P0, 1\):\n#289 /)
  expect(String((await $.tool.call({ tool: 'mcp__issue-board__issues', filter: 'future' })).result)).toMatch(/Issues \(later: P1 and P2, 1\):\n#315 /)
})
