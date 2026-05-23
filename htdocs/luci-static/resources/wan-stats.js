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

var deviceStatusAll = rpc.declare({
	object: 'network.device',
	method: 'status',
	expect: { '': {} }
});

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

	return deviceStatusAll().then(function (statuses) {
		var s = statuses && statuses[state.wanDevice];
		if (!s || !s.statistics) {
			emit({ rxBps: null, txBps: null, deviceName: state.wanDevice, online: false });
			return;
		}
		var now = Date.now();
		var rx  = parseInt(s.statistics.rx_bytes || 0, 10);
		var tx  = parseInt(s.statistics.tx_bytes || 0, 10);

		if (state.lastSample) {
			var dt = (now - state.lastSample.t) / 1000;
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
	}).catch(function () {
		// Don't clobber a known-good lastEmit on transient RPC failure — the
		// ring buffers in sparkline.js handle gaps gracefully.
		emit({
			rxBps: null, txBps: null,
			deviceName: state.wanDevice,
			online: null
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
