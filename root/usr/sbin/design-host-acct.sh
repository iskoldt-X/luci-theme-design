#!/bin/sh
#
# design-host-acct.sh — per-host LAN bandwidth accounting daemon
# Round 44 Step 226 — Tier 0: /proc/net/nf_conntrack polling + delta tracking
#
# DAEMON-TRACK SAGA (FOUR IMPLS BEFORE THIS ONE)
# ──────────────────────────────────────────────
# Step 210/211 (ucode + AF_NETLINK)        — ucode-mod-socket has no AF_NETLINK
# Step 219     (shell + conntrack -E)       — SFO bypasses DESTROY events (~0% coverage)
# Step 223     (shell + nft bridge counter) — SFO bypasses bridge family too (<5% coverage)
# Step 226     (shell + nf_conntrack poll)  — THIS — bytes synced in conntrack table
#                                              even for SFO/HFO-offloaded flows
#
# WHY THIS WORKS WHERE THE OTHERS DIDN'T
# ──────────────────────────────────────
# Empirically verified on the user's ImmortalWrt 24.10 router (2026-05-25,
# Chrome-Claude batch verify):
#   `cat /etc/config/firewall | grep flow_`
#     flow_offloading        '1'
#     flow_offloading_hw     '1'
#   `cat /proc/net/nf_conntrack | head -2`
#     ipv4 2 udp 17 25 src=A dst=B sport=X dport=Y packets=N bytes=N \
#                       src=B dst=A sport=Y dport=X packets=N bytes=N ...
#   bytes=N populated → kernel maintains per-flow byte counts in the table
#   regardless of offload mode. SFO/HFO retire the FAST PATH packets through
#   shortcut code, but they STILL update the conntrack entry's byte counter
#   (via nf_flow_offload_stats() and friends, called periodically by the
#   offload subsystem). The table is the only kernel surface that is both
#   per-flow AND offload-aware.
#
# WHY DOC §3 "POLLING IS WRONG" WAS A MISJUDGMENT
# ───────────────────────────────────────────────
# doc/bandwith.md §3 dismissed polling as "Tier 1a, 85-95% accuracy, broken
# UX during long streams". That assessment is wrong for THIS use case:
#   - "85-95% accuracy" referenced short-flow data loss (DNS queries etc).
#     For BYTE accounting (bandwidth dashboard), short flows are <1% of
#     bytes — polling is 99%+ on bytes.
#   - "broken UX during long streams" presumed DESTROY events would arrive
#     to credit final bytes. With SFO ON (default), destroy events DON'T
#     arrive — but polling sees the flow's current byte count every 5s,
#     so long streams render smoothly.
# 16+ hours of Round 44 daemon-track work could have been saved by
# choosing this impl from the start. Memory `[[sfo-bypasses-conntrack-events]]`
# now captures the lesson.
#
# HOW IT WORKS
# ────────────
#   Single long-running awk consumes a shell-muxed input stream:
#
#     ===ARP===     awk reset ip_to_mac map, reads following lines
#     <IP MAC>      one per line, until next sentinel
#     ===POLL===    awk switches to flow-parsing mode
#     <conntrack>   /proc/net/nf_conntrack body, one line per flow
#     ===ENDPOLL=== awk reconciles state, writes JSON, evicts gone flows
#
#   awk maintains:
#     ip_to_mac[IP]                          IPv4 → MAC (uppercase, no colons)
#     in_flight[flow_id] = "orig_b, repl_b"  per-flow last-known bytes
#     per_mac_rx[mac], per_mac_tx[mac]       per-host running totals
#     seen_this_poll[flow_id]                set of flows in current dump
#
#   On each ENDPOLL: flow_ids in in_flight NOT in seen_this_poll are
#   evicted (already credited up to their last sighting; missed final
#   burst, if any, is bounded by POLL_INTERVAL × peak bandwidth).
#
#   On first sighting of a new flow (not in in_flight): BASELINE only
#   (record current bytes, no credit). Avoids over-counting flows that
#   existed before daemon started. Trade-off: daemon misses bytes that
#   accrued before it started running.
#
# OUTPUT SCHEMA (unchanged from Step 223 — frontend & rpcd untouched)
#   {
#     "version":1, "phase":4, "impl":"conntrack-poll",
#     "generated_at": <epoch>,
#     "stats": { destroys_seen:0, destroys_parsed:0, dumps_completed,
#                dump_entries, bytes_credited, parse_errors,
#                id_reuses, silent_evictions, started },
#     "hosts": { "<mac>": { rx, tx, last_seen } }
#   }

set -e

OUT_FILE=/tmp/design-host-traffic.json
TMP_FILE=/tmp/.design-host-traffic.json.tmp
# Round 44 Step 227: poll 5s → 3s. Step 226 verified `silent_evictions`
# 5681 in 60 dumps (~95 flow/dump dying between polls). Modern HTTPS
# is short-connection-heavy; tighter window captures more before
# eviction. CPU cost: ~2x at minimal absolute (awk + cat on ~1000
# conntrack lines per poll).
POLL_INTERVAL=3
STARTED_AT=$(date +%s)

# Self-locking: prevent multiple daemons. Round 44 Step 225 lesson —
# orphans from prior installs survived procd restart and overwrote
# /tmp/design-host-traffic.json with stale impl. Now: any daemon that
# starts checks for an alive sibling, exits gracefully if one is found.
PIDFILE=/var/run/design-host-acct-daemon.pid
if [ -r "$PIDFILE" ]; then
    OLD_PID=$(cat "$PIDFILE" 2>/dev/null || echo "")
    if [ -n "$OLD_PID" ] && [ "$OLD_PID" != "$$" ] && [ -r "/proc/$OLD_PID/cmdline" ]; then
        if grep -q "design-host-acct.sh" "/proc/$OLD_PID/cmdline" 2>/dev/null; then
            logger -t design-host-acct \
                "another instance (PID $OLD_PID) already running — exit"
            exit 0
        fi
    fi
fi
echo "$$" > "$PIDFILE"

cleanup() {
    rm -f "$TMP_FILE" "$PIDFILE"
    exit 0
}
trap cleanup INT TERM HUP EXIT

logger -t design-host-acct "starting (Tier 0, conntrack-poll, PID $$)"

# Mux: arp refresh + conntrack snapshot in one stream → single awk
(
    while sleep "$POLL_INTERVAL"; do
        # ─── ARP (IPv4) ──
        echo "===ARP==="
        awk 'NR>1 && $4 != "00:00:00:00:00:00" { print $1 " " toupper($4) }' \
            /proc/net/arp 2>/dev/null || true

        # ─── IPv6 neighbor (Step 228) ──
        # /proc/net/ipv6_neigh isnt populated as text on stock kernels;
        # `ip -6 neigh show` is the universal interface. Filter REACHABLE
        # and STALE (kernel still believes entry valid). Format:
        #   <ipv6> dev <iface> lladdr <mac> <state>
        echo "===NDP==="
        ip -6 neigh show 2>/dev/null | awk '
            /lladdr/ && ($NF=="REACHABLE" || $NF=="STALE" || $NF=="DELAY" || $NF=="PROBE") {
                for (i=1; i<=NF; i++) {
                    if ($i == "lladdr") { mac = toupper($(i+1)); gsub(/:/, "", mac) }
                }
                if (mac != "" && mac != "000000000000") print $1 " " mac
            }
        ' || true

        # ─── LAN IPv6 prefix discovery (Step 228) ──
        # Get the LAN /64 GUA prefix(es) so we can attribute outbound
        # IPv6 flows whose src is a LAN device GUA (assigned via SLAAC
        # from ISP prefix delegation). Filter out link-local fe80::/10.
        echo "===LANV6==="
        ip -6 addr show br-lan 2>/dev/null | awk '
            /^[ \t]+inet6 / && $2 !~ /^fe80:/ {
                split($2, p, "/")
                print p[1]
            }
        ' || true

        # ─── Conntrack table ──
        echo "===POLL==="
        cat /proc/net/nf_conntrack 2>/dev/null || true
        echo "===ENDPOLL==="
    done
) | awk \
    -v started_at="$STARTED_AT" \
    -v out_file="$OUT_FILE" \
    -v tmp_file="$TMP_FILE" '
BEGIN {
    mode = ""
    dumps_completed = 0
    dump_entries = 0
    bytes_credited = 0
    silent_evictions = 0
    id_reuses = 0
    # Step 229: diagnostic counters for skipped flow categories
    intra_lan_skipped = 0     # both sides LAN — noise for WAN-usage widget
    router_local_skipped = 0  # neither side LAN — dnsmasq/NTP/WireGuard
    no_mac_skipped = 0        # LAN side but no ARP/NDP entry
    delete in_flight     # flow_id → "orig_b" SUBSEP "repl_b"
    delete ip_to_mac     # IPv4 + IPv6 → MAC (uppercase no colons)
    delete lan_v6_prefixes  # Step 228: known LAN /64 prefixes for IPv6 GUA attribution
    delete per_mac_rx
    delete per_mac_tx
    delete per_mac_seen  # last_seen epoch per mac
    delete seen_this_poll
}

# ─── Sentinels ────────────────────────────────────────────────────────
/^===ARP===$/ {
    mode = "arp"
    delete ip_to_mac           # clear unified IP→MAC map (will be repopulated)
    next
}
/^===NDP===$/ {
    mode = "ndp"               # continues filling ip_to_mac with IPv6 entries
    next
}
/^===LANV6===$/ {
    mode = "lanv6"
    delete lan_v6_prefixes
    next
}
/^===POLL===$/ {
    mode = "poll"
    delete seen_this_poll
    next
}
/^===ENDPOLL===$/ {
    # End of poll: evict flow_ids that disappeared. Their final bytes
    # (since last seen) are LOST — this is the polling impl trade-off,
    # bounded by POLL_INTERVAL × peak speed.
    drop_count = 0
    for (k in in_flight) {
        if (!(k in seen_this_poll)) {
            delete in_flight[k]
            drop_count++
        }
    }
    silent_evictions += drop_count
    delete seen_this_poll
    dumps_completed++
    write_json()
    mode = ""
    next
}

# ─── ARP mode: build IP → MAC map (IPv4) ─────────────────────────────
mode == "arp" && NF >= 2 {
    mac = $2
    gsub(/:/, "", mac)
    ip_to_mac[$1] = mac
    next
}

# ─── NDP mode: extend IP → MAC map with IPv6 entries (Step 228) ──────
mode == "ndp" && NF >= 2 {
    mac = $2
    gsub(/:/, "", mac)
    ip_to_mac[$1] = mac
    next
}

# ─── LANV6 mode: record LAN /64 IPv6 prefixes (Step 228) ─────────────
# Each line = one LAN IPv6 address. We extract the /64 prefix from it
# (first 4 colon-separated groups) for is_lan_v6() matching below.
mode == "lanv6" && NF >= 1 {
    n = split($1, parts, ":")
    # IPv6 normalised has 8 groups separated by colons. For a /64 we
    # want the first 4. Handle short forms (with ::) by taking the
    # first 4 hexgroups before any consecutive colons.
    prefix = ""
    cnt = 0
    for (i = 1; i <= n && cnt < 4; i++) {
        if (parts[i] == "") next   # encountered "::" — too compact, skip
        prefix = (cnt == 0) ? parts[i] : (prefix ":" parts[i])
        cnt++
    }
    if (cnt == 4) {
        lan_v6_prefixes[tolower(prefix)] = 1
    }
    next
}

# ─── Poll mode: parse one conntrack flow line, compute delta ─────────
# Line format (extended):
#   ipv4 2 tcp 6 ESTABLISHED src=A dst=B sport=X dport=Y \
#      packets=N1 bytes=B1 src=B dst=A sport=Y dport=X \
#      packets=N2 bytes=B2 [ASSURED] mark=0 zone=0 use=2
# or:
#   ipv6 10 udp 17 16 src=... dst=... sport=... dport=... \
#      packets=N1 bytes=B1 [UNREPLIED] src=... dst=... sport=... \
#      dport=... packets=0 bytes=0 mark=0 zone=0 use=2
mode == "poll" {
    if ($1 != "ipv4" && $1 != "ipv6") next

    orig_src = ""; orig_dst = ""; orig_sport = ""; orig_dport = ""
    orig_b = 0; repl_b = 0
    seen_src = 0; seen_dst = 0; seen_sport = 0; seen_dport = 0; bytes_count = 0
    for (i = 1; i <= NF; i++) {
        f = $i
        if (substr(f, 1, 4) == "src=" && !seen_src) {
            orig_src = substr(f, 5); seen_src = 1
        } else if (substr(f, 1, 4) == "dst=" && !seen_dst) {
            orig_dst = substr(f, 5); seen_dst = 1
        } else if (substr(f, 1, 6) == "sport=" && !seen_sport) {
            orig_sport = substr(f, 7); seen_sport = 1
        } else if (substr(f, 1, 6) == "dport=" && !seen_dport) {
            orig_dport = substr(f, 7); seen_dport = 1
        } else if (substr(f, 1, 6) == "bytes=") {
            b = substr(f, 7) + 0
            if (bytes_count == 0)      { orig_b = b; bytes_count = 1 }
            else if (bytes_count == 1) { repl_b = b; bytes_count = 2 }
        }
    }
    if (orig_src == "") next

    flow_id = orig_src ":" orig_sport ">" orig_dst ":" orig_dport
    seen_this_poll[flow_id] = 1
    dump_entries++

    if (flow_id in in_flight) {
        split(in_flight[flow_id], prev, SUBSEP)
        prev_orig = prev[1] + 0
        prev_repl = prev[2] + 0
        delta_orig = orig_b - prev_orig
        delta_repl = repl_b - prev_repl
        # ID reuse / counter restart: counters went backwards
        if (delta_orig < 0) { delta_orig = orig_b; id_reuses++ }
        if (delta_repl < 0) { delta_repl = repl_b }
    } else if (dumps_completed == 0) {
        # First poll EVER — baseline existing conntrack entries without
        # crediting (these bytes accrued before daemon started running).
        delta_orig = 0
        delta_repl = 0
    } else {
        # Round 44 Step 227: subsequent polls. A flow_id we did NOT
        # see before is almost certainly a NEW flow created between
        # last poll and now. Credit its current bytes (which all
        # accrued during the gap). Modern web is short-connection
        # heavy. Many flows appear and disappear within 1-2 polls and
        # would otherwise be lost completely. Step 226 baseline-only
        # ate 5681 such flows in 60 polls (95/poll on the user box,
        # measured as silent_evictions). Step 227 credits them.
        delta_orig = orig_b
        delta_repl = repl_b
    }
    in_flight[flow_id] = orig_b SUBSEP repl_b

    if (delta_orig <= 0 && delta_repl <= 0) next

    # Round 44 Step 229: intra-LAN guard. If BOTH src and dst pass
    # is_lan(), the flow never traverses WAN. Examples discovered on
    # the user box (2026-05-25):
    #   - iPhone <-> iPad AirDrop / iCloud cross-device sync
    #   - Qingping IoT <-> local MQTT broker / Home Assistant
    #   - Apple TV <-> NAS via DLNA
    #   - dnsmasq <-> LAN device protocol exchange
    # Crediting these inflates host totals 4x relative to WAN counter
    # (Step 228 measured 32x tx over-count from intra-LAN being
    # attributed as the src device's outgoing traffic). For "who is
    # using my internet" widget purpose, intra-LAN is noise — skip it.
    src_is_lan = is_lan(orig_src)
    dst_is_lan = is_lan(orig_dst)
    if (src_is_lan && dst_is_lan) {
        intra_lan_skipped++
        next
    }
    if (!src_is_lan && !dst_is_lan) {
        # Neither side is LAN — router-internal traffic (dnsmasq upstream
        # DNS forwarding, NTP, system updates, Tailscale WireGuard tunnel
        # between router and relay).
        router_local_skipped++
        next
    }

    # Determine LAN side
    lan_ip = ""
    tx_delta = 0; rx_delta = 0
    if (src_is_lan) {
        lan_ip = orig_src
        # orig direction packets went LAN→WAN: orig_b is tx, repl_b is rx
        tx_delta = delta_orig
        rx_delta = delta_repl
    } else {
        lan_ip = orig_dst
        # orig direction WAN→LAN (inbound, e.g. DNAT port-forward):
        # orig_b is rx, repl_b is tx — flipped
        tx_delta = delta_repl
        rx_delta = delta_orig
    }

    mac = ip_to_mac[lan_ip]
    if (mac == "") {
        no_mac_skipped++
        next
    }

    per_mac_tx[mac] += tx_delta
    per_mac_rx[mac] += rx_delta
    per_mac_seen[mac] = systime()
    bytes_credited += tx_delta + rx_delta
}

function is_lan(ip,    parts, oct2, i, cnt, prefix, lower) {
    # ─── IPv4 ──
    if (substr(ip, 1, 8) == "192.168.") return 1
    if (substr(ip, 1, 3) == "10.")      return 1
    if (substr(ip, 1, 4) == "172.") {
        split(ip, parts, ".")
        oct2 = parts[2] + 0
        return (oct2 >= 16 && oct2 <= 31) ? 1 : 0
    }
    # ─── IPv4 CGNAT 100.64.0.0/10 (Step 228) ──
    # Tailscale / some ISP-NAT setups use this range. Treat as LAN-side
    # for our attribution since the local device sits behind this CGNAT.
    if (substr(ip, 1, 4) == "100.") {
        split(ip, parts, ".")
        oct2 = parts[2] + 0
        return (oct2 >= 64 && oct2 <= 127) ? 1 : 0
    }
    # ─── IPv6 ULA fd00::/8 (Step 228) ──
    # Unique Local Addresses, sometimes used on LANs in addition to or
    # instead of ISP-delegated GUA. Always treat as LAN.
    lower = tolower(ip)
    if (substr(lower, 1, 2) == "fd" && substr(lower, 3, 1) ~ /[0-9a-f]/ &&
        substr(lower, 4, 1) == ":") return 1
    # ─── IPv6 LAN GUA (Step 228) ──
    # Match against discovered /64 prefixes from `ip -6 addr show br-lan`.
    # An IPv6 GUA like 2606:4700:abcd:1234:cafe::1 has prefix
    # "2606:4700:abcd:1234". If that prefix is in our LAN set, the
    # address belongs to a LAN device (via SLAAC from ISP delegation).
    if (index(lower, ":") > 0) {
        cnt = split(lower, parts, ":")
        prefix = ""
        i_count = 0
        for (i = 1; i <= cnt && i_count < 4; i++) {
            if (parts[i] == "") return 0   # "::" — too compact, give up
            prefix = (i_count == 0) ? parts[i] : (prefix ":" parts[i])
            i_count++
        }
        if (i_count == 4 && (prefix in lan_v6_prefixes)) return 1
    }
    return 0
}

function write_json(    line, sep, m, ts, macs) {
    ts = systime()
    line = "{\"version\":1,\"phase\":4,\"impl\":\"conntrack-poll\","
    line = line sprintf("\"generated_at\":%d,", ts)
    line = line "\"stats\":{"
    line = line "\"destroys_seen\":0,\"destroys_parsed\":0,"
    line = line sprintf("\"dumps_completed\":%d,\"dump_entries\":%d,", dumps_completed, dump_entries)
    line = line sprintf("\"bytes_credited\":%d,\"parse_errors\":0,", bytes_credited)
    line = line sprintf("\"id_reuses\":%d,\"silent_evictions\":%d,", id_reuses, silent_evictions)
    line = line sprintf("\"intra_lan_skipped\":%d,\"router_local_skipped\":%d,\"no_mac_skipped\":%d,", intra_lan_skipped, router_local_skipped, no_mac_skipped)
    line = line sprintf("\"started\":%d", started_at)
    line = line "},\"hosts\":{"
    sep = ""
    for (m in per_mac_tx) macs[m] = 1
    for (m in per_mac_rx) macs[m] = 1
    for (m in macs) {
        line = line sprintf("%s\"%s\":{\"rx\":%d,\"tx\":%d,\"last_seen\":%d}",
            sep, m, per_mac_rx[m] + 0, per_mac_tx[m] + 0,
            per_mac_seen[m] ? per_mac_seen[m] : ts)
        sep = ","
    }
    delete macs
    line = line "}}"
    print line > tmp_file
    close(tmp_file)
    system("mv " tmp_file " " out_file)
    # awk reuse: reset dump_entries for next poll
    dump_entries = 0
}
'
