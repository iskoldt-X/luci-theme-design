#!/usr/bin/env ucode
//
// design-host-acct — per-host LAN bandwidth accounting daemon
// Round 44 Step 210 — Phase 1 (DESTROY listener only).
// Architecture: doc/bandwith.md §4 (Hybrid Tier 2).
//
// PHASE 1 SCOPE
// ─────────────
// Subscribe to AF_NETLINK / NETLINK_NETFILTER multicast group
// NFNLGRP_CONNTRACK_DESTROY. Parse each IPCTNL_MSG_CT_DELETE message
// (binary TLV), extract source IPv4 + final byte counters, look up
// source IP → MAC via /proc/net/arp, accumulate into per-MAC rx/tx
// totals, write /tmp/design-host-traffic.json every ~5s.
//
// What Phase 1 DOES NOT do (deferred to Step 211 / Phase 2):
//   - NFNL_MSG_CT_GET periodic dump for in-flight long streams
//   - IPv6 IP attribute extraction (CTA_IP_V6_SRC/DST)
//   - Multi-LAN auto-discovery (assumes 192.168.0.0/16 + 10.0.0.0/8 + 172.16/12)
//   - CTA_ID reuse race mitigation
//   - Reboot persistence
//
// Phase 1 is intentionally a PARALLEL-RUN OBSERVABILITY DAEMON. The
// widget (traffic.js) continues to read from nlbwmon / old CGI source.
// SSH and `cat /tmp/design-host-traffic.json` to validate the parser.
// Step 212 wires the widget to consume this JSON.
//
// REFERENCES
// ──────────
// linux/netfilter/nfnetlink_conntrack.h — CTA_* constants
// linux/netfilter/nfnetlink.h — NFNL_SUBSYS_CTNETLINK, NFNLGRP_*
// doc/bandwith.md §4 — full architecture
// doc/bandwith.md §6 — known risks (sysctl, parser, ID reuse)

'use strict';

import { create as socket, AF_NETLINK, SOCK_RAW } from 'socket';
import { unpack } from 'struct';
import { writefile, readfile, rename } from 'fs';
import * as uloop from 'uloop';

// ─── Netlink constants ────────────────────────────────────────────────
const NETLINK_NETFILTER          = 12;
const NFNLGRP_CONNTRACK_DESTROY  = 3;
const NLM_F_REQUEST              = 1;

// Conntrack subsystem in nfnetlink header
const NFNL_SUBSYS_CTNETLINK      = 1;
const IPCTNL_MSG_CT_DELETE       = 2;

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
let stats = {
    destroys_seen:   0,
    destroys_parsed: 0,
    bytes_credited:  0,
    parse_errors:    0,
    started:         time(),
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

// Credit a destroyed flow's bytes to the per-MAC tally. orig direction
// = LAN→WAN (upload); reply direction = WAN→LAN (download). We
// determine which by checking which side of the tuple looks like LAN.
function credit_flow(orig_src, orig_dst, orig_bytes, repl_bytes) {
    let lan_ip = null;
    let direction = null;  // 'tx' for upload, 'rx' for download
    if (is_lan_ip(orig_src)) {
        lan_ip = orig_src;
        // orig packets went LAN→WAN: bytes counted in orig direction are tx
        // reply packets came WAN→LAN: bytes counted in reply direction are rx
    } else if (is_lan_ip(orig_dst)) {
        lan_ip = orig_dst;
        // orig packets went WAN→LAN: orig bytes are rx
        // reply packets went LAN→WAN: reply bytes are tx
        // (flipped — flow was initiated FROM the WAN side, e.g. inbound DNAT)
        let tmp = orig_bytes; orig_bytes = repl_bytes; repl_bytes = tmp;
    } else {
        // Neither side is LAN — router-internal traffic (e.g. dnsmasq
        // upstream queries). Skip.
        return;
    }

    let mac = ip_to_mac[lan_ip];
    if (!mac) return;  // No ARP entry → drop. Phase 2 may add ipv6_neigh fallback.

    if (!per_mac_totals[mac]) {
        per_mac_totals[mac] = { rx: 0, tx: 0, last_seen: 0 };
    }
    per_mac_totals[mac].tx += orig_bytes;
    per_mac_totals[mac].rx += repl_bytes;
    per_mac_totals[mac].last_seen = time();
    stats.bytes_credited += orig_bytes + repl_bytes;
}

// Top-level dispatch for a single netlink DESTROY message. buf is the
// full message starting at the nlmsghdr; len is the message length.
// Returns true if the message was parsed and credited (or correctly
// skipped), false on parse error.
function handle_destroy(buf, msg_start, msg_end) {
    // Skip nlmsghdr (16 bytes) + nfgenmsg (4 bytes) = 20 bytes
    let attrs_start = msg_start + 20;
    if (attrs_start > msg_end) return false;

    let attrs = parse_attrs(buf, attrs_start, msg_end);

    let orig_tuple = null, repl_tuple = null;
    let orig_bytes = 0, repl_bytes = 0;

    if (CTA_TUPLE_ORIG in attrs) {
        let r = attrs[CTA_TUPLE_ORIG];
        orig_tuple = parse_tuple(buf, r.start, r.end);
    }
    if (CTA_TUPLE_REPLY in attrs) {
        let r = attrs[CTA_TUPLE_REPLY];
        repl_tuple = parse_tuple(buf, r.start, r.end);
    }
    if (CTA_COUNTERS_ORIG in attrs) {
        let r = attrs[CTA_COUNTERS_ORIG];
        orig_bytes = parse_counter(buf, r.start, r.end);
    }
    if (CTA_COUNTERS_REPLY in attrs) {
        let r = attrs[CTA_COUNTERS_REPLY];
        repl_bytes = parse_counter(buf, r.start, r.end);
    }

    if (!orig_tuple) return false;
    if (!orig_bytes && !repl_bytes) return true;  // zero-byte flow, harmless skip

    credit_flow(orig_tuple.src, orig_tuple.dst, orig_bytes, repl_bytes);
    return true;
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

    stats.destroys_seen++;

    // Walk nlmsghdr-prefixed messages in the buffer.
    let len = length(pkt);
    let off = 0;
    while (off + 16 <= len) {
        // nlmsghdr: u32 nlmsg_len, u16 nlmsg_type, u16 nlmsg_flags,
        //          u32 nlmsg_seq, u32 nlmsg_pid
        let nlmsg_len  = unpack('<I', pkt, off)[0];
        let nlmsg_type = unpack('<H', pkt, off + 4)[0];
        if (nlmsg_len < 16) break;

        // nfnetlink type = (subsys << 8) | msg_type
        let nfnl_subsys = (nlmsg_type >> 8) & 0xff;
        let nfnl_msg    = nlmsg_type & 0xff;

        if (nfnl_subsys == NFNL_SUBSYS_CTNETLINK && nfnl_msg == IPCTNL_MSG_CT_DELETE) {
            if (handle_destroy(pkt, off, off + nlmsg_len)) {
                stats.destroys_parsed++;
            } else {
                stats.parse_errors++;
            }
        }
        off = (off + nlmsg_len + 3) & ~3;
    }
}, uloop.ULOOP_READ);

uloop.timer(60000, function () {
    refresh_arp_cache();
    this.set(60000);
});

uloop.timer(5000, function () {
    flush_json();
    this.set(5000);
});

// Initial JSON write so consumers see a fresh file immediately
flush_json();

uloop.run();
