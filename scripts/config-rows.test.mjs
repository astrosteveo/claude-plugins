// Every plugin's userConfig field must be one Claude Code can show as a /config row. A field it can't show gets no row,
// so `$.config.set` refuses its key, `claude plugin configure` lists it as not set, and a value for it may never reach
// the plugin's options. The kinds a row takes are ConfigKind in the typings: boolean, choice, text and number.
// The plugin test kit's fake engine accepts any key, so this check reads each plugin.json itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugins = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins')

// The /config row kind a field gets, or why it gets none.
export const rowKindOf = field => {
  if (field === null || typeof field !== 'object') return { none: 'it is not an object' }
  if (field.multiple !== undefined && field.multiple !== false) return { none: 'it is a list (multiple), and no row takes a list' }
  if (field.type === 'boolean') return field.options === undefined ? { kind: 'boolean' } : { none: 'a boolean field has no options' }
  if (field.type === 'number') return field.options === undefined ? { kind: 'number' } : { none: 'a number field has no options' }
  if (field.type === 'string') {
    if (field.options === undefined) return { kind: 'text' }
    const fine = Array.isArray(field.options) && field.options.length > 0 && field.options.every(one => typeof one === 'string')
    return fine ? { kind: 'choice' } : { none: 'its options are not a list of strings' }
  }
  return { none: `its type ${JSON.stringify(field.type)} is none of boolean, string and number` }
}

test('the field kinds map to /config rows as Claude Code draws them', () => {
  assert.deepEqual(rowKindOf({ type: 'boolean' }), { kind: 'boolean' })
  assert.deepEqual(rowKindOf({ type: 'number' }), { kind: 'number' })
  assert.deepEqual(rowKindOf({ type: 'string' }), { kind: 'text' })
  assert.deepEqual(rowKindOf({ type: 'string', options: ['a', 'b'] }), { kind: 'choice' })
  assert.ok(rowKindOf({ type: 'string', multiple: true }).none)
  assert.ok(rowKindOf({ type: 'directory' }).none)
  assert.ok(rowKindOf({ type: 'number', options: ['1'] }).none)
})

for (const name of existsSync(plugins) ? readdirSync(plugins) : []) {
  const manifest = join(plugins, name, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) continue
  test(`every userConfig field of ${name} can be a /config row`, () => {
    const fields = JSON.parse(readFileSync(manifest, 'utf8')).userConfig ?? {}
    const bad = Object.entries(fields).flatMap(([key, field]) => {
      const row = rowKindOf(field)
      return row.none ? [`${name}.${key}: ${row.none}`] : []
    })
    assert.deepEqual(bad, [])
  })
}
