#!/usr/bin/env bash
# scripts/dev-sync.sh — Local development feedback loop.
#
# Watches the project source tree on your Mac and rsyncs every change to
# a running ImmortalWrt/OpenWrt router over SSH. With this loop:
#
#     edit file → save → ~1 second → reload browser → see change
#
# replaces the old:
#
#     edit → commit → push → wait CI build → download zip → unzip
#     → scp → ssh opkg install → reload → see change  (~15 min)
#
# Round 10 / Step 59 (2026-05-23). See doc/development.md for full
# setup walkthrough and doc/styling-progress.md for the design rationale.
#
# Usage:
#     ./scripts/dev-sync.sh              # watch mode (default)
#     ./scripts/dev-sync.sh --once       # one-shot full sync, no watch
#     ./scripts/dev-sync.sh --help
#
# Environment:
#     ROUTER   SSH target (default: luci-router; the ~/.ssh/config alias
#              we set up in Round 10. Override e.g. ROUTER=root@1.2.3.4)

set -euo pipefail

ROUTER="${ROUTER:-luci-router}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ──────────────────────────────────────────────────────────────────────
# Output helpers — color if attached to a terminal
# ──────────────────────────────────────────────────────────────────────

if [ -t 1 ]; then
    GREEN=$'\033[0;32m'
    BLUE=$'\033[0;34m'
    YELLOW=$'\033[0;33m'
    RED=$'\033[0;31m'
    DIM=$'\033[2m'
    BOLD=$'\033[1m'
    NC=$'\033[0m'
else
    GREEN='' BLUE='' YELLOW='' RED='' DIM='' BOLD='' NC=''
fi

log()  { printf '%s[%s]%s %s\n' "$DIM" "$(date +%H:%M:%S)" "$NC" "$*"; }
warn() { printf '%s[%s] %swarn:%s %s\n' "$DIM" "$(date +%H:%M:%S)" "$YELLOW" "$NC" "$*"; }
err()  { printf '%s[%s] %sERROR:%s %s\n' "$DIM" "$(date +%H:%M:%S)" "$RED" "$NC" "$*" >&2; }

# ──────────────────────────────────────────────────────────────────────
# Preflight: deps + repo shape + router reachability
# ──────────────────────────────────────────────────────────────────────

check_deps() {
    if ! command -v fswatch >/dev/null 2>&1; then
        err "fswatch not installed."
        err "  fix: brew install fswatch"
        exit 1
    fi
    if ! command -v rsync >/dev/null 2>&1; then
        err "rsync not installed (unusual — comes with macOS)."
        err "  fix: brew install rsync"
        exit 1
    fi
    if ! command -v ssh >/dev/null 2>&1; then
        err "ssh not installed (extremely unusual)."
        exit 1
    fi
}

check_repo() {
    if [ ! -f "${PROJECT_ROOT}/Makefile" ] || \
       [ ! -d "${PROJECT_ROOT}/htdocs/luci-static/design" ] || \
       [ ! -d "${PROJECT_ROOT}/luasrc/view/themes/design" ]; then
        err "doesn't look like the luci-theme-design repo."
        err "  PROJECT_ROOT was resolved to: ${PROJECT_ROOT}"
        err "  expected to find Makefile + htdocs/luci-static/design + luasrc/view/themes/design"
        exit 1
    fi
}

# Verify SSH works AND remote has rsync AND the theme is already installed.
#
# Step 60: also probe remote rsync. BusyBox/ash on ImmortalWrt does NOT
# ship rsync by default.
# Step 61: separate connectivity check from feature probes. Step 60's
# `if ! probe=$(ssh ...)` misread ssh's non-zero exit (last probe failing)
# as "can't reach SSH" even when SSH itself worked fine. Now CONNECT_OK
# is the explicit connectivity signal; missing-feature exit codes are
# swallowed by `; true` so they can't fool us.
check_router() {
    log "${BLUE}preflight${NC}: probing ${BOLD}${ROUTER}${NC}..."

    # Single SSH round-trip. Trailing `true` makes the remote shell always
    # exit 0 regardless of which probes succeeded. Connectivity itself is
    # detected by the presence of CONNECT_OK line in the captured output.
    local probe
    probe=$(ssh -o ConnectTimeout=5 -o BatchMode=yes "$ROUTER" "
        echo CONNECT_OK
        test -d /www/luci-static/design && echo DESIGN_OK
        test -d /usr/lib/lua/luci/view/themes/design && echo VIEW_OK
        command -v rsync >/dev/null 2>&1 && echo RSYNC_OK
        true
    " 2>&1) || true

    if ! printf '%s\n' "$probe" | grep -q '^CONNECT_OK$'; then
        err "can't reach $ROUTER over SSH (BatchMode=yes — needs key auth)."
        err "  try: ssh $ROUTER \"echo hello\""
        err "  if that prompts for password, ssh-copy-id first (see doc/development.md)."
        err "  ssh raw output: $probe"
        exit 1
    fi
    if ! printf '%s\n' "$probe" | grep -q '^RSYNC_OK$'; then
        err "$ROUTER reachable, but rsync isn't installed on the router."
        err "  BusyBox / ash doesn't include rsync by default."
        err "  fix in one line:"
        err "    ssh $ROUTER \"opkg update && opkg install rsync\""
        err "  (~100 KB, then rerun this script.)"
        exit 1
    fi
    if ! printf '%s\n' "$probe" | grep -q '^DESIGN_OK$' || \
       ! printf '%s\n' "$probe" | grep -q '^VIEW_OK$'; then
        err "$ROUTER reachable, but theme dirs missing."
        err "  /www/luci-static/design                OR"
        err "  /usr/lib/lua/luci/view/themes/design"
        err "  do not exist. Install the theme ipk once before using dev-sync."
        err "  (see README.md — opkg install luci-theme-design_*.ipk)"
        exit 1
    fi
    log "${GREEN}preflight: OK${NC}  ${DIM}(router rsync + theme dirs present)${NC}"
}

# ──────────────────────────────────────────────────────────────────────
# The actual sync — four rsync calls covering each deployment target
# ──────────────────────────────────────────────────────────────────────

sync_all() {
    local started ended elapsed
    started=$(date +%s)

    # 1. Static theme assets (CSS, fonts, SVG, images)
    #    LOCAL:  htdocs/luci-static/design/
    #    REMOTE: /www/luci-static/design/
    #    --delete is safe here: it's the theme's own subdirectory.
    rsync -az --delete \
        --exclude='.DS_Store' \
        "${PROJECT_ROOT}/htdocs/luci-static/design/" \
        "${ROUTER}:/www/luci-static/design/"

    # 2. LuCI module JS (theme-provided modules: wan-stats, cmdk, toast, etc.)
    #    LOCAL:  htdocs/luci-static/resources/
    #    REMOTE: /www/luci-static/resources/
    #    NO --delete: this dir is shared with LuCI core modules — deleting
    #    files not in our source would wipe other modules.
    rsync -az \
        --exclude='.DS_Store' \
        "${PROJECT_ROOT}/htdocs/luci-static/resources/" \
        "${ROUTER}:/www/luci-static/resources/"

    # 3. Lua view templates (header.htm / footer.htm)
    #    LOCAL:  luasrc/view/themes/design/
    #    REMOTE: /usr/lib/lua/luci/view/themes/design/
    rsync -az --delete \
        --exclude='.DS_Store' \
        "${PROJECT_ROOT}/luasrc/view/themes/design/" \
        "${ROUTER}:/usr/lib/lua/luci/view/themes/design/"

    # 4. CGI scripts (ping, temp, devstats, download, upload, nlbw)
    #    LOCAL:  root/www/cgi-bin/design/
    #    REMOTE: /www/cgi-bin/design/
    #    --chmod=+x because rsync over SSH defaults to 644 and uhttpd
    #    needs them executable to run as CGI.
    rsync -az --delete --chmod=Du=rwx,Dgo=rx,Fu=rwx,Fgo=rx \
        --exclude='.DS_Store' \
        --exclude='.gitkeep' \
        "${PROJECT_ROOT}/root/www/cgi-bin/design/" \
        "${ROUTER}:/www/cgi-bin/design/"

    ended=$(date +%s)
    elapsed=$((ended - started))
    log "${GREEN}✓ synced${NC} in ${elapsed}s"
}

# ──────────────────────────────────────────────────────────────────────
# Arg parsing
# ──────────────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
Usage: scripts/dev-sync.sh [--once|--watch|--help]

  --watch  Watch for file changes and sync on each save (default)
  --once   Do a single full sync and exit
  --help   Show this help

Environment:
  ROUTER   SSH target (default: luci-router)
           Example: ROUTER=root@192.168.1.1 ./scripts/dev-sync.sh

Watches these paths for changes:
  htdocs/        → /www/luci-static/{design,resources}/
  luasrc/        → /usr/lib/lua/luci/view/themes/design/
  root/www/      → /www/cgi-bin/design/  (+ executable bit)

Excludes: .DS_Store, .gitkeep
EOF
}

MODE="watch"
case "${1:-}" in
    --once|once)   MODE="once" ;;
    --watch|watch|"") MODE="watch" ;;
    --help|-h|help) usage; exit 0 ;;
    *) err "unknown arg: ${1}"; usage; exit 1 ;;
esac

# ──────────────────────────────────────────────────────────────────────
# Run
# ──────────────────────────────────────────────────────────────────────

check_deps
check_repo
check_router

log "${BLUE}initial sync${NC}..."
sync_all

if [ "$MODE" = "once" ]; then
    exit 0
fi

log "${BLUE}watching${NC}: htdocs/ luasrc/ root/www/  ${DIM}(Ctrl-C to stop)${NC}"

# fswatch -o emits ONE line per batch (built-in debounce). We re-sync the
# whole tree on each batch — rsync handles incremental diff itself, so
# even a 5000-file repo syncs in under a second.
fswatch -o \
    "${PROJECT_ROOT}/htdocs" \
    "${PROJECT_ROOT}/luasrc" \
    "${PROJECT_ROOT}/root/www" \
| while read -r _; do
    sync_all
done
