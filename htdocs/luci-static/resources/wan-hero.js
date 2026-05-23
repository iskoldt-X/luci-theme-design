'use strict';
'require baseclass';
'require ui';
'require rpc';
'require network';
'require wan-stats';

// Step 83 (Round 13): SVG namespace helpers — see sparkline.js for the
// full rationale. tl;dr E('svg',...) creates HTMLUnknownElement, so the
// <use href="#i-globe"/> reference never renders.
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

// Step 43: throughput formatter (rate in bps → number + unit) — kept inline
// here rather than importing from a shared module, since the only other
// consumer is sparkline.js and a 5-line helper isn't worth a module boundary.
function fmtBpsSplit(bps) {
	if (bps === null || bps === undefined || !isFinite(bps)) return { num: '—', unit: '' };
	if (bps < 1000)    return { num: bps.toFixed(0),       unit: 'bps' };
	if (bps < 1e6)     return { num: (bps / 1000).toFixed(1),  unit: 'Kbps' };
	if (bps < 1e9)     return { num: (bps / 1e6).toFixed(1),   unit: 'Mbps' };
	return { num: (bps / 1e9).toFixed(2), unit: 'Gbps' };
}

// Step 50: protocol labels for the Connection field. On a DHCP-WAN router
// w.getProtocol().getI18n() returns null on some LuCI builds because the
// dhcp Protocol class's i18n string isn't loaded when our view runs (it's
// registered by luci-app-network's view modules, which Overview doesn't
// pull in). Fall back to the raw proto config value with a hand-picked
// label table; fall further back to TitleCase of the raw string.
var PROTO_LABELS = {
	dhcp:         'DHCP',
	static:       'Static IP',
	pppoe:        'PPPoE',
	pptp:         'PPTP',
	l2tp:         'L2TP',
	wireguard:    'WireGuard',
	openvpn:      'OpenVPN',
	'3g':         '3G',
	qmi:          'QMI cellular',
	ncm:          'NCM cellular',
	mbim:         'MBIM cellular',
	dhcpv6:       'DHCPv6',
	'6in4':       '6in4 tunnel',
	'6to4':       '6to4 tunnel',
	'6rd':        '6rd tunnel',
	gre:          'GRE',
	vxlan:        'VXLAN',
	wwan:         'WWAN',
	modemmanager: 'ModemManager',
	none:         'Unconfigured',
	relay:        'Relay'
};

function getProtoLabel(w) {
	try {
		var p = (typeof w.getProtocol === 'function') ? w.getProtocol() : null;
		// Try the localized i18n label first — works when network-view loaded
		if (p && typeof p.getI18n === 'function') {
			var i18n = p.getI18n();
			if (i18n) return i18n;
		}
		// Fall back: the raw proto name. Some Protocol classes expose it
		// directly, but worst case w.get('proto') reads it from uci.
		var raw = null;
		if (p && typeof p.getProtocol === 'function') {
			raw = p.getProtocol();
		}
		if (!raw && typeof w.get === 'function') {
			raw = w.get('proto');
		}
		if (raw) {
			return PROTO_LABELS[raw] || (String(raw).charAt(0).toUpperCase() + String(raw).slice(1));
		}
	} catch (e) {
		if (console && console.warn) console.warn('wan-hero: getProtoLabel failed:', e);
	}
	return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAN Hero card — upgrade.md §2.A1
//
// Big first-fold card on the Status > Overview page answering "is my internet
// working?". All data is 100% local (no third-party ISP API by default —
// privacy decision per upgrade.md A1).
//
//   - online / offline status (ubus network.interface.wan)
//   - public IP, connection method (proto), uptime
//   - gateway latency (via /cgi-bin/design/ping × 5 samples → median)
//
// Deferred for follow-up:
//   - Real-time up/down throughput (needs second polling thread + interface
//     device discovery)
//   - ISP lookup opt-in (third-party API with consent modal)
// ─────────────────────────────────────────────────────────────────────────────

var PING_SAMPLES = 5;
var PING_TIMEOUT_MS = 1500;
var REFRESH_MS = 30000;   // re-check WAN state every 30s

function median(arr) {
	if (!arr.length) return null;
	var s = arr.slice().sort(function (a, b) { return a - b; });
	var m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function formatUptime(seconds) {
	if (!isFinite(seconds) || seconds < 0) return '—';
	var d = Math.floor(seconds / 86400);
	var h = Math.floor((seconds % 86400) / 3600);
	var m = Math.floor((seconds % 3600) / 60);
	if (d) return d + 'd ' + h + 'h';
	if (h) return h + 'h ' + m + 'm';
	return m + 'm';
}

function pingOnce() {
	var ctrl = new AbortController();
	var to = setTimeout(function () { ctrl.abort(); }, PING_TIMEOUT_MS);
	var t0 = performance.now();
	return fetch('/cgi-bin/design/ping?t=' + Date.now(), {
		signal: ctrl.signal, cache: 'no-store'
	}).then(function (r) {
		clearTimeout(to);
		if (!r.ok) return null;
		return r.text().then(function () { return performance.now() - t0; });
	}).catch(function () { clearTimeout(to); return null; });
}

function measurePing() {
	var samples = [];
	function next() {
		if (samples.length >= PING_SAMPLES) return median(samples);
		return pingOnce().then(function (ms) {
			if (ms !== null) samples.push(ms);
			return next();
		});
	}
	return next();
}

// Step 48: map a ping median (ms) → number of active "signal" bars.
// Thresholds chosen so a typical LAN ping (1-3ms) maxes out at 5,
// Wi-Fi-to-WAN (10-30ms) sits at 3-4, congested or distant gateway
// (100ms+) drops to 1. Returns 0 if the ping itself failed.
function pingToBars(ms) {
	if (ms === null || ms === undefined || !isFinite(ms)) return 0;
	if (ms < 5)    return 5;
	if (ms < 20)   return 4;
	if (ms < 50)   return 3;
	if (ms < 100)  return 2;
	return 1;
}

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function () {
		if (!document.body.classList.contains('node-admin-status-overview')) return;

		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design') + '/icons.svg';
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
		this.refresh();
		this._timer = setInterval(L.bind(this.refresh, this), REFRESH_MS);
	},

	injectCard: function () {
		var card = E('div', { 'class': 'wan-hero', 'id': 'wan-hero' }, [
			E('div', { 'class': 'wan-hero-head' }, [
				svgEl('svg', { 'class': 'svg-icon wan-hero-icon', 'aria-hidden': 'true' },
					svgUse(this.iconBase + '#i-globe')),
				E('span', { 'class': 'wan-hero-title' }, _('Internet')),
				E('span', { 'class': 'wan-hero-status', 'id': 'wan-hero-status' }, _('Checking...')),
				// Step 48: ping element gets a 5-bar signal indicator + text.
			// Inner structure is filled by refresh(); empty until first
			// measurement returns.
			E('span', { 'class': 'wan-hero-ping', 'id': 'wan-hero-ping' }, [
				E('span', { 'class': 'wan-hero-ping-bars', 'id': 'wan-hero-ping-bars', 'data-bars': '0' }, [
					E('span'), E('span'), E('span'), E('span'), E('span')
				]),
				E('span', { 'class': 'wan-hero-ping-text', 'id': 'wan-hero-ping-text' }, '')
			])
			]),
			E('div', { 'class': 'wan-hero-body' }, [
				E('div', { 'class': 'wan-hero-field' }, [
					E('div', { 'class': 'wan-hero-field-label' }, _('Public IP')),
					E('div', { 'class': 'wan-hero-field-value', 'id': 'wan-hero-ip' }, '—')
				]),
				E('div', { 'class': 'wan-hero-field' }, [
					E('div', { 'class': 'wan-hero-field-label' }, _('Connection')),
					E('div', { 'class': 'wan-hero-field-value', 'id': 'wan-hero-proto' }, '—')
				]),
				E('div', { 'class': 'wan-hero-field' }, [
					E('div', { 'class': 'wan-hero-field-label' }, _('Uptime')),
					E('div', { 'class': 'wan-hero-field-value', 'id': 'wan-hero-uptime' }, '—')
				]),
				E('div', { 'class': 'wan-hero-field' }, [
					E('div', { 'class': 'wan-hero-field-label' }, _('Interface')),
					E('div', { 'class': 'wan-hero-field-value', 'id': 'wan-hero-iface' }, '—')
				])
			]),
			// Step 43: live throughput strip — fed by wan-stats every 2 s. Sits
			// at the bottom with a border-top separator so it reads as "live
			// telemetry" distinct from the static fields above.
			E('div', { 'class': 'wan-hero-throughput', 'id': 'wan-hero-throughput' }, [
				E('div', { 'class': 'wan-hero-throughput-cell' }, [
					E('span', { 'class': 'wan-hero-throughput-arrow' }, '↓'),
					E('span', { 'class': 'wan-hero-throughput-value', 'id': 'wan-hero-down' }, '—'),
					E('span', { 'class': 'wan-hero-throughput-unit',  'id': 'wan-hero-down-unit' }, '')
				]),
				E('div', { 'class': 'wan-hero-throughput-cell' }, [
					E('span', { 'class': 'wan-hero-throughput-arrow' }, '↑'),
					E('span', { 'class': 'wan-hero-throughput-value', 'id': 'wan-hero-up' }, '—'),
					E('span', { 'class': 'wan-hero-throughput-unit',  'id': 'wan-hero-up-unit' }, '')
				])
			])
		]);
		// Sparkline tiles were injected before view.firstChild; put hero BEFORE them
		var view = document.getElementById('view');
		view.insertBefore(card, view.firstChild);

		// Step 43: subscribe to wan-stats for live throughput. Same singleton
		// the Net tile uses — one RPC stream, two consumers.
		var self = this;
		L.require('wan-stats').then(function (ws) {
			ws.subscribe(L.bind(self.onWanStats, self));
		}).catch(function () {
			// wan-stats unavailable — hide the throughput strip rather than
			// show forever-"—" telemetry.
			var strip = document.getElementById('wan-hero-throughput');
			if (strip) strip.style.display = 'none';
		});
	},

	// Step 43: render live ↑/↓ throughput from the wan-stats singleton.
	onWanStats: function (data) {
		var d = fmtBpsSplit(data.rxBps);
		var u = fmtBpsSplit(data.txBps);
		var setText = function (id, txt) {
			var el = document.getElementById(id);
			if (el) el.textContent = txt;
		};
		setText('wan-hero-down', d.num);
		setText('wan-hero-down-unit', d.unit);
		setText('wan-hero-up', u.num);
		setText('wan-hero-up-unit', u.unit);
	},

	refresh: function () {
		var self = this;

		// Per-field try/catch so one broken accessor doesn't blank the whole
		// card. User report on ImmortalWrt 24.10: IP populated but Connection /
		// Uptime / Interface all blank + status showed "Unable to read WAN state"
		// — that was the .catch firing AFTER IP was already set. Now each
		// field stands alone.
		function safe(fn, fallback) {
			try {
				var v = fn();
				return (v === null || v === undefined || v === '') ? fallback : v;
			} catch (e) {
				return fallback;
			}
		}

		network.getWANNetworks().then(function (wans) {
			if (!wans || !wans.length) {
				self.setStatus('offline', _('No WAN configured'));
				return;
			}
			var w = wans[0];

			// isUp() can throw on some forks if the interface is mid-restart
			var up = safe(function () { return w.isUp(); }, null);
			if (up === null) {
				self.setStatus('unknown', _('WAN state transient'));
			} else {
				self.setStatus(up ? 'online' : 'offline', up ? _('Online') : _('Offline'));
			}

			var ipv4 = safe(function () { return w.getIPAddrs(); }, []);
			document.getElementById('wan-hero-ip').textContent =
				(ipv4 && ipv4.length) ? ipv4[0].split('/')[0] : safe(function () {
					// Fallback: try IPv6 if IPv4 missing
					var v6 = w.getIP6Addrs();
					return (v6 && v6.length) ? v6[0].split('/')[0] : '—';
				}, '—');

			// Step 50: proto fallback chain via getProtoLabel() — handles the
			// LuCI 26.x case where w.getProtocol().getI18n() returns null on
			// the Overview page (proto i18n strings registered by network-view
			// only, which we don't load).
			document.getElementById('wan-hero-proto').textContent = safe(function () {
				return getProtoLabel(w);
			}, '—');

			document.getElementById('wan-hero-uptime').textContent = safe(function () {
				return formatUptime(w.getUptime());
			}, '—');

			document.getElementById('wan-hero-iface').textContent = safe(function () {
				var d = w.getDevice();
				return d ? d.getName() : w.getName();
			}, '—');
		}).catch(function (e) {
			// Outer rejection: getWANNetworks itself failed. Only NOW do we
			// claim full unknown. Single fields handled by per-field try/catch
			// above.
			self.setStatus('unknown', _('Unable to read WAN state'));
			if (console && console.warn) console.warn('wan-hero: getWANNetworks failed:', e);
		});

		// Gateway/local ping — independent from WAN state since CGI is on the
		// box itself; works even if WAN is down.
		measurePing().then(function (ms) {
			// Step 48: split the display into 5-bar indicator + text. The
			// bars are CSS-styled spans; we just update the data-bars
			// attribute and let the cascade do the rest.
			var bars = document.getElementById('wan-hero-ping-bars');
			var text = document.getElementById('wan-hero-ping-text');
			if (bars) bars.setAttribute('data-bars', String(pingToBars(ms)));
			if (text) text.textContent = (ms === null) ? '' : ms.toFixed(1) + ' ms';
		});
	},

	setStatus: function (kind, label) {
		var el = document.getElementById('wan-hero-status');
		el.className = 'wan-hero-status wan-hero-status-' + kind;
		el.textContent = label;
	}
});
