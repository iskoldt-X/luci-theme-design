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
// Step 45: Undo button. The previous MVP toast had no Undo. We now:
//   - Before apply, snapshot the original (pre-change) values via the
//     L.uci.values shadow (private but stable in LuCI 20.x → 26.x).
//   - Apply normally. On success, show a 10s Undo toast.
//   - If clicked, re-set the snapshotted values + save + apply, surfacing
//     a "Reverted to previous configuration" toast on success.
//   - Page reload is deferred past the Undo window (12s) so the toast
//     isn't dismissed mid-click.
//
// Limitations (documented honestly): Undo only restores 'set' ops with
// captured pre-values. 'add' / 'remove' / 'rename' are not reversible
// through this mechanism (would need a fuller transactional log) — in
// that case the toast is shown without the Undo button.
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
		// Step 49: defer-patch retry. The original implementation did a
		// single synchronous check on L.ui.changes.displayChanges at
		// __init__ and silently bailed if it wasn't there yet — exactly
		// the case on ImmortalWrt 24.10 / LuCI 26.x where L.ui.changes
		// is wired up *after* our module finishes loading, so our patch
		// never landed and Save&Apply kept showing LuCI's stock blocking
		// modal.
		//
		// Mirror the tryInject pattern used by wan-hero.js / sparkline.js
		// etc: poll every 250ms for up to 10s (40 attempts). 10s is well
		// past any plausible LuCI init time but caps the budget so we
		// don't hold a timer forever on a LuCI version that genuinely
		// lacks changes.displayChanges (we'll degrade to the native flow).
		this._patchAttempts = 0;
		this._tryPatch();
	},

	_tryPatch: function () {
		var self = this;
		if (!window.L || !L.ui || !L.ui.changes || typeof L.ui.changes.displayChanges !== 'function') {
			if ((self._patchAttempts = (self._patchAttempts || 0) + 1) > 40) return;
			setTimeout(L.bind(self._tryPatch, self), 250);
			return;
		}
		// Already patched? Don't double-wrap.
		if (L.ui.changes.__designPatched) return;
		L.ui.changes.__designOriginal = L.ui.changes.displayChanges;
		L.ui.changes.__designPatched  = true;

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

		// Step 45: capture pre-apply state for the Undo button. Must happen
		// BEFORE apply — once L.uci.apply commits, the "old" values are gone
		// from the in-memory shadow. snapshotForUndo() is defensive (returns
		// {} if L.uci.values is unavailable on this LuCI version).
		var snapshot = self.snapshotForUndo(changes);

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
						self.applyAndProgress(snapshot);
					}
				}, _('Confirm & Apply'))
			])
		]);

		return Promise.resolve();
	},

	// Step 45: capture pre-change values from the L.uci.values shadow.
	// We only snapshot 'set' ops — 'add' / 'remove' / 'rename' aren't
	// reversible through simple key restoration. Returns {} on any error
	// or unavailable API, which downstream interprets as "no Undo button".
	snapshotForUndo: function (changes) {
		var snap = {};
		try {
			var values = L.uci && L.uci.values;
			if (!values) return snap;
			changes.forEach(function (c) {
				if (c.op !== 'set' || !c.option) return;
				var cfg = values[c.config];
				if (!cfg) return;
				var sec = cfg[c.section];
				if (!sec) return;
				var orig = sec[c.option];
				if (orig === undefined) return;
				snap[c.config + '.' + c.section + '.' + c.option] = orig;
			});
		} catch (e) { /* swallow — degrade to no-undo */ }
		return snap;
	},

	applyAndProgress: function (snapshot) {
		var self = this;
		// LuCI's uci.apply takes a "rollback timeout" in seconds. Default 90 from
		// the env (apply_rollback). If after that the box doesn't get a confirm,
		// it rolls back — protects against the user locking themselves out.
		var timeout = (L.env && L.env.apply_rollback) ? L.env.apply_rollback : 90;
		var progressId = toastSafe('info', _('Applying configuration...'), { duration: 0 });

		// Step 45: Undo window — show the toast for 10s before reloading the
		// page. Beyond 10s the toast self-dismisses and the page reloads to
		// pick up the new state.
		var UNDO_WINDOW_MS = 10000;
		var POST_UNDO_RELOAD_MS = UNDO_WINDOW_MS + 2000;

		L.uci.apply(timeout).then(function () {
			if (progressId !== null && window.toast) toast.dismiss(progressId);

			var canUndo = snapshot && Object.keys(snapshot).length > 0 && window.toast;
			if (canUndo) {
				window.toast.success(_('Configuration applied'), {
					duration: UNDO_WINDOW_MS,
					action: {
						label: _('Undo'),
						onClick: function () { self.undoChanges(snapshot); }
					}
				});
				setTimeout(function () { location.reload(); }, POST_UNDO_RELOAD_MS);
			} else {
				// No-undo path: original behaviour (no Undo for add/remove/rename or
				// when the snapshot couldn't be captured — keeps the LuCI flow honest).
				toastSafe('success', _('Configuration applied'));
				setTimeout(function () { location.reload(); }, 1500);
			}
		}).catch(function (err) {
			if (progressId !== null && window.toast) toast.dismiss(progressId);
			toastSafe('error', _('Apply failed') + ': ' + ((err && err.message) ? err.message : 'unknown'));
		});
	},

	// Step 45: re-apply the snapshotted pre-change values. Best-effort
	// "logical" undo: works for 'set' ops only, may race if the user made
	// further changes in the 10s window (rare in practice). Surfaces
	// success/failure via toast so the user knows what happened.
	undoChanges: function (snapshot) {
		var self = this;
		var timeout = (L.env && L.env.apply_rollback) ? L.env.apply_rollback : 90;
		var progressId = toastSafe('info', _('Reverting…'), { duration: 0 });

		try {
			Object.keys(snapshot).forEach(function (key) {
				var parts = key.split('.');
				var config = parts[0], section = parts[1], option = parts[2];
				L.uci.set(config, section, option, snapshot[key]);
			});
		} catch (e) {
			if (progressId !== null && window.toast) toast.dismiss(progressId);
			toastSafe('error', _('Failed to prepare revert: ') + ((e && e.message) ? e.message : 'unknown'));
			return;
		}

		L.uci.save().then(function () {
			return L.uci.apply(timeout);
		}).then(function () {
			if (progressId !== null && window.toast) toast.dismiss(progressId);
			toastSafe('success', _('Reverted to previous configuration'));
			setTimeout(function () { location.reload(); }, 1500);
		}).catch(function (err) {
			if (progressId !== null && window.toast) toast.dismiss(progressId);
			toastSafe('error', _('Revert failed: ') + ((err && err.message) ? err.message : 'unknown'));
		});
	}
});
