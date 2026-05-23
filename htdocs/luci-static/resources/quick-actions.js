'use strict';
'require baseclass';
'require ui';
'require rpc';
'require fs';

// ─────────────────────────────────────────────────────────────────────────────
// Quick Actions popover — upgrade.md §2.A3
//
// Header lightning-bolt button → dropdown with common one-click operations.
// Step 51: rebuilt to match upgrade-preview.html §A3:
//   - Pending changes pill at the top (warning bg + Apply button), only
//     visible when L.uci.changes() reports pending entries
//   - Four action rows with icons: Restart Wi-Fi / Renew DHCP /
//     Reload firewall / Run speedtest
//   - Divider
//   - Reboot router (red, with confirm modal)
//
// The dropdown is rebuilt on every open() so the pending count refreshes
// without needing a separate uci.changes subscription.
//
// z-index bumped from var(--z-overlay) (40) to a guaranteed-on-top 9999
// because the cbi-section grid's stacking context was painting over the
// popover on some layouts (user-reported bug).
// ─────────────────────────────────────────────────────────────────────────────

var execShell = rpc.declare({
	object: 'file',
	method: 'exec',
	params: ['command', 'params'],
	expect: { code: 0 }
});

function toast(type, msg) {
	if (window.toast && window.toast[type]) return window.toast[type](msg);
	if (console && console[type === 'error' ? 'error' : 'log']) {
		console[type === 'error' ? 'error' : 'log'](msg);
	}
}

// Step 54: L.uci.changes() returns a Promise in LuCI 26.x. Synchronous
// `Object.keys(promise)` was always [] so the pending pill never appeared.
// Refactored to async callback; quick-actions.open() now awaits it
// before building the dropdown.
function walkCount(changes) {
	var n = 0;
	Object.keys(changes || {}).forEach(function (cfg) {
		n += (changes[cfg] || []).length;
	});
	return n;
}

function countPendingChangesAsync(cb) {
	var raw;
	try { raw = L.uci.changes(); }
	catch (e) { cb(0); return; }
	if (raw && typeof raw.then === 'function') {
		raw.then(function (c) { cb(walkCount(c)); })
		   .catch(function () { cb(0); });
	} else {
		cb(walkCount(raw));
	}
}

return baseclass.extend({
	__init__: function () {
		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design') + '/icons.svg';
		this.mount();
	},

	mount: function () {
		var btn = document.getElementById('quick-actions-trigger');
		if (!btn) return;
		btn.addEventListener('click', L.bind(this.toggle, this));
		document.addEventListener('click', L.bind(this.onOutsideClick, this));
		document.addEventListener('keydown', L.bind(this.onKey, this));

		this.dropdown = null;
		this.trigger  = btn;
	},

	// Step 51: rebuild dropdown contents fresh every time it opens so the
	// pending-changes count is always current. The old code built once and
	// cached forever, which meant if the user saved a form while the popover
	// was closed, the count stayed at 0 next time they opened it.
	//
	// Step 54: pending count now comes from this._pendingCount which open()
	// fetches asynchronously via countPendingChangesAsync before calling us.
	buildDropdown: function () {
		var self = this;
		var pending = self._pendingCount || 0;

		var children = [];

		if (pending > 0) {
			children.push(E('div', { 'class': 'quick-actions-pending' }, [
				E('svg', { 'class': 'svg-icon quick-actions-pending-icon', 'aria-hidden': 'true' },
					E('use', { 'href': self.iconBase + '#i-alert-triangle' })),
				E('span', { 'class': 'quick-actions-pending-text' }, [
					_('Pending'), ' ',
					E('strong', {}, String(pending)), ' ',
					_('changes')
				]),
				E('button', {
					'type':  'button',
					'class': 'cbi-button cbi-button-positive quick-actions-pending-apply',
					'click': function () { self.close(); self.runApply(); }
				}, _('Apply'))
			]));
		}

		children.push(self.actionRow('i-wifi',     _('Restart Wi-Fi'),    'wifi'));
		children.push(self.actionRow('i-server',   _('Renew DHCP'),       'dhcp'));
		children.push(self.actionRow('i-shield',   _('Reload firewall'),  'firewall'));
		children.push(self.actionRow('i-zap',      _('Run speedtest'),    'speedtest'));
		children.push(E('div', { 'class': 'quick-actions-divider' }));
		children.push(self.actionRow('i-power',    _('Reboot router'),    'reboot', true));

		var d = E('div', { 'class': 'quick-actions-dropdown', 'role': 'menu' }, children);
		document.body.appendChild(d);
		this.dropdown = d;
	},

	actionRow: function (iconName, label, kind, danger) {
		var self = this;
		return E('button', {
			'type':  'button',
			'class': 'quick-actions-item' + (danger ? ' quick-actions-item-danger' : ''),
			'role':  'menuitem',
			'click': function () { self.run(kind); }
		}, [
			E('svg', { 'class': 'svg-icon quick-actions-item-icon', 'aria-hidden': 'true' },
				E('use', { 'href': self.iconBase + '#' + iconName })),
			E('span', {}, label)
		]);
	},

	toggle: function (ev) {
		if (ev) { ev.preventDefault(); ev.stopPropagation(); }
		if (this.dropdown && this.dropdown.classList.contains('open')) {
			this.close();
		} else {
			this.open();
		}
	},

	open: function () {
		// Step 54: pending count is async in LuCI 26.x. Wait for it before
		// rendering so the pill (when shown) always reflects truth. Cheap —
		// L.uci.changes() promise resolves in <50ms typically since LuCI
		// already polled the count for its top-right indicator badge.
		var self = this;
		countPendingChangesAsync(function (n) {
			self._pendingCount = n;
			// Step 51: rebuild every open so pending-changes count is fresh.
			if (self.dropdown) {
				self.dropdown.remove();
				self.dropdown = null;
			}
			self.buildDropdown();

			var rect = self.trigger.getBoundingClientRect();
			self.dropdown.style.top  = (rect.bottom + 4) + 'px';
			self.dropdown.style.right = (window.innerWidth - rect.right) + 'px';
			self.dropdown.classList.add('open');
		});
	},

	close: function () {
		if (this.dropdown) this.dropdown.classList.remove('open');
	},

	onOutsideClick: function (ev) {
		if (!this.dropdown || !this.dropdown.classList.contains('open')) return;
		if (this.dropdown.contains(ev.target) || this.trigger.contains(ev.target)) return;
		this.close();
	},

	onKey: function (ev) {
		if (ev.key === 'Escape' && this.dropdown && this.dropdown.classList.contains('open')) {
			this.close();
		}
	},

	// Step 51: Apply pending changes — re-route through our patched
	// displayChanges so the user gets the diff modal + Undo flow from
	// Step 45, not LuCI's stock blocking modal.
	runApply: function () {
		try {
			if (L.ui && L.ui.changes && typeof L.ui.changes.displayChanges === 'function') {
				L.ui.changes.displayChanges();
				return;
			}
		} catch (e) { /* fall through */ }
		toast('warning', _('Apply not available — try Save & Apply on a config page'));
	},

	run: function (kind) {
		this.close();
		var self = this;

		switch (kind) {
			case 'wifi':
				toast('info', _('Restarting Wi-Fi...'));
				execShell('wifi', ['reload']).then(function () {
					toast('success', _('Wi-Fi reloaded'));
				}).catch(function (e) {
					toast('error', _('Wi-Fi reload failed') + ': ' + (e.message || 'unknown'));
				});
				break;

			case 'firewall':
				toast('info', _('Reloading firewall...'));
				execShell('/etc/init.d/firewall', ['reload']).then(function () {
					toast('success', _('Firewall reloaded'));
				}).catch(function (e) {
					toast('error', _('Firewall reload failed') + ': ' + (e.message || 'unknown'));
				});
				break;

			case 'dhcp':
				toast('info', _('Renewing DHCP on WAN...'));
				execShell('ifup', ['wan']).then(function () {
					toast('success', _('DHCP renewal sent'));
				}).catch(function (e) {
					toast('error', _('DHCP renewal failed') + ': ' + (e.message || 'unknown'));
				});
				break;

			// Step 51: Run speedtest — scroll the speedtest card into view
			// and click its Run button. Cheap deep-link without coupling
			// the modules.
			case 'speedtest':
				var card = document.getElementById('speedtest-card');
				if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
				setTimeout(function () {
					var btn = document.getElementById('speedtest-run');
					if (btn && !btn.disabled) btn.click();
					else toast('info', _('Open the Overview page to run a speedtest'));
				}, 350);
				break;

			case 'reboot':
				ui.showModal(_('Reboot router?'), [
					E('p', _('The router will be unreachable for ~30 seconds.')),
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
								toast('warning', _('Rebooting now...'));
								execShell('reboot', []).catch(function () { /* expected */ });
							}
						}, _('Reboot'))
					])
				]);
				break;
		}
	}
});
