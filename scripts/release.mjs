#!/usr/bin/env node
// Releases a plugin: validates the marketplace and the plugin, sets the version in its plugin.json and commits it.
//   node scripts/release.mjs <plugin> patch|minor|major|<x.y.z>
// Pull requests leave versions alone; this is the only step that changes them. See RELEASING.md.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const fail = message => {
  console.error(message)
  process.exit(1)
}
const run = (command, args) => execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim()

const [name, level] = process.argv.slice(2)
if (!name || !level) fail('Usage: node scripts/release.mjs <plugin> patch|minor|major|<x.y.z>')
const manifest = `plugins/${name}/.claude-plugin/plugin.json`
if (!existsSync(join(ROOT, manifest))) fail(`No plugin named ${name}: ${manifest} does not exist`)
if (run('git', ['status', '--porcelain', '--', manifest])) fail(`${manifest} has uncommitted changes. Commit or stash them first.`)

// --strict fails on warnings too, among them a marketplace entry whose version disagrees with plugin.json.
for (const target of ['.', `plugins/${name}`]) {
  try {
    run('claude', ['plugin', 'validate', '--strict', target])
  } catch (err) {
    fail(`claude plugin validate --strict ${target} failed:\n${err.stdout ?? ''}${err.stderr ?? err.message}`)
  }
}

const text = readFileSync(join(ROOT, manifest), 'utf8')
const json = JSON.parse(text)
const parse = value => (/^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '') ?? []).slice(1).map(Number)
const now = parse(json.version)
if (now.length !== 3) fail(`${manifest} has no version like 1.2.3`)
const next = {
  major: [now[0] + 1, 0, 0],
  minor: [now[0], now[1] + 1, 0],
  patch: [now[0], now[1], now[2] + 1],
}[level] ?? parse(level)
if (next.length !== 3) fail(`${level} is not patch, minor, major or a version like 1.2.3`)
const first = next.findIndex((part, i) => part !== now[i])
if (first < 0 || next[first] < now[first]) fail(`${next.join('.')} is not after ${json.version}`)
const version = next.join('.')

// The version is changed in the text so the rest of the file keeps its formatting. Parsing the result
// and comparing it with the intended change catches a replacement that hit some other field.
const changed = text.replace(/"version"(\s*):(\s*)"[^"]*"/, (_, a, b) => `"version"${a}:${b}"${version}"`)
if (!isDeepStrictEqual(JSON.parse(changed), { ...json, version })) fail(`Could not set the version in ${manifest}; nothing was changed.`)
writeFileSync(join(ROOT, manifest), changed)
run('git', ['commit', '-m', `Release ${name} ${version}`, '--', manifest])
console.log(`Committed ${name} ${version} (was ${json.version}). Merge it to main the way any change goes in.`)
