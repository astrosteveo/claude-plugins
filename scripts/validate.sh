#!/usr/bin/env sh
# Validate the marketplace manifest and every plugin, treating warnings as errors.
set -eu
cd "$(dirname "$0")/.."

status=0
echo "Validating marketplace: ."
claude plugin validate --strict . || status=1
for plugin in plugins/*/; do
  plugin=${plugin%/}
  echo "Validating plugin: $plugin"
  claude plugin validate --strict "$plugin" || status=1
done
exit "$status"
