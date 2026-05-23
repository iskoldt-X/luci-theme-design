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
| 26.136 (`openwrt-24.10` branch) | ImmortalWrt 24.10-SNAPSHOT | ✅ Working | 2026-05-23 |
| 23.05 | OpenWrt 23.05.x stable | ⏳ Untested | — |
| 22.03 | OpenWrt 22.03.x stable | ⏳ Untested | — |
| 21.02 | OpenWrt 21.02.x stable | ⏳ Untested | — |

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
| `ui.addNotification(t, m, …cls)` | LuCI 18+ | toast (intercepted) | stable signature |
| `ui.showModal(title, body)` | LuCI 18+ | quick-actions, apply-modal | stable |
| `ui.hideModal()` | LuCI 18+ | quick-actions, apply-modal | stable |
| `ui.createHandlerFn(this, name)` | LuCI 18+ | menu-design | stable |
| **`L.ui.changes.displayChanges`** | **internal** | apply-modal (monkey-patched) | **⚠ no stability contract** — patch has try/catch fallback |

### ubus objects

| Object.method | Used by | Notes |
|---|---|---|
| `system.info` | sparkline | LuCI 19+ stable; returns load/memory |
| `iwinfo.devices` | capability | LuCI 19+ stable |
| `iwinfo.assoclist` (planned) | devices (follow-up) | LuCI 19+ stable |
| `luci-rpc.getDHCPLeases` | devices | LuCI 18+ stable |
| `network.interface.<name>.status` | wan-hero (via helper) | accessed through LuCI `network.getWANNetworks()` helper |
| `file.exec` | quick-actions | LuCI 18+ stable, ACL-gated |

### Theme-provided CGI (own surface)

| URL | Method | Used by | Notes |
|---|---|---|---|
| `/cgi-bin/design/ping` | GET | wan-hero, speedtest | echoes `pong` |
| `/cgi-bin/design/temp` | GET | sparkline, capability.thermal | JSON `{zones:[]}` |
| `/cgi-bin/design/download?bytes=N` | GET | speedtest | random bytes |
| `/cgi-bin/design/upload` | POST | speedtest | discards body |

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
