#!/usr/bin/env sh
# Proves each regression test still catches the bug it was written for. Every patch in scripts/mutants/ puts one fixed
# bug back, and names in its header the test (or tests) that must catch it:
#
#   Guards #214: what the fix guarantees. What the patch breaks.
#   Test: plugins/issue-board: the name of the test, as `claude plugin test` prints it
#   Test: scripts/config-rows.test.mjs: the name of the test, as `node --test` prints it
#
# Before the colon is where the test lives: a plugin folder, run with `claude plugin test`, or a test file, run with
# `node --test`. For each patch, this makes a clean worktree of HEAD, applies the patch, runs each named place once,
# and checks every named test is among the failures. A failure elsewhere doesn't count: a patch that breaks loading,
# or trips an unrelated test, would otherwise pass as caught. A patch that no longer applies is stale and must be
# remade against the current code. Anything but a clean kill fails the run.
#
# It tests the last commit, not the working tree; only the patches are read from the working tree. When a file a patch
# touches, or the place its tests live, has uncommitted changes, it says so before the run and beside that patch's
# verdict, because the verdict is for the committed code and may not hold for the changes. It warns rather than stops,
# so it can still be run mid-change to check the committed mutants. Commit and run it again for a verdict on the
# changes. In CI the tree is always clean, so it never warns there.
set -eu
cd "$(dirname "$0")/.."

root=$(mktemp -d "${TMPDIR:-/tmp}/mutants.XXXXXX")
cleanup() {
  git worktree prune
  rm -rf "$root"
}
trap cleanup EXIT

# Prints the names of the failed tests in a test run's output, one per line, without the timing that follows them.
# `claude plugin test` prints `(fail) name [1.2ms]` and `node --test --test-reporter=spec` prints `✖ name (1.2ms)`. The reporter is set because Node 22 prints TAP when its output is not a terminal.
failures() {
  sed -n -e 's/^(fail) \(.*\) \[[0-9.]*m\{0,1\}s\]$/\1/p' -e 's/^(fail) //p' \
    -e 's/^ *✖ \(.*\) ([0-9.]*m\{0,1\}s)$/\1/p' "$1" | sort -u
}

# Prints the paths a patch touches, from its `diff --git a/<path> b/<path>` lines, and the places its tests live. Diff
# body lines start with a space, + or -, so only header lines can match `Test: `.
touched() {
  awk '/^diff --git / { sub(/^a\//, "", $3); sub(/^b\//, "", $4); print $3; print $4 }
    /^Test: / { sub(/^Test: /, ""); sub(/: .*/, ""); print }' "$1" | sort -u
}

# Prints which of the paths given, or the files beneath them, have uncommitted changes, staged or not, or are untracked.
uncommitted() {
  # With no paths, git status would report the whole tree.
  [ "$#" -gt 0 ] || return 0
  git status --porcelain --untracked-files=all -- "$@" | cut -c4- | sort -u
}

# The paths in patches have no spaces, so splitting touched's lines into arguments is safe.
changed=$(uncommitted $(for patch in scripts/mutants/*.patch; do touched "$patch"; done | sort -u))
if [ -n "$changed" ]; then
  echo "WARNING: this tests the last commit, not your uncommitted changes. These files, which a patch touches or its"
  echo "         tests live in, have uncommitted changes, so a verdict below may not hold for them:"
  printf '%s\n' "$changed" | sed 's/^/           /'
  echo "         Commit, then run it again for a verdict on the changes."
fi

# Says, after a patch's verdict, which of its files have uncommitted changes the verdict did not see.
note() {
  mine=$(uncommitted $(touched "$1") | tr '\n' ' ')
  [ -z "$mine" ] || echo "          (tested the last commit; uncommitted changes to ${mine% })"
}

status=0
for patch in scripts/mutants/*.patch; do
  name=$(basename "$patch" .patch)
  tests=$(sed -n '/^diff /q; s/^Test: //p' "$patch")
  if [ -z "$tests" ]; then
    echo "NO TEST   $name: the header has no Test: line naming the test that must catch it"
    status=1
    continue
  fi
  tree="$root/$name"
  git worktree add --quiet --detach "$tree" HEAD
  if ! git -C "$tree" apply "$PWD/$patch" 2>/dev/null; then
    echo "STALE     $name: the patch no longer applies; remake it against the current code"
    note "$patch"
    status=1
    git worktree remove --force "$tree"
    continue
  fi
  # Run each place a named test lives once, and gather the failures of all of them.
  : >"$root/$name.failed"
  passed=yes
  for place in $(printf '%s\n' "$tests" | sed 's/: .*//' | sort -u); do
    case "$place" in
      *.mjs | *.js) (cd "$tree" && node --test --test-reporter=spec "$place") >"$root/$name.out" 2>&1 || passed=no ;;
      *) (cd "$tree" && claude plugin test "$place") >"$root/$name.out" 2>&1 || passed=no ;;
    esac
    failures "$root/$name.out" >>"$root/$name.failed"
  done
  missed=$(printf '%s\n' "$tests" | sed 's/^[^:]*: //' | while IFS= read -r test; do
    grep -qxF -- "$test" "$root/$name.failed" || printf '%s\n' "$test"
  done)
  if [ -z "$missed" ]; then
    echo "killed    $name"
  elif [ "$passed" = yes ]; then
    echo "SURVIVED  $name: the tests passed with the bug back in"
    status=1
  else
    echo "WRONG KILL $name: the run failed, but not through the named test. Named and not failed:"
    printf '%s\n' "$missed" | sed 's/^/            /'
    if [ -s "$root/$name.failed" ]; then
      echo "          Failed instead:"
      sort -u "$root/$name.failed" | sed 's/^/            /'
    else
      echo "          No test failed; the run itself broke. Its last lines:"
      tail -n 5 "$root/$name.out" | sed 's/^/            /'
    fi
    status=1
  fi
  note "$patch"
  git worktree remove --force "$tree"
done
exit "$status"
