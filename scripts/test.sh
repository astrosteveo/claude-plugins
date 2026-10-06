#!/usr/bin/env sh
# Run the tests of every plugin that has any. Fails when any test fails.
set -eu
cd "$(dirname "$0")/.."

status=0
for plugin in plugins/*/; do
  plugin=${plugin%/}
  [ -n "$(find "$plugin" -path "$plugin/node_modules" -prune -o \( -name '*.test.ts' -o -name '*.test.tsx' \) -print -quit)" ] || continue
  echo "Testing plugin: $plugin"
  claude plugin test "$plugin" || status=1
done
exit "$status"
