import type { On } from 'claude-code'

import { permissions } from './engine'
import { ASTEROIDS, KESSIK, KESSIK_BODY, adoptedStore, fail, fakeGitHub, json, ok, pr335, session } from './github'
import type { Route } from './github'
import { PRIORITIES, STATUSES, asksProject, graphArgs, graphPage, isIssuesQuery, isItemWrite, optionId } from './graph'
import { REPO, band, pane } from './ui'

// The Void Sector repo as the tests of the board's tools, its capture, its polling and its pane see it: Kessik (#315)
// and the asteroids bug (#289) open, pull request #335 for Kessik, and the project when a test turns it on. The fake
// keeps what the tests change and what gh was asked to write.

export const PANE = pane(100, 40)
export const BAND = band(100)
export const CAPTURE = 'mcp__issue-board__capture'

export const issue = (body: string, updatedAt = KESSIK.updatedAt) => ({ ...KESSIK, body, updatedAt })
export const other = { ...ASTEROIDS, comments: 1 }

// An issue closed as completed, as GitHub's REST answers it.
export const CLOSED = {
  number: 290,
  title: 'Dock the shuttle',
  html_url: 'https://github.com/astrosteveo/void-sector/issues/290',
  state: 'closed',
  state_reason: 'completed',
  closed_at: '2026-10-03T10:00:00Z',
  labels: [{ name: 'enhancement' }],
}

// What setup saved for the repo, with the roles given: which Status option, S0 to S5, is which.
export const savedRoles = (roles: Record<string, string>) => ({
  [`choices:${REPO.root}`]: { preferred: 'PVT_8', statuses: { PVT_8: roles } },
})

// What a test sets on the world, beyond the fake GitHub's own repo, issues, pull requests, branch, project, views,
// types and ETag:
// - `planned`: each issue's Status and Priority in the project; `statusNames`: the project's own names for S0 to S5.
// - `refuseProject`: what GitHub says to a query that asks for projects, as to a token without read:project.
// - `limited`: when set, GraphQL refuses for a rate limit that resets then.
// - `failLink` refuses a sub-issue link; `autoAdded` has the project's auto-add hold a new issue already, so GitHub
//   refuses the board's add; `failClosed` fails the read of the issues closed lately.
// - `newField`: a field the project gained since the board's last read; `itemClosed`: its Item closed workflow is on.
// - `comments`: each issue's comments as REST gives them, oldest first; `milestones`: the repo's, as REST has them;
//   `values`: each item's field values by name; `type315`: #315's issue type.
// What it keeps: `edits` (#315's bodies as written), `filed`, `linked` ([epic, the sub-issue's id]), `blocks`
// (`<issue> <blocker's id>`), `commented` ([issue, body]), `searched`, `commentReads`, `milestoneWrites`, `valueWrites`
// (`item field value`), `archived`, `statusPosts`, `patches` (`<number> <fields>`), `assigned`, `fields` (each
// GraphQL write's arguments), and counts of the issues read (`issueReads`), cheap checks (`looks`), open pull request
// reads (`prLists`) and weekly-count searches (`searches`).
export const world = (on: On) => {
  // These tests have the board write to the project, which the person let it do.
  adoptedStore(on)
  const route: Route = ({ argv, stdin }) => {
    if (argv[0] !== 'gh') return undefined
    if (argv[1] === 'api' && argv[2] === '-i') {
      gh.looks += 1
      return undefined
    }
    if (isIssuesQuery(argv)) {
      gh.issueReads += 1
      if (gh.limited) return fail('GraphQL: API rate limit already exceeded for user ID 1.')
      if (gh.refuseProject && asksProject(argv)) return fail(gh.refuseProject)
      const page = JSON.parse(
        graphPage([{ ...issue(gh.body), ...gh.planned[315], ...(gh.type315 ? { type: gh.type315 } : {}) }, { ...other, ...gh.planned[289] }], argv, gh.project, gh.types, gh.views),
      ) as { data: { repository: { projectsV2?: { nodes: { fields: { nodes: unknown[] } }[] } } } }
      if (gh.newField) page.data.repository.projectsV2?.nodes[0]?.fields.nodes.push(gh.newField)
      const statusField = page.data.repository.projectsV2?.nodes[0]?.fields.nodes[0] as { options?: { id: string; name: string }[] } | undefined
      if (gh.statusNames && statusField) statusField.options = gh.statusNames.map((name, index) => ({ id: `S${index}`, name }))
      const linked = page.data.repository.projectsV2?.nodes[0] as Record<string, unknown> | undefined
      if (linked) linked.workflows = { nodes: [{ name: 'Item closed', enabled: gh.itemClosed }] }
      return ok(JSON.stringify(page))
    }
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv[3] === '--input' && !isItemWrite(argv, stdin)) {
      const asked = JSON.parse(stdin ?? '{}') as { query: string; variables: Record<string, unknown> }
      const item = String(asked.variables.item)
      if (asked.query.includes('projectItems')) {
        const issue = String(asked.variables.issue)
        return json({ data: { node: { projectItems: { nodes: [{ id: `PVTI_auto_${issue.slice(2)}`, project: { id: 'PVT_8' } }] } } } })
      }
      if (asked.query.includes('createProjectV2StatusUpdate')) {
        gh.statusPosts.push(asked.variables)
        return json({ data: { createProjectV2StatusUpdate: { statusUpdate: { id: 'SU_1', createdAt: '2026-10-04T10:00:00Z' } } } })
      }
      if (asked.query.includes('archiveProjectV2Item')) {
        gh.archived.push(item)
        return json({ data: { archiveProjectV2Item: { item: { id: item } } } })
      }
      if (asked.query.includes('fieldValues')) {
        const nodes = Object.entries(gh.values[item] ?? {}).map(([name, value]) => ({ [typeof value === 'number' ? 'number' : 'text']: value, field: { name } }))
        return json({ data: { node: { fieldValues: { nodes } } } })
      }
      const field = String(asked.variables.field)
      const value = asked.query.includes('clearProjectV2') ? null : (asked.variables.value as Record<string, unknown>)
      gh.valueWrites.push(`${item} ${field} ${JSON.stringify(value)}`)
      const name = { F_estimate: 'Estimate', F_sprint: 'Sprint', F_due: 'Due', F_notes: 'Notes' }[field] ?? field
      const shown = value === null ? undefined : (value.number ?? value.date ?? value.text ?? (value.iterationId === 'IT2' ? 'Iteration 2' : 'Iteration 1'))
      gh.values[item] = { ...gh.values[item], [name]: shown }
      if (shown === undefined) delete gh.values[item]?.[name]
      return json({ data: {} })
    }
    if (argv[1] === 'api' && argv[2] === 'graphql') {
      // A mutation: its arguments, and the change it makes to the project.
      const args = graphArgs(argv, stdin)
      if (args.query?.startsWith('{ rateLimit')) return json({ data: { rateLimit: { resetAt: gh.limited } } })
      // The pull requests' review threads: a read, not a change.
      if (args.query?.includes('reviewThreads')) return undefined
      gh.fields.push(args)
      if (args.query?.includes('addProjectV2ItemById')) {
        if (gh.autoAdded) return fail('gh: Content already exists in this project')
        return json({ data: { addProjectV2ItemById: { item: { id: `PVTI_${args.content?.slice(2)}` } } } })
      }
      const number = Number(args.item?.slice('PVTI_'.length))
      const name = (gh.statusNames && args.field === 'F_status' ? gh.statusNames[Number(args.option?.slice(1))] : [...STATUSES, ...PRIORITIES].find(one => optionId(one) === args.option)) ?? ''
      gh.planned[number] = { ...gh.planned[number], ...(args.field === 'F_status' ? { status: name } : { priority: name }) }
      return json({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: args.item } } } })
    }
    if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'POST' && /^repos\/.*\/issues$/.test(argv[4] ?? '')) {
      const fields = JSON.parse(stdin ?? '{}') as { title: string; labels: string[]; assignees: string[] }
      if (fields.title.includes('refused')) return fail('gh: Validation Failed (HTTP 422)')
      gh.filed.push(fields)
      const number = gh.next++
      return json({
        number,
        id: 9000 + number,
        node_id: `I_${number}`,
        html_url: `https://github.com/astrosteveo/void-sector/issues/${number}`,
        updated_at: '2026-10-04T10:00:00Z',
        labels: fields.labels.map(name => ({ name, color: 'ededed' })),
        assignees: fields.assignees.map(login => ({ login })),
      })
    }
    if (argv[1] === 'api' && argv[2] === '-X' && /\/sub_issues$/.test(argv[4] ?? '')) {
      if (gh.failLink) return fail('gh: Sub issue may only have one parent (HTTP 422)')
      gh.linked.push([Number(/issues\/(\d+)\//.exec(argv[4] ?? '')?.[1]), argv[argv.length - 1]?.split('=')[1] ?? ''])
      return ok('{}')
    }
    const posted = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(argv[4] ?? '')
    if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'POST' && posted) {
      gh.commented.push([Number(posted[1]), (JSON.parse(stdin ?? '{}') as { body: string }).body])
      return ok('{}')
    }
    const thread = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments\?per_page=100&page=(\d+)$/.exec(argv[2] ?? '')
    if (argv[1] === 'api' && thread) {
      gh.commentReads.push(`${thread[1]} page ${thread[2]}`)
      const all = gh.comments[Number(thread[1])] ?? []
      const page = Number(thread[2])
      return json(all.slice((page - 1) * 100, page * 100))
    }
    const one = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(argv[2] ?? '')
    if (argv[1] === 'api' && one && argv.includes('.id')) return ok(`90${one[1]}\n`)
    // #315's body over REST: read with when it last changed, and written with a PATCH, which answers the issue as it is.
    if (argv[1] === 'api' && one?.[1] === '315' && argv.includes('{body, updated_at}')) return json({ body: gh.body, updated_at: '2026-10-04T09:00:00Z' })
    if (argv[1] === 'api' && argv[3] === 'PATCH' && argv[4]?.endsWith('/issues/315') && (stdin ?? '').includes('"body"')) {
      gh.body = (JSON.parse(stdin ?? '{}') as { body: string }).body
      gh.edits.push(gh.body)
      const now = issue(gh.body, '2026-10-04T09:00:00Z')
      return json({ title: now.title, body: now.body, updated_at: now.updatedAt })
    }
    // An issue the board doesn't hold: #290 closed as completed; nothing else exists.
    if (argv[1] === 'api' && one) {
      if (one[1] !== '290') return fail('gh: Not Found (HTTP 404)')
      return json({ ...CLOSED, body: '- [x] Shipped\n- [ ] Follow up', assignees: [{ login: 'astrosteveo' }], comments: 12 })
    }
    if (argv[1] === 'api' && argv[2] === '-X' && argv[4] === 'search/issues') {
      gh.searched.push(argv[argv.indexOf('-f') + 1]?.slice(2) ?? '')
      return json({ total_count: 45, items: [CLOSED, { ...CLOSED, number: 291, title: 'A pull request', pull_request: {} }] })
    }
    if (argv[1] === 'api' && argv[2]?.includes('/issues?state=closed')) return gh.failClosed ? fail('gh: Server Error (HTTP 502)') : json([CLOSED])
    if (argv[1] === 'api' && argv[2] === '-X' && argv[4]?.includes('/dependencies/blocked_by')) {
      gh.blocks.push(`${/issues\/(\d+)\//.exec(argv[4])?.[1]} ${argv[6]?.split('=')[1]}`)
      return ok('{}')
    }
    // The project over REST: its fields, and its items with the Status field's values.
    if (argv[1] === 'api' && argv[2] === 'users/astrosteveo/projectsV2/8/fields?per_page=50') return json([{ id: 111, name: 'Status' }])
    if (argv[1] === 'api' && argv[2] === 'users/astrosteveo/projectsV2/8/items?per_page=100&fields=111') {
      const item = (status: string, content: Record<string, unknown>, type = 'Issue') => ({
        node_id: `PVTI_${String(content.number)}`,
        archived_at: gh.archived.includes(`PVTI_${String(content.number)}`) ? '2026-10-04T10:00:00Z' : null,
        content_type: type,
        content,
        fields: [{ name: 'Status', value: { name: { raw: status } } }],
      })
      return json([
        item('Done', { number: 290, title: 'Dock the shuttle', state: 'closed', state_reason: 'completed', closed_at: '2026-10-03T10:00:00Z' }),
        item('Done', { number: 250, title: 'Old work', state: 'closed', state_reason: 'completed', closed_at: '2026-09-01T10:00:00Z' }),
        item('Verification', { number: 315, title: 'Lay Kessik out for play', state: 'open' }),
        item('Done', { number: 335, title: 'Glide in to a planet', state: 'closed' }, 'PullRequest'),
      ])
    }
    if (argv[1] === 'api' && argv[2]?.endsWith('/labels?per_page=100')) return json([{ name: 'bug' }, { name: 'enhancement' }, { name: 'area:simulation' }])
    if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'PATCH' && /\/issues\/\d+$/.test(argv[4] ?? '')) {
      const fields = JSON.parse(stdin ?? '{}') as { type?: string | null }
      gh.patches.push(`${/(\d+)$/.exec(argv[4] ?? '')?.[1]} ${JSON.stringify(fields)}`)
      if ('type' in fields) gh.type315 = fields.type ?? ''
      return ok('{}')
    }
    if (argv[1] === 'api' && argv[2] === '-X' && argv[4]?.includes('/milestones')) {
      const fields = JSON.parse(stdin ?? '{}') as Record<string, unknown>
      gh.milestoneWrites.push(`${argv[3]} ${argv[4].replace(/^repos\/[^/]+\/[^/]+\//, '')} ${JSON.stringify(fields)}`)
      if (argv[3] === 'POST') gh.milestones.push({ number: 4, state: 'open', description: '', open_issues: 0, closed_issues: 0, due_on: null, ...fields })
      else gh.milestones = gh.milestones.map(one => (argv[4]?.endsWith(`/${String(one.number)}`) ? { ...one, ...fields } : one))
      return ok('{}')
    }
    if (argv[1] === 'api' && argv[2]?.includes('/milestones')) {
      const open = argv[2].includes('state=open')
      return json(gh.milestones.filter(one => !open || one.state === 'open'))
    }
    if (argv[1] === 'issue' && argv[2] === 'edit' && argv.includes('--add-assignee')) {
      gh.assigned.push(Number(argv[3]))
      return ok('')
    }
    // Any issue's node id, closed ones included, and the fresh look at an issue Start takes.
    if (argv[1] === 'issue' && argv[2] === 'view') return json(argv.includes('id') ? { id: `I_${argv[3]}` } : issue(gh.body, '2026-10-04T09:00:00Z'))
    if (argv[1] === 'api') return undefined
    if (argv.includes('closed') || argv.includes('merged')) {
      gh.searches += 1
      return ok('[]')
    }
    if (argv[1] === 'pr') gh.prLists += 1
    return undefined
  }
  const gh = Object.assign(fakeGitHub(on, { prs: [pr335('pass')], branch: 'fix/planet-glide', etag: 'E1', routes: [route] }), {
    body: KESSIK_BODY,
    edits: [] as string[],
    prLists: 0,
    statusNames: null as string[] | null,
    planned: {} as Record<number, { status?: string; priority?: string }>,
    refuseProject: '',
    fields: [] as Record<string, string>[],
    assigned: [] as number[],
    looks: 0,
    issueReads: 0,
    searches: 0,
    limited: '',
    filed: [] as Record<string, unknown>[],
    linked: [] as [number, string][],
    failLink: false,
    autoAdded: false,
    newField: null as Record<string, unknown> | null,
    itemClosed: false,
    // The number the next filed issue gets.
    next: 340,
    blocks: [] as string[],
    searched: [] as string[],
    comments: {
      290: Array.from({ length: 12 }, (_, index) => ({ user: { login: index % 2 ? 'alice' : 'astrosteveo' }, body: `Note ${index + 1}.`, created_at: '2026-10-04T09:00:00Z' })),
    } as Record<number, unknown[]>,
    commentReads: [] as string[],
    commented: [] as [number, string][],
    milestones: [{ number: 3, title: 'Launch', state: 'open', due_on: '2026-10-20T00:00:00Z', description: '', open_issues: 2, closed_issues: 5 }] as Record<string, unknown>[],
    milestoneWrites: [] as string[],
    values: {} as Record<string, Record<string, unknown>>,
    valueWrites: [] as string[],
    type315: '',
    archived: [] as string[],
    statusPosts: [] as Record<string, unknown>[],
    patches: [] as string[],
    failClosed: false,
  })
  session(on)
  // The engine beneath the board's write tools: its permission check, and the person at its prompt.
  const engine = permissions(on)
  return Object.assign(gh, { engine })
}
