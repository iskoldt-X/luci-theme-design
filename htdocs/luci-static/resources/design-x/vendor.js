'use strict';
'require baseclass';

// ─────────────────────────────────────────────────────────────────────────────
// MAC vendor lookup — Round 44 Step 203 (doc/macvendor.md §四 Phase 2B)
//
// Resolves a MAC address into a vendor name. Three layers:
//   1. Multicast bit (first octet & 0x01) → "Multicast" (LAN Clients
//      should never see these but defence-in-depth — a corrupted lease
//      file emitting broadcast would otherwise display "Apple, Inc.")
//   2. LAA bit (first octet & 0x02) → "Private (randomized)" — covers
//      iOS/Android private MAC, Docker overlay, KVM/QEMU, VMware ESX.
//      ~44% of the user's actual devices per Phase 1 verification
//      (doc/macvendor.md §一.五). Zero DB lookups needed.
//   3. UAA → consult either upstream host_hints.vendor (when future
//      ImmortalWrt backports ufp-neigh; currently empty) or the local
//      Wireshark manuf DB at /luci-static/design-x/data/oui.json.gz
//      (Step 202 build CI generates ~332 KB compressed, ~39K MA-L
//      entries).
//
// API surface — all promise-based but lookup() is sync-fast for
// LAA/Multicast/InvalidMAC cases:
//   lookup(mac, hostHintVendor?) → Promise<string>
//   lookupSync(mac, mapOrNull, hostHintVendor?) → string  (use after preload)
//   preload() → Promise<map>   — kick off DB load+decompress early
//
// Future-proofing per doc/macvendor.md §一.五: hostHintVendor parameter
// is plumbed end-to-end. The day ImmortalWrt 24.10+ exposes
// host_hints.vendor, devices.js passes it and we automatically prefer
// upstream → no re-architecture. Zero-line caller change.
//
// Why DecompressionStream and not pako: doc/macvendor.md §七 #3.
// Browser API support: Chrome 80+, FF 113+, Safari 16.4+ (<2% miss
// on real LuCI access patterns). Old browsers fall through to "Unknown
// vendor" — not great but not a feature breakage either.
// ─────────────────────────────────────────────────────────────────────────────

var VENDOR_DATA_URL = '/luci-static/design-x/data/oui.json.gz';
var SESSION_KEY     = 'design-x.oui-map';
var _mapPromise     = null;   // singleton

// Public bit-classification helper — returns 'uaa' | 'laa' | 'multicast'
// | 'invalid'. Centralised here so devices.js / etc. never re-implement
// MAC bit checks (doc/macvendor.md §七 #10).
function bitsToCategory(mac) {
	if (typeof mac !== 'string' || mac.length < 2) return 'invalid';
	var octet1 = parseInt(mac.substring(0, 2), 16);
	if (!isFinite(octet1)) return 'invalid';
	if (octet1 & 0x01)     return 'multicast';
	if (octet1 & 0x02)     return 'laa';
	return 'uaa';
}

// Internal: load + decompress + parse the OUI map, with sessionStorage
// cache to skip decompression on repeat page loads in the same session.
function loadMap() {
	if (_mapPromise) return _mapPromise;

	// Hot path — sessionStorage hit (parsed JSON cached as text).
	try {
		var cached = sessionStorage.getItem(SESSION_KEY);
		if (cached) {
			_mapPromise = Promise.resolve(JSON.parse(cached));
			return _mapPromise;
		}
	} catch (e) {
		// QuotaExceeded, disabled storage, private mode etc — fall through
		// to network fetch.
	}

	// Older browser fallback — no DecompressionStream.
	// Safari < 16.4 / Firefox < 113 / Chrome < 80 occupy < 2% of LuCI
	// admin traffic (it's a router admin panel, accessed from modern
	// desktop+phone browsers). Returning an empty map degrades to
	// "Unknown vendor" for UAA entries; LAA + Multicast checks above
	// still work.
	if (typeof DecompressionStream === 'undefined') {
		if (window.console && console.warn) {
			console.warn('vendor: DecompressionStream not supported — falling back to empty map');
		}
		_mapPromise = Promise.resolve({});
		return _mapPromise;
	}

	_mapPromise = fetch(VENDOR_DATA_URL).then(function (res) {
		if (!res.ok) throw new Error('vendor DB fetch failed: HTTP ' + res.status);
		var ds = new DecompressionStream('gzip');
		return new Response(res.body.pipeThrough(ds)).text();
	}).then(function (text) {
		var map = JSON.parse(text);
		// Cache parsed text (not the gzipped bytes) so the next page in
		// this session skips the decompress step entirely.
		try { sessionStorage.setItem(SESSION_KEY, text); } catch (e) { /* quota */ }
		return map;
	}).catch(function (e) {
		if (window.console && console.warn) console.warn('vendor: load failed', e);
		// Don't sticky-fail — null out the singleton so a later retry
		// can recover (e.g. network blip during initial Overview mount).
		_mapPromise = null;
		return {};
	});

	return _mapPromise;
}

// Synchronous lookup once the map is in hand. Used internally by the
// promise-wrapping lookup() and exposed for callers who pre-loaded via
// preload() (e.g. render loops that don't want to await on every row).
function lookupSync(mac, map, hostHintVendor) {
	var cat = bitsToCategory(mac);
	if (cat === 'invalid')   return _('Unknown');
	if (cat === 'multicast') return _('Multicast');
	if (cat === 'laa')       return _('Private (randomized)');
	// UAA — trust upstream first when available, else local DB.
	if (hostHintVendor) return hostHintVendor;
	var prefix = mac.substring(0, 8).toUpperCase().replace(/:/g, '');
	return (map && map[prefix]) ? map[prefix] : _('Unknown vendor');
}

return baseclass.extend({

	// Async lookup. For UAA addresses without a hostHint, awaits the
	// DB load (cached after first call). For LAA / Multicast / Invalid,
	// resolves immediately without touching the DB.
	lookup: function (mac, hostHintVendor) {
		var cat = bitsToCategory(mac);
		if (cat === 'invalid')   return Promise.resolve(_('Unknown'));
		if (cat === 'multicast') return Promise.resolve(_('Multicast'));
		if (cat === 'laa')       return Promise.resolve(_('Private (randomized)'));
		if (hostHintVendor)      return Promise.resolve(hostHintVendor);

		return loadMap().then(function (map) {
			return lookupSync(mac, map, null);
		});
	},

	// Synchronous form. Callers must have awaited preload() at least
	// once before relying on this; if they didn't, the map argument
	// will be null/undefined and UAA entries fall through to
	// "Unknown vendor".
	lookupSync: lookupSync,

	// Public: bit category exposed so devices.js / debug tooling can
	// classify a MAC without committing to a full lookup. Returns one
	// of 'uaa' / 'laa' / 'multicast' / 'invalid'.
	category: bitsToCategory,

	// Kick off the DB load + decompress on the calling page. Safe to
	// call multiple times; subsequent calls return the singleton.
	preload: loadMap,

	// Test seam — reset cached singleton. Not for production use.
	__reset__: function () {
		_mapPromise = null;
		try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
	}
});
