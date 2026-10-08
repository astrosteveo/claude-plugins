#!/usr/bin/env sh
# Type-check every plugin that has a tsconfig.json, against the typings of the Claude Code installed here.
# Claude Code writes a plugin's typings into .claude-plugin/types/ only when an interactive session hot-reloads the
# plugin's folder. A `claude -p` run never writes them. So each plugin is loaded by a signed-out interactive session in a
# pseudo-terminal (util-linux `script`), which is stopped once the typings are written. Its config folder is new, has
# finished onboarding and trusts this folder, so no dialog stops it before the plugin loads.
set -eu
cd "$(dirname "$0")/.."

version=$(claude --version | cut -d' ' -f1)

# Loads the plugin in a session and waits up to a minute for its tsconfig.json, the last of the typings written.
write_typings() (
  config=$(mktemp -d)
  printf '{"hasCompletedOnboarding":true,"theme":"dark","projects":{"%s":{"hasTrustDialogAccepted":true}}}\n' \
    "$PWD" >"$config/.claude.json"
  # A session started from inside another one would take on the outer session's markers.
  unset $(env | sed -n 's/^\(CLAUDE[A-Z_]*\)=.*/\1/p')
  CLAUDE_CONFIG_DIR="$config" TERM=xterm-256color \
    script -qec "claude --plugin-dir '$1'" /dev/null </dev/null >/dev/null 2>&1 &
  session=$!
  waited=0
  while [ ! -f "$1/.claude-plugin/types/tsconfig.json" ] && [ "$waited" -lt 60 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  kill "$session" 2>/dev/null || true
  wait "$session" 2>/dev/null || true
  rm -rf "$config"
)

status=0
for plugin in plugins/*/; do
  plugin=${plugin%/}
  [ -f "$plugin/tsconfig.json" ] || continue
  echo "Type-checking plugin: $plugin"
  # Typings left by an earlier version must not pass for this one's.
  rm -rf "$plugin/.claude-plugin/types"
  write_typings "$plugin"
  written=$(head -n 1 "$plugin/.claude-plugin/types/claude-code/index.d.ts" 2>/dev/null || true)
  if [ "$written" != "// Written by Claude Code $version." ]; then
    echo "Claude Code $version wrote no typings for $plugin"
    status=1
    continue
  fi
  npx -y -p typescript@7 tsc -p "$plugin" || status=1
done
exit "$status"
