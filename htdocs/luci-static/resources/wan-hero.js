'use strict';
'require baseclass';
'require ui';
'require rpc';
'require network';

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
				E('svg', { 'class': 'svg-icon wan-hero-icon', 'aria-hidden': 'true' },
					E('use', { 'href': this.iconBase + '#i-globe' })),
				E('span', { 'class': 'wan-hero-title' }, _('Internet')),
				E('span', { 'class': 'wan-hero-status', 'id': 'wan-hero-status' }, _('Checking...')),
				E('span', { 'class': 'wan-hero-ping', 'id': 'wan-hero-ping' }, '')
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
			])
		]);
		// Sparkline tiles were injected before view.firstChild; put hero BEFORE them
		var view = document.getElementById('view');
		view.insertBefore(card, view.firstChild);
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

			document.getElementById('wan-hero-proto').textContent = safe(function () {
				var p = w.getProtocol();
				return p ? p.getI18n() : null;
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
			var el = document.getElementById('wan-hero-ping');
			if (!el) return;
			el.textContent = (ms === null) ? '' : ms.toFixed(1) + ' ms';
		});
	},

	setStatus: function (kind, label) {
		var el = document.getElementById('wan-hero-status');
		el.className = 'wan-hero-status wan-hero-status-' + kind;
		el.textContent = label;
	}
});
