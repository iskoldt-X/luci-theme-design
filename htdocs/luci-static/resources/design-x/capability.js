'use strict';
'require baseclass';
'require uci';

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
			var to = withTimeout(800);
			return fetch('/cgi-bin/design/temp', { signal: to.signal })
				.then(function (r) {
					to.clear();
					if (!r.ok) return false;
					return r.text().then(function (body) {
						try {
							var data = JSON.parse(body);
							return Array.isArray(data.zones) && data.zones.length > 0;
						} catch (e) { return false; }
					});
				}).catch(function () { return false; });
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

	// Generic CGI reachability probe.
	cgi: function (name) {
		return cached('cgi:' + name, function () {
			var to = withTimeout(800);
			return fetch('/cgi-bin/design/' + name + '?probe=1', { signal: to.signal })
				.then(function (r) { to.clear(); return r.ok; })
				.catch(function () { return false; });
		});
	},

	__reset__: function () { CACHE = {}; }
});
