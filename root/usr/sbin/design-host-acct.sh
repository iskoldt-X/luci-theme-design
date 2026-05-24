#!/bin/sh
#
# design-host-acct.sh — per-host LAN bandwidth accounting JSON publisher
# Round 44 Step 223 — read from Round 31 nft bridge counters.
#
# WHY THE 3rd IMPL IN ROUND 44
# ────────────────────────────
# Step 210/211 used ucode + AF_NETLINK → blocked (ucode-mod-socket has no
#   AF_NETLINK in ImmortalWrt 24.10).
# Step 219 switched to `conntrack -E -e destroy` subprocess → empirically
#   verified destroys_seen=0 for 11 minutes on a router with 10+ active
#   clients (Chrome-Claude Round 44 batch verify, 2026-05-25). Root cause:
#   ImmortalWrt 24.10 ships `flow_offloading=1, flow_offloading_hw=1` by
#   default; the offload fastpath retires flows WITHOUT producing
#   NFNLGRP_CONNTRACK_DESTROY notifications, so `conntrack -E` is silent.
#   The daemon's own comment header described this exact failure mode
#   for nlbwmon, then Step 219 walked into it.
#
# Step 223 (this file): READ FROM the Round 31 design-host-acct service's
# nft bridge family counters. Bridge family hooks fire BELOW the inet/
# flow_offload layer, so byte counts are offload-proof. The Round 31
# service maintains per-IP counters (host_tx_<ip>, host_rx_<ip>) and a
# cron refreshes them as new DHCP leases appear. This daemon just polls,
# joins to ARP for IP→MAC, aggregates, and writes JSON.
#
# DEPENDENCY: Round 31 design-host-acct service MUST be running (it owns
# the nft table). Step 223's Makefile change un-does the Step 219
# "stop + disable Round 31" postinst — they now coexist as
# producer/consumer.
#
# ARCHITECTURE
# ────────────
#   /etc/init.d/design-host-acct (Round 31, START=99)
#       nft add table bridge design_acct {...}
#       nft add counter host_tx_X, host_rx_X for every DHCP-known IP
#       counters accumulate bytes on every packet via bridge prerouting
#       and bridge postrouting chains
#
#   /etc/init.d/design-host-acct-uc (Round 44 Step 210→219→223, START=99)
#       → /usr/sbin/design-host-acct.sh (THIS FILE)
#           every POLL_INTERVAL seconds:
#               1. read /proc/net/arp        → ip_to_mac
#               2. read nft list table       → counter snapshot
#               3. aggregate per MAC          → host totals
#               4. atomic-rename JSON output  → /tmp/design-host-traffic.json
#
#   rpcd `host-traffic-acct` method serves the JSON file.
#   traffic.js consumes via Tier 1 of the three-tier chain (Step 212).
#
# OUTPUT SCHEMA (unchanged from Step 211 — frontend & rpcd untouched)
#   {
#     "version":1, "phase":3, "impl":"nft-bridge-direct",
#     "generated_at": <epoch>,
#     "stats": {
#       "destroys_seen":0,         (not applicable — no event stream)
#       "destroys_parsed":0,        (same)
#       "dumps_completed": N,       (per-poll count)
#       "dump_entries": K,           (per-poll: # counters joined to MAC)
#       "bytes_credited": M,         (per-poll: bytes added across all MACs)
#       "parse_errors":0,
#       "id_reuses":0,                (not applicable — counters are persistent)
#       "silent_evictions": E,        (per-poll: counters whose IP has no ARP MAC)
#       "started": <epoch>
#     },
#     "hosts": {
#       "<mac uppercase no colons>": { "tx": <total bytes>, "rx": <total bytes> },
#       ...
#     }
#   }

set -e

OUT_FILE=/tmp/design-host-traffic.json
TMP_FILE=/tmp/.design-host-traffic.json.tmp
ARP_FILE=/proc/net/arp
NFT_TABLE=design_acct
POLL_INTERVAL=5
STATE_FILE=/tmp/.design-host-acct-state

STARTED_AT=$(date +%s)
DUMPS_COMPLETED=0

# Restore persistent counters across daemon restart so the widget
# doesn't see dumps_completed reset to 0 every time procd respawns.
# State file format: one shell `K=V` per line.
if [ -r "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE" 2>/dev/null || true
fi

cleanup() {
    rm -f "$TMP_FILE"
    exit 0
}
trap cleanup INT TERM HUP

# Pre-flight: the Round 31 service must be alive (it owns the nft table).
if ! nft list table bridge "$NFT_TABLE" >/dev/null 2>&1; then
    logger -t design-host-acct \
        "WARN: bridge $NFT_TABLE table missing — start /etc/init.d/design-host-acct first"
    # Loop anyway and recover when the producer comes up. Some hosts
    # may bring it up after this daemon starts (boot-order race).
fi

while :; do
    DUMPS_COMPLETED=$((DUMPS_COMPLETED + 1))
    NOW=$(date +%s)

    # ── 1. Build IP → MAC map from ARP table ──────────────────────
    # /proc/net/arp columns: IP HW_TYPE FLAGS HW_ADDR MASK DEVICE
    # Skip header line and incomplete entries (HW_ADDR = 00:00:00:00:00:00).
    # MAC normalised to uppercase, no colons (matches host-presence rpcd
    # method output from Step 218; frontend devices.js does the same
    # mac.replace(/:/g,'') so keys match).
    ARP_MAP=$(awk '
        NR > 1 && $4 != "00:00:00:00:00:00" {
            mac = toupper($4)
            gsub(/:/, "", mac)
            print $1 "=" mac
        }
    ' "$ARP_FILE" 2>/dev/null || true)

    # ── 2. Snapshot Round 31 nft bridge counters ──────────────────
    # nft list (non-JSON) is more reliable to parse than -j with awk on
    # busybox. The output we care about looks like:
    #   counter host_tx_192_168_45_128 {
    #       packets 1067 bytes 129438
    #   }
    # State-machine awk: on a `counter host_(tx|rx)_X` line capture
    # name+direction+IP; on the next `bytes N` line emit + look up MAC.
    NFT_OUT=$(nft list table bridge "$NFT_TABLE" 2>/dev/null || true)

    # ── 3. Aggregate per-MAC totals + write JSON ──────────────────
    RESULT=$(printf '%s\n' "$NFT_OUT" | awk -v arp="$ARP_MAP" -v ts="$NOW" \
                                            -v started="$STARTED_AT" \
                                            -v dumps="$DUMPS_COMPLETED" '
        BEGIN {
            # Parse the IP=MAC map passed in via -v
            n = split(arp, lines, "\n")
            for (i = 1; i <= n; i++) {
                if (split(lines[i], kv, "=") == 2 && kv[1] != "" && kv[2] != "") {
                    ip2mac[kv[1]] = kv[2]
                }
            }
            current_dir = ""
            current_ip  = ""
            entries        = 0
            bytes_credited = 0
            silent_evictions = 0
        }

        # Match: "    counter host_tx_192_168_45_128 {"
        # Capture direction (tx|rx) and ip (with underscores converted).
        /counter[ \t]+host_(tx|rx)_/ {
            for (i = 1; i <= NF; i++) {
                if (substr($i, 1, 5) == "host_") {
                    name = $i
                    current_dir = substr(name, 6, 2)       # tx or rx
                    ip = substr(name, 9)                    # 192_168_45_128
                    gsub(/_/, ".", ip)
                    current_ip = ip
                    break
                }
            }
            next
        }

        # Match: "        packets 1067 bytes 129438"
        # Emit when we have a captured counter.
        /packets[ \t]+[0-9]+[ \t]+bytes[ \t]+[0-9]+/ {
            if (current_dir == "" || current_ip == "") next
            for (i = 1; i <= NF - 1; i++) {
                if ($i == "bytes") {
                    b = $(i + 1) + 0
                    mac = ip2mac[current_ip]
                    if (mac == "") {
                        if (b > 0) silent_evictions++
                    } else {
                        if (current_dir == "tx") host_tx[mac] += b
                        else                     host_rx[mac] += b
                        # bytes_credited = sum across this poll
                        bytes_credited += b
                        entries++
                    }
                    break
                }
            }
            current_dir = ""
            current_ip  = ""
            next
        }

        END {
            printf "{\"version\":1,\"phase\":3,\"impl\":\"nft-bridge-direct\","
            printf "\"generated_at\":%d,", ts
            printf "\"stats\":{"
            printf "\"destroys_seen\":0,\"destroys_parsed\":0,"
            printf "\"dumps_completed\":%d,\"dump_entries\":%d,", dumps, entries
            printf "\"bytes_credited\":%d,\"parse_errors\":0,", bytes_credited
            printf "\"id_reuses\":0,\"silent_evictions\":%d,", silent_evictions
            printf "\"started\":%d", started
            printf "},\"hosts\":{"
            sep = ""
            # Union of MACs that appear in either direction
            for (m in host_tx) macs[m] = 1
            for (m in host_rx) macs[m] = 1
            for (m in macs) {
                tx = host_tx[m] + 0
                rx = host_rx[m] + 0
                printf "%s\"%s\":{\"tx\":%d,\"rx\":%d,\"last_seen\":%d}", sep, m, tx, rx, ts
                sep = ","
            }
            printf "}}"
        }
    ')

    # ── 4. Atomic write ──────────────────────────────────────────
    printf '%s' "$RESULT" > "$TMP_FILE"
    mv "$TMP_FILE" "$OUT_FILE"

    # ── 5. Persist counters across restart ──────────────────────
    {
        printf 'STARTED_AT=%d\n'     "$STARTED_AT"
        printf 'DUMPS_COMPLETED=%d\n' "$DUMPS_COMPLETED"
    } > "$STATE_FILE"

    sleep "$POLL_INTERVAL"
done
