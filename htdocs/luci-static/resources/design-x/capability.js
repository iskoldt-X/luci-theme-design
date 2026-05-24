'use strict';
'require baseclass';
'require uci';
'require rpc';

// ─────────────────────────────────────────────────────────────────────────────
// Capability detection — upgrade.md §0.5
//
// Each Phase 2+ feature card calls these to decide between "show full UI"
// and "show install-this-package placeholder". Detection results are cached
// for the page lifetime (one probe per browser tab).
//
// Usage from another LuCI module:
//   var cap = await L.require('design-x.capability');
//   if (await cap.thermal()) renderTempCard(); else hideTempCard();
//
// All probes have a hard timeout so a slow / hung backend doesn't block
// rendering. Errors are caught and treated as "not available".
// ─────────────────────────────────────────────────────────────────────────────

var CACHE = {};

function withTimeout(ms) {
	// AbortSignal.timeout is the right primitive but not in old WebViews;
	// build our own controller to keep things portable.
	var ctrl = new AbortController();
	var t = setTimeout(function () { ctrl.abort(); }, ms);
	return { signal: ctrl.signal, clear: function () { clearTimeout(t); } };
}

function cached(key, fn) {
	if (key in CACHE) return Promise.resolve(CACHE[key]);
	return Promise.resolve(fn()).then(function (v) {
		CACHE[key] = v;
		return v;
	}).catch(function () {
		CACHE[key] = false;
		return false;
	});
}

// Round 42 Step 165: temp probe migrated from /cgi-bin/design/temp to
// luci-theme-design-x.temp ubus method. Backend impl preserves the
// legacy {zones:[...]} shape verbatim.
var callTemp = rpc.declare({
	object: 'luci-theme-design-x',
	method: 'temp',
	expect: { '': {} }
});

return baseclass.extend({
	// Netlink-based bandwidth accounting installed? Gates D2 traffic
	// analysis full UI. We accept either:
	//   - luci-app-nlbwmon  (modern, ImmortalWrt 24.10+ / OpenWrt 23.05+)
	//   - luci-app-nlbw     (legacy, older builds)
	// Detection method: probe /etc/config/{nlbwmon,nlbw} via uci.load.
	// NB: the UCI config file name is just 'nlbwmon' / 'nlbw' (NOT the
	// 'luci-app-' prefix — that's only the opkg package name). The original
	// `uci.load('luci-app-nlbw')` was a bug — it would never find /etc/config/luci-app-nlbw
	// because that file doesn't exist regardless of installation state.
	nlbw: function () {
		return cached('nlbw', function () {
			return L.resolveDefault(uci.load('nlbwmon'), null)
				.then(function (r) {
					if (r !== null) return true;
					return L.resolveDefault(uci.load('nlbw'), null)
						.then(function (r2) { return r2 !== null; });
				})
				.catch(function () { return false; });
		});
	},

	// Box has at least one thermal_zone? (gates S3 temperature tile)
	thermal: function () {
		return cached('thermal', function () {
			// Round 42 Step 165: rpc.declare doesn't accept AbortSignal
			// like fetch does, so withTimeout's AbortController is no
			// longer applicable. Use Promise.race for an 800 ms cutoff.
			// The rpc call may keep running in background after the
			// race rejects — that's fine, this is a one-shot cached
			// capability probe so the extra cost is negligible.
			var timeoutP = new Promise(function (_, reject) {
				setTimeout(function () { reject(new Error('thermal-probe-timeout')); }, 800);
			});
			return Promise.race([ callTemp(), timeoutP ])
				.then(function (data) {
					return !!(data && Array.isArray(data.zones) && data.zones.length > 0);
				})
				.catch(function () { return false; });
		});
	},

	// Box has at least one wireless radio? (gates A5 speedtest signal extras)
	wireless: function () {
		return cached('wireless', function () {
			var rpc = L.rpc.declare({
				object: 'iwinfo', method: 'devices',
				expect: { devices: [] }
			});
			return rpc().then(function (devs) {
				return Array.isArray(devs) && devs.length > 0;
			}).catch(function () { return false; });
		});
	},

	// Round 44 Step 201: capability.cgi() removed — all 9 CGI endpoints
	// migrated to rpcd ubus (Steps 163-167) + LuCI Lua controller
	// (Step 166). There were no in-tree callers of .cgi(); the dead
	// method (and its /cgi-bin/design/<name>?probe=1 fetch) is gone.

	__reset__: function () { CACHE = {}; }
});
