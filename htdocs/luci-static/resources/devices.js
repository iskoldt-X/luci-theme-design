'use strict';
'require baseclass';
'require ui';
'require rpc';

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
var DEVICE_TYPES = [
	{ re: /macbook|imac|mac-?mini/i,                    icon: 'i-monitor',     label: 'Computer' },
	{ re: /iphone/i,                                    icon: 'i-info',        label: 'Phone' },
	{ re: /ipad/i,                                      icon: 'i-info',        label: 'Tablet' },
	{ re: /android|pixel|samsung[-_]?galaxy|oneplus/i,  icon: 'i-info',        label: 'Android device' },
	{ re: /tv|bravia|webos|chromecast|firetv|appletv/i, icon: 'i-monitor',     label: 'TV / streamer' },
	{ re: /switch|nintendo|playstation|ps5|ps4|xbox/i,  icon: 'i-info',        label: 'Game console' },
	{ re: /thermostat|nest|hue|aqara|tuya|sonoff/i,     icon: 'i-thermometer', label: 'IoT' },
	{ re: /camera|cam|doorbell|ring/i,                  icon: 'i-eye',         label: 'Camera' },
	{ re: /printer|laserjet|brother|epson|canon/i,      icon: 'i-server',      label: 'Printer' },
	{ re: /echo|alexa|homepod|nest-?audio/i,            icon: 'i-phone',       label: 'Smart speaker' }
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

// ── Custom names (Step 44) — localStorage persistence ────────────────────────
// Best-effort: lost on browser clear, doesn't sync across browsers / devices.
// UCI persistence is a follow-up (would need a new UCI section + reload-safe
// schema). The toast on save makes the boundary explicit.
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
		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design') + '/icons.svg';
		this.expanded     = {};                   // mac → bool
		this.customNames  = loadCustomNames();    // mac → string
		this.tryInject();
	},

	tryInject: function () {
		var view = document.getElementById('view');
		if (!view || !view.firstChild || view.querySelector('.spinning')) {
			if ((this._retries = (this._retries || 0) + 1) > 20) return;
			setTimeout(L.bind(this.tryInject, this), 250);
			return;
		}
		this.injectCard();
		this.refresh();
		this._timer = setInterval(L.bind(this.refresh, this), 30000);
	},

	injectCard: function () {
		var card = E('div', { 'class': 'devices-card', 'id': 'devices-card' }, [
			E('div', { 'class': 'devices-head' }, [
				svgEl('svg', { 'class': 'svg-icon devices-icon', 'aria-hidden': 'true' },
					svgUse(this.iconBase + '#i-user')),
				E('span', { 'class': 'devices-title' }, _('LAN Clients')),
				E('span', { 'class': 'devices-count', 'id': 'devices-count' }, '')
			]),
			E('ul', { 'class': 'devices-list', 'id': 'devices-list' }, [
				E('li', { 'class': 'devices-empty' }, _('Loading...'))
			])
		]);
		var view = document.getElementById('view');
		view.appendChild(card);
	},

	refresh: function () {
		var self = this;
		getDHCPLeases().then(function (data) {
			var leases = (data && (data.dhcp_leases || data['dhcp_leases'])) || [];
			// Some LuCI versions return v4/v6 separately
			if (data && data.dhcp6_leases) leases = leases.concat(data.dhcp6_leases);
			self.render(leases);
		}).catch(function () {
			document.getElementById('devices-list').innerHTML = '';
			document.getElementById('devices-list').appendChild(
				E('li', { 'class': 'devices-empty' }, _('Unable to read DHCP leases'))
			);
		});
	},

	render: function (leases) {
		var listEl = document.getElementById('devices-list');
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
			listEl.innerHTML = '';
			listEl.appendChild(E('li', { 'class': 'devices-empty' }, _('No clients')));
			return;
		}

		// Step 44: build all rows ONCE with their detail content embedded,
		// then toggle a class on click — no DOM rebuild on every expand.
		listEl.innerHTML = '';
		var self = this;
		unique.forEach(function (l) {
			listEl.appendChild(self.buildRow(l));
		});
	},

	buildRow: function (l) {
		var self    = this;
		var mac     = (l.macaddr || l.mac || '').toUpperCase();
		var type    = inferType(l.hostname);
		var vendor  = ouiVendor(mac);
		var ipShort = (l.ipaddr || '').split('.').pop();
		var isOpen  = self.expanded[mac] === true;

		// Resolve display name: user override (Step 44) > DHCP hostname >
		// vendor "device" > "Unknown device".
		var displayName = self.customNames[mac]
			|| l.hostname
			|| (vendor ? vendor + ' ' + _('device') : _('Unknown device'));

		return E('li', {
			'class':    'devices-row' + (isOpen ? ' devices-row-expanded' : ''),
			'data-mac': mac,
			'click': function (e) {
				// Don't toggle when an action button (or anything inside it)
				// was clicked. closest() walks up the tree.
				if (e.target.closest && e.target.closest('.devices-action')) return;
				self.toggleRow(mac);
			}
		}, [
			E('div', { 'class': 'devices-row-main' }, [
				svgEl('svg', { 'class': 'svg-icon devices-row-icon', 'aria-hidden': 'true' },
					svgUse(self.iconBase + '#' + type.icon)),
				E('span', { 'class': 'devices-row-name', 'data-mac': mac },
					displayName),
				E('span', { 'class': 'devices-row-ip' }, ipShort ? '.' + ipShort : '—'),
				E('span', { 'class': 'devices-row-type' }, type.label),
				// Chevron rotates 180° via CSS when expanded
				svgEl('svg', { 'class': 'svg-icon devices-row-chev', 'aria-hidden': 'true' },
					svgUse(self.iconBase + '#i-arrow-down'))
			]),
			// Detail wrapper is always in DOM — max-height transition handles
			// the visual collapse/expand. Cheaper than rebuilding rows.
			E('div', { 'class': 'devices-row-detail' }, [
				E('div', { 'class': 'devices-detail-grid' }, [
					self.detailRow(_('Full IP'),  l.ipaddr || '—'),
					self.detailRow(_('MAC'),      mac || '—'),
					self.detailRow(_('Vendor'),   vendor || _('Unknown')),
					self.detailRow(_('Lease expires'), l.expires
						? new Date(l.expires * 1000).toLocaleString()
						: _('static or expired'))
				]),
				E('div', { 'class': 'devices-actions' }, [
					E('button', {
						'type':  'button',
						'class': 'cbi-button cbi-button-action devices-action',
						'click': function (e) {
							e.stopPropagation();
							self.actionRename(mac, displayName);
						}
					}, _('Rename')),
					E('button', {
						'type':  'button',
						'class': 'cbi-button cbi-button-action devices-action',
						'click': function (e) {
							e.stopPropagation();
							toastSafe('info', _('Rate limiting is not yet implemented'));
						}
					}, _('Limit')),
					E('button', {
						'type':  'button',
						'class': 'cbi-button cbi-button-negative devices-action',
						'click': function (e) {
							e.stopPropagation();
							toastSafe('warning', _('Blocking is not yet implemented'));
						}
					}, _('Block'))
				])
			])
		]);
	},

	detailRow: function (label, value) {
		return E('div', { 'class': 'devices-detail-row' }, [
			E('span', { 'class': 'devices-detail-label' }, label),
			E('span', { 'class': 'devices-detail-value' }, value)
		]);
	},

	toggleRow: function (mac) {
		this.expanded[mac] = !this.expanded[mac];
		var row = document.querySelector('.devices-row[data-mac="' + mac + '"]');
		if (row) row.classList.toggle('devices-row-expanded', this.expanded[mac]);
	},

	actionRename: function (mac, currentName) {
		// Minimal but honest UX: native prompt + localStorage. UCI persistence
		// is a follow-up (would touch /etc/config + reload schema).
		var next = window.prompt(_('Rename this device') + ' (' + mac + ')', currentName);
		if (next === null) return;             // cancelled
		next = next.trim();
		if (next === '') {
			// Empty → clear custom name and fall back to DHCP/vendor
			delete this.customNames[mac];
		} else {
			this.customNames[mac] = next;
		}
		saveCustomNames(this.customNames);

		// Update the visible name in-place (no full re-render)
		var nameEl = document.querySelector('.devices-row-name[data-mac="' + mac + '"]');
		if (nameEl) nameEl.textContent = next || mac;

		toastSafe('success', _('Saved (this browser only — UCI persistence coming later)'));
	}
});
