import type { Problem } from '../types'

// The account gh uses, as `gh auth status --active --json hosts` reports it. `scopes` is null for a token that lists
// none (fine-grained and app tokens), so what it can do is only known when GitHub refuses something.
export type Auth =
  | { state: 'signed-out' }
  | { state: 'refused'; source: string }
  | { state: 'signed-in'; login: string; source: string; scopes: string[] | null }

// The repository as `gh repo view --json nameWithOwner,hasIssuesEnabled,viewerPermission,isArchived,visibility` has it.
export type RepoAccess = { name: string; hasIssues: boolean; permission: string | null; isArchived: boolean; isPrivate: boolean }

type RawAccount = { state?: string; active?: boolean; host?: string; login?: string; tokenSource?: string; scopes?: string; error?: string }
type RawRepo = { nameWithOwner?: unknown; hasIssuesEnabled?: unknown; viewerPermission?: unknown; isArchived?: unknown; visibility?: unknown }

export const TOKENS_URL = 'https://github.com/settings/tokens'
const FINE_GRAINED_URL = 'https://github.com/settings/personal-access-tokens'
const WRITERS = ['ADMIN', 'MAINTAIN', 'WRITE']

// The active account, preferring github.com; null when the answer isn't what that command writes, as from a gh too old
// for `--json`, or when it couldn't reach GitHub (offline reads as an error too, so only a 401 means a bad token).
export const authOf = (json: string): Auth | null => {
  try {
    const raw = JSON.parse(json) as { hosts?: unknown }
    if (typeof raw?.hosts !== 'object' || raw.hosts === null || Array.isArray(raw.hosts)) return null
    const accounts = Object.entries(raw.hosts as Record<string, unknown>).flatMap(([host, list]) =>
      Array.isArray(list) ? (list as RawAccount[]).map(one => ({ ...one, host: one.host ?? host })) : [],
    )
    const account = accounts.find(one => one.active && one.host === 'github.com') ?? accounts.find(one => one.active)
    if (!account) return { state: 'signed-out' }
    const source = account.tokenSource ?? ''
    if (account.state !== 'success') return /\b401\b|Bad credentials/i.test(account.error ?? '') ? { state: 'refused', source } : null
    const scopes = (account.scopes ?? '').split(',').map(one => one.trim()).filter(Boolean)
    return { state: 'signed-in', login: account.login ?? '', source, scopes: scopes.length > 0 ? scopes : null }
  } catch {
    return null
  }
}

export const repoOf = (json: string): RepoAccess | null => {
  try {
    const raw = JSON.parse(json) as RawRepo
    if (typeof raw?.nameWithOwner !== 'string') return null
    return {
      name: raw.nameWithOwner,
      hasIssues: raw.hasIssuesEnabled !== false,
      permission: typeof raw.viewerPermission === 'string' && raw.viewerPermission !== '' ? raw.viewerPermission : null,
      isArchived: raw.isArchived === true,
      isPrivate: typeof raw.visibility === 'string' && raw.visibility !== 'PUBLIC',
    }
  } catch {
    return null
  }
}

// The scopes a gh error says the token lacks: gh's own check names them in brackets, GitHub's GraphQL API quotes the
// ones it would take, of which one is enough.
export const deniedOf = (message: string): string[] => {
  const named = /missing required scopes? \[([^\]]*)\]/i.exec(message)
  if (named) return (named[1] ?? '').split(/[\s,]+/).filter(Boolean)
  const quoted = /requires one of the following scopes: \[([^\]]*)\]/i.exec(message)
  const first = quoted && /'([^']+)'/.exec(quoted[1] ?? '')
  return first?.[1] ? [first[1]] : []
}

// A token from a variable such as GH_TOKEN, which `gh auth` can neither refresh nor replace.
const fromVariable = (source: string): boolean => /^[A-Z][A-Z0-9_]*$/.test(source)

const LOGIN = 'Run `gh auth login` in a terminal, or type `! gh auth login` in the prompt.'

const scopeProblem = (scopes: string[], source: string, detail: string, blocks: boolean): Problem => {
  const list = scopes.join(' and ')
  const title = `gh's token is missing the ${list} ${scopes.length === 1 ? 'permission' : 'permissions'}`
  const id = `scope-${scopes.join('-')}`
  if (fromVariable(source)) {
    return { id, title, detail, fix: `Add ${list} to the token in ${source} at ${TOKENS_URL}. gh can't change a token that comes from ${source}.`, url: TOKENS_URL, blocks }
  }
  const command = `gh auth refresh -s ${scopes.join(',')}`
  return { id, title, detail, fix: `Run \`${command}\` in a terminal, or type it after \`!\` in the prompt, and approve it in the browser.`, command, blocks }
}

const PROJECT_SCOPES = ['project', 'read:project']
const PROJECT_DETAIL = "The board reads and changes Status and Priority in the repo's GitHub Project with it. Until then it groups and filters by labels."

export type Found = {
  // Whether gh could be started at all.
  installed: boolean
  auth: Auth | null
  repo: RepoAccess | null
  // The error the board last got from gh, if a check follows one.
  message?: string
}

// What is missing for the board to work, most pressing first.
export const problemsOf = ({ installed, auth, repo, message = '' }: Found): Problem[] => {
  if (!installed) {
    return [{ id: 'gh-missing', title: "GitHub's gh tool isn't installed", detail: 'The board reads GitHub through gh.', fix: 'Install it from cli.github.com, then run `gh auth login`.', url: 'https://cli.github.com', blocks: true }]
  }
  if (auth?.state === 'signed-out') {
    return [{ id: 'signed-out', title: "gh isn't signed in to GitHub", detail: "The board can't read issues or pull requests.", fix: LOGIN, command: 'gh auth login', blocks: true }]
  }
  if (auth?.state === 'refused') {
    const detail = 'GitHub turned it down. It may have expired or been revoked.'
    return [
      fromVariable(auth.source)
        ? { id: 'token-refused', title: `The token in ${auth.source} doesn't work`, detail, fix: `Make a new one at ${TOKENS_URL} and put it in ${auth.source}, or unset ${auth.source} and run \`gh auth login\`.`, url: TOKENS_URL, blocks: true }
        : { id: 'token-refused', title: "gh's sign-in no longer works", detail, fix: LOGIN, command: 'gh auth login', blocks: true },
    ]
  }

  const problems: Problem[] = []
  const source = auth?.state === 'signed-in' ? auth.source : ''
  const scopes = auth?.state === 'signed-in' ? auth.scopes : null
  if (scopes && !scopes.includes('repo') && (repo?.isPrivate !== false || !scopes.includes('public_repo'))) {
    problems.push(scopeProblem(['repo'], source, 'The board needs it to read and change issues and pull requests.', true))
  }
  // Projects: without them the board still works, from labels, so the problem only limits it. `project` both reads
  // and changes them, so its fix asks for that even when only reading was refused.
  const deniedAll = deniedOf(message)
  const projectDenied = deniedAll.some(scope => PROJECT_SCOPES.includes(scope))
  if ((scopes && !scopes.some(scope => PROJECT_SCOPES.includes(scope))) || projectDenied || (scopes?.includes('read:project') && /project/i.test(message) && /scope|permission|not accessible/i.test(message))) {
    problems.push(scopeProblem(['project'], source, PROJECT_DETAIL, false))
  }
  const denied = deniedAll.filter(scope => !PROJECT_SCOPES.includes(scope) && !problems.some(problem => problem.id === `scope-${scope}`))
  if (denied.length > 0) problems.push(scopeProblem(denied, source, 'GitHub refused a request the board makes without it.', true))
  if (/Resource not accessible by (personal access token|integration)/i.test(message)) {
    problems.push({
      id: 'token-limited',
      title: "gh's token can't reach everything the board needs",
      detail: 'GitHub refused a request the board makes.',
      fix: `Give the token read and write access to Issues and Pull requests${repo ? ` for ${repo.name}` : ''} at ${FINE_GRAINED_URL}.`,
      url: FINE_GRAINED_URL,
      blocks: true,
    })
  }

  if (repo?.isArchived) {
    problems.push({ id: 'archived', title: `${repo.name} is archived`, detail: 'Nothing on it can change, so ticking boxes and merging fail.', fix: "An owner can unarchive it in the repository's settings.", url: `https://github.com/${repo.name}/settings`, blocks: false })
  } else if (repo?.permission && !WRITERS.includes(repo.permission)) {
    problems.push({ id: 'read-only', title: `You have ${repo.permission.toLowerCase()} access to ${repo.name}`, detail: 'Ticking boxes and merging pull requests need write access.', fix: `Ask an owner of ${repo.name} for write access.`, blocks: false })
  }
  if (repo && !repo.hasIssues) {
    const owner = repo.permission === 'ADMIN'
    const command = `gh repo edit ${repo.name} --enable-issues`
    problems.push({
      id: 'issues-off',
      title: `Issues are turned off for ${repo.name}`,
      detail: 'The board shows only pull requests.',
      fix: owner ? `Run \`${command}\` to turn them on.` : `Ask an owner of ${repo.name} to turn them on.`,
      ...(owner ? { command } : {}),
      blocks: false,
    })
  }
  return problems
}

// The problems in a few sentences, for Claude and for `/issues check`.
export const problemsText = (problems: Problem[]): string => problems.map(problem => `${problem.title}. ${problem.detail} ${problem.fix}`).join('\n')
