#!/usr/bin/env sh
# Type-check every plugin that has a tsconfig.json, against the typings of the Claude Code installed here.
# Claude Code writes a plugin's typings into .claude-plugin/types/ when it loads the plugin from a folder. A headless run
# with an empty config folder is signed out: it loads the plugin, writes the typings, and stops before sending a prompt.
set -eu
cd "$(dirname "$0")/.."

status=0
for plugin in plugins/*/; do
  plugin=${plugin%/}
  [ -f "$plugin/tsconfig.json" ] || continue
  echo "Type-checking plugin: $plugin"
  config=$(mktemp -d)
  CLAUDE_CONFIG_DIR="$config" claude --plugin-dir "$plugin" -p "load" >/dev/null 2>&1 || true
  rm -rf "$config"
  if [ ! -f "$plugin/.claude-plugin/types/tsconfig.json" ]; then
    echo "Claude Code wrote no typings for $plugin"
    status=1
    continue
  fi
  npx -y -p typescript@7 tsc -p "$plugin" || status=1
done
exit "$status"
