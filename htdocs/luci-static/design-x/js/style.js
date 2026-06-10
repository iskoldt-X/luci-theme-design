// luci-theme-design — small enhancements layer
// Kept tiny by design: theme toggle, indicator icon fix.
// See doc/styling-progress.md for context.

(function () {
	'use strict';

	// ── 0. Global polling throttle (doc/fix.md Batch 2)
	// Pauses all intervals when page is hidden. Provides in-flight protection
	// (skips tick if previous promise hasn't resolved). "一处实现，所有模块受益"
	var _origSetInterval = window.setInterval;
	window.setInterval = function (fn, delay) {
		var inFlight = false;
		var args = Array.prototype.slice.call(arguments, 2);
		return _origSetInterval(function () {
			if (document.hidden) return;
			if (inFlight) return;
			try {
				var res = (typeof fn === 'string') ? eval(fn) : fn.apply(this, args);
				if (res && typeof res.finally === 'function') {
					inFlight = true;
					res.finally(function () { inFlight = false; });
				} else if (res && typeof res.then === 'function') {
					inFlight = true;
					res.then(function () { inFlight = false; }, function (e) { inFlight = false; throw e; });
				}
			} catch (e) {
				inFlight = false;
				throw e;
			}
		}, delay);
	};

	// ── 1. Indicators icon (MutationObserver replaces deprecated DOMSubtreeModified)
	//      Step 109 (Round 25): walk ALL children, not just firstElementChild —
	//      LuCI can attach multiple [data-indicator] siblings (uci-changes +
	//      poll-status + sometimes more). Also adds a title attribute to the
	//      poll-status dot so the (otherwise undiscoverable) "click to pause
	//      auto-refresh" affordance shows up on hover. Observer now also
	//      listens for attribute changes on data-style so the title text
	//      stays in sync as LuCI toggles polling state.
	var indicators = document.getElementById('indicators');
	if (indicators) {
		function annotateIndicator(el) {
			if (!el || !el.getAttribute) return;
			var indType = el.getAttribute('data-indicator');
			if (indType === 'poll-status') {
				var style = el.getAttribute('data-style');
				el.setAttribute('title', style === 'active'
					? 'Auto-refresh active — click to pause'
					: 'Auto-refresh paused — click to resume');
				el.textContent = '';
			} else if (indType !== 'uci-changes') {
				el.textContent = '';
			}
		}
		new MutationObserver(function () {
			var children = indicators.children;
			for (var i = 0; i < children.length; i++) {
				annotateIndicator(children[i]);
			}
		}).observe(indicators, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['data-style']
		});
		// Annotate any children already present at script-load time.
		for (var i = 0; i < indicators.children.length; i++) {
			annotateIndicator(indicators.children[i]);
		}
	}

	// ── 2. Theme toggle (auto → light → dark → auto, persisted)
	var root = document.documentElement;
	var stored = null;
	try { stored = localStorage.getItem('design-theme'); } catch (e) { /* private mode etc. */ }
	if (stored === 'light' || stored === 'dark') {
		root.setAttribute('data-theme', stored);
	} else {
		root.setAttribute('data-theme', 'auto');
	}

	var btn = document.getElementById('theme-toggle');
	if (btn) {
		btn.addEventListener('click', function () {
			var cur = root.getAttribute('data-theme') || 'auto';
			var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
			root.setAttribute('data-theme', next);
			try {
				if (next === 'auto') {
					localStorage.removeItem('design-theme');
				} else {
					localStorage.setItem('design-theme', next);
				}
			} catch (e) { /* ignore */ }
		});
	}

	// ── 3. Progressbar utilisation-tier coloring (Round 44 Step 199)
	//
	// .cbi-progressbar shows utilisation gauges (Memory/Buffered/Cached/Swap
	// on System info card, Active Connections on Network card, per-station
	// signal on Wireless). The fill itself is just emerald-500 across the
	// full 0–100% range — no visual cue when a metric crosses into
	// "concerning" territory. CSS alone can't tier-color by width because
	// CSS has no width-comparator selector.
	//
	// This block:
	//   1. Reads inline `style.width` on each .cbi-progressbar > div
	//   2. Sets data-tier="warn" at ≥90%, "danger" at ≥95%, clears below
	//   3. CSS (style.css §progressbar tier) keys off data-tier to swap
	//      the fill background to amber / red.
	//   4. MutationObserver watches inline style changes (LuCI polls every
	//      5s and updates the width attr) so the tier recomputes live.
	function tierForWidth(pct) {
		// Round 44 Step 219: thresholds lowered from 90/95 to 80/95.
		// Chrome-Claude verification of Step 199 found that 90% is rarely
		// crossed on real routers — Memory typically sits 60-85% — so
		// the tier coloring feature was invisible in practice. 80% is
		// the "worth knowing" memory pressure point on a 1 GB ARM box.
		// 95% remains the "near OOM / swap engaged" red zone.
		if (pct >= 95) return 'danger';
		if (pct >= 80) return 'warn';
		return null;
	}
	function applyTier(bar) {
		// Round 44 Step 219: read pct via 3-way fallback. Chrome-Claude
		// found Step 199's `fill.style.width` path doesn't fire on some
		// LuCI 26 progressbars because LuCI uses `bar.title` ("X / Y (Z%)")
		// as the authoritative readout and may not always set inline
		// width on the fill div (depends on cbi.js render path).
		//   1. parse `(NN%)` out of bar.title — primary, matches LuCI's
		//      own pct source of truth
		//   2. parse `fill.style.width` inline — works when LuCI used
		//      old-style render path
		//   3. fall back to offsetWidth ratio — last resort
		var pct = NaN;
		var title = bar.getAttribute('title') || bar.title || '';
		var titleMatch = title.match(/\((\d+(?:\.\d+)?)%\)/);
		if (titleMatch) {
			pct = parseFloat(titleMatch[1]);
		}
		var fill = bar.querySelector(':scope > div');
		if (!isFinite(pct) && fill) {
			var raw = fill.style.width || '';
			pct = parseFloat(raw);
			if (!isFinite(pct) && bar.offsetWidth && fill.offsetWidth) {
				pct = (fill.offsetWidth / bar.offsetWidth) * 100;
			}
		}
		if (!isFinite(pct)) pct = 0;
		var tier = tierForWidth(pct);
		if (tier) bar.setAttribute('data-tier', tier);
		else bar.removeAttribute('data-tier');
	}
	function scanAndTier() {
		var bars = document.querySelectorAll('.cbi-progressbar');
		for (var i = 0; i < bars.length; i++) applyTier(bars[i]);
	}
	// Initial pass on DOMContentLoaded (LuCI may have already rendered).
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', scanAndTier);
	} else {
		scanAndTier();
	}
	// Watch document subtree for new bars + style changes on existing
	// fills. The selector match in applyTier is cheap (1 querySelector
	// per mutation root), and tier computation is O(1) per bar.
	if (typeof MutationObserver !== 'undefined') {
		var pbObserver = new MutationObserver(function (muts) {
			// Cheap path: if any mutation looks like a fill style change
			// or a new bar appeared, re-scan. Over-scan is fine; bars
			// site-wide are usually < 20 elements.
			var rescan = false;
			for (var i = 0; i < muts.length && !rescan; i++) {
				var m = muts[i];
				if (m.type === 'attributes' && m.attributeName === 'style') {
					rescan = true;
				} else if (m.type === 'childList' && m.addedNodes.length) {
					rescan = true;
				}
			}
			if (rescan) scanAndTier();
		});
		pbObserver.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['style']
		});
	}
})();
