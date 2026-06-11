'use strict';
'require baseclass';
'require ui';

// SVG namespace helpers (see sparkline.js for the full rationale — LuCI's
// E('svg',…) makes HTMLUnknownElement which the browser won't paint as SVG).
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
// Wi-Fi / LAN link speedtest — redesign-2026-06 §三.2
//
// Tests browser ↔ router throughput (NOT browser ↔ internet).
//
// Round 49 STRUCTURAL CHANGE (redesign §三.2): the card collapses to a SUMMARY
// CARD + a single [Run] button. The summary shows the last run's ↓/↑/latency
// (mono + direction colors), relative time, and a mini bar chart of the last 5
// runs. The Wired/size dropdowns and the live gauges/progress move into a
// RIGHT-SIDE DRAWER that opens on Run. The drawer has a focus trap (copied from
// cmdk.js's Tab handler), Escape-to-close, a reduced-motion-safe slide, and an
// independent Cancel button. On completion: write history, update summary, the
// drawer stays open until dismissed. The Overview summary card NEVER changes
// height (fixed-size law §一.5) because the live machinery is in the overlay.
//
// The three-phase state machine is UNCHANGED:
//   1. testLatency()  — N × ping → median + jitter + loss
//   2. testDownload() — stream-read, live gauge, avg + peak
//   3. testUpload()   — XHR upload progress, live gauge, avg + peak
// runTest() chains them; only the DOM targets (now inside the drawer) and the
// open/close/cancel wiring are new.
// ─────────────────────────────────────────────────────────────────────────────

var STORAGE_KEY      = 'design-speedtest-history-v1';
var STORAGE_KEY_SIZE = 'design-speedtest-size-v1';
var HISTORY_MAX = 6;

var SIZE_PRESETS_MB = {
	'50':   { dl: 50,   ul: 25,  label: '50 MB',  hint: 'quick' },
	'200':  { dl: 200,  ul: 100, label: '200 MB', hint: 'default' },
	'500':  { dl: 500,  ul: 250, label: '500 MB', hint: '' },
	'1024': { dl: 1024, ul: 512, label: '1 GB',   hint: 'thorough' }
};

var PING_COUNT      = 20;
var DOWNLOAD_BYTES  = 50 * 1024 * 1024;
var UPLOAD_BYTES    = 25 * 1024 * 1024;
var TIMEOUT_MS      = 60000;

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

// History persistence — localStorage, best-effort, fails silent.
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

	// ── Summary card (redesign §三.2) ──────────────────────────────────────
	// Compact, always-static-height card: head, last-run line, relative time,
	// mini bar chart of last 5 runs, primary [Run] button. No controls
	// clutter — the dropdowns live in the drawer.
	injectCard: function () {
		var card = E('div', { 'class': 'speedtest-summary', 'id': 'speedtest-summary' }, [
			E('div', { 'class': 'speedtest-head' }, [
				svgEl('svg', { 'class': 'svg-icon speedtest-icon', 'aria-hidden': 'true' },
					svgUse(this.iconBase + '#i-activity')),
				E('span', { 'class': 'speedtest-title' }, _('Speed test')),
				E('span', { 'class': 'speedtest-meta' }, _('Browser ↔ router'))
			]),
			// Last-run readout line: ↓ / ↑ / latency, mono + direction colors.
			E('div', { 'class': 'speedtest-last', 'id': 'speedtest-last' }, [
				E('span', { 'class': 'speedtest-last-metric speedtest-last-down' }, [
					E('span', { 'class': 'speedtest-last-arrow' }, '↓'),
					E('span', { 'class': 'speedtest-last-num', 'id': 'speedtest-last-down' }, '—'),
					E('span', { 'class': 'speedtest-last-unit' }, ' Mbps')
				]),
				E('span', { 'class': 'speedtest-last-metric speedtest-last-up' }, [
					E('span', { 'class': 'speedtest-last-arrow' }, '↑'),
					E('span', { 'class': 'speedtest-last-num', 'id': 'speedtest-last-up' }, '—'),
					E('span', { 'class': 'speedtest-last-unit' }, ' Mbps')
				]),
				E('span', { 'class': 'speedtest-last-metric speedtest-last-lat' }, [
					E('span', { 'class': 'speedtest-last-num', 'id': 'speedtest-last-lat' }, '—'),
					E('span', { 'class': 'speedtest-last-unit' }, ' ms')
				])
			]),
			E('div', { 'class': 'speedtest-last-when', 'id': 'speedtest-last-when' }, _('No runs yet')),
			// Mini bar chart of last 5 runs (download Mbps).
			E('div', { 'class': 'speedtest-mini', 'id': 'speedtest-mini' }, []),
			E('div', { 'class': 'speedtest-summary-actions' }, [
				E('button', {
					'type':  'button',
					'class': 'cbi-button cbi-button-action cbi-button-positive speedtest-run',
					'id':    'speedtest-run',
					'click': L.bind(this.openDrawer, this)
				}, [
					svgEl('svg', { 'class': 'svg-icon', 'aria-hidden': 'true' }, svgUse(this.iconBase + '#i-play')),
					E('span', {}, _('Run'))
				])
			])
		]);
		var view = document.getElementById('view');
		// Append at END of the natural flow; the grid wrapper (style.css)
		// re-flows the Connection card + this summary into row 1.
		view.appendChild(card);

		this.renderSummary();
	},

	// ── Right-side drawer (redesign §三.2) ─────────────────────────────────
	// Built once, lazily, on first Run. Contains the label/size controls,
	// the gauges + stats + progress, and Cancel/Close. focus trap + Escape.
	buildDrawer: function () {
		if (this.drawer) return;
		var self = this;

		var labelSelect = E('select', {
			'id': 'speedtest-label', 'class': 'speedtest-label-select', 'aria-label': _('Test label')
		}, [
			E('option', { 'value': 'Wired'   }, _('Wired')),
			E('option', { 'value': '5 GHz', 'selected': 'selected' }, _('Wi-Fi 5 GHz')),
			E('option', { 'value': '2.4 GHz' }, _('Wi-Fi 2.4 GHz')),
			E('option', { 'value': 'Other'   }, _('Other'))
		]);
		var sizeSelect = E('select', {
			'id': 'speedtest-size', 'class': 'speedtest-label-select', 'aria-label': _('Test size')
		}, Object.keys(SIZE_PRESETS_MB).map(function (mb) {
			var p = SIZE_PRESETS_MB[mb];
			var text = p.label + (p.hint ? ' · ' + _(p.hint) : '');
			return E('option', { 'value': mb }, text);
		}));

		var panel = E('div', {
			'class': 'speedtest-drawer-panel',
			'role': 'dialog',
			'aria-modal': 'true',
			'aria-label': _('Speed test')
		}, [
			E('div', { 'class': 'speedtest-drawer-head' }, [
				E('span', { 'class': 'speedtest-drawer-title' }, _('Speed test')),
				E('button', {
					'type': 'button',
					'class': 'speedtest-drawer-close',
					'aria-label': _('Close'),
					'click': L.bind(this.closeDrawer, this)
				}, [
					svgEl('svg', { 'class': 'svg-icon', 'aria-hidden': 'true' }, svgUse(this.iconBase + '#i-x'))
				])
			]),
			// Controls (moved out of the summary card per §三.2).
			E('div', { 'class': 'speedtest-drawer-controls' }, [
				E('label', { 'class': 'speedtest-control' }, [
					E('span', { 'class': 'speedtest-control-label' }, _('Link')), labelSelect
				]),
				E('label', { 'class': 'speedtest-control' }, [
					E('span', { 'class': 'speedtest-control-label' }, _('Size')), sizeSelect
				])
			]),
			// Gauges.
			E('div', { 'class': 'speedtest-gauges' }, [
				this.makeGauge('download', _('Download'), 'st-down-num', '↓'),
				this.makeGauge('upload',   _('Upload'),   'st-up-num',   '↑')
			]),
			// Stats.
			E('div', { 'class': 'speedtest-stats' }, [
				this.makeStat(_('Latency'), 'st-latency', 'ms'),
				this.makeStat(_('Jitter'),  'st-jitter',  'ms'),
				this.makeStat(_('Loss'),    'st-loss',    '%')
			]),
			// Live progress text + the run/cancel control. The control is a
			// SEPARATE Cancel button during a run — it no longer morphs into a
			// status bar (redesign §三.2: "控件不再变身状态条").
			E('div', { 'class': 'speedtest-progress', 'id': 'speedtest-progress' }, ''),
			E('div', { 'class': 'speedtest-drawer-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-action cbi-button-positive speedtest-drawer-run',
					'id': 'speedtest-drawer-run',
					'click': L.bind(this.runTest, this)
				}, _('Run test')),
				E('button', {
					'type': 'button',
					'class': 'cbi-button speedtest-drawer-cancel',
					'id': 'speedtest-drawer-cancel',
					'disabled': 'disabled',
					'click': L.bind(this.cancelTest, this)
				}, _('Cancel'))
			])
		]);

		var overlay = E('div', { 'class': 'speedtest-drawer-overlay', 'id': 'speedtest-drawer' }, [panel]);
		document.body.appendChild(overlay);

		this.drawer = overlay;
		this.drawerPanel = panel;

		// Click on the dimmed backdrop (outside the panel) closes.
		overlay.addEventListener('mousedown', function (ev) {
			if (ev.target === overlay) self.closeDrawer();
		});
		// Escape + focus trap (Tab handling copied from cmdk.js).
		overlay.addEventListener('keydown', L.bind(this.onDrawerKeydown, this));

		// Restore last-used size from localStorage + persist changes.
		var saved = '';
		try { saved = localStorage.getItem(STORAGE_KEY_SIZE) || ''; } catch (e) {}
		sizeSelect.value = (saved && SIZE_PRESETS_MB[saved]) ? saved : '200';
		sizeSelect.addEventListener('change', function () {
			try { localStorage.setItem(STORAGE_KEY_SIZE, sizeSelect.value); } catch (e) {}
		});
	},

	openDrawer: function () {
		this.buildDrawer();
		this.lastFocus = document.activeElement;
		this.drawer.classList.add('open');
		// rAF so focus lands after the slide-in paint (and so iOS doesn't
		// scroll the page on focus).
		var self = this;
		requestAnimationFrame(function () {
			var firstBtn = document.getElementById('speedtest-drawer-run');
			if (firstBtn) firstBtn.focus();
		});
	},

	closeDrawer: function () {
		if (!this.drawer) return;
		// Don't abandon an in-flight test silently — cancel it first.
		if (this._running) this.cancelTest();
		this.drawer.classList.remove('open');
		if (this.lastFocus && this.lastFocus.focus) {
			try { this.lastFocus.focus(); } catch (e) {}
		}
	},

	// Tab focus trap + Escape — same shape as cmdk.js's onKeydown Tab case.
	onDrawerKeydown: function (ev) {
		if (ev.key === 'Escape') {
			ev.preventDefault();
			this.closeDrawer();
			return;
		}
		if (ev.key !== 'Tab' || !this.drawer) return;
		var focusable = this.drawer.querySelectorAll(
			'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])');
		if (!focusable.length) { ev.preventDefault(); return; }
		var first = focusable[0];
		var last  = focusable[focusable.length - 1];
		if (ev.shiftKey) {
			if (document.activeElement === first || document.activeElement === this.drawer) {
				last.focus(); ev.preventDefault();
			}
		} else {
			if (document.activeElement === last) {
				first.focus(); ev.preventDefault();
			}
		}
	},

	// ── Gauge / stat builders (unchanged structure from prior version) ─────
	makeGauge: function (kind, label, valueId, arrow) {
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
					'stroke-width': '10',
					'stroke-linecap': 'round'
				}),
				svgEl('path', {
					'class':              'speedtest-gauge-bar',
					'id':                 'st-bar-' + kind,
					'd':                  'M 20,100 A 80,80 0 0 1 180,100',
					'fill':               'none',
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
			E('div', { 'class': 'speedtest-gauge-scale', 'id': 'st-scale-' + kind }, ''),
			E('div', { 'class': 'speedtest-gauge-summary', 'id': 'st-summary-' + kind }, '')
		]);
	},

	makeStat: function (label, valueId, unit) {
		return E('div', { 'class': 'speedtest-stat' }, [
			E('div', { 'class': 'speedtest-stat-label' }, label),
			E('div', { 'class': 'speedtest-stat-value' }, [
				E('span', { 'id': valueId }, '—'),
				E('span', { 'class': 'speedtest-stat-unit' }, ' ' + unit)
			])
		]);
	},

	// Adaptive gauge scale (unchanged logic).
	setGauge: function (kind, mbps) {
		var SCALES_MBPS = [100, 250, 500, 1000, 2500, 5000, 10000];
		var bar     = document.getElementById('st-bar-' + kind);
		var num     = document.getElementById('st-' + (kind === 'download' ? 'down' : 'up') + '-num');
		var scaleEl = document.getElementById('st-scale-' + kind);

		this._gaugeScale = this._gaugeScale || { download: SCALES_MBPS[0], upload: SCALES_MBPS[0] };

		if (mbps === null || !isFinite(mbps)) {
			if (bar) bar.setAttribute('stroke-dashoffset', 251);
			if (num) num.textContent = '—';
			if (scaleEl) scaleEl.textContent = '';
			return;
		}

		var fitScale = SCALES_MBPS[SCALES_MBPS.length - 1];
		for (var i = 0; i < SCALES_MBPS.length; i++) {
			if (mbps * 1.2 <= SCALES_MBPS[i]) { fitScale = SCALES_MBPS[i]; break; }
		}
		if (fitScale > this._gaugeScale[kind]) this._gaugeScale[kind] = fitScale;
		var useScale = this._gaugeScale[kind];

		var progress = Math.min(1, Math.max(0, mbps / useScale));
		var offset = 251 * (1 - progress);
		if (bar) bar.setAttribute('stroke-dashoffset', offset.toFixed(1));
		if (num) num.textContent = mbps < 100 ? mbps.toFixed(1) : mbps.toFixed(0);
		if (scaleEl) {
			scaleEl.textContent = useScale >= 1000
				? 'max ' + (useScale / 1000) + ' Gbps'
				: 'max ' + useScale + ' Mbps';
		}
	},

	resetGaugeScale: function () {
		this._gaugeScale = { download: 100, upload: 100 };
	},

	setGaugeSummary: function (kind, avg, peak) {
		var el = document.getElementById('st-summary-' + kind);
		if (!el) return;
		if (avg === null || !isFinite(avg)) { el.textContent = ''; return; }
		var fmt = function (n) { return n < 100 ? n.toFixed(1) : n.toFixed(0); };
		var txt = _('Avg') + ' ' + fmt(avg) + ' Mbps';
		if (peak !== undefined && peak !== null && isFinite(peak)) {
			txt += ' · ' + _('Peak') + ' ' + fmt(peak) + ' Mbps';
		}
		el.textContent = txt;
	},

	setProgress: function (text) {
		var el = document.getElementById('speedtest-progress');
		if (el) el.textContent = text || '';
	},

	runTest: function () {
		if (this._running) return;
		this._running = true;
		this._cancelled = false;

		var runBtn    = document.getElementById('speedtest-drawer-run');
		var cancelBtn = document.getElementById('speedtest-drawer-cancel');
		if (runBtn)    runBtn.disabled = true;
		if (cancelBtn) cancelBtn.disabled = false;

		var self = this;

		this.resetGaugeScale();
		this.setGauge('download', null);
		this.setGauge('upload',   null);
		this.setGaugeSummary('download', null);
		this.setGaugeSummary('upload',   null);
		this.setStat('latency', '—');
		this.setStat('jitter',  '—');
		this.setStat('loss',    '—');

		var labelEl = document.getElementById('speedtest-label');
		var label   = labelEl ? labelEl.value : 'Other';

		var sizeEl = document.getElementById('speedtest-size');
		var preset = (sizeEl && SIZE_PRESETS_MB[sizeEl.value]) || SIZE_PRESETS_MB['200'];
		var downloadBytes = preset.dl * 1024 * 1024;
		var uploadBytes   = preset.ul * 1024 * 1024;

		var result  = {
			t: Date.now(), label: label,
			latency: null, jitter: null, loss: null,
			download: null, upload: null,
			sizeLabel: preset.label
		};

		function progressText(verb, received, total) {
			var receivedMB = (received / 1024 / 1024).toFixed(1);
			var totalMB    = (total    / 1024 / 1024).toFixed(0);
			var pct        = total > 0 ? Math.round((received / total) * 100) : 0;
			return verb + ' ' + receivedMB + ' / ' + totalMB + ' MB (' + pct + '%)';
		}

		this.setProgress(_('Testing latency (%d samples)…').replace('%d', PING_COUNT));

		this.testLatency()
			.then(function (l) {
				if (self._cancelled) throw { cancelled: true };
				if (l.median !== null) {
					self.setStat('latency', l.median.toFixed(1));
					self.setStat('jitter',  l.jitter.toFixed(1));
					result.latency = l.median;
					result.jitter  = l.jitter;
				}
				self.setStat('loss', l.loss.toFixed(0));
				result.loss = l.loss;

				var verbDL = _('Downloading…');
				self.setProgress(verbDL + ' 0 / ' + (downloadBytes / 1024 / 1024).toFixed(0) + ' MB (0%)');
				return self.testDownload(downloadBytes, function (received, total) {
					self.setProgress(progressText(verbDL, received, total));
				});
			})
			.then(function (mbps) {
				if (self._cancelled) throw { cancelled: true };
				self.setGauge('download', mbps);
				if (mbps !== null) result.download = mbps;
				if (self._lastTestPeak && isFinite(self._lastTestPeak.download)) {
					result.peakDownload = self._lastTestPeak.download;
				}
				self.setGaugeSummary('download', mbps,
					(self._lastTestPeak && self._lastTestPeak.download) || null);
				var verbUL = _('Uploading…');
				self.setProgress(verbUL + ' 0 / ' + (uploadBytes / 1024 / 1024).toFixed(0) + ' MB (0%)');
				return self.testUpload(uploadBytes, function (received, total) {
					self.setProgress(progressText(verbUL, received, total));
				});
			})
			.then(function (mbps) {
				if (self._cancelled) throw { cancelled: true };
				self.setGauge('upload', mbps);
				if (mbps !== null) result.upload = mbps;
				if (self._lastTestPeak && isFinite(self._lastTestPeak.upload)) {
					result.peakUpload = self._lastTestPeak.upload;
				}
				self.setGaugeSummary('upload', mbps,
					(self._lastTestPeak && self._lastTestPeak.upload) || null);

				if (result.latency !== null || result.download !== null || result.upload !== null) {
					pushHistory(result);
					self.renderSummary();
				}
				self.setProgress(_('Done'));
			})
			.catch(function (e) {
				if (e && e.cancelled) {
					self.setProgress(_('Cancelled'));
					return;
				}
				if (window.toast) toast.error(_('Speed test failed') + ': ' + (e && e.message ? e.message : 'unknown'));
				self.setProgress('');
			})
			.finally(function () {
				self._running = false;
				if (runBtn)    runBtn.disabled = false;
				if (cancelBtn) cancelBtn.disabled = true;
			});
	},

	// Abort whatever phase is in flight. The phase promises resolve/reject
	// promptly once their underlying fetch/xhr aborts; runTest's _cancelled
	// guard then short-circuits the remaining chain.
	cancelTest: function () {
		this._cancelled = true;
		try { if (this._activeAbort) this._activeAbort.abort(); } catch (e) {}
		try { if (this._activeXhr)   this._activeXhr.abort();   } catch (e) {}
		this.setProgress(_('Cancelling…'));
	},

	// ── Summary render (mini bar chart + last-run line) ───────────────────
	renderSummary: function () {
		var history = loadHistory();
		var last = history.length ? history[0] : null;

		var set = function (id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
		set('speedtest-last-down', last && last.download !== null ? last.download.toFixed(0) : '—');
		set('speedtest-last-up',   last && last.upload   !== null ? last.upload.toFixed(0)   : '—');
		set('speedtest-last-lat',  last && last.latency  !== null ? last.latency.toFixed(0)  : '—');

		var whenEl = document.getElementById('speedtest-last-when');
		if (whenEl) {
			whenEl.textContent = last
				? (last.label ? last.label + ' · ' : '') + fmtAgo(last.t)
				: _('No runs yet');
		}

		// Mini bar chart of the last 5 runs (download Mbps), newest on the
		// right. Bars scaled to the max in the window. Tooltips give detail.
		var mini = document.getElementById('speedtest-mini');
		if (mini) {
			mini.innerHTML = '';
			var recent = history.slice(0, 5).reverse();
			var maxDl = 1;
			recent.forEach(function (r) { if (r.download && r.download > maxDl) maxDl = r.download; });
			if (!recent.length) {
				mini.appendChild(E('span', { 'class': 'speedtest-mini-empty' }, _('Run a test to see history')));
			} else {
				recent.forEach(function (r) {
					var h = r.download ? Math.max(8, Math.round((r.download / maxDl) * 100)) : 4;
					var tip = (r.label ? r.label + ' — ' : '')
						+ '↓ ' + (r.download ? r.download.toFixed(0) : '—') + ' Mbps'
						+ ' · ↑ ' + (r.upload ? r.upload.toFixed(0) : '—') + ' Mbps'
						+ ' · ' + (r.latency ? r.latency.toFixed(0) : '—') + ' ms'
						+ ' · ' + fmtAgo(r.t);
					mini.appendChild(E('span', {
						'class': 'speedtest-mini-bar',
						'style': 'height:' + h + '%',
						'title': tip
					}, ''));
				});
			}
		}
	},

	testLatency: function () {
		var self     = this;
		var samples  = [];
		var failures = 0;
		function next() {
			if (self._cancelled) return { median: null, jitter: 0, loss: 100 };
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

	testDownload: function (bytes, onProgress) {
		bytes = bytes || DOWNLOAD_BYTES;
		var self = this;
		var t0 = performance.now();
		var ctrl = new AbortController();
		this._activeAbort = ctrl;
		var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

		return fetch('/cgi-bin/luci/admin/design-x/download?bytes=' + bytes + '&t=' + Date.now(), {
			signal: ctrl.signal, cache: 'no-store'
		}).then(function (r) {
			if (!r.ok) throw new Error('HTTP ' + r.status);

			var reader       = r.body.getReader();
			var received     = 0;
			var lastUiUpdate = 0;
			var samples      = [];
			var WINDOW_MS    = 500;
			var FPS_MS       = 100;
			var peakMbps     = 0;

			function pump() {
				return reader.read().then(function (chunk) {
					if (chunk.done) {
						clearTimeout(to);
						self._activeAbort = null;
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
						if (onProgress) onProgress(received, bytes);
					}
					return pump();
				});
			}
			return pump();
		}).catch(function () { clearTimeout(to); self._activeAbort = null; return null; });
	},

	testUpload: function (bytes, onProgress) {
		bytes = bytes || UPLOAD_BYTES;
		var self    = this;
		var payload = new Blob([new Uint8Array(bytes)]);
		var t0      = performance.now();

		return new Promise(function (resolve) {
			var xhr          = new XMLHttpRequest();
			self._activeXhr  = xhr;
			var lastUiUpdate = 0;
			var samples      = [];
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
					if (onProgress) onProgress(ev.loaded, bytes);
				}
			};

			xhr.onload = function () {
				done = true;
				self._activeXhr = null;
				if (xhr.status < 200 || xhr.status >= 300) { resolve(null); return; }
				var totalMs = performance.now() - t0;
				var avgMbps = (bytes * 8) / (totalMs / 1000) / 1e6;
				self._lastTestPeak = self._lastTestPeak || {};
				self._lastTestPeak.upload = peakMbps;
				resolve(avgMbps);
			};
			xhr.onerror   = function () { done = true; self._activeXhr = null; resolve(null); };
			xhr.ontimeout = function () { done = true; self._activeXhr = null; resolve(null); };
			xhr.onabort   = function () { done = true; self._activeXhr = null; resolve(null); };

			xhr.send(payload);
		});
	},

	setStat: function (which, value) {
		var el = document.getElementById('st-' + which);
		if (el) el.textContent = value;
	}
});
