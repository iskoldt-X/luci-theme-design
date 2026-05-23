#!/usr/bin/env bash
# scripts/dev-tail.sh — Stream router logs to the local terminal.
#
# Companion to dev-sync.sh. When dev-sync pushed code to the router but
# the page misbehaves, you usually want to see what the server-side
# logged. This tails /var/log over SSH with helpful colour-coding.
#
# Usage:
#     ./scripts/dev-tail.sh                # all logread output
#     ./scripts/dev-tail.sh design         # filter for the word 'design'
#     ./scripts/dev-tail.sh -i error,fail  # case-insensitive multi-pattern
#     ./scripts/dev-tail.sh --help
#
# Environment:
#     ROUTER   SSH alias (default: luci-router)
#
# Round 11 / Step 66 (2026-05-23). See doc/development.md.

set -euo pipefail

ROUTER="${ROUTER:-luci-router}"
SSH_OPTS=(-o LogLevel=ERROR -o ConnectTimeout=5)

if [ -t 1 ]; then
    DIM=$'\033[2m'
    YELLOW=$'\033[0;33m'
    RED=$'\033[0;31m'
    BOLD=$'\033[1m'
    NC=$'\033[0m'
else
    DIM='' YELLOW='' RED='' BOLD='' NC=''
fi

usage() {
    cat <<EOF
Usage: scripts/dev-tail.sh [FILTER] [--help]

  FILTER   Optional grep pattern. Multiple patterns comma-separated.
           Example: 'design'      → lines mentioning design
           Example: 'error,fail'  → lines matching either

Environment:
  ROUTER   SSH target (default: luci-router)

Output is logread -f over SSH, lightly colorised:
  ${RED}red${NC}     lines containing 'error', 'fail', 'denied', 'crash'
  ${YELLOW}yellow${NC}  lines containing 'warn', 'timeout', 'retry'
  ${DIM}dim${NC}     everything else

Ctrl-C to stop.
EOF
}

case "${1:-}" in
    --help|-h|help) usage; exit 0 ;;
esac

FILTER="${1:-}"
REMOTE_CMD='logread -f'
if [ -n "$FILTER" ]; then
    # Convert comma-separated patterns to grep -E alternation
    PATTERN=$(printf '%s' "$FILTER" | sed 's/,/|/g')
    # Use grep --line-buffered so output isn't held in pipe buffers
    REMOTE_CMD="logread -f | grep --line-buffered -iE '${PATTERN}'"
fi

printf '%s%s%s tailing %s%s%s' "$DIM" "[$(date +%H:%M:%S)]" "$NC" "$BOLD" "$ROUTER" "$NC"
[ -n "$FILTER" ] && printf ' filtered by %s%s%s' "$BOLD" "$FILTER" "$NC"
printf '  %s(Ctrl-C to stop)%s\n' "$DIM" "$NC"

# Run the remote command, colorize the output on the way out. awk inline:
#   - red bold for error/fail/denied/crash
#   - yellow for warn/timeout/retry
#   - dim for everything else
# Keeps the original line content; just wraps with ANSI escapes.
ssh "${SSH_OPTS[@]}" "$ROUTER" "$REMOTE_CMD" | awk \
    -v dim="$DIM" -v ylw="$YELLOW" -v red="$RED" -v bold="$BOLD" -v nc="$NC" '
{
    lower = tolower($0)
    if (match(lower, /error|fail|denied|crash|segfault|panic/))
        print red bold $0 nc
    else if (match(lower, /warn|timeout|retry|drop/))
        print ylw $0 nc
    else
        print dim $0 nc
}'
