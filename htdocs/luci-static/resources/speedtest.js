'use strict';
'require baseclass';
'require ui';

// ─────────────────────────────────────────────────────────────────────────────
// Wi-Fi / LAN link speedtest — upgrade.md §2.A5
//
// Tests browser ↔ router throughput (NOT browser ↔ internet). Useful for:
//   - "is my Wi-Fi slow?" (vs WAN)
//   - "is 5GHz really better than 2.4GHz from where I'm standing?"
//   - "did changing the antenna / channel help?"
//
// Three phases per run:
//   1. Latency  — 10 × /cgi-bin/design/ping, median + stddev (jitter)
//   2. Download — 1 × /cgi-bin/design/download?bytes=10485760 (10MB)
//   3. Upload   — 1 × /cgi-bin/design/upload (POST 5MB blob)
//
// Lives in a card injected into Overview. Trigger is a button — not auto —
// because hammering /dev/urandom + 10MB stream is not free on tiny routers.
//
// MVP: single direction at a time, simple median. Deferred:
//   - 2.4G/5G comparison mode (would need user to switch SSIDs mid-test)
//   - Last-10-runs history in localStorage
//   - Theoretical-link-rate comparison (needs iwinfo channel/bandwidth)
// ─────────────────────────────────────────────────────────────────────────────

var PING_COUNT      = 20;                 // 20 samples → median is robust to outliers
var DOWNLOAD_BYTES  = 50 * 1024 * 1024;   // 50 MB — at 1 Gbps wired = 400ms (post TCP slow-start),
                                          // at 5 GHz Wi-Fi ≈ 1s, at 2.4 GHz Wi-Fi ≈ 4s
                                          // User feedback: 10 MB was finished before the
                                          // browser even rendered progress on gigabit LAN.
var UPLOAD_BYTES    = 25 * 1024 * 1024;   // 25 MB — same logic, upload is typically slower
var TIMEOUT_MS      = 60000;              // 60 s per phase covers worst-case 2.4 GHz on a busy AP

function median(arr) {
	if (!arr.length) return null;
	var s = arr.slice().sort(function (a, b) { return a - b; });
	var m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stddev(arr) {
	if (arr.length < 2) return 0;
	var avg = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
	var sq  = arr.reduce(function (a, b) { return a + Math.pow(b - avg, 2); }, 0);
	return Math.sqrt(sq / (arr.length - 1));
}

function fmtMbps(bps) {
	return (bps / 1e6).toFixed(1);
}

function withTimeout(promise, ms) {
	var ctrl = new AbortController();
	var t = setTimeout(function () { ctrl.abort(); }, ms);
	return { signal: ctrl.signal, promise: promise(ctrl.signal).finally(function () { clearTimeout(t); }) };
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
	},

	injectCard: function () {
		var self = this;
		var card = E('div', { 'class': 'speedtest-card', 'id': 'speedtest-card' }, [
			E('div', { 'class': 'speedtest-head' }, [
				E('svg', { 'class': 'svg-icon speedtest-icon', 'aria-hidden': 'true' },
					E('use', { 'href': this.iconBase + '#i-activity' })),
				E('span', { 'class': 'speedtest-title' }, _('Wi-Fi / LAN Link Test')),
				E('span', { 'class': 'speedtest-meta' }, _('Browser ↔ router'))
			]),
			E('div', { 'class': 'speedtest-results', 'id': 'speedtest-results' }, [
				E('div', { 'class': 'speedtest-stat' }, [
					E('div', { 'class': 'speedtest-stat-label' }, _('Download')),
					E('div', { 'class': 'speedtest-stat-value', 'id': 'st-download' }, '—')
				]),
				E('div', { 'class': 'speedtest-stat' }, [
					E('div', { 'class': 'speedtest-stat-label' }, _('Upload')),
					E('div', { 'class': 'speedtest-stat-value', 'id': 'st-upload' }, '—')
				]),
				E('div', { 'class': 'speedtest-stat' }, [
					E('div', { 'class': 'speedtest-stat-label' }, _('Latency')),
					E('div', { 'class': 'speedtest-stat-value', 'id': 'st-latency' }, '—')
				]),
				E('div', { 'class': 'speedtest-stat' }, [
					E('div', { 'class': 'speedtest-stat-label' }, _('Jitter')),
					E('div', { 'class': 'speedtest-stat-value', 'id': 'st-jitter' }, '—')
				])
			]),
			E('div', { 'class': 'speedtest-actions' }, [
				E('button', {
					'type':  'button',
					'class': 'cbi-button cbi-button-action speedtest-run',
					'id':    'speedtest-run',
					'click': L.bind(this.runTest, this)
				}, _('Run test'))
			])
		]);
		var view = document.getElementById('view');
		view.appendChild(card);     // append at END (not first-fold)
	},

	runTest: function () {
		var btn = document.getElementById('speedtest-run');
		btn.disabled = true;
		var self = this;

		this.setStat('download', '—');
		this.setStat('upload', '—');
		this.setStat('latency', '—');
		this.setStat('jitter', '—');

		btn.textContent = _('Testing latency (%d samples)…').replace('%d', PING_COUNT);

		this.testLatency()
			.then(function (l) {
				if (l.median !== null) {
					self.setStat('latency', l.median.toFixed(1) + ' ms');
					self.setStat('jitter',  l.jitter.toFixed(1) + ' ms');
				}
				btn.textContent = _('Testing download (%d MB)…').replace('%d', DOWNLOAD_BYTES / 1024 / 1024);
				return self.testDownload();
			})
			.then(function (mbps) {
				self.setStat('download', mbps !== null ? mbps.toFixed(1) + ' Mbps' : _('error'));
				btn.textContent = _('Testing upload (%d MB)…').replace('%d', UPLOAD_BYTES / 1024 / 1024);
				return self.testUpload();
			})
			.then(function (mbps) {
				self.setStat('upload', mbps !== null ? mbps.toFixed(1) + ' Mbps' : _('error'));
			})
			.catch(function (e) {
				if (window.toast) toast.error(_('Speed test failed') + ': ' + (e && e.message ? e.message : 'unknown'));
			})
			.finally(function () {
				btn.disabled = false;
				btn.textContent = _('Run test');
			});
	},

	testLatency: function () {
		var samples = [];
		function next() {
			if (samples.length >= PING_COUNT) {
				return { median: median(samples), jitter: stddev(samples) };
			}
			var t0 = performance.now();
			return fetch('/cgi-bin/design/ping?t=' + Date.now(), { cache: 'no-store' })
				.then(function () { samples.push(performance.now() - t0); return next(); })
				.catch(function () { return next(); });
		}
		return Promise.resolve().then(next);
	},

	testDownload: function () {
		var t0 = performance.now();
		var ctrl = new AbortController();
		var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
		return fetch('/cgi-bin/design/download?bytes=' + DOWNLOAD_BYTES + '&t=' + Date.now(), {
			signal: ctrl.signal, cache: 'no-store'
		}).then(function (r) {
			if (!r.ok) throw new Error('HTTP ' + r.status);
			return r.blob();
		}).then(function (blob) {
			clearTimeout(to);
			var ms = performance.now() - t0;
			var bytes = blob.size;
			var mbps = (bytes * 8) / (ms / 1000) / 1e6;
			return mbps;
		}).catch(function () { clearTimeout(to); return null; });
	},

	testUpload: function () {
		var payload = new Blob([new Uint8Array(UPLOAD_BYTES)]);
		var t0 = performance.now();
		var ctrl = new AbortController();
		var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
		return fetch('/cgi-bin/design/upload', {
			method: 'POST', body: payload, signal: ctrl.signal, cache: 'no-store'
		}).then(function (r) {
			clearTimeout(to);
			if (!r.ok) throw new Error('HTTP ' + r.status);
			var ms = performance.now() - t0;
			var mbps = (UPLOAD_BYTES * 8) / (ms / 1000) / 1e6;
			return mbps;
		}).catch(function () { clearTimeout(to); return null; });
	},

	setStat: function (which, value) {
		var el = document.getElementById('st-' + which);
		if (el) el.textContent = value;
	}
});
