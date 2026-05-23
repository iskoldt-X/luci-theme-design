'use strict';
'require baseclass';
'require ui';

// ─────────────────────────────────────────────────────────────────────────────
// Traffic Analysis card — upgrade.md §5.D2 (progressive enhancement)
//
// Two modes via capability.nlbw() detection (accepts both modern
// `luci-app-nlbwmon` and legacy `luci-app-nlbw` packages):
//
//   ✅ Installed:
//      → Show "Open full Traffic Analysis →" link. The URL is discovered
//        dynamically from LuCI's own menu tree (ui.menu.load), so we work
//        regardless of whether the package mounts under /admin/nlbwmon or
//        /admin/nlbw or /admin/status/realtime/* etc.
//
//   ❌ Not installed:
//      → Show a styled placeholder card recommending luci-app-nlbwmon,
//        with a one-click button to the package manager.
//
// MVP: defers actual inline data rendering (per-device bandwidth charts) —
// requires a deeper nlbwmon RPC integration that varies across distros.
// The link gets users to nlbwmon's own view which already does this well.
// Follow-up: inline top-5 consumers + 24h sparkline using nlbwmon's
// `nlbw -c csv` shell helper or its rpc surface.
// ─────────────────────────────────────────────────────────────────────────────

// Walk the LuCI menu tree looking for a node whose `name` matches a regex.
// Returns the first match's full URL path, or null. Used for nlbw/nlbwmon
// auto-discovery (URL changes between LuCI versions) and for finding the
// package manager (luci-app-opkg @19/21 → luci-app-package-manager @22+,
// where the URL went from /admin/system/opkg → /admin/system/package).
function findMenuUrl(nameRegex) {
	return L.require('ui').then(function (uiMod) {
		return uiMod.menu.load().then(function (tree) {
			var found = null;
			function walk(node, parts) {
				var kids = uiMod.menu.getChildren(node);
				for (var i = 0; i < kids.length && !found; i++) {
					var c = kids[i];
					var p = parts.concat([c.name]);
					if (nameRegex.test(c.name)) { found = p.join('/'); return; }
					walk(c, p);
				}
			}
			walk(tree, []);
			return found ? L.url(found) : null;
		});
	}).catch(function () { return null; });
}

// "Open Package Manager" target — different URL across LuCI versions:
//   LuCI 19-21    : admin/system/opkg
//   LuCI 22-24    : admin/system/package or admin/system/packages
//   ImmortalWrt   : admin/system/package (luci-app-package-manager)
// Static href risks 404. Resolve dynamically from the menu.
function findPackageManagerUrl() {
	return findMenuUrl(/^(opkg|package|packages|software)$/i);
}

function findNlbwUrl() {
	return findMenuUrl(/^nlbw/i);
}

return baseclass.extend({
	__init__: function () {
		if (!document.body.classList.contains('node-admin-status-overview')) return;
		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design') + '/icons.svg';
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
		this.detect();
	},

	injectCard: function () {
		var card = E('div', { 'class': 'traffic-card', 'id': 'traffic-card' }, [
			E('div', { 'class': 'traffic-head' }, [
				E('svg', { 'class': 'svg-icon traffic-icon', 'aria-hidden': 'true' },
					E('use', { 'href': this.iconBase + '#i-bar-chart' })),
				E('span', { 'class': 'traffic-title' }, _('Traffic Analysis'))
			]),
			E('div', { 'class': 'traffic-body', 'id': 'traffic-body' },
				E('div', { 'class': 'traffic-loading' }, _('Detecting…')))
		]);
		var view = document.getElementById('view');
		view.appendChild(card);
	},

	detect: function () {
		var self = this;
		L.require('capability').then(function (cap) {
			cap.nlbw().then(function (installed) {
				if (installed) self.renderInstalled();
				else self.renderPlaceholder();
			}).catch(function () { self.renderPlaceholder(); });
		}).catch(function () { self.renderPlaceholder(); });
	},

	renderInstalled: function () {
		var body = document.getElementById('traffic-body');
		body.innerHTML = '';
		// Two-phase render: show the static message first, then resolve the
		// real bandwidth-monitor URL via menu lookup and update the link.
		body.appendChild(E('div', { 'class': 'traffic-installed' }, [
			E('p', { 'class': 'traffic-installed-msg' },
				_('Bandwidth monitor installed. Full per-device traffic analysis available.')),
			E('a', {
				'href':  '#',
				'class': 'cbi-button cbi-button-action traffic-cta',
				'id':    'traffic-cta-link'
			}, _('Open full Traffic Analysis →'))
		]));
		// Resolve the URL asynchronously. Falls back to the package manager
		// if no nlbw menu entry exists (e.g. package installed but LuCI
		// hasn't registered the menu yet — rare but possible mid-install).
		Promise.all([findNlbwUrl(), findPackageManagerUrl()]).then(function (urls) {
			var link = document.getElementById('traffic-cta-link');
			if (link) link.setAttribute('href', urls[0] || urls[1] || L.url('admin'));
		});
	},

	renderPlaceholder: function () {
		var body = document.getElementById('traffic-body');
		body.innerHTML = '';
		body.appendChild(E('div', { 'class': 'traffic-placeholder' }, [
			E('p', { 'class': 'traffic-placeholder-msg' },
				_('This feature requires luci-app-nlbwmon (netlink bandwidth monitor).')),
			E('ul', { 'class': 'traffic-placeholder-list' }, [
				E('li', {}, _('Per-device real-time bandwidth')),
				E('li', {}, _('24h / 7-day cumulative ranking')),
				E('li', {}, _('Hourly usage timeline per device'))
			]),
			E('a', {
				'href':  '#',
				'class': 'cbi-button cbi-button-action traffic-cta',
				'id':    'traffic-opkg-link'
			}, _('Open Package Manager'))
		]));
		// Same dynamic resolution as installed path — the package manager URL
		// also varies (admin/system/opkg vs admin/system/package vs ...).
		findPackageManagerUrl().then(function (url) {
			var link = document.getElementById('traffic-opkg-link');
			if (link) link.setAttribute('href', url || L.url('admin'));
		});
	}
});
