#!/usr/bin/env sh
# Real-git test for memsync. `claude plugin test` runs in a sandbox with no
# processes or files, so this drives the mod through headless Claude Code
# sessions instead: a bare remote and two fake machines, all under /tmp.
# Each machine has its own CLAUDE_CONFIG_DIR, so nothing touches ~/.claude
# or your real memory repo. No model calls: every run is a /memsync command.
#
#   sh plugins/memsync/tests/real-git.sh        KEEP=1 keeps the temp folder
set -eu

PLUGIN=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d /tmp/memsync-real-git.XXXXXX)
case "$T" in
  /tmp/memsync-real-git.*) ;;
  *) echo "refusing to run outside /tmp: $T" >&2; exit 1 ;;
esac
[ "${KEEP:-}" = 1 ] || trap 'rm -rf "$T"' EXIT

# Git identity and defaults for every git the test and the mod start
export GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --file "$T/gitconfig" user.name memsync-test
git config --file "$T/gitconfig" user.email memsync-test@example.com
git config --file "$T/gitconfig" init.defaultBranch main
git config --file "$T/gitconfig" protocol.file.allow always

FAILED=0
ok() { echo "ok - $1"; }
no() { echo "not ok - $1"; FAILED=1; }
check() {
  desc=$1
  shift
  if "$@"; then ok "$desc"; else no "$desc"; fi
}
has() { grep -q -- "$2" "$1" 2>/dev/null; }

# claude on <machine> <dir> <prompt>: one headless session, plugin loaded
claude_on() {
  (cd "$2" && CLAUDE_CONFIG_DIR="$T/$1/cfg" timeout 120 claude -p --plugin-dir "$PLUGIN" "$3" < /dev/null 2>&1)
}
# The same, without the plugin: Claude Code makes the project's folders
bare_on() {
  (cd "$2" && CLAUDE_CONFIG_DIR="$T/$1/cfg" timeout 120 claude -p "/cost" < /dev/null > /dev/null 2>&1)
}
# The engine's folder for a project: the one whose transcript names its cwd
engine_dir() {
  grep -l "\"cwd\":\"$2\"" "$T/$1"/cfg/projects/*/*.jsonl | head -1 | xargs dirname
}

machine() {
  mkdir -p "$T/$1/cfg" "$T/$1/Projects"
  git clone -q "$T/remote.git" "$T/$1/repo"
  cat > "$T/$1/cfg/settings.json" <<EOF
{ "pluginConfigs": { "memsync": { "options": { "repoPath": "$T/$1/repo", "projectsRoot": "$T/$1/Projects" } } } }
EOF
}

project() {
  mkdir -p "$1"
  git -C "$1" init -q
  git -C "$1" remote add origin "https://example.com/me/$2.git"
}

# The remote starts with a shared CLAUDE.md and one skill
git init -q --bare "$T/remote.git"
git clone -q "$T/remote.git" "$T/seed"
mkdir -p "$T/seed/claude" "$T/seed/skills/demo"
echo '# Shared instructions' > "$T/seed/claude/CLAUDE.md"
printf -- '---\nname: demo\ndescription: A demo skill.\n---\n' > "$T/seed/skills/demo/SKILL.md"
git -C "$T/seed" add -A
git -C "$T/seed" commit -q -m seed
git -C "$T/seed" push -q -u origin main

machine a
machine b

echo "# 1. Machine A links a project that already has memory"
APP_A="$T/a/Projects/app"
project "$APP_A" app
bare_on a "$APP_A"
MEM_A="$(engine_dir a "$APP_A")/memory"
printf -- '- [Note](note.md) — from A\n' > "$MEM_A/MEMORY.md"
echo 'Fact from machine A.' > "$MEM_A/note.md"
out=$(claude_on a "$APP_A" "/memsync status")
echo "$out" | sed 's/^/    /'
check "memory folder is now a link into the repo" test -L "$MEM_A"
check "existing memory moved into projects/app" has "$T/a/repo/projects/app/note.md" 'Fact from machine A.'
check "old folder kept in backups" sh -c "ls -d '$T'/a/cfg/backups/memory/*-* > /dev/null"
check "CLAUDE.md linked" test -L "$T/a/cfg/CLAUDE.md"
check "skill linked" test -L "$T/a/cfg/skills/demo"
check "start-up sync pushed the memory" sh -c "git -C '$T/remote.git' show main:projects/app/note.md | grep -q 'machine A'"

echo "# 2. Machine B gets it"
APP_B="$T/b/Projects/app"
project "$APP_B" app
bare_on b "$APP_B"
MEM_B="$(engine_dir b "$APP_B")/memory"
echo 'Fact from machine B.' > "$MEM_B/note.md"
out=$(claude_on b "$APP_B" "/memsync status")
echo "$out" | sed 's/^/    /'
check "B pulled A's note" has "$T/b/repo/projects/app/note.md" 'machine A'
check "B's different note kept as a conflict copy" sh -c "ls '$T'/b/repo/projects/app/note.*.md > /dev/null"
check "status reports the conflict copy" sh -c "echo \"\$0\" | grep -q 'Conflict copies: projects/app/note\.'" "$out"

echo "# 3. A secret blocks the sync, a risk- name passes"
echo "token ghp_$(printf 'a%.0s' $(seq 36))" > "$MEM_A/leak.md"
out=$(claude_on a "$APP_A" "/memsync sync")
echo "$out" | sed 's/^/    /'
check "sync refused" sh -c "echo \"\$0\" | grep -q 'possible secret in projects/app/leak.md'" "$out"
check "secret never reached the remote" sh -c "! git -C '$T/remote.git' cat-file -e main:projects/app/leak.md 2>/dev/null"
rm "$MEM_A/leak.md"
echo 'Plan the risk-assessment-for-new-users review.' > "$MEM_A/risk-assessment-for-new-users.md"
out=$(claude_on a "$APP_A" "/memsync sync")
echo "$out" | sed 's/^/    /'
check "risk- file synced" sh -c "git -C '$T/remote.git' cat-file -e main:projects/app/risk-assessment-for-new-users.md"

echo "# 4. A submodule project links under its own name"
mkdir -p "$T/lib"
git -C "$T/lib" init -q
git -C "$T/lib" commit -q --allow-empty -m init
OUTER="$T/a/Projects/outer"
project "$OUTER" outer
git -C "$OUTER" submodule add -q "$T/lib" inner
git -C "$OUTER/inner" remote set-url origin https://example.com/me/inner.git
bare_on a "$OUTER/inner"
out=$(claude_on a "$OUTER/inner" "/memsync link")
echo "$out" | sed 's/^/    /'
check "submodule memory linked to projects/inner" sh -c "test -L '$(engine_dir a "$OUTER/inner")/memory'"
check "link names projects/inner" sh -c "echo \"\$0\" | grep -q 'projects/inner'" "$out"

echo "# 5. A rebase left stuck is aborted at start"
git -C "$T/seed" pull -q
echo 'Seed edit.' > "$T/seed/claude/CLAUDE.md"
git -C "$T/seed" commit -q -am 'edit on the remote'
git -C "$T/seed" push -q
echo 'A edit.' > "$T/a/repo/claude/CLAUDE.md"
git -C "$T/a/repo" commit -q -am 'edit on A'
git -C "$T/a/repo" fetch -q
git -C "$T/a/repo" rebase -q origin/main > /dev/null 2>&1 || true
check "test set up a stuck rebase" test -d "$T/a/repo/.git/rebase-merge"
out=$(claude_on a "$APP_A" "/memsync status")
echo "$out" | sed 's/^/    /'
check "rebase aborted" test ! -d "$T/a/repo/.git/rebase-merge"
check "the conflicting sync is reported, not forced" sh -c "echo \"\$0\" | grep -q 'rebase onto origin/main failed'" "$out"

echo "# 6. Off means no git"
claude_on a "$APP_A" "/memsync off" > /dev/null
before=$(git -C "$T/a/repo" rev-parse HEAD)
echo 'Written while off.' > "$MEM_A/off.md"
out=$(claude_on a "$APP_A" "/memsync sync")
check "sync refused while off" sh -c "echo \"\$0\" | grep -q 'Memsync is off'" "$out"
check "nothing committed while off" test "$before" = "$(git -C "$T/a/repo" rev-parse HEAD)"

if [ "$FAILED" = 0 ]; then echo "all real-git checks passed"; else echo "some real-git checks failed (KEEP=1 keeps $T)"; fi
exit "$FAILED"
