import type { Flagged } from '../types'

// What the board checks in a pull request's files before it hands the pull request to Claude to merge. A worker can
// change more than its issue asked for, and CI passing says nothing about that, so these are shown to the person first.

// One file a pull request changes, as GitHub's REST answer for the pull request's files gives it. `status` is
// `added`, `removed`, `modified`, `renamed`, `copied`, `changed` or `unchanged`. `patch` is its diff, when the board
// asked for it and GitHub sent one; GitHub leaves it out of a large diff.
export type ChangedFile = { path: string; status: string; patch?: string | null }


// The most files one REST page holds. A pull request with this many may have more the board didn't see.
export const FILES_PAGE = 100

// The files the board asks for the diff of, as a jq regex: only these decide anything, so the others' diffs aren't
// read. `[.]` stands for a dot, since a backslash would need escaping twice over inside jq's string.
export const PATCHED = '(^|/)[.]claude-plugin/(plugin|marketplace)[.]json$'

const WORKFLOW = /^\.github\/workflows\//
const SETTINGS = /(^|\/)\.claude\/settings[^/]*\.json$/
const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'composer.lock',
  'go.sum',
  'flake.lock',
  'mix.lock',
  'pubspec.lock',
  'Package.resolved',
])
// Files that look like they hold a secret: an env file that isn't a template, keys and certificates.
const SECRET = [/^\.env(\..+)?$/, /\.(pem|key|p12|pfx|keystore|jks)$/i, /^id_(rsa|dsa|ecdsa|ed25519)$/]
const TEMPLATE = /\.(example|sample|template|dist)$/i

const PLUGIN = /^plugins\/([^/]+)\//
const MARKETPLACE = '.claude-plugin/marketplace.json'
const VERSION_ADDED = /^\+\s*"version"\s*:/

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

// A few paths, and how many more, so a long list doesn't fill the ask.
const listOf = (paths: string[]): string => (paths.length <= 3 ? paths.join(', ') : `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more`)

// Whether a diff adds a `"version"` line. A file whose diff GitHub left out is taken as bumped: the board can't tell.
const bumps = (file: ChangedFile | undefined): boolean => file !== undefined && (file.patch == null || file.patch.split('\n').some(line => VERSION_ADDED.test(line)))

// The plugins whose entry in marketplace.json gets a new version line. Each hunk is read top down: an entry's
// `"name"` and `"source"` come before its `"version"`, so the last one seen names the plugin. A version line with no
// plugin named above it in its hunk counts for every plugin, since the board can't tell which; `'*'` in the set stands
// for that. An unchanged file bumps none.
const marketplaceBumps = (file: ChangedFile | undefined): Set<string> => {
  const bumped = new Set<string>()
  if (!file) return bumped
  if (file.patch == null) return new Set(['*'])
  let current: string | null = null
  for (const line of file.patch.split('\n')) {
    if (line.startsWith('@@')) {
      current = null
      continue
    }
    const source = /"source"\s*:\s*"\.\/plugins\/([^"]+)"/.exec(line)
    const name = /"name"\s*:\s*"([^"]+)"/.exec(line)
    if (source) current = source[1] ?? null
    else if (name && !line.startsWith('-')) current = name[1] ?? null
    if (VERSION_ADDED.test(line)) bumped.add(current ?? '*')
  }
  return bumped
}

// What a pull request's files flag, one line for each kind, for the person to read before it merges:
// - CI workflows, Claude Code settings files and lockfiles it changes;
// - files it deletes;
// - files that look like secrets: `.env`, `*.pem`, keys;
// - in a plugin marketplace laid out as this repo is (`marketplace`), a plugin under `plugins/<name>/` changed without
//   a new version in both its `plugin.json` and its entry in `.claude-plugin/marketplace.json`;
// - and, with a full page of files, that there may be more the board didn't see.
export const fileFlags = (files: ChangedFile[], { marketplace }: { marketplace: boolean }): string[] => {
  const live = files.filter(file => file.status !== 'removed')
  const kinds: [string, string[]][] = [
    ['changes CI workflows', files.filter(file => WORKFLOW.test(file.path)).map(file => file.path)],
    ['changes Claude Code settings', files.filter(file => SETTINGS.test(file.path)).map(file => file.path)],
    ['changes lockfiles', files.filter(file => LOCKFILES.has(baseOf(file.path))).map(file => file.path)],
    ['deletes', files.filter(file => file.status === 'removed').map(file => file.path)],
    [
      'adds or changes what may be secrets',
      live.filter(file => !TEMPLATE.test(baseOf(file.path)) && SECRET.some(pattern => pattern.test(baseOf(file.path)))).map(file => file.path),
    ],
  ]
  const found = kinds.filter(([, paths]) => paths.length > 0).map(([what, paths]) => `${what}: ${listOf(paths)}`)
  if (marketplace) {
    const byPath = new Map(files.map(file => [file.path, file]))
    const plugins = [...new Set(files.map(file => PLUGIN.exec(file.path)?.[1]).filter((name): name is string => Boolean(name)))].sort()
    const listed = marketplaceBumps(byPath.get(MARKETPLACE))
    for (const plugin of plugins) {
      const missing = [
        ...(bumps(byPath.get(`plugins/${plugin}/.claude-plugin/plugin.json`)) ? [] : ['plugin.json']),
        ...(listed.has(plugin) || listed.has('*') ? [] : ['marketplace.json']),
      ]
      if (missing.length > 0) found.push(`changes ${plugin} without a version bump in ${missing.join(' and ')}`)
    }
  }
  if (files.length >= FILES_PAGE) found.push(`changes ${FILES_PAGE} or more files, and only the first ${FILES_PAGE} were checked`)
  return found
}

// What the board flagged in one pull request, as a sentence for an ask or a prompt.
export const flagsText = (found: string[]): string => (found.length === 0 ? '' : `It ${found.join('; it ')}.`)

// Merge all's ask: the flagged pull requests, each with what it flagged, oldest first.
export const flaggedLines = (flagged: Flagged[]): string[] =>
  [...flagged]
    .filter(one => one.found.length > 0)
    .sort((a, b) => a.number - b.number)
    .map(one => `#${one.number} ${one.found.join('; ')}`)
