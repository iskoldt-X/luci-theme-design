# LuCI API Compatibility Matrix

> Living document. Update when adding new code that depends on a LuCI
> internal API surface, especially anything in `L.ui.*`, `L.rpc.*`, or `ubus`.
> CI cross-checks this list against actual JS usage in our modules (see
> `.github/workflows/lint.yml` "LuCI API allowlist").
>
> Origin: [upgrade.md §4.C6](upgrade.md) — was meant to be a runtime CI matrix
> across docker openwrt/sdk images per LuCI version, but real cross-version
> docker runs cost a lot of CI minutes for low signal. This static
> allowlist + manual test-matrix is the pragmatic alternative.

## Verified versions

Manually verified by deploying the ipk and exercising every Phase 1+2+3
feature on the listed LuCI / firmware combinations:

| LuCI version | Firmware | Status | Verified on |
|---|---|---|---|
| 26.136 (`openwrt-24.10` branch) | ImmortalWrt 24.10-SNAPSHOT | ✅ Working (Round 41 baseline; Round 42 in MTK CI verification) | 2026-05-23 |
| 23.05 | OpenWrt 23.05.x stable | ⏳ Untested | — |
| 22.03 | OpenWrt 22.03.x stable | ⏳ Untested | — |
| 21.02 | OpenWrt 21.02.x stable | ⏳ Untested | — |

Round 42 introduces the cross-branch CI matrix (`.github/workflows/build-matrix.yml`,
planned Step 169) that runs `make package/.../install` against `(immortalwrt-24.10,
immortalwrt-snapshot, openwrt-24.10, lean-23.05) × (x86_64, mt7986)` on a weekly
cron. CI green ≠ runtime green but does prove the ipk packs cleanly across the
matrix — useful for catching luci-base file-collision regressions like the one
that triggered Round 42 (see also `.github/workflows/lint.yml` "Check for
luci-base path collisions" job from Step 160).

## LuCI APIs we depend on

Files listed are where each surface is used. If LuCI removes or renames
any of these, **at least one of these files needs an update**.

### Core globals (assumed always present)

| Symbol | First seen | Used by | Notes |
|---|---|---|---|
| `L.env` | LuCI 18+ | every module | dispatch info, media url base |
| `L.url(path…)` | LuCI 18+ | cmdk, menu-design, traffic | path → URL builder |
| `L.bind(fn, ctx)` | LuCI 18+ | every module | jQuery-style fn binding |
| `L.require(name)` | LuCI 18+ | footer.htm | dynamic module loader |
| `L.resolveDefault(p, d)` | LuCI 19+ | capability | promise default value |
| `L.rpc.declare(opts)` | LuCI 18+ | sparkline, wan-hero, devices, capability | typed RPC factory |
| `L.uci.changes()` | LuCI 19+ | apply-modal | pending uci-change tree |
| `L.uci.apply(timeout)` | LuCI 19+ | apply-modal | apply with rollback |
| `E(tag, attrs, kids)` | LuCI 18+ | every module | DOM builder |
| `_(string)` | LuCI 18+ | every module | i18n lookup |

### UI surface

| Symbol | Stability | Used by | Risk |
|---|---|---|---|
| `ui.menu.load()` | LuCI 19+ | menu-design, cmdk | stable but format may evolve |
| `ui.menu.getChildren(node)` | LuCI 19+ | menu-design, cmdk | stable |
| `ui.addNotification(t, m, …cls)` | LuCI 18+ | toast (intercepted) | stable signature; **Step 167 (Round 42)** wraps only on `L.env.luciversion` major in [18, 27]; outside the band, fall through to native banner |
| `ui.showModal(title, body)` | LuCI 18+ | quick-actions, apply-modal | stable |
| `ui.hideModal()` | LuCI 18+ | quick-actions, apply-modal | stable |
| `ui.createHandlerFn(this, name)` | LuCI 18+ | menu-design | stable |
| **`L.ui.changes.displayChanges`** | **internal** | apply-modal (monkey-patched) | **⚠ no stability contract** — patch has try/catch fallback; **Step 167** adds version-whitelist gate (major ∈ [18, 27]) so out-of-band releases use native Save&Apply modal |
| **`L.ui.changes.apply`** | **internal** | apply-modal (monkey-patched, Step 58) | **⚠ no stability contract** — same Step 167 whitelist as displayChanges |

### ubus objects

| Object.method | Used by | Notes |
|---|---|---|
| `system.info` | sparkline | LuCI 19+ stable; returns load/memory |
| `iwinfo.devices` | capability | LuCI 19+ stable |
| `iwinfo.assoclist` (planned) | devices (follow-up) | LuCI 19+ stable |
| `luci-rpc.getDHCPLeases` | devices | LuCI 18+ stable |
| `network.interface.<name>.status` | wan-hero (via helper) | accessed through LuCI `network.getWANNetworks()` helper |
| `file.exec` | quick-actions | LuCI 18+ stable, ACL-gated |

### Theme-provided rpcd ubus methods (Round 42 sub-B2, auth-gated)

Six read-only JSON metrics moved off the public `/cgi-bin/design/*` CGIs
into the `luci-theme-design-x` rpcd ubus object. ACL declaration at
`root/usr/share/rpcd/acl.d/luci-theme-design-x.json` grants only `read`
to authenticated LuCI sessions.

| ubus method | Args | Used by | Response shape | Migrated in |
|---|---|---|---|---|
| `luci-theme-design-x.devstats` | `{dev: string}` | wan-stats | `{dev, up, rx_bytes, tx_bytes}` or `{error,…}` | Step 164 |
| `luci-theme-design-x.cpustat` | none | sparkline | `{user, nice, system, …, total, busy}` | Step 165 |
| `luci-theme-design-x.temp` | none | sparkline, capability.thermal | `{zones: [int, …]}` | Step 165 |
| `luci-theme-design-x.host-traffic` | none | traffic | `{available, hosts: [{ip, tx_bytes, rx_bytes}]}` (3-branch) | Step 165 |
| `luci-theme-design-x.wifi-stations` | none | devices | `{available, interfaces: {wlanN: {info, assoclist}}}` (verbatim ubus passthrough) | Step 165 |
| `luci-theme-design-x.nlbw` | none | traffic | array OR `{columns, data}` (dual-shape tolerance) | Step 165 |

Backend: `root/usr/libexec/rpcd/luci-theme-design-x` (shell script, single
case dispatch). Mirrors the legacy CGI's response shapes byte-for-byte
including unusual contracts (devstats returning HTTP 200 + error payload
on bad input rather than HTTP 400; nlbw dual-shape; wifi-stations verbatim
ubus stitching) so JS consumers need no shape adaptations.

Frontend pattern: `rpc.declare({object, method, params, expect})`. Six
declarations across 5 JS files (callDevstats in wan-stats, callTemp twice
in sparkline + capability, callCpustat in sparkline, callHostTraffic +
callNlbw in traffic, callWifiStations in devices).

### Theme-provided LuCI Lua controller routes (Round 42 sub-B2, auth-gated)

Three streaming endpoints that can't go through rpcd's JSON-RPC framing.

| URL | Method | Used by | Notes | Migrated in |
|---|---|---|---|---|
| `/cgi-bin/luci/admin/design-x/ping` | GET | wan-hero, speedtest | 5-byte `pong`; RTT-based latency probe | Step 166 |
| `/cgi-bin/luci/admin/design-x/download?bytes=N` | GET | speedtest | `/dev/urandom` stream, bytes clamped [1024, 1073741824] | Step 166 |
| `/cgi-bin/luci/admin/design-x/upload` | POST | speedtest | discards body chunk-by-chunk via setfilehandler | Step 166 |

Backend: `luasrc/controller/admin/design_x.lua`. `luci.controller.admin.design_x`
module registers 3 leaf entries via `entry()` + `dependent = false`. LuCI's
default session dispatcher applies the auth check before invoking the
`action_*` handler.

**Dependency**: this controller requires `+luci-lua-runtime` to run (default-
absent on immortalwrt 24.10), enforced via `LUCI_DEPENDS:=+luci-base
+luci-lua-runtime` in the Makefile. A ucode-controller dual-track parallel
to the template dual-track (Step 161) is planned for a follow-up Round to
drop the lua-runtime hard dependency.

### Legacy `/cgi-bin/design/*` CGI scripts (deprecated, kept for rollback)

The original 9 unauthenticated CGI scripts at `root/www/cgi-bin/design/`
remain on disk through Round 42:
- `devstats`, `cpustat`, `temp`, `host-traffic`, `wifi-stations`, `nlbw`,
  `ping`, `download`, `upload`

All 9 have been superseded by either an ubus method (the 6 JSON ones) or a
LuCI Lua controller route (the 3 streaming ones). They are retained as
rollback fallbacks while user verifies the new paths in production. A
follow-up cleanup Step (post-Round-42-verification) will `git rm` all 9 in
one sweep.

### Template engine surface

The theme ships templates in BOTH Lua (.htm) and ucode (.ut) dialects
since Round 42 Step 161 — dual-track for forward compat with LuCI 24.10+
which ships luci-base without luci-lua-runtime by default. LuCI's template
engine prefers .ut when both are present; LuCI ≤ 21.02 only sees .htm.

| Template file | Used by | Migrated in |
|---|---|---|
| `luasrc/view/themes/design-x/header.htm` (Lua) | LuCI ≤ 23.05 | Originally Step 1 |
| `luasrc/view/themes/design-x/footer.htm` (Lua) | LuCI ≤ 23.05 | Originally Step 1 |
| `root/usr/share/ucode/luci/template/themes/design-x/header.ut` (ucode) | LuCI 24.10+ | Step 161 |
| `root/usr/share/ucode/luci/template/themes/design-x/footer.ut` (ucode) | LuCI 24.10+ | Step 161 |

Known ucode-track limitation: the root-no-password security warning
block is fail-closed (no warning shown) on the ucode track because
`/etc/shadow` is 0600 owned by root and rpcd runs as non-root.
The Lua track at `header.htm` still fires the warning where
luci-lua-runtime grants root access. TODO(Round 43+): expose root-pw
status via an rpcd ACL'd ubus object so the ucode template can probe
it via `ubus.call(...)` instead.

## Cross-version manual test plan

Before bumping `IMMORTALWRT_VERSION` env in `build.yml` (or accepting an
upstream LuCI bump), exercise this checklist on the new platform:

1. **Page loads at all** — `/cgi-bin/luci/` returns 200, no JS console errors
2. **Sidebar menu** — first menu icon visible (Lucide migration); click a
   first-level item, sub-menu expands and stays expanded (T6 / v4 §10.10
   regression)
3. **Cmd+K** — `⌘K` opens palette, type 3 chars, hit Enter, navigates
4. **Toast** — change any setting, click Save → toast appears bottom-right
5. **Overview cards** — WAN Hero shows real IP + ping; CPU / Mem tiles tick
   every 5s; Speedtest button runs full cycle; Devices lists DHCP leases
6. **Quick actions** — ⚡ button → Reload firewall → success toast
7. **Apply modal** — change setting → Apply → diff modal appears (not the
   stock blocking spinner); confirm → toast progress → page reload

Any failure means an API drift somewhere. Open an issue and add a row to
the table above.

## CI enforcement

Today: `lint.yml` Step "Forbid minifier-unsafe CSS" + "Forbid raw CJK" +
"Performance budget" + "CGI safety audit" prevent regressions in their
respective areas. There is **no** automated cross-version verification —
this is a manual gate.

Future C-future-1 (build-time CSS diff) and C-future-2 (visual regression
via Playwright + qemu) will close that gap. Backlog tasks T20 / T21.
