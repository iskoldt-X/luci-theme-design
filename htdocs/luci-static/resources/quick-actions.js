'use strict';
'require baseclass';
'require ui';
'require rpc';
'require fs';

// ─────────────────────────────────────────────────────────────────────────────
// Quick Actions popover — upgrade.md §2.A3
//
// Header lightning-bolt button → dropdown with common one-click operations:
//   - Reload Wi-Fi
//   - Reload firewall
//   - Reboot router (confirms first)
//   - Renew DHCP on WAN (release + renew)
//
// Each action goes through toast.info → toast.success/error so the user
// sees what happened (replaces the old "page reloads silently" UX).
//
// MVP: 4 actions. Reboot has confirm. Add more in follow-up.
// ─────────────────────────────────────────────────────────────────────────────

var execShell = rpc.declare({
	object: 'file',
	method: 'exec',
	params: ['command', 'params'],
	expect: { code: 0 }
});

function toast(type, msg) {
	if (window.toast && window.toast[type]) return window.toast[type](msg);
	console[type === 'error' ? 'error' : 'log'](msg);
}

return baseclass.extend({
	__init__: function () {
		this.iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design') + '/icons.svg';
		this.mount();
	},

	mount: function () {
		// Need to add header button — header.htm already has one, just wire it up
		var btn = document.getElementById('quick-actions-trigger');
		if (!btn) return;     // theme template hasn't been updated yet
		btn.addEventListener('click', L.bind(this.toggle, this));
		document.addEventListener('click', L.bind(this.onOutsideClick, this));
		document.addEventListener('keydown', L.bind(this.onKey, this));

		// Build dropdown lazily (only when opened first time)
		this.dropdown = null;
		this.trigger  = btn;
	},

	buildDropdown: function () {
		var self = this;
		var d = E('div', { 'class': 'quick-actions-dropdown', 'role': 'menu' }, [
			E('div', { 'class': 'quick-actions-header' }, _('Quick actions')),
			this.actionRow('i-wifi',      _('Restart Wi-Fi'),    'wifi'),
			this.actionRow('i-shield',    _('Reload firewall'),  'firewall'),
			this.actionRow('i-globe',     _('Renew DHCP'),       'dhcp'),
			this.actionRow('i-power',     _('Reboot router'),    'reboot', true)
		]);
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
				E('use', { 'href': this.iconBase + '#' + iconName })),
			E('span', {}, label)
		]);
	},

	toggle: function (ev) {
		if (ev) { ev.preventDefault(); ev.stopPropagation(); }
		if (!this.dropdown) this.buildDropdown();
		if (this.dropdown.classList.contains('open')) {
			this.close();
		} else {
			this.open();
		}
	},

	open: function () {
		if (!this.dropdown) this.buildDropdown();
		// Position under the trigger button
		var rect = this.trigger.getBoundingClientRect();
		this.dropdown.style.top  = (rect.bottom + 4) + 'px';
		this.dropdown.style.right = (window.innerWidth - rect.right) + 'px';
		this.dropdown.classList.add('open');
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
