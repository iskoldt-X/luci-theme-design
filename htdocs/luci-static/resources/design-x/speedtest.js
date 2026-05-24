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
			]),
			// Step 145 (Round 39):scale indicator. setGauge() writes
			// "max 1 Gbps" / "max 2.5 Gbps" etc. so users know what 100%
			// of the gauge represents. Without this, 184 Mbps showing at
			// 18% of the bar is ambiguous (could mean "18% of 1 Gbps" or
			// "18% of whatever this gauge maxes at").
			E('div', { 'class': 'speedtest-gauge-scale', 'id': 'st-scale-' + kind }, '')
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

	// Step 52 → Step 145 (Round 39):adaptive gauge scale.
	//
	// Old design hardcoded SCALE_MBPS = 1000 (1 Gbps = full bar). Worked
	// for typical home connections (100-940 Mbps lands in the visually
	// active 10-94% range). Broke on:
	//   - LAN tests over 2.5GbE / 10GbE wired (1300-9000 Mbps → clamped
	//     to 100%, gauge needle pegged at right side, displayed Mbps
	//     could exceed gauge max with no visual feedback)
	//   - Sub-100Mbps connections at the lower end where a 50 Mbps test
	//     only fills 5% of the bar — looks like 'nothing happened'.
	//
	// New: pick the smallest standard scale from SCALES_MBPS that fits
	// the current value with ~20% headroom (mbps * 1.2 <= scale). Scale
	// label below the gauge shows the active range.
	//
	// IMPORTANT — monotone-up within a single test
	// Step 143/144 stream live updates ~10x/sec. If the scale auto-picked
	// per call, mid-test variations (e.g. TCP slow-start at 50 Mbps →
	// steady 800 Mbps) would cause the bar to JUMP backward visually
	// (50/100 = 50% → 800/1000 = 80%) — gauge needle skating sideways.
	// Instead: scale only INCREASES within a test (peak ratchets up).
	// runTest() resets the ratchet at the start of every run via
	// resetGaugeScale().
	//
	// The 'rescale-up' transition has a UX benefit: when network is
	// faster than the gauge initially picked, user sees the gauge
	// "shift down a notch and keep going" — communicates 'you're faster
	// than I thought, here's more headroom'. Positive feedback signal.
	setGauge: function (kind, mbps) {
		var SCALES_MBPS = [100, 250, 500, 1000, 2500, 5000, 10000];
		var bar     = document.getElementById('st-bar-' + kind);
		var num     = document.getElementById('st-' + (kind === 'download' ? 'down' : 'up') + '-num');
		var scaleEl = document.getElementById('st-scale-' + kind);

		this._gaugeScale = this._gaugeScale || { download: SCALES_MBPS[0], upload: SCALES_MBPS[0] };

		if (mbps === null || !isFinite(mbps)) {
			// Reset state
			if (bar) bar.setAttribute('stroke-dashoffset', 251);
			if (num) num.textContent = '—';
			if (scaleEl) scaleEl.textContent = '';
			return;
		}

		// Pick smallest scale that fits with 20% headroom
		var fitScale = SCALES_MBPS[SCALES_MBPS.length - 1];
		for (var i = 0; i < SCALES_MBPS.length; i++) {
			if (mbps * 1.2 <= SCALES_MBPS[i]) { fitScale = SCALES_MBPS[i]; break; }
		}
		// Monotone-up: ratchet, never decrease during a single test
		if (fitScale > this._gaugeScale[kind]) this._gaugeScale[kind] = fitScale;
		var useScale = this._gaugeScale[kind];

		var progress = Math.min(1, Math.max(0, mbps / useScale));
		var offset = 251 * (1 - progress);
		if (bar) bar.setAttribute('stroke-dashoffset', offset.toFixed(1));
		// More precision for sub-100 Mbps so slow links don't drop to "0.0"
		if (num) num.textContent = mbps < 100 ? mbps.toFixed(1) : mbps.toFixed(0);
		if (scaleEl) {
			scaleEl.textContent = useScale >= 1000
				? 'max ' + (useScale / 1000) + ' Gbps'
				: 'max ' + useScale + ' Mbps';
		}
	},

	// Step 145 (Round 39):called by runTest() before each test starts to
	// reset the gauge-scale ratchet. Without this, a slow test (50 Mbps)
	// after a fast one (2500 Mbps) would still use the 2500 Mbps scale,
	// showing the slow test as 2% of the bar.
	resetGaugeScale: function () {
		this._gaugeScale = { download: 100, upload: 100 };
	},

	runTest: function () {
		var btn = document.getElementById('speedtest-run');
		btn.disabled = true;
		var self = this;

		// Step 52: reset both gauges + stats to '—' at the start of a run.
		// Step 145 (Round 39):also reset the adaptive scale ratchet so a
		// slow test after a fast one doesn't render at 2% of an oversized bar.
		this.resetGaugeScale();
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

		// Step 146 (Round 39):shared progress-text helper. Builds the live
		// button label "Downloading… 23.4 / 50 MB (47%)" from received/total.
		// Verb is i18n'd; numerals are not (no translation needed). Called
		// at 10fps from testDownload/testUpload via the onProgress callback.
		function progressText(verb, received, total) {
			var receivedMB = (received / 1024 / 1024).toFixed(1);
			var totalMB    = (total    / 1024 / 1024).toFixed(0);
			var pct        = total > 0 ? Math.round((received / total) * 100) : 0;
			return verb + ' ' + receivedMB + ' / ' + totalMB + ' MB (' + pct + '%)';
		}

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

				// Step 146:live progress text + onProgress callback.
				var verbDL = _('Downloading…');
				btn.textContent = verbDL + ' 0 / ' + (downloadBytes / 1024 / 1024).toFixed(0) + ' MB (0%)';
				return self.testDownload(downloadBytes, function (received, total) {
					btn.textContent = progressText(verbDL, received, total);
				});
			})
			.then(function (mbps) {
				self.setGauge('download', mbps);
				if (mbps !== null) result.download = mbps;
				// Step 146:save peak captured during the live test
				if (self._lastTestPeak && isFinite(self._lastTestPeak.download)) {
					result.peakDownload = self._lastTestPeak.download;
				}
				var verbUL = _('Uploading…');
				btn.textContent = verbUL + ' 0 / ' + (uploadBytes / 1024 / 1024).toFixed(0) + ' MB (0%)';
				return self.testUpload(uploadBytes, function (received, total) {
					btn.textContent = progressText(verbUL, received, total);
				});
			})
			.then(function (mbps) {
				self.setGauge('upload', mbps);
				if (mbps !== null) result.upload = mbps;
				// Step 146:same for upload peak
				if (self._lastTestPeak && isFinite(self._lastTestPeak.upload)) {
					result.peakUpload = self._lastTestPeak.upload;
				}

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
			// Step 146 (Round 39):peak captured during live test (from
			// 500ms window max). Show in tooltip so the history row stays
			// compact but the info is preserved for hover inspection.
			var dlTip = (entry.peakDownload && isFinite(entry.peakDownload))
				? _('Avg') + ' ' + (entry.download || 0).toFixed(1) + ' Mbps · ' + _('Peak') + ' ' + entry.peakDownload.toFixed(1) + ' Mbps'
				: '';
			var ulTip = (entry.peakUpload && isFinite(entry.peakUpload))
				? _('Avg') + ' ' + (entry.upload || 0).toFixed(1) + ' Mbps · ' + _('Peak') + ' ' + entry.peakUpload.toFixed(1) + ' Mbps'
				: '';
			list.appendChild(E('li', { 'class': 'speedtest-history-item' }, [
				E('span', { 'class': 'speedtest-history-label' }, entry.label),
				E('span', { 'class': 'speedtest-history-when' }, fmtAgo(entry.t)),
				E('span', {
					'class': 'speedtest-history-metric speedtest-history-metric-d',
					'title': dlTip
				}, entry.download !== null ? '↓ ' + entry.download.toFixed(0) + ' Mbps' : '↓ —'),
				E('span', {
					'class': 'speedtest-history-metric speedtest-history-metric-u',
					'title': ulTip
				}, entry.upload   !== null ? '↑ ' + entry.upload.toFixed(0)   + ' Mbps' : '↑ —'),
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
			return fetch('/cgi-bin/luci/admin/design-x/ping?t=' + Date.now(), { cache: 'no-store' })
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
	//
	// Step 143 (Round 39):rewrote testDownload to use ReadableStream
	// instead of r.blob(). The blob() variant waited for the ENTIRE
	// response body before resolving — so during a 2.3s 50MB download the
	// gauge needle stayed at empty, then jumped to final value in one
	// frame. Chrome-Claude's polling recorder confirmed the gauge had ZERO
	// updates between phase start and finish.
	//
	// Now: stream-read in chunks (CGI emits 5-10KB chunks ~5ms apart),
	// accumulate received bytes, compute instantaneous mbps over a 500ms
	// sliding window (smoother than per-chunk rate, more responsive than
	// cumulative average), throttle UI updates to ~10fps, and call
	// setGauge() each tick. Result: needle visibly moves throughout the
	// test, matching the "car speedometer" visual metaphor.
	//
	// Final mbps returned is the full-test average (more stable than
	// last-window mbps for history records). Peak tracked separately in
	// self._lastTestPeak for Step 146 history enrichment.
	testDownload: function (bytes, onProgress) {
		bytes = bytes || DOWNLOAD_BYTES;
		var self = this;
		var t0 = performance.now();
		var ctrl = new AbortController();
		var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

		return fetch('/cgi-bin/luci/admin/design-x/download?bytes=' + bytes + '&t=' + Date.now(), {
			signal: ctrl.signal, cache: 'no-store'
		}).then(function (r) {
			if (!r.ok) throw new Error('HTTP ' + r.status);

			var reader       = r.body.getReader();
			var received     = 0;
			var lastUiUpdate = 0;
			var samples      = [];   // [{ t, bytes }] sliding window
			var WINDOW_MS    = 500;
			var FPS_MS       = 100;  // ~10 fps UI cap
			var peakMbps     = 0;

			function pump() {
				return reader.read().then(function (chunk) {
					if (chunk.done) {
						clearTimeout(to);
						var totalMs = performance.now() - t0;
						var avgMbps = (received * 8) / (totalMs / 1000) / 1e6;
						self._lastTestPeak = self._lastTestPeak || {};
						self._lastTestPeak.download = peakMbps;
						return avgMbps;
					}
					received += chunk.value.length;
					var now = performance.now();
					samples.push({ t: now, bytes: received });
					while (samples.length > 1 && now - samples[0].t > WINDOW_MS) samples.shift();

					if (now - lastUiUpdate > FPS_MS) {
						lastUiUpdate = now;
						var oldest   = samples[0];
						var winBytes = received - oldest.bytes;
						var winMs    = now - oldest.t;
						var mbps     = winMs > 0 ? (winBytes * 8) / (winMs / 1000) / 1e6 : 0;
						if (mbps > peakMbps) peakMbps = mbps;
						self.setGauge('download', mbps);
						// Step 146:button progress text. Same throttle as gauge.
						if (onProgress) onProgress(received, bytes);
					}
					return pump();
				});
			}
			return pump();
		}).catch(function () { clearTimeout(to); return null; });
	},

	// Step 144 (Round 39):testUpload via XMLHttpRequest for live gauge.
	// fetch() doesn't expose upload-side progress events for the request
	// body — a 10+ year browser-spec gap. XMLHttpRequest's xhr.upload.
	// onprogress IS the only standard API that gives bytes-sent-so-far
	// during a POST.
	//
	// Same sliding-window + UI-throttle pattern as Step 143's testDownload,
	// just driven by xhr.upload.onprogress (ev.loaded) instead of by
	// reader.read() chunks. peakMbps tracked for Step 146.
	testUpload: function (bytes, onProgress) {
		bytes = bytes || UPLOAD_BYTES;
		var self    = this;
		var payload = new Blob([new Uint8Array(bytes)]);
		var t0      = performance.now();

		return new Promise(function (resolve) {
			var xhr          = new XMLHttpRequest();
			var lastUiUpdate = 0;
			var samples      = [];   // [{ t, bytes }] sliding window
			var WINDOW_MS    = 500;
			var FPS_MS       = 100;
			var peakMbps     = 0;
			var done         = false;

			xhr.open('POST', '/cgi-bin/luci/admin/design-x/upload', true);
			xhr.timeout = TIMEOUT_MS;

			xhr.upload.onprogress = function (ev) {
				if (done || !ev.lengthComputable) return;
				var now = performance.now();
				samples.push({ t: now, bytes: ev.loaded });
				while (samples.length > 1 && now - samples[0].t > WINDOW_MS) samples.shift();

				if (now - lastUiUpdate > FPS_MS) {
					lastUiUpdate = now;
					var oldest   = samples[0];
					var winBytes = ev.loaded - oldest.bytes;
					var winMs    = now - oldest.t;
					var mbps     = winMs > 0 ? (winBytes * 8) / (winMs / 1000) / 1e6 : 0;
					if (mbps > peakMbps) peakMbps = mbps;
					self.setGauge('upload', mbps);
					// Step 146:button progress text. Same throttle as gauge.
					if (onProgress) onProgress(ev.loaded, bytes);
				}
			};

			xhr.onload = function () {
				done = true;
				if (xhr.status < 200 || xhr.status >= 300) { resolve(null); return; }
				var totalMs = performance.now() - t0;
				var avgMbps = (bytes * 8) / (totalMs / 1000) / 1e6;
				self._lastTestPeak = self._lastTestPeak || {};
				self._lastTestPeak.upload = peakMbps;
				resolve(avgMbps);
			};
			xhr.onerror = function () { done = true; resolve(null); };
			xhr.ontimeout = function () { done = true; resolve(null); };
			xhr.onabort = function () { done = true; resolve(null); };

			xhr.send(payload);
		});
	},

	setStat: function (which, value) {
		var el = document.getElementById('st-' + which);
		if (el) el.textContent = value;
	}
});
