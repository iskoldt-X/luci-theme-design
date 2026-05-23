'use strict';
'require baseclass';
'require ui';

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
function makeTile(id, iconName, label, iconBase) {
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
			'aria-hidden': 'true'
		}, [
			E('path', { 'class': 'design-tile-spark-fill', 'd': '' }),
			E('path', { 'class': 'design-tile-spark-line', 'd': '' })
		])
	]);
}

function renderTileSpark(tileEl, ring) {
	var linePath = ring.path(SPARK_W, SPARK_H);
	tileEl.querySelector('.design-tile-spark-line').setAttribute('d', linePath);
	var fillPath = linePath
		? linePath + ' L' + SPARK_W + ',' + SPARK_H + ' L0,' + SPARK_H + ' Z'
		: '';
	tileEl.querySelector('.design-tile-spark-fill').setAttribute('d', fillPath);
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

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function () {
		if (!document.body.classList.contains('node-admin-status-overview')) return;

		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design') + '/icons.svg';
		this.rings = {
			cpu:  new MetricRing(RING_SIZE),
			mem:  new MetricRing(RING_SIZE),
			temp: new MetricRing(RING_SIZE)
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
			makeTile('design-tile-temp', 'i-thermometer', _('Temperature'), this.iconBase)
		]);
		view.insertBefore(grid, view.firstChild);

		this.tileCpu  = document.getElementById('design-tile-cpu');
		this.tileMem  = document.getElementById('design-tile-mem');
		this.tileTemp = document.getElementById('design-tile-temp');
	},

	startPolling: function () {
		var self = this;
		// Probe temp once to decide whether to show the temp tile
		fetchTempZones().then(function (zones) {
			if (!zones) self.tileTemp.style.display = 'none';
		});

		this.tick();
		this._timer = setInterval(L.bind(this.tick, this), SAMPLE_INTERVAL_MS);
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
