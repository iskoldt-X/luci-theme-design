'use strict';
'require baseclass';
'require rpc';
'require network';

// ─────────────────────────────────────────────────────────────────────────────
// WAN throughput stats — shared singleton
//
// Polls network.device.status every 2 s, diffs rx/tx counters from the last
// sample, and pushes {rxBps, txBps, deviceName, online} to every subscriber.
//
// Consumed by:
//   - sparkline.js  → "Net" tile (4th tile, live throughput)
//   - wan-hero.js   → "↑ N Mbps · ↓ M Mbps" row at the bottom of the hero
//
// Design notes:
//   1. Singleton. The first subscribe() starts the polling timer; the last
//      unsubscribe() stops it. Two consumers share one RPC stream.
//   2. WAN device detection: network.getWANNetworks() → w.getDevice()
//      .getName(). On routers where WAN isn't up yet at page load (e.g.
//      PPPoE still negotiating), detection retries on the next poll —
//      we don't blow the whole module up.
//   3. Counter wrap: if delta < 0 we treat it as a wrap/reset and skip
//      that sample (no spurious huge spike).
//   4. First sample is needed to anchor the diff — first emit happens at
//      the 2nd poll (~2 s in). Until then subscribers see null rates.
//
// All RPC calls are wrapped in try/catch so a transient ubus hiccup never
// kills the singleton. Defensive enough for any LuCI 20.x → 26.x.
// ─────────────────────────────────────────────────────────────────────────────

var POLL_INTERVAL_MS = 2000;

// Step 50: declare both no-args (all devices) and per-device variants.
// LuCI 26.x's network.device.status response shape varies between builds —
// sometimes flat {ethN: {...}}, sometimes wrapped {'': {...}} from rpc's
// expect normalization. We try the all-devices call first, and if the
// target device isn't in the response we fall back to a per-device
// status call (rarely takes a different shape).
var deviceStatusAll = rpc.declare({
	object: 'network.device',
	method: 'status'
	// no `expect` — we want the raw response object so we can probe its
	// shape defensively in pickDeviceStats() below.
});

var deviceStatusOne = rpc.declare({
	object: 'network.device',
	method: 'status',
	params: ['name']
});

// Probe a deviceStatus response (either-shape) for a specific device entry
// that has rx_bytes/tx_bytes counters under .statistics. Returns the entry
// object or null. The four shapes we've seen across LuCI versions:
//   1. { 'eth1': { up, statistics } }                    — common 24.10
//   2. { '': { 'eth1': { ... } } }                       — expect-wrapped
//   3. { devices: { 'eth1': { ... } } }                  — older variant
//   4. { up, statistics }                                 — per-device call
function pickDeviceStats(response, deviceName) {
	if (!response || typeof response !== 'object') return null;
	// Shape 4: per-device direct
	if (response.statistics) return response;
	// Shape 1
	if (response[deviceName] && response[deviceName].statistics) return response[deviceName];
	// Shape 2
	if (response[''] && response[''][deviceName] && response[''][deviceName].statistics) return response[''][deviceName];
	// Shape 3
	if (response.devices && response.devices[deviceName] && response.devices[deviceName].statistics) return response.devices[deviceName];
	return null;
}

function warn(msg, obj) {
	if (console && console.warn) console.warn('wan-stats: ' + msg, obj === undefined ? '' : obj);
}

// Singleton state — module-private
var state = {
	subscribers: [],   // [{ cb }]
	timer:       null,
	wanDevice:   null, // resolved name, e.g. 'eth0' / 'pppoe-wan'
	lastSample:  null, // { t, rx, tx }
	lastEmit:    { rxBps: null, txBps: null, deviceName: null, online: null }
};

function detectWanDevice() {
	return network.getWANNetworks().then(function (wans) {
		if (!wans || !wans.length) return null;
		var w = wans[0];
		try {
			var d = w.getDevice();
			return d ? d.getName() : (w.getName ? w.getName() : null);
		} catch (e) {
			return w.getName ? w.getName() : null;
		}
	}).catch(function () { return null; });
}

function emit(data) {
	state.lastEmit = data;
	state.subscribers.forEach(function (sub) {
		try { sub.cb(data); } catch (e) { /* never let one bad subscriber kill the others */ }
	});
}

// Step 50: shared post-stats processor. Diffs counters vs lastSample,
// emits rate, anchors next sample. Pulled out so both the all-devices
// path and the per-device fallback feed into the same code.
function processStats(s) {
	var now = Date.now();
	var rx  = parseInt((s.statistics && s.statistics.rx_bytes) || 0, 10);
	var tx  = parseInt((s.statistics && s.statistics.tx_bytes) || 0, 10);

	if (state.lastSample) {
		var dt  = (now - state.lastSample.t) / 1000;
		var drx = rx - state.lastSample.rx;
		var dtx = tx - state.lastSample.tx;
		// Counter wrap or device reset → skip this delta, anchor again
		if (dt > 0 && drx >= 0 && dtx >= 0) {
			emit({
				rxBps:      drx / dt,
				txBps:      dtx / dt,
				deviceName: state.wanDevice,
				online:     s.up !== false
			});
		}
	}
	state.lastSample = { t: now, rx: rx, tx: tx };
}

function poll() {
	// Re-detect if we lost the device (e.g. WAN was down at page load, now up)
	if (!state.wanDevice) {
		return detectWanDevice().then(function (name) {
			if (name) {
				state.wanDevice = name;
				// Reset sample anchor — counters from a freshly-up device aren't
				// comparable with whatever we had before.
				state.lastSample = null;
			} else {
				emit({ rxBps: null, txBps: null, deviceName: null, online: false });
			}
		});
	}

	// Try the all-devices call first (one RPC fetches stats for every iface)
	return deviceStatusAll().then(function (statuses) {
		var s = pickDeviceStats(statuses, state.wanDevice);
		if (s) {
			processStats(s);
			return;
		}
		// All-devices response didn't contain our device under any known
		// shape — try a targeted single-device query, which on some LuCI
		// builds uses a different (flatter) response shape.
		warn('all-devices response missing ' + state.wanDevice + ', trying single-device', statuses);
		return deviceStatusOne(state.wanDevice).then(function (resp) {
			var s2 = pickDeviceStats(resp, state.wanDevice);
			if (s2) {
				processStats(s2);
			} else {
				warn('single-device response also missing statistics', resp);
				emit({ rxBps: null, txBps: null, deviceName: state.wanDevice, online: false });
			}
		}).catch(function (err) {
			warn('single-device call failed', err);
			emit({ rxBps: null, txBps: null, deviceName: state.wanDevice, online: false });
		});
	}).catch(function (err) {
		// All-devices call itself rejected (rpcd down, permissions, etc).
		// Try single-device as a last resort — same RPC method, sometimes
		// works when the all-devices form doesn't (rare but seen).
		warn('all-devices call failed, trying single-device', err);
		return deviceStatusOne(state.wanDevice).then(function (resp) {
			var s = pickDeviceStats(resp, state.wanDevice);
			if (s) {
				processStats(s);
			} else {
				warn('single-device also failed', resp);
				emit({ rxBps: null, txBps: null, deviceName: state.wanDevice, online: null });
			}
		}).catch(function (err2) {
			warn('both calls failed', err2);
			emit({ rxBps: null, txBps: null, deviceName: state.wanDevice, online: null });
		});
	});
}

function startTimer() {
	if (state.timer) return;
	// Kick off detection + first poll asap so subscribers don't stare at "—"
	// for 2 s on a fresh page load.
	poll().then(function () {
		state.timer = setInterval(poll, POLL_INTERVAL_MS);
	});
}

function stopTimer() {
	if (state.timer) { clearInterval(state.timer); state.timer = null; }
	state.lastSample = null;
}

return baseclass.extend({
	__init__: function () { /* lazy — actual work only starts on first subscribe() */ },

	// Public — call once per consumer.
	//   cb({ rxBps, txBps, deviceName, online })  — every 2 s while subscribed
	// Returns an unsubscribe function.
	subscribe: function (cb) {
		var sub = { cb: cb };
		state.subscribers.push(sub);
		startTimer();
		// Replay the last known sample immediately so consumers can render
		// without waiting a full poll interval.
		if (state.lastEmit.deviceName !== null) {
			try { cb(state.lastEmit); } catch (e) {}
		}
		return function unsubscribe() {
			var i = state.subscribers.indexOf(sub);
			if (i >= 0) state.subscribers.splice(i, 1);
			if (state.subscribers.length === 0) stopTimer();
		};
	},

	// Synchronous read of the last computed sample.
	snapshot: function () { return state.lastEmit; }
});
