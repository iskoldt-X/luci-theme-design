# luci-theme-design — Theming toolbox (LuCI 26.x)

> Cross-Round distilled reference: the techniques that *actually work* on
> LuCI 26.x (ImmortalWrt 24.10-SNAPSHOT) when the obvious approach fails.
> Audience: future Claude sessions continuing this codebase, human reviewers
> trying to understand why things look the way they do.

Each entry: **Problem → Pattern → Why it works → Pitfalls → First seen in**.

If you're continuing a session on this repo, read this first. Most "I tried
the obvious thing and it didn't stick" surprises in LuCI theming are
documented below.

---

## Index

1. [File-override (drop-in replace upstream resources)](#1-file-override)
2. [CSS hide via `:has()` + stable LuCI ID](#2-css-hide-via-has--stable-luci-id)
3. [Overriding LuCI's inline styles](#3-overriding-lucis-inline-styles)
4. [Inline SVG data URI + CSS mask for icons](#4-inline-svg-data-uri--css-mask)
5. [UCI write → service validation pipeline](#5-uci-write--service-validation-pipeline)
6. [Streaming live metrics (sliding window + throttle)](#6-streaming-live-metrics)
7. [Adaptive scale + monotone-up ratchet](#7-adaptive-scale--monotone-up-ratchet)
8. [Save&Apply double-patch on LuCI 26.x](#8-saveapply-double-patch)
9. [`L.uci.changes()` is async](#9-luci-changes-is-async)
10. [`resource_version` cascading via `?v=`](#10-resource_version-cascading)
11. [Diagnostic discipline — don't restart blind](#11-diagnostic-discipline)
12. [CGI bypass for ACL-denied RPC](#12-cgi-bypass-for-acl-denied-rpc)
13. [Tooltip vs inline — where data goes](#13-tooltip-vs-inline)
14. [`toastSafe` — defensive notification wrapper](#14-toastsafe)
15. [dev-sync.sh — the ~1s ship cycle](#15-dev-sync-the-1s-ship-cycle)
16. [rpcd write methods + ACL `write` block](#16-rpcd-write-methods--acl-write-block) — Round 46
17. [`/usr/share/nftables.d/` directory semantics](#17-nftablesd-directory-semantics) — Round 46
18. [Atomic-replace prelude for fw4 include files](#18-atomic-replace-prelude) — Round 46
19. [BusyBox-safe shell idioms](#19-busybox-safe-shell-idioms) — Round 46
20. [Verify-first workflow checklist](#20-verify-first-workflow-checklist) — Round 46
21. [LuCI session modal for destructive UI actions](#21-luci-session-modal) — Round 46

---

## 1. File-override

**Problem.** You want to replace an icon, image, or static asset that LuCI
upstream ships in `/usr/share/ucode/luci/...` or `/www/luci-static/resources/...`.
You can't edit upstream files (they get overwritten on opkg upgrade).

**Pattern.** Drop a file at the same path *inside the theme*:

```
htdocs/luci-static/design/<exact-upstream-relative-path>
```

OpenWrt's web server resolves theme assets ahead of upstream resources for
paths under `/luci-static/<theme>/`. Combined with how the theme renders
references (template helpers like `resource()`), the override takes effect
on next page load — no cache bust, no opkg dance.

For assets referenced by *upstream* code via `/luci-static/resources/...`,
you still need a CSS rule that points the upstream selector at your
overridden path; see §4 (inline SVG mask) for the typical case.

**Why it works.** uhttpd serves from theme directories first; LuCI's
`resource()` helper composes URLs relative to the active theme; upstream
JS that hardcodes `/luci-static/resources/...` paths can be re-targeted
via CSS `background-image` or `mask` overrides.

**Pitfalls.**
- `dev-sync.sh` deliberately runs rsync **without `--delete`**, so an
  overridden file persists on the router even if you remove it from the
  source. Clean up by SSH'ing in and `rm` manually, or one-off `rsync
  --delete` from a clean workdir.
- Upstream may rename the asset on its next release. Pin tested upstream
  version in the commit message when you override.

**First seen in.** Rounds 32–33 (SVG icon overrides for sidebar nav).

---

## 2. CSS hide via `:has()` + stable LuCI ID

**Problem.** You want to hide a LuCI-rendered section (e.g. the old DHCP
leases tables on the Status Overview page, replaced by your custom LAN
Clients card). You add `display: none` via JS in `requestAnimationFrame`
or `MutationObserver`. **It comes back** — because LuCI re-renders the
container with `.fade-in`, blowing away your inline style.

**Pattern.** Use a CSS rule anchored on a stable LuCI-shipped element ID,
with `:has()` to walk up to the wrapper:

```css
/* hide the wrapper that contains the upstream lease tables */
.node-admin-status-overview #view div:has(> #status_leases),
.node-admin-status-overview #view div:has(> #status_leases6) {
    display: none !important;
}
/* belt-and-suspenders: hide the tables themselves too */
.node-admin-status-overview #view #status_leases,
.node-admin-status-overview #view #status_leases6 {
    display: none !important;
}
```

**Why it works.** CSS doesn't lose to JS re-renders — every time LuCI
swaps the DOM, the rule re-applies. `:has()` lets you target a parent by
its descendant, which is essential when LuCI ships a stable child ID but
the parent is anonymous.

**Pitfalls.**
- `:has()` support: Chrome 105+, Firefox 121+, Safari 15.4+. Project
  target is current evergreen browsers, so OK. Document the floor
  somewhere if you ship to older clients.
- Always anchor on a `body.node-*` class so the rule doesn't bleed to
  pages that happen to share an ID by coincidence.
- LuCI's stable IDs come from upstream templates — they CAN change
  across LuCI minor versions. Comment the rule with which LuCI version
  the ID was verified against.
- Stick to `display: none !important`. `visibility: hidden` reserves
  layout space; LuCI's grid will then have a gap.

**First seen in.** Step 151 (Round 40), after Steps 149-150 tried JS
DOM scan and MutationObserver — both lost to LuCI's `.fade-in` re-render.

**Lesson.** *JS-vs-rerender is a war CSS wins.*

---

## 3. Overriding LuCI's inline styles

**Problem.** Upstream LuCI templates set styles via `style="..."`
attributes hardcoded in the template. Your stylesheet rule, however
specific, loses to inline style.

**Pattern.** Use an attribute substring selector with `!important`:

```css
/* Neutralize LuCI's inline rgba background on table cells */
.node-admin-status-overview td[style*="background-color: rgba"] {
    background-color: transparent !important;
}

/* Or override an inline width */
table[style*="width: 100%"] th[style*="width:"] {
    width: auto !important;
}
```

**Why it works.** Inline styles have specificity (1,0,0,0) plus an
implicit `!important`-like position in cascade rules — but actual
`!important` in a stylesheet still wins. The attribute substring
selector `[style*="..."]` lets you target inline-styled elements without
listing every concrete element.

**Pitfalls.**
- Substring matching is fragile to whitespace and order. `style*="rgb("`
  matches both `rgb(...)` and `rgba(...)`. Pick the most distinctive
  fragment for your target.
- Don't use this to fight your own theme's CSS — only for upstream HTML
  you can't modify.
- A few LuCI views render styles via JS instead of template `style="…"`.
  Those bypass this pattern; you'll need MutationObserver — or, better,
  CSS rule on a stable class/id those JS bits set.

**First seen in.** Round 34 (search-and-replace through upstream view
inline styles).

---

## 4. Inline SVG data URI + CSS mask

**Problem.** You want to replace an icon where the DOM is rendered by
upstream LuCI JS or template — you can't change the `<img>` src or
`<i>` class. Background-image works but won't tint with `currentColor`,
so a single icon can't follow light/dark theme.

**Pattern.**

```css
.upstream-icon-selector {
    /* tint via background-color, shape via mask */
    background-color: currentColor;
    -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M3 12h18M3 6h18M3 18h18'/></svg>") no-repeat center / contain;
            mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M3 12h18M3 6h18M3 18h18'/></svg>") no-repeat center / contain;
    width: 20px;
    height: 20px;
}
```

**Why it works.** CSS `mask` clips a colored layer to the SVG shape;
the color comes from `background-color`, which you can drive with
`currentColor`. The SVG path goes inline as a `utf8` data URI — no
extra HTTP round trip, no cache issues.

**Pitfalls.**
- The `#` inside the SVG (e.g. `fill='#000'`) MUST be URL-encoded as
  `%23` inside the `url(...)` string, or the browser truncates at `#`.
- Use single quotes around SVG attribute values (so you can wrap the
  whole thing in double quotes inside `url(...)`).
- Don't forget the `-webkit-` prefix — Safari still needs it.
- Lucide-style line icons read consistently at `viewBox 24` with
  `stroke-width 1.5`, `stroke-linecap round`, `stroke-linejoin round`.
  Pick this once for the whole theme and stick to it.
- `mask-size: contain` (here `... / contain`) prevents distortion when
  the element's aspect ratio doesn't match the icon's.

**First seen in.** Rounds 32-33 (sidebar nav icons).

---

## 5. UCI write → service validation pipeline

**Problem.** You add a feature that lets the user edit a value (rename
a device, set a DHCP override, etc.). The value goes into UCI via
`uci.set('dhcp', sid, 'name', value)`. The user types something the
consuming service rejects. **The service crashes on its next reload.**
procd retries 6 times in 25s, gives up, and you have a system-wide
infra outage (no DHCP, no local DNS) until manually fixed via SSH.

This actually happened. See `memory/uci-write-needs-service-validation.md`
for the postmortem of the 2026-05-24 7-hour LAN outage.

**Pattern.** Sanitize client-side BEFORE writing UCI, against the
consuming service's documented grammar. For dnsmasq DHCP host names
(RFC 952/1123):

```js
function sanitizeHostname(input) {
    if (!input) return '';
    return input
        .trim()
        .replace(/[\s_]+/g, '-')           // whitespace/underscore → hyphen
        .replace(/[^a-zA-Z0-9-]/g, '')     // strip non-alphanumeric-hyphen
        .replace(/-+/g, '-')               // collapse consecutive hyphens
        .replace(/^-+|-+$/g, '')           // strip leading/trailing hyphens
        .substring(0, 63)                  // RFC 1035 label limit
        .replace(/-+$/, '');               // re-strip if truncation left hyphen
}
```

Caller:

```js
var raw = window.prompt(_('Rename device') + ' — letters, digits, hyphens only', current);
if (raw === null) return;             // user cancelled
raw = raw.trim();
var safe = raw === '' ? '' : sanitizeHostname(raw);

if (raw !== '' && safe === '') {
    toastSafe('error', _('Invalid hostname — use letters, digits, and hyphens only'));
    return;                            // raw non-empty that sanitizes to empty: reject
}
if (safe !== raw && safe !== '') {
    toastSafe('info', _('Saving as') + ' "' + safe + '"');
}
// proceed with uci.set('dhcp', sid, 'name', safe); uci.save(); uci.apply();
```

Empty `raw` is preserved (means "clear the override"); raw-non-empty
that sanitizes to empty (all unicode / all punctuation) is rejected
with a toast.

**Why it works.** UCI itself accepts any string. The consuming service
validates at *startup*, not at write time. So `uci commit` returns
success, `uci.apply()` returns success — and then the next service
reload finds your bad value, crashes, and procd eventually gives up.
Client-side sanitization is the only place where the user can be told
"that name won't work" while they still have a UI to correct it.

**Pitfalls.**
- Don't trust `uci.apply()` exit code. It returns success even when the
  downstream service is now in a crash loop.
- Don't trust `/etc/init.d/<svc> restart` either — that script's job is
  to invoke procd, not to keep the service alive.
- Constraint table per service (memorize, or look up via service man
  page → "name" / "format" sections):

  | Service | Field | Constraint |
  |---|---|---|
  | dnsmasq | DHCP host name | `^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$` |
  | dnsmasq | DNS domain name | dot-separated labels of the above |
  | nftables / fw4 | rule/chain name | `^[a-zA-Z0-9_-]+$`, ≤256 |
  | UCI | section name (named) | `^[a-zA-Z0-9_]+$`, ≤32 |
  | OpenWrt | interface `ifname` | ≤15 chars, no special chars |
  | OpenWrt | bridge member device | must match existing device |

- If unsure, look at upstream LuCI views editing the same field; they
  typically declare `Value.datatype = 'hostname'` (or similar) — that
  string is the validator you should mirror client-side.

**First seen in.** Step 152 (the bug) → Step 153 (the fix), Round 40.

**Reference.** `memory/uci-write-needs-service-validation.md`.

---

## 6. Streaming live metrics

**Problem.** You're doing a long HTTP request (speedtest download/upload)
and want to update a gauge in real-time as bytes flow. `r.blob()`,
`r.arrayBuffer()`, `r.text()` all block until the whole response is in
memory — the gauge stays at zero, then jumps to final value when done.
And for *upload* progress, `fetch()` has no API at all.

**Pattern A — Download (ReadableStream pump).**

```js
const r = await fetch(url, { signal: ctrl.signal });
const reader = r.body.getReader();
const samples = [];   // [{ ts, bytes }]
let totalBytes = 0;
const t0 = performance.now();

while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    const now = performance.now();
    samples.push({ ts: now, bytes: totalBytes });
    // drop samples older than the window
    while (samples.length > 1 && now - samples[0].ts > WINDOW_MS) {
        samples.shift();
    }
    // throttle UI to ~10fps
    if (now - lastUiUpdate > 100) {
        const span = (samples[samples.length-1].ts - samples[0].ts) / 1000;
        const bytes = samples[samples.length-1].bytes - samples[0].bytes;
        const Mbps = (bytes * 8 / 1e6) / Math.max(span, 0.001);
        setGauge(Mbps);
        lastUiUpdate = now;
    }
}
```

**Pattern B — Upload (XMLHttpRequest, because `fetch` can't).**

```js
const xhr = new XMLHttpRequest();
xhr.upload.onprogress = (e) => {
    // e.loaded grows, e.total is the payload size you set
    const now = performance.now();
    samples.push({ ts: now, bytes: e.loaded });
    /* sliding window + UI throttle as above */
};
xhr.open('POST', url);
xhr.send(blob);
```

**Why it works.**
- `ReadableStream.getReader().read()` resolves each chunk as the network
  delivers it. You compute Mbps from a sliding *window* (not cumulative
  total / elapsed) so the gauge reflects *current* throughput, not the
  average since t=0.
- `XMLHttpRequest.upload.onprogress` is the only standard upload-progress
  API. `fetch()`'s `Request` doesn't expose an `onprogress` hook, and
  there's no equivalent of `ReadableStream` for the *request* body's
  progress.
- 500ms window + 100ms UI throttle gives a responsive gauge that doesn't
  jitter on a single fast TCP window.

**Pitfalls.**
- Memory: don't keep the chunk Uint8Arrays — only their byteLength. The
  pattern above does this; if you mutate it to "collect the body", you
  defeat streaming.
- Sliding window of just 1 sample = divide by zero. The `Math.max(span,
  0.001)` guard above is essential.
- Cumulative byte counter must be authoritative — don't reset it
  mid-stream just because you trimmed samples.
- Upload progress reports request-body bytes, not "received by server".
  Hot-spotted upload still looks fast on `onprogress`.

**First seen in.** Steps 143-144 (Round 39), speedtest live gauge.

---

## 7. Adaptive scale + monotone-up ratchet

**Problem.** Your gauge's `max` is hardcoded — say 1000 Mbps — so a
2.5GbE link's actual speed clamps at the top, and a 10 Mbps ADSL link
wastes the whole dial. Or worse, you re-scale every frame to peak so
far, and the needle visually drifts backward when a new peak arrives
mid-test.

**Pattern.**

```js
const SCALES_MBPS = [100, 250, 500, 1000, 2500, 5000, 10000];
let currentScaleIdx = 0;

function setGauge(mbps) {
    // find smallest scale that fits the current peak
    while (currentScaleIdx < SCALES_MBPS.length - 1
           && mbps > SCALES_MBPS[currentScaleIdx]) {
        currentScaleIdx++;
    }
    const max = SCALES_MBPS[currentScaleIdx];
    const pct = Math.min(mbps / max, 1);
    // ... draw needle at pct, label dial at max
}

function resetGauge() {
    currentScaleIdx = 0;
}
```

**Why it works.**
- *Adaptive*: discrete scale list maps to "nice" dial labels (100, 250,
  500 etc.), instead of arbitrary "max so far".
- *Monotone-up*: `currentScaleIdx` never decreases mid-test. The gauge
  visually grows its dial when needed but never shrinks it, so the
  needle position is always consistent with what came before.
- `resetGauge()` between tests releases the ratchet.

**Pitfalls.**
- Don't choose your top scale too tight — a 2.5GbE link can transiently
  burst above the rated 2500. Include 5000, 10000 as safety.
- The dial label should update WHEN the scale changes, with a 200-300ms
  CSS transition — instant label swap is visually jarring.
- Monotone-up across *separate* tests is confusing (why does my gauge
  start at 5 Gbps before the test?). Reset between tests.

**First seen in.** Steps 145-146 (Round 39), speedtest gauge.

---

## 8. Save&Apply double-patch

**Problem.** You inject behavior into LuCI's Save&Apply flow (e.g. to
deduplicate a UCI change, or to trigger a side-effect after apply
completes). You patch `L.ui.changes.apply()`. **Half the apply flows
still bypass your patch.**

**Pattern.** Patch both:

```js
const origApply = L.ui.changes.apply.bind(L.ui.changes);
L.ui.changes.apply = function() {
    // your pre-apply work
    return origApply.apply(this, arguments).then((r) => {
        // your post-apply work
        return r;
    });
};

const origDisplayChanges = L.ui.changes.displayChanges.bind(L.ui.changes);
L.ui.changes.displayChanges = function() {
    const r = origDisplayChanges.apply(this, arguments);
    // your work to inject into the "review changes" modal
    return r;
};
```

**Why it works.** LuCI 26.x routes Save&Apply through `apply()` for
the button-press path, but `displayChanges()` runs in the "review
pending" modal flow as well, and some views invoke it directly.
Patching both catches all entry points.

**Pitfalls.**
- `origApply.bind(this)` matters — losing `this` here loses the
  internal apply state machine.
- Apply is async (Promise-returning). Don't synchronize post-apply work;
  chain via `.then()`.

**First seen in.** Memory: `luci-26-save-apply-routes.md`.

---

## 9. `L.uci.changes()` is async

**Problem.** You call `L.uci.changes()` to see what's pending, do
`Object.keys(result)`, and always get `[]` — even though you know there
ARE pending changes.

**Pattern.** Await it.

```js
const changes = await L.uci.changes();   // Promise<Object>
Object.keys(changes);                     // now correct
```

**Why it works.** On LuCI 26.x, `L.uci.changes()` returns a Promise.
Synchronous consumers see the Promise object, and `Object.keys(Promise)`
is `[]`.

**Pitfalls.**
- Don't paper over with `.then(...)` if your caller can be `async` —
  `await` reads cleaner.
- This broke real consumers in earlier LuCI port — search for `L.uci.changes(` without `await`/`then` and audit.

**First seen in.** Memory: `luci-26-uci-changes-promise.md`.

---

## 10. `resource_version` cascading

**Problem.** You bump a JS module and need clients to fetch the new
version. You update `?v=X` on the `<script>` tag for that module — but
modules `L.require()`'d from it still get cached.

**Pattern.** Bump `?v=X` ONLY on `luci.js`'s own `<script>` tag in
`header.htm`. Every module loaded via `L.require()` then derives its
own `?v=` from the running `luci.js`'s script src.

```html
<script src="<%=resource('luci.js')%>?v=20260524a"></script>
```

**Why it works.** LuCI parses its own `<script>` element's `src`
attribute at boot, extracts the `?v=` query, and propagates it as
`env.resource_version` — which `L.require()` then appends to every
module URL it requests.

**Pitfalls.**
- Bumping `?v=` on a module's `<script>` tag in addition to luci.js's
  is harmless but redundant.
- If you change non-JS resources (CSS, SVGs) you still need their own
  cache-bust strategy. `resource_version` only cascades to JS.

**First seen in.** Memory: `luci-26-resource-version-from-script-src.md`.

---

## 11. Diagnostic discipline

**Problem.** Something is broken on the router. The temptation is to
`/etc/init.d/<svc> restart` everything in sight. **DON'T.** That hides
root cause; the bug recurs as soon as state drifts back.

**Pattern.** SSH in. Read state without modifying it.

```sh
# Is the service even running?
ps w | grep <service> | grep -v grep

# What did it complain about, most recently?
logread | grep -i <service> | tail -50

# What does its UCI config say?
cat /etc/config/<service>

# What does the generated runtime config look like?
ls /var/etc/<service>.conf.* 2>/dev/null
sed -n '<line>p' /var/etc/<service>.conf.*

# Functional probe (read-only)
# dnsmasq:  nslookup google.com 127.0.0.1
# firewall: nft list ruleset | head -50
# network:  ip a; ip r; ubus call network.interface dump
```

THEN form a hypothesis. THEN test it with the minimal write. THEN
verify with the functional probe again.

**Pitfalls.**
- Restarting a service in a crash loop "fixes" it ~25 seconds, then
  procd gives up and the outage is worse than before.
- Multiple anomalies are NOT necessarily same-source. iPhone-can't-DNS
  + Mac-can't-DNS may share a root, or may be coincidence. Verify each
  symptom independently.
- procd's "crash loop give up" state needs `/etc/init.d/<svc> start`
  (not `restart`) after you've fixed the underlying bad value — restart
  often refuses to attempt re-start on a given-up service.
- Don't say "I'll just reboot the router" — same problem, you've now
  also added 60s of downtime AND you'll never know what was wrong.

**First seen in.** Round 40 incident postmortem. User's exact
directive that crystallized the rule: *"我想先知道问题在哪里，然后再说重启
任何服务的事情。先确认问题来源。"*

---

## 12. CGI bypass for ACL-denied RPC

**Problem.** Your JS calls `L.rpc.declare({ object: 'network.device',
method: 'status' })` and gets `-32002 Access denied`. Meanwhile,
SSH'd in, `ubus call network.device status` works fine.

**Pattern.** Route the call through a CGI endpoint that does the ubus
call server-side, instead of via the in-browser RPC.

```
/cgi-bin/luci/admin/.../my-cgi-endpoint
  → small Lua/ucode script that does ubus.call('network.device', 'status', {})
  → returns JSON
```

JS then `fetch('/cgi-bin/luci/...')`.

**Why it works.** LuCI 26.x's RPC ACL layer denies some ubus methods to
even the root LuCI session by default; the CGI handler runs as root
without going through that ACL layer.

**Pitfalls.**
- You're now responsible for auth checking in the CGI handler. Reject
  unauthenticated requests.
- Adds a request hop. Cache results on the JS side where appropriate.
- Some ubus methods accept parameters; sanitize before forwarding.

**First seen in.** Memory: `luci-26-network-device-status-acl.md`.

---

## 13. Tooltip vs inline

**Problem.** Where does tertiary data go — inline in the row, or in a
hover tooltip?

**Rule.**
- Inline = primary scan-by-eye fields. User reads horizontally across
  rows looking for differences. Keep these short, ≤2 lines per cell.
- Tooltip (`title=""` attr or richer hover popup) = tertiary detail.
  User has already identified the row of interest and wants to know more.
- Expandable detail row = secondary detail group. User wants ALL the
  context for one specific row but doesn't want to widen the table.

**Concrete example (LAN Clients card, Round 40).**
- Inline: Hostname, IP, MAC, Lease remaining, Signal, Actions
- Tooltip on hostname: vendor (OUI) — future Round 42+
- Expand row: IPv6 addresses, lease history, traffic counters

**Pitfalls.**
- Mobile / touch: tooltips on `:hover` don't work. Provide tap-to-show.
- `title=""` is screen-reader-friendly and free; reach for richer
  tooltip components only when you need formatting or links.

**First seen in.** Various; codified in Round 40 LAN Clients redesign.

---

## 14. `toastSafe`

**Problem.** `L.ui.addNotification(...)` doesn't exist on every LuCI
build. Your feature crashes on older clients.

**Pattern.**

```js
function toastSafe(level, msg) {
    try {
        if (L && L.ui && typeof L.ui.addNotification === 'function') {
            L.ui.addNotification(null, E('p', {}, msg),
                level === 'error' ? 'danger' : level);
            return;
        }
    } catch (e) { /* fall through */ }
    // Fallback: console + page-level banner
    console.log('[' + level + '] ' + msg);
    // optionally inject a minimal banner div
}
```

**Why it works.** Feature-detect, then call. The try/catch covers the
rare case where `L.ui` exists but `addNotification` throws on a
half-loaded LuCI.

**Pitfalls.**
- Don't swallow errors silently — at least `console.log` so debugging
  is possible.
- `level` names differ between LuCI eras. Normalize at the wrapper.

**First seen in.** Various Rounds; used heavily in Step 153 input
validation feedback.

---

## 15. dev-sync — the ~1s ship cycle

**Problem.** Edit a JS/CSS file, want to see it on the router *now*,
not 30 seconds later through opkg.

**Pattern.** `dev-sync.sh` watches the working tree with `fswatch` and
`rsync`s changed files to the router (`luci-router` SSH alias) on every
write. Round-trip from save → file present on router is ~1s.

```sh
# (from project root)
./dev-sync.sh
```

Refresh the LuCI page in the browser — new code runs.

**Key design choices.**
- **No `--delete`** in the rsync invocation. This is intentional. It
  lets file-override (§1) persist on the router across cleans of the
  source tree. The cost: leftover files require manual SSH `rm` to
  clean up. Worth it.
- **No service restart in dev-sync.** Pure file ship. If your change
  requires a service restart (rare for theme work), do it manually
  via SSH after sync.
- **JS/CSS only** — server-side templates (luasrc/view/) require
  `service rpcd reload` (or full LuCI reload) to take effect; dev-sync
  ships them but doesn't trigger the reload.

**Pitfalls.**
- If you `git checkout` a different branch, dev-sync ships the diff
  to the router. The router is now in a mixed state. Either ship from
  one branch only, or be aware.
- Cache: the browser caches resources by URL + `?v=`. Bump
  `resource_version` (§10) if a returning browser still shows old code
  despite dev-sync having shipped new code.

**First seen in.** Infrastructure layer — present since project start.

---

## Cross-references — memory files

These short-and-sharp memory files live under
`~/.claude/projects/-Users-nht435-GitHub-luci-theme-design/memory/`
and auto-load into Claude sessions:

- `luci-26-uci-changes-promise.md` → §9
- `luci-26-network-device-status-acl.md` → §12
- `luci-26-save-apply-routes.md` → §8
- `luci-26-resource-version-from-script-src.md` → §10
- `uci-write-needs-service-validation.md` → §5 (and Round 40 incident)

---

## When to add a section here

Add a new section to this file when you discover a LuCI 26.x technique
that:

1. The obvious approach **failed** (so the next person will hit the
   same dead end without this note),
2. The working approach is **non-trivial** (more than a one-liner — if
   it's a one-liner, just inline it in code),
3. It's likely to be **reused** (one-off hacks belong in their Step's
   commit message, not here).

Each entry should follow the **Problem → Pattern → Why it works →
Pitfalls → First seen in** structure. Cross-link to a memory file if
the technique has a short distilled form.

---

## 16. rpcd write methods + ACL `write` block

**Problem.** Your theme's frontend needs to *change* router state (not
just read it). Default ACL on `luci-theme-design-x.json` is read-only
— LuCI session can call read methods via ubus but write attempts get
rejected.

**Pattern.** Add a `write` block to ACL JSON next to the existing
`read` block, listing the ubus methods that mutate state:

```json
{
  "luci-theme-design-x": {
    "read":  { "ubus": { "luci-theme-design-x": [...read methods...] } },
    "write": { "ubus": { "luci-theme-design-x": ["block-mac", "unblock-mac"] } }
  }
}
```

Inside the rpcd handler shell script, just add a `case` branch per
new write method. Handler runs as root by default — can call `nft`,
`uci`, `iw`, etc. directly without needing `ubus call file exec`.

**Why it works.** rpcd's ACL gate runs BEFORE the handler is invoked.
With write block in place, LuCI session can call the listed methods
(no other ubus client can — unauth/wrong-user gets standard
`-32002 Access denied`). The handler's root privileges let it actually
mutate kernel/uci state.

**Pitfalls.**
- **Always server-side validate input** — Step 153 lesson. Client-side
  sanitize is a UX nicety; server-side regex is the security gate.
  Reject anything that could become an injection vector (MAC, hostname,
  filename, etc.).
- **Make methods idempotent**. nft `add element` succeeds even if the
  element already exists; `delete element` succeeds even if it doesn't.
  This shields against double-clicks + clock-skew retries.
- **`[ "$IPKG_INSTROOT" = "" ]` guard around live kernel ops** in
  Makefile prerm/postinst, so IPK pack-time fakeroot doesn't accidentally
  call `nft delete` on the build host.
- **Don't `set -e` in the handler** — partial failures in nft commands
  shouldn't kill the response.

**First seen in.** Round 46 Step 242 (Block backend).
See `root/usr/share/rpcd/acl.d/luci-theme-design-x.json` +
`root/usr/libexec/rpcd/luci-theme-design-x` for the live example.

---

## 17. `/usr/share/nftables.d/` directory semantics

**Problem.** You want to ship nftables rules that survive fw4 reload
and reboot, without modifying `/etc/config/firewall`.

**Pattern.** fw4 includes files from 6 hook directories. **Read
`/usr/share/nftables.d/README` on the live router first** — it's
authoritative. Summary:

| Directory                       | Include position                        | Can declare      |
|---------------------------------|-----------------------------------------|------------------|
| `ruleset-pre/` / `ruleset-post/`| Outside `table inet fw4 { ... }`        | Full `table` blocks ✓ |
| `table-pre/`   / `table-post/`  | Inside `table inet fw4 { ... }`         | Chains, sets, maps, elements — **NOT** wrapped `table` |
| `chain-pre/$chain/` / `chain-post/$chain/` | Inside named chain of fw4 table | Rule statements only |

For standalone tables (Block feature pattern), use `ruleset-post/`.
For appending into fw4's own chains, use `chain-post/$chain/`.

**Why it works.** fw4 inlines these via `nft -f` at reload time. The
directory name controls the textual position of the include, which
determines what nft syntax is legal at that point.

**Pitfalls.**
- **Wrong directory = silent fw4 reload syntax error** that wipes
  your table on every reload. Round 46 Step 242a burned 1 hotfix
  on this exact mistake.
- **`nft -f` of a chain block APPENDS rules** — multiple reloads
  double / triple the rule count. Use the atomic-replace prelude
  (§18) to avoid.
- **`cat /usr/share/nftables.d/README`** as part of any A-list
  verification batch when designing nft integrations. Don't infer
  from existing examples (zerotier, homeproxy, miniupnpd) without
  reading the README too — those examples use `table-post/` because
  they declare chains-inside-fw4, not standalone tables.

**First seen in.** Round 46 Step 242a (path hotfix), Step 242b
(atomic-replace).

---

## 18. Atomic-replace prelude for fw4 include files

**Problem.** nft's `chain X { ...rules... }` block in `nft -f`
context APPENDS rules to existing chains, not replaces. fw4 reload
re-runs `nft -f` on each include file on every reload (Save&Apply,
boot, manual `fw4 reload`). Without protection, your rules double
on the second reload, triple on the third, etc.

**Pattern.** Standard nftables idiom: 3-line prelude at the top of
the include file (or rpcd-handler-generated file):

```nft
table inet design_x          # idempotent create (no-op if exists)
delete table inet design_x   # wipe the table contents
                              # (chain rules, set elements all gone)

table inet design_x {        # recreate fresh
    set blocked_macs { ... }
    chain X { ... rules ... }
}
```

Single `nft -f` invocation runs all three statements as one atomic
transaction. No "no rules" window mid-replace.

**Why it works.** `delete table` wipes contents but allows the
subsequent `table { ... }` recreation to be the new authoritative
definition. Inside a single nft transaction, intermediate states
aren't visible to the packet path.

**Pitfalls.**
- First-ever load: table doesn't exist, so `delete table X` would
  fail. But the preceding `table inet X` (with no body) is idempotent
  — creates an empty table if missing. Then `delete` finds the empty
  table and succeeds.
- **Don't put `# comment` between the three lines** if you're nervous
  — they ARE meant to be three consecutive statements in one
  transaction. Comments are safe (they're stripped by the parser),
  but blank lines between them are also fine.

**First seen in.** Round 46 Step 242b. See
`/usr/share/nftables.d/ruleset-post/design_x.nft` for the live
example.

---

## 19. BusyBox-safe shell idioms

**Problem.** OpenWrt's userland is BusyBox-only by default. GNU
coreutils binaries that "every Linux has" simply aren't there. Your
shell handler silently fails when it shells out to a missing binary,
because `$(... | missing-cmd ...)` swallows the error.

**Pattern.** Before using any non-shell-builtin command in an rpcd
handler or init script, verify it's a BusyBox applet OR explicitly
declare it as an opkg dependency.

Common GNU-only binaries that surprise:

| Missing in BusyBox default | Use instead |
|---|---|
| `paste`        | Pure shell `for` loop with sep tracking |
| `tac`          | `awk '{a[NR]=$0} END {for (i=NR; i>=1; i--) print a[i]}'` |
| `seq`          | `awk 'BEGIN { for (i=1; i<=N; i++) print i }'` |
| `xargs --no-run-if-empty` | Plain `if [ -n "$INPUT" ]; then ... fi` |
| `pkill -u`     | `for pid in $(pgrep ...); do kill $pid; done` |
| `realpath`     | `readlink -f` (BusyBox HAS this) |

BusyBox-included applets you CAN use: `cat`, `cut`, `tr`, `sed`,
`awk`, `head`, `tail`, `grep`, `sort`, `uniq`, `find`, `xargs` (no
-r), `readlink`, `basename`, `dirname`, `printf`, `echo`.

**Why it matters.** `$(missing-cmd args)` exits the subshell with
non-zero status, but the outer shell doesn't `set -e` by default so
execution continues with `$VAR=""`. The handler returns `{"ok":true}`
because the *prior* operation succeeded. Silent failure surfaces
days later when state diverges.

**Pitfalls.**
- **`set -o pipefail`** isn't default. Without it, pipe failures
  don't propagate. Either turn it on for the handler or **manually
  verify each pipe step's output** before treating the value as good.
- **Test on the live router**, not your dev Mac. macOS / Linux dev
  envs have full coreutils — pipelines that work locally crash on
  the target.

**First seen in.** Round 46 Step 242c. `paste -sd, -` was the silent
killer — pipeline silently returned empty, regenerated nft file
lacked elements clause, blocks were lost on fw4 reload.

Cross-link to memory `[[verify-first-implement-second]]` for the
broader workflow framing.

---

## 20. Verify-first workflow checklist

**Problem.** Implementing a feature in OpenWrt/LuCI territory without
verifying upstream constraints first leads to multi-hour rewrites
when those constraints surface mid-implementation. Round 44 spent
16-18 hours on daemon-track variants because each implementation
discovered a new blocker (SFO bypasses conntrack DESTROY, ucode-mod-
socket has no AF_NETLINK, etc.) that a 5-minute verification step
would have revealed.

**Pattern.** Before any feature commit, generate + run a batch of
verification queries. Don't dribble them out one-per-iteration.

Template ssh batch:

```bash
ssh luci-router '
echo "=== A1: backend / mechanism check ==="
# e.g. which fw4 fw3; nft --version

echo "=== A2: persistence hook check ==="
# e.g. ls /usr/share/nftables.d/; cat /usr/share/nftables.d/README

echo "=== A3: feature primitive check ==="
# e.g. nft add table inet test; nft add set inet test x "{ type ether_addr; }"

echo "=== A4: dependency check ==="
# e.g. opkg list-installed | grep -iE "sqm|qos|tc"
# e.g. which tc; lsmod | grep sch_

echo "=== A5: ACL example check ==="
# e.g. find /usr/share/rpcd/acl.d -name "*.json"
# e.g. cat luci-app-firewall.json
'
```

Read every return value carefully — Step 242a hotfix happened
because I read "table-post/ is a hook dir" but didn't `cat README`
to learn the syntax constraints.

**Why it works.** Verification is ~5 minutes; debugging is hours.
ROI is 10:1+. Discovering a structural blocker BEFORE writing code
means the design changes, not the code.

**Pitfalls.**
- **Don't accept "the doc says X"** as verification. Test on the
  live router. Docs lag reality.
- **Read references of verified facts**. "Directory exists" ≠ "directory
  is suitable for my use" — cat the README, look at an existing
  example file's actual syntax.
- **Verification surfaces "already shipped"** sometimes. Round 45
  Step 236 + Step 238 both turned into zero-code audit steps because
  the work was already done elsewhere. That's a win, not a setback.

**First seen in.** Round 46 (the workflow rule itself).
Memory: `[[verify-first-implement-second]]`.

---

## 21. LuCI session modal for destructive UI actions

**Problem.** Destructive UI actions (Block this MAC, Reboot the
router, etc.) need user confirmation. Browser `confirm()` is ugly
and breaks the theme aesthetic.

**Pattern.** `L.ui.showModal(title, body)` + `L.ui.hideModal()`.
Body is an array of E()-built DOM nodes. Standard layout:

```javascript
L.ui.showModal(_('Block this device?'), [
    E('p', {}, _('Description of what will happen.')),
    E('p', { 'class': 'mono-line' }, mac),  // key parameter shown literal
    E('p', {}, _('How to undo.')),
    E('div', { 'class': 'right' }, [
        E('button', {
            'class': 'cbi-button',
            'click': L.ui.hideModal
        }, _('Cancel')),
        ' ',
        E('button', {
            'class': 'cbi-button cbi-button-negative',  // red for destructive
            'click': function () {
                L.ui.hideModal();
                self._doDestructiveAction(mac);
            }
        }, _('Block'))
    ])
]);
```

**Why it works.** `L.ui.showModal` is part of the public LuCI 26
API surface (used by Save&Apply, package manager, etc.). It blocks
the page until dismissed — clicks on the underlying page don't
register, preventing double-fire bugs.

**Pitfalls.**
- **Pair destructive with restorative**. If Block uses a modal,
  Unblock should NOT — restorative actions should be one-click.
  Imbalance principle: confirm destructive, instant on undo.
- **Show the parameter literal in the modal body** (the MAC, the
  config key, the file path being changed). User reads it before
  confirming, catches typos in their own selection.
- **Defensive fallback**: `if (!L.ui || typeof L.ui.showModal !==
  'function') return doActionDirectly();` — survive future LuCI
  versions that change the API.

**First seen in.** Round 46 Step 243 (Clients-card Block button).
Earlier inspirations: `quick-actions.js` Reboot modal (Round 12),
`apply-modal.js` Save&Apply replacement (Step 49).

---

*Last updated: 2026-05-26 (Round 47, Step 246). Maintained alongside
`doc/styling-progress.md` (the engineering journal).*
