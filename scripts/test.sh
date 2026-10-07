#!/usr/bin/env sh
# Run the tests of every plugin that has any. Fails when any test fails.
set -eu
cd "$(dirname "$0")/.."

status=0
# Every userConfig field must be one /config can show as a row; the plugin test kit can't read plugin.json to check.
echo "Checking userConfig fields"
node --test scripts/config-rows.test.mjs || status=1
# issue-board's setting titles in settings.ts must match plugin.json, which the test kit can't read either.
node --test scripts/settings-titles.test.mjs || status=1
for plugin in plugins/*/; do
  plugin=${plugin%/}
  [ -n "$(find "$plugin" -path "$plugin/node_modules" -prune -o \( -name '*.test.ts' -o -name '*.test.tsx' \) -print -quit)" ] || continue
  echo "Testing plugin: $plugin"
  claude plugin test "$plugin" || status=1
done
exit "$status"
