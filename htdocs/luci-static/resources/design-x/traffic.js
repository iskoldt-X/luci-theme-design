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
//        Refreshed every 30s while the Overview is open.
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
var REFRESH_MS = 5000;
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

function deviceLabel(mac, leasesByMac) {
	var lease = leasesByMac[mac];
	if (lease && lease.hostname) return lease.hostname;
	var vendor = OUI_HINTS[mac.substr(0, 8)];
	if (vendor) return vendor + ' device';
	// Show last 5 chars of MAC for visual identity
	return mac.slice(-5);
}

// ── ubus / fetch ──────────────────────────────────────────────────────────────
var getDHCPLeases = L.rpc.declare({
	object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} }
});

function fetchNlbwData() {
	return fetch('/cgi-bin/design/nlbw', { cache: 'no-store' })
		.then(function (r) { return r.ok ? r.json() : null; })
		.then(function (raw) { return aggregateByMac(parseNlbwData(raw)); })
		.catch(function () { return []; });
}

// Step 115 (Round 31): offload-proof per-host bandwidth source.
// /cgi-bin/design/host-traffic reads nftables `netdev design_acct` table
// (created by /etc/init.d/design-host-acct service) which uses ingress-hook
// counters that fire BEFORE the nf_flowtable fastpath divergence. Returns
// `{available, hosts: [{ip, tx_bytes, rx_bytes}, ...]}`. When the acct
// service isn't installed yet or no traffic has been counted, available
// is false / hosts is empty — caller falls back to nlbwmon.
function fetchHostTraffic() {
	return fetch('/cgi-bin/design/host-traffic', { cache: 'no-store' })
		.then(function (r) { return r.ok ? r.json() : null; })
		.catch(function () { return null; });
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
				E('span', { 'class': 'traffic-title' }, _('Traffic Analysis')),
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
		// Step 115 (Round 31): try host-traffic CGI first (nftables ingress
		// counters — offload-proof). Fall back to nlbwmon if host-traffic
		// has no data (acct service not yet installed / no traffic counted).
		// Both fetches + lease lookup run in parallel for snappy refresh.
		Promise.all([
			fetchHostTraffic(),
			fetchNlbwData(),
			fetchLeasesRaw()
		]).then(function (results) {
			var hostData     = results[0];
			var nlbwConsumers = results[1];
			var leasesRaw    = results[2];

			// Build byMac map for renderConsumers (existing API)
			var byMac = {};
			leasesRaw.forEach(function (l) {
				var m = (l.macaddr || l.mac || '').toUpperCase();
				if (m && !byMac[m]) byMac[m] = l;
			});

			// Prefer host-traffic if it yielded actual per-host data.
			// Otherwise fall through to nlbw (which may also be empty —
			// renderConsumers handles the empty state with the existing
			// Step 99 hint).
			var nftConsumers = hostTrafficToConsumers(hostData, leasesRaw);
			var consumers = nftConsumers.length ? nftConsumers : nlbwConsumers;

			self.renderConsumers(consumers, byMac);
		});
	},

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
			// Offloading bypasses conntrack, so nlbwmon's byte counters
			// freeze near zero per flow. Phrased as a tip rather than an
			// error so users on healthy setups don't think something's
			// wrong.
			container.appendChild(E('div', { 'class': 'traffic-empty' }, [
				E('div', {},
					_('No traffic data yet — nlbwmon collects continuously, check back in a minute.')),
				E('div', { 'class': 'traffic-empty-hint' },
					_('Tip: if still empty after a minute, check Network → Firewall → Routing/NAT Offloading — Software flow offloading bypasses the conntrack counters nlbwmon reads.'))
			]));
			if (summary) summary.textContent = '';
			if (meta) meta.textContent = '';
			return;
		}

		var top = consumers.slice(0, TOP_N);
		var otherCount = Math.max(0, consumers.length - TOP_N);
		var maxTotal = top[0].rx + top[0].tx;
		var grandRx = 0, grandTx = 0;
		consumers.forEach(function (c) { grandRx += c.rx; grandTx += c.tx; });

		top.forEach(function (c) {
			var total = c.rx + c.tx;
			var pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
			var label = deviceLabel(c.mac, leasesByMac);
			container.appendChild(E('div', { 'class': 'traffic-consumer' }, [
				E('div', { 'class': 'traffic-consumer-name', 'title': c.mac }, label),
				E('div', { 'class': 'traffic-consumer-bar-wrap' },
					E('div', {
						'class': 'traffic-consumer-bar',
						'style': 'width: ' + pct.toFixed(1) + '%'
					})),
				E('div', { 'class': 'traffic-consumer-bytes' }, formatBytes(total))
			]));
		});

		if (otherCount > 0) {
			container.appendChild(E('div', { 'class': 'traffic-consumer-others' },
				_('+ %d more devices').replace('%d', otherCount)));
		}

		if (summary) {
			summary.innerHTML = '';
			summary.appendChild(E('span', { 'class': 'traffic-summary-total' },
				_('Total: %s ↓ %s ↑')
					.replace('%s', formatBytes(grandRx))
					.replace('%s', formatBytes(grandTx))));
		}

		if (meta) {
			meta.textContent = _('%d devices · refresh 30s').replace('%d', consumers.length);
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
