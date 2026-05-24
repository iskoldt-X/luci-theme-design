'use strict';
'require baseclass';
'require ui';
'require wan-stats';

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline / Live Metrics — upgrade.md §1.S3
//
// Injects 3 tiles into the Status > Overview page: CPU loadavg, Memory used,
// and (if thermal sensors available) Temperature. Each tile shows current
// value + 60-point sparkline of the last ~5 minutes (5s sampling).
//
// Data sources (all 100% local, no third-party):
//   CPU / Memory : ubus call system info  (LuCI built-in)
//   Temperature  : /cgi-bin/design/temp   (theme-provided, see T7)
//
// MVP: 3 tiles. Real-time WAN throughput deferred to a follow-up — would
// need ubus call network.interface dump → find WAN device → poll device
// status (4 hops vs 1 for the simple metrics).
// ─────────────────────────────────────────────────────────────────────────────

var SAMPLE_INTERVAL_MS = 5000;
var RING_SIZE         = 60;          // 5 min at 5s = 60 samples
var SPARK_W           = 220;
var SPARK_H           = 40;

// Step 80 (Round 13 verify-pass): SVG namespace helpers. LuCI's generic
// E('svg', ...) creates HTMLUnknownElement (HTML namespace), which the
// browser doesn't render as SVG even when path attributes are pinned
// correctly. Same root cause as Step 77's menu icon fix.
//
// Browser-side Claude verified Step 79's <path stroke="#a1a1aa" ...>
// attributes landed perfectly but the sparkline area was still visually
// blank — because the parent <svg> wasn't an actual SVGElement. This
// helper ensures every element ends up in the SVG namespace.
var SVG_NS   = 'http://www.w3.org/2000/svg';
var XLINK_NS = 'http://www.w3.org/1999/xlink';

function svgEl(tag, attrs, children) {
	var el = document.createElementNS(SVG_NS, tag);
	if (attrs) {
		Object.keys(attrs).forEach(function (k) {
			if (k === 'xlink:href') {
				el.setAttributeNS(XLINK_NS, 'xlink:href', attrs[k]);
			} else {
				el.setAttribute(k, attrs[k]);
			}
		});
	}
	if (children) {
		var arr = Array.isArray(children) ? children : [children];
		arr.forEach(function (c) { if (c) el.appendChild(c); });
	}
	return el;
}

// ── Ring buffer for sparkline data ────────────────────────────────────────────
function MetricRing(max) { this.max = max; this.data = []; }
MetricRing.prototype.push = function (v) {
	if (v === null || v === undefined || !isFinite(v)) return;
	this.data.push(v);
	if (this.data.length > this.max) this.data.shift();
};
MetricRing.prototype.last = function () {
	return this.data.length ? this.data[this.data.length - 1] : null;
};
MetricRing.prototype.delta = function () {
	if (this.data.length < 2) return 0;
	return this.data[this.data.length - 1] - this.data[this.data.length - 2];
};
// Step 89 (Round 15): mean over the entire ring window (~5 min at 5 s
// sampling). Used in tile meta lines like "Past 5 min · Avg 14.2%".
MetricRing.prototype.avg = function () {
	if (this.data.length === 0) return 0;
	var sum = 0;
	for (var i = 0; i < this.data.length; i++) sum += this.data[i];
	return sum / this.data.length;
};
MetricRing.prototype.path = function (w, h, sharedHi) {
	if (this.data.length < 2) return '';
	var lo = Infinity, hi = -Infinity;
	for (var i = 0; i < this.data.length; i++) {
		if (this.data[i] < lo) lo = this.data[i];
		if (this.data[i] > hi) hi = this.data[i];
	}
	// Step 139 (Round 37):optional shared Y-axis. When two rings share a
	// vertical scale (e.g. WAN rx + tx on the same sparkline canvas),
	// passing sharedHi forces the upper bound to match across both lines
	// so the secondary line's relative magnitude reads correctly.
	if (sharedHi != null && sharedHi > hi) hi = sharedHi;
	// Flat-data fix (e.g. CPU load 0.00 for several samples): without this
	// guard the line plots at y=h (bottom of viewBox) and gets clipped /
	// invisible. Center the line in the middle 60% of the box when range is
	// negligible, so users always see SOME visible line indicating "data
	// is being collected, currently flat".
	var range = hi - lo;
	var flat = range < 0.0001;
	if (flat) range = 1;
	var stepX = w / (this.max - 1);
	var d = '';
	for (var j = 0; j < this.data.length; j++) {
		var x = j * stepX;
		var y = flat
			? h * 0.5    // centered for flat data
			: h - ((this.data[j] - lo) / range) * h * 0.85 - h * 0.075;  // 7.5% top/bottom padding
		d += (j === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
	}
	return d.trim();
};

// ── Tile creation ─────────────────────────────────────────────────────────────
//
// Step 76 / 79 / 80 evolution:
//  - Step 76: pre-bake the empty baseline so the spark area never starts blank
//  - Step 79: pin every visual attribute on <path> inline (don't rely on CSS)
//  - Step 80 (THIS): switch every SVG element to createElementNS via svgEl()
//    because LuCI's E('svg', ...) creates HTMLUnknownElement (HTML namespace)
//    — the browser doesn't paint that as SVG, so even perfectly-attributed
//    <path> children render to nothing. Same fix the menu icons needed in
//    Step 77; we missed it here.
function makeTile(id, iconName, label, iconBase, hasProgress, dualValue) {
	var baseY = (SPARK_H / 2).toFixed(1);
	var initPath = 'M 0,' + baseY + ' L ' + SPARK_W + ',' + baseY;

	// Icon SVG — proper SVG namespace, xlink+href both set
	var iconSvg = svgEl('svg', {
		'class':         'svg-icon design-tile-icon',
		'aria-hidden':   'true',
		'width':         '16',
		'height':        '16',
		'viewBox':       '0 0 24 24',
		'fill':          'none',
		'stroke':        'currentColor',
		'stroke-width': '1.5'
	}, svgEl('use', {
		'href':       iconBase + '#' + iconName,
		'xlink:href': iconBase + '#' + iconName
	}));

	// Sparkline SVG + its two paths — all real SVGElements now
	var fillPath = svgEl('path', {
		'class': 'design-tile-spark-fill',
		'd':     '',
		'fill':  'rgba(16, 185, 129, 0.18)',
		'stroke':'none'
	});
	var linePath = svgEl('path', {
		'class':            'design-tile-spark-line design-tile-spark-line-empty',
		'd':                initPath,
		'fill':             'none',
		'stroke':           '#a1a1aa',
		'stroke-width':     '1.5',
		'stroke-dasharray': '4 4',
		'stroke-linecap':   'round',
		'stroke-linejoin':  'round',
		'opacity':          '0.85'
	});
	// Step 139 (Round 37):secondary line for dual-value tiles (WAN tx).
	// Dashed + half-opacity so it reads as "secondary trend over same
	// time window" against the solid primary line. Same accent color
	// because rx + tx are the same kind of metric.
	var sparkChildren = [fillPath, linePath];
	if (dualValue) {
		var secondaryLinePath = svgEl('path', {
			'class':            'design-tile-spark-line-secondary',
			'd':                '',
			'fill':             'none',
			'stroke':           '#10b981',
			'stroke-width':     '1.5',
			'stroke-dasharray': '3 2',
			'opacity':          '0.55',
			'stroke-linecap':   'round',
			'stroke-linejoin':  'round'
		});
		sparkChildren.push(secondaryLinePath);
	}

	var sparkSvg = svgEl('svg', {
		'class':              'design-tile-spark',
		'viewBox':            '0 0 ' + SPARK_W + ' ' + SPARK_H,
		'preserveAspectRatio':'none',
		'aria-hidden':        'true',
		'width':              '100%',
		'height':             '40',
		'fill':               'none',
		'stroke':             'currentColor'
	}, sparkChildren);

	// Step 89 (Round 15):value row is 4 split inline spans — prefix
	// (optional '↓'/'↑' for WAN), num (big), unit (e.g. '%'), trend (colored
	// pill). setTile() below fills them. Empty trend hidden by CSS
	// (:empty rule).
	//
	// Step 139 (Round 37):dual-value tiles get a different value-row
	// structure with TWO num groups (primary 30px + secondary 20px),
	// no trend pill. Used by WAN Traffic to show ↓ download + ↑ upload
	// as first-class metrics rather than relegating upload to the meta
	// line. Each group has its own prefix/num/unit triplet so setTile()
	// can fill them independently.
	var valueRow;
	if (dualValue) {
		valueRow = E('div', { 'class': 'design-tile-value design-tile-value-dual' }, [
			E('span', { 'class': 'design-tile-num-group' }, [
				E('span', { 'class': 'design-tile-prefix' }, ''),
				E('span', { 'class': 'design-tile-num' },    '—'),
				E('span', { 'class': 'design-tile-unit' },   '')
			]),
			E('span', { 'class': 'design-tile-num-group design-tile-num-group-secondary' }, [
				E('span', { 'class': 'design-tile-prefix-secondary' }, ''),
				E('span', { 'class': 'design-tile-num-secondary' },    '—'),
				E('span', { 'class': 'design-tile-unit-secondary' },   '')
			])
		]);
	} else {
		valueRow = E('div', { 'class': 'design-tile-value' }, [
			E('span', { 'class': 'design-tile-prefix' }, ''),
			E('span', { 'class': 'design-tile-num' },    '—'),
			E('span', { 'class': 'design-tile-unit' },   ''),
			E('span', { 'class': 'design-tile-trend' },  '')
		]);
	}

	// Step 89 (Round 15): reorder to match preview — head, value, spark,
	// [progress for tiles that opt in], meta. Sparkline now sits ABOVE meta
	// (visually closer to the value it's plotting) rather than at the bottom.
	var children = [
		E('div', { 'class': 'design-tile-head' }, [
			iconSvg,
			E('span', { 'class': 'design-tile-label' }, label)
		]),
		valueRow,
		sparkSvg
	];

	if (hasProgress) {
		// Inner div is the fill — width:0% at bake-time, setTile() animates it.
		children.push(E('div', { 'class': 'design-tile-progress' },
			E('div', { 'style': 'width:0%' })));
	}

	children.push(E('div', { 'class': 'design-tile-meta' }, ''));

	// Tile container stays HTML — only the SVG bits need namespace fix
	return E('div', { 'class': 'design-tile', 'id': id }, children);
}

function renderTileSpark(tileEl, ring, ringSecondary) {
	var lineEl = tileEl.querySelector('.design-tile-spark-line');
	var fillEl = tileEl.querySelector('.design-tile-spark-fill');
	var lineSecondaryEl = tileEl.querySelector('.design-tile-spark-line-secondary');

	// Step 139 (Round 37):compute shared Y-axis upper bound if a secondary
	// ring is present. Without this, each ring's path() auto-scales to its
	// own data range — rx peaks visible but tx (typically 10× smaller in
	// download-heavy households) would be drawn at the same visual height,
	// destroying the "upload is 1/10 of download" signal users care about.
	var sharedHi = null;
	if (ringSecondary) {
		var rxHi = 0, txHi = 0;
		for (var i = 0; i < ring.data.length; i++) if (ring.data[i] > rxHi) rxHi = ring.data[i];
		for (var k = 0; k < ringSecondary.data.length; k++) if (ringSecondary.data[k] > txHi) txHi = ringSecondary.data[k];
		sharedHi = Math.max(rxHi, txHi);
	}

	var linePath = ring.path(SPARK_W, SPARK_H, sharedHi);

	// Step 57: when fewer than 2 samples have arrived (1st poll cycle),
	// ring.path() returns ''. Instead of leaving the SVG empty (looks
	// broken), draw a faded dashed baseline so the user sees "data area
	// is here, just collecting".
	if (!linePath) {
		var baseY = (SPARK_H / 2).toFixed(1);
		lineEl.setAttribute('d', 'M 0,' + baseY + ' L ' + SPARK_W + ',' + baseY);
		lineEl.classList.add('design-tile-spark-line-empty');
		// Step 79: also force the empty-state attributes inline (same
		// values as the initial makeTile() bake-in) so we never get a
		// curve+empty mix when transitioning back.
		lineEl.setAttribute('stroke', '#a1a1aa');
		lineEl.setAttribute('stroke-width', '1.5');
		lineEl.setAttribute('stroke-dasharray', '4 4');
		lineEl.setAttribute('opacity', '0.85');
		fillEl.setAttribute('d', '');
		// Step 139 (Round 37):clear secondary line in empty state too
		if (lineSecondaryEl) lineSecondaryEl.setAttribute('d', '');
		return;
	}

	lineEl.classList.remove('design-tile-spark-line-empty');
	lineEl.setAttribute('d', linePath);
	// Step 79: flip line attributes to the "real curve" presentation.
	// Pinned inline (not just class swap) so CSS-not-applied scenarios
	// still render the curve visibly. accent-500 is #10b981.
	lineEl.setAttribute('stroke', '#10b981');
	lineEl.setAttribute('stroke-width', '2');
	lineEl.removeAttribute('stroke-dasharray');
	lineEl.removeAttribute('opacity');
	fillEl.setAttribute('d', linePath + ' L' + SPARK_W + ',' + SPARK_H + ' L0,' + SPARK_H + ' Z');

	// Step 139 (Round 37):draw secondary line (e.g. tx for WAN tile) on
	// the shared Y-axis so its magnitude reads correctly relative to the
	// primary line. path() returns '' if ring has <2 samples — in that
	// case clear the line attribute so a stale path from a prior render
	// doesn't linger.
	if (lineSecondaryEl) {
		var secPath = ringSecondary ? ringSecondary.path(SPARK_W, SPARK_H, sharedHi) : '';
		lineSecondaryEl.setAttribute('d', secPath || '');
	}
}

// Step 89 (Round 15): richer setter — fills the split spans (prefix /
// num / unit / trend pill) and optionally drives the memory tile's
// progress bar fill width. opts shape:
//   { num, unit, prefix, trend: { dir, text } | null, meta, progress }
// `meta` may be a plain string, a single DOM node, or an array of nodes
// (used by the temp tile to render a coloured status-dot before the
// status text).
function setTile(tileEl, opts) {
	var numEl    = tileEl.querySelector('.design-tile-num');
	var unitEl   = tileEl.querySelector('.design-tile-unit');
	var prefixEl = tileEl.querySelector('.design-tile-prefix');
	var trendEl  = tileEl.querySelector('.design-tile-trend');
	var metaEl   = tileEl.querySelector('.design-tile-meta');
	var progEl   = tileEl.querySelector('.design-tile-progress > div');

	if (numEl)    numEl.textContent    = (opts.num == null) ? '—' : String(opts.num);
	if (unitEl)   unitEl.textContent   = opts.unit   || '';
	if (prefixEl) prefixEl.textContent = opts.prefix || '';

	// Step 139 (Round 37):dual-value secondary group (WAN tx). Optional;
	// only set if .design-tile-num-secondary exists in this tile's DOM
	// AND opts.secondary was provided. Mirror the primary num/unit/prefix
	// fallback semantics.
	if (opts.secondary) {
		var sNumEl    = tileEl.querySelector('.design-tile-num-secondary');
		var sUnitEl   = tileEl.querySelector('.design-tile-unit-secondary');
		var sPrefixEl = tileEl.querySelector('.design-tile-prefix-secondary');
		if (sNumEl)    sNumEl.textContent    = (opts.secondary.num == null) ? '—' : String(opts.secondary.num);
		if (sUnitEl)   sUnitEl.textContent   = opts.secondary.unit   || '';
		if (sPrefixEl) sPrefixEl.textContent = opts.secondary.prefix || '';
	}

	if (trendEl) {
		if (opts.trend && opts.trend.dir !== 'flat') {
			// Step 138 (Round 36): use ▲/▼ filled triangles + explicit sign
			// instead of ↑/↓. The arrow shapes ↑/↓ conflict with the WAN
			// tile's direction prefixes (↓ for download / ↑ for upload),
			// where the same glyph means "direction of data flow" not
			// "trend up/down vs previous sample". Filled triangles + signed
			// number disambiguate at-a-glance: "▲ +50 Kbps" reads as
			// "trend rising by 50", "↓ 837 Kbps" reads as "download rate".
			trendEl.textContent = (opts.trend.dir === 'up' ? '▲ +' : '▼ -') + opts.trend.text;
			trendEl.className   = 'design-tile-trend design-tile-trend-' + opts.trend.dir;
		} else {
			// Empty content + base class — CSS `:empty { display: none }` hides
			// the chip so the value row collapses cleanly.
			trendEl.textContent = '';
			trendEl.className   = 'design-tile-trend';
		}
	}

	if (metaEl) {
		if (opts.meta == null) {
			metaEl.textContent = '';
		} else if (typeof opts.meta === 'string') {
			metaEl.textContent = opts.meta;
		} else if (Array.isArray(opts.meta)) {
			// replaceChildren accepts (...Node|string), spread the array.
			metaEl.replaceChildren.apply(metaEl, opts.meta);
		} else if (opts.meta.nodeType) {
			metaEl.replaceChildren(opts.meta);
		}
	}

	if (progEl && typeof opts.progress === 'number' && isFinite(opts.progress)) {
		progEl.style.width = Math.max(0, Math.min(100, opts.progress)) + '%';
	}
}

// ── Data helpers ──────────────────────────────────────────────────────────────
var sysInfo = L.rpc.declare({ object: 'system', method: 'info' });

function fetchTempZones() {
	return fetch('/cgi-bin/design/temp', { cache: 'no-store' })
		.then(function (r) { return r.ok ? r.json() : null; })
		.then(function (data) {
			if (!data || !Array.isArray(data.zones) || !data.zones.length) return null;
			return data.zones;
		})
		.catch(function () { return null; });
}

// Step 90 (Round 15): raw cumulative CPU counters from /proc/stat (via
// theme CGI). Browser-side computes delta-over-delta to get percentage
// utilisation between two polls. Returns null on transport error so the
// caller can skip this tick gracefully.
function fetchCpuStat() {
	return fetch('/cgi-bin/design/cpustat', { cache: 'no-store' })
		.then(function (r) { return r.ok ? r.json() : null; })
		.then(function (data) {
			if (!data || typeof data.total !== 'number' || typeof data.busy !== 'number') return null;
			if (data.total <= 0) return null;
			return data;
		})
		.catch(function () { return null; });
}

function formatBytes(bytes) {
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
	if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
	return (bytes / 1073741824).toFixed(2) + ' GB';
}

// Step 43: formatter for throughput rate (bps), broken into number+unit so
// the tile can present them in two different font sizes / weights.
function fmtBpsSplit(bps) {
	if (bps === null || bps === undefined || !isFinite(bps)) return { num: '—', unit: '' };
	if (bps < 1000)    return { num: bps.toFixed(0),       unit: 'bps' };
	if (bps < 1e6)     return { num: (bps / 1000).toFixed(1),  unit: 'Kbps' };
	if (bps < 1e9)     return { num: (bps / 1e6).toFixed(1),   unit: 'Mbps' };
	return { num: (bps / 1e9).toFixed(2), unit: 'Gbps' };
}

// Step 89 (Round 15): compute a trend descriptor for the colored pill in
// tile values. Logic: last-sample vs current-sample (per user choice — the
// existing ring.delta() semantics). Returns null if either value isn't a
// finite number (e.g. ring still has 0-1 samples). Returns { dir: 'flat' }
// when |delta| < threshold so the pill stays hidden during noise.
//   opts.threshold : number — below |delta| this is treated as flat
//   opts.format    : function(abs)→string — defaults to abs.toFixed(1)
//   opts.suffix    : string — appended after the formatted number (e.g. '%')
function deltaToTrend(curr, prev, opts) {
	opts = opts || {};
	if (curr == null || prev == null || !isFinite(curr) || !isFinite(prev)) return null;
	var d = curr - prev;
	var threshold = opts.threshold || 0;
	if (Math.abs(d) < threshold) return { dir: 'flat', text: '' };
	var abs = Math.abs(d);
	var fmt = opts.format ? opts.format(abs) : abs.toFixed(1);
	return { dir: d > 0 ? 'up' : 'down', text: fmt + (opts.suffix || '') };
}

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function () {
		if (!document.body.classList.contains('node-admin-status-overview')) return;

		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design-x') + '/icons.svg';
		this.rings = {
			cpu:   new MetricRing(RING_SIZE),
			mem:   new MetricRing(RING_SIZE),
			temp:  new MetricRing(RING_SIZE),
			// Step 139 (Round 37):split single 'net' ring into rx + tx so
			// the dual-value WAN tile can show both download and upload as
			// first-class metrics + sparkline can plot both lines.
			netRx: new MetricRing(RING_SIZE),
			netTx: new MetricRing(RING_SIZE)
		};

		this.tryInject();
	},

	tryInject: function () {
		var view = document.getElementById('view');
		// LuCI's view is rendered async via ui.instantiateView. If it's not
		// ready yet, retry in 250ms (up to 20 times = 5s budget).
		if (!view || !view.firstChild || view.querySelector('.spinning')) {
			if ((this._retries = (this._retries || 0) + 1) > 20) return;
			setTimeout(L.bind(this.tryInject, this), 250);
			return;
		}

		this.injectTiles();
		this.startPolling();
	},

	injectTiles: function () {
		var view = document.getElementById('view');
		// Step 89 + 90 (Round 15): CPU and memory both opt into the progress
		// bar — both are natural 0-100% utilisation metrics. Net is throughput
		// (no upper bound) and temp doesn't have a meaningful 0-100 range, so
		// those keep just the sparkline. Step 90 also renamed CPU 'Load' →
		// 'Usage' to match the new data source (CPU% from /proc/stat, no
		// longer loadavg from ubus).
		var grid = E('div', { 'class': 'design-tile-grid' }, [
			makeTile('design-tile-cpu',  'i-cpu',         _('CPU Usage'),   this.iconBase, /*hasProgress*/ true),
			makeTile('design-tile-mem',  'i-memory',      _('Memory'),      this.iconBase, /*hasProgress*/ true),
			makeTile('design-tile-net',  'i-activity',    _('WAN Traffic'), this.iconBase, /*hasProgress*/ false, /*dualValue*/ true),
			makeTile('design-tile-temp', 'i-thermometer', _('Temperature'), this.iconBase)
		]);
		view.insertBefore(grid, view.firstChild);

		this.tileCpu  = document.getElementById('design-tile-cpu');
		this.tileMem  = document.getElementById('design-tile-mem');
		this.tileNet  = document.getElementById('design-tile-net');
		this.tileTemp = document.getElementById('design-tile-temp');
	},

	startPolling: function () {
		var self = this;
		// Probe temp once to decide whether to show the temp tile
		fetchTempZones().then(function (zones) {
			if (!zones) self.tileTemp.style.display = 'none';
		});

		// Step 43: subscribe to the wan-stats singleton (Step 42). It polls
		// every 2 s on its own cadence — independent of our 5 s sysInfo poll —
		// so the Net tile updates twice as fast as CPU/Mem and feels "live".
		L.require('wan-stats').then(function (ws) {
			ws.subscribe(L.bind(self.onWanStats, self));
		}).catch(function () {
			// If wan-stats can't load, hide the Net tile — better than a dead "—"
			if (self.tileNet) self.tileNet.style.display = 'none';
		});

		this.tick();
		this._timer = setInterval(L.bind(this.tick, this), SAMPLE_INTERVAL_MS);
	},

	// Step 43 + 89 + 139:callback for wan-stats.subscribe.
	//
	// Step 139 (Round 37) redesign:WAN tile is now a dual-value tile.
	// Download (rx) shows in the primary 30px num slot, Upload (tx) in
	// the secondary 20px slot. No trend pill — its red/green semantics
	// were inverted for throughput (high = healthy, not concerning) and
	// its ↑↓ arrows conflicted with the rx/tx direction arrows in the
	// value row. Sparkline now draws BOTH rx (solid) + tx (dashed) on
	// a shared Y-axis. Meta line shows device + 5-min rx peak (gives
	// the sparkline a numeric anchor for "how big is that hill?").
	onWanStats: function (data) {
		if (!this.tileNet) return;
		// If the WAN device is missing or fully offline, hide the tile instead
		// of showing dashes forever — keeps the dashboard honest.
		if (data.deviceName === null) {
			this.tileNet.style.display = 'none';
			return;
		}
		this.tileNet.style.display = '';

		if (data.rxBitsPerSec !== null) this.rings.netRx.push(data.rxBitsPerSec);
		if (data.txBitsPerSec !== null) this.rings.netTx.push(data.txBitsPerSec);

		var d = fmtBpsSplit(data.rxBitsPerSec);
		var u = fmtBpsSplit(data.txBitsPerSec);

		// 5-min rx peak (sparkline numeric anchor). Inline scan since
		// MetricRing doesn't expose a max() accessor yet.
		var rxPeak = 0;
		for (var i = 0; i < this.rings.netRx.data.length; i++) {
			if (this.rings.netRx.data[i] > rxPeak) rxPeak = this.rings.netRx.data[i];
		}
		var peakStr = '';
		if (rxPeak > 0) {
			var pf = fmtBpsSplit(rxPeak);
			peakStr = ' · Peak ' + pf.num + ' ' + pf.unit;
		}

		setTile(this.tileNet, {
			prefix:    (d.num === '—') ? '' : '↓',
			num:       d.num,
			unit:      d.unit,
			secondary: {
				prefix: (u.num === '—') ? '' : '↑',
				num:    u.num,
				unit:   u.unit
			},
			meta: (data.deviceName || '') + peakStr
		});
		renderTileSpark(this.tileNet, this.rings.netRx, this.rings.netTx);
	},

	tick: function () {
		var self = this;

		// ── Memory via ubus (CPU has moved to /cgi-bin/design/cpustat — see
		//    next block). sysInfo().load[] is still emitted but we no longer
		//    consume it: CPU% from raw /proc/stat counters is the right
		//    primitive for a 0-100% display.
		sysInfo().then(function (info) {
			if (!info || !info.memory || !info.memory.total) return;
			var used    = info.memory.total - (info.memory.available || info.memory.free || 0);
			var pct     = (used / info.memory.total) * 100;
			var prevMem = self.rings.mem.last();
			self.rings.mem.push(pct);
			setTile(self.tileMem, {
				num:      pct.toFixed(0),
				unit:     '%',
				trend:    deltaToTrend(pct, prevMem, { threshold: 1.0, suffix: '%', format: function (v) { return v.toFixed(0); } }),
				progress: pct,
				meta:     formatBytes(used) + ' / ' + formatBytes(info.memory.total)
			});
			renderTileSpark(self.tileMem, self.rings.mem);
		}).catch(function () { /* keep stale display */ });

		// ── CPU% (Step 90, Round 15): replaces the old loadavg-based display.
		//    Read raw cumulative counters from /proc/stat via theme CGI, diff
		//    against the previous sample to derive busyDiff / totalDiff =
		//    percentage utilisation over that ~5 s window. First poll just
		//    anchors the counters; second poll onwards renders a real %.
		fetchCpuStat().then(function (stat) {
			if (!stat) return;
			var prev = self._lastCpuStat;
			self._lastCpuStat = stat;
			if (!prev) return;  // first sample — anchor only, no display yet

			var totalDiff = stat.total - prev.total;
			var busyDiff  = stat.busy  - prev.busy;
			// Counter wrap / process reset / impossibly-short window — skip
			// this sample, anchor stays put for the next diff.
			if (totalDiff <= 0 || busyDiff < 0) return;

			var pct     = Math.max(0, Math.min(100, (busyDiff / totalDiff) * 100));
			var prevPct = self.rings.cpu.last();
			self.rings.cpu.push(pct);
			setTile(self.tileCpu, {
				num:      pct.toFixed(0),
				unit:     '%',
				trend:    deltaToTrend(pct, prevPct, { threshold: 1.0, suffix: '%', format: function (v) { return v.toFixed(0); } }),
				progress: pct,
				meta:     _('Past 5 min · Avg %s%%').format(self.rings.cpu.avg().toFixed(1))
			});
			renderTileSpark(self.tileCpu, self.rings.cpu);
		}).catch(function () { /* keep stale display */ });

		// ── Temperature
		if (self.tileTemp.style.display !== 'none') {
			fetchTempZones().then(function (zones) {
				if (!zones || !zones.length) return;
				var t        = Math.max.apply(null, zones);
				var prevTemp = self.rings.temp.last();
				self.rings.temp.push(t);

				// Threshold + label + dot color all keyed off the same bands.
				var dotCls, statusText;
				if (t >= 80)      { dotCls = 'design-tile-status-dot-hot';  statusText = _('Hot'); }
				else if (t >= 65) { dotCls = 'design-tile-status-dot-warm'; statusText = _('Warm'); }
				else              { dotCls = 'design-tile-status-dot-ok';   statusText = _('Normal'); }

				setTile(self.tileTemp, {
					num:   t,
					unit:  '°C',
					trend: deltaToTrend(t, prevTemp, { threshold: 0.5, suffix: '°C', format: function (v) { return v.toFixed(1); } }),
					meta:  [
						E('span', { 'class': 'design-tile-status-dot ' + dotCls }, '●'),
						' ' + statusText
					]
				});
				renderTileSpark(self.tileTemp, self.rings.temp);
			});
		}
	}
});
