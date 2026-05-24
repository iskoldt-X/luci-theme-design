'use strict';
'require baseclass';
'require ui';
'require rpc';
'require uci';

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

var STORAGE_KEY = 'design-device-names-v1';

// ── Type inference by hostname keyword ────────────────────────────────────────
// First match wins. Patterns are case-insensitive regex source strings.
// Step 93 (Round 17): tightened icon mappings — iphone/ipad/android now map
// to i-phone (was i-info), printer / nas / windows-pc added. Icons drawn
// from the sprite at htdocs/luci-static/design-x/icons.svg.
var DEVICE_TYPES = [
	{ re: /macbook|imac|mac-?mini/i,                          icon: 'i-monitor',     label: 'Computer' },
	{ re: /printer|laserjet|brother|epson|canon|hp-laserjet/i, icon: 'i-server',      label: 'Printer' },
	{ re: /windows|thinkpad|surface|dell-|win[-_]?dk/i,       icon: 'i-monitor',     label: 'Computer' },
	{ re: /truenas|synology|qnap|nas$|nas[-_]/i,              icon: 'i-hard-drive',  label: 'NAS' },
	{ re: /iphone/i,                                          icon: 'i-phone',       label: 'Phone' },
	{ re: /ipad/i,                                            icon: 'i-phone',       label: 'Tablet' },
	{ re: /android|pixel|samsung[-_]?galaxy|oneplus/i,        icon: 'i-phone',       label: 'Android device' },
	{ re: /tv|bravia|webos|chromecast|firetv|appletv|lg-tv/i, icon: 'i-monitor',     label: 'TV / streamer' },
	{ re: /switch|nintendo|playstation|ps5|ps4|xbox/i,        icon: 'i-zap',         label: 'Game console' },
	{ re: /thermostat|nest|hue|aqara|tuya|sonoff|qingping/i,  icon: 'i-thermometer', label: 'IoT' },
	{ re: /camera|cam$|cam-|doorbell|ring|hikvision/i,        icon: 'i-eye',         label: 'Camera' },
	{ re: /echo|alexa|homepod|nest-?audio/i,                  icon: 'i-info',        label: 'Smart speaker' },
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

function fetchWifiStations() {
	return callWifiStations()
		.catch(function () { return null; });
}

// Flatten the per-interface assoclist responses into a single
// MAC → { iface, info, station } map for O(1) lookup by buildRow().
// info carries per-interface fields (channel, frequency, mode);
// station carries per-client fields (signal, noise, rx.rate, tx.rate, mhz).
function buildStationMap(wifiData) {
	var map = {};
	if (!wifiData || !wifiData.available || !wifiData.interfaces) return map;
	Object.keys(wifiData.interfaces).forEach(function (iface) {
		var data = wifiData.interfaces[iface] || {};
		var info = data.info || {};
		var list = (data.assoclist && data.assoclist.results) || [];
		list.forEach(function (s) {
			var mac = (s.mac || '').toUpperCase();
			if (mac) map[mac] = { iface: iface, info: info, station: s };
		});
	});
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

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function () {
		if (!document.body.classList.contains('node-admin-status-overview')) return;
		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design-x') + '/icons.svg';
		this.expanded     = {};                   // mac → bool
		this.customNames  = loadCustomNames();    // mac → string
		this.stations     = {};                   // mac → { iface, info, station } (Step 94)
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
		this._timer = setInterval(L.bind(this.refresh, this), 30000);
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
				E('span', { 'class': 'devices-title' }, _('LAN Clients')),
				E('span', { 'class': 'devices-count', 'id': 'devices-count' }, '')
			]),
			E('div', { 'class': 'devices-table' }, [
				E('div', { 'class': 'devices-thead' }, [
					// First label spans icon + name columns (see CSS rule
					// .devices-col-name { grid-column: 1 / 3 })
					E('span', { 'class': 'devices-col-name' }, _('Device')),
					E('span', { 'class': 'devices-col-ip' },   _('IP')),
					// Step 148 (Round 40):MAC column promoted from
					// detail-only to main-row visibility (LAN Clients is
					// now the canonical view, see Step 149).
					E('span', { 'class': 'devices-col-mac' },  _('MAC')),
					E('span', { 'class': 'devices-col-sig' },  _('Signal')),
					E('span', { 'class': 'devices-col-seen' }, _('Lease')),
					E('span', { 'class': 'devices-col-chev' }, '')
				]),
				E('div', { 'class': 'devices-rows', 'id': 'devices-rows' }, [
					E('div', { 'class': 'devices-empty' }, _('Loading...'))
				])
			])
		]);
		document.getElementById('view').appendChild(card);
	},

	refresh: function () {
		var self = this;
		// Step 94 (Round 17): parallel fetch DHCP leases + Wi-Fi stations.
		// Wi-Fi data is optional — its absence falls through to "Wired" pill
		// rendering, so we wrap its fetch in .catch(null) so a missing CGI
		// or network glitch doesn't blank the whole list.
		Promise.all([
			getDHCPLeases().then(function (d) { return d; }, function () { return null; }),
			fetchWifiStations()
		]).then(function (results) {
			var leasesData = results[0];
			var wifiData   = results[1];

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

		// Sort: hostname first (named clients), then by IP
		unique.sort(function (a, b) {
			var ha = a.hostname || '';
			var hb = b.hostname || '';
			if (ha && !hb) return -1;
			if (!ha && hb) return 1;
			return (a.ipaddr || '').localeCompare(b.ipaddr || '');
		});

		countEl.textContent = unique.length ? '(' + unique.length + ')' : '';

		if (!unique.length) {
			rowsEl.innerHTML = '';
			rowsEl.appendChild(E('div', { 'class': 'devices-empty' }, _('No clients')));
			return;
		}

		// Step 44: build all rows ONCE with detail embedded, then toggle a
		// class on click — no DOM rebuild on every expand.
		rowsEl.innerHTML = '';
		var self = this;
		unique.forEach(function (l) {
			rowsEl.appendChild(self.buildRow(l));
		});
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
		var seen    = formatLastSeen(l);

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

		return E('div', {
			'class':    'devices-row' + (isOpen ? ' devices-row-expanded' : '')
			            + (seen.stale ? ' devices-row-offline' : ''),
			'data-mac': mac,
			'click': function (e) {
				// Don't toggle when an action button (or anything inside it)
				// was clicked. closest() walks up the tree.
				if (e.target.closest && e.target.closest('.devices-action')) return;
				self.toggleRow(mac);
			}
		}, [
			E('div', { 'class': 'devices-summary' }, [
				// Step 93: icon now sits inside a 32×32 rounded box that
				// changes background on hover / expand — matches preview.
				E('div', { 'class': 'devices-icon-wrap' }, [
					svgEl('svg', { 'class': 'svg-icon devices-row-icon', 'aria-hidden': 'true' },
						svgUse(self.iconBase + '#' + type.icon))
				]),
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
					self.detailCellsFor(l, mac, vendor, type, wifi)
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
					self.actionBtn('btn-secondary', _('Whitelist'),    function () { toastSafe('info',    _('Whitelist is not yet implemented')); }),
					self.actionBtn('btn-secondary', _('Set Static') + ' →', function () { window.location.href = L.url('admin/network/dhcp'); }),
					self.actionBtn('btn-warning',   _('Limit'),        function () { toastSafe('info',    _('Rate limiting is not yet implemented')); }),
					self.actionBtn('btn-danger',    _('Block'),        function () { toastSafe('warning', _('Blocking is not yet implemented')); })
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
	detailCellsFor: function (lease, mac, vendor, type, wifi) {
		var cells = [
			this.detailCell(_('Full IP'),    lease.ipaddr || '—', /*mono*/ true),
			this.detailCell(_('MAC'),        mac || '—',          /*mono*/ true),
			this.detailCell(_('Vendor'),     vendor
				? (vendor + ' (' + mac.substr(0, 8) + ')')
				: _('Unknown')),
			this.detailCell(_('Type'),       type.label)
		];

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
	}
});
