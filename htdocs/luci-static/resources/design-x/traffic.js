'use strict';
'require baseclass';
'require ui';
'require rpc';

// Step 83 (Round 13): SVG namespace helpers — see sparkline.js.
var __SVG_NS   = 'http://www.w3.org/2000/svg';
var __XLINK_NS = 'http://www.w3.org/1999/xlink';
function svgEl(tag, attrs, children) {
	var el = document.createElementNS(__SVG_NS, tag);
	if (attrs) Object.keys(attrs).forEach(function (k) {
		if (k === 'xlink:href') el.setAttributeNS(__XLINK_NS, 'xlink:href', attrs[k]);
		else el.setAttribute(k, attrs[k]);
	});
	if (children) {
		var arr = Array.isArray(children) ? children : [children];
		arr.forEach(function (c) { if (c) el.appendChild(c); });
	}
	return el;
}
function svgUse(href) {
	return svgEl('use', { 'href': href, 'xlink:href': href });
}

// ─────────────────────────────────────────────────────────────────────────────
// Traffic Analysis card — upgrade.md §5.D2 (progressive enhancement)
//
// Two modes via capability.nlbw() detection (accepts both modern
// `luci-app-nlbwmon` and legacy `luci-app-nlbw` packages):
//
//   ✅ Installed:
//      → Render inline top-5 device-bandwidth bar chart, total bytes
//        summary, and "Open full Traffic Analysis →" deep-link.
//        Data via /cgi-bin/design/nlbw (calls `nlbw -c json -g mac`).
//        Refreshed every 3s while the Overview is open (Step 231).
//      → Hostnames are resolved by joining nlbw's MAC keys against
//        luci-rpc.getDHCPLeases. MAC with no lease falls back to OUI
//        vendor (table inlined here; same source as devices.js).
//
//   ❌ Not installed:
//      → Styled placeholder card explaining nlbwmon, with one-click
//        button to the package manager (URL also discovered dynamically).
//
// URL discovery: ui.menu.load() → walk tree → match regex on node.name.
// Robust against renames between OpenWrt 19/21/22/23/24 LuCI revisions.
// ─────────────────────────────────────────────────────────────────────────────

// Step 119 (Round 31): refresh cadence 30 s → 5 s. With the Step 118
// bridge-family backend, nft counters update in real time as packets
// flow, so polling every 5 s gives a visibly "live" feel matching the
// WAN throughput tile's 2 s cadence and the sparkline tiles. Backend
// cost is negligible: one `nft -j list table bridge design_acct` call
// per poll (~5-10 ms on the router) — 12 requests/min total.
//
// Round 45 Step 231: 5 s → 3 s to match the design-host-acct daemon's
// POLL_INTERVAL (Step 227). The daemon writes /tmp/design-host-traffic.json
// every 3 s with fresh `recent_rx`/`recent_tx` (last 3 s of activity).
// Polling JS at 3 s lines up so each refresh sees a brand-new delta.
var REFRESH_MS = 3000;
var TOP_N      = 5;

// ── Menu URL lookup helpers ───────────────────────────────────────────────────
function findMenuUrl(nameRegex) {
	return L.require('ui').then(function (uiMod) {
		return uiMod.menu.load().then(function (tree) {
			var found = null;
			function walk(node, parts) {
				var kids = uiMod.menu.getChildren(node);
				for (var i = 0; i < kids.length && !found; i++) {
					var c = kids[i];
					var p = parts.concat([c.name]);
					if (nameRegex.test(c.name)) { found = p.join('/'); return; }
					walk(c, p);
				}
			}
			walk(tree, []);
			return found ? L.url(found) : null;
		});
	}).catch(function () { return null; });
}

// "Open Package Manager" target — different node name across LuCI versions.
// The broadened regex below covers known variants:
//   opkg, package, packages, package-manager, packagemanager, software,
//   attendedsysupgrade. Fallback to a literal 'admin/system/package' guess
//   (works on ImmortalWrt 24.10 / OpenWrt 23.05+) if the menu walk fails —
//   single 404 is still preferable to a dead '#' href.
function findPackageManagerUrl() {
	return findMenuUrl(/^(opkg|packages?|software|attendedsysupgrade|package-?manager)$/i)
		.then(function (url) { return url || L.url('admin/system/package'); });
}

function findNlbwUrl() {
	return findMenuUrl(/^nlbw/i);
}

// ── nlbwmon data helpers ──────────────────────────────────────────────────────
// Parse nlbw -c json output. Format varies across builds:
//   (A) array of objects: [{mac:'aa:bb:..', rx_bytes:N, tx_bytes:N, ...}, ...]
//   (B) tabular: { columns: ['mac','rx_bytes',...], data: [['aa:bb:..',N,...],...] }
// Returns a uniform [{mac, rx, tx}, ...] array.
function parseNlbwData(raw) {
	if (raw && Array.isArray(raw.data) && Array.isArray(raw.columns)) {
		var cols = raw.columns;
		return raw.data.map(function (row) {
			var obj = {};
			for (var i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
			return obj;
		}).map(uniformEntry).filter(Boolean);
	}
	if (Array.isArray(raw)) {
		return raw.map(uniformEntry).filter(Boolean);
	}
	return [];
}

function uniformEntry(e) {
	if (!e || !e.mac) return null;
	return {
		mac: String(e.mac).toUpperCase(),
		rx:  parseInt(e.rx_bytes, 10) || 0,
		tx:  parseInt(e.tx_bytes, 10) || 0
	};
}

// Group entries by MAC (one device may produce multiple rows by family/proto).
// Sort by total bytes desc.
function aggregateByMac(entries) {
	var map = {};
	entries.forEach(function (e) {
		if (!map[e.mac]) map[e.mac] = { mac: e.mac, rx: 0, tx: 0 };
		map[e.mac].rx += e.rx;
		map[e.mac].tx += e.tx;
	});
	var arr = Object.keys(map).map(function (k) { return map[k]; });
	arr.sort(function (a, b) { return (b.rx + b.tx) - (a.rx + a.tx); });
	return arr;
}

function formatBytes(b) {
	if (b < 1024) return b + ' B';
	if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
	if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
	return (b / 1073741824).toFixed(2) + ' GB';
}

// Compact OUI vendor lookup (subset — full table in devices.js).
// Just enough to label devices nlbw counts but DHCP doesn't have a name for.
var OUI_HINTS = {
	'3C:22:FB': 'Apple', 'A4:C4:94': 'Samsung', 'B8:27:EB': 'Raspberry Pi',
	'DC:A6:32': 'Raspberry Pi', '00:1A:11': 'Google', 'F4:F5:D8': 'Google',
	'F8:FF:C2': 'Apple', 'A4:83:E7': 'Apple', '7C:6D:F8': 'Apple',
	'04:03:D6': 'Nintendo', '00:24:E4': 'Nintendo', 'DC:A6:BD': 'Sony',
	'00:50:F2': 'Microsoft', '94:DE:80': 'HP', '00:25:64': 'Dell',
	'04:7D:7B': 'Lenovo', '52:54:00': 'QEMU', '08:00:27': 'VirtualBox',
	'B0:F8:93': 'TP-Link', '14:CC:20': 'TP-Link'
};

// Round 43 Step 180 — Chrome-Claude design review feedback.
// Old fallback `mac.slice(-5)` produced "8B:35"-style stubs:
// - Inconsistent with LAN Clients card which says "Unknown device"
// - Information entropy LOWER than just showing the full MAC
//   (loses OUI, can't be searched, looks like a port number)
// - Misleading: looks like a meaningful ID but isn't
//
// New behaviour: return { primary, secondary, title }.
//   - primary   = the big text on row 1 (hostname / "Private device" /
//                 "Unknown device")
//   - secondary = mono small-grey text on row 2 (full MAC) when there
//                 is no hostname — gives the user something to grep
//                 against LAN Clients OR copy-paste
//   - title     = hover tooltip; always full MAC, with OUI vendor name
//                 prefixed when known (progressive disclosure: OUI
//                 doesn't pollute the main label, but is still
//                 accessible on hover)
//
// "Private device" vs "Unknown device" — first MAC byte has bit-1
// (0x02) set means locally-administered, which is what iOS / Android /
// Windows "private Wi-Fi address" feature emits (MAC randomisation).
// Calling these "Private" rather than "Unknown" tells the user the
// device is HIDING its identity on purpose — not "missing config".
function deviceLabel(mac, leasesByMac) {
	var lease  = leasesByMac[mac];
	var vendor = OUI_HINTS[mac.substr(0, 8)];
	var title  = vendor ? (vendor + ' · ' + mac) : mac;

	if (lease && lease.hostname) {
		return { primary: lease.hostname, secondary: null, title: title };
	}

	// Locally-administered bit in first MAC byte (RFC 5342 §2.1).
	// 0x02 mask: e.g. B2:xx → 0xB2 & 0x02 = truthy → randomised.
	var firstByte = parseInt(mac.split(':')[0], 16);
	var isPrivate = !isNaN(firstByte) && (firstByte & 0x02);

	return {
		primary:   isPrivate ? _('Private device') : _('Unknown device'),
		secondary: mac,
		title:     title
	};
}

// ── ubus / fetch ──────────────────────────────────────────────────────────────
var getDHCPLeases = L.rpc.declare({
	object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} }
});

// Round 42 Step 165: nlbw + host-traffic data paths migrated from public
// unauth /cgi-bin/design/* to auth-gated luci-theme-design-x ubus.
// Backend handlers preserve the legacy CGI shapes verbatim — nlbw's
// dual-shape tolerance ([{...}] OR {columns,data}) and host-traffic's
// three-branch contract (no-acct-table / empty-output / hosts populated)
// are intact. See /usr/libexec/rpcd/luci-theme-design-x.
var callNlbw            = rpc.declare({ object: 'luci-theme-design-x', method: 'nlbw',              expect: { '': {} } });
var callHostTraffic     = rpc.declare({ object: 'luci-theme-design-x', method: 'host-traffic',      expect: { '': {} } });
// Round 44 Step 212 — bandwidth Hybrid Tier 2 frontend endpoint.
// host-traffic-acct exposes /tmp/design-host-traffic.json (written by
// the design-host-acct-uc ucode daemon, Steps 210+211). When the
// daemon is running, this is per-MAC totals direct from netlink
// conntrack (DESTROY events + 5 s CT_GET dump) — no NPU offload blind
// spot like Round 31 nft had. When the daemon isn't running yet
// (older install, or service crash), available:false → fall back to
// the Round 31 host-traffic method. nlbw remains deepest fallback.
var callHostTrafficAcct = rpc.declare({ object: 'luci-theme-design-x', method: 'host-traffic-acct', expect: { '': {} } });

function fetchNlbwData() {
	return callNlbw()
		.then(function (raw) { return aggregateByMac(parseNlbwData(raw)); })
		.catch(function () { return []; });
}

// Step 115 (Round 31): offload-proof per-host bandwidth source.
// Reads nftables `bridge design_acct` table (preferred) or legacy
// `netdev design_acct` (fallback) via the design-host-acct service,
// using ingress-hook counters that fire BEFORE the nf_flowtable
// fastpath divergence. Returns `{available, hosts: [{ip, tx_bytes,
// rx_bytes}, ...]}`. When the acct service isn't installed yet or
// no traffic has been counted, available is false / hosts is empty —
// caller falls back to nlbwmon.
function fetchHostTraffic() {
	return callHostTraffic()
		.catch(function () { return null; });
}

// Round 44 Step 212: bandwidth Hybrid Tier 2 fetch. The daemon writes
// /tmp/design-host-traffic.json (atomic-rename every 5 s); the rpcd
// host-traffic-acct method serves it wrapped in
//   { available: true,  data: <daemon json> }
// or
//   { available: false, reason: "daemon-not-running" }
// when the file is missing.
function fetchHostTrafficAcct() {
	return callHostTrafficAcct()
		.catch(function () { return null; });
}

// Round 44 Step 212: convert Hybrid Tier 2 daemon shape →
// consumers [{mac, rx, tx, recent_rx, recent_tx}, ...] (the format
// renderConsumers wants). The daemon already maps IP→MAC via
// /proc/net/arp internally, so no lease-table join needed here
// (unlike hostTrafficToConsumers which joins nft per-IP counters
// against leases). Pure shape-translation.
//
// Round 45 Step 231: pass through `recent_rx`/`recent_tx` if present.
// Daemon (Step 230+) emits these as last-poll-cycle bytes — the
// Live Competition widget uses them for bar size & ranking. Older
// daemon builds without the field → renderConsumers falls back to
// the synthetic-delta path.
function acctToConsumers(acctData) {
	if (!acctData || !acctData.available || !acctData.data || !acctData.data.hosts) {
		return [];
	}
	var out = [];
	var hosts = acctData.data.hosts;
	for (var mac in hosts) {
		if (!hosts.hasOwnProperty(mac)) continue;
		var h = hosts[mac];
		var entry = {
			mac: mac.toUpperCase(),
			rx: +h.rx || 0,
			tx: +h.tx || 0
		};
		if (h.recent_rx !== undefined) entry.recent_rx = +h.recent_rx || 0;
		if (h.recent_tx !== undefined) entry.recent_tx = +h.recent_tx || 0;
		out.push(entry);
	}
	return out;
}

// Convert host-traffic CGI output to nlbwmon's consumer shape
// `[{mac, rx, tx}, ...]` so renderConsumers can stay agnostic of the
// data source. Looks up MAC via IP→lease map; hosts not in DHCP table
// (rare — static-IP devices) are dropped because deviceLabel needs MAC.
function hostTrafficToConsumers(hostData, leases) {
	if (!hostData || !hostData.available || !hostData.hosts || !hostData.hosts.length) {
		return [];
	}
	var byIp = {};
	leases.forEach(function (l) {
		if (l.ipaddr) byIp[l.ipaddr] = l;
	});
	return hostData.hosts.map(function (h) {
		var lease = byIp[h.ip] || {};
		var mac = (lease.macaddr || lease.mac || '').toUpperCase();
		return {
			mac: mac,
			rx:  parseInt(h.rx_bytes, 10) || 0,
			tx:  parseInt(h.tx_bytes, 10) || 0,
			_ip: h.ip
		};
	}).filter(function (c) { return c.mac && (c.rx > 0 || c.tx > 0); })
	  .sort(function (a, b) { return (b.rx + b.tx) - (a.rx + a.tx); });
}

// Round 45 Step 231: synthesize `recent_rx` / `recent_tx` for consumers
// that don't carry them. Tier 1 (Hybrid Tier 2 daemon) provides recent
// fields directly off the JSON; Tier 2 (nft bridge counters) and Tier 3
// (nlbwmon) only expose monotonic cumulative bytes, so the widget caches
// previous absolutes per MAC and computes delta = current - previous.
//
// `cache` is an object keyed by MAC. First-poll consumers (mac not yet
// in cache) get recent_rx=recent_tx=0 — one wasted refresh, then live.
// Negative deltas (counter reset, e.g. daemon restart or nft table
// reload) collapse to 0 so the bar doesn't render as a giant negative.
function applySyntheticRecent(consumers, cache) {
	for (var i = 0; i < consumers.length; i++) {
		var c = consumers[i];
		if (c.recent_rx !== undefined && c.recent_tx !== undefined) {
			continue;
		}
		var prev = cache[c.mac];
		if (prev) {
			c.recent_rx = Math.max(0, c.rx - prev.rx);
			c.recent_tx = Math.max(0, c.tx - prev.tx);
		} else {
			c.recent_rx = 0;
			c.recent_tx = 0;
		}
		cache[c.mac] = { rx: c.rx, tx: c.tx };
	}
}

function fetchLeasesByMac() {
	return getDHCPLeases().then(function (data) {
		var leases = (data && (data.dhcp_leases || data['dhcp_leases'])) || [];
		if (data && data.dhcp6_leases) leases = leases.concat(data.dhcp6_leases);
		var byMac = {};
		leases.forEach(function (l) {
			var m = (l.macaddr || l.mac || '').toUpperCase();
			if (m && !byMac[m]) byMac[m] = l;
		});
		return byMac;
	}).catch(function () { return {}; });
}

// Step 115: returns raw lease array (not byMac). Used by host-traffic
// path which needs IP→lease mapping. Kept separate so fetchLeasesByMac
// callers don't change.
function fetchLeasesRaw() {
	return getDHCPLeases().then(function (data) {
		var leases = (data && (data.dhcp_leases || data['dhcp_leases'])) || [];
		if (data && data.dhcp6_leases) leases = leases.concat(data.dhcp6_leases);
		return leases;
	}).catch(function () { return []; });
}

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function () {
		if (!document.body.classList.contains('node-admin-status-overview')) return;
		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design-x') + '/icons.svg';
		this.tryInject();
	},

	tryInject: function () {
		var view = document.getElementById('view');
		if (!view || !view.firstChild || view.querySelector('.spinning')) {
			if ((this._retries = (this._retries || 0) + 1) > 20) return;
			setTimeout(L.bind(this.tryInject, this), 250);
			return;
		}
		this.injectCard();
		this.detect();
	},

	injectCard: function () {
		var card = E('div', { 'class': 'traffic-card', 'id': 'traffic-card' }, [
			E('div', { 'class': 'traffic-head' }, [
				svgEl('svg', { 'class': 'svg-icon traffic-icon', 'aria-hidden': 'true' },
					svgUse(this.iconBase + '#i-bar-chart')),
				E('span', { 'class': 'traffic-title' }, _('Live Competition')),
				E('span', { 'class': 'traffic-meta', 'id': 'traffic-meta' }, '')
			]),
			E('div', { 'class': 'traffic-body', 'id': 'traffic-body' },
				E('div', { 'class': 'traffic-loading' }, _('Detecting…')))
		]);
		var view = document.getElementById('view');
		view.appendChild(card);
	},

	detect: function () {
		var self = this;
		L.require('design-x.capability').then(function (cap) {
			cap.nlbw().then(function (installed) {
				if (installed) self.renderInstalled();
				else self.renderPlaceholder();
			}).catch(function () { self.renderPlaceholder(); });
		}).catch(function () { self.renderPlaceholder(); });
	},

	// ── Installed state: real inline GUI ─────────────────────────────────────
	renderInstalled: function () {
		var body = document.getElementById('traffic-body');
		body.innerHTML = '';

		body.appendChild(E('div', { 'class': 'traffic-installed' }, [
			E('div', { 'class': 'traffic-consumers', 'id': 'traffic-consumers' },
				E('div', { 'class': 'traffic-loading' }, _('Loading bandwidth data…'))),
			E('div', { 'class': 'traffic-summary', 'id': 'traffic-summary' }, ''),
			E('div', { 'class': 'traffic-actions' }, [
				E('a', {
					'href':  '#',
					'class': 'cbi-button cbi-button-action traffic-cta',
					'id':    'traffic-cta-link'
				}, _('Open full Traffic Analysis →'))
			])
		]));

		// Resolve nlbw view URL
		findNlbwUrl().then(function (url) {
			var link = document.getElementById('traffic-cta-link');
			if (link) link.setAttribute('href', url || L.url('admin'));
		});

		// Fetch + render data; keep refreshing
		this.refreshData();
		this._timer = setInterval(L.bind(this.refreshData, this), REFRESH_MS);
	},

	refreshData: function () {
		var self = this;
		// Round 44 Step 212: bandwidth Hybrid Tier 2 swap. Three-tier
		// fallback chain (best → fallback):
		//   1. host-traffic-acct  — Hybrid Tier 2 ucode daemon
		//                           (Steps 210/211), per-MAC, offload-proof,
		//                           5s in-flight + 100% finalized
		//   2. host-traffic       — Round 31 nft-bridge counters, per-IP,
		//                           offload-proof in stock kernels but
		//                           breaks on HW offload (mtk_ppe et al.)
		//   3. nlbw               — nlbwmon, per-MAC, definitively broken
		//                           under SW flow offload, kept as deepest
		//                           fallback for routers with neither of
		//                           the above installed
		// All four data sources fetched in parallel — chooser logic picks
		// whichever resolves with non-empty consumers, preferring tier 1.
		Promise.all([
			fetchHostTrafficAcct(),
			fetchHostTraffic(),
			fetchNlbwData(),
			fetchLeasesRaw()
		]).then(function (results) {
			var acctData      = results[0];
			var hostData      = results[1];
			var nlbwConsumers = results[2];
			var leasesRaw     = results[3];

			// Build byMac map for renderConsumers (existing API)
			var byMac = {};
			leasesRaw.forEach(function (l) {
				var m = (l.macaddr || l.mac || '').toUpperCase();
				if (m && !byMac[m]) byMac[m] = l;
			});

			// Tier 1: acct daemon (Hybrid Tier 2)
			var acctConsumers = acctToConsumers(acctData);
			// Tier 2: Round 31 nft
			var nftConsumers  = hostTrafficToConsumers(hostData, leasesRaw);
			// Tier 3: nlbwmon (already aggregated)

			var consumers;
			if (acctConsumers.length) {
				consumers = acctConsumers;
			} else if (nftConsumers.length) {
				consumers = nftConsumers;
			} else {
				consumers = nlbwConsumers;
			}

			// Round 45 Step 231: ensure every consumer has recent_rx /
			// recent_tx populated. Tier 1 already does; Tier 2/3 get
			// synthesized from absolute deltas across polls.
			if (!self._byteCache) self._byteCache = {};
			applySyntheticRecent(consumers, self._byteCache);

			self.renderConsumers(consumers, byMac);
		});
	},

	// Round 45 Step 231: Live Competition View. Rows sorted by
	// recent_rx+recent_tx (last 3 s of activity), top-3 get medal
	// glyphs, rank changes trigger a one-shot CSS pulse. Tier 1
	// daemon supplies recent fields directly; Tier 2/3 get synthetic
	// deltas via applySyntheticRecent. Bar width is the recent ratio
	// to top-1; the bytes cell shows recent rate (big) plus
	// cumulative (small subtitle) so absolute totals are still
	// discoverable.
	renderConsumers: function (consumers, leasesByMac) {
		var container = document.getElementById('traffic-consumers');
		var summary = document.getElementById('traffic-summary');
		var meta = document.getElementById('traffic-meta');
		if (!container) return;

		container.innerHTML = '';

		if (!consumers.length) {
			// Step 99 (Round 18): two-line empty state. Top line is the
			// honest "still collecting" message; bottom line is a soft
			// pointer at the most common root cause discovered in
			// Chrome-Claude's Round 17 diagnostic — Software Flow
			// Offloading bypasses conntrack, so byte counters freeze
			// near zero per flow.
			container.appendChild(E('div', { 'class': 'traffic-empty' }, [
				E('div', {},
					_('No traffic data yet — bandwidth daemon collects continuously, check back in a minute.')),
				E('div', { 'class': 'traffic-empty-hint' },
					_('Tip: if still empty after a minute, check Network → Firewall → Routing/NAT Offloading — Software flow offloading bypasses the conntrack counters bandwidth monitors read.'))
			]));
			if (summary) summary.textContent = '';
			if (meta) meta.textContent = '';
			return;
		}

		// Sort by Live Competition metric: who's eating the most in the
		// last poll cycle. Tie-break by cumulative so two idle hosts
		// don't visibly shuffle on every refresh.
		consumers.sort(function (a, b) {
			var ra = (a.recent_rx || 0) + (a.recent_tx || 0);
			var rb = (b.recent_rx || 0) + (b.recent_tx || 0);
			if (rb !== ra) return rb - ra;
			return (b.rx + b.tx) - (a.rx + a.tx);
		});

		var top = consumers.slice(0, TOP_N);
		var otherCount = Math.max(0, consumers.length - TOP_N);
		var maxRecent = (top[0].recent_rx || 0) + (top[0].recent_tx || 0);
		var grandRx = 0, grandTx = 0;
		var grandRecentRx = 0, grandRecentTx = 0;
		consumers.forEach(function (c) {
			grandRx += c.rx; grandTx += c.tx;
			grandRecentRx += (c.recent_rx || 0);
			grandRecentTx += (c.recent_tx || 0);
		});

		var lastRank = this._lastRank || {};
		var newRank  = {};

		top.forEach(function (c, idx) {
			var rank = idx + 1;
			var rt = (c.recent_rx || 0) + (c.recent_tx || 0);
			var ct = c.rx + c.tx;
			var pct = maxRecent > 0 ? (rt / maxRecent) * 100 : 0;
			var lbl = deviceLabel(c.mac, leasesByMac);
			newRank[c.mac] = rank;

			// Rank-change animation: compare against last render. Class
			// is read by CSS keyframes to pulse the row briefly. Pure
			// presentation — no JS timeouts needed.
			var prev = lastRank[c.mac];
			var motionCls = '';
			if (prev && prev !== rank) {
				motionCls = prev > rank ? ' rank-up' : ' rank-down';
			}

			var rankLabel = rank === 1 ? '🥇'
			              : rank === 2 ? '🥈'
			              : rank === 3 ? '🥉'
			              : '#' + rank;

			// Step 180: name cell wraps primary label + optional
			// secondary MAC subtitle.
			var nameChildren = [
				E('div', { 'class': 'traffic-consumer-primary' }, lbl.primary)
			];
			if (lbl.secondary) {
				nameChildren.push(
					E('div', { 'class': 'traffic-consumer-secondary' }, lbl.secondary)
				);
			}

			container.appendChild(E('div', {
				'class':     'traffic-consumer rank-' + rank + motionCls,
				'data-mac':  c.mac
			}, [
				E('div', { 'class': 'traffic-consumer-rank' }, rankLabel),
				E('div', { 'class': 'traffic-consumer-name', 'title': lbl.title }, nameChildren),
				E('div', { 'class': 'traffic-consumer-bar-wrap' },
					E('div', {
						'class': 'traffic-consumer-bar',
						'style': 'width: ' + pct.toFixed(1) + '%'
					})),
				E('div', { 'class': 'traffic-consumer-bytes' }, [
					E('div', { 'class': 'traffic-consumer-bytes-recent' },
						rt > 0 ? formatBytes(rt) + '/3s' : '—'),
					E('div', { 'class': 'traffic-consumer-bytes-cum' }, formatBytes(ct))
				])
			]));
		});

		this._lastRank = newRank;

		if (otherCount > 0) {
			container.appendChild(E('div', { 'class': 'traffic-consumer-others' },
				_('+ %d more devices').replace('%d', otherCount)));
		}

		if (summary) {
			summary.innerHTML = '';
			var liveLine = (grandRecentRx + grandRecentTx) > 0
				? _('Last 3s: %s ↓ %s ↑')
					.replace('%s', formatBytes(grandRecentRx))
					.replace('%s', formatBytes(grandRecentTx))
				: _('Network idle — no host competing right now');
			summary.appendChild(E('span', { 'class': 'traffic-summary-total' }, liveLine));
			summary.appendChild(E('span', { 'class': 'traffic-summary-cum' },
				_('Total %s ↓ %s ↑')
					.replace('%s', formatBytes(grandRx))
					.replace('%s', formatBytes(grandTx))));
		}

		if (meta) {
			meta.textContent = _('%d devices · live').replace('%d', consumers.length);
		}
	},

	// ── Not installed state ──────────────────────────────────────────────────
	renderPlaceholder: function () {
		var body = document.getElementById('traffic-body');
		body.innerHTML = '';
		body.appendChild(E('div', { 'class': 'traffic-placeholder' }, [
			E('p', { 'class': 'traffic-placeholder-msg' },
				_('This feature requires luci-app-nlbwmon (netlink bandwidth monitor).')),
			E('ul', { 'class': 'traffic-placeholder-list' }, [
				E('li', {}, _('Per-device real-time bandwidth')),
				E('li', {}, _('24h / 7-day cumulative ranking')),
				E('li', {}, _('Hourly usage timeline per device'))
			]),
			E('a', {
				'href':  '#',
				'class': 'cbi-button cbi-button-action traffic-cta',
				'id':    'traffic-opkg-link'
			}, _('Open Package Manager'))
		]));
		// Dynamic URL — same resolver as installed path. findPackageManagerUrl()
		// always returns a non-null Promise now (literal fallback inside).
		findPackageManagerUrl().then(function (url) {
			var link = document.getElementById('traffic-opkg-link');
			if (link) link.setAttribute('href', url);
		});
	}
});
