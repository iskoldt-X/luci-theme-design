#!/bin/sh
#
# design-host-acct.sh — per-host LAN bandwidth accounting daemon
# Round 44 Step 219 — Tier 3 (conntrack-tools based, doc/bandwith.md §5).
#
# WHY THIS IMPL, NOT UCODE NETLINK
# ────────────────────────────────
# Step 210 originally tried ucode + AF_NETLINK to read conntrack events
# directly. On ImmortalWrt 24.10 (luci-26.x), ucode-mod-socket does NOT
# export AF_NETLINK and its internal sockaddr_from_ucv() rejects
# family != INET/INET6/UNIX/PACKET. That path is structurally blocked
# until ucode-mod-socket grows NETLINK support upstream.
#
# Tier 3 (bandwith.md §5) shells out to `conntrack` binary, which is
# proven, well-tested, and has the same data access at the cost of
# +50 KB on disk. Same Hybrid architecture (event stream + periodic
# dump). Output is identical JSON shape — frontend / rpcd / widget
# code unchanged from Steps 210-212.
#
# HYBRID ARCHITECTURE (unchanged from doc/bandwith.md §4)
# ───────────────────
#   A) `conntrack -E -e destroy -o extended` event stream
#      Each finalized flow yields a [DESTROY] line. 100% byte capture
#      for short flows (kernel includes counters in the event before
#      eviction).
#
#   B) `conntrack -L -o extended` periodic dump every 5 s
#      Snapshot of *active* flows so long streams (Twitch session,
#      Netflix) show in-flight bytes without waiting for DESTROY.
#
# Both inputs are fed into one awk process via shell pipe muxing.
# awk keeps:
#   - in_flight[id]   → last-known orig_b + repl_b for active flows
#   - per_mac[mac]_rx → running total downstream bytes per MAC
#   - per_mac[mac]_tx → running total upstream bytes per MAC
#   - ip_to_mac[ip]   → ARP/iwinfo lookup cache (refreshed every 60s)
#
# Output: /tmp/design-host-traffic.json (atomic-rename every 5s)
#
# REQUIRES
# ────────
# - conntrack (from conntrack-tools, +50 KB)
# - net.netfilter.nf_conntrack_acct=1 sysctl (Step 207's bootstrap)
#
# REFERENCES
# ──────────
# doc/bandwith.md §4 — full architecture
# doc/bandwith.md §5 — tier matrix
# doc/bandwith.md §6 — known risks (sysctl, ID reuse)
# memory/luci-26-response-class-hijack.md (parallel quirk family)

set -e

ACCT_OUT="/tmp/design-host-traffic.json"
ACCT_TMP="/tmp/.design-host-traffic.json.new"
STARTED_AT="$(date +%s)"

# Pre-flight: nf_conntrack_acct sysctl must be 1 or all bytes are 0.
ACCT_FLAG="$(sysctl -n net.netfilter.nf_conntrack_acct 2>/dev/null || echo 0)"
if [ "$ACCT_FLAG" != "1" ]; then
    logger -t design-host-acct \
        "WARN: nf_conntrack_acct=$ACCT_FLAG (need 1); all flows will read zero bytes"
fi

# Pre-flight: conntrack binary present?
if ! command -v conntrack >/dev/null 2>&1; then
    logger -t design-host-acct "FATAL: conntrack binary missing (need conntrack-tools)"
    exit 1
fi

logger -t design-host-acct "starting (Tier 3, conntrack-tools)"

# Mux event stream + periodic dump into one awk. Background the event
# stream; foreground loop emits "===DUMP===" sentinel + a dump every
# 5 s. awk distinguishes by line prefix.
#
# Inner subshell catches SIGTERM cleanly so procd's stop signal kills
# the conntrack -E child too (no orphan).
(
    conntrack -E -e destroy -o extended -b 524288 2>/dev/null &
    EV_PID=$!
    trap 'kill $EV_PID 2>/dev/null; exit 0' TERM INT

    # Periodic dump every 5 s. The first iteration also primes the
    # in_flight table so the next dump has deltas to compute against.
    while true; do
        echo "===DUMP_START $(date +%s)==="
        conntrack -L -o extended -f ipv4 2>/dev/null || true
        echo "===DUMP_END==="
        # ARP refresh sentinel — awk re-reads /proc/net/arp from this line.
        echo "===ARP===$(awk 'NR>1 && $3!="0x0" && $4!="00:00:00:00:00:00" \
            {printf "%s=%s|", $1, toupper($4)}' /proc/net/arp)==="
        sleep 5
    done
) | awk -v started_at="$STARTED_AT" -v out_file="$ACCT_OUT" -v tmp_file="$ACCT_TMP" '
    BEGIN {
        # Counter stats — written into output JSON for observability.
        destroys_seen = 0
        destroys_parsed = 0
        dumps_completed = 0
        dump_entries = 0
        bytes_credited = 0
        parse_errors = 0
        id_reuses = 0
        silent_evictions = 0

        # Mode flags — flip based on sentinel lines.
        in_dump = 0
        # CTA_IDs seen in the current dump pass. Cleared at DUMP_START.
        delete seen_this_dump

        # in_flight[id, "orig"] = last orig bytes; in_flight[id, "repl"] = last repl bytes
        # in_flight[id, "src"]  = orig src ip; in_flight[id, "exists"] = 1
        # per_mac[mac, "rx" or "tx"] = running total bytes
        # ip_to_mac[ip] = uppercase MAC string
        # last_arp_refresh = epoch of last refresh
        last_arp_refresh = started_at
    }

    # ─── ARP refresh sentinel ───────────────────────────────────────
    /^===ARP===/ {
        # Strip prefix + suffix to get the IP=MAC|IP=MAC|... payload
        sub(/^===ARP===/, "")
        sub(/===$/, "")
        # Clear and rebuild cache
        for (k in ip_to_mac) delete ip_to_mac[k]
        n = split($0, pairs, "|")
        for (i = 1; i <= n; i++) {
            if (pairs[i] == "") continue
            split(pairs[i], kv, "=")
            if (kv[1] != "" && kv[2] != "") ip_to_mac[kv[1]] = kv[2]
        }
        last_arp_refresh = systime()
        next
    }

    # ─── Dump boundary sentinels ────────────────────────────────────
    /^===DUMP_START / {
        in_dump = 1
        delete seen_this_dump
        next
    }
    /^===DUMP_END===/ {
        # End of dump: anything in in_flight NOT in seen_this_dump was
        # silently evicted (no DESTROY arrived). Drop without crediting.
        for (key in in_flight) {
            # key encodes "id|orig" or "id|repl" or "id|src" etc; want id
            split(key, parts, SUBSEP)
            id_only = parts[1]
            if (!(id_only in seen_this_dump)) {
                # Mark for deletion (cant delete while iterating in all awks).
                drop_ids[id_only] = 1
            }
        }
        for (id_only in drop_ids) {
            delete in_flight[id_only, "orig"]
            delete in_flight[id_only, "repl"]
            delete in_flight[id_only, "src"]
            delete in_flight[id_only, "dst"]
            delete in_flight[id_only, "exists"]
            silent_evictions++
        }
        delete drop_ids
        dumps_completed++
        in_dump = 0
        # End of dump = good moment to flush JSON output.
        flush_json()
        next
    }

    # ─── DESTROY event line ─────────────────────────────────────────
    /\[DESTROY\]/ {
        destroys_seen++
        parse_line($0, snap)
        if (snap["src"] == "" || snap["id"] == "") {
            parse_errors++
            next
        }
        destroys_parsed++
        # Final credit = current - last_known (delta since last sighting).
        prev_orig = (snap["id"] SUBSEP "orig") in in_flight ? in_flight[snap["id"], "orig"] : 0
        prev_repl = (snap["id"] SUBSEP "repl") in in_flight ? in_flight[snap["id"], "repl"] : 0
        orig_inc = snap["orig_b"] - prev_orig
        repl_inc = snap["repl_b"] - prev_repl
        if (orig_inc < 0) orig_inc = snap["orig_b"]
        if (repl_inc < 0) repl_inc = snap["repl_b"]
        if (orig_inc > 0 || repl_inc > 0) credit_inc(snap["src"], snap["dst"], orig_inc, repl_inc)
        # Drop from in_flight
        delete in_flight[snap["id"], "orig"]
        delete in_flight[snap["id"], "repl"]
        delete in_flight[snap["id"], "src"]
        delete in_flight[snap["id"], "dst"]
        delete in_flight[snap["id"], "exists"]
        next
    }

    # ─── Dump entry line (only valid inside a dump section) ─────────
    in_dump && /id=[0-9]+/ {
        parse_line($0, snap)
        if (snap["src"] == "" || snap["id"] == "") next
        dump_entries++
        seen_this_dump[snap["id"]] = 1

        if (!((snap["id"] SUBSEP "exists") in in_flight)) {
            # New flow — record baseline, do not credit.
            in_flight[snap["id"], "orig"] = snap["orig_b"]
            in_flight[snap["id"], "repl"] = snap["repl_b"]
            in_flight[snap["id"], "src"]  = snap["src"]
            in_flight[snap["id"], "dst"]  = snap["dst"]
            in_flight[snap["id"], "exists"] = 1
            next
        }
        # Known flow — compute delta, credit, update last
        prev_orig = in_flight[snap["id"], "orig"]
        prev_repl = in_flight[snap["id"], "repl"]
        # ID reuse detection: counters went backwards
        if (snap["orig_b"] < prev_orig || snap["repl_b"] < prev_repl) {
            id_reuses++
            credit_inc(snap["src"], snap["dst"], snap["orig_b"], snap["repl_b"])
            in_flight[snap["id"], "orig"] = snap["orig_b"]
            in_flight[snap["id"], "repl"] = snap["repl_b"]
            in_flight[snap["id"], "src"]  = snap["src"]
            in_flight[snap["id"], "dst"]  = snap["dst"]
            next
        }
        orig_inc = snap["orig_b"] - prev_orig
        repl_inc = snap["repl_b"] - prev_repl
        if (orig_inc > 0 || repl_inc > 0) {
            credit_inc(snap["src"], snap["dst"], orig_inc, repl_inc)
            in_flight[snap["id"], "orig"] = snap["orig_b"]
            in_flight[snap["id"], "repl"] = snap["repl_b"]
        }
    }

    # ─── Helper: parse one conntrack -o extended line ───────────────
    function parse_line(line, out,    parts, i, f, first_src, first_dst, first_bytes, m) {
        # Initialise output
        out["src"] = ""
        out["dst"] = ""
        out["orig_b"] = 0
        out["repl_b"] = 0
        out["id"] = ""

        # Tokenise on whitespace. Format example:
        # [DESTROY] ipv4 2 tcp 6 src=A dst=B sport=X dport=Y packets=N bytes=M src=B dst=A sport=Y dport=X packets=N2 bytes=M2 [ASSURED] id=Z
        n = split(line, parts, " ")
        first_src = 1
        first_dst = 1
        first_bytes = 1
        for (i = 1; i <= n; i++) {
            f = parts[i]
            if (index(f, "src=") == 1) {
                if (first_src) { out["src"] = substr(f, 5); first_src = 0 }
            } else if (index(f, "dst=") == 1) {
                if (first_dst) { out["dst"] = substr(f, 5); first_dst = 0 }
            } else if (index(f, "bytes=") == 1) {
                if (first_bytes) { out["orig_b"] = substr(f, 7) + 0; first_bytes = 0 }
                else             { out["repl_b"] = substr(f, 7) + 0 }
            } else if (index(f, "id=") == 1) {
                out["id"] = substr(f, 4)
            }
        }
    }

    # ─── Helper: classify LAN side + credit per-MAC bytes ───────────
    function is_lan(ip) {
        if (ip == "") return 0
        if (substr(ip, 1, 8) == "192.168.") return 1
        if (substr(ip, 1, 3) == "10.") return 1
        if (substr(ip, 1, 4) == "172.") {
            split(ip, oc, ".")
            return (oc[2] + 0 >= 16 && oc[2] + 0 <= 31) ? 1 : 0
        }
        return 0
    }

    function credit_inc(orig_src, orig_dst, orig_inc, repl_inc,    lan_ip, mac, tmp) {
        if (is_lan(orig_src)) {
            lan_ip = orig_src
        } else if (is_lan(orig_dst)) {
            lan_ip = orig_dst
            # flow initiated from WAN side — orig is rx, repl is tx; flip.
            tmp = orig_inc; orig_inc = repl_inc; repl_inc = tmp
        } else {
            return
        }
        if (!(lan_ip in ip_to_mac)) return
        mac = ip_to_mac[lan_ip]
        per_mac[mac, "tx"] += orig_inc
        per_mac[mac, "rx"] += repl_inc
        per_mac[mac, "last_seen"] = systime()
        bytes_credited += orig_inc + repl_inc
    }

    # ─── Output ──────────────────────────────────────────────────────
    function flush_json(    line, first, mac_key, macs, seen_macs) {
        line = sprintf("{\"version\":1,\"phase\":2,\"impl\":\"conntrack-tools\",\"generated_at\":%d,\"stats\":{", systime())
        line = line sprintf("\"destroys_seen\":%d,\"destroys_parsed\":%d,", destroys_seen, destroys_parsed)
        line = line sprintf("\"dumps_completed\":%d,\"dump_entries\":%d,", dumps_completed, dump_entries)
        line = line sprintf("\"bytes_credited\":%d,\"parse_errors\":%d,", bytes_credited, parse_errors)
        line = line sprintf("\"id_reuses\":%d,\"silent_evictions\":%d,\"started\":%d", id_reuses, silent_evictions, started_at)
        line = line "},\"hosts\":{"
        first = 1
        # Walk per_mac keys to discover MAC set. SUBSEP-separated, so split.
        for (k in per_mac) {
            split(k, kp, SUBSEP)
            mac_key = kp[1]
            if (mac_key in seen_macs) continue
            seen_macs[mac_key] = 1
            if (!first) line = line ","
            rx = (mac_key SUBSEP "rx") in per_mac ? per_mac[mac_key, "rx"] : 0
            tx = (mac_key SUBSEP "tx") in per_mac ? per_mac[mac_key, "tx"] : 0
            ls = (mac_key SUBSEP "last_seen") in per_mac ? per_mac[mac_key, "last_seen"] : 0
            line = line sprintf("\"%s\":{\"rx\":%d,\"tx\":%d,\"last_seen\":%d}", mac_key, rx, tx, ls)
            first = 0
        }
        delete seen_macs
        line = line "}}"
        # Atomic write: tmp + rename
        print line > tmp_file
        close(tmp_file)
        # Posix mv via system() — no rename() in awk
        system("mv " tmp_file " " out_file)
    }
'
