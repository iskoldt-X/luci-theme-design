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

// Step 63: redesigned diff row to match upgrade-preview.html §B4 — old/new
// pairs as separate strikethrough/highlight rows rather than a single row
// with arrow, grouped under config headers (handled by caller).
//
// op: 'set' (with optional .old populated by enrichChangesWithOldValues)
//     'add' (new section, value = type name)
//     'remove' (key wiped)
//     'rename' / 'reorder' (rare; fall through to a simple "renamed to X" row)
function changeRowsForOne(c) {
	var keyPart = (c.option != null && c.option !== '')
		? c.option
		: (c.section || '(section)');

	function row(kind, mark, key, val) {
		return E('div', { 'class': 'apply-diff-row apply-diff-row-' + kind }, [
			E('span', { 'class': 'apply-diff-mark' }, mark),
			E('span', { 'class': 'apply-diff-key' }, key),
			val !== undefined
				? E('span', { 'class': 'apply-diff-val' }, val)
				: null
		].filter(Boolean));
	}

	if (c.op === 'add') {
		// New anonymous/named section. `value` is the section type.
		return [ row('add', '+',
			(c.section || '?') + (c.value ? ' [' + String(c.value) + ']' : ''),
			_('new section')) ];
	}
	if (c.op === 'remove') {
		return [ row('del', '−', keyPart, _('removed')) ];
	}
	if (c.op === 'rename') {
		return [ row('add', '↻', keyPart, _('renamed to ') + String(c.value || '?')) ];
	}
	if (c.op === 'reorder') {
		return [ row('add', '⇅', keyPart, _('reordered')) ];
	}

	// 'set' — show old → new as TWO rows when we have an old value
	var rows = [];
	if (c.old !== undefined && c.old !== null && c.old !== '' &&
	    String(c.old) !== String(c.value)) {
		rows.push(row('del', '−', keyPart, String(c.old)));
	}
	rows.push(row('add', '+', keyPart,
		String(c.value !== undefined && c.value !== null ? c.value : '')));
	return rows;
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

// Step 54: L.uci.changes() returns a Promise in LuCI 26.x (confirmed by
// user-supplied probe `typeof uciChangesRaw.then === 'function'`). Earlier
// LuCI versions returned a sync map. Wrap both shapes into a uniform
// Promise so callers don't have to think about it.
//
// Without this, flattenChanges(L.uci.changes()) gets a Promise and
// Object.keys(promise) is always empty → every diff modal shows "No
// pending changes" + immediately bails. That was the entire mystery of
// "diff viewer never appears even though patch landed".
function getChangesPromise() {
	var raw;
	try { raw = L.uci.changes(); }
	catch (e) {
		if (console && console.warn) console.warn('apply-modal: L.uci.changes() threw', e);
		return Promise.resolve({});
	}
	if (raw && typeof raw.then === 'function') {
		return raw.catch(function (e) {
			if (console && console.warn) console.warn('apply-modal: changes() promise rejected', e);
			return {};
		});
	}
	return Promise.resolve(raw || {});
}

// ─────────────────────────────────────────────────────────────────────────────

// Round 42 Step 167 + Step 174 (fix) — LuCI version gate for the
// monkey-patches on L.ui.changes.{displayChanges,apply}.
//
// Step 167 originally checked "is L.env.luciversion in [18, 27]?"
// as a positive whitelist. Chrome-Claude verified on ImmortalWrt
// 24.10 ucode track that `L.env.luciversion` is UNDEFINED — the
// ucode template runtime doesn't propagate the version global the
// way Lua dispatch does. The whitelist false-positive'd EVERY ucode
// install ("unknown → bail"), which silently disabled Save&Apply +
// toast wrap on every modern build of LuCI we ship for.
//
// Step 174 inverts the logic: known-INCOMPATIBLE list. Unknown or
// parseable-in-range = TRUST + proceed. The inner feature-detect
// (`typeof L.ui.changes.displayChanges === 'function'` etc.) is
// still the last-line safety net — if the actual API surface is
// gone, the patcher bails gracefully there.
//
// Defense layers:
//   1. (this) Outer version-range check — catches known-incompatible
//      LuCI majors at first principles (pre-18 / post-27).
//   2. (in _tryPatch) Feature-detect on L.ui.changes.* methods —
//      catches API surface changes WITHIN known versions.
// Both bail to LuCI's native Save&Apply modal — degraded but unbroken.
//
// Verified band rationale (Round 42, 2026-05-24):
//   18.06 — Lean lede secondary target
//   19.07 — Lean lede legacy
//   21.02 — OpenWrt mainstream
//   23.05 — coolsnowwolf luci current + openwrt 23.05
//   24.10 — immortalwrt + openwrt current (primary)
//   25.xx — buffer
//   26.xx — immortalwrt snapshot (verified live)
//   27.xx — buffer
function isKnownIncompatibleLuciVersion() {
	// If we can't read the version at all, TRUST — modern ucode track
	// doesn't expose luciversion the same way Lua track does, and the
	// inner feature-detect will catch any real incompatibility.
	if (!window.L || !L.env || typeof L.env.luciversion !== 'string') return false;
	var major = parseInt(L.env.luciversion.split('.')[0], 10);
	// Unparseable major (weird string) → trust + proceed.
	if (isNaN(major)) return false;
	// Outside known-good band → bail to native.
	return major < 18 || major > 27;
}

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
		// Round 42 Step 174: bail ONLY on known-incompatible LuCI majors
		// (pre-18, post-27). Unknown/unparseable luciversion = trust +
		// patch; the feature-detect below is the inner safety net.
		if (isKnownIncompatibleLuciVersion()) {
			if (console && console.log) {
				console.log('apply-modal: LuCI version in known-incompatible range; using native flow', {
					luciversion: (window.L && L.env && L.env.luciversion) || '<unknown>'
				});
			}
			return;
		}
		// Step 58: also patch L.ui.changes.apply() — the Save & Apply button
		// on config pages goes through THAT, not displayChanges. User
		// reported clicking '保存并应用' still showed LuCI's native rollback
		// countdown modal because our patch was only on displayChanges.
		var hasDisplay = window.L && L.ui && L.ui.changes &&
			typeof L.ui.changes.displayChanges === 'function';
		var hasApply = window.L && L.ui && L.ui.changes &&
			typeof L.ui.changes.apply === 'function';
		if (!hasDisplay || !hasApply) {
			if ((self._patchAttempts = (self._patchAttempts || 0) + 1) > 40) return;
			setTimeout(L.bind(self._tryPatch, self), 250);
			return;
		}
		// Already patched? Don't double-wrap.
		if (L.ui.changes.__designPatched) return;

		// Step 58: save references to BOTH originals under distinct names
		// so the showDiff fallback in Step 54 can find them by either the
		// old single-name (__designOriginal) or the new pair.
		L.ui.changes.__designOriginalDisplay = L.ui.changes.displayChanges;
		L.ui.changes.__designOriginalApply   = L.ui.changes.apply;
		L.ui.changes.__designOriginal        = L.ui.changes.displayChanges; // legacy alias
		L.ui.changes.__designPatched         = true;

		// Single hook handles both entry points — both should show our diff
		// modal first, then user confirms via the "Confirm & Apply" button
		// which calls self.applyAndProgress (using L.uci.apply directly).
		// _inConfirmFlow guards against the patched hook intercepting the
		// re-entrant calls our own apply makes.
		function diffHook() {
			if (self._inConfirmFlow) {
				// We're already inside our confirm flow — let the original
				// run unmodified so LuCI's internal apply logic completes.
				return L.ui.changes.__designOriginalApply.apply(L.ui.changes, arguments);
			}
			try {
				return self.showDiff();
			} catch (e) {
				if (console && console.error) console.error('apply-modal: showDiff sync throw', e);
				return L.ui.changes.__designOriginalDisplay.apply(L.ui.changes, arguments);
			}
		}

		L.ui.changes.displayChanges = diffHook;
		L.ui.changes.apply          = diffHook;

		if (console && console.log) {
			console.log('apply-modal: patched displayChanges AND apply — Save&Apply button now goes through our diff modal');
		}
	},

	showDiff: function () {
		var self = this;
		// Step 54: changes is now retrieved via Promise (LuCI 26.x).
		return getChangesPromise().then(function (raw) {
			var changes = flattenChanges(raw);

			if (!changes.length) {
				toastSafe('info', _('No pending changes'));
				return;
			}

			// Step 63: enrich every 'set' change with its old value from
			// L.uci.values (the in-memory shadow of on-disk uci before our
			// uci.set() calls). Lets us render proper diff rows showing
			// old → new instead of just new. snapshotForUndo() uses the
			// same source.
			changes = self.enrichChangesWithOldValues(changes);

			var dangers = detectDangers(changes);

			// Step 45: capture pre-apply state for the Undo button. Must happen
			// BEFORE apply — once L.uci.apply commits, the "old" values are gone.
			var snapshot = self.snapshotForUndo(changes);

			// Step 63: group changes by config.section so the modal reads like
			// the preview B4 viewer (one card per affected object instead of
			// a flat firehose). Total count and danger warnings stay at the
			// top/bottom respectively.
			var grouped = self.groupChangesByConfigSection(changes);
			var groupKeys = Object.keys(grouped);

			var groupEls = [];
			var rowBudget = 80;       // hard cap so the modal stays scrollable
			var rowsRendered = 0;
			var truncated = false;

			for (var gi = 0; gi < groupKeys.length; gi++) {
				if (rowsRendered >= rowBudget) { truncated = true; break; }
				var gKey = groupKeys[gi];
				var gChanges = grouped[gKey];
				var groupRows = [];
				for (var ci = 0; ci < gChanges.length; ci++) {
					if (rowsRendered >= rowBudget) { truncated = true; break; }
					var rowsForChange = changeRowsForOne(gChanges[ci]);
					rowsForChange.forEach(function (r) { groupRows.push(r); });
					rowsRendered++;
				}
				groupEls.push(E('div', { 'class': 'apply-diff-group' }, [
					E('div', { 'class': 'apply-diff-group-head' }, gKey),
					E('div', { 'class': 'apply-diff-group-body' }, groupRows)
				]));
			}

			if (truncated) {
				groupEls.push(E('div', { 'class': 'apply-diff-more' },
					_('… and %d more changes (open Save & Apply in detail view to inspect)')
						.replace('%d', changes.length - rowsRendered)));
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
				E('div', { 'class': 'apply-diff-list' }, groupEls),
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
		}).catch(function (err) {
			if (console && console.error) console.error('apply-modal: showDiff failed', err);
			toastSafe('error', _('Diff modal failed: ') + ((err && err.message) ? err.message : 'unknown'));
			var orig = L.ui && L.ui.changes && (
				L.ui.changes.__designOriginalDisplay || L.ui.changes.__designOriginal);
			if (orig) return orig.call(L.ui.changes);
		});
	},

	// Step 63: enrich 'set' ops with the old value pulled from L.uci.values.
	// Same data source as snapshotForUndo(); kept as a separate pass so
	// downstream rendering (changeRowsForOne) gets a uniform record shape.
	enrichChangesWithOldValues: function (changes) {
		try {
			var values = L.uci && L.uci.values;
			if (!values) return changes;
			return changes.map(function (c) {
				if (c.op !== 'set' || !c.option) return c;
				var cfg = values[c.config];
				if (!cfg) return c;
				var sec = cfg[c.section];
				if (!sec) return c;
				var old = sec[c.option];
				if (old === undefined) return c;
				// shallow clone so we don't mutate caller's array entry
				var out = {};
				for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) out[k] = c[k];
				out.old = old;
				return out;
			});
		} catch (e) {
			if (console && console.warn) console.warn('apply-modal: enrichChangesWithOldValues failed', e);
			return changes;
		}
	},

	// Step 63: group flattened changes by "config.section" so the modal can
	// render one card per affected object. Group order is preserved as
	// first-seen order (uci.changes generally clusters by config naturally).
	groupChangesByConfigSection: function (changes) {
		var groups = {};
		var order = [];
		changes.forEach(function (c) {
			var key = c.config + (c.section ? '.' + c.section : '');
			if (!groups[key]) {
				groups[key] = [];
				order.push(key);
			}
			groups[key].push(c);
		});
		// Return as ordered object via re-insertion (preserves order in modern JS)
		var ordered = {};
		order.forEach(function (k) { ordered[k] = groups[k]; });
		return ordered;
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
		// Step 58: mark that we're in the confirm flow so the patched
		// L.ui.changes.apply hook (if reentered) calls the original
		// instead of looping back into showDiff.
		self._inConfirmFlow = true;
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
			// Step 58: reset confirm flow on error so if user retries
			// Save&Apply, the hook re-enters showDiff (not the original
			// apply which would skip our modal).
			self._inConfirmFlow = false;
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
