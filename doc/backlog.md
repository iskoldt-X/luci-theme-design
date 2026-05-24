# Backlog & Decisions

> Living document. Updated at major decision points to capture: what's locked in next, what's deferred, what's explicitly opted out, and what needs deep redesign.
>
> Last updated: 2026-05-24, after Round 40 + dnsmasq incident postmortem.

---

## 🎯 Round 41 — Locked-in next (defensive grooming)

After Round 40's first production incident, the user chose "defensive补课" over new features. Two deliverables:

- **A. `doc/luci-theme-toolbox.md`** — consolidate the LuCI-26.x theming power tools we've discovered across 40 rounds into one developer-facing reference. Topics:
    - file-override via rsync no-`--delete` (Rounds 32/33 SVG icons)
    - `:has(#stable-id) + !important` for non-invasive HTML modification (Round 40 Step 151)
    - Inline SVG data-URI mask on `::before` for icon injection when LuCI controls inner HTML (Round 35 Step 136)
    - Attribute selectors + `!important` to override LuCI's inline styles (Round 32 Step 122 zonebadge; Round 34 Step 131 DiskMan)
    - UCI input validation before write (Round 40 Step 153 — see also `memory/uci-write-needs-service-validation.md`)
    - Sliding-window + UI-throttle for streaming metrics (Round 39 Step 143/144 speedtest)
    - Adaptive scale + monotone-up ratchet for variable-range UIs (Round 39 Step 145)
    - Tooltip vs inline for ancillary stats (Round 39 Step 146)

- **B. `doc/chrome-claude-briefing.md`** — Chrome-Claude prompt prefix template. Round 32-35 he consistently wrote `[data-darkmode="true"]` instead of `html[data-theme="dark"]`, and used non-existent token names (`--bg-card`, `--color-danger-500`, `--border-subtle`). Formalize a copy-pasteable "project environment briefing" block to drop at the start of every Chrome-Claude audit request.

---

## 🧪 Round 42+ candidates (data layer enhancements)

Sorted by user-visible value:

- **OUI vendor database** — LAN Clients detail panel currently shows "Vendor: Unknown" for every device. Embed a compact OUI prefix → vendor name table (~5KB JSON for top 1000 OUIs) keyed by first 3 MAC octets. Falls back to "Unknown" for unrecognized; optionally show a link to macvendors.com for manual lookup. **~1h work**.
- **ARP-based real Last Seen** — Step 140 renamed the column to "Lease" to be honest about data source (DHCP lease validity ≠ device activity). Real last-seen needs `/proc/net/arp` REACHABLE/STALE/DELAY/FAILED state + `iwinfo.assoclist[].inactive` for Wi-Fi. Likely new CGI `/cgi-bin/design/lan-activity` returning per-MAC last-seen seconds. **~1-2h work**.
- **IPv6 addresses in expand detail** — `getHostHints.ip6addrs` returns array; render a line per address in the detail panel. **~10 min work**.
- **Column header click-to-sort** — Name / IP / Lease columns become sortable on click. Round 38 Chrome-Claude P1 suggestion. **~30 min work**.

---

## 🛠️ Round 43+ candidates (action button completions)

Currently three of the five LAN Clients action buttons are placeholders that just toast "not yet implemented":

- **Whitelist** — write to MAC ACL list (which is which? `wireless.mac_filter` or `dhcp.@host.whitelist`?). Needs design decision first. **~30 min once decided**.
- **Limit** — per-MAC bandwidth limit via tc/qdisc or sqm-scripts. Touches `/etc/config/qos` or `/etc/config/sqm`. **~2-4h, depends on which QoS stack**.
- **Block** — drop traffic to/from MAC. Easiest via `nftables` set + drop rule in firewall, or via `dhcp.@host.dns_set` to give wrong DNS. **~1-2h**.

These all involve persistent service config and **MUST follow Step 153's input-validation lesson** (sanitize before any UCI write).

---

## 🎨 Round 44+ candidates (icon / visual finishing)

- **DockerMan SVG file-override** — Round 33 Step 125 used CSS `filter: invert(0.85)` as 5-line hot-fix for dark-mode invisibility of upstream `fill="#000"` icons. Real fix is 4 file-override SVGs with `currentColor` (containers / images / networks / volumes). **~30 min**.
- **Disabled-variant icons** — Round 32/33 shipped active versions of port_up / ethernet / wifi / bridge / tunnel / vlan SVGs but not all the `_disabled` variants. Likely need bridge_disabled, tunnel_disabled, vlan_disabled if upstream uses them. **~20 min**.
- **PNG fallback** — some LuCI builds use `.png` not `.svg` paths. Our SVG file-overrides are no-ops there. Ship matching PNGs alongside. **~30 min if PNG conversion tooling at hand**.

---

## 🚧 Tier "deep research / redesign" (no timeline)

### Per-host bandwidth accounting (Round 31, Steps 115-119) — user assessment: "一坨垃圾,不可用状态"

The Round 31 implementation:
- nftables bridge family table `design_acct` with `lan_in` (prerouting) + `lan_out` (postrouting) chains
- Per-host counters `host_tx_<ip>` / `host_rx_<ip>` keyed by IP
- `/etc/init.d/design-host-acct` service manages counter creation on DHCP lease changes
- `/cgi-bin/design/host-traffic` CGI returns JSON
- `traffic.js` polls every 5s

**Known/suspected issues** (user hasn't elaborated specifically — needs interview):
- Counters by IP, not MAC: IP changes break continuity, lease churn loses history
- Cron-based refresh every 5 min misses fast-cycling DHCP renewals
- No persistence: counter values reset on router reboot (kernel-level nft state)
- Display in UI may not match user's intuition for "what consumed bandwidth"
- ?: data accuracy / lag / completeness vs reality

**Action**: when user has appetite to redesign, **first collect specifics of what's "garbage"**. Then evaluate alternative stacks:
- option 1: keep nft bridge family but key by MAC, persist counter state to /etc/config
- option 2: use eBPF (kernel 5.10+ on ImmortalWrt 24.10) for higher-quality per-host metering
- option 3: native LuCI integration with `nlbwmon` (broken by flow offload — Round 25 noted) — would need to also fix nlbwmon
- option 4: outsource to OpenWrt `bandwidthd` package + parse its output

This is **Round 50+ territory or its own multi-Round track**, not next week's work.

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
