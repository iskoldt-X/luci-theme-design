'use strict';
'require baseclass';
'require ui';
'require rpc';
'require uci';
'require design-x.vendor';

// Step 83 (Round 13): SVG namespace helpers. LuCI's E('svg',...) creates
// HTMLUnknownElement — the browser doesn't paint that as SVG so all
// our <use href="#i-..."/> icon references render invisibly.
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
// LAN client list with OUI / type inference — upgrade.md §2.A2
//
// Compact one-line list of DHCP clients, augmented with:
//   - Device type guess (laptop / phone / TV / IoT etc.) from hostname keywords
//   - Vendor guess from MAC OUI prefix
//   - Click row to expand details
//   - Step 44: smooth inline expand (CSS max-height transition, no full
//     re-render on every toggle), chevron rotation, action buttons
//     (Rename / Limit / Block) — Rename persists to localStorage so the
//     name survives DHCP refreshes within the same browser. Limit & Block
//     are honest stubs that surface a toast explaining they're not yet
//     implemented (no fake feature).
//
// Lives in a card injected into Overview (does NOT replace LuCI's
// admin/network/dhcp view — that stays for detailed management).
//
// Still deferred (out of scope for Step 44):
//   - Wireless signal strength / signal bars  (needs iwinfo merge)
//   - True wired/wifi indicator                (same)
//   - UCI persistence for rename               (currently localStorage only)
//   - Actual block / rate-limit action         (would need uci.firewall +
//                                              uci.qos integration)
// ─────────────────────────────────────────────────────────────────────────────

var STORAGE_KEY      = 'design-device-names-v1';
var SORT_STORAGE_KEY = 'design-device-sort-v1';  // Step 235

// Step 235 (Round 45) — comparators for header click-to-sort.
// Step 237 (Round 45) — signature updated: (a, b, ctx) with ctx
// carrying customNames + presence. `name` carries legacy "named first"
// + locale tie-break; `ip` is segment-numeric so 1.10 sorts after 1.2;
// `lease` (key kept for sortState backwards-compat with Step 235
// localStorage payloads) now keys off presence inactivity when the
// host-presence rpcd method has data, with the Step 235 lease.expires
// fallback for routers that don't have the new backend yet.
var SORT_COMPARATORS = {
	name: function (a, b, ctx) {
		var customNames = ctx && ctx.customNames;
		function nameOf(l) {
			var mac = (l.macaddr || l.mac || '').toUpperCase();
			return ((customNames && customNames[mac]) || l.hostname || '').toLowerCase();
		}
		var na = nameOf(a), nb = nameOf(b);
		if (na && !nb) return -1;
		if (!na && nb) return 1;
		return na.localeCompare(nb);
	},
	ip: function (a, b) {
		function key(ip) {
			if (!ip) return [999, 999, 999, 999];
			var p = String(ip).split('.');
			return [
				parseInt(p[0], 10) || 0,
				parseInt(p[1], 10) || 0,
				parseInt(p[2], 10) || 0,
				parseInt(p[3], 10) || 0
			];
		}
		var ka = key(a.ipaddr), kb = key(b.ipaddr);
		for (var i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
		return 0;
	},
	lease: function (a, b, ctx) {
		var presence = ctx && ctx.presence;
		// Step 237: presence-driven sort when host-presence data exists.
		// Asc = most-recently-active first; Offline rows (mac not in
		// presence map) sink to the bottom regardless of lease state.
		if (presence && Object.keys(presence).length) {
			function inactivity(l) {
				var mac = (l.macaddr || l.mac || '').toUpperCase().replace(/:/g, '');
				var e = presence[mac];
				if (!e) return Infinity;                    // offline
				if (e.via === 'wifi') return e.inactive_ms || 0;
				return 0;                                   // arp: live
			}
			var ia = inactivity(a), ib = inactivity(b);
			if (ia === Infinity && ib === Infinity) return 0;
			if (ia === Infinity) return 1;
			if (ib === Infinity) return -1;
			return ia - ib;
		}
		// Fallback (no presence backend on this router): Step 235 logic.
		// lease.expires is REMAINING seconds (Step 140). ≤0 = static.
		var ea = (a.expires > 0) ? a.expires : Infinity;
		var eb = (b.expires > 0) ? b.expires : Infinity;
		if (ea === Infinity && eb === Infinity) return 0;
		if (ea === Infinity) return 1;
		if (eb === Infinity) return -1;
		return ea - eb;
	}
};

// ── Type inference by hostname keyword ────────────────────────────────────────
// First match wins. Patterns are case-insensitive regex source strings.
// Step 93 (Round 17): tightened icon mappings.
// Step 191 (Round 43, Chrome-Claude Bug #4): proper per-form icons —
//   iPad → i-tablet (was i-phone, distinct silhouette now)
//   iPhone/Android → i-smartphone (Lucide phone-with-screen, not handset)
//   Apple Watch / Galaxy Watch / Fitbit → i-watch (was i-info fallback)
//   Bose / Sonos / HomePod / Echo → i-speaker (was i-info fallback)
// New SVG symbols added to icons.svg same Step.
var DEVICE_TYPES = [
	{ re: /macbook|imac|mac-?mini/i,                          icon: 'i-monitor',     label: 'Computer' },
	{ re: /printer|laserjet|brother|epson|canon|hp-laserjet/i, icon: 'i-server',      label: 'Printer' },
	{ re: /windows|thinkpad|surface|dell-|win[-_]?dk/i,       icon: 'i-monitor',     label: 'Computer' },
	{ re: /truenas|synology|qnap|nas$|nas[-_]/i,              icon: 'i-hard-drive',  label: 'NAS' },
	// Watch BEFORE iphone/ipad — "applewatch" must not be eaten by /iphone/i.
	{ re: /watch|gear-|fitbit|garmin|wear[-_]?os/i,           icon: 'i-watch',       label: 'Watch' },
	{ re: /ipad/i,                                            icon: 'i-tablet',      label: 'Tablet' },
	{ re: /iphone/i,                                          icon: 'i-smartphone',  label: 'Phone' },
	{ re: /android|pixel|samsung[-_]?galaxy|oneplus/i,        icon: 'i-smartphone',  label: 'Android device' },
	{ re: /tv|bravia|webos|chromecast|firetv|appletv|lg-tv/i, icon: 'i-monitor',     label: 'TV / streamer' },
	{ re: /switch|nintendo|playstation|ps5|ps4|xbox/i,        icon: 'i-zap',         label: 'Game console' },
	{ re: /thermostat|nest-?thermostat|hue|aqara|tuya|sonoff|qingping/i, icon: 'i-thermometer', label: 'IoT' },
	{ re: /camera|cam$|cam-|doorbell|ring|hikvision/i,        icon: 'i-eye',         label: 'Camera' },
	// Speaker MUST come after 'watch' so "nest-audio" doesn't catch /nest/.
	// W120/W121 = Bose model numbers (Chrome-Claude saw a W120 in LAN list).
	{ re: /echo|alexa|homepod|nest-?audio|sonos|bose|w1[0-9]{2}/i, icon: 'i-speaker', label: 'Smart speaker' },
	{ re: /node$|gemma|raspberry|rpi|pi-/i,                   icon: 'i-cpu',         label: 'Server' }
];

// ── Vendor by MAC OUI prefix ──────────────────────────────────────────────────
// Top ~35 prefixes by population. Format: "XX:XX:XX" (uppercase, colon-sep).
var OUI = {
	'3C:22:FB': 'Apple',          'A4:C4:94': 'Samsung',          'B8:27:EB': 'Raspberry Pi',
	'DC:A6:32': 'Raspberry Pi',   'E4:5F:01': 'Raspberry Pi',     '00:1A:11': 'Google',
	'F4:F5:D8': 'Google',         'F8:FF:C2': 'Apple',            'A4:83:E7': 'Apple',
	'7C:6D:F8': 'Apple',          '00:25:00': 'Apple',            'F4:5C:89': 'Apple',
	'AC:DE:48': 'Apple',          'B0:35:9F': 'Apple',
	'04:03:D6': 'Nintendo',       '00:24:E4': 'Nintendo',         'DC:A6:BD': 'Sony',
	'00:50:F2': 'Microsoft',      '7C:1E:52': 'Microsoft',        '00:18:FE': 'HP',
	'94:DE:80': 'HP',             '00:14:22': 'Dell',             '00:25:64': 'Dell',
	'04:7D:7B': 'Lenovo',         'B8:AC:6F': 'Dell',             '00:0C:29': 'VMware',
	'00:50:56': 'VMware',         '52:54:00': 'QEMU/KVM',         '08:00:27': 'VirtualBox',
	'EC:FA:BC': 'Espressif',      '24:6F:28': 'Espressif IoT',
	'B0:F8:93': 'TP-Link',        '14:CC:20': 'TP-Link',          '00:1D:7E': 'Cisco-Linksys'
};

function ouiVendor(mac) {
	if (!mac || typeof mac !== 'string') return null;
	var prefix = mac.toUpperCase().substr(0, 8);
	return OUI[prefix] || null;
}

function inferType(hostname) {
	if (!hostname) return { icon: 'i-info', label: _('Unknown') };
	for (var i = 0; i < DEVICE_TYPES.length; i++) {
		if (DEVICE_TYPES[i].re.test(hostname)) {
			return { icon: DEVICE_TYPES[i].icon, label: _(DEVICE_TYPES[i].label) };
		}
	}
	return { icon: 'i-info', label: _('Unknown') };
}

// Step 93 (Round 17) → Step 140 (Round 38):"Lease" column from DHCP
// lease.expires.
//
// CRITICAL UNIT NOTE — Step 140 fix:
// luci-rpc.getDHCPLeases returns lease.expires as **remaining seconds**
// (how many seconds until the lease expires), NOT a Unix epoch timestamp.
// Step 93 treated it as epoch — `new Date(expires * 1000)` produced
// "1970-01-01 11:55:45" for a normal expires=39345 (=~10.9 hours
// remaining). The "Last Seen" column then computed `(nowSec - 39345) /
// 86400 ≈ 20596 days` for every device — showing 56-year-old "Last
// seen" for every active client. ALL rows got .devices-row-offline.
//
// Also semantically wrong: DHCP lease validity says NOTHING about "when
// the device was last seen". A device could be powered off but still
// have a valid lease (lease lifetime ≠ device activity). True last-seen
// would need /proc/net/arp REACHABLE state or iwinfo.assoclist.inactive.
// We don't have that without a new CGI, so the column is renamed
// "Lease" (honest about the data we have) and shows time-remaining.
//
// Semantics now:
//   - Static lease (expires == 0 or undefined) → "Static"
//   - Lease still valid (expires > 0) → "Xm / Xh / Xd left"
//   - Negative or already-expired (rare; dnsmasq usually drops these) →
//     "Expired" + .devices-row-offline class for visual dimming
function formatLastSeen(lease) {
	if (!lease || lease.expires === undefined || lease.expires === null) {
		return { stale: false, text: _('Static') };
	}
	if (lease.expires === 0) {
		return { stale: false, text: _('Static') };
	}
	if (lease.expires > 0) {
		// Time remaining on lease. Valid lease → not stale.
		// Step 148 (Round 40):minute precision via formatLeaseRemaining,
		// matching the upstream DHCP Leases table resolution (which Step 149
		// removes from Overview, this card is the new canonical view).
		return { stale: false, text: formatLeaseRemaining(lease.expires) };
	}
	// expires < 0 means already expired (rare).
	return { stale: true, text: _('Expired') };
}

// Round 44 Step 218 — presence-aware formatter for the LAN Clients
// "Lease" column. When host-presence data is available, prefer real
// activity (ARP presence + wifi inactive_ms) over DHCP lease validity.
// Falls back to formatLastSeen(lease) when no presence info exists
// (e.g. host-presence rpcd method returned null, or the MAC isn't in
// the presence map at all).
//
// Semantic mapping:
//   wifi active (inactive < 5s)     → "Active"  not stale
//   wifi recent (inactive < 60s)    → "<Xs ago" not stale
//   wifi staler (inactive < 3600s)  → "Xm ago"  stale
//   wifi very stale                 → "Xh ago"  stale
//   arp present (ATF_COM)           → "Active"  not stale
//   no presence info available      → formatLastSeen(lease) (Round 38 path)
//   presence map exists but MAC absent → "Offline" stale
function formatPresence(presenceMap, mac, lease) {
	if (!presenceMap || !mac) return formatLastSeen(lease);
	var entry = presenceMap[mac];
	if (!entry) {
		// presence_map exists but no row for this MAC → genuinely offline
		// (not in ARP, no wifi assoc). Override lease — even a valid
		// DHCP lease doesn't mean the device is reachable right now.
		return { stale: true, text: _('Offline') };
	}
	if (entry.via === 'wifi') {
		var ms = entry.inactive_ms || 0;
		if (ms < 5000)    return { stale: false, text: _('Active') };
		if (ms < 60000)   return { stale: false, text: Math.floor(ms / 1000) + 's' };
		if (ms < 3600000) return { stale: true,  text: Math.floor(ms / 60000) + 'm' };
		return { stale: true, text: Math.floor(ms / 3600000) + 'h' };
	}
	// via === 'arp' → kernel ARP table has a complete entry, so the
	// host responded to ARP recently (within ~5-15 min depending on
	// arp_table_gc_thresh). Treat as active.
	return { stale: false, text: _('Active') };
}

function relativeAge(ageSec) {
	if (ageSec < 60)    return '<1m';
	if (ageSec < 3600)  return Math.floor(ageSec / 60)    + 'm';
	if (ageSec < 86400) return Math.floor(ageSec / 3600)  + 'h';
	return Math.floor(ageSec / 86400) + 'd';
}

// Step 148 (Round 40):minute-precision lease formatter. relativeAge() above
// is single-unit ('10h') which is too coarse for lease remaining time —
// users want to see "10h 33m" (matches the upstream DHCP Leases table
// resolution we're replacing in Step 149). Sub-minute defaults to <1m
// (no second-resolution to avoid every-second jitter in the UI).
function formatLeaseRemaining(secs) {
	if (secs < 60)    return '<1m';
	if (secs < 3600) {
		var m = Math.floor(secs / 60);
		return m + 'm';
	}
	if (secs < 86400) {
		var h  = Math.floor(secs / 3600);
		var mm = Math.floor((secs % 3600) / 60);
		return mm > 0 ? (h + 'h ' + mm + 'm') : (h + 'h');
	}
	var d  = Math.floor(secs / 86400);
	var hh = Math.floor((secs % 86400) / 3600);
	return hh > 0 ? (d + 'd ' + hh + 'h') : (d + 'd');
}

// ── Wi-Fi station data (Step 94, Round 17) ───────────────────────────────────
// Round 42 Step 165: wifi-stations data path migrated from /cgi-bin/design/
// wifi-stations to the auth-gated luci-theme-design-x.wifi-stations ubus
// method. Backend impl mirrors the legacy CGI verbatim — same
// `ubus call iwinfo {devices,info,assoclist}` probe order with per-device
// payloads passed through VERBATIM (no jsonfilter re-parse) so the JS
// consumer sees the same {available, interfaces: { wlanN: { info,
// assoclist } } } shape. On routers without Wi-Fi the response is
// {available:false} and buildStationMap treats every client as wired —
// Step 93 behaviour preserved.
var callWifiStations = rpc.declare({
	object: 'luci-theme-design-x',
	method: 'wifi-stations',
	expect: { '': {} }
});

// Round 44 Step 218 — real "last seen" data source. host-presence rpcd
// method (root/usr/libexec/rpcd/luci-theme-design-x) parses
// /proc/net/arp for wired hosts and iwinfo assoclist.inactive for
// wireless. Returns:
//   { hosts: { "AABBCCDDEEFF": { via: "wifi"|"arp", iface, state, inactive_ms? } } }
// Hosts absent from this map are offline (no ARP entry, no wifi assoc).
var callHostPresence = rpc.declare({
	object: 'luci-theme-design-x',
	method: 'host-presence',
	expect: { '': {} }
});

function fetchHostPresence() {
	return callHostPresence().catch(function () { return null; });
}

function fetchWifiStations() {
	return callWifiStations()
		.catch(function () { return null; });
}

// Flatten the per-interface assoclist responses into a single
// MAC → { iface, info, station } map for O(1) lookup by buildRow().
// info carries per-interface fields (channel, frequency, mode);
// station carries per-client fields (signal, noise, rx.rate, tx.rate, mhz).
//
// Round 44 Step 198 — Bug #5 audit (Chrome-Claude). Reported symptom:
// "all 13 LAN clients show Wired" on user's box (QEMU, no wifi → expected).
// Front-end + backend audit found logic is sound (MAC normalised
// uppercase both sides, available/interfaces null-checks correct,
// graceful empty-map fallback). However, two latent issues that
// could mask wifi clients on real hardware:
//
//   1. `assoclist.results` field name — older iwinfo (mt7615 vendor
//      driver, ath10k-non-ct) sometimes emits `clients` instead.
//      Add `assoclist.results || assoclist.clients || []` fallback.
//
//   2. Some chipsets emit empty `results: []` even when STAs are
//      actually associated (kernel STA tracker disagrees with hostapd
//      STA list — known issue on some MT76 builds). Without real
//      hardware we can't reproduce; gate diagnostic logging behind
//      window.designDebug so a future hardware report has data.
//
// If a user reports "all Wired on real wifi-active router", enable
// `window.designDebug = true` in DevTools console + refresh, then
// look for "[wifi-stations]" lines to triage where the chain breaks.
function buildStationMap(wifiData) {
	var map = {};
	if (!wifiData || !wifiData.available || !wifiData.interfaces) {
		if (window.designDebug && window.console && console.debug) {
			console.debug('[wifi-stations] unavailable',
				wifiData && wifiData.reason ? '(reason=' + wifiData.reason + ')' : '');
		}
		return map;
	}
	var totalStations = 0;
	Object.keys(wifiData.interfaces).forEach(function (iface) {
		var data = wifiData.interfaces[iface] || {};
		var info = data.info || {};
		// Defensive: tolerate `clients` as alternate field name (older
		// iwinfo builds on some MT76 / ath10k-non-ct variants).
		var list = (data.assoclist && (data.assoclist.results || data.assoclist.clients)) || [];
		list.forEach(function (s) {
			var mac = (s.mac || '').toUpperCase();
			if (mac) { map[mac] = { iface: iface, info: info, station: s }; totalStations++; }
		});
	});
	if (window.designDebug && window.console && console.debug) {
		console.debug('[wifi-stations]',
			Object.keys(wifiData.interfaces).length + ' iface(s),',
			totalStations + ' station(s)');
	}
	return map;
}

// dBm → visual signal-bars modifier class. Three tiers matches the
// CSS scaffolding (Step 93). >=-55 strong (no modifier), -55..-65
// medium (dim 4th bar), <-65 weak (yellow first 2, dim 3-4).
function signalToBarsClass(dBm) {
	if (dBm == null || !isFinite(dBm)) return '';
	if (dBm >= -55) return '';
	if (dBm >= -65) return 'devices-sig-bars-medium';
	return 'devices-sig-bars-weak';
}

// Frequency (MHz) → human band label. 2.4 GHz APs report 2412–2484,
// 5 GHz report 5180–5825, 6 GHz report 5955+ on Wi-Fi 6E.
function formatBand(freqMHz) {
	if (!freqMHz || !isFinite(freqMHz)) return '';
	if (freqMHz < 3000) return '2.4 GHz';
	if (freqMHz < 6000) return '5 GHz';
	return '6 GHz';
}

// Compose "Wi-Fi 5 GHz · ch 149 · 80 MHz" from iwinfo info + station data.
// ch comes from the iface's info (one channel per radio).
// width comes from the station's rx.mhz (per-client negotiated width).
function formatWifiConnection(info, station) {
	var parts = [];
	var band = formatBand(info.frequency);
	if (band) parts.push(band);
	if (info.channel != null)                  parts.push('ch ' + info.channel);
	if (station && station.rx && station.rx.mhz) parts.push(station.rx.mhz + ' MHz');
	return parts.length ? 'Wi-Fi · ' + parts.join(' · ') : 'Wi-Fi';
}

// Pretty-print iwinfo's rx/tx rate (in Kbps) as Mbps for the detail row.
function formatRateKbps(kbps) {
	if (kbps == null || !isFinite(kbps) || kbps <= 0) return '—';
	if (kbps < 1000) return kbps + ' Kbps';
	return Math.round(kbps / 1000) + ' Mbps';
}

// ── Custom names (Step 44) — localStorage persistence ────────────────────────
// Best-effort: lost on browser clear, doesn't sync across browsers / devices.
// UCI persistence is a follow-up (would need a new UCI section + reload-safe
// schema). The toast on save makes the boundary explicit.
// Step 153 (Round 40 patch 3):sanitize a candidate hostname so dnsmasq
// will accept it. dnsmasq enforces RFC 952/1123: only [a-zA-Z0-9-], must
// not start with hyphen, ≤ 63 chars. ANY other character → "bad DHCP host
// name" → dnsmasq crash loop → procd gives up → entire LAN loses DHCP+DNS.
//
// Step 152 omitted this validation; user typed "MacBook Pro A" (with
// spaces), Step 152 wrote it raw to /etc/config/dhcp, dnsmasq crashed 6
// times at 03:38:54 and never came back up. 7 hours of LAN outage (iPhone
// couldn't get DHCP on reconnect, devices with valid leases lost name
// resolution). Definitive incident; this Step closes the hole.
//
// Transform pipeline:
//   "MacBook Pro A"        → "MacBook-Pro-A"
//   "iPad (Adam's)"        → "iPad-Adams"
//   "我的手机"             → ""  (caller rejects empty when input wasn't)
//   "--leading-trailing--" → "leading-trailing"
//   "many   spaces   here" → "many-spaces-here"
//   63-char-overflowed-... → truncated at 63 chars
function sanitizeHostname(input) {
	if (!input) return '';
	return input
		.trim()
		.replace(/[\s_]+/g, '-')           // whitespace/underscore → hyphen
		.replace(/[^a-zA-Z0-9-]/g, '')     // strip non-alphanumeric-hyphen
		.replace(/-+/g, '-')               // collapse consecutive hyphens
		.replace(/^-+|-+$/g, '')           // strip leading/trailing hyphens
		.substring(0, 63)                  // RFC 1035 label limit
		.replace(/-+$/, '');               // re-strip trailing if truncation left one
}

function loadCustomNames() {
	try {
		var raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch (e) { return {}; }
}
function saveCustomNames(map) {
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); }
	catch (e) { /* quota / disabled — fail silent */ }
}

// Step 235 — sort-state persistence. Schema validated on load so an
// older / corrupted payload reverts to defaults instead of throwing.
function loadSortState() {
	try {
		var raw = localStorage.getItem(SORT_STORAGE_KEY);
		var s = raw ? JSON.parse(raw) : null;
		if (s && SORT_COMPARATORS[s.col] && (s.dir === 'asc' || s.dir === 'desc')) {
			return s;
		}
	} catch (e) { /* fall through */ }
	return { col: 'name', dir: 'asc' };
}
function saveSortState(s) {
	try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(s)); }
	catch (e) { /* fail silent */ }
}

function toastSafe(type, msg) {
	if (window.toast && window.toast[type]) return window.toast[type](msg);
	if (type === 'error' && console && console.error) console.error(msg);
	return null;
}

// ── ubus / RPC ────────────────────────────────────────────────────────────────
var getDHCPLeases = L.rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { '': {} }
});

// Step 234 (Round 45) — luci-rpc.getHostHints returns a per-MAC map
// including `ip6addrs` (array of all observed v6 addresses). DHCP6
// leases only carry one (the one currently assigned by dnsmasq); hints
// aggregates from /proc/net/ipv6_route + NDP table + DHCP6, so a host
// with SLAAC + DHCPv6 + link-local will all show up.
var getHostHints = L.rpc.declare({
	object: 'luci-rpc',
	method: 'getHostHints',
	expect: { '': {} }
});

// Step 243 (Round 46) — Block feature RPC bindings.
// list-blocks returns {macs: ["aa:bb:..", ...]} from kernel nft state.
// block-mac / unblock-mac mutate the inet design_x.blocked_macs set
// AND regenerate the persistence file at
// /usr/share/nftables.d/ruleset-post/design_x.nft so state survives
// fw4 reload + reboot. Backend at root/usr/libexec/rpcd/luci-theme-
// design-x; arch + verification log in doc/styling-progress.md Step
// 242 (+a/+b/+c).
var callListBlocks  = rpc.declare({ object: 'luci-theme-design-x', method: 'list-blocks',  expect: { '': {} } });
var callBlockMac    = rpc.declare({ object: 'luci-theme-design-x', method: 'block-mac',    params: ['mac'], expect: { '': {} } });
var callUnblockMac  = rpc.declare({ object: 'luci-theme-design-x', method: 'unblock-mac',  params: ['mac'], expect: { '': {} } });

function fetchBlockedMacs() {
	return callListBlocks()
		.then(function (r) {
			var map = {};
			if (r && Array.isArray(r.macs)) {
				r.macs.forEach(function (m) { map[String(m).toUpperCase()] = true; });
			}
			return map;
		});
}

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function () {
		if (!document.body.classList.contains('node-admin-status-overview')) return;
		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design-x') + '/icons.svg';
		this.expanded     = {};                   // mac → bool
		this.customNames  = loadCustomNames();    // mac → string
		this.stations     = {};                   // mac → { iface, info, station } (Step 94)
		this.presence     = {};                   // mac-nocolon → { via, iface, state, inactive_ms? } (Step 218)
		this.hintsByMac   = {};                   // MAC-with-colons → host-hints entry (Step 234)
		this.blockedMacs  = {};                   // MAC uppercase → true (Step 243)
		this.sortState    = loadSortState();      // { col, dir } (Step 235)
		this._lastLeases  = null;                 // cache last fetch so toggleSort can re-render without refetch
		// Round 44 Step 204: kick off Wireshark manuf OUI DB load + decompress
		// as early as possible. ~332 KB gzip fetch + DecompressionStream
		// runs in parallel with the rest of Overview rendering; by the
		// time the user expands a LAN Clients row to see the Vendor field,
		// the lookup is cached.
		// (Batch 2: Disabled preload to save bandwidth on dashboard load; lazy loaded on expand)
		// L.require('design-x.vendor').then(function (v) { v.preload(); });
		this.tryInject();
	},

	tryInject: function () {
		var view = document.getElementById('view');
		if (!view || !view.firstChild || view.querySelector('.spinning')) {
			if ((this._retries = (this._retries || 0) + 1) > 20) return;
			setTimeout(L.bind(this.tryInject, this), 250);
			return;
		}
		this.startHideUpstreamDhcp();
		this.startHideStorageDockerOverlay();
		this.injectCard();
		this.refresh();
		this._timer = window.DXScheduler.every(30000, L.bind(this.refresh, this));
	},

	// Round 43 Step 190 — Bug #3 (Chrome-Claude). The Storage card on
	// Overview lists every mounted filesystem returned by `/proc/mounts`.
	// On boxes running Docker, that includes container overlay layers:
	//   /opt/docker/overlay2/<64hex>/merged   (per-container merged FS)
	//   /var/lib/docker/overlay2/<64hex>/...  (legacy path)
	// These occupy 3-N rows of the Storage card with zero value to a
	// router admin — they push real disks (/dev/sda1, /dev/sdb) below
	// the fold.
	//
	// Strategy: same as DHCP hide. Scan Storage <tr>s, match path
	// column against docker overlay patterns, stamp data-design-hidden=1.
	// Step 188's universal CSS rule does the actual hiding.
	startHideStorageDockerOverlay: function () {
		var self = this;
		this.hideStorageDockerOverlayRows();
		var view = document.getElementById('view');
		if (!view || typeof MutationObserver === 'undefined') return;
		var observer = new MutationObserver(function () {
			self.hideStorageDockerOverlayRows();
		});
		observer.observe(view, { childList: true, subtree: true });
		// Same 10s window as DHCP hide — LuCI finishes staged renders by then.
		setTimeout(function () { observer.disconnect(); }, 10000);
	},

	hideStorageDockerOverlayRows: function () {
		var view = document.getElementById('view');
		if (!view) return;
		// Docker overlay paths:
		//   /opt/docker/overlay2/...
		//   /var/lib/docker/overlay2/...
		//   any /overlay/<sha>/ pattern as defence-in-depth
		var DOCKER_RE = /\/(?:opt|var\/lib)\/docker\/overlay2\/|\/overlay\/[0-9a-f]{32,}/i;
		// Storage card rows are real <tr>s within .cbi-section tables.
		// Cheapest selector: any <tr> with a first <td> whose text matches.
		var rows = view.querySelectorAll('.cbi-section tr');
		for (var i = 0; i < rows.length; i++) {
			var row = rows[i];
			if (row.dataset && row.dataset.designHidden) continue;
			var firstCell = row.querySelector('td');
			if (!firstCell) continue;
			var text = (firstCell.textContent || '').trim();
			if (DOCKER_RE.test(text)) {
				row.dataset.designHidden = '1';
			}
		}
	},

	// Step 149 (Round 40) + Step 150 (Round 40 patch):hide upstream LuCI
	// 'Active DHCP Leases' / 'Active DHCPv6 Leases' sections on Overview.
	//
	// Step 149 first attempt:scanned .cbi-section once at tryInject success.
	// User reported sections STILL visible — most likely cause: LuCI 26.x
	// overview view emits DHCP sections AFTER our initial scan(load.then()
	// rendering is staged in chunks),OR the section wrapper isn't
	// .cbi-section but something else (cbi-map / fieldset / bare div).
	//
	// Step 150 fix:
	//   1. Broader heading selectors (legend, .cbi-section-title, etc)
	//   2. Walk UP parentElement to find any plausible section container
	//      (cbi-section / cbi-map / fieldset). Fallback: hide heading +
	//      immediate next sibling (catches 'h2 + table' bare emission).
	//   3. MutationObserver on #view for 10s to catch async section
	//      additions.
	//   4. console.debug + tag with data-design-hidden attribute so the
	//      user can verify in DevTools.
	startHideUpstreamDhcp: function () {
		var self = this;
		this.hideUpstreamDhcpSections();
		var view = document.getElementById('view');
		if (!view || typeof MutationObserver === 'undefined') return;
		var observer = new MutationObserver(function () {
			self.hideUpstreamDhcpSections();
		});
		observer.observe(view, { childList: true, subtree: true });
		// Disconnect after 10s — by then LuCI has finished all staged renders.
		setTimeout(function () { observer.disconnect(); }, 10000);
	},

	hideUpstreamDhcpSections: function () {
		var view = document.getElementById('view');
		if (!view) return;
		// Broad heading-like selector — catches h1-h4, legend (fieldset
		// title), .cbi-section-title, .cbi-section-descr (some LuCI builds
		// put the title in a descr element).
		var headings = view.querySelectorAll(
			'h1, h2, h3, h4, legend, .cbi-section-title, .cbi-section-descr'
		);
		var matched = 0;
		for (var i = 0; i < headings.length; i++) {
			var h = headings[i];
			if (h.dataset && h.dataset.designHidden) continue;   // already done
			var text = (h.textContent || '').trim();
			if (!/DHCP.*Leases/i.test(text)) continue;

			// Walk up to find any section-like container.
			var target = null;
			var node = h;
			while (node && node !== view && node !== document.body) {
				if (node.classList && (
					node.classList.contains('cbi-section') ||
					node.classList.contains('cbi-map') ||
					node.tagName === 'FIELDSET'
				)) {
					target = node;
					break;
				}
				node = node.parentElement;
			}

			if (target) {
				target.style.display = 'none';
				target.dataset.designHidden = '1';
				matched++;
			} else {
				// Fallback:hide the heading + the immediately following
				// sibling (typical pattern:<h2>Active DHCP Leases</h2>
				// <table>...</table> with no wrapper).
				h.style.display = 'none';
				h.dataset.designHidden = '1';
				var next = h.nextElementSibling;
				if (next) {
					next.style.display = 'none';
					next.dataset.designHidden = '1';
				}
				matched++;
			}
		}
		// Round 43 Step 188 — Bug #7 (Chrome-Claude). The log was firing
		// on every MutationObserver poll, spamming the console with the
		// same message 12+ times. The hide-logic itself is already
		// idempotent (we `continue` if data-design-hidden is set), so
		// `matched` settles to 0 after the first sweep — but a quiet
		// console is non-negotiable polish. Gate behind window.designDebug
		// and a one-shot flag so even on first run we log at most once.
		if (matched && !this._dhcpHideLogged && window.designDebug && window.console && console.debug) {
			console.debug('[design] hid ' + matched + ' upstream DHCP section(s)');
			this._dhcpHideLogged = true;
		}
	},

	injectCard: function () {
		// Step 93 (Round 17): pixel-parity rewrite to preview A2.
		// Outer card unchanged; inside it: head row (icon + title + count)
		// followed by a .devices-table containing a column-header strip
		// and the rows container. Rows themselves emit a 6-col grid
		// (.devices-summary) keyed off the same template-columns as the
		// header so labels align with values column-for-column.
		var card = E('div', { 'class': 'devices-card', 'id': 'devices-card' }, [
			E('div', { 'class': 'devices-head' }, [
				svgEl('svg', { 'class': 'svg-icon devices-icon', 'aria-hidden': 'true' },
					svgUse(this.iconBase + '#i-user')),
				E('span', { 'class': 'devices-title' }, _('Clients')),
				E('span', { 'class': 'devices-count', 'id': 'devices-count' }, '')
			]),
			E('div', { 'class': 'devices-table' }, [
				// Step 235 (Round 45): thead cells built via helper so
				// click-to-sort + arrow indicator + active class can be
				// rebuilt on toggleSort without DOM surgery.
				E('div', { 'class': 'devices-thead' }, this.buildHeaderCells()),
				E('div', { 'class': 'devices-rows', 'id': 'devices-rows' }, [
					E('div', { 'class': 'devices-empty' }, _('Loading...'))
				])
			])
		]);
		document.getElementById('view').appendChild(card);
	},

	refresh: function () {
		var self = this;
		// Step 94 (Round 17) + Step 218 (Round 44): parallel fetch DHCP
		// leases + Wi-Fi stations + host presence map. All three are
		// optional — missing data falls through to safer defaults:
		//   - no leases → empty list with "Unable to read DHCP leases"
		//   - no wifi   → "Wired" pill for all
		//   - no presence → fall back to lease.expires (Round 38 path)
		// list-blocks: only fetch once at startup, local actions mutate the cached map.
		if (!this._pBlockedMacs) {
			this._pBlockedMacs = fetchBlockedMacs().catch(function () {
				self._pBlockedMacs = null;
				return {};
			});
		}

		return Promise.all([
			getDHCPLeases().then(function (d) { return d; }, function () { return null; }),
			fetchWifiStations(),
			fetchHostPresence(),
			getHostHints().then(function (d) { return d; }, function () { return null; }),
			this._pBlockedMacs
		]).then(function (results) {
			var leasesData = results[0];
			var wifiData   = results[1];
			var presence   = results[2];
			var hintsData  = results[3];
			var blockedMap = results[4];

			if (!leasesData) {
				var rowsEl = document.getElementById('devices-rows');
				if (!rowsEl) return;
				rowsEl.innerHTML = '';
				rowsEl.appendChild(E('div', { 'class': 'devices-empty' },
					_('Unable to read DHCP leases')));
				return;
			}

			var leases = (leasesData.dhcp_leases || leasesData['dhcp_leases']) || [];
			if (leasesData.dhcp6_leases) leases = leases.concat(leasesData.dhcp6_leases);

			self.stations = buildStationMap(wifiData);
			// host-presence returns { hosts: { "AABBCC...": {...} } } or
			// null. Reduce to just the inner map so buildRow can look up
			// by MAC directly. Null-safe: empty object if absent.
			self.presence = (presence && presence.hosts) ? presence.hosts : {};
			// Step 234 — host-hints is keyed by MAC (lowercase with colons).
			// Normalise to UPPERCASE for consistency with everywhere else.
			// Schema (LuCI 26): { "aa:bb:cc:dd:ee:ff": { name, ipv4, ipv6,
			//                     ip6addrs:[...], ip4addr, ipv6s:[...], ... } }
			self.hintsByMac = {};
			if (hintsData) {
				Object.keys(hintsData).forEach(function (k) {
					self.hintsByMac[k.toUpperCase()] = hintsData[k];
				});
			}
			// Step 243 — blockedMap already keyed by uppercase MAC.
			self.blockedMacs = blockedMap || {};
			self._lastLeases = leases;
			self.render(leases);
		});
	},

	render: function (leases) {
		var rowsEl  = document.getElementById('devices-rows');
		var countEl = document.getElementById('devices-count');

		// Dedupe by MAC (handle v4+v6 from same client)
		var byMac = {};
		leases.forEach(function (l) {
			var mac = (l.macaddr || l.mac || '').toUpperCase();
			if (!mac) return;
			if (!byMac[mac]) byMac[mac] = l;
		});
		var unique = Object.keys(byMac).map(function (m) { return byMac[m]; });

		// Step 235 (Round 45) — sort by current sortState. Comparators live
		// at module top; this here only dispatches and negates for desc.
		// Step 237: ctx carries presence map alongside customNames so the
		// lease (= Last Seen) comparator can sort by host-presence
		// inactivity instead of lease.expires.
		var cmp = SORT_COMPARATORS[this.sortState.col] || SORT_COMPARATORS.name;
		var self = this;
		var ctx  = { customNames: self.customNames, presence: self.presence };
		unique.sort(function (a, b) {
			var r = cmp(a, b, ctx);
			return self.sortState.dir === 'desc' ? -r : r;
		});

		countEl.textContent = unique.length ? '(' + unique.length + ')' : '';

		if (!unique.length) {
			rowsEl.innerHTML = '';
			rowsEl.appendChild(E('div', { 'class': 'devices-empty' }, _('No clients')));
			return;
		}

		var activeMac = null;
		if (document.activeElement && document.activeElement.getAttribute('data-mac')) {
			activeMac = document.activeElement.getAttribute('data-mac');
		}

		// Step 44: build all rows ONCE with detail embedded, then toggle a
		// class on click — no DOM rebuild on every expand.
		rowsEl.innerHTML = '';
		unique.forEach(function (l) {
			rowsEl.appendChild(self.buildRow(l));
		});

		if (activeMac) {
			var toFocus = rowsEl.querySelector('[data-mac="' + activeMac + '"]');
			if (toFocus && toFocus.focus) toFocus.focus();
		}

		// Step 235: refresh header indicators (arrows / active class)
		// in case sortState changed since last render.
		this.updateHeaderIndicators();
	},

	// Step 235 — clickable column headers. Three columns sortable:
	// name / ip / lease (MAC + Signal are not sortable — Signal's
	// "—" rows would clump in any direction, and MAC string sort
	// has no user value vs. the existing name+OUI grouping).
	buildHeaderCells: function () {
		return [
			// Name spans icon + name columns (grid-column: 1/3 in CSS).
			this.headerCell('name',  _('Device'), 'devices-col-name'),
			this.headerCell('ip',    _('IP'),     'devices-col-ip'),
			// MAC column promoted main-row in Step 148; left non-sortable.
			E('span', { 'class': 'devices-col-mac' }, _('MAC')),
			E('span', { 'class': 'devices-col-sig' }, _('Signal')),
			// Step 237 (Round 45): column header "Lease" → "Last Seen".
			// Data shown has been presence-based since Step 218
			// (formatPresence: "Active" / "Xs" / "Xm" / "Offline").
			// Header label finally catches up to the data source.
			// sortState key stays 'lease' for localStorage compatibility
			// with Step 235 saves.
			this.headerCell('lease', _('Last Seen'),  'devices-col-seen'),
			E('span', { 'class': 'devices-col-chev' }, '')
		];
	},

	headerCell: function (col, label, className) {
		var self = this;
		var isActive = this.sortState.col === col;
		var arrow    = isActive ? (this.sortState.dir === 'asc' ? '↑' : '↓') : '';
		var classes  = className + ' devices-col-sortable' + (isActive ? ' active' : '');
		return E('span', {
			'class':       classes,
			'role':        'button',
			'tabindex':    '0',
			'aria-sort':   isActive ? (this.sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none',
			'data-col':    col,
			'click':       function () { self.toggleSort(col); },
			'keydown':     function (e) {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					self.toggleSort(col);
				}
			}
		}, [
			E('span', { 'class': 'devices-col-label' }, label),
			E('span', { 'class': 'devices-col-arrow' }, arrow)
		]);
	},

	toggleSort: function (col) {
		if (this.sortState.col === col) {
			this.sortState = { col: col, dir: this.sortState.dir === 'asc' ? 'desc' : 'asc' };
		} else {
			this.sortState = { col: col, dir: 'asc' };
		}
		saveSortState(this.sortState);
		// Re-render from cached leases — instant, no network round-trip.
		// Header gets rebuilt inside render() via updateHeaderIndicators.
		if (this._lastLeases) this.render(this._lastLeases);
	},

	// Rewrite the thead row in place to refresh active class + arrow.
	// Called from render() so click → toggleSort → render → indicator
	// update happens atomically with row re-sort.
	updateHeaderIndicators: function () {
		var theadEl = document.querySelector('.devices-thead');
		if (!theadEl) return;
		theadEl.innerHTML = '';
		var self = this;
		this.buildHeaderCells().forEach(function (c) { theadEl.appendChild(c); });
	},

	buildRow: function (l) {
		var self    = this;
		var mac     = (l.macaddr || l.mac || '').toUpperCase();
		var type    = inferType(l.hostname);
		var vendor  = ouiVendor(mac);
		// Step 141 (Round 38):show full IP not just .last_octet. After
		// the grid rebalance below, IP column has enough space for the full
		// dotted quad. Last-octet alone (".100") couldn't disambiguate on
		// networks with multiple LAN segments (double NAT, /16 LAN, etc.)
		var ipFull = l.ipaddr || '';
		var isOpen  = self.expanded[mac] === true;
		// Round 44 Step 218: presence-aware seen text. Looks up MAC
		// (uppercase, no colons) in the host-presence map (filled by
		// refresh() from rpcd host-presence). Falls through to lease-
		// based formatLastSeen when no presence info is available.
		var macKey  = mac.replace(/:/g, '');
		var seen    = formatPresence(self.presence, macKey, l);

		// Resolve display name: user override (Step 44) > DHCP hostname >
		// vendor "device" > "Unknown device".
		var displayName = self.customNames[mac]
			|| l.hostname
			|| (vendor ? vendor + ' ' + _('device') : _('Unknown device'));

		// Step 93/94 (Round 17): if this MAC appears in the Wi-Fi station
		// map (built from /cgi-bin/design/wifi-stations on refresh), render
		// signal-bars + dBm. Otherwise the client is wired or the router
		// has no Wi-Fi — show the "Wired" pill. The map lookup is O(1) so
		// rendering N rows stays linear.
		var wifi = self.stations && self.stations[mac];
		var sigCell;
		if (wifi) {
			var dBm = wifi.station && wifi.station.signal;
			var barsClass = ('devices-sig-bars ' + signalToBarsClass(dBm)).trim();
			sigCell = E('span', { 'class': 'devices-row-sig' }, [
				E('span', { 'class': barsClass }, [
					E('span'), E('span'), E('span'), E('span')
				]),
				E('span', { 'class': 'devices-sig-db' }, (dBm != null ? dBm + 'dBm' : ''))
			]);
		} else {
			sigCell = E('span', { 'class': 'devices-row-sig' }, [
				E('span', { 'class': 'devices-sig-wired' }, _('Wired'))
			]);
		}

		var seenCell = E('span', {
			'class': 'devices-row-seen ' + (seen.stale ? 'devices-seen-stale' : 'devices-seen-online')
		}, seen.text);

		// Step 243 (Round 46): Blocked state. Lookup is O(1) against the
		// uppercase-MAC map populated in refresh() from list-blocks RPC.
		var isBlocked = !!self.blockedMacs[mac];

		return E('div', {
			'role':     'button',
			'tabindex': '0',
			'class':    'devices-row' + (isOpen ? ' devices-row-expanded' : '')
			            + (seen.stale ? ' devices-row-offline' : '')
			            + (isBlocked ? ' devices-row-blocked' : ''),
			'data-mac': mac,
			'click': function (e) {
				// Don't toggle when an action button (or anything inside it)
				// was clicked. closest() walks up the tree.
				if (e.target.closest && e.target.closest('.devices-action')) return;
				self.toggleRow(mac);
			},
			'keydown': function (e) {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					if (e.target.closest && e.target.closest('.devices-action')) return;
					self.toggleRow(mac);
				}
			}
		}, [
			E('div', { 'class': 'devices-summary' }, [
				// Step 93: icon now sits inside a 32×32 rounded box that
				// changes background on hover / expand — matches preview.
				// Step 243: red dot overlaid on top-right corner when MAC is
				// blocked. position: absolute inside .devices-icon-wrap.
				// Step 249 (Round 47 hotfix): build the children array
				// imperatively and push the dot ONLY when blocked. LuCI's
				// E() helper does NOT skip null entries in the children
				// array — it stringifies null and inserts a literal "null"
				// text node. So `[ svg, isBlocked ? E(...) : null ]` was
				// rendering the word "null" next to the icon on every
				// unblocked device. The `if (...) push` pattern matches
				// what the rest of devices.js already does for conditional
				// children (e.g. Step 180 lbl.secondary handling). Memory:
				// [[luci-e-helper-no-null-skip]].
				(function () {
					var iconKids = [
						svgEl('svg', { 'class': 'svg-icon devices-row-icon', 'aria-hidden': 'true' },
							svgUse(self.iconBase + '#' + type.icon))
					];
					if (isBlocked) {
						iconKids.push(E('span', {
							'class': 'devices-row-blocked-dot',
							'aria-label': _('Blocked'),
							'title': _('Blocked — all traffic dropped')
						}));
					}
					return E('div', { 'class': 'devices-icon-wrap' }, iconKids);
				})(),
				E('span', { 'class': 'devices-row-name', 'data-mac': mac }, displayName),
				E('span', { 'class': 'devices-row-ip' }, ipFull || '—'),
				// Step 148 (Round 40):MAC in main row, mono/tabular like IP
				E('span', { 'class': 'devices-row-mac' }, mac || '—'),
				sigCell,
				seenCell,
				svgEl('svg', { 'class': 'svg-icon devices-row-chev', 'aria-hidden': 'true' },
					svgUse(self.iconBase + '#i-arrow-down'))
			]),
			// Detail is always in DOM — max-height transition handles the
			// visual collapse/expand. Cheaper than rebuilding rows on each
			// click.
			E('div', { 'class': 'devices-row-detail' }, [
				E('div', { 'class': 'devices-detail-grid' },
					self.detailCellsFor(l, mac, type, wifi)
				),
				E('div', { 'class': 'devices-actions' }, [
					// Step 142 (Round 38) + Step 148 (Round 40):5-level stake
					// hierarchy by color, with new 'Set Static' button slotted
					// between Whitelist and Limit (config-permanent but
					// non-destructive). Set Static navigates to LuCI's DHCP
					// configuration page — Overview was the wrong place to do
					// inline static-lease config (too much chrome for a single
					// MAC binding), but Overview IS the right place to launch
					// from. The → suffix signals 'this leaves Overview'.
					self.actionBtn('btn-ghost',     _('Rename'),       function () { self.actionRename(mac, displayName); }),
					// Step 245 (Round 46 close-out): Whitelist button removed.
					// Round 46 honest review found 4 disqualifying reasons:
					//   1. MAC randomization (iPhone / Android 10+ / modern
					//      macOS rotate MACs per-SSID, sometimes every 24h)
					//      directly defeats the mechanism — legitimate
					//      device reconnects get blocked.
					//   2. Security ≈ 0: any passive sniffer can spoof a
					//      whitelisted MAC in 30 seconds. WPA3 password is
					//      the real gate.
					//   3. Functional duplicate of Block in inverse form,
					//      with 100× maintenance burden (every new family
					//      device needs explicit allow).
					//   4. LuCI ships this already: Network → Wireless →
					//      <SSID> → MAC Filter is the standard path; no
					//      reason for theme to duplicate.
					// Memory entries warn against "deferred placeholder"
					// drift (Step 244's "delete > toast > redirect" reasoning).
					// Whitelist follows Limit out the door.
					self.actionBtn('btn-secondary', _('Set Static') + ' →', function () { window.location.href = L.url('admin/network/dhcp'); }),
					// Step 244 (Round 46): Limit button removed entirely.
					// Round 46 verification confirmed tc is not in IW24.10's
					// default install + nft `limit rate` is policing-not-
					// shaping (TCP retransmit-heavy UX). The feature has no
					// shippable path within this theme. Users who want
					// per-device shaping should install sqm-scripts; that's
					// a separate concern handled by its own LuCI page, not
					// something this theme should fake. Earlier Step 243
					// kept a Limit button with a redirect toast; user
					// feedback after Block landed was "去掉吧" — the toast
					// itself was creating noise without value.
					// Step 243: Block is now a real two-state button.
					// - Not blocked → btn-danger, label "Block", modal confirm
					//   then block-mac RPC, refresh on success
					// - Blocked     → btn-ghost, label "Unblock", no confirm
					//   (Unblock is restorative; immediate apply is the
					//   right UX), unblock-mac RPC, refresh on success
					isBlocked
						? self.actionBtn('btn-ghost', _('Unblock'), function () { self.actionUnblock(mac, displayName); })
						: self.actionBtn('btn-danger', _('Block'),  function () { self.actionBlock(mac, displayName); })
				])
			])
		]);
	},

	// Step 93 (Round 17): each detail cell now uses semantic dt/dd inside a
	// wrapper div (matches preview structure). Pass mono=true for values
	// that should render in --font-mono (IP, MAC, etc.) — the CSS keys off
	// `.mono` on the dd to apply tabular-nums + mono font.
	detailCell: function (label, value, mono) {
		return E('div', { 'class': 'devices-detail-cell' }, [
			E('dt', {}, label),
			E('dd', mono ? { 'class': 'mono' } : {}, value)
		]);
	},

	// Step 94 (Round 17): build the variable-length cell list for the
	// detail grid. Wired clients get 6 cells; Wi-Fi clients get 7 (extra
	// Rate row showing rx/tx Mbps). Lease-expires always last so the
	// grid's auto-fit wraps the optional Rate cell into the natural slot.
	//
	// Round 44 Step 204: Vendor cell now uses vendor.js's async lookup
	// against the Wireshark manuf DB (~39K MA-L entries) instead of
	// devices.js's hardcoded 35-entry OUI table. Renders a placeholder
	// initially, swaps in the real vendor name once vendor.lookup()
	// resolves (usually < 5ms after preload completes — cached singleton
	// + sessionStorage hit on repeat page views).
	//
	// Bit detection (Multicast / LAA / UAA) is fully delegated to
	// vendor.js per doc/macvendor.md §七 #10 — devices.js NEVER does
	// `octet1 & 0x02` etc. The lookup() return string is what the cell
	// shows verbatim.
	detailCellsFor: function (lease, mac, type, wifi) {
		var vendorDd = E('dd', {}, '…');  // hook for async update
		var vendorCell = E('div', { 'class': 'devices-detail-cell' }, [
			E('dt', {}, _('Vendor')),
			vendorDd
		]);
		L.require('design-x.vendor').then(function (v) {
			// hostHintVendor is null today (ImmortalWrt 24.10 doesn't expose
			// it). Future-proofing per doc/macvendor.md §一.五: if upstream
			// ever surfaces lease.vendor via getHostHints, pass it here as
			// 2nd arg. Zero re-architecture needed.
			v.lookup(mac, null).then(function (name) {
				vendorDd.textContent = name + ' (' + mac.substr(0, 8) + ')';
			});
		});
		var cells = [
			this.detailCell(_('Full IP'),    lease.ipaddr || '—', /*mono*/ true),
			this.detailCell(_('MAC'),        mac || '—',          /*mono*/ true),
			vendorCell,
			this.detailCell(_('Type'),       type.label)
		];

		// Step 243 (Round 46): if this MAC is in the blocked set, surface
		// a prominent status badge as the first row after the basics. The
		// badge is monochrome red text "Blocked · all traffic dropped" so
		// it reads in the expand panel without needing a colored chip.
		if (this.blockedMacs[mac]) {
			var blockedDd = E('dd', { 'class': 'devices-blocked-badge' }, [
				E('span', { 'class': 'devices-blocked-dot' }),
				_('Blocked') + ' · ' + _('all traffic dropped')
			]);
			cells.push(E('div', { 'class': 'devices-detail-cell devices-detail-cell-blocked' }, [
				E('dt', {}, _('Status')),
				blockedDd
			]));
		}

		// Step 234 (Round 45) — IPv6 addresses, one line per address.
		// getHostHints aggregates SLAAC + DHCPv6 + link-local + NDP-seen
		// addresses per MAC; modern dual-stack hosts commonly hold 2-3.
		// dhcp6_leases only carries the dnsmasq-assigned one. Fall back to
		// the singular `ipv6` field if `ip6addrs` array isn't present
		// (older LuCI builds).
		var hint = this.hintsByMac[mac];
		var v6Addrs = (hint && hint.ip6addrs && hint.ip6addrs.length) ? hint.ip6addrs
		            : (hint && hint.ipv6) ? [hint.ipv6]
		            : [];
		if (v6Addrs.length) {
			var v6Lines = v6Addrs.map(function (a) {
				return E('div', { 'class': 'devices-detail-ipv6-line' }, a);
			});
			cells.push(E('div', { 'class': 'devices-detail-cell devices-detail-cell-ipv6' }, [
				E('dt', {}, _('IPv6')),
				E('dd', { 'class': 'mono' }, v6Lines)
			]));
		}

		if (wifi) {
			cells.push(this.detailCell(_('Connection'),
				formatWifiConnection(wifi.info, wifi.station)));
			var rxKbps = wifi.station && wifi.station.rx && wifi.station.rx.rate;
			var txKbps = wifi.station && wifi.station.tx && wifi.station.tx.rate;
			if (rxKbps || txKbps) {
				cells.push(this.detailCell(_('Rate'),
					_('Rx') + ' ' + formatRateKbps(rxKbps) + ' · ' +
					_('Tx') + ' ' + formatRateKbps(txKbps)));
			}
		} else {
			cells.push(this.detailCell(_('Connection'), _('Wired')));
		}

		// Step 140 (Round 38):lease.expires is REMAINING SECONDS, not Unix
		// epoch. To show "when this lease expires" as an absolute time,
		// add expires*1000 ms to current time. Step 93's
		// `new Date(expires*1000)` was wrong — produced 1970 dates.
		cells.push(this.detailCell(_('Lease expires'), lease.expires > 0
			? new Date(Date.now() + lease.expires * 1000).toLocaleString()
			: _('static / no expiry')));

		return cells;
	},

	// Step 93 → Step 142 (Round 38):button factory.
	// `variantClass` is one of the project's .btn-* design-system classes
	// (.btn-ghost / .btn-secondary / .btn-warning / .btn-danger / etc.) —
	// changed from the old LuCI .cbi-button-{kind} convention so the LAN
	// Clients card can express a 4-level stake hierarchy (ghost → danger)
	// using the canonical button vocabulary, not LuCI's old action/negative
	// binary.
	actionBtn: function (variantClass, label, onClick) {
		return E('button', {
			'type':  'button',
			'class': 'btn ' + variantClass + ' devices-action',
			'click': function (e) {
				e.stopPropagation();
				onClick();
			}
		}, label);
	},

	toggleRow: function (mac) {
		this.expanded[mac] = !this.expanded[mac];
		var row = document.querySelector('.devices-row[data-mac="' + mac + '"]');
		if (row) row.classList.toggle('devices-row-expanded', this.expanded[mac]);
	},

	// Step 152 (Round 40):rename device system-wide via UCI /etc/config/dhcp.
	//
	// Old behavior (Step 44):only wrote to localStorage — per-browser cache,
	// invisible to dnsmasq, doesn't affect DHCP lease names or DNS resolution.
	// Multiple browsers / clearing localStorage → name lost.
	//
	// New behavior:also writes to /etc/config/dhcp as a `config host` section
	// with just `mac + name` (NO ip — that's what Set Static is for, keeping
	// Rename a lightweight name-only operation distinct from full static
	// lease binding). After uci.save() + uci.apply(), dnsmasq reloads and:
	//   - DHCP serves the new name (Option 12 override) for that MAC
	//   - DNS resolves `<newname>.lan` to the device's IP
	//   - Any /admin/network/dhcp page shows the static name entry
	//
	// Optimistic UI: localStorage + DOM update fires immediately (so the
	// rename feels instant), and UCI roundtrip (~1-3s including dnsmasq
	// reload) happens in background. If UCI fails, we roll back the DOM +
	// localStorage and toast the error.
	//
	// Side effect to document: uci.apply() commits ALL pending UCI changes,
	// not just ours. Overview users typically have none, but worth knowing.
	actionRename: function (mac, currentName) {
		var self = this;
		// Step 153 (Round 40 patch 3):the prompt label includes hostname
		// rules so users can choose a valid name from the start. Step 152's
		// silent acceptance of "MacBook Pro A" crashed dnsmasq for 7 hours;
		// the explicit hint here pairs with sanitizeHostname() below.
		var raw = window.prompt(
			_('Rename device') + ' — ' + _('letters, digits, hyphens only') +
			'\n(' + _('e.g.') + ' MacBook-Pro-A) — ' + mac,
			currentName
		);
		if (raw === null) return;              // cancelled
		raw = raw.trim();

		// Step 153:sanitize. Caller may have typed spaces / unicode / etc.;
		// sanitizeHostname strips to dnsmasq-acceptable form. Empty input is
		// preserved (means "clear the override") but raw-non-empty that
		// sanitizes to empty is rejected with toast (e.g. all-emoji input).
		var next = raw === '' ? '' : sanitizeHostname(raw);

		if (raw !== '' && next === '') {
			toastSafe('error',
				_('Invalid hostname — use letters, digits, and hyphens only'));
			return;
		}
		if (next === currentName) return;      // no-op (also catches "trimmed = same")

		if (next !== raw && next !== '') {
			// Inform user that we changed the input. They see the new name
			// in the prompt's success toast below; this preview tells them
			// the rule was applied.
			toastSafe('info', _('Saving as') + ' "' + next + '"');
		}

		// ── 1. Optimistic UI: instant DOM + localStorage update ─────────────
		var prevCustom = this.customNames[mac];   // capture for rollback
		if (next === '') {
			delete this.customNames[mac];
		} else {
			this.customNames[mac] = next;
		}
		saveCustomNames(this.customNames);
		var nameEl = document.querySelector('.devices-row-name[data-mac="' + mac + '"]');
		if (nameEl) nameEl.textContent = next || mac;
		toastSafe('info', _('Renaming…'));

		// ── 2. Persist to UCI /etc/config/dhcp ──────────────────────────────
		// Find existing `config host` section for this MAC, or create one.
		// Empty `next` means user wants to remove the override — delete the
		// section if it has ONLY mac + name (no ip/dns/etc that suggest a
		// real static lease the user set elsewhere).
		uci.load('dhcp').then(function () {
			var sections = uci.sections('dhcp', 'host');
			var macLower = mac.toLowerCase();
			var existingSid = null;

			for (var i = 0; i < sections.length; i++) {
				var macField = sections[i].mac;
				var macs = Array.isArray(macField) ? macField : (macField ? [macField] : []);
				for (var k = 0; k < macs.length; k++) {
					if ((macs[k] || '').toLowerCase() === macLower) {
						existingSid = sections[i]['.name'];
						break;
					}
				}
				if (existingSid) break;
			}

			if (next === '') {
				if (existingSid) {
					var s = sections.find(function (x) { return x['.name'] === existingSid; }) || {};
					var keys = Object.keys(s).filter(function (k) { return k.charAt(0) !== '.'; });
					var onlyMacName = keys.every(function (k) { return k === 'mac' || k === 'name'; });
					if (onlyMacName) {
						uci.remove('dhcp', existingSid);
					} else {
						uci.unset('dhcp', existingSid, 'name');
					}
				}
			} else if (existingSid) {
				uci.set('dhcp', existingSid, 'name', next);
			} else {
				var sid = uci.add('dhcp', 'host');
				uci.set('dhcp', sid, 'mac', mac);
				uci.set('dhcp', sid, 'name', next);
			}
			return uci.save();
		}).then(function () {
			// uci.apply() commits to running config + reloads dnsmasq.
			// Side effect: also commits ANY other pending UCI changes.
			return uci.apply();
		}).then(function () {
			toastSafe('success', next
				? _('Renamed system-wide') + ' → ' + next
				: _('Custom name cleared'));
		}).catch(function (err) {
			// ── 3. Rollback optimistic UI on failure ────────────────────────
			if (prevCustom === undefined) {
				delete self.customNames[mac];
			} else {
				self.customNames[mac] = prevCustom;
			}
			saveCustomNames(self.customNames);
			if (nameEl) nameEl.textContent = prevCustom || currentName;
			toastSafe('error', _('Rename failed') + ': ' +
				(err && err.message ? err.message : String(err)));
		});
	},

	// Step 243 (Round 46): Block button click handler.
	// Modal confirms before the destructive RPC. Pattern mirrors the
	// Reboot modal in quick-actions.js — `L.ui.showModal(title, [body])`
	// with Cancel / confirm buttons. Confirmation copy is honest about
	// what Block actually does: drops ALL traffic to/from this MAC
	// (forward + input + output hooks). User can undo via Unblock.
	actionBlock: function (mac, displayName) {
		var self = this;
		var ui   = L.ui;
		if (!ui || typeof ui.showModal !== 'function') {
			// Defensive fallback if a future LuCI version drops ui.showModal:
			// skip confirm and go straight to the RPC. Better that than a
			// silent no-op that surprises the user.
			return self._doBlock(mac, displayName);
		}
		var macKey = String(mac).toUpperCase().replace(/:/g, '');
		var isMgmt = self.presence[macKey] && self.presence[macKey].is_mgmt;
		var warningTitle = isMgmt ? _('Block your own device?') : _('Block this device?');
		var warningBody = isMgmt ?
			E('p', { 'style': 'color: var(--color-danger); font-weight: bold;' }, _('WARNING: This device appears to be the one you are currently using to manage the router. If you block it, you will immediately lose access to this admin page and may need to use a different device or SSH to unblock it!')) :
			E('p', {}, _('All network traffic to and from %s will be dropped immediately. The device will lose internet access and cannot reach the router admin page.').replace('%s', '“' + displayName + '”'));

		ui.showModal(warningTitle, [
			warningBody,
			E('p', { 'class': 'devices-modal-mac' }, mac),
			E('p', {}, _('You can undo this from the Clients card later by clicking Unblock on the same row.')),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'cbi-button',
					'click': ui.hideModal
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-negative',
					'click': function () {
						ui.hideModal();
						self._doBlock(mac, displayName);
					}
				}, _('Block'))
			])
		]);
	},

	_doBlock: function (mac, displayName) {
		var self = this;
		toastSafe('info', _('Blocking %s …').replace('%s', displayName));
		callBlockMac(mac).then(function (r) {
			if (r && r.error) {
				toastSafe('error', _('Block failed') + ': ' + r.error);
				return;
			}
			toastSafe('success', _('Blocked') + ' ' + displayName);
			// Optimistic state update + immediate re-render. Also kicks a
			// real refresh() so list-blocks is re-fetched from kernel.
			self.blockedMacs[mac] = true;
			self._pBlockedMacs = null; // Force fetch on next refresh
			self.refresh();
		}).catch(function (err) {
			toastSafe('error', _('Block failed') + ': ' +
				(err && err.message ? err.message : String(err)));
		});
	},

	// Unblock is restorative (re-enables traffic). No confirm modal —
	// immediate apply is the right UX. A botched click is fine: it just
	// lets a previously-blocked device back online, no destructive side
	// effect.
	actionUnblock: function (mac, displayName) {
		var self = this;
		toastSafe('info', _('Unblocking %s …').replace('%s', displayName));
		callUnblockMac(mac).then(function (r) {
			if (r && r.error) {
				toastSafe('error', _('Unblock failed') + ': ' + r.error);
				return;
			}
			toastSafe('success', _('Unblocked') + ' ' + displayName);
			delete self.blockedMacs[mac];
			self._pBlockedMacs = null; // Force fetch on next refresh
			self.refresh();
		}).catch(function (err) {
			toastSafe('error', _('Unblock failed') + ': ' +
				(err && err.message ? err.message : String(err)));
		});
	}
});
