#!/bin/sh
# The eval sandbox can't run git, so ./git stands in for it: a commit saves its
# message to last-commit.txt for the graders, and everything else succeeds.
set -e
printf 'orders\ncruise long legs\n' > orders.txt
cat > git <<'SHIM'
#!/bin/sh
[ "$1" = commit ] || exit 0
shift
msg=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m|-qm|-am|--message) msg="$msg$2
"; shift 2 ;;
    -F|-qF|--file) if [ "$2" = - ]; then msg="$msg$(cat)"; else msg="$msg$(cat "$2")"; fi; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\n' "$msg" > last-commit.txt
echo "[main 1a2b3c4] committed"
SHIM
chmod +x git
