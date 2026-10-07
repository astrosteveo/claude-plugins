#!/usr/bin/env sh
# Proves each regression test still catches the bug it was written for. Every patch in scripts/mutants/ puts one fixed
# bug back. For each, this makes a clean worktree of HEAD, applies the patch and runs scripts/test.sh, which must fail.
# A mutant the tests let through means a regression test no longer guards its bug. A patch that no longer applies is
# stale and must be remade against the current code. Either fails the run.
set -eu
cd "$(dirname "$0")/.."

root=$(mktemp -d "${TMPDIR:-/tmp}/mutants.XXXXXX")
cleanup() {
  git worktree prune
  rm -rf "$root"
}
trap cleanup EXIT

status=0
for patch in scripts/mutants/*.patch; do
  name=$(basename "$patch" .patch)
  tree="$root/$name"
  git worktree add --quiet --detach "$tree" HEAD
  if ! git -C "$tree" apply "$PWD/$patch" 2>/dev/null; then
    echo "STALE     $name: the patch no longer applies; remake it against the current code"
    status=1
  elif (cd "$tree" && sh scripts/test.sh >/dev/null 2>&1); then
    echo "SURVIVED  $name: the tests passed with the bug back in"
    status=1
  else
    echo "killed    $name"
  fi
  git worktree remove --force "$tree"
done
exit "$status"
