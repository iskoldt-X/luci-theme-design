# Backlog & Decisions

> Living document. Updated at major decision points to capture: what's locked in next, what's deferred, what's explicitly opted out, and what needs deep redesign.
>
> Last updated: 2026-05-24, end of Round 43 — added per-host bandwidth discovery (see `doc/bandwith.md`, Round 44 candidate). Round 43 itself shipped Steps 179-193 (LAN Clients / Status table polish + Chrome-Claude overview bug catalog). Round 42 MTK fork verified and post-deployment hotfixes (Steps 171-178) shipped.

---

## ✅ Round 41 — DONE (defensive grooming, doc-only)

Shipped two reference docs that distill 40 rounds of accumulated tribal knowledge:
- **`doc/luci-theme-toolbox.md`** — 15-section LuCI 26.x theming cookbook (file-override, `:has()`, UCI input validation, streaming metrics, etc.)
- **`doc/chrome-claude-briefing.md`** — Chrome-Claude prompt prefix template with 5 audit variants

3 commits (`6fe0f6c → 2182582 → 10de729 → d1000ba` journal entry).

---

## ✅ Round 42 — DONE (cross-branch fork as luci-theme-design-x)

Triggered by MTK ipk build failure at Actions-OpenWrt's build-immortalwrt-SSR-AX6000.yml. immortalwrt 24.10's luci-base started shipping the 9 SVG paths our theme had been file-overriding since Round 32 → opkg refused double-ownership → MTK build aborted. x86 build had been passing on older luci-base snapshot, soon to hit same wall.

Decision: clean break to `luci-theme-design-x` IPK with `PKG_CONFLICTS:=luci-theme-design`. 15 Steps across 4 sub-rounds, all shipped:

**Sub-A — build-time fixes (Steps 156-160, 5 commits)**
- Tree rename `design/` → `design-x/` (Step 156)
- Move 9 colliding SVGs to design-x/icons/ + CSS substitution via `content: url()` (Step 157, the MTK build unblocker)
- Namespace 13 JS modules under `resources/design-x/` + `L.require('design-x.X')` rewrites (Step 158)
- Makefile `PKG_NAME:=luci-theme-design-x` + `PKG_CONFLICTS:=luci-theme-design` + hook reorder (Step 159)
- lint.yml `luci-base path-collision check` job — defends against future repeats (Step 160)

**Sub-B1 — ucode template dual-track (Steps 161-162, 2 commits)**
- Both `header.htm`+`footer.htm` (Lua) AND `header.ut`+`footer.ut` (ucode 24.10+) shipped (Step 161). luci-lua-runtime not required for ucode track.
- lint.yml ucode-template syntax check (Step 162)
- Known limitation: root-no-password warning fails-closed on ucode track (rpcd non-root can't read /etc/shadow). Lua track still shows it.

**Sub-B2 — CGI → rpcd/controller migration (Steps 163-167, 5 commits)**
- rpcd ubus skeleton + ACL declaration (Step 163) — `luci-theme-design-x` ubus object grants read-only to authed LuCI sessions
- 6 JSON endpoints migrate to ubus methods (Steps 164 devstats canonical + 165 batch of 5)
- 3 streaming endpoints (download/upload/ping) → LuCI Lua controller at `/cgi-bin/luci/admin/design-x/{ping,download,upload}` (Step 166). Adds `+luci-lua-runtime` to LUCI_DEPENDS.
- apply-modal.js + toast.js gain `L.env.luciversion` major-in-[18,27] whitelist on the monkey-patches (Step 167, Codex P2-10 close)
- **Legacy 9 CGI scripts NOT deleted yet** — retained as rollback fallback pending MTK build verification

**Sub-C — doc + cross-branch CI (Steps 168-170, 3 commits)**
- `doc/luci-compat.md` updated with rpcd ubus + LuCI controller + ucode template + version-pinning sections (Step 168)
- `.github/workflows/build-matrix.yml` weekly cron: 7 cells across (immortalwrt-24.10, immortalwrt-master, openwrt-24.10, lean-master) × (x86_64, mt7986) running `make package/.../prepare` (Step 169)
- This very file + INDEX.md + development.md path refs updated for design-x rename (Step 170)

**Net effect on file count**: +5 new files (build-matrix.yml, luci-theme-design-x rpcd script, ACL JSON, header.ut, footer.ut, design_x.lua), +0 deleted (legacy CGIs preserved). Effective namespace fully forked.

---

## 🎯 Round 43 — Locked-in next (post-verification cleanup + ucode controller)

Two work items, the first BLOCKED on user verification of MTK build:

**A. Legacy /cgi-bin/design/* cleanup** (~10 min). Once user confirms the new rpcd/controller paths are working on the MTK build:
- `git rm root/www/cgi-bin/design/{devstats,cpustat,temp,host-traffic,wifi-stations,nlbw,ping,download,upload}`
- Update `Makefile` postinst-pkg to drop the `chmod -R +x /www/cgi-bin/design/` line
- Update `lint.yml` `Shellcheck additional_files` to drop the 5 CGI scripts listed
- Update `doc/development.md` to drop the `root/www/cgi-bin/design/` row from sync-targets table

**B. ucode-controller dual-track** (~1-2h). Round 42 Step 166 added `+luci-lua-runtime` to LUCI_DEPENDS (~200 KB) so the Lua controller can register. To match the ucode-template dual-track from Sub-B1, write a parallel ucode controller at `root/usr/share/ucode/luci/controller/design-x.uc` (or wherever LuCI 24.10 expects ucode controllers). Once both tracks are in place, the `+luci-lua-runtime` dep can revert to optional.

---

## 🧪 Round 44+ candidates (data layer enhancements, previously Round 42+)

Sorted by user-visible value:

- **MAC vendor lookup** — Discovery DONE + Phase 1 verification DONE 2026-05-24 → see dedicated section below + `doc/macvendor.md`. **Phase 2B confirmed** (Phase 2A unreachable: ufp package not in ImmortalWrt 24.10 feeds). Embed Wireshark `manuf` 24-bit MA-L as `oui.json.gz` (~150 KB) in theme, build-time fetch, no git commit. LAA/Multicast bit detection done unconditionally (covers ~44% of user's actual devices for free). User explicitly rejected report-recommended "independent data package" approach (effectiveness > decoupling). **Scheduled: Round 45 main work, ~4-5h.**
- **ARP-based real Last Seen** — Step 140 renamed the column to "Lease" to be honest about data source (DHCP lease validity ≠ device activity). Real last-seen needs `/proc/net/arp` REACHABLE/STALE/DELAY/FAILED state + `iwinfo.assoclist[].inactive` for Wi-Fi. Now should go through the new `luci-theme-design-x` rpcd ubus object (Round 42 architecture) as a new method, NOT a raw CGI. **~1-2h work**.
- **IPv6 addresses in expand detail** — `getHostHints.ip6addrs` returns array; render a line per address in the detail panel. **~10 min work**.
- **Column header click-to-sort** — Name / IP / Lease columns become sortable on click. Round 38 Chrome-Claude P1 suggestion. **~30 min work**.

---

## 🛠️ Round 45+ candidates (action button completions, previously Round 43+)

Currently three of the five LAN Clients action buttons are placeholders that just toast "not yet implemented":

- **Whitelist** — write to MAC ACL list (which is which? `wireless.mac_filter` or `dhcp.@host.whitelist`?). Needs design decision first. **~30 min once decided**.
- **Limit** — per-MAC bandwidth limit via tc/qdisc or sqm-scripts. Touches `/etc/config/qos` or `/etc/config/sqm`. **~2-4h, depends on which QoS stack**.
- **Block** — drop traffic to/from MAC. Easiest via `nftables` set + drop rule in firewall, or via `dhcp.@host.dns_set` to give wrong DNS. **~1-2h**.

These all involve persistent service config and **MUST follow Step 153's input-validation lesson** (sanitize before any UCI write). Action-button writes should land in the rpcd ubus object as new methods under the existing `luci-theme-design-x` ACL grant.

---

## 🎨 Round 46+ candidates (icon / visual finishing, previously Round 44+)

- **DockerMan SVG file-override** — Round 33 Step 125 used CSS `filter: invert(0.85)` as 5-line hot-fix for dark-mode invisibility of upstream `fill="#000"` icons. Real fix is 4 file-override SVGs with `currentColor` (containers / images / networks / volumes). **~30 min**.
- **Disabled-variant icons** — Round 32/33 shipped active versions of port_up / ethernet / wifi / bridge / tunnel / vlan SVGs but not all the `_disabled` variants. Likely need bridge_disabled, tunnel_disabled, vlan_disabled if upstream uses them. **~20 min**.
- **PNG fallback** — some LuCI builds use `.png` not `.svg` paths. Our SVG file-overrides are no-ops there. Ship matching PNGs alongside. **~30 min if PNG conversion tooling at hand**.

---

## 🎯 Round 44 candidate — Per-host bandwidth accounting redesign (discovery DONE)

### Status (updated 2026-05-24, end of Round 43)

Round 31 (Steps 115-119) was previously parked here as "deep research /
redesign, Round 50+ territory". After commissioning an external deep-research
report and cross-checking its kernel-source citations, **the unknowns have
collapsed into a well-defined ~7-step implementation plan**. No longer
research; now a scheduling decision.

### Root cause (settled)

The nftables `bridge` family hooks live *above* the MT7986 NPU's hardware
flow offload fastpath. Once `mtk_ppe` accelerates a flow into silicon, the
software bridge code is never invoked → our counters never increment for
the bulk of LAN-side traffic. On QEMU x86_64 (no NPU) it appeared to work;
on real hardware (SSR-AX6000) it's structurally blind. Other defects
(IP-keyed identity, IPv4-only, 5-min cron lag, no persistence, rule-per-IP
non-scaling) are real but secondary to the offload-bypass.

### What to read for full context

- **`doc/bandwith.md`** — complete discovery doc: kernel reality, 5-tier
  options matrix (zero-deps → ntopng), recommended Hybrid architecture
  (DESTROY event stream + 5s `NFNL_MSG_CT_GET` dump), known risks, soft
  Round 44 step plan
- **`doc/OpenWrtFlowOffloadAccounting Challenge.md`** — external AI deep
  research report with kernel-source citations (verified)

### Path forward (recommended)

| Tier | Approach | Status |
|---|---|---|
| **2** ⭐ | Hybrid (DESTROY listener + 5s CT_GET dump) in pure ucode, **zero new deps**, ~400 LOC, 95-99% accuracy | **recommended default** |
| 3 | Same architecture, `+ conntrack-tools` (50 KB), shrinks to ~80 LOC shell + awk | strictly better engineering if 50 KB extra is acceptable |
| 4 | `+ nlbwmon` (200 KB) — gives up theme ownership of the widget | only if user already has it installed for other reasons |

Round 44 step plan (decomposed in `doc/bandwith.md` §8): sysctl bootstrap →
ucode daemon Phase 1 (DESTROY only, parallel-run for observability) →
Phase 2 (hybrid complete) → rpcd ubus method + traffic.js endpoint swap →
soak test + user go/no-go → delete Round 31 artifacts → journal +
postmortem. Net code change ≈ +70 lines, accuracy "garbage" → "production".

### One mandatory deployment step (any tier)

`net.netfilter.nf_conntrack_acct=1` sysctl is OFF by default at runtime
and only attaches to NEW connections. Must ship via
`/etc/sysctl.d/11-design-conntrack-acct.conf` applied before WAN comes up.
**If forgotten, every architecture reads zero bytes.** Recorded as memory
`[[netlink-conntrack-acct-sysctl-default-off]]` (to be filed when Round 44
ships).

---

## 🎯 Round 45 candidate — MAC vendor lookup (Phase 2B confirmed, ready to ship)

### Status (updated 2026-05-24, end of Round 43)

LAN Clients expand-row "Vendor: Unknown" placeholder (in place since Step 148
Round 40) gets resolved. After commissioning a deep-research report
(`doc/OpenWrtMACVendorLookupArchitecture.md`) and running Phase 1 verification
on the user's actual router, **the path is locked to Phase 2B (theme-embedded
Wireshark manuf)**. Full plan in **`doc/macvendor.md`**.

### Phase 1 verification outcome (2026-05-24, on user's router)

Phase 2A (consume upstream `host_hints.vendor`) ruled out:
- `ubus call luci-rpc getHostHints` returns no `vendor` field
- `ps w | grep ufp` empty — no ufp-neigh daemon running
- `opkg list-installed | grep ufp` empty — package not installed
- **LuCI Software search "ufp" → "No packages matching"** — package is not
  even available in ImmortalWrt 24.10 feeds. Structurally unreachable.

The report's PR #7931 / commit 70b7176fc2 mechanism, even if it exists upstream,
has not been backported to ImmortalWrt 24.10 with its required `ufp` package.

### Root cause (settled)

Vendor identification from MAC needs a OUI prefix → name table. ImmortalWrt
24.10 does not provide one through upstream APIs. We ship our own as a static
data file embedded in the theme IPK. LAA bit (`0x02`) and Multicast bit (`0x01`)
detection of the first MAC octet is done in JS unconditionally — covers ~44%
of the user's actual devices (verified against live `getHostHints` sample
of 9 devices, see `doc/macvendor.md` §一.五) without needing the DB.

### What to read for full context

- **`doc/macvendor.md`** — complete plan: verification outcome (§一.五),
  Phase 2B implementation (§四), LAA UX nuances (§五), what-not-to-do list
  (§七), risk table (§八), license compliance for GPL data + Apache code
- **`doc/OpenWrtMACVendorLookupArchitecture.md`** — external AI deep research
  report. Verified flaws: ufp-availability claim was wrong for ImmortalWrt
  24.10. Solid contributions: gzip+DecompressionStream API support cutoff,
  "Mere Aggregation" license analysis, refute of cron-update + git-commit
  anti-patterns. Base64-embedded math symbols can be ignored.

### Implementation summary (Phase 2B)

| Component | Where | Size | LOC |
|---|---|---|---|
| Build CI fetch + transform | `.github/workflows/*.yml` (new step) | 0 (CI only) | ~30 lines YAML/awk |
| Generated artifact | `htdocs/luci-static/design-x/data/oui.json.gz` (gitignored) | ~150 KB in IPK | n/a |
| JS module | `htdocs/luci-static/resources/design-x/vendor.js` (new) | 0 (~5 KB) | ~80 |
| Integration | `htdocs/luci-static/resources/design-x/devices.js` | 0 | ~10 |
| License NOTICE | `root/usr/share/luci-theme-design-x/NOTICE` (new) | trivial | n/a |
| Total IPK growth | | **~150 KB** | **~120 LOC** |

### User decision (2026-05-24)

**Rejected** report-recommended "independent `luci-app-mac-vendor-data` package"
route. Reasoning: residential theme, single maintainer, single-IPK deployment
is strictly better UX than double-package. **Effectiveness > MVC purity.**

### Scheduling

**Round 45 main work** (~4-5h, primary Round body). Touches Build CI + theme
JS + new module + NOTICE file. Round 44 stays focused on bandwidth (conntrack)
+ WAN tile sparkline polish (both also discovery-DONE). Round 45 lands MAC
vendor as its own coherent ship.

### Future-proofing already designed in

`vendor.js` `lookup(mac, hostHintVendor)` signature accepts an optional
`hostHintVendor` parameter. If ImmortalWrt eventually backports `ufp` and
exposes `host_hints.vendor`, switching to hybrid mode (upstream first,
local fallback) is **a single-line caller change** in `devices.js`, not a
re-architecture. See `doc/macvendor.md` §一.五 last paragraph.

---

## 🎯 Round 44 candidate — WAN Traffic tile sparkline fixes (discovery DONE)

### Status (updated 2026-05-24, end of Round 43)

User reported "during upload, the number was high but the dashed line was
invisible; shortly after upload finished, the line suddenly appeared and
looked correct". Chrome-Claude live-DOM measurements + source review on
`sparkline.js` / `wan-stats.js` / `features.css` settled the diagnosis to
**~33-line fix across 3 files**. Full plan in **`doc/wan_traffic.md`**.

### Root cause (settled)

Two-layer stacking:
1. **P0 — `sharedHi` cross-ring quantum compression** (Step 139 Round 37):
   `renderTileSpark` computes a shared Y-axis upper bound from
   `max(rxHi, txHi)` across both rings. Any historical peak in either
   direction (in the 2-min sliding window) compresses the other direction
   into the bottom 10% of viewBox. Real bug. User's symptom matches exactly.
2. **P1 — secondary line low visual contrast**: `opacity: 0.55` +
   `dasharray: 3 2` + thin `stroke-width: 1.5` on a near-white tile
   background → WCAG contrast ~1.5:1, far below readable. When the line is
   drawn at viewBox top (no fill backdrop), it's nearly invisible. The
   "appears after upload" perception comes from the line descending through
   the green fill area where contrast suddenly improves.

Chrome-Claude's other reported bugs (Bug #2 "only one path" and Bug #3
"DOM not updating") are **false alarms** — selector mismatch + MutationObserver
config issue, debunked in `doc/wan_traffic.md` §三.

### What to read for full context

- **`doc/wan_traffic.md`** — full audit: data flow, P0+P1+latent bugs,
  refuted alternatives (mirror layout, `mode: 'bounded' | 'rate' | 'bipolar'`
  abstraction, etc.), specific fix code with diff-level guidance,
  verification protocol with DevTools console snippets, risk register

### Path forward (recommended)

3 atomic Steps, ~33 LOC net change, ~2.5h including verify:
1. **Fix-1** (P0): remove `sharedHi` argument from primary+secondary
   `path()` calls in `renderTileSpark` → each line auto-scales to its own
   ring max. CPU/Mem/Temp single-line tiles unaffected (backward compat
   preserved via path()'s undefined sharedHi)
2. **Fix-2** (P1): CSS contrast bump — `opacity` 0.55 → 0.85,
   `stroke-width` 1.5 → 2, `dasharray` "3 2" → "5 3"
3. **Fix-3**: meta line shows both directions' peak — `Peak ↓X ↑Y` — to
   compensate the visual magnitude relationship lost in Fix-1

### Scheduling

Fits cleanly in **Round 44** alongside the per-host bandwidth main work
(those are unrelated files, no merge conflict). The 2.5h budget is small
enough to be a Round 44 sub-track, not its own Round.

### Verification gate before shipping

Per `doc/wan_traffic.md` §六, must run two ground-truth checks on the live
router first (5 min):
```js
// 1. Confirm secondary path actually exists (debunks Chrome-Claude Bug #2)
document.querySelectorAll('#design-tile-net path').length      // expect 3
// 2. Confirm renderTileSpark is firing (debunks Chrome-Claude Bug #3)
new MutationObserver(m=>console.log(m))
    .observe(document.querySelector('.design-tile-spark-line-secondary'),
             { attributes: true, attributeFilter: ['d'] })
// expect ~5 mutations over 10 seconds
```
If either check fails the entire `doc/wan_traffic.md` diagnosis needs
re-examination — but predicted false positives < 5%.

### Decision points awaiting user

1. Schedule: ship Round 44 next, or defer for other rounds first?
2. Tier 2 (zero deps) vs Tier 3 (+ 50 KB conntrack-tools)?
3. Reboot persistence: yes / no / opt-in?
4. nlbwmon coexistence probe in `traffic.js`?

---

## ❌ Explicitly opted out

User decisions, do not bring back without re-confirming:

- **OpenClash plugin UI adaptation** — third-party plugin self-overwrites on upgrade, override work wasted
- **Chinese i18n** — source stays English `_(...)` wrapped, no `.po` files
- **Crontab syntax highlighting** — too niche for the effort (CodeMirror integration)
- **Reboot button "are you sure" double-confirm** — debatable UX, leave as-is
- **Reboot warning hover** — same

---

## 🟡 Open loose ends

Things identified but parked, awaiting user decision:

- **Mac Tailscale DNS interception** — Mac's primary DNS is `100.100.100.100` (Tailscale MagicDNS). `dig @1.1.1.1` from Mac times out. Router → Mac ping is 100% lost. Unrelated to dnsmasq incident (iPhone has no Tailscale yet had the same symptom from a different cause), but it does mean the Mac side may be suffering from a separate Tailscale config issue. **Need user to decide**: investigate (`tailscale status`, `tailscale netcheck`, `scutil --dns`) or live with it.
- **SQM/CAKE for bufferbloat** — networkquality measured 105ms loaded responsiveness vs 15ms idle. Not a bug, an improvement. `opkg install luci-app-sqm` + enable cake on WAN. **Not required**, but easy win if user cares about real-time apps under load.
- **Push the unpushed commit** — currently 1 commit ahead of `origin/js` (Round 40 journal `fdd38c9`). User policy: never push without explicit permission. Pending user OK.

---

## ✅ Tier 1 verification still needed by user

Quick sanity checks of just-shipped work:

- [ ] Confirm iPhone is back to normal (auto-recovered after dnsmasq restart)
- [ ] Step 153 sanitize: open LAN Clients, rename a device to "Test Phone X", confirm info toast "Saving as Test-Phone-X"
- [ ] Step 148 Set Static: expand a row, click "Set Static →", confirm navigation to `/admin/network/dhcp`
- [ ] Step 151 hide upstream DHCP: confirm "Active DHCP Leases" / "Active DHCPv6 Leases" sections GONE from `/admin/status/overview`, still present on `/admin/network/dhcp`

---

## 📜 CLAUDE.md (2026-05-22 audit) — current status

The audit dated 2026-05-22 (recorded in `doc/CLAUDE.md`) found 14 severe issues + 12 code smells inherited from the original luci-theme-design fork (some code dating to 2015 — jQuery 1.11.3). **Most of these have been silently swept up during the 153 Steps of theme work**. Status table (verified 2026-05-24 via grep):

### Section 1 — severe issues (14 items)

| # | Issue | Status |
|---|---|---|
| 1.1 | `#cbi-samba-cfg010f89-_tmpl` hardcoded UCI section ID dead rule | ✅ **Fixed** (0 grep matches in style.css) |
| 1.2 | `@font-face 'design'` half-broken (empty url, fragment-only) | ✅ **Fixed** (cleaned to woff2/woff/ttf only) |
| 1.3 | `div { font-family: 'HYk2gj' }` dead global rule | ✅ **Fixed** (0 grep matches) |
| 1.4 | Navbar hardcoded `/cgi-bin/luci` + openclash dead link | ✅ **Fixed** (0 grep matches in header.htm — navbar replaced entirely in topbar overhaul) |
| 1.5 | Empty root weak-password warning block (security regression) | ✅ **Fixed** (warning content restored with `<div class="alert-message warning"><h4>No password set!</h4>`) |
| 1.6 | `style.js` deprecated DOMSubtreeModified + null crash + `eval('')` | ✅ **Fixed** (now MutationObserver with null guards, no eval anywhere) |
| 1.7 | `style.js` openclash viewport hack vs header.htm conflict | ✅ **Fixed** (0 grep matches for "openclash" in style.js) |
| 1.8 | jQuery 1.11.3 (2015) + `?v=3.5.1` URL lie + CVEs | ✅ **Fixed** (jquery.min.js file deleted entirely — project is now jQuery-free) |
| 1.9 | LICENSE inconsistency (Apache 2.0 vs Makefile GPL-2.0) | ✅ **Fixed** (Makefile comment now reads "Apache 2.0 (LICENSE) + Makefile GPL-2.0-or-later, compatible") |
| 1.10 | CSS duplicate selectors (60+ lines `.node-main-login` dupe) | ⚠️ **Partial** — some dedup happened during refactors but no systematic audit done |
| 1.11 | PWA manifest icon size lies + dead GCM fields | ✅ **Fixed** (0 grep matches for `gcm_sender_id` in manifest.json) |
| 1.12 | `favicon.ico` is actually PNG | ✅ **Fixed** (file deleted entirely; `<link rel="icon" href=".../favicon.png" type="image/png">` style now in use) |
| 1.13 | `style copy.css` 75KB backup committed | ✅ **Fixed** (file deleted) |
| 1.14 | `menu-design.js` `null active` class concatenation bug | ✅ **Fixed** (now uses class array pattern; comment explicitly notes "avoid 'null active' bug from string coercion") |

### Section 2 — code smells (12 items)

| # | Issue | Status |
|---|---|---|
| 2.1 | JS resize listener changes box-shadow (could be CSS @media) | ⚠️ Probably done as part of jquery removal (file deleted) |
| 2.2 | 8 empty CSS rules | ⚠️ Possibly partial, not specifically audited recently |
| 2.3 | 60+ lines of commented-out CSS | ⚠️ Possibly partial |
| 2.4 | `style.css` 3611 lines monolithic | ⚠️ Now 4873 lines, larger but well-organized into clear sections |
| 2.5 | `eval("''")` standalone | ✅ Fixed (covered by 1.6 rewrite) |
| 2.6 | "Inital Setup" typo in selector | ✅ **Fixed** (0 grep matches) |
| 2.7 | Private browser meta (X5/UC) tags | ✅ **Fixed** (0 grep matches for x5/uc patterns) |
| 2.8 | `width: calc(0% + 10rem)` dead arithmetic | ⚠️ Not specifically audited |
| 2.9 | Makefile hardcoded version | ⚠️ Not changed |
| 2.10 | CI workflow on EoL ubuntu-20.04 + ancient SDK | ⚠️ Partial — `lint.yml` exists (didn't exist at audit time), `release.yml` status uncertain |
| 2.11 | `<span class="showSide">` accessibility | ✅ **Fixed** (now `<button type="button" class="showSide" aria-label="Toggle menu">`) |
| 2.12 | uci-defaults force-switches theme | 📌 Intentional (this is a theme installer; behavior preserved) |

### Summary

- **Section 1 (severe)**: 13 of 14 fixed (1.10 CSS dedup partial)
- **Section 2 (smells)**: ~7-8 of 12 fixed, the rest are minor cosmetic / process improvements

**Conclusion**: CLAUDE.md is largely a historical artifact at this point. The "rotten codebase" we forked from has been remediated. Outstanding items are minor enough to handle as opportunistic cleanup when touching adjacent code, not worth dedicated Steps.

---

## 📁 Document conventions

- **Round** = a coherent chunk of related work, 3-7 Steps typical, gets a `## 🎨 第 N 轮(Step X-Y)` entry in `doc/styling-progress.md`
- **Step** = one atomic commit, possible to revert independently
- **Patch** (e.g. Step 150 = "Round 40 patch") = same-Round follow-up to a not-quite-working previous Step

This file's role vs others:
- `doc/styling-progress.md` — engineering journal (past)
- `doc/backlog.md` (this file) — pending work + decisions (present)
- `memory/MEMORY.md` — durable LuCI 26.x quirks indexed by session memory (cross-session)
- `doc/luci-theme-toolbox.md` (planned, Round 41) — developer reference for theme-author tools (timeless patterns)
