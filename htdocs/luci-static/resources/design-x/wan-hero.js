'use strict';
'require baseclass';
'require ui';
'require rpc';
'require network';
'require design-x.wan-stats';

// ─────────────────────────────────────────────────────────────────────────────
// Connection card (merged) — redesign-2026-06 §三.1
//
// Round 49: the old WAN hero (status + 4-stat grid + signal-bar latency +
// throughput strip) MERGES with the live WAN-traffic chart that used to be
// a separate sparkline tile. Per the redesign:
//   - Left column : status dot + title (heading), meta line
//                   (uptime · proto · iface, caption), IP (mono, click-to-copy),
//                   latency = number + threshold dot (<50 green / <100 amber /
//                   ≥100 red, tooltip legend). The 5-bar signal metaphor is
//                   DELETED (it was WiFi-strength muscle memory).
//   - Right area  : 5-min live area chart (up=--chart-up blue, down=--chart-down
//                   green) + current ↓/↑ readouts (mono) top-right.
//   - Offline     : chart dims, status dot red, "last online …", outer height
//                   stays fixed (~200px) in all states.
//
// Data: subscribes to the design-x.wan-stats SINGLETON (already emits every
// 2s via luci-rpc getNetworkDevices) and keeps a LOCAL ring buffer. NO new
// RPC, no new polling — perf-architecture.md is the controlling law.
// ─────────────────────────────────────────────────────────────────────────────

// SVG namespace helpers — LuCI's E('svg',…) makes HTMLUnknownElement which the
// browser won't paint as SVG. Same rationale as sparkline.js / cmdk.js.
var SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, children) {
	var el = document.createElementNS(SVG_NS, tag);
	if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
	if (children) {
		var arr = Array.isArray(children) ? children : [children];
		arr.forEach(function (c) { if (c) el.appendChild(c); });
	}
	return el;
}

// Throughput formatter (bps → number + unit), split so the readout can size
// number and unit independently.
function fmtBpsSplit(bps) {
	if (bps === null || bps === undefined || !isFinite(bps)) return { num: '—', unit: '' };
	if (bps < 1000)    return { num: bps.toFixed(0),         unit: 'bps' };
	if (bps < 1e6)     return { num: (bps / 1000).toFixed(1), unit: 'Kbps' };
	if (bps < 1e9)     return { num: (bps / 1e6).toFixed(1),  unit: 'Mbps' };
	return { num: (bps / 1e9).toFixed(2), unit: 'Gbps' };
}

// Protocol labels — same fallback chain as before (LuCI 26.x omits proto
// i18n on Overview because network-view isn't loaded there).
var PROTO_LABELS = {
	dhcp: 'DHCP', static: 'Static IP', pppoe: 'PPPoE', pptp: 'PPTP', l2tp: 'L2TP',
	wireguard: 'WireGuard', openvpn: 'OpenVPN', '3g': '3G', qmi: 'QMI cellular',
	ncm: 'NCM cellular', mbim: 'MBIM cellular', dhcpv6: 'DHCPv6', '6in4': '6in4 tunnel',
	'6to4': '6to4 tunnel', '6rd': '6rd tunnel', gre: 'GRE', vxlan: 'VXLAN', wwan: 'WWAN',
	modemmanager: 'ModemManager', none: 'Unconfigured', relay: 'Relay'
};

function getProtoLabel(w) {
	try {
		var p = (typeof w.getProtocol === 'function') ? w.getProtocol() : null;
		if (p && typeof p.getI18n === 'function') {
			var i18n = p.getI18n();
			if (i18n) return i18n;
		}
		var raw = null;
		if (p && typeof p.getProtocol === 'function') raw = p.getProtocol();
		if (!raw && typeof w.get === 'function') raw = w.get('proto');
		if (raw) return PROTO_LABELS[raw] || (String(raw).charAt(0).toUpperCase() + String(raw).slice(1));
	} catch (e) {
		if (console && console.warn) console.warn('connection-card: getProtoLabel failed:', e);
	}
	return null;
}

var PING_SAMPLES = 2;
var PING_TIMEOUT_MS = 1500;
var REFRESH_MS = 60000;   // re-check WAN state every 60s (state, not throughput)

// Chart geometry. wan-stats emits every 2s → 150 samples = 5 minutes.
var CHART_RING = 150;
var CHART_W = 300;
var CHART_H = 56;

// Scale floor: idle traffic shouldn't autoscale to full height. wan-stats
// emits bits/sec, so 100 Kbps = 100 * 1000 bps is the minimum upper bound.
var CHART_HI_FLOOR = 100 * 1000;

// ── Shared small-card host (#dx-cards) ──────────────────────────────────────
// Round 50 (unified small-card grid): wan-hero / speedtest / sparkline all
// inject their cards into ONE wrapping grid (#dx-cards) instead of being
// independent #view grid items. getElementById-or-create is race-safe enough
// for this single-threaded DOM — whichever module wins the race creates the
// host; the others find it. CSS `order` (not injection order) decides the
// visual sequence, so the race is harmless.
function dxCardsHost() {
	var host = document.getElementById('dx-cards');
	if (host) return host;
	var view = document.getElementById('view');
	if (!view) return null;
	host = E('div', { 'id': 'dx-cards', 'class': 'dx-cards' });
	view.insertBefore(host, view.firstChild);
	return host;
}

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
	return fetch('/cgi-bin/luci/admin/design-x/ping?t=' + Date.now(), {
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

// Latency → threshold tier (redesign §三.1): <50 green / <100 amber / ≥100 red.
function pingTier(ms) {
	if (ms === null || ms === undefined || !isFinite(ms)) return 'unknown';
	if (ms < 50)  return 'good';
	if (ms < 100) return 'warn';
	return 'bad';
}

// ── Ring buffer for the live chart ─────────────────────────────────────────
// Round 50 fix (2a): pre-fill with zeros so the chart spans the full x-axis
// width from t=0 — no "spike-needle" where the first few samples cram into a
// few px because the data is right-aligned over a 150-slot axis.
function RateRing(max) {
	this.max = max;
	this.data = [];
	for (var i = 0; i < max; i++) this.data.push(0);
}
RateRing.prototype.push = function (v) {
	this.data.push((v === null || v === undefined || !isFinite(v)) ? 0 : v);
	if (this.data.length > this.max) this.data.shift();
};

// Build an SVG area path string for a ring, scaled to a shared upper bound so
// up and down read on the same vertical scale (their magnitude relationship
// stays honest). Returns { line, area } path d-strings, or null if <2 samples.
function ringPaths(ring, hi, w, h) {
	var n = ring.data.length;
	if (n < 2) return null;
	if (!(hi > 0)) hi = 1;
	var stepX = w / (CHART_RING - 1);
	// Right-align the data so the newest sample sits at the right edge. With
	// the zero-prefill (Round 50 2a) n === CHART_RING so offset is 0 and the
	// curve spans the full width; the offset math stays for the <CHART_RING
	// edge case.
	var offset = w - (n - 1) * stepX;
	var line = '';
	for (var i = 0; i < n; i++) {
		var x = offset + i * stepX;
		// Round 50 fix (2b): sqrt-scale the magnitude so idle noise doesn't
		// flatline AND a single burst doesn't spike to a needle — bursts stay
		// readable while low traffic still registers above the baseline.
		var frac = Math.min(1, Math.sqrt(ring.data[i] / hi));
		var y = h - frac * h * 0.92 - h * 0.04;
		line += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
	}
	var firstX = offset.toFixed(1);
	var lastX  = (offset + (n - 1) * stepX).toFixed(1);
	var area = line + 'L' + lastX + ',' + h + ' L' + firstX + ',' + h + ' Z';
	return { line: line.trim(), area: area.trim() };
}

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function () {
		if (!document.body.classList.contains('node-admin-status-overview')) return;
		this.ringRx = new RateRing(CHART_RING);   // download
		this.ringTx = new RateRing(CHART_RING);   // upload
		this._online = null;
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
		this._timer = window.DXScheduler.every(REFRESH_MS, L.bind(this.refresh, this));
		// "Last check Xs ago" / "last online" relative-time ticker, 5s, pure
		// text — no network calls.
		this._taglineTimer = window.DXScheduler.every(5000, L.bind(this.updateTagline, this));
	},

	injectCard: function () {
		// Round 50 (redesign — unified small-card grid): vertical 300×180
		// layout. row1 status · row2 meta · row3 ↓/↑ rates (anchor) · row4
		// compact area chart · row5 IP + latency. The old left-column +
		// big-right-chart 2-up grid is gone; the card now lives in #dx-cards.
		var card = E('div', { 'class': 'conn-card', 'id': 'conn-card' }, [
			// row 1: status dot + "Internet · Online" (heading, ellipsis).
			E('div', { 'class': 'conn-status', 'id': 'conn-status' }, _('Checking…')),
			// row 2: uptime · proto · iface (caption).
			E('div', { 'class': 'conn-meta', 'id': 'conn-meta' }, ''),
			// row 3: current ↓/↑ rates — the card's visual anchor (mono,
			// direction colors).
			E('div', { 'class': 'conn-readouts' }, [
				E('span', { 'class': 'conn-readout conn-readout-down' }, [
					E('span', { 'class': 'conn-readout-arrow' }, '↓'),
					E('span', { 'class': 'conn-readout-num', 'id': 'conn-down' }, '—'),
					E('span', { 'class': 'conn-readout-unit', 'id': 'conn-down-unit' }, '')
				]),
				E('span', { 'class': 'conn-readout conn-readout-up' }, [
					E('span', { 'class': 'conn-readout-arrow' }, '↑'),
					E('span', { 'class': 'conn-readout-num', 'id': 'conn-up' }, '—'),
					E('span', { 'class': 'conn-readout-unit', 'id': 'conn-up-unit' }, '')
				])
			]),
			// row 4: compact live area chart.
			E('div', { 'class': 'conn-chart-wrap', 'id': 'conn-chart-wrap' }, [
				this.makeChart()
			]),
			// row 5: Public IP (mono, click-to-copy) + latency num + dot,
			// right-aligned. Labels dropped — mono IP + "ms" are self-describing.
			E('div', { 'class': 'conn-footer' }, [
				E('button', {
					'type': 'button',
					'class': 'conn-ip',
					'id': 'conn-ip',
					'title': _('Click to copy'),
					'click': L.bind(this.copyIp, this)
				}, '—'),
				E('span', { 'class': 'conn-latency', 'id': 'conn-latency' }, [
					E('span', { 'class': 'conn-latency-num', 'id': 'conn-latency-num' }, '—'),
					E('span', {
						'class': 'conn-latency-dot',
						'id': 'conn-latency-dot',
						'data-tier': 'unknown',
						'tabindex': '0',
						'title': _('Latency: < 50 ms good · < 100 ms fair · ≥ 100 ms poor')
					}, '')
				])
			])
		]);

		dxCardsHost().appendChild(card);

		// Subscribe to the wan-stats singleton — same stream sparkline used.
		// One RPC stream, shared. NO new polling.
		var self = this;
		L.require('design-x.wan-stats').then(function (ws) {
			self._unsub = ws.subscribe(L.bind(self.onWanStats, self));
		}).catch(function () {
			// wan-stats unavailable — leave readouts at "—" and chart empty.
		});
	},

	makeChart: function () {
		// Two stacked area series (down + up) on a shared Y-axis. Both areas
		// fill at low opacity; lines at full. Colors come from CSS so they
		// flip with light/dark + obey the direction-color tokens.
		var downFill = svgEl('path', { 'class': 'conn-chart-area conn-chart-area-down', 'd': '' });
		var upFill   = svgEl('path', { 'class': 'conn-chart-area conn-chart-area-up',   'd': '' });
		var downLine = svgEl('path', { 'class': 'conn-chart-line conn-chart-line-down', 'd': '', 'fill': 'none' });
		var upLine   = svgEl('path', { 'class': 'conn-chart-line conn-chart-line-up',   'd': '', 'fill': 'none' });
		var baseline = svgEl('line', {
			'class': 'conn-chart-baseline',
			'x1': '0', 'y1': CHART_H - 1, 'x2': CHART_W, 'y2': CHART_H - 1
		});
		return svgEl('svg', {
			'class': 'conn-chart',
			'id': 'conn-chart',
			'viewBox': '0 0 ' + CHART_W + ' ' + CHART_H,
			'preserveAspectRatio': 'none',
			'aria-hidden': 'true'
		}, [baseline, downFill, upFill, downLine, upLine]);
	},

	// Live throughput from wan-stats. Push into local rings, redraw chart,
	// update the ↓/↑ readouts. This is the ONLY data feed for the chart.
	onWanStats: function (data) {
		var online = data.online !== false && data.deviceName !== null;
		this.ringRx.push(online ? data.rxBitsPerSec : 0);
		this.ringTx.push(online ? data.txBitsPerSec : 0);

		var d = fmtBpsSplit(data.rxBitsPerSec);
		var u = fmtBpsSplit(data.txBitsPerSec);
		var set = function (id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
		set('conn-down', d.num); set('conn-down-unit', d.unit);
		set('conn-up',   u.num); set('conn-up-unit',   u.unit);

		this.renderChart();
	},

	renderChart: function () {
		var svg = document.getElementById('conn-chart');
		if (!svg) return;
		// Shared upper bound across both series so magnitude reads honestly.
		// Round 50 fix (2b): clamp the upper bound to a floor (100 Kbps) so
		// idle-line noise doesn't autoscale to full height — a quiet link
		// reads as a quiet link, not a busy one.
		var hi = CHART_HI_FLOOR;
		var i;
		for (i = 0; i < this.ringRx.data.length; i++) if (this.ringRx.data[i] > hi) hi = this.ringRx.data[i];
		for (i = 0; i < this.ringTx.data.length; i++) if (this.ringTx.data[i] > hi) hi = this.ringTx.data[i];

		var dp = ringPaths(this.ringRx, hi, CHART_W, CHART_H);
		var up = ringPaths(this.ringTx, hi, CHART_W, CHART_H);

		var setD = function (cls, val) {
			var el = svg.querySelector('.' + cls);
			if (el) el.setAttribute('d', val || '');
		};
		setD('conn-chart-area-down', dp ? dp.area : '');
		setD('conn-chart-line-down', dp ? dp.line : '');
		setD('conn-chart-area-up',   up ? up.area : '');
		setD('conn-chart-line-up',   up ? up.line : '');
	},

	copyIp: function () {
		var el = document.getElementById('conn-ip');
		if (!el) return;
		var text = el.textContent;
		if (!text || text === '—') return;
		var done = function () {
			if (window.toast) window.toast.success(_('IP copied'));
		};
		try {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(text).then(done, function () {});
				return;
			}
		} catch (e) { /* fall through to legacy path */ }
		// Legacy fallback for non-secure contexts where Clipboard API is blocked.
		try {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			ta.style.position = 'absolute';
			ta.style.left = '-9999px';
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
			done();
		} catch (e2) { /* give up silently */ }
	},

	refresh: function () {
		var self = this;
		this._refreshTime = Date.now();

		function safe(fn, fallback) {
			try {
				var v = fn();
				return (v === null || v === undefined || v === '') ? fallback : v;
			} catch (e) { return fallback; }
		}

		network.getWANNetworks().then(function (wans) {
			if (!wans || !wans.length) {
				self.setStatus('offline', _('Internet · Offline'));
				self._metaPrefix = _('No WAN configured');
				self.setMeta([]);
				self.updateTagline();
				return;
			}
			var w = wans[0];
			var up = safe(function () { return w.isUp(); }, null);

			var proto = safe(function () { return getProtoLabel(w); }, null);
			var iface = safe(function () { var d = w.getDevice(); return d ? d.getName() : w.getName(); }, null);
			var upSec = safe(function () { return w.getUptime(); }, null);

			if (up === null) {
				self.setStatus('unknown', _('Internet · Checking'));
				self._metaPrefix = _('WAN state transient');
				self._online = null;
			} else if (up) {
				self.setStatus('online', _('Internet · Online'));
				self._metaPrefix = (upSec !== null) ? formatUptime(upSec) : _('Online');
				self._online = true;
				self._lastOnline = Date.now();
			} else {
				self.setStatus('offline', _('Internet · Offline'));
				self._metaPrefix = _('No connectivity');
				self._online = false;
			}

			// Meta line: uptime · proto · iface (caption). Imperative push so
			// no null sneaks into the children array (E() renders null as the
			// literal text "null").
			var parts = [];
			if (self._metaPrefix) parts.push(self._metaPrefix);
			if (proto) parts.push(proto);
			if (iface) parts.push(iface);
			self.setMeta(parts);
			self.updateTagline();

			// Public IP (IPv4 first, IPv6 fallback)
			var ipv4 = safe(function () { return w.getIPAddrs(); }, []);
			var ip = (ipv4 && ipv4.length) ? ipv4[0].split('/')[0] : safe(function () {
				var v6 = w.getIP6Addrs();
				return (v6 && v6.length) ? v6[0].split('/')[0] : '—';
			}, '—');
			var ipEl = document.getElementById('conn-ip');
			if (ipEl) ipEl.textContent = ip;
		}).catch(function (e) {
			self.setStatus('unknown', _('Internet · Unknown'));
			self._metaPrefix = _('Unable to read WAN state');
			self.setMeta([]);
			self.updateTagline();
			if (console && console.warn) console.warn('connection-card: getWANNetworks failed:', e);
		});

		// Latency — number + threshold dot. Local ping CGI works even when
		// WAN is down, so it runs independently of WAN state.
		measurePing().then(function (ms) {
			var num = document.getElementById('conn-latency-num');
			var dot = document.getElementById('conn-latency-dot');
			if (num) num.textContent = (ms === null) ? '—' : ms.toFixed(0) + ' ms';
			if (dot) dot.setAttribute('data-tier', pingTier(ms));
		});
	},

	setMeta: function (parts) {
		var el = document.getElementById('conn-meta');
		if (el) el.textContent = parts.join(' · ');
	},

	// Tagline lives inside the meta line's "last online" suffix only when
	// offline; when online the meta already shows uptime. Keeps a fixed-height
	// card regardless of state.
	updateTagline: function () {
		var wrap = document.getElementById('conn-chart-wrap');
		if (wrap) {
			if (this._online === false) wrap.classList.add('conn-chart-offline');
			else wrap.classList.remove('conn-chart-offline');
		}
		// When offline, append a "last online …" hint to the meta line.
		if (this._online === false && this._lastOnline) {
			var el = document.getElementById('conn-meta');
			if (el) {
				var ageS = Math.floor((Date.now() - this._lastOnline) / 1000);
				var ageStr;
				if (ageS < 60)        ageStr = _('just now');
				else if (ageS < 3600) ageStr = Math.floor(ageS / 60) + _(' min ago');
				else                  ageStr = Math.floor(ageS / 3600) + _(' h ago');
				el.textContent = (this._metaPrefix || _('Offline')) + ' · ' + _('last online ') + ageStr;
			}
		}
	},

	setStatus: function (kind, label) {
		var el = document.getElementById('conn-status');
		if (!el) return;
		el.className = 'conn-status conn-status-' + kind;
		el.textContent = label;
	}
});
