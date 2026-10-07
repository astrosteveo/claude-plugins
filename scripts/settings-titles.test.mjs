// issue-board defines each setting once, in hooks/settings.ts, apart from plugin.json, which declares them for /config.
// /issues check and /issues help name a setting by its title there, so the two must agree. The plugin test kit can't
// read plugin.json, so this reads both files as text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'issue-board')

// The key: 'title' pairs of SETTING_TITLES in settings.ts.
export const titlesIn = source => {
  const block = /export const SETTING_TITLES[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? ''
  return Object.fromEntries([...block.matchAll(/^\s*(\w+): '([^']*)',?$/gm)].map(([, key, title]) => [key, title]))
}

test("issue-board's settings have the same keys and titles in settings.ts as in plugin.json", () => {
  const declared = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).userConfig ?? {}
  const titles = titlesIn(readFileSync(join(plugin, 'hooks', 'settings.ts'), 'utf8'))
  assert.ok(Object.keys(titles).length > 0, 'SETTING_TITLES was not found in settings.ts')
  assert.deepEqual(titles, Object.fromEntries(Object.entries(declared).map(([key, field]) => [key, field.title])))
})
