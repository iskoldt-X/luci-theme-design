// luci-theme-design — small enhancements layer
// Kept tiny by design: theme toggle, indicator icon fix.
// See doc/styling-progress.md for context.

(function () {
	'use strict';

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
})();
