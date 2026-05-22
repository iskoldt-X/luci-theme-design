// luci-theme-design — small enhancements layer
// Kept tiny by design: theme toggle, indicator icon fix.
// See doc/styling-progress.md for context.

(function () {
	'use strict';

	// ── 1. Indicators icon (MutationObserver replaces deprecated DOMSubtreeModified)
	var indicators = document.getElementById('indicators');
	if (indicators) {
		new MutationObserver(function () {
			var first = indicators.firstElementChild;
			if (first && first.getAttribute('data-indicator') !== 'uci-changes') {
				first.textContent = '';
			}
		}).observe(indicators, { childList: true, subtree: true });
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
