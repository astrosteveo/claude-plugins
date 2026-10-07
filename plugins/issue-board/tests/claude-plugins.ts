import type { On } from 'claude-code'

import { letThrough } from './engine'
import { adoptedStore, fail, fakeGitHub, json, ok } from './github'
import type { Call, Route } from './github'
import { asksProject, graphArg, graphHas, graphPage, isGraphMutation, isIssuesQuery } from './graph'
import type { Raw } from './graph'
import { pane } from './ui'

// The claude-plugins repo with its project, as the tests of the board's edits, its moves and its permission checks see
// it: epic #35 and its sub-issue #43, which the tests change.

export const PANE = pane(120, 80)
export const EPIC = { number: 35, title: 'Make the issue board a full issue tracker', total: 12, completed: 6 }

// A gh call as the tests list it: without `gh`, with what went on stdin.
type Sent = { argv: string[]; stdin?: string }

// GitHub for claude-plugins with its project, the open pull requests `prs`, and `extra` open issues beside #35 and #43.
// It keeps every gh command asked for with its stdin, and how often the issues were read.
export const github = (on: On, prs: unknown[] = [], extra: Raw[] = []) => {
  // These tests have the board write to the project, which the person let it do.
  adoptedStore(on)
  on('session.root', async () => ({ value: '/work/void-sector' }))
  // `blocked`: what #43 is blocked by on GitHub, as the links made leave it.
  // `closed`: how an issue closed on GitHub, which takes it off the board's next read.
  // `title` and `body`: #43's on GitHub, which a PATCH changes; `patched`, what each PATCH sent.
  const state = {
    links: [] as string[],
    blocked: [] as number[],
    closed: {} as Record<number, string>,
    title: 'Edit issues from the board',
    body: '- [ ] Edit',
    patched: [] as Record<string, string>[],
    // Labels made, as `name color`; and which pull requests merged, by number.
    madeLabels: [] as string[],
    merged: {} as Record<number, boolean>,
    // Comments posted and closes made over REST; `noDuplicate` has GitHub refuse the duplicate reason.
    posted: [] as string[],
    closes: [] as string[],
    noDuplicate: false,
    // #35's sub-issues in GitHub's order, and each move made, as `<sub-issue id> <before_id|after_id>=<id>`.
    order: [43] as number[],
    moves: [] as string[],
    // Issues the board holds that GitHub no longer has, so reading their REST id answers 404.
    gone: [] as number[],
    // When set, GitHub refuses to set a project field.
    refuseFields: false,
    // Every gh command but the issues query and the open pull requests, without `gh`.
    get calls(): Sent[] {
      return gh.ran
        .filter(({ argv }) => argv[0] === 'gh' && !isIssuesQuery(argv) && !(argv[1] === 'pr' && argv[2] === 'list' && !argv.includes('merged')))
        .map(({ argv, stdin }) => ({ argv: argv.slice(1), ...(stdin !== undefined ? { stdin } : {}) }))
    },
    // Every command run, git's too, as one line each, with what went on stdin.
    get ran(): string[] {
      return gh.ran.map(({ argv, stdin }: Call) => (stdin === undefined ? argv.join(' ') : `${argv.join(' ')} ${stdin}`))
    },
    // How often the issues were read.
    get reads(): number {
      return gh.ran.filter(({ argv }) => isIssuesQuery(argv)).length
    },
  }
  const route: Route = ({ argv, stdin }) => {
    if (isIssuesQuery(argv)) {
      const open: Raw[] = [
        { number: 35, title: EPIC.title, labels: [], body: 'The whole.', updatedAt: '2026-10-05T00:00:00Z', subIssues: { total: 12, completed: 6 }, status: 'In progress', priority: 'P1' },
        {
          number: 43,
          title: state.title,
          labels: [{ name: 'enhancement' }],
          body: state.body,
          updatedAt: '2026-10-05T00:00:00Z',
          parent: EPIC,
          status: 'Ready',
          priority: 'P1',
          blockedBy: state.blocked.map(number => ({ number, state: 'OPEN' })),
        },
        ...extra,
      ]
      return ok(graphPage(open.filter(raw => !state.closed[raw.number]), argv, asksProject(argv)))
    }
    // A moved issue is no longer this repo's.
    if (argv[1] === 'issue' && argv[2] === 'transfer') state.closed = { ...state.closed, [Number(argv[3])]: 'transferred' }
    if (argv[1] === 'api' && argv[2]?.endsWith('/issues/35/sub_issues?per_page=100')) return json(state.order.map(number => ({ number })))
    if (argv[1] === 'api' && argv[3] === 'PATCH' && argv[4]?.endsWith('/sub_issues/priority')) {
      const id = argv[6]?.split('=')[1] ?? ''
      const [side, other] = argv[8]?.split('=') ?? []
      state.moves.push(`${id} ${side}=${other}`)
      const number = Number(id.slice(2))
      const beside = Number(other?.slice(2))
      const rest = state.order.filter(one => one !== number)
      const at = rest.indexOf(beside) + (side === 'after_id' ? 1 : 0)
      state.order = [...rest.slice(0, at), number, ...rest.slice(at)]
      return ok('{}')
    }
    if (argv[1] === 'api' && argv[3] === 'POST' && argv[4]?.endsWith('/comments')) {
      state.posted.push(`${/issues\/(\d+)\//.exec(argv[4])?.[1]} ${(JSON.parse(stdin ?? '{}') as { body?: string }).body}`)
      return ok('{}')
    }
    if (argv[1] === 'api' && argv[3] === 'PATCH' && argv.includes('state=closed')) {
      const reason = argv.find(arg => arg.startsWith('state_reason='))?.slice(13) ?? ''
      if (reason === 'duplicate' && state.noDuplicate) return fail('gh: Validation Failed (HTTP 422)')
      const number = Number(/issues\/(\d+)$/.exec(argv[4] ?? '')?.[1])
      state.closes.push(`${number} ${reason}`)
      state.closed = { ...state.closed, [number]: reason }
      return ok('{}')
    }
    // Which repos are private: void-sector is, this one isn't.
    if (argv[1] === 'api' && argv.includes('.private')) return ok(argv[2] === 'repos/astrosteveo/void-sector' ? 'true\n' : 'false\n')
    const pull = /\/pulls\/(\d+)$/.exec(argv[2] ?? '')
    if (argv[1] === 'api' && pull) return ok(state.merged[Number(pull[1])] ? '2026-10-05T12:00:00Z\n' : 'null\n')
    if (argv[1] === 'api' && argv[2]?.endsWith('/labels?per_page=100')) return json([{ name: 'bug', color: 'd73a4a' }, { name: 'enhancement', color: 'a2eeef' }, { name: 'area:issue-board', color: '1d76db' }])
    if (argv[1] === 'api' && argv[3] === 'POST' && argv[4]?.endsWith('/labels')) {
      state.madeLabels.push(`${argv[6]?.slice(5)} ${argv[8]?.slice(6)}`)
      return ok('{}')
    }
    if (argv[1] === 'api' && argv.includes('{body, updated_at}')) return json({ body: state.body, updated_at: '2026-10-05T00:00:00Z' })
    if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'PATCH') {
      const fields = JSON.parse(stdin ?? '{}') as Record<string, string>
      state.patched.push(fields)
      state.title = fields.title ?? state.title
      state.body = fields.body ?? state.body
      return json({ title: state.title, body: state.body, updated_at: '2026-10-05T00:00:00Z' })
    }
    if (argv[1] === 'api' && argv.includes('{state, state_reason}')) {
      const how = state.closed[Number(/issues\/(\d+)$/.exec(argv[2] ?? '')?.[1])]
      return json(how ? { state: 'closed', state_reason: how } : { state: 'open', state_reason: null })
    }
    // An issue's REST id, by number: #35 and #43 to #45 exist, nothing else does.
    const one = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(argv[2] ?? '')
    if (argv[1] === 'api' && one) {
      if (!['35', '43', '44', '45'].includes(one[1] ?? '') || state.gone.includes(Number(one[1]))) return fail('gh: Not Found (HTTP 404)')
      return ok(`90${one[1]}\n`)
    }
    if (argv[1] === 'api' && argv[2] === '-X' && argv[4]?.includes('/dependencies/blocked_by')) {
      state.links.push(`${argv[3]} ${argv[4].replace('repos/astrosteveo/claude-plugins/issues/', '')}${argv[6] ? ` ${argv[6]}` : ''}`)
      const blocker = Number((argv[6] ?? argv[4]).match(/90(\d+)$/)?.[1])
      state.blocked = argv[3] === 'POST' ? [...state.blocked, blocker] : state.blocked.filter(one => one !== blocker)
      return ok('{}')
    }
    // The repo's milestones, and anything else of the repo's over REST.
    if (argv[1] === 'api' && argv[2]?.startsWith('repos/')) return json([{ title: 'Launch' }])
    if (argv[1] === 'issue' && argv[2] === 'view' && argv[3] !== '43') return fail(`GraphQL: Could not resolve to an issue or pull request with the number of ${argv[3]}. (repository.issue)`)
    if (argv[1] === 'issue' && argv[2] === 'view') return json({ number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit', updatedAt: '2026-10-05T00:00:00Z' })
    if (state.refuseFields && graphHas(argv, stdin, 'updateProjectV2ItemFieldValue')) return fail('gh: Resource not accessible by integration')
    if (argv[1] === 'api' && argv[2] === 'graphql') return json({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'x' } } } })
    return undefined
  }
  const gh = fakeGitHub(on, { repo: 'astrosteveo/claude-plugins', prs, routes: [route] })
  on('session.id', async () => ({ value: 'session-1' }))
  letThrough(on)
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  return state
}

// The gh commands that change an issue, without the board's reads: the edits, comments, closes and project writes.
export const writes = (calls: Sent[]) =>
  calls.filter(call => ['edit', 'close', 'reopen'].includes(call.argv[1] ?? '') || (call.argv[2] === 'POST' && call.argv[3]?.endsWith('/comments')) || isGraphMutation(call))

// A write as a line: a project write by the option it sets, anything else as its command.
export const writeLine = (call: Sent): string => (isGraphMutation(call) ? `project ${graphArg(call, 'option')}` : call.argv.join(' '))
