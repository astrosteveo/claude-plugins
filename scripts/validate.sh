#!/usr/bin/env sh
# Validate the marketplace manifest and every plugin, treating warnings as errors.
# An empty marketplace is allowed: its only warning is that it has no plugins.
set -eu
cd "$(dirname "$0")/.."

strict=
for plugin in plugins/*/; do
  if [ -d "$plugin" ]; then strict=--strict; fi
done

status=0
echo "Validating marketplace: ."
claude plugin validate $strict . || status=1
for plugin in plugins/*/; do
  [ -d "$plugin" ] || continue
  plugin=${plugin%/}
  echo "Validating plugin: $plugin"
  claude plugin validate --strict "$plugin" || status=1
  # A hook at a gating site that fails is skipped without a word unless its .catch answers, so each needs one.
  missing=$(claude plugin validate --json "$plugin" | node -e '
    let text = ""
    process.stdin.on("data", chunk => (text += chunk)).on("end", () => {
      const report = JSON.parse(text)
      const hooks = [report.manifest, ...(report.contents ?? [])].flatMap(part => part?.gatingHooks ?? [])
      for (const hook of hooks) if (!hook.hasCatch) console.log(`${hook.module}: ${hook.hook}`)
    })
  ') || status=1
  if [ -n "$missing" ]; then
    echo "Gating hooks without a .catch in $plugin:"
    echo "$missing" | sed 's/^/  /'
    status=1
  fi
done
exit "$status"
