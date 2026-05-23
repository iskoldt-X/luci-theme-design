'use strict';
'require baseclass';
'require ui';
'require uci';

// ─────────────────────────────────────────────────────────────────────────────
// Apply-changes experience rebuild — upgrade.md §1.S2b (absorbs §3.B4 diff viewer)
//
// LuCI's stock "Save & Apply" path opens a full-screen blocking modal
// ("Applying configuration..." with a 15-30s freeze). We replace that with:
//
//   1. Pre-apply diff modal — colored before/after of all uci-changes, with
//      red ⚠ warnings on changes known to disconnect the user (LAN IP etc).
//   2. Toast-driven progress — "Applying..." toast (persistent), then
//      success toast with [Undo] button, OR error toast if it fails.
//
// We monkey-patch L.ui.changes.displayChanges. LuCI's internal API is not a
// stable contract, so if anything goes wrong we fall back to the original.
//
// MVP: diff modal + apply via uci.apply(). Undo TBD (would need uci.revert
// after the fact, which LuCI's API does support post-apply within a window).
// ─────────────────────────────────────────────────────────────────────────────

// Risk patterns — if any change matches these, show a red warning in the diff.
var DANGEROUS = [
	{ re: /^network\.lan\.ipaddr$/,    warn: 'Changing the LAN IP will disconnect your browser' },
	{ re: /^network\.lan\.netmask$/,   warn: 'Changing the subnet mask may interrupt access' },
	{ re: /^network\.lan\.proto$/,     warn: 'Changing LAN protocol may disconnect your browser' },
	{ re: /^firewall\..*\.enabled$/, valueMatches: '0', warn: 'Disabling the firewall increases security risk' },
	{ re: /^dhcp\.lan\.ignore$/,     valueMatches: '1', warn: 'Disabling DHCP prevents clients from getting an IP automatically' },
	{ re: /^system\.@system\[0\]\.hostname$/, warn: 'Old hostname links become invalid after rename' }
];

function detectDangers(changes) {
	var hits = [];
	changes.forEach(function (c) {
		var key = c.config + '.' + c.section + (c.option ? '.' + c.option : '');
		DANGEROUS.forEach(function (rule) {
			if (rule.re.test(key)) {
				if (rule.valueMatches !== undefined && String(c.value) !== rule.valueMatches) return;
				hits.push(_(rule.warn));
			}
		});
	});
	return hits;
}

// Format one uci change as a colored diff row.
//   {config, section, option, old, value, op}
// op: 'set' / 'add' / 'remove'
function changeRow(c) {
	var key = c.config + '.' + c.section + (c.option ? '.' + c.option : '');
	var children = [
		E('span', { 'class': 'apply-diff-key' }, key)
	];

	if (c.op === 'add') {
		children.push(E('span', { 'class': 'apply-diff-tag apply-diff-add' }, _('new')));
	} else if (c.op === 'remove') {
		children.push(E('span', { 'class': 'apply-diff-tag apply-diff-del' }, _('removed')));
	} else {
		if (c.old !== undefined && c.old !== null && c.old !== '') {
			children.push(E('span', { 'class': 'apply-diff-val apply-diff-del' }, String(c.old)));
			children.push(E('span', { 'class': 'apply-diff-arrow' }, '→'));
		}
		children.push(E('span', { 'class': 'apply-diff-val apply-diff-add' }, String(c.value !== undefined ? c.value : '')));
	}

	return E('div', { 'class': 'apply-diff-row' }, children);
}

// Normalize LuCI's uci.changes() output into one flat array of {config, section, option, old, value, op}.
// LuCI returns { configname: [['op', section, option?, value?], ...], ... }
function flattenChanges(raw) {
	var out = [];
	Object.keys(raw || {}).forEach(function (cfg) {
		var entries = raw[cfg] || [];
		entries.forEach(function (e) {
			// LuCI's change format: [op, section, option_or_type, value]
			var op = e[0], section = e[1], a = e[2], b = e[3];
			if (op === 'add') {
				out.push({ config: cfg, section: section, option: null, value: a, op: 'add' });
			} else if (op === 'remove' || op === 'del') {
				out.push({ config: cfg, section: section, option: a || null, value: null, op: 'remove' });
			} else if (op === 'set') {
				out.push({ config: cfg, section: section, option: a, value: b, op: 'set' });
			} else if (op === 'rename' || op === 'reorder') {
				out.push({ config: cfg, section: section, option: a, value: b, op: op });
			} else {
				out.push({ config: cfg, section: section, option: a, value: b, op: op });
			}
		});
	});
	return out;
}

function toastSafe(type, msg, opts) {
	if (window.toast && window.toast[type]) return window.toast[type](msg, opts);
	if (type === 'error') console.error(msg); else console.log(msg);
	return null;
}

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function () {
		this.patch();
	},

	patch: function () {
		// Defensive: do nothing if LuCI's changes API isn't there yet
		if (!window.L || !L.ui || !L.ui.changes || typeof L.ui.changes.displayChanges !== 'function') return;
		// Already patched? Don't double-wrap.
		if (L.ui.changes.__designPatched) return;
		L.ui.changes.__designOriginal = L.ui.changes.displayChanges;
		L.ui.changes.__designPatched  = true;

		var self = this;
		L.ui.changes.displayChanges = function () {
			try {
				return self.showDiff();
			} catch (e) {
				// API drift / unexpected state — fall back to LuCI's native modal
				return L.ui.changes.__designOriginal.apply(L.ui.changes, arguments);
			}
		};
	},

	showDiff: function () {
		var self = this;
		// Read pending uci changes (LuCI keeps these in memory between Save and Apply)
		var changes = flattenChanges(L.uci.changes());

		if (!changes.length) {
			toastSafe('info', _('No pending changes'));
			return Promise.resolve();
		}

		var dangers = detectDangers(changes);

		// Build the modal body
		var rows = changes.slice(0, 50).map(changeRow);
		if (changes.length > 50) {
			rows.push(E('div', { 'class': 'apply-diff-row apply-diff-more' },
				_('… and %d more changes').replace('%d', changes.length - 50)));
		}

		var dangerEl = null;
		if (dangers.length) {
			dangerEl = E('div', { 'class': 'apply-diff-warnings' },
				dangers.map(function (d) {
					return E('div', { 'class': 'apply-diff-warning' }, '⚠ ' + d);
				}));
		}

		ui.showModal(_('Apply pending changes?'), [
			E('p', { 'class': 'apply-diff-summary' },
				_('%d changes ready to apply.').replace('%d', changes.length)),
			E('div', { 'class': 'apply-diff-list' }, rows),
			dangerEl,
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'cbi-button',
					'click': ui.hideModal
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-positive',
					'click': function () {
						ui.hideModal();
						self.applyAndProgress();
					}
				}, _('Confirm & Apply'))
			])
		]);

		return Promise.resolve();
	},

	applyAndProgress: function () {
		// LuCI's uci.apply takes a "rollback timeout" in seconds. Default 90 from
		// the env (apply_rollback). If after that the box doesn't get a confirm,
		// it rolls back — protects against the user locking themselves out.
		var timeout = (L.env && L.env.apply_rollback) ? L.env.apply_rollback : 90;
		var progressId = toastSafe('info', _('Applying configuration...'), { duration: 0 });

		L.uci.apply(timeout).then(function () {
			if (progressId !== null && window.toast) toast.dismiss(progressId);
			toastSafe('success', _('Configuration applied'));
			// Some pages need a reload to reflect the new state — emulate LuCI's
			// behaviour. Wait 1.5s so the success toast is visible first.
			setTimeout(function () { location.reload(); }, 1500);
		}).catch(function (err) {
			if (progressId !== null && window.toast) toast.dismiss(progressId);
			toastSafe('error', _('Apply failed') + ': ' + ((err && err.message) ? err.message : 'unknown'));
		});
	}
});
