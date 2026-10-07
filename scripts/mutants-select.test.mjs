// Given a base ref, mutants.sh runs only the patches the changes since that base can affect, and says which it skipped
// and why (#357). It can also list the patches it picked, or run one shard of them, as CI does. Each test runs a copy of the script in a small git repo of its own, with two mutants: one whose test
// is a node test, and one whose test lives in a plugin. A fake `claude` on the PATH stands in for `claude plugin test`
// and fails the plugin's test, so neither Claude Code nor the real plugins are needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs'
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

const patch = (header, file, from, to) =>
  [
    ...header,
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,2 +1,2 @@',
    `-${from}`,
    `+${to}`,
    ' // end',
    '',
  ].join('\n')

// A repo with two mutants, committed and tagged `base`: 1-add-subtracts breaks src/add.mjs and is caught by the node
// test scripts/add.test.mjs, and 2-mul-adds breaks src/mul.mjs and is caught by a test in plugins/demo.
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mutants-select-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' })
  const write = (file, text) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  git('init', '--quiet')
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  copyFileSync(script, join(dir, 'scripts', 'mutants.sh'))
  write('README.md', 'notes\n')
  write('src/add.mjs', 'export const add = (a, b) => a + b\n// end\n')
  write('src/mul.mjs', 'export const mul = (a, b) => a * b\n// end\n')
  write(
    'scripts/add.test.mjs',
    "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add } from '../src/add.mjs'\n" +
      "test('add sums', () => assert.equal(add(1, 2), 3))\n",
  )
  write('plugins/demo/tests/mul.test.ts', "test('mul multiplies', () => {})\n")
  write('plugins/demo/tests/github.ts', 'export const fake = 1\n')
  write('plugins/demo/.claude-plugin/plugin.json', '{\n  "name": "demo",\n  "version": "1.0.0",\n  "description": "A demo"\n}\n')
  write(
    'scripts/mutants/1-add-subtracts.patch',
    patch(
      ['Guards #1: add sums. The patch makes it subtract.', 'Test: scripts/add.test.mjs: add sums'],
      'src/add.mjs',
      'export const add = (a, b) => a + b',
      'export const add = (a, b) => a - b',
    ),
  )
  write(
    'scripts/mutants/2-mul-adds.patch',
    patch(
      ['Guards #2: mul multiplies. The patch makes it add.', 'Test: plugins/demo: mul multiplies'],
      'src/mul.mjs',
      'export const mul = (a, b) => a * b',
      'export const mul = (a, b) => a + b',
    ),
  )
  // The fake `claude plugin test` fails the plugin's one test, as the real one would with the bug back in.
  write('bin/claude', '#!/bin/sh\necho "(fail) mul multiplies [1.0ms]"\nexit 1\n')
  chmodSync(join(dir, 'bin', 'claude'), 0o755)
  git('add', '.')
  git('commit', '--quiet', '-m', 'start')
  git('tag', 'base')
  return { dir, git, write }
}

// Commits a change to each file named, after the base.
const change = ({ dir, git }, ...files) => {
  for (const file of files) appendFileSync(join(dir, file), '// changed\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'change')
}

const run = (dir, ...args) => {
  const result = spawnSync('sh', [join(dir, 'scripts', 'mutants.sh'), ...args], {
    cwd: dir,
    env: { ...env, PATH: `${join(dir, 'bin')}:${env.PATH}` },
    encoding: 'utf8',
  })
  return { status: result.status, out: result.stdout + result.stderr }
}

const inRepo = body => () => {
  const r = repo()
  try {
    body(r)
  } finally {
    rmSync(r.dir, { recursive: true, force: true })
  }
}

test(
  'with no base every patch runs',
  inRepo(({ dir }) => {
    const { status, out } = run(dir)
    assert.equal(status, 0, out)
    assert.match(out, /^killed {4}1-add-subtracts$/m)
    assert.match(out, /^killed {4}2-mul-adds$/m)
    assert.doesNotMatch(out, /skipped/i)
  }),
)

test(
  'a patch whose file changed runs, and the other is skipped with the reason',
  inRepo(r => {
    change(r, 'src/mul.mjs')
    const { status, out } = run(r.dir, 'base')
    assert.equal(status, 0, out)
    assert.match(out, /^skipped {3}1-add-subtracts: nothing it touches or tests changed since base$/m)
    assert.match(out, /^running {3}2-mul-adds: src\/mul\.mjs changed$/m)
    assert.match(out, /^killed {4}2-mul-adds$/m)
    assert.doesNotMatch(out, /^killed {4}1-add-subtracts$/m)
    assert.match(out, /^Skipped 1 patches that no change since base can affect\.$/m)
  }),
)

test(
  "a patch whose plugin test file changed runs, found by searching the plugin's tests for its name",
  inRepo(r => {
    change(r, 'plugins/demo/tests/mul.test.ts')
    const { status, out } = run(r.dir, 'base')
    assert.equal(status, 0, out)
    assert.match(out, /^running {3}2-mul-adds: plugins\/demo\/tests\/mul\.test\.ts changed$/m)
    assert.match(out, /^killed {4}2-mul-adds$/m)
    assert.match(out, /^skipped {3}1-add-subtracts:/m)
  }),
)

test(
  'a patch whose node test file changed runs',
  inRepo(r => {
    change(r, 'scripts/add.test.mjs')
    const { status, out } = run(r.dir, 'base')
    assert.equal(status, 0, out)
    assert.match(out, /^running {3}1-add-subtracts: scripts\/add\.test\.mjs changed$/m)
    assert.match(out, /^killed {4}1-add-subtracts$/m)
    assert.match(out, /^skipped {3}2-mul-adds:/m)
  }),
)

test(
  'an unrelated change skips every patch',
  inRepo(r => {
    change(r, 'README.md')
    const { status, out } = run(r.dir, 'base')
    assert.equal(status, 0, out)
    assert.match(out, /^skipped {3}1-add-subtracts:/m)
    assert.match(out, /^skipped {3}2-mul-adds:/m)
    assert.doesNotMatch(out, /^killed/m)
  }),
)

test(
  'a new or changed patch runs',
  inRepo(r => {
    change(r, 'scripts/mutants/1-add-subtracts.patch')
    const { out } = run(r.dir, 'base')
    assert.match(out, /^running {3}1-add-subtracts: the patch is new or changed$/m)
    assert.match(out, /^skipped {3}2-mul-adds:/m)
  }),
)

test(
  'a shared test helper change runs every patch, and says why',
  inRepo(r => {
    change(r, 'plugins/demo/tests/github.ts')
    const { status, out } = run(r.dir, 'base')
    assert.equal(status, 0, out)
    assert.match(out, /^Running every patch: these changed since base:\n {2}plugins\/demo\/tests\/github\.ts$/m)
    assert.match(out, /^killed {4}1-add-subtracts$/m)
    assert.match(out, /^killed {4}2-mul-adds$/m)
    assert.doesNotMatch(out, /skipped/i)
  }),
)

// Rewrites a file and commits it.
const rewrite = (r, file, text) => {
  r.write(file, text)
  r.git('add', '.')
  r.git('commit', '--quiet', '-m', `rewrite ${file}`)
}

const pluginJson = 'plugins/demo/.claude-plugin/plugin.json'

test(
  "a change to a plugin's plugin.json beyond its version runs every patch",
  inRepo(r => {
    rewrite(r, pluginJson, '{\n  "name": "demo",\n  "version": "1.0.1",\n  "description": "A new demo"\n}\n')
    const { out } = run(r.dir, 'base')
    assert.match(out, /^Running every patch: these changed since base:\n {2}plugins\/demo\/\.claude-plugin\/plugin\.json$/m)
    assert.doesNotMatch(out, /skipped/i)
  }),
)

test(
  "a version bump alone in a plugin's plugin.json doesn't run every patch",
  inRepo(r => {
    rewrite(r, pluginJson, '{\n  "name": "demo",\n  "version": "1.1.0",\n  "description": "A demo"\n}\n')
    const { status, out } = run(r.dir, 'base')
    assert.equal(status, 0, out)
    assert.doesNotMatch(out, /Running every patch/)
    assert.match(out, /^skipped {3}1-add-subtracts:/m)
    assert.match(out, /^skipped {3}2-mul-adds:/m)
  }),
)

// Renames the plugin's test, so the search can no longer place the name the patch gives, and moves the base past it.
const renameTest = r => {
  rewrite(r, 'plugins/demo/tests/mul.test.ts', "test('mul works', () => {})\n")
  r.git('tag', '-f', 'base')
}

test(
  "a test name it can't place makes its patch run",
  inRepo(r => {
    renameTest(r)
    const { out } = run(r.dir, 'base')
    assert.match(out, /^running {3}2-mul-adds: can't find the test "mul multiplies" in plugins\/demo$/m)
    assert.match(out, /^skipped {3}1-add-subtracts:/m)
  }),
)

// Adds a Test-file line to 2-mul-adds naming the plugin's test file, and moves the base past it.
const hint = r => {
  const file = join(r.dir, 'scripts', 'mutants', '2-mul-adds.patch')
  const text = readFileSync(file, 'utf8')
  writeFileSync(
    file,
    text.replace(
      'Test: plugins/demo: mul multiplies\n',
      'Test: plugins/demo: mul multiplies\nTest-file: plugins/demo/tests/mul.test.ts\n',
    ),
  )
  r.git('add', '.')
  r.git('commit', '--quiet', '-m', 'hint')
  r.git('tag', '-f', 'base')
}

test(
  "a Test-file line places a name the search can't, so the patch is skipped while its files are untouched",
  inRepo(r => {
    renameTest(r)
    hint(r)
    change(r, 'README.md')
    const { out } = run(r.dir, 'base')
    assert.match(out, /^skipped {3}2-mul-adds: nothing it touches or tests changed since base$/m)
  }),
)

test(
  'a patch whose Test-file changed runs',
  inRepo(r => {
    renameTest(r)
    hint(r)
    change(r, 'plugins/demo/tests/mul.test.ts')
    const { out } = run(r.dir, 'base')
    assert.match(out, /^running {3}2-mul-adds: plugins\/demo\/tests\/mul\.test\.ts changed$/m)
    assert.match(out, /^skipped {3}1-add-subtracts:/m)
  }),
)

test(
  '--list prints the patches it would run and runs none',
  inRepo(r => {
    change(r, 'src/mul.mjs')
    const { status, out } = run(r.dir, '--list', 'base')
    assert.equal(status, 0, out)
    assert.match(out, /^selected {2}2-mul-adds$/m)
    assert.doesNotMatch(out, /^selected {2}1-add-subtracts$/m)
    assert.doesNotMatch(out, /^killed/m)
  }),
)

test(
  '--shard deals the selected patches out in turn and runs only its own',
  inRepo(({ dir }) => {
    const first = run(dir, '--shard', '1/2')
    assert.equal(first.status, 0, first.out)
    assert.match(first.out, /^Shard 1 of 2 runs: 1-add-subtracts$/m)
    assert.match(first.out, /^killed {4}1-add-subtracts$/m)
    assert.doesNotMatch(first.out, /2-mul-adds/)
    const second = run(dir, '--shard', '2/2')
    assert.equal(second.status, 0, second.out)
    assert.match(second.out, /^Shard 2 of 2 runs: 2-mul-adds$/m)
    assert.match(second.out, /^killed {4}2-mul-adds$/m)
    assert.doesNotMatch(second.out, /1-add-subtracts/)
  }),
)

test(
  'a shard that does not exist is refused',
  inRepo(({ dir }) => {
    const { status, out } = run(dir, '--shard', '3/2')
    assert.equal(status, 2, out)
    assert.match(out, /no shard 3\/2/)
  }),
)

test(
  "a base it can't find runs every patch",
  inRepo(({ dir }) => {
    const { status, out } = run(dir, 'no-such-ref')
    assert.equal(status, 0, out)
    assert.match(out, /^Running every patch: can't find the base no-such-ref/m)
    assert.match(out, /^killed {4}1-add-subtracts$/m)
    assert.match(out, /^killed {4}2-mul-adds$/m)
  }),
)
