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
//   1. Latency  — N × /cgi-bin/design/ping, median + stddev (jitter)
//   2. Download — 1 × /cgi-bin/design/download?bytes=N (default 50MB)
//   3. Upload   — 1 × /cgi-bin/design/upload (POST blob, default 25MB)
//
// Lives in a card injected into Overview. Trigger is a button — not auto —
// because hammering /dev/urandom + tens of MB stream is not free.
//
// Step 46: history + label. Each run is stored in localStorage with a
// user-chosen label (Auto / Wired / 5 GHz / 2.4 GHz / custom). Last 6
// entries show below the current results. Lets users do a manual 2.4 vs
// 5 comparison by running twice with different labels — no automated
// SSID switching, but the visible side-by-side makes the comparison easy.
//
// Still deferred:
//   - Automated SSID switching (browser can't do this anyway — Wi-Fi is
//     a router config, not a browser action)
//   - Theoretical-link-rate overlay (needs iwinfo channel/bandwidth)
// ─────────────────────────────────────────────────────────────────────────────

var STORAGE_KEY = 'design-speedtest-history-v1';
var HISTORY_MAX = 6;

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

// Step 46: history persistence — localStorage, best-effort, fails silent
// on quota / private-mode.
function loadHistory() {
	try {
		var raw = localStorage.getItem(STORAGE_KEY);
		var arr = raw ? JSON.parse(raw) : [];
		return Array.isArray(arr) ? arr : [];
	} catch (e) { return []; }
}
function saveHistory(entries) {
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }
	catch (e) { /* quota / disabled — discard */ }
}
function pushHistory(entry) {
	var arr = loadHistory();
	arr.unshift(entry);
	if (arr.length > HISTORY_MAX) arr = arr.slice(0, HISTORY_MAX);
	saveHistory(arr);
	return arr;
}

function fmtAgo(ts) {
	var s = Math.floor((Date.now() - ts) / 1000);
	if (s < 60)    return _('just now');
	if (s < 3600)  return Math.floor(s / 60)   + _(' min ago');
	if (s < 86400) return Math.floor(s / 3600) + _(' h ago');
	return Math.floor(s / 86400) + _(' d ago');
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
				// Step 46: label select lets the user tag the run so history
				// shows side-by-side comparable entries. No automated SSID
				// switching — that's not possible from a browser anyway.
				E('select', {
					'id':    'speedtest-label',
					'class': 'speedtest-label-select',
					'aria-label': _('Test label')
				}, [
					E('option', { 'value': 'Wired'   }, _('Wired')),
					E('option', { 'value': '5 GHz', 'selected': 'selected' }, _('Wi-Fi 5 GHz')),
					E('option', { 'value': '2.4 GHz' }, _('Wi-Fi 2.4 GHz')),
					E('option', { 'value': 'Other'   }, _('Other'))
				]),
				E('button', {
					'type':  'button',
					'class': 'cbi-button cbi-button-action speedtest-run',
					'id':    'speedtest-run',
					'click': L.bind(this.runTest, this)
				}, _('Run test'))
			]),
			// Step 46: history strip below the actions, hidden if empty.
			// Rendered on inject and after every successful run.
			E('div', { 'class': 'speedtest-history', 'id': 'speedtest-history' }, [])
		]);
		var view = document.getElementById('view');
		view.appendChild(card);     // append at END (not first-fold)

		this.renderHistory();
	},

	runTest: function () {
		var btn = document.getElementById('speedtest-run');
		btn.disabled = true;
		var self = this;

		this.setStat('download', '—');
		this.setStat('upload', '—');
		this.setStat('latency', '—');
		this.setStat('jitter', '—');

		// Step 46: capture label + results so we can save a history entry on
		// success. Initialised as null sentinels; written inside each phase.
		var labelEl = document.getElementById('speedtest-label');
		var label   = labelEl ? labelEl.value : 'Other';
		var result  = { t: Date.now(), label: label, latency: null, jitter: null, download: null, upload: null };

		btn.textContent = _('Testing latency (%d samples)…').replace('%d', PING_COUNT);

		this.testLatency()
			.then(function (l) {
				if (l.median !== null) {
					self.setStat('latency', l.median.toFixed(1) + ' ms');
					self.setStat('jitter',  l.jitter.toFixed(1) + ' ms');
					result.latency = l.median;
					result.jitter  = l.jitter;
				}
				btn.textContent = _('Testing download (%d MB)…').replace('%d', DOWNLOAD_BYTES / 1024 / 1024);
				return self.testDownload();
			})
			.then(function (mbps) {
				self.setStat('download', mbps !== null ? mbps.toFixed(1) + ' Mbps' : _('error'));
				if (mbps !== null) result.download = mbps;
				btn.textContent = _('Testing upload (%d MB)…').replace('%d', UPLOAD_BYTES / 1024 / 1024);
				return self.testUpload();
			})
			.then(function (mbps) {
				self.setStat('upload', mbps !== null ? mbps.toFixed(1) + ' Mbps' : _('error'));
				if (mbps !== null) result.upload = mbps;

				// Step 46: persist + refresh history list. Only save if at
				// least one number was captured (avoid littering on a totally
				// failed run).
				if (result.latency !== null || result.download !== null || result.upload !== null) {
					pushHistory(result);
					self.renderHistory();
				}
			})
			.catch(function (e) {
				if (window.toast) toast.error(_('Speed test failed') + ': ' + (e && e.message ? e.message : 'unknown'));
			})
			.finally(function () {
				btn.disabled = false;
				btn.textContent = _('Run test');
			});
	},

	// Step 46: render the history strip from localStorage. Called once on
	// inject and after every successful test. Hidden when empty so a fresh
	// install doesn't waste vertical space.
	renderHistory: function () {
		var host = document.getElementById('speedtest-history');
		if (!host) return;
		var history = loadHistory();
		host.innerHTML = '';
		if (!history.length) {
			host.style.display = 'none';
			return;
		}
		host.style.display = '';

		var self = this;
		host.appendChild(E('div', { 'class': 'speedtest-history-head' }, [
			E('span', { 'class': 'speedtest-history-title' }, _('Recent runs')),
			E('button', {
				'type':  'button',
				'class': 'speedtest-history-clear',
				'aria-label': _('Clear history'),
				'click': function () {
					saveHistory([]);
					self.renderHistory();
				}
			}, _('Clear'))
		]));

		var list = E('ul', { 'class': 'speedtest-history-list' }, []);
		history.forEach(function (entry) {
			list.appendChild(E('li', { 'class': 'speedtest-history-item' }, [
				E('span', { 'class': 'speedtest-history-label' }, entry.label),
				E('span', { 'class': 'speedtest-history-when' }, fmtAgo(entry.t)),
				E('span', { 'class': 'speedtest-history-metric speedtest-history-metric-d' },
					entry.download !== null ? '↓ ' + entry.download.toFixed(0) + ' Mbps' : '↓ —'),
				E('span', { 'class': 'speedtest-history-metric speedtest-history-metric-u' },
					entry.upload   !== null ? '↑ ' + entry.upload.toFixed(0)   + ' Mbps' : '↑ —'),
				E('span', { 'class': 'speedtest-history-metric speedtest-history-metric-l' },
					entry.latency  !== null ? entry.latency.toFixed(1)         + ' ms'   : '— ms')
			]));
		});
		host.appendChild(list);
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
