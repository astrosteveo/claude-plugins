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
done
exit "$status"
