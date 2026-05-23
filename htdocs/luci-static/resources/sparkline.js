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
MetricRing.prototype.path = function (w, h) {
	if (this.data.length < 2) return '';
	var lo = Infinity, hi = -Infinity;
	for (var i = 0; i < this.data.length; i++) {
		if (this.data[i] < lo) lo = this.data[i];
		if (this.data[i] > hi) hi = this.data[i];
	}
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
// Step 76 (Round 13): pre-bake the empty-state baseline path so the
// sparkline area shows SOMETHING even before the first tick() arrives.
// Step 79 (Round 13 follow-up): Chrome-Claude reported that even with
// Step 76 in place, the WAN Traffic tile rendered completely blank.
// Inspection showed the path elements had NO stroke / stroke-dasharray
// attributes — the CSS class .design-tile-spark-line / -line-empty
// wasn't actually applying its styling for some reason (CSS specificity
// war, or LuCI base svg rules, or the agent's snapshot caught a moment
// before CSS settled). Force the attributes inline on the path element
// so they don't depend on stylesheet application timing at all.
function makeTile(id, iconName, label, iconBase) {
	var baseY = (SPARK_H / 2).toFixed(1);
	var initPath = 'M 0,' + baseY + ' L ' + SPARK_W + ',' + baseY;
	return E('div', { 'class': 'design-tile', 'id': id }, [
		E('div', { 'class': 'design-tile-head' }, [
			E('svg', { 'class': 'svg-icon design-tile-icon', 'aria-hidden': 'true' },
				E('use', { 'href': iconBase + '#' + iconName })),
			E('span', { 'class': 'design-tile-label' }, label)
		]),
		E('div', { 'class': 'design-tile-value' }, '—'),
		E('div', { 'class': 'design-tile-meta' }, ''),
		E('svg', {
			'class':   'design-tile-spark',
			'viewBox': '0 0 ' + SPARK_W + ' ' + SPARK_H,
			'preserveAspectRatio': 'none',
			'aria-hidden': 'true',
			// Step 79: pin presentation attrs on the SVG element itself
			// so even if CSS gets dropped on the floor we still get a
			// visible chart. fill=none + stroke=currentColor inherit
			// downward to the paths.
			'fill': 'none',
			'stroke': 'currentColor'
		}, [
			// Fill area below the curve. fill is applied inline so it
			// renders even before CSS lands.
			E('path', {
				'class': 'design-tile-spark-fill',
				'd':     '',
				'fill':  'rgba(16, 185, 129, 0.18)',
				'stroke':'none'
			}),
			// Line itself. Initial state is the empty baseline (a flat
			// dashed line in the middle); renderTileSpark() flips it to
			// the real curve once the ring has 2+ samples.
			E('path', {
				'class':            'design-tile-spark-line design-tile-spark-line-empty',
				'd':                initPath,
				'fill':             'none',
				'stroke':           '#a1a1aa',
				'stroke-width':     '1.5',
				'stroke-dasharray': '4 4',
				'stroke-linecap':   'round',
				'stroke-linejoin':  'round',
				'opacity':          '0.85'
			})
		])
	]);
}

function renderTileSpark(tileEl, ring) {
	var lineEl = tileEl.querySelector('.design-tile-spark-line');
	var fillEl = tileEl.querySelector('.design-tile-spark-fill');
	var linePath = ring.path(SPARK_W, SPARK_H);

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
}

function setTile(tileEl, value, meta) {
	tileEl.querySelector('.design-tile-value').textContent = value;
	tileEl.querySelector('.design-tile-meta').textContent  = meta || '';
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

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function () {
		if (!document.body.classList.contains('node-admin-status-overview')) return;

		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design') + '/icons.svg';
		this.rings = {
			cpu:  new MetricRing(RING_SIZE),
			mem:  new MetricRing(RING_SIZE),
			temp: new MetricRing(RING_SIZE),
			net:  new MetricRing(RING_SIZE)    // Step 43: 4th tile, fed by wan-stats
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
		var grid = E('div', { 'class': 'design-tile-grid' }, [
			makeTile('design-tile-cpu',  'i-cpu',         _('CPU Load'),    this.iconBase),
			makeTile('design-tile-mem',  'i-memory',      _('Memory'),      this.iconBase),
			makeTile('design-tile-net',  'i-activity',    _('WAN Traffic'), this.iconBase),
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

	// Step 43: callback for wan-stats.subscribe. Updates the Net tile's value
	// (download Mbps), meta (upload + device name), and rx-rate sparkline.
	onWanStats: function (data) {
		if (!this.tileNet) return;
		// If the WAN device is missing or fully offline, hide the tile instead
		// of showing dashes forever — keeps the dashboard honest.
		if (data.deviceName === null) {
			this.tileNet.style.display = 'none';
			return;
		}
		this.tileNet.style.display = '';

		if (data.rxBps !== null) this.rings.net.push(data.rxBps);

		var d = fmtBpsSplit(data.rxBps);
		var u = fmtBpsSplit(data.txBps);
		// Use ↓ prefix on value so it visually matches the throughput row in
		// the WAN Hero (Step 43 pairs these visually).
		var displayValue = (d.num === '—') ? '—' : ('↓ ' + d.num + ' ' + d.unit);
		var displayMeta  = (u.num === '—')
			? (data.deviceName || '')
			: ('↑ ' + u.num + ' ' + u.unit + (data.deviceName ? ' · ' + data.deviceName : ''));

		setTile(this.tileNet, displayValue, displayMeta);
		renderTileSpark(this.tileNet, this.rings.net);
	},

	tick: function () {
		var self = this;

		// CPU + memory in one ubus call
		sysInfo().then(function (info) {
			if (!info) return;

			// loadavg[0] is 1-min average, ubus encodes as Q16 fixed point
			var load1 = (info.load && info.load[0]) ? info.load[0] / 65536 : 0;
			self.rings.cpu.push(load1);
			var delta = self.rings.cpu.delta();
			var deltaStr = (delta === 0 || Math.abs(delta) < 0.005) ? '' :
				(delta > 0 ? ' ↗ ' : ' ↘ ') + Math.abs(delta).toFixed(2);
			setTile(self.tileCpu, load1.toFixed(2), _('1-min loadavg') + deltaStr);
			renderTileSpark(self.tileCpu, self.rings.cpu);

			// Memory used %
			if (info.memory && info.memory.total) {
				var used = info.memory.total - (info.memory.available || info.memory.free || 0);
				var pct  = (used / info.memory.total) * 100;
				self.rings.mem.push(pct);
				setTile(self.tileMem,
					pct.toFixed(0) + '%',
					formatBytes(used) + ' / ' + formatBytes(info.memory.total));
				renderTileSpark(self.tileMem, self.rings.mem);
			}
		}).catch(function () { /* keep stale display */ });

		// Temperature
		if (self.tileTemp.style.display !== 'none') {
			fetchTempZones().then(function (zones) {
				if (!zones || !zones.length) return;
				var t = Math.max.apply(null, zones);
				self.rings.temp.push(t);
				var status = (t >= 80) ? _('hot')
				           : (t >= 65) ? _('warm')
				           : _('normal');
				setTile(self.tileTemp, t + '°C', status);
				renderTileSpark(self.tileTemp, self.rings.temp);
			});
		}
	}
});
