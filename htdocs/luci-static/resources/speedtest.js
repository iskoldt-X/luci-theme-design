'use strict';
'require baseclass';
'require ui';

// Step 83 (Round 13): SVG namespace helpers. The rogue 'i-activity' that
// Chrome-Claude found in HTML namespace was this file's speedtest-icon
// in the card header. Same fix applied to the gauge SVGs (semi-circle
// dials) which were also E('svg'/'path',...) and thus rendering blank
// stroke patterns even when their attrs are set.
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

var STORAGE_KEY      = 'design-speedtest-history-v1';
var STORAGE_KEY_SIZE = 'design-speedtest-size-v1';   // Step 64: persisted file-size preset
var HISTORY_MAX = 6;

// Step 64: user-selectable test size. Default 200 MB hits a balance
// between "fast enough not to feel slow" and "long enough to saturate
// gigabit Wi-Fi past TCP slow-start". 1 GB option is honest about being
// 'thorough' / slow.
//
// Upload bytes are derived as half the download size — uploads on real
// links are typically slower so we don't need as much data to get a
// stable rate, and it cuts the total test time.
var SIZE_PRESETS_MB = {
	'50':   { dl: 50,   ul: 25,  label: '50 MB',  hint: 'quick' },
	'200':  { dl: 200,  ul: 100, label: '200 MB', hint: 'default' },
	'500':  { dl: 500,  ul: 250, label: '500 MB', hint: '' },
	'1024': { dl: 1024, ul: 512, label: '1 GB',   hint: 'thorough' }
};

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

	// Step 52: rebuilt to match upgrade-preview.html §A5 — two semicircle
	// gauges for download/upload (SVG arc with stroke-dashoffset animation)
	// + 3 small stat cards for latency / jitter / loss.
	injectCard: function () {
		var self = this;
		var card = E('div', { 'class': 'speedtest-card', 'id': 'speedtest-card' }, [
			E('div', { 'class': 'speedtest-head' }, [
				svgEl('svg', { 'class': 'svg-icon speedtest-icon', 'aria-hidden': 'true' },
					svgUse(this.iconBase + '#i-activity')),
				E('span', { 'class': 'speedtest-title' }, _('Wi-Fi / LAN Link Test')),
				E('span', { 'class': 'speedtest-meta' }, _('Browser ↔ router'))
			]),
			// Step 52: 2 semicircle gauges (download / upload)
			E('div', { 'class': 'speedtest-gauges' }, [
				this.makeGauge('download', _('Download'), 'st-down-num', '↓'),
				this.makeGauge('upload',   _('Upload'),   'st-up-num',   '↑')
			]),
			// Step 52: 3 small stat cards under the gauges
			E('div', { 'class': 'speedtest-stats' }, [
				this.makeStat(_('Latency'), 'st-latency', 'ms'),
				this.makeStat(_('Jitter'),  'st-jitter',  'ms'),
				this.makeStat(_('Loss'),    'st-loss',    '%')
			]),
			E('div', { 'class': 'speedtest-actions' }, [
				// Step 46: label select lets the user tag the run.
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
				// Step 64: file-size selector. Persists last choice to
				// localStorage so the user doesn't re-pick every test.
				E('select', {
					'id':    'speedtest-size',
					'class': 'speedtest-label-select',
					'aria-label': _('Test size')
				}, Object.keys(SIZE_PRESETS_MB).map(function (mb) {
					var p = SIZE_PRESETS_MB[mb];
					var text = p.label + (p.hint ? ' · ' + _(p.hint) : '');
					return E('option', { 'value': mb }, text);
				})),
				E('button', {
					'type':  'button',
					'class': 'cbi-button cbi-button-action cbi-button-positive speedtest-run',
					'id':    'speedtest-run',
					'click': L.bind(this.runTest, this)
				}, _('Run test'))
			]),
			// Step 46: history strip below the actions, hidden if empty.
			E('div', { 'class': 'speedtest-history', 'id': 'speedtest-history' }, [])
		]);
		var view = document.getElementById('view');
		view.appendChild(card);     // append at END (not first-fold)

		this.renderHistory();

		// Step 64: restore last-used file size from localStorage + persist
		// future changes. Defaults to 200 MB if no preference saved or the
		// saved value isn't in the current SIZE_PRESETS_MB map (so retiring
		// a preset doesn't break existing users).
		var sizeEl = document.getElementById('speedtest-size');
		if (sizeEl) {
			var saved = '';
			try { saved = localStorage.getItem(STORAGE_KEY_SIZE) || ''; }
			catch (e) { /* localStorage disabled — fall through to default */ }
			if (saved && SIZE_PRESETS_MB[saved]) {
				sizeEl.value = saved;
			} else {
				sizeEl.value = '200';
			}
			sizeEl.addEventListener('change', function () {
				try { localStorage.setItem(STORAGE_KEY_SIZE, sizeEl.value); } catch (e) {}
			});
		}
	},

	// Step 52: build one gauge — semicircle SVG track + animated bar +
	// big text below with arrow + number + unit. valueId is the span id
	// for setGauge() to update.
	makeGauge: function (kind, label, valueId, arrow) {
		// Arc path: M 20,100 A 80,80 0 0 1 180,100 — semicircle, radius 80,
		// total path length ≈ 251 (π × 80). dasharray=251 dashoffset=251 →
		// fully hidden, animate to dashoffset=0 for full.
		return E('div', { 'class': 'speedtest-gauge speedtest-gauge-' + kind }, [
			E('div', { 'class': 'speedtest-gauge-label' }, label),
			svgEl('svg', {
				'class':   'speedtest-gauge-svg',
				'viewBox': '0 0 200 110',
				'preserveAspectRatio': 'xMidYMid meet',
				'aria-hidden': 'true'
			}, [
				svgEl('path', {
					'class': 'speedtest-gauge-track',
					'd':     'M 20,100 A 80,80 0 0 1 180,100',
					'fill':  'none',
					'stroke': '#d4d4d8',     // border-default light, dark via CSS
					'stroke-width': '10',
					'stroke-linecap': 'round'
				}),
				svgEl('path', {
					'class':              'speedtest-gauge-bar',
					'id':                 'st-bar-' + kind,
					'd':                  'M 20,100 A 80,80 0 0 1 180,100',
					'fill':               'none',
					'stroke':             (kind === 'download') ? '#10b981' : '#3b82f6',
					'stroke-width':       '10',
					'stroke-linecap':     'round',
					'stroke-dasharray':   '251',
					'stroke-dashoffset':  '251'
				})
			]),
			E('div', { 'class': 'speedtest-gauge-value' }, [
				E('span', { 'class': 'speedtest-gauge-arrow' }, arrow),
				E('span', { 'class': 'speedtest-gauge-num', 'id': valueId }, '—'),
				E('span', { 'class': 'speedtest-gauge-unit' }, ' Mbps')
			])
		]);
	},

	// Step 52: build one small stat card (latency / jitter / loss).
	makeStat: function (label, valueId, unit) {
		return E('div', { 'class': 'speedtest-stat' }, [
			E('div', { 'class': 'speedtest-stat-label' }, label),
			E('div', { 'class': 'speedtest-stat-value' }, [
				E('span', { 'id': valueId }, '—'),
				E('span', { 'class': 'speedtest-stat-unit' }, ' ' + unit)
			])
		]);
	},

	// Step 52: update one gauge — both the SVG bar (stroke-dashoffset)
	// and the value text. mbps=null means "reset to —".
	// SCALE_MBPS picks the dashoffset scale: 1000 Mbps = full bar.
	// Linear; sub-Gbps connections will look proportional. Could switch
	// to log scale later if users with 10 Mbps WAN report the gauge
	// feels empty.
	setGauge: function (kind, mbps) {
		var SCALE_MBPS = 1000;
		var bar  = document.getElementById('st-bar-' + kind);
		var num  = document.getElementById('st-' + (kind === 'download' ? 'down' : 'up') + '-num');
		if (bar) {
			var progress = (mbps === null || !isFinite(mbps))
				? 0
				: Math.min(1, Math.max(0, mbps / SCALE_MBPS));
			var offset = 251 * (1 - progress);
			bar.setAttribute('stroke-dashoffset', offset.toFixed(1));
		}
		if (num) {
			num.textContent = (mbps === null || !isFinite(mbps)) ? '—' : mbps.toFixed(1);
		}
	},

	runTest: function () {
		var btn = document.getElementById('speedtest-run');
		btn.disabled = true;
		var self = this;

		// Step 52: reset both gauges + stats to '—' at the start of a run.
		this.setGauge('download', null);
		this.setGauge('upload',   null);
		this.setStat('latency', '—');
		this.setStat('jitter',  '—');
		this.setStat('loss',    '—');

		// Step 46: capture label + results so we can save a history entry on
		// success. Initialised as null sentinels; written inside each phase.
		var labelEl = document.getElementById('speedtest-label');
		var label   = labelEl ? labelEl.value : 'Other';

		// Step 64: read selected file size and convert MB → bytes for the
		// CGI request. Falls back to the legacy DOWNLOAD_BYTES/UPLOAD_BYTES
		// defaults if the select element isn't present (e.g. some plugin
		// stripped it) — backwards-compat.
		var sizeEl = document.getElementById('speedtest-size');
		var preset = (sizeEl && SIZE_PRESETS_MB[sizeEl.value]) || SIZE_PRESETS_MB['200'];
		var downloadBytes = preset.dl * 1024 * 1024;
		var uploadBytes   = preset.ul * 1024 * 1024;

		var result  = {
			t: Date.now(), label: label,
			latency: null, jitter: null, loss: null,
			download: null, upload: null,
			sizeLabel: preset.label    // Step 64: track which size was used for history
		};

		btn.textContent = _('Testing latency (%d samples)…').replace('%d', PING_COUNT);

		this.testLatency()
			.then(function (l) {
				if (l.median !== null) {
					self.setStat('latency', l.median.toFixed(1));
					self.setStat('jitter',  l.jitter.toFixed(1));
					result.latency = l.median;
					result.jitter  = l.jitter;
				}
				// Step 52: loss tracked even when no successful samples.
				self.setStat('loss', l.loss.toFixed(0));
				result.loss = l.loss;

				btn.textContent = _('Testing download (%d MB)…').replace('%d', downloadBytes / 1024 / 1024);
				return self.testDownload(downloadBytes);
			})
			.then(function (mbps) {
				self.setGauge('download', mbps);
				if (mbps !== null) result.download = mbps;
				btn.textContent = _('Testing upload (%d MB)…').replace('%d', uploadBytes / 1024 / 1024);
				return self.testUpload(uploadBytes);
			})
			.then(function (mbps) {
				self.setGauge('upload', mbps);
				if (mbps !== null) result.upload = mbps;

				// Step 46: persist + refresh history.
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
		// Step 52: track packet loss (failed pings as % of total) in addition
		// to median + jitter. .catch() increments failures instead of silently
		// retrying so the loss metric is meaningful.
		var samples  = [];
		var failures = 0;
		function next() {
			if (samples.length + failures >= PING_COUNT) {
				return {
					median: samples.length ? median(samples) : null,
					jitter: samples.length ? stddev(samples) : 0,
					loss:   (failures / PING_COUNT) * 100
				};
			}
			var t0 = performance.now();
			return fetch('/cgi-bin/design/ping?t=' + Date.now(), { cache: 'no-store' })
				.then(function (r) {
					if (!r.ok) throw new Error('http ' + r.status);
					samples.push(performance.now() - t0);
					return next();
				})
				.catch(function () { failures++; return next(); });
		}
		return Promise.resolve().then(next);
	},

	// Step 64: testDownload/testUpload now take a bytes argument so the
	// caller (runTest) can pass the user-selected size. Default args fall
	// back to the legacy module-level constants for any external callers.
	testDownload: function (bytes) {
		bytes = bytes || DOWNLOAD_BYTES;
		var t0 = performance.now();
		var ctrl = new AbortController();
		var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
		return fetch('/cgi-bin/design/download?bytes=' + bytes + '&t=' + Date.now(), {
			signal: ctrl.signal, cache: 'no-store'
		}).then(function (r) {
			if (!r.ok) throw new Error('HTTP ' + r.status);
			return r.blob();
		}).then(function (blob) {
			clearTimeout(to);
			var ms = performance.now() - t0;
			var actual = blob.size;
			var mbps = (actual * 8) / (ms / 1000) / 1e6;
			return mbps;
		}).catch(function () { clearTimeout(to); return null; });
	},

	testUpload: function (bytes) {
		bytes = bytes || UPLOAD_BYTES;
		var payload = new Blob([new Uint8Array(bytes)]);
		var t0 = performance.now();
		var ctrl = new AbortController();
		var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
		return fetch('/cgi-bin/design/upload', {
			method: 'POST', body: payload, signal: ctrl.signal, cache: 'no-store'
		}).then(function (r) {
			clearTimeout(to);
			if (!r.ok) throw new Error('HTTP ' + r.status);
			var ms = performance.now() - t0;
			var mbps = (bytes * 8) / (ms / 1000) / 1e6;
			return mbps;
		}).catch(function () { clearTimeout(to); return null; });
	},

	setStat: function (which, value) {
		var el = document.getElementById('st-' + which);
		if (el) el.textContent = value;
	}
});
