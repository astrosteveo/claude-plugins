// mutants.sh tests the last commit, not the working tree. Run with uncommitted changes to a file a patch touches, it
// must say so, or a verdict on the old code reads as one on the changes (#328). Each test runs a copy of the script in
// a small git repo of its own, with one mutant whose test is a node test, so it needs neither Claude Code nor the
// plugins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const script = join(dirname(fileURLToPath(import.meta.url)), 'mutants.sh')

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}
// Under `node --test` this is set, and a node test run inside the script would then report to this run instead of
// printing the results the script reads.
delete env.NODE_TEST_CONTEXT

// A repo with src/add.mjs, a test of it, and a mutant that breaks it, all committed.
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mutants-test-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' })
  git('init', '--quiet')
  mkdirSync(join(dir, 'scripts', 'mutants'), { recursive: true })
  mkdirSync(join(dir, 'src'))
  copyFileSync(script, join(dir, 'scripts', 'mutants.sh'))
  writeFileSync(join(dir, 'src', 'add.mjs'), 'export const add = (a, b) => a + b\n')
  writeFileSync(
    join(dir, 'scripts', 'add.test.mjs'),
    "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add } from '../src/add.mjs'\n" +
      "test('add sums', () => assert.equal(add(1, 2), 3))\n",
  )
  writeFileSync(
    join(dir, 'scripts', 'mutants', '1-add-subtracts.patch'),
    [
      'Guards #1: add sums. The patch makes it subtract.',
      'Test: scripts/add.test.mjs: add sums',
      'diff --git a/src/add.mjs b/src/add.mjs',
      '--- a/src/add.mjs',
      '+++ b/src/add.mjs',
      '@@ -1 +1 @@',
      '-export const add = (a, b) => a + b',
      '+export const add = (a, b) => a - b',
      '',
    ].join('\n'),
  )
  git('add', '.')
  git('commit', '--quiet', '-m', 'start')
  return dir
}

const run = dir => {
  const result = spawnSync('sh', [join(dir, 'scripts', 'mutants.sh')], { cwd: dir, env, encoding: 'utf8' })
  return { status: result.status, out: result.stdout + result.stderr }
}

test('a clean tree gets a verdict and no warning', () => {
  const dir = repo()
  try {
    const { status, out } = run(dir)
    assert.equal(status, 0, out)
    assert.match(out, /^killed {4}1-add-subtracts$/m)
    assert.doesNotMatch(out, /WARNING|uncommitted/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uncommitted changes to a file a patch touches get a warning, before the run and beside the verdict', () => {
  const dir = repo()
  try {
    // The patch is stale against this change, but the script tests the commit, where it still applies and is killed.
    writeFileSync(join(dir, 'src', 'add.mjs'), 'export const add = (x, y) => x + y\n')
    const { status, out } = run(dir)
    assert.equal(status, 0, out)
    assert.match(out, /^WARNING: this tests the last commit, not your uncommitted changes/m)
    assert.match(out, /^ +src\/add\.mjs$/m)
    assert.match(out, /^killed {4}1-add-subtracts\n +\(tested the last commit; uncommitted changes to src\/add\.mjs\)$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uncommitted changes to files no patch touches get no warning', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'README.md'), 'notes\n')
    const { status, out } = run(dir)
    assert.equal(status, 0, out)
    assert.doesNotMatch(out, /WARNING|uncommitted/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
