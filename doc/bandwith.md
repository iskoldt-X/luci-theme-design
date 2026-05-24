# Per-host Bandwidth Accounting — Discovery & Architecture Options

> **Status**: research / discovery only. **NO CODE CHANGES** in this round.
> **Created**: 2026-05-24, end of Round 43.
> **Purpose**: capture everything we've learned about per-host bandwidth
> accounting on ImmortalWrt 24.10 / MT7986 with HW flow offload, so a
> future Round (44+) can make an informed implementation decision
> without re-doing the research.

---

## TL;DR

- **Round 31 (currently shipped)** is structurally broken on the SSR-AX6000.
  `nftables bridge`-family hooks live *above* the MT7986 NPU's fastpath,
  so once a flow gets accelerated into hardware our counters never see it.
  On QEMU x86_64 (no HW offload) it appeared to work; on the real router
  it silently misses most LAN-side traffic.
- **The kernel already has the right primitive.** Both software flow
  offload (`nf_flow_table`) and MT7986 hardware flow offload (`mtk_ppe`)
  periodically sync per-flow byte counters back into the standard
  `nf_conntrack` table. That sync is the load-bearing piece — once
  accepted, the only question is "how do we read it".
- **Polling `/proc/net/nf_conntrack` is the wrong way to read it**,
  for two independent reasons: short connections (DNS, small HTTP GETs)
  get evicted between polls so 5-15% of traffic volume is lost; and
  parsing thousands of lines of text every second burns 20-40% of one
  CPU core on the MT7986.
- **The right way is event-driven.** Subscribe to the kernel's
  `NFNLGRP_CONNTRACK_DESTROY` multicast over `AF_NETLINK`. Every time
  a flow finalizes, the kernel emits one binary message containing the
  final byte counts. Zero text parsing, zero polling.
- **But DESTROY events alone are not enough.** A 4-hour Twitch stream
  never DESTROYs during the user's session, so the widget would show
  0 bytes for the streaming device until the stream ends, then jump
  5 GB. We additionally need a 5-second snapshot of *active* flows.
- **Without adding any packages**, this is achievable at ~95-99%
  accuracy via a ~400-line ucode daemon. **With one tiny new package
  (`conntrack-tools`, ~50 KB)** the same architecture shrinks to
  ~80 lines of shell + awk. **With `nlbwmon` (~200 KB)** someone has
  already solved it, but it's a separate LuCI app and we'd be giving
  up theme ownership of the widget.

---

## 1. Background — what Round 31 shipped and why it failed

Round 31 (Steps 115-119, 2026 early) shipped:

- `nftables bridge` family table `design_acct` with `lan_in`
  (prerouting) + `lan_out` (postrouting) chains.
- Per-host counters `host_tx_<ip>` / `host_rx_<ip>` keyed by IP.
- `/etc/init.d/design-host-acct` service creating one counter pair
  per `/tmp/dhcp.leases` entry, refreshed by 5-min cron.
- `/cgi-bin/design/host-traffic` reads `nft` output → JSON.
- `traffic.js` polls every 5 seconds.

We chose bridge family because `inet/forward` is bypassed by software
flow offload, and L2 hooks looked universal and offload-immune.

### What we actually missed

The MT7986 NPU operates *below* the software bridge code path. When
a flow is accelerated:
1. NPU receives the L2 frame in silicon.
2. NPU executes the routing decision and NAT translation directly in
   the packet processing engine, **without invoking any kernel hook**.
3. NPU rewrites Ethernet headers and transmits to the destination
   switch port.

The software L2 bridge is never called for that flow. Our counters
never increment. Worst part: on QEMU x86_64 (development environment),
there is no NPU, so all packets traverse the software bridge code and
everything appeared to work. The bug only manifests on real hardware.

### Other defects identified in retrospect

| # | Defect | Impact |
|---|---|---|
| 1 | IP-keyed identity | DHCP renewal breaks continuity for the same physical device |
| 2 | IPv4 only | IPv6 traffic completely uncounted |
| 3 | Lease-driven counter creation | Static IPs, pre-DHCP Wi-Fi clients, long-lived leases miss the creation window |
| 4 | 5-minute cron refresh | New devices invisible for up to 5 minutes |
| 5 | No reboot persistence | Counter state vanishes on every reboot |
| 6 | Rule-per-IP doesn't scale | 50 hosts → 100 rules + 100 counter objects |
| 7 | **Bypassed by HW offload (CRITICAL)** | Almost-zero bytes counted on the real router |

User assessment: "一坨垃圾,不可用状态" — accurate.

---

## 2. The fundamental kernel reality (settled by external research)

We commissioned a deep-research report from an external AI agent
(`doc/OpenWrtFlowOffloadAccounting Challenge.md`). After cross-checking
its kernel-source citations against the actual upstream Linux tree,
these are the findings I trust:

### Kernel guarantees (no work required from us)

1. **MTK PPE → nf_conntrack counter sync exists and is reliable on
   kernel 5.15+.** `mtk_flow_offload_stats()` in
   `drivers/net/ethernet/mediatek/mtk_ppe_offload.c` reads NPU MIB
   registers and updates the software flowtable entry.
   `flow_offload_work_stats()` in `net/netfilter/nf_flow_table_offload.c`
   then aggregates these and calls `nf_ct_acct_add()` on the underlying
   conntrack entry. Gated by the `NF_FLOWTABLE_COUNTER` flag, which
   `fw4` sets by default in OpenWrt 23.05+ / ImmortalWrt 24.10.
2. **Counter sync is timer-driven, sub-second to a few seconds.**
   The flowtable garbage collector wakes periodically and pulls
   hardware stats. On ARM/AArch64 OpenWrt builds, HZ is 250 or 100.
   For a 5-second-refresh widget, the lag is invisible.
3. **L2-vs-L3 framing fixes landed in 6.x and were backported.**
   Daniel Golle's `flow_offload_encap_netstats()` subtracts VLAN /
   PPPoE overhead so reported bytes reflect L3 payload sizes correctly.
   ImmortalWrt 24.10 carries these.

### One mandatory configuration step we own

`net.netfilter.nf_conntrack_acct=1` is **OFF by default at runtime**,
even though `CONFIG_NF_CONNTRACK_ACCT=y` is compiled into the kernel.
The per-namespace sysctl defaults to 0 to save CPU on routers that
don't want accounting, **and the flag is only attached to NEW
connections** — flipping the sysctl mid-flight does not retroactively
start counting existing flows.

This means our deployment MUST:
- Ship `/etc/sysctl.d/11-design-conntrack-acct.conf` setting the sysctl
  to 1.
- Apply it via `sysctl -p` in `uci-defaults` (or equivalent) before the
  WAN comes up on first install.

If we forget this, **every accounting architecture reads zero bytes**
regardless of how clever the daemon is.

**Memory record**: this gotcha is being filed as
`[[netlink-conntrack-acct-sysctl-default-off]]`.

---

## 3. Why polling `/proc/net/nf_conntrack` is the wrong primitive

Two independent failure modes:

### Failure A: short-flow data loss

A typical HTTP/1.1 GET for a 50 KB asset is:

| Phase | Packets | Wall time |
|---|---|---|
| TCP handshake | 3 | ~10 ms |
| Payload | ~12 | ~80 ms |
| TCP FIN/ACK teardown | 2 | ~10 ms |
| **Total** | ~17 | **~100-150 ms** |

If the daemon polls every 2 seconds, a short flow opening, completing,
and getting evicted **between** two reads happens with probability
~92%. Its bytes never appear in `/proc/net/nf_conntrack` during any
read window. Gone.

Residential traffic profile (industry numbers):

| Category | Share of total **volume** | Share of total **flows** |
|---|---|---|
| Long-lived (streaming, large downloads, WebSockets) | 60-70% | 20-30% |
| Short-lived (DNS, NTP, small HTTP, TLS handshakes) | 30-40% | 70-80% |

Net: 5-15% drift below reality, worse for users whose mix is
"browse many small things" vs "stream a few big things".

### Failure B: CPU + lock contention

`/proc/net/nf_conntrack` is generated dynamically by the kernel via
`seq_printf` over the entire conntrack hash table. Producing the file
requires:
- RCU read locks on every hash bucket
- Stringifying thousands of connection tuples
- Formatting byte counters, timeouts, helpers, labels, marks

Reading it then requires the daemon to parse ~500 KB of text, split
lines, tokenize, build objects, GC. On a 1.3 GHz ARM core (MT7986),
external estimate is 20-40% of one core consumed by a 1-second poll
loop. Even at 5-second cadence, this is wasteful when a structured
binary alternative exists on the same kernel.

---

## 4. The right architecture — event-driven + periodic snapshot

### The DESTROY event stream

The kernel emits an `IPCTNL_MSG_CT_DELETE` message over
`AF_NETLINK / NETLINK_NETFILTER` whenever a conntrack entry is
evicted. The message is binary TLV-encoded and contains:

| Attribute | Meaning |
|---|---|
| `CTA_TUPLE_ORIG` | source / dest IP + port, original direction |
| `CTA_TUPLE_REPLY` | source / dest IP + port, reply direction |
| `CTA_COUNTERS_ORIG` | final byte and packet count, original direction |
| `CTA_COUNTERS_REPLY` | final byte and packet count, reply direction |
| `CTA_ID` | unique 32-bit identifier for this conntrack entry |

Subscribing to multicast group `NFNLGRP_CONNTRACK_DESTROY` (group 3,
`nl_groups` bind mask `1 << (3-1) = 4`) gives a real-time event stream
of finalized flow byte counts. For short flows this captures 100% of
their bytes, because the kernel includes them in the DELETE message
before evicting from the hash table.

### Why DESTROY alone is insufficient

A 4-hour Twitch session never emits a DESTROY during the user's
viewing. DESTROY-only architecture would show:

- Hour 0: "iPhone uploaded 0 bytes, downloaded 0 bytes"
- Hour 1: same
- ...
- Hour 4 (when stream closes): suddenly jumps to "5.2 GB downloaded"

That's broken UX for a real-time widget.

We also need a periodic snapshot of *active* flows. The naive way is
to read `/proc/net/nf_conntrack` — already established as wrong. The
kernel exposes the same data via `NFNL_MSG_CT_GET` over the same
netlink socket:

- Binary (no `seq_printf` cost)
- Filterable (request only L3 protocol 2 = IPv4 and 10 = IPv6)
- Same TLV parser as DESTROY events
- Tested-at-scale: this is what `conntrack -L` uses internally

A 5-second cadence dump, reconciled against the last dump using
`CTA_ID` as primary key (to compute deltas safely), gives in-flight
bytes for long streams without missing anything.

### The hybrid model

```
                AF_NETLINK / NETLINK_NETFILTER
       ┌────────────────────────────────────────┐
       │                                        │
       │  DESTROY stream         CT_GET dump    │
       │  (NFNLGRP_CONNTRACK_    every 5s        │
       │   DESTROY, group 3)                    │
       │            │                  │        │
       │            └──── same ────────┘        │
       │                  TLV parser            │
       └────────────────────┬───────────────────┘
                            ▼
              ┌──────────────────────────────┐
              │ in_flight_table              │
              │  keyed by CTA_ID             │
              │  value: {last_orig_bytes,    │
              │          last_repl_bytes,    │
              │          src_ip, dst_ip}     │
              └──────────────┬───────────────┘
                             │ delta vs last seen
                             ▼
              ┌──────────────────────────────┐
              │ ip_to_mac_cache              │
              │  refreshed from /proc/net/arp│
              │  and /proc/net/ipv6_neigh    │
              │  every 60 seconds            │
              └──────────────┬───────────────┘
                             ▼
              ┌──────────────────────────────┐
              │ per_mac_totals               │
              │  {mac: {rx, tx}}             │
              └──────────────┬───────────────┘
                             ▼
              /tmp/design-host-traffic.json
              (atomic-rename write, every 5s)
                             │
                             ▼
              rpcd ubus method getHostTraffic
              (already exists from Round 42)
                             │
                             ▼
                       traffic.js
```

Reconciliation rules:

| Event | Action |
|---|---|
| DESTROY message arrives for CTA_ID X | Add `(final_bytes - last_known_bytes)` to `per_mac_totals[mac]`. Remove X from `in_flight_table`. |
| CT_GET dump shows CTA_ID X with current bytes | If X new → record. If X seen → add `(current - last)` to totals, update last. |
| CT_GET dump shows X with bytes < last_known | Treat as ID reuse: forget old state, start fresh from current. |
| `in_flight_table` has X but X missing from latest dump | Entry was destroyed silently (rare, e.g. rmmod). Drop without crediting — no DESTROY arrived. |

---

## 5. Options matrix — what each level of investment buys you

### Without adding any package (the constraint we set ourselves)

| Tier | Approach | Code size | Accuracy | CPU | Long-stream UX | Verdict |
|---|---|---|---|---|---|---|
| 0 | **Round 31 (nft bridge)** | ~200 LOC | ~0% under HW offload | low | broken | **discard** |
| 1a | `/proc/net/nf_conntrack` polling | ~150 LOC ucode | 85-95% (short flows lost) | 20-40% per core | OK | rejected |
| 1b | **DESTROY-only Netlink listener** | ~200 LOC ucode | 100% on finalized flows, **0% in-flight** | <1% | broken (4h 0 → sudden 5 GB) | incremental but insufficient |
| **2** | **Hybrid (DESTROY + 5s CT_GET dump)** ⭐ | ~400 LOC ucode | **95-99%** | 1-5% | works | **recommended** |
| 1c | Disable HW offload + simple nft | ~80 LOC | 100% | low | works | throughput drops 2.5 → 0.8 Gbps; **non-starter** |

### If we allow new packages

| Tier | Approach | Extra disk | Extra deps | Code | Note |
|---|---|---|---|---|---|
| **3** | **+ `conntrack` (~50 KB)** | tiny | one binary | ~80 LOC shell | same Hybrid architecture, `conntrack -E -e destroy` + `conntrack -L` replace 300 LOC of binary TLV parsing in ucode. Maintenance much easier. **Real opkg name is `conntrack`, NOT `conntrack-tools`** (legacy OpenWrt meta-pkg name removed in ImmortalWrt 24.10 feed split; `conntrackd` is the separate replication daemon, NOT the CLI). Verified Round 44 Step 222. |
| 4 | + `nlbwmon` (~200 KB) | small | one package, optional `luci-app-nlbwmon` | 0 LOC | mature, has its own historical DB, but it's a **separate LuCI app, not our theme widget**. Either we consume its API (small integration) or duplicate logic (waste). |
| 5 | + `ntopng` (~5 MB) or `pmacct` (~400 KB) | large | multi | n/a | professional traffic analysis with NetFlow / sFlow export, DPI, per-port-per-host historical graphs. **Massive overkill** for a router theme widget. |
| 6 | + custom kernel module via `kmod-` | varies | kernel rebuild | n/a | would mean forking ImmortalWrt firmware. **Out of scope.** |

### What each tier delivers in user-visible terms

| Tier | What the user sees |
|---|---|
| **0 (today)** | "iPhone uploaded 0 bytes" — widget exists but wrong on real router |
| **1b (DESTROY-only)** | "iPhone has uploaded 142 MB" the moment it closes a tab. The same iPhone streaming Netflix shows 0 the whole time until Netflix closes |
| **2 (Hybrid, no deps)** | "iPhone is at 1.7 GB and counting" — updates live every 5 s, accurate to within 1-5% of reality |
| **3 (Hybrid + conntrack-tools)** | identical to Tier 2 from the user's view, but the code is shell+awk and 80 lines instead of 400 lines of ucode |
| **4 (nlbwmon)** | mature daemon someone else wrote. We give up "design-x owns this widget end-to-end". Our widget becomes a frontend for someone else's data. |
| **5 (ntopng / pmacct)** | the widget grows into a full network-analytics dashboard. Theme scope creeps significantly. |

---

## 6. Known risks and quirks (apply at every tier)

These will hit us no matter which tier above we choose:

1. **`net.netfilter.nf_conntrack_acct=1` sysctl deployment.**
   Default off, only attaches to NEW connections, must be set before
   WAN comes up. If forgotten, **everything reads zero**.
2. **ucode `socket.recv()` spurious null returns** (open bug
   `jow-/ucode#332`). Handler must treat null as "no data this tick,
   keep polling", not EOF.
3. **CTA_ID reuse race.** Linux conntrack IDs are 32-bit and can
   theoretically be reassigned after eviction. Mitigation: if
   `current_bytes < last_seen` for the same ID, treat as new entry
   starting at 0.
4. **IPv6 identity is not 1-to-1.** One MAC can have multiple IPv6
   addresses (link-local + global + privacy-extension temporary).
   We need a `MAC -> set<IP>` reverse map. Fallback lookup chain:
   `/proc/net/arp` → `/proc/net/ipv6_neigh` → iwinfo assoclist for
   wireless clients.
5. **Multi-LAN / VLAN segregation.** Auto-discovering "the LAN side"
   requires reading `/etc/config/network`, scanning bridge interfaces,
   union'ing all their `ipaddr/netmask` ranges. Not hard, but easy
   to forget on first cut.
6. **NPU sync lag.** HW offload counter sync is timer-driven,
   sub-second to a few seconds. Widget total can lag reality by
   up to ~5 s for HW-accelerated flows. Acceptable for a
   5 s-refresh widget.
7. **High-PPS DESTROY bursts.** BitTorrent or a port scan can produce
   thousands of DESTROY events per second. Parser must fast-reject
   on the netlink header before doing deep TLV parsing on every event.
8. **Persistence across reboots.** Out of scope for first cut. If
   added later: write per-MAC totals to `/etc/design-host-acct.state`
   every 60 s with atomic-rename + simple checksum. User opts in via
   `uci design_acct.global.persist=1` because flash writes have real
   cost.

---

## 7. Recommended path (when we eventually ship)

**Tier 2 (Hybrid, zero new deps)** is the right default for this
project because:

- Preserves "luci-theme-design-x ships its own widget end-to-end".
- <500 LOC, fits the project's clean-code constraint.
- Accurate enough (95-99%) that user won't notice drift.
- Hard part (binary TLV parsing in ucode) is a known-shape problem,
  not research — just careful coding.
- Leaves room to upgrade to Tier 3 later if maintenance turns
  painful: same architecture, just swap the parser layer.

**Tier 3 (+ conntrack-tools, 50 KB)** is a viable fallback if Tier 2's
ucode parser proves flaky in practice. Cost is so low that "zero new
deps" becomes more stylistic than necessity; if the user agrees ~50 KB
for a 5× code reduction is acceptable, **Tier 3 is strictly better
engineering** than Tier 2.

**Tier 4 (nlbwmon)** is not recommended because it dilutes theme
ownership of the feature, but is worth knowing about — if the user
already has nlbwmon installed for some other reason, our widget can
consume its API for ~50 LOC of integration code instead of running
our own daemon. Worth a `traffic.js` capability probe.

---

## 8. Tentative Round 44 step plan (NOT yet committed — for reference)

If/when we decide to ship Tier 2, the work decomposes into ~7 atomic
steps:

| Step | Scope | Risk | Time |
|---|---|---|---|
| 194 | `/etc/sysctl.d/11-design-conntrack-acct.conf` + uci-defaults `sysctl -p`. Standalone — can ship even if everything else slips. | low | 20 min |
| 195 | `/usr/sbin/design-host-acct.uc` Phase 1: listen DESTROY only, validate binary TLV parser on QEMU. Writes `/tmp/design-host-traffic.json`. Widget still on old data — safe parallel run for observability. | medium (parser tricky) | 3-4 h |
| 196 | Add 5 s `NFNL_MSG_CT_GET` dump + `CTA_ID`-keyed delta reconciliation. Hybrid complete. Widget still on old data. | medium | 2 h |
| 197 | `rpcd` ubus method `getHostTraffic` reads daemon JSON. `traffic.js` switches endpoint. Old CGI retained as fallback. | low | 1 h |
| 198 | Soak test, cross-check numbers vs SQM stats / vs router LAN+WAN interface counters / vs Chrome-Claude observation of a known download. **User decides go/no-go.** | n/a | 1 day soak |
| 199 | Delete Round 31 artifacts: `/etc/init.d/design-host-acct`, nft table `design_acct`, CGI `host-traffic`, `uci-defaults/95-design-acct-bridge`, Makefile postinst chmod line, `dev-sync.sh` sync targets, `lint.yml` `additional_files` entries. | low | 30 min |
| 200 | `doc/styling-progress.md` Round 31 postmortem + Round 44 journal; `doc/backlog.md` close out "deep research / redesign" tier; memory file `[[netlink-conntrack-acct]]`. | low | 30 min |

Net code change: delete ~330 lines (Round 31) + add ~400 lines
(ucode daemon + procd + sysctl) ≈ **+70 lines**, accuracy from
"garbage" to "production".

---

## 9. Open decision points (for user, not us)

1. **Do we ship Round 44 next, or sit on this discovery and ship
   other rounds first?** Original backlog tagged this "Round 50+
   territory". The discovery has reduced the unknowns enough that
   it's now ~6-8 well-defined Steps, not open-ended research.
2. **Tier 2 vs Tier 3** — ~400 LOC ucode no-deps vs ~80 LOC shell
   + 50 KB conntrack-tools. Stylistic + maintenance tradeoff.
3. **Persistence across reboot** — yes / no / opt-in?
4. **Coexistence with nlbwmon** — if user happens to have it
   installed, do we read from it (avoid running our daemon) or run
   ours independently? Adds a capability probe to `traffic.js`.

---

## 10. References

### External research
- `doc/OpenWrtFlowOffloadAccounting Challenge.md` — full external AI report (verified, cross-checked).

### Upstream Linux source
- `net/netfilter/nf_flow_table_offload.c::flow_offload_work_stats()` — hardware → software counter sync
- `drivers/net/ethernet/mediatek/mtk_ppe_offload.c::mtk_flow_offload_stats()` — MTK PPE → flowtable bridge
- `net/netfilter/nf_conntrack_netlink.c` — DESTROY event broadcaster
- `net/netfilter/nf_conntrack_acct.c` — the sysctl gate

### OpenWrt / ImmortalWrt
- nlbwmon source (reference Netlink-listener architecture): https://github.com/jow-/nlbwmon
- ucode socket module reference: https://ucode.mein.io/module-socket.html
- ucode bug `jow-/ucode#332`: spurious-null `socket.recv()` returns
- ImmortalWrt 24.10 default sysctl: `/etc/sysctl.d/11-nf-conntrack.conf`

### Our own history
- Round 31 origin commits: Steps 115-119 in `doc/styling-progress.md`
- Round 42 fork (rpcd ubus already in place for the new daemon's transport): Steps 156-170 in `doc/styling-progress.md`
- Backlog entry being superseded: `doc/backlog.md` § "Per-host bandwidth accounting (Round 31) — 一坨垃圾"
- Related memory: `[[uci-write-needs-service-validation]]` (any future write-back work must obey input validation lesson from Step 152→153)
