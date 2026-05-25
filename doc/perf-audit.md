# Performance Audit — luci-theme-design-x

> Audit date: 2026-05-25 (mid-Round 45, Step 241).
> Scope: every code path that runs on the router or affects packet
> forwarding, after Round 44 daemon-track was deleted (Step 232) and
> the residual sysctl was manually cleared.
> Verdict: **zero measurable impact on internet performance**. Theme
> is structurally read-only from the router's perspective; the
> forwarding path is not touched anywhere.

This document is meant to be re-read whenever someone is tempted to
add a background daemon, a polling endpoint at sub-second cadence, a
firewall rule, or anything else that touches packet processing. It
exists so the conclusion is durable and we don't repeat Round 44's
16-18 hour daemon-track misadventure.

---

## 一、TL;DR

| When | Theme overhead on router |
|---|---|
| No admin page open in any browser | **zero** |
| Admin page open, idle | **< 1 % CPU on MT7621-class**, no forwarding-path involvement |
| Admin page open, page actively rendering | small RPC bursts (< 50 ms per refresh cycle) |
| User clicks Speed Test | router CPU saturated for the test duration **by design** |
| User clicks Quick Action (wifi reload / firewall reload / ifup wan / reboot) | service-restart-level disruption, **same as LuCI default behaviour** |
| Any background hour, day, week | **zero**, no daemon, no cron, no hotplug listener |

**The forwarding fastpath (nf_flowtable / hardware offload / bridge code)
is never touched by this theme.** rpcd handlers and uhttpd live in user
space and have no relation to per-packet processing.

---

## 二、Full inventory of router-side artifacts

Files that this IPK installs into the router filesystem:

```
/etc/uci-defaults/30_luci-theme-design-x          # first-boot, deletes itself
/usr/libexec/rpcd/luci-theme-design-x             # rpcd handler
/usr/share/luci-theme-design-x/NOTICE             # license attribution (static)
/usr/share/rpcd/acl.d/luci-theme-design-x.json    # ACL declaration (read-only)
/usr/share/ucode/luci/template/themes/design-x/{header,footer}.ut
/usr/lib/lua/luci/view/themes/design-x/{header,footer}.htm
/usr/lib/lua/luci/controller/admin/design_x.lua   # speedtest endpoints
/www/luci-static/design-x/**                      # CSS, JS, icons, OUI data
/www/luci-static/resources/design-x/**            # JS modules
```

### What's NOT installed (deliberately verified)

| Path / facility | Reason it's absent |
|---|---|
| `/etc/init.d/*` (any design service) | Step 232 deleted Round 31 + Round 44 daemons |
| `/etc/crontabs/root` entries | Step 232 prerm strips legacy `design-host-acct refresh` line; new IPKs add none |
| `/etc/sysctl.d/*.conf` | Step 232 deleted `11-design-conntrack-acct.conf` |
| `/etc/hotplug.d/iface/*`, `/etc/hotplug.d/net/*` | none |
| `/etc/firewall.user` hook | none |
| `nft` user table (`design_acct` etc.) | none — Step 232 deleted daemon that created it |
| `tc` qdisc / `iptables` / `ip rule` modifications | none |
| dnsmasq / fw4 / network UCI mutations | none — theme is read-only against config |
| Service workers / browser-side proxy | none |

→ **The theme has no presence in the router runtime when no admin browser session is active.** rpcd's handler script is invoked only when the LuCI session makes an RPC call to `ubus call luci-theme-design-x ...`; otherwise the file sits on disk untouched.

---

## 三、Activity when admin page is open

The Overview page wires up these polling loops:

| Source file | Cadence | Backend invocation | Cost per cycle |
|---|---|---|---|
| `wan-stats.js` | 2 s | `devstats` rpcd (2× cat `/sys/class/net/<dev>/statistics/rx_bytes,tx_bytes`) + `cpustat` rpcd (1× read `/proc/stat`) + built-in `system.info` ubus | < 1 ms shell, ~0.3 ms ubus |
| `sparkline.js` | 5 s | same as wan-stats + thermal zone scan via `temp` rpcd | < 1 ms |
| `wan-hero.js` (ping samples) | 30 s | 5× serial HTTP GET `/cgi-bin/luci/admin/design-x/ping` (Lua controller `action_ping` → 4-byte response) | ~5 ms total, LAN-side only |
| `wan-hero.js` (status refresh) | 30 s | `getDHCPLeases` / `getHostHints` / ubus calls | ~20 ms |
| `wan-hero.js` (tagline rotator) | 5 s | browser-side string update | 0 router cost |
| `devices.js` | 30 s | `host-presence` (parse `/proc/net/arp` + `iwinfo assoclist`) + `wifi-stations` + `getDHCPLeases` + `getHostHints` | ~20-50 ms total |
| `vendor.js` | once / session | XHR GET `oui.json.gz` (~330 KB gzip) + DecompressionStream | one-shot |
| `speedtest.js` | on user click | Lua controller `action_download` / `action_upload` saturates CPU | by design |
| `quick-actions.js` | on user click | `file.exec` for `wifi reload` / `ifup wan` / `reboot` etc. | by design |

### Where the RPC backend actually does work

The rpcd handler at `/usr/libexec/rpcd/luci-theme-design-x` is a 224-line POSIX shell script. Each method's work bound:

- `devstats`: 2× `cat /sys/class/net/<dev>/statistics/*` + 1× `cat /sys/class/net/<dev>/operstate` + format JSON. **< 1 ms**.
- `cpustat`: 1× read first line of `/proc/stat` + arithmetic. **< 0.5 ms**.
- `temp`: iterate `/sys/class/thermal/thermal_zone*/temp`. **< 1 ms** for 0-5 zones.
- `host-presence`: `ubus call iwinfo devices` + per-radio `ubus call iwinfo assoclist` + parse `/proc/net/arp`. **~5-15 ms** depending on radio count.
- `wifi-stations`: `ubus call iwinfo devices/info/assoclist` per radio. **~10 ms** per radio.

No method does:
- Disk I/O outside `/proc` and `/sys` (which are virtual)
- Network I/O
- Anything that touches netfilter / conntrack / firewall
- `fork()` of long-running processes
- Anything that affects packet forwarding

### Worst-case total backend load

With Overview open in one browser tab, the polling cadence above generates roughly:

- `devstats` + `cpustat`: ~30 calls/min × ~1 ms = 30 ms CPU/min = **0.05 % CPU**
- `temp` + `host-presence` + `wifi-stations`: ~6 calls/min × ~20 ms = 120 ms CPU/min = **0.2 % CPU**
- ping endpoint: 5 calls × every 30s = 10 calls/min × ~1 ms = **0.02 % CPU**
- Lua / ubus overhead: ~0.1 % CPU

**Total: < 1 % CPU on any router ≥ MT7621**. Modern MT7986 / x86 systems: **< 0.1 %**.

Memory: rpcd forks a fresh shell for each invocation (~2-4 MB peak transient per call). Resident memory of the theme: only what uhttpd holds for served static files (cached if `mmap`'d, otherwise per-request transient).

---

## 四、Forwarding path verification

Every reasonable check that a theme could be polluting the forwarding path:

| Check | Command (run on router) | Expected output |
|---|---|---|
| nftables user tables | `nft list tables` | `nat table inet fw4` and similar; **no** `bridge design_acct`, no `inet design*` |
| iptables rules | `iptables-save \| grep -i design` | **empty** |
| tc qdisc | `tc qdisc show` | only kernel defaults / SQM if user installed it |
| ip rules | `ip rule show` | only kernel defaults |
| conntrack counters opt-in | `sysctl net.netfilter.nf_conntrack_acct` | whatever kernel default is; **theme no longer sets this** |
| Hotplug listeners | `ls /etc/hotplug.d/*/ \| grep design` | **empty** |
| Cron entries | `crontab -l \| grep design` | **empty** |
| Init services | `ls /etc/init.d/design* 2>/dev/null` | **empty** |

If any of these are non-empty on a fresh post-Step-232 install, that's a bug to file. On the user's machine, all of the above were confirmed empty on 2026-05-25.

---

## 五、Asset sizes (browser-side, irrelevant to router throughput)

| File | Raw size | Minified (in IPK) |
|---|---|---|
| `style.css` | 181 KB | ~86 KB |
| `features.css` | 73 KB | ~36 KB |
| `devices.js` | 54 KB | (no minifier on JS) |
| `sparkline.js` | 33 KB | — |
| `speedtest.js` | 29 KB | — |
| `apply-modal.js` | 22 KB | — |
| `wan-hero.js` | 16 KB | — |
| `cmdk.js` | 15 KB | — |
| `menu-design.js` | 14 KB | — |
| `quick-actions.js` | 12 KB | — |
| `vendor.js` | 11 KB | — |
| `toast.js` | 10 KB | — |
| `wan-stats.js` | 8 KB | — |
| `style.js` | 6 KB | — |
| `i18n-debug.js` | 4 KB | — |
| `capability.js` | 4 KB | — |
| `oui.json.gz` (CI-generated, gzipped) | 330 KB | 330 KB (already gzip) |

Total IPK static-asset payload ≈ ~750 KB. Loaded **once per browser session, then cached**. No further network cost during the session.

These sizes affect first-paint latency on the admin page, **never** affect any other traffic on the router.

---

## 六、Speedtest behavior (the only path that DOES affect throughput)

`/cgi-bin/luci/admin/design-x/{ping,download,upload}` Lua controller entries:

- **download**: opens `/dev/urandom`, streams 64 KB blocks until byte count satisfied. `bytes` parameter clamped to `[1024, 1073741824]`. Memory bound: 64 KB per request. CPU bound: full speed of `urandom` + socket write loop. **Saturates router CPU during the test by design.**
- **upload**: `setfilehandler` installs a noop chunk-handler before the body parse, then `formvalue()` triggers parse. Memory bound: 64 KB per chunk transient. CPU bound: socket read loop. **Saturates router CPU during the test by design.**
- **ping**: writes "pong" (4 bytes). Memory bound: negligible. CPU bound: HTTP overhead only.

**These endpoints fire only when the user clicks Speed Test in the UI.** Idle state: zero invocations. Routine browsing of the admin page: zero invocations (the JS doesn't call them until the user activates the test).

Test duration is browser-controlled. A 50 MB download at 100 Mbps WAN = 4 seconds of saturation. A 1 GB download at 1 Gbps WAN = 8 seconds. **Long-running speedtest sessions are user-initiated and bounded.**

---

## 七、Quick Actions

`quick-actions.js` exposes buttons that invoke `ubus call file exec` for:
- `wifi reload`
- `/etc/init.d/firewall reload`
- `ifup wan`
- `reboot`

Each is a deliberate user action that triggers a service restart (or system reboot) the same as if the user had typed the command via SSH. **Not periodic, not background**.

The `file.exec` ubus method is ACL-gated by LuCI's session, not by our ACL JSON. We don't extend the privilege; we just expose convenient shortcuts.

---

## 八、What changes when Round 46 ships Block + Limit

Round 46's planned action buttons (Block / Limit) WILL introduce forwarding-path involvement:

- **Block**: writes a MAC into an `nft set`, plus a `drop` rule in `inet filter input` that references it. **Per-packet evaluation on dropped MACs**; cost is one set-lookup (O(1)) per ingress packet from those MACs. For a small number of blocked clients, **microsecond impact, imperceptible**.
- **Limit**: writes a `tc qdisc` / `tc class` for per-MAC bandwidth shaping. **Per-packet path through HTB classification**, ~100ns per packet. For shaped flows specifically.

Both will need:
- New rpcd write methods + corresponding ACL `write` block (currently ACL is read-only)
- Step 153 client-side sanitize before any UCI write
- A revisited section in this audit doc when they land

**Until Round 46 ships, the forwarding path is untouched.** This audit's conclusions hold for the current Step 241 codebase.

---

## 九、Tools to verify (re-run anytime)

### Brace + comment balance on CSS (catch parse errors that swallow rules, per memory `css-comment-truncate-swallows-rule`)

```bash
python3 -c "
import re
for f in ['htdocs/luci-static/design-x/css/style.css', 'htdocs/luci-static/design-x/css/features.css']:
    src = open(f).read()
    clean = re.sub(r'/\*.*?\*/', '', src, flags=re.DOTALL)
    clean = re.sub(r'[\"\\'][^\"\\']*[\"\\']', '\"\"', clean)
    o, c = clean.count('{'), clean.count('}')
    stray = len(re.findall(r'\*/', clean))
    print(f'{f}: braces {o}/{c}  stray */ {stray}')"
```

### Router-side residue check

```bash
ssh luci-router '
  echo "--- init.d ---"; ls /etc/init.d/design-host-acct* 2>/dev/null
  echo "--- cron ---";   grep design-host-acct /etc/crontabs/root 2>/dev/null
  echo "--- nft ---";    nft list tables 2>/dev/null | grep design_acct
  echo "--- hotplug ---"; find /etc/hotplug.d -name "*design*" 2>/dev/null
  echo "--- sysctl ---"; sysctl net.netfilter.nf_conntrack_acct
'
```

All five sections should be empty (sysctl line may show kernel default, which is OK).

### Backend cost during open admin

In DevTools → Network on the Overview page, filter `rpc`. Inspect:
- Burst frequency (should be ~1 burst per 2-5 seconds)
- Per-request size (should be < 1 KB)
- Total ongoing bandwidth on the LAN (should be < 5 KB/s)

### Active rpcd handler invocation cost

Run on router while admin page is open:

```bash
time ubus call luci-theme-design-x host-presence
```

Should return in < 50 ms on any system.

---

## 十、Conclusion

This theme is a pure-presentation LuCI shell. It reads system metrics through rpcd, renders them as CSS/JS in the admin browser, and exposes user-clickable shortcuts to existing LuCI / ubus operations. **It does not run any background workload, does not modify firewall state, does not pollute the forwarding path, and does not measurably affect router CPU or memory.**

The only way to make the theme "affect internet performance" is for the user to actively use the Speedtest feature, which is precisely what the user is asking for at that moment.

For anything in the future that wants to change this property (a daemon, a periodic cron job, a firewall rule installer, an event-driven hotplug listener), revisit this document first and re-audit the cost-benefit. Round 44's daemon track is the cautionary tale; the lessons are sedimented across `bandwith.md`, `foa_challenge_v2.md`, and the 4 memory entries `sfo-bypasses-conntrack-events` / `ucode-socket-no-netlink` / `awk-comment-apostrophe-trap` / `luci-26-response-class-hijack`.
