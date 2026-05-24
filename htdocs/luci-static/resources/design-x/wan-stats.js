'use strict';
'require baseclass';
'require network';
'require rpc';

// ─────────────────────────────────────────────────────────────────────────────
// WAN throughput stats — shared singleton
//
// Polls a tiny shell CGI every 2 s that reads /sys/class/net/<dev>/statistics/
// {rx,tx}_bytes, diffs counters from the last sample, multiplies by 8 to
// convert Bytes/sec → bits/sec, and pushes
// {rxBitsPerSec, txBitsPerSec, deviceName, online} to every subscriber.
//
// Step 137 (Round 36):field renamed from {rxBps,txBps} to
// {rxBitsPerSec,txBitsPerSec}. Old name was technically correct
// (capital B = Bytes/sec, lowercase Bps would be bits) but every
// consumer treated it as bits/sec — the Bytes/sec value got divided
// by 1000 and labelled "Kbps", giving displays 8× too low (Chrome-Claude
// Round-36 audit measured an 837 KB/s download displayed as "839.8 Kbps"
// when the real rate was 6.7 Mbps). Renaming + ×8 at source closes the
// unit-confusion landmine for any future consumer.
//
// Consumed by:
//   - sparkline.js  → "Net" tile (4th tile, live throughput)
//   - wan-hero.js   → "↑ N Mbps · ↓ M Mbps" row at the bottom of the hero
//
// Step 53 (2026-05-23): Replaced the failing rpc.declare network.device
// .status call (LuCI 26.x ACL denies it with -32002 Access denied, even
// though SSH `ubus call network.device status` works) with /cgi-bin/design
// /devstats — a 20-line shell script reading /sys/class/net/. No RPC, no
// ACL, no auth — same data, instant access. See doc/styling-progress.md
// Step 53 for the full diagnostic that found this.
//
// Design notes:
//   1. Singleton. The first subscribe() starts the polling timer; the last
//      unsubscribe() stops it. Two consumers share one CGI stream.
//   2. WAN device detection: still via network.getWANNetworks() →
//      w.getDevice().getName() (that one works — only network.device
//      .status is ACL-blocked, not network.interface dump).
//   3. Counter wrap: if delta < 0 we treat it as a wrap/reset and skip
//      that sample (no spurious huge spike).
//   4. First sample is needed to anchor the diff — first emit happens at
//      the 2nd poll (~2 s in). Until then subscribers see null rates.
// ─────────────────────────────────────────────────────────────────────────────

var POLL_INTERVAL_MS = 2000;

// Round 42 Step 164: data path migrated from the public unauth CGI
// /cgi-bin/design/devstats to the auth-gated rpcd ubus method
// luci-theme-design-x.devstats. The wire format is unchanged (same
// {dev, up, rx_bytes, tx_bytes} on success, same {error, rx_bytes:0,
// tx_bytes:0, up:false} on bad input — see /usr/libexec/rpcd/
// luci-theme-design-x). Only the transport flips: HTTP GET to CGI →
// JSON-RPC POST to /ubus, with LuCI session ACL gating the call.
//
// The old CGI is intentionally NOT deleted in this Step — kept as a
// fallback while the new path is being verified against production.
// A later Sub-B2 cleanup Step will rm root/www/cgi-bin/design/devstats
// once the user confirms the new path works on the MTK build.
var callDevstats = rpc.declare({
	object: 'luci-theme-design-x',
	method: 'devstats',
	params: [ 'dev' ],
	expect: { '': {} }
});

function fetchDevStats(deviceName) {
	return callDevstats(deviceName);
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
	lastEmit:    { rxBitsPerSec: null, txBitsPerSec: null, deviceName: null, online: null }
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
				// × 8 converts Bytes/sec → bits/sec — the conventional
				// network rate unit. Consumers can divide /1000 (Kbps),
				// /1e6 (Mbps), /1e9 (Gbps) directly without further conv.
				rxBitsPerSec: (drx * 8) / dt,
				txBitsPerSec: (dtx * 8) / dt,
				deviceName:   state.wanDevice,
				online:       s.up !== false
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
				emit({ rxBitsPerSec: null, txBitsPerSec: null, deviceName: null, online: false });
			}
		});
	}

	return fetchDevStats(state.wanDevice).then(function (data) {
		if (!data || data.error) {
			warn('devstats error', data);
			emit({ rxBitsPerSec: null, txBitsPerSec: null, deviceName: state.wanDevice, online: false });
			return;
		}
		// Convert the CGI's flat response into the shape processStats expects
		// (same as what the old rpc returned).
		processStats({
			statistics: { rx_bytes: data.rx_bytes, tx_bytes: data.tx_bytes },
			up:         data.up
		});
	}).catch(function (err) {
		warn('devstats fetch failed', err);
		emit({ rxBitsPerSec: null, txBitsPerSec: null, deviceName: state.wanDevice, online: null });
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
	//   cb({ rxBitsPerSec, txBitsPerSec, deviceName, online })  — every 2 s while subscribed
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
