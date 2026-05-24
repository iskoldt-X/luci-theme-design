#!/usr/bin/env ucode
//
// design-host-acct — per-host LAN bandwidth accounting daemon
// Round 44 Step 210 — Phase 1 (DESTROY listener only).
// Architecture: doc/bandwith.md §4 (Hybrid Tier 2).
//
// PHASE 1 + 2 SCOPE (Round 44 Step 210 added DESTROY, Step 211 added CT_GET)
// ──────────────────
// Two parallel inputs feed a unified per-MAC totals table:
//
//   A) DESTROY event stream (multicast group NFNLGRP_CONNTRACK_DESTROY)
//      Real-time stream of finalized flow byte counts. Captures 100%
//      of short flows because the kernel includes counters in the
//      DELETE message before evicting from the hash table.
//
//   B) CT_GET periodic dump (every 5s, NFNL_MSG_CT_GET on same socket)
//      Snapshot of *active* flows. Necessary because a 4-hour Twitch
//      session never emits DESTROY during viewing — DESTROY-only would
//      show 0 bytes for 4 hours then jump to 5.2 GB at stream close.
//
// Both inputs are parsed by the same TLV walker. CTA_ID is the primary
// key used to reconcile (compute deltas safely across reuses, drop
// silently-evicted entries).
//
// Reconciliation rules (doc/bandwith.md §4 table):
//   DESTROY for X → add (final − last_known) to per_mac_totals; drop X
//                   from in_flight_table.
//   CT_GET shows X new → record in in_flight_table at current.
//   CT_GET shows X seen → add (current − last) to totals, update last.
//   CT_GET shows X with bytes < last_known → CTA_ID reuse race, reset
//                   X's last to 0 and re-credit from current (Step 211
//                   risk mitigation per doc/bandwith.md §6 #3).
//   in_flight has X but X missing from latest dump → silent eviction
//                   (rmmod, hash purge); drop without crediting.
//
// What Phase 1+2 STILL does not do (deferred):
//   - IPv6 IP attribute extraction (CTA_IP_V6_SRC/DST) — Phase 3 if needed
//   - Multi-LAN auto-discovery (Phase 1 heuristic: RFC 1918 ranges)
//   - Reboot persistence — out of scope (user opt-in if ever needed)
//
// Phase 1+2 is intentionally a PARALLEL-RUN OBSERVABILITY DAEMON. The
// widget (traffic.js) continues to read from nlbwmon / old CGI source.
// SSH and `cat /tmp/design-host-traffic.json` to validate the parser
// AND reconciliation logic. Step 212 wires the widget to consume this JSON.
//
// REFERENCES
// ──────────
// linux/netfilter/nfnetlink_conntrack.h — CTA_* constants
// linux/netfilter/nfnetlink.h — NFNL_SUBSYS_CTNETLINK, NFNLGRP_*
// doc/bandwith.md §4 — full architecture
// doc/bandwith.md §6 — known risks (sysctl, parser, ID reuse)

'use strict';

import { create as socket, AF_NETLINK, SOCK_RAW } from 'socket';
import { unpack, pack } from 'struct';
import { writefile, readfile, rename } from 'fs';
import * as uloop from 'uloop';

// ─── Netlink constants ────────────────────────────────────────────────
const NETLINK_NETFILTER          = 12;
const NFNLGRP_CONNTRACK_DESTROY  = 3;
const NLM_F_REQUEST              = 1;

// Conntrack subsystem in nfnetlink header
const NFNL_SUBSYS_CTNETLINK      = 1;
const IPCTNL_MSG_CT_NEW          = 0;
const IPCTNL_MSG_CT_GET          = 1;
const IPCTNL_MSG_CT_DELETE       = 2;

// Standard netlink message types
const NLMSG_DONE                 = 3;
const NLMSG_ERROR                = 2;

// Flags for the CT_GET dump request
const NLM_F_REQUEST_DUMP         = (1 | 0x100 | 0x200);  // REQUEST | ROOT | MATCH

// CTA_* top-level attribute types
const CTA_TUPLE_ORIG     = 1;
const CTA_TUPLE_REPLY    = 2;
const CTA_COUNTERS_ORIG  = 9;
const CTA_COUNTERS_REPLY = 10;
const CTA_ID             = 12;

// Nested under CTA_TUPLE_ORIG/REPLY
const CTA_TUPLE_IP       = 1;

// Nested under CTA_TUPLE_IP
const CTA_IP_V4_SRC      = 1;
const CTA_IP_V4_DST      = 2;

// Nested under CTA_COUNTERS_*
const CTA_COUNTERS_BYTES = 2;

// Netlink attribute header flags (top 2 bits of nla_type)
const NLA_F_NESTED       = 0x8000;
const NLA_TYPE_MASK      = 0x3fff;

// ─── Daemon state ─────────────────────────────────────────────────────
let per_mac_totals = {};   // mac → { rx: bytes, tx: bytes, last_seen: epoch }
let ip_to_mac      = {};   // dotted-quad IP → uppercase MAC

// Step 211: in-flight table — keyed by CTA_ID (32-bit unique per active
// conntrack entry). Maps id → { orig_b, repl_b, src, dst } so we can
// compute deltas across CT_GET dumps and apply ID-reuse mitigation
// (doc/bandwith.md §6 risk #3).
let in_flight = {};
// Dump-pass tracking: set of CTA_IDs seen in the CURRENT dump pass.
// At end-of-dump (NLMSG_DONE), any CTA_ID in in_flight NOT in seen_this_dump
// got silently evicted by the kernel — drop without crediting.
let seen_this_dump = {};
let dump_seq = 100;        // unicast seq base — bumped per dump request

let stats = {
    destroys_seen:    0,
    destroys_parsed:  0,
    dumps_completed:  0,
    dump_entries:     0,
    bytes_credited:   0,
    parse_errors:     0,
    id_reuses:        0,
    silent_evictions: 0,
    started:          time(),
};

// ─── Helpers ─────────────────────────────────────────────────────────

// Parse a packed Uint8Array-equivalent buffer at [offset..end) as a
// sequence of netlink TLV attributes. Returns object keyed by attribute
// type (with NLA flag bits stripped) whose values are { start, end }
// byte ranges into the original buffer for the payload.
function parse_attrs(buf, offset, end) {
    let out = {};
    while (offset + 4 <= end) {
        // nla_len + nla_type are host-byte-order uint16 each
        let nla_len  = unpack('<H', buf, offset)[0];
        let nla_type = unpack('<H', buf, offset + 2)[0] & NLA_TYPE_MASK;
        if (nla_len < 4) break;
        out[nla_type] = { start: offset + 4, end: offset + nla_len };
        // Attribute payloads are 4-byte aligned
        offset = (offset + nla_len + 3) & ~3;
    }
    return out;
}

// Parse CTA_TUPLE_* payload (which is a nested attr containing CTA_TUPLE_IP
// which is another nested attr containing CTA_IP_V4_SRC/DST). Returns
// { src: "a.b.c.d" | null, dst: "a.b.c.d" | null }.
function parse_tuple(buf, start, end) {
    let result = { src: null, dst: null };
    let tuple_attrs = parse_attrs(buf, start, end);
    if (!(CTA_TUPLE_IP in tuple_attrs)) return result;
    let ip_attrs = parse_attrs(buf,
                               tuple_attrs[CTA_TUPLE_IP].start,
                               tuple_attrs[CTA_TUPLE_IP].end);
    if (CTA_IP_V4_SRC in ip_attrs) {
        let r = ip_attrs[CTA_IP_V4_SRC];
        let b = unpack('BBBB', buf, r.start);
        result.src = sprintf('%d.%d.%d.%d', b[0], b[1], b[2], b[3]);
    }
    if (CTA_IP_V4_DST in ip_attrs) {
        let r = ip_attrs[CTA_IP_V4_DST];
        let b = unpack('BBBB', buf, r.start);
        result.dst = sprintf('%d.%d.%d.%d', b[0], b[1], b[2], b[3]);
    }
    return result;
}

// Parse CTA_COUNTERS_* payload (nested with CTA_COUNTERS_BYTES being a
// 64-bit big-endian unsigned). Returns bytes as a JS number; values
// over 2^53 are theoretically lossy but in practice no single flow
// transfers 9 PB.
function parse_counter(buf, start, end) {
    let attrs = parse_attrs(buf, start, end);
    if (!(CTA_COUNTERS_BYTES in attrs)) return 0;
    let r = attrs[CTA_COUNTERS_BYTES];
    // 64-bit big-endian: 4 byte hi, 4 byte lo
    let hi = unpack('>I', buf, r.start)[0];
    let lo = unpack('>I', buf, r.start + 4)[0];
    return hi * 4294967296 + lo;
}

// Refresh ip_to_mac from /proc/net/arp every 60s. ARP cache is the
// authoritative source for "which IPv4 lives behind which MAC right
// now" for any host the router has spoken to recently.
function refresh_arp_cache() {
    let text = readfile('/proc/net/arp');
    if (!text) return;
    let fresh = {};
    let lines = split(text, '\n');
    // Skip header row
    for (let i = 1; i < length(lines); i++) {
        // Fields: IP HW-type Flags HW-address Mask Device
        let f = split(lines[i], /\s+/);
        if (length(f) < 4) continue;
        let ip  = f[0];
        let mac = uc(f[3]);
        // Skip incomplete entries (mac == 00:00:00:00:00:00)
        if (mac == '00:00:00:00:00:00' || mac == '') continue;
        fresh[ip] = mac;
    }
    ip_to_mac = fresh;
}

// Decide which IP in the conntrack tuple is the LAN side. Phase 1
// heuristic: anything in RFC 1918 private ranges. Phase 2+ replaces
// with proper /etc/config/network bridge interface scan.
function is_lan_ip(ip) {
    if (!ip) return false;
    if (substr(ip, 0, 8) == '192.168.') return true;
    if (substr(ip, 0, 3) == '10.')      return true;
    // 172.16.0.0/12 — check second octet 16..31
    if (substr(ip, 0, 4) == '172.') {
        let parts = split(ip, '.');
        let oct2 = +parts[1];
        if (oct2 >= 16 && oct2 <= 31) return true;
    }
    return false;
}

// Credit an INCREMENT of bytes to the per-MAC tally. Step 211 splits
// the old "credit_flow" into two stages: increment computation (here)
// and direction assignment. orig_inc / repl_inc are DELTAS (current −
// last_known for the same flow), not absolute counters.
function credit_inc(orig_src, orig_dst, orig_inc, repl_inc) {
    let lan_ip = null;
    if (is_lan_ip(orig_src)) {
        lan_ip = orig_src;
        // orig direction packets went LAN→WAN: orig_inc is tx, repl_inc is rx
    } else if (is_lan_ip(orig_dst)) {
        lan_ip = orig_dst;
        // flow was initiated from WAN side (inbound DNAT, port-forward, etc).
        // orig direction is WAN→LAN: orig_inc is rx, repl_inc is tx — flip.
        let tmp = orig_inc; orig_inc = repl_inc; repl_inc = tmp;
    } else {
        // Neither side is LAN — router-internal traffic (e.g. dnsmasq
        // upstream queries). Skip.
        return;
    }

    let mac = ip_to_mac[lan_ip];
    if (!mac) return;  // No ARP entry → drop. Phase 3 may add ipv6_neigh.

    if (!per_mac_totals[mac]) {
        per_mac_totals[mac] = { rx: 0, tx: 0, last_seen: 0 };
    }
    per_mac_totals[mac].tx += orig_inc;
    per_mac_totals[mac].rx += repl_inc;
    per_mac_totals[mac].last_seen = time();
    stats.bytes_credited += orig_inc + repl_inc;
}

// Generic conntrack message parser — extracts attrs needed for both
// DESTROY events and CT_GET dump responses. Returns a snapshot object
// or null on parse failure.
function parse_ct_message(buf, msg_start, msg_end) {
    // Skip nlmsghdr (16 bytes) + nfgenmsg (4 bytes) = 20 bytes
    let attrs_start = msg_start + 20;
    if (attrs_start > msg_end) return null;

    let attrs = parse_attrs(buf, attrs_start, msg_end);

    let snap = { id: null, src: null, dst: null, orig_b: 0, repl_b: 0 };

    if (CTA_TUPLE_ORIG in attrs) {
        let r = attrs[CTA_TUPLE_ORIG];
        let t = parse_tuple(buf, r.start, r.end);
        snap.src = t.src;
        snap.dst = t.dst;
    }
    if (CTA_COUNTERS_ORIG in attrs) {
        let r = attrs[CTA_COUNTERS_ORIG];
        snap.orig_b = parse_counter(buf, r.start, r.end);
    }
    if (CTA_COUNTERS_REPLY in attrs) {
        let r = attrs[CTA_COUNTERS_REPLY];
        snap.repl_b = parse_counter(buf, r.start, r.end);
    }
    if (CTA_ID in attrs) {
        let r = attrs[CTA_ID];
        // CTA_ID payload is a 32-bit big-endian unsigned
        snap.id = unpack('>I', buf, r.start)[0];
    }
    return snap;
}

// Apply a DESTROY event. Final-credit (current − last_known) from
// in_flight_table for this id, then drop the entry.
function handle_destroy(buf, msg_start, msg_end) {
    let snap = parse_ct_message(buf, msg_start, msg_end);
    if (!snap || !snap.src) return false;

    let prev = snap.id != null ? in_flight[snap.id] : null;
    let orig_inc = snap.orig_b - (prev ? prev.orig_b : 0);
    let repl_inc = snap.repl_b - (prev ? prev.repl_b : 0);
    // Negative delta = ID reuse where we observed mid-life; treat as
    // counter restart from 0.
    if (orig_inc < 0) orig_inc = snap.orig_b;
    if (repl_inc < 0) repl_inc = snap.repl_b;

    if (orig_inc > 0 || repl_inc > 0) {
        credit_inc(snap.src, snap.dst, orig_inc, repl_inc);
    }
    if (snap.id != null) delete in_flight[snap.id];
    return true;
}

// Apply a CT_GET dump-response entry. If id is new → record. If seen
// → add delta to totals, update last. If counters went backwards (ID
// reuse), treat as new entry starting at 0.
function handle_dump_entry(buf, msg_start, msg_end) {
    let snap = parse_ct_message(buf, msg_start, msg_end);
    if (!snap || !snap.src || snap.id == null) return false;

    seen_this_dump[snap.id] = true;
    stats.dump_entries++;

    let prev = in_flight[snap.id];
    if (!prev) {
        // First sighting — record current counter as baseline. Don't
        // credit yet (we don't know what the user already counted via
        // an earlier sighting; conservative).
        in_flight[snap.id] = {
            orig_b: snap.orig_b, repl_b: snap.repl_b,
            src: snap.src, dst: snap.dst
        };
        return true;
    }
    // ID reuse detection (doc/bandwith.md §6 risk #3): counters
    // decreased → kernel evicted this id and reassigned to a new flow
    // before we noticed. Reset baseline + credit current as new bytes.
    if (snap.orig_b < prev.orig_b || snap.repl_b < prev.repl_b) {
        stats.id_reuses++;
        credit_inc(snap.src, snap.dst, snap.orig_b, snap.repl_b);
        prev.orig_b = snap.orig_b;
        prev.repl_b = snap.repl_b;
        prev.src = snap.src;
        prev.dst = snap.dst;
        return true;
    }
    // Normal delta credit.
    let orig_inc = snap.orig_b - prev.orig_b;
    let repl_inc = snap.repl_b - prev.repl_b;
    if (orig_inc > 0 || repl_inc > 0) {
        credit_inc(snap.src, snap.dst, orig_inc, repl_inc);
        prev.orig_b = snap.orig_b;
        prev.repl_b = snap.repl_b;
    }
    return true;
}

// End-of-dump handler: any CTA_IDs in in_flight that we did NOT see
// in this dump pass were silently evicted by the kernel (no DESTROY
// arrived — rare but possible per rmmod nf_conntrack or hash purge).
// Drop them without crediting; the bytes are unknowable.
function finalize_dump() {
    let dropped = 0;
    for (let id in in_flight) {
        if (!(id in seen_this_dump)) {
            delete in_flight[id];
            dropped++;
        }
    }
    stats.silent_evictions += dropped;
    stats.dumps_completed++;
    seen_this_dump = {};
}

// Compose + send a CT_GET dump request on the netlink socket. We use
// IPCTNL_MSG_CT_GET (subsys 1, msg 1) with NLM_F_REQUEST_DUMP flags.
// Family AF_UNSPEC (0) → dump both IPv4 + IPv6 conntrack entries.
function send_dump_request(sock) {
    dump_seq++;
    let nlmsg_type  = (NFNL_SUBSYS_CTNETLINK << 8) | IPCTNL_MSG_CT_GET;
    let nlmsg_len   = 20;  // 16 nlmsghdr + 4 nfgenmsg, no attrs
    let pid         = 0;   // 0 = kernel uses our bound pid
    // nlmsghdr: u32 len, u16 type, u16 flags, u32 seq, u32 pid
    // nfgenmsg: u8 family, u8 version, u16 res_id
    let hdr = pack('<IHHIIBBH',
        nlmsg_len, nlmsg_type, NLM_F_REQUEST_DUMP, dump_seq, pid,
        0,   // AF_UNSPEC — both IPv4 and IPv6
        0,   // version
        0);  // res_id
    sock.send(hdr);
}

// Write current per-MAC totals + stats to /tmp/design-host-traffic.json
// via atomic rename (write to .tmp then rename so readers never see
// partial state).
function flush_json() {
    let payload = {
        version: 1,
        phase: 1,
        generated_at: time(),
        stats: stats,
        hosts: per_mac_totals
    };
    writefile('/tmp/.design-host-traffic.json.new',
              sprintf('%J', payload));
    rename('/tmp/.design-host-traffic.json.new',
           '/tmp/design-host-traffic.json');
}

// ─── Main entry ───────────────────────────────────────────────────────

// 1. Open AF_NETLINK / NETLINK_NETFILTER socket and bind to the
//    DESTROY multicast group. nl_groups bind mask is a bitmask of
//    (group - 1); group 3 → bit 2 → value 4.
let nlsock = socket(AF_NETLINK, SOCK_RAW, NETLINK_NETFILTER);
if (!nlsock) {
    warn('design-host-acct: socket() failed\n');
    exit(1);
}
let bind_mask = 1 << (NFNLGRP_CONNTRACK_DESTROY - 1);  // 4
if (!nlsock.bind({ family: AF_NETLINK, groups: bind_mask })) {
    warn('design-host-acct: bind() failed\n');
    exit(1);
}

// 2. Prime the ARP cache before any flow events arrive.
refresh_arp_cache();

// 3. Event loop:
//    - Netlink socket readable → drain all queued DESTROY messages
//    - 60s timer → refresh ARP cache
//    - 5s timer → flush JSON
uloop.init();

uloop.handle(nlsock, function (events) {
    // socket.recv() returns null on no-data (jow-/ucode#332 spurious nulls
    // documented in doc/bandwith.md §6 risk #2 — treat as keep-polling).
    let pkt = nlsock.recv();
    if (!pkt) return;

    // Walk nlmsghdr-prefixed messages in the buffer.
    let len = length(pkt);
    let off = 0;
    while (off + 16 <= len) {
        // nlmsghdr: u32 nlmsg_len, u16 nlmsg_type, u16 nlmsg_flags,
        //          u32 nlmsg_seq, u32 nlmsg_pid
        let nlmsg_len  = unpack('<I', pkt, off)[0];
        let nlmsg_type = unpack('<H', pkt, off + 4)[0];
        if (nlmsg_len < 16) break;

        // Standard netlink: NLMSG_DONE marks end of a CT_GET dump pass.
        if (nlmsg_type == NLMSG_DONE) {
            finalize_dump();
            off = (off + nlmsg_len + 3) & ~3;
            continue;
        }
        if (nlmsg_type == NLMSG_ERROR) {
            stats.parse_errors++;
            off = (off + nlmsg_len + 3) & ~3;
            continue;
        }

        // nfnetlink type = (subsys << 8) | msg_type
        let nfnl_subsys = (nlmsg_type >> 8) & 0xff;
        let nfnl_msg    = nlmsg_type & 0xff;

        if (nfnl_subsys == NFNL_SUBSYS_CTNETLINK) {
            if (nfnl_msg == IPCTNL_MSG_CT_DELETE) {
                stats.destroys_seen++;
                if (handle_destroy(pkt, off, off + nlmsg_len)) {
                    stats.destroys_parsed++;
                } else {
                    stats.parse_errors++;
                }
            } else if (nfnl_msg == IPCTNL_MSG_CT_NEW) {
                // From the kernel during a CT_GET dump (also fired as
                // multicast on flow creation if we were bound to the
                // NEW group — we're not, so it's dump responses only).
                if (!handle_dump_entry(pkt, off, off + nlmsg_len)) {
                    stats.parse_errors++;
                }
            }
        }
        off = (off + nlmsg_len + 3) & ~3;
    }
}, uloop.ULOOP_READ);

uloop.timer(60000, function () {
    refresh_arp_cache();
    this.set(60000);
});

// CT_GET dump every 5s. Phase 2 cadence per doc/bandwith.md §4. The
// kernel responds with a stream of IPCTNL_MSG_CT_NEW messages followed
// by NLMSG_DONE; the socket-readable handler above parses all of them
// and finalize_dump() is called at end-of-pass to drop silently-evicted
// in_flight entries.
uloop.timer(5000, function () {
    send_dump_request(nlsock);
    this.set(5000);
});

uloop.timer(5000, function () {
    flush_json();
    this.set(5000);
});

// Initial JSON write so consumers see a fresh file immediately
flush_json();
// Trigger an immediate first dump to populate in_flight before
// regular cadence kicks in.
send_dump_request(nlsock);

uloop.run();
