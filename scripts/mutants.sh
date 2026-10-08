#!/usr/bin/env sh
# Proves each regression test still catches the bug it was written for. Every patch in scripts/mutants/ puts one fixed
# bug back, and names in its header the test (or tests) that must catch it:
#
#   Guards #214: what the fix guarantees. What the patch breaks.
#   Test: plugins/usage: the name of the test, as `claude plugin test` prints it
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
#
# Given a base ref, as in `sh scripts/mutants.sh origin/main`, it runs only the patches the changes since that base can
# affect: a patch that is new or changed, or one whose touched files or `Test:` test files changed. A `Test:` name in a
# plugin is placed by searching that plugin's test files for it. When the search can't place it, as with a name built
# from a table, a `Test-file: <path>` line in the header names the file that holds it; with neither, the patch runs. A
# change to this script, the workflow, a shared test helper (a file in a plugin's tests/ that is
# not a test file), or a plugin's plugin.json beyond its version line runs every patch. It says which patches it
# skipped and why. With no base it runs every patch. Other changes can still change a verdict in rare cases, such as a
# refactor of a helper the patched code calls, so CI also runs every patch on each push to main and weekly.
#
#   sh scripts/mutants.sh [--list] [--shard <i>/<n>] [<base>]
#
# --list prints the patches it would run, each as `selected  <name>`, and runs none; CI uses it to plan its shards.
# --shard 2/4 runs the second of four shards: the selected patches are dealt out in turn, so shard i gets the i-th, the
# (i+n)-th and so on.
set -eu
cd "$(dirname "$0")/.."

list=
shard=1
shards=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --list) list=yes ;;
    --shard)
      [ "$#" -gt 1 ] || { echo "mutants.sh: --shard needs <i>/<n>, such as 2/4" >&2; exit 2; }
      shard=${2%%/*}
      shards=${2#*/}
      case "$shard/$shards" in
        *[!0-9/]* | /* | */ | */*/*) echo "mutants.sh: --shard needs <i>/<n>, such as 2/4, not $2" >&2; exit 2 ;;
      esac
      [ "$shard" -ge 1 ] && [ "$shard" -le "$shards" ] || { echo "mutants.sh: no shard $2" >&2; exit 2; }
      shift
      ;;
    *) break ;;
  esac
  shift
done
base=${1-}
# A base it can't find, as in a shallow clone, runs every patch: skipping on a guess could pass a survivor.
if [ -n "$base" ] && ! git merge-base "$base" HEAD >/dev/null 2>&1; then
  echo "Running every patch: can't find the base $base, or what it shares with HEAD."
  base=
fi

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
# body lines start with a space, + or -, so only header lines can match `Test: ` or `Test-file: `.
touched() {
  awk '/^diff --git / { sub(/^a\//, "", $3); sub(/^b\//, "", $4); print $3; print $4 }
    /^Test: / { sub(/^Test: /, ""); sub(/: .*/, ""); print }
    /^Test-file: / { sub(/^Test-file: /, ""); print }' "$1" | sort -u
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

# Prints the test files that hold a `Test:` line's test: the file itself for a node test, and for a plugin, those of
# its test files that contain the name. Prints nothing when it can't place the name.
testfiles() {
  place=${1%%: *}
  case "$place" in
    *.mjs | *.js) printf '%s\n' "$place" ;;
    *) [ ! -d "$place/tests" ] || grep -rlF --include='*.test.*' -- "${1#*: }" "$place/tests" || true ;;
  esac
}

# With a base, the files that differ from it: those committed since the merge base, and any uncommitted patches, since
# the patches are read from the working tree.
diffed=
if [ -n "$base" ]; then
  diffed=$( {
    git diff --name-only "$base"...HEAD
    uncommitted scripts/mutants
  } | sort -u)
  # A change to any of these can change every verdict. Every plugin change bumps its version, so a plugin.json whose
  # only changed line is the version doesn't count; any other change to it, such as a setting, does.
  everything=$(printf '%s\n' "$diffed" | while IFS= read -r file; do
    case "$file" in
      scripts/mutants.sh | .github/workflows/mutants.yml) printf '%s\n' "$file" ;;
      plugins/*/.claude-plugin/plugin.json)
        ! git diff --unified=0 "$base"...HEAD -- "$file" | grep '^[-+]' | grep -v '^+++ \|^--- ' |
          grep -qv '^[-+] *"version": *"[^"]*",\{0,1\} *$' || printf '%s\n' "$file"
        ;;
      plugins/*/tests/*.test.*) ;;
      plugins/*/tests/*) printf '%s\n' "$file" ;;
    esac
  done)
  if [ -n "$everything" ]; then
    echo "Running every patch: these changed since $base:"
    printf '%s\n' "$everything" | sed 's/^/  /'
    base=
  fi
fi

# Says why a patch must run, one reason per line, or nothing when no change since the base can affect it.
reasons() {
  ! printf '%s\n' "$diffed" | grep -qxF -- "$1" || echo "the patch is new or changed"
  {
    awk '/^diff --git / { sub(/^a\//, "", $3); sub(/^b\//, "", $4); print $3; print $4 }' "$1"
    # The Test-file lines name the files that hold the tests the search can't place. One that is gone places nothing.
    hinted=$(sed -n '/^diff /q; s/^Test-file: //p' "$1" | while IFS= read -r file; do
      [ ! -f "$file" ] || printf '%s\n' "$file"
    done)
    sed -n '/^diff /q; s/^Test: //p' "$1" | while IFS= read -r line; do
      files=$(testfiles "$line")
      [ -n "$files" ] || files=$hinted
      [ -n "$files" ] || echo "can't find the test \"${line#*: }\" in ${line%%: *}"
      printf '%s\n' "$files"
    done
  } | sort -u | while IFS= read -r file; do
    case "$file" in
      "can't find "*) printf '%s\n' "$file" ;;
      ?*) ! printf '%s\n' "$diffed" | grep -qxF -- "$file" || echo "$file changed" ;;
    esac
  done
}

# Picks the patches to run, saying why it skips the others. The patch paths have no spaces, so a space-separated list
# of them is safe.
selected=
skipped=0
for patch in scripts/mutants/*.patch; do
  name=$(basename "$patch" .patch)
  if [ -n "$base" ]; then
    why=$(reasons "$patch")
    if [ -z "$why" ]; then
      echo "skipped   $name: nothing it touches or tests changed since $base"
      skipped=$((skipped + 1))
      continue
    fi
    printf '%s\n' "$why" | sed "s/^/running   $name: /"
  fi
  selected="$selected $patch"
done
[ "$skipped" -eq 0 ] || echo "Skipped $skipped patches that no change since $base can affect."

if [ -n "$list" ]; then
  for patch in $selected; do
    echo "selected  $(basename "$patch" .patch)"
  done
  exit 0
fi

# Deals the selected patches out in turn and keeps this shard's.
if [ "$shards" -gt 1 ]; then
  k=0
  mine=
  for patch in $selected; do
    [ $((k % shards + 1)) -ne "$shard" ] || mine="$mine $patch"
    k=$((k + 1))
  done
  selected=$mine
  echo "Shard $shard of $shards runs:$(for patch in $selected; do printf ' %s' "$(basename "$patch" .patch)"; done)"
fi

status=0
for patch in $selected; do
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
