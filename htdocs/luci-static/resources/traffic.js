'use strict';
'require baseclass';
'require ui';

// ─────────────────────────────────────────────────────────────────────────────
// Traffic Analysis card — upgrade.md §5.D2 (progressive enhancement)
//
// Two modes via capability.nlbw() detection:
//
//   ✅ luci-app-nlbw installed:
//      → Show "Open full Traffic Analysis →" link to the nlbw view +
//        attempt to fetch a top-N summary inline.
//
//   ❌ luci-app-nlbw NOT installed:
//      → Show a styled placeholder card explaining what nlbw unlocks,
//        with a one-click button to the package manager.
//
// MVP: defers actual inline data rendering (per-device bandwidth charts) —
// requires a deeper nlbw RPC integration that varies across ImmortalWrt /
// OpenWrt / Lean LuCI forks. The link gets users to nlbw's own view which
// already does this well. Follow-up: inline top-5 consumers + 24h sparkline
// using nlbw's `nlbw.cli` shell helper or its rpc surface.
// ─────────────────────────────────────────────────────────────────────────────

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
		body.appendChild(E('div', { 'class': 'traffic-installed' }, [
			E('p', { 'class': 'traffic-installed-msg' },
				_('luci-app-nlbw is installed. Full per-device bandwidth analysis available.')),
			E('a', {
				'href':  L.url('admin/nlbw/display'),
				'class': 'cbi-button cbi-button-action traffic-cta'
			}, _('Open full Traffic Analysis →'))
		]));
	},

	renderPlaceholder: function () {
		var body = document.getElementById('traffic-body');
		body.innerHTML = '';
		body.appendChild(E('div', { 'class': 'traffic-placeholder' }, [
			E('p', { 'class': 'traffic-placeholder-msg' },
				_('This feature requires luci-app-nlbw.')),
			E('ul', { 'class': 'traffic-placeholder-list' }, [
				E('li', {}, _('Per-device real-time bandwidth')),
				E('li', {}, _('24h / 7-day cumulative ranking')),
				E('li', {}, _('Hourly usage timeline per device'))
			]),
			E('a', {
				'href':  L.url('admin/system/opkg'),
				'class': 'cbi-button cbi-button-action traffic-cta'
			}, _('Open Package Manager'))
		]));
	}
});
