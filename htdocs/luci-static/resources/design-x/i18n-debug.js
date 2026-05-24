'use strict';
'require baseclass';

// ─────────────────────────────────────────────────────────────────────────────
// i18n stress-test helper — upgrade.md §4.C3
//
// Activates only when the page URL has one of these debug flags:
//   ?design-debug=pseudo-long    Doubles every visible label (catches overflow)
//   ?design-debug=pseudo-short   Replaces labels with single-char CJK (catches under-width assumptions)
//   ?design-debug=rtl             Adds dir="rtl" to <html> (catches LTR assumptions)
//   ?design-debug=outline         Adds 1px solid red border to every block-level
//                                 element (catches alignment bugs)
//
// All flags can be combined: ?design-debug=pseudo-long,rtl
//
// No effect in normal use. Strictly a developer dev-tool.
// ─────────────────────────────────────────────────────────────────────────────

function getFlags() {
	var m = location.search.match(/[?&]design-debug=([^&]+)/);
	if (!m) return null;
	return decodeURIComponent(m[1]).split(',');
}

// Walk text nodes only — never DOM structure. Skip nodes inside <script>,
// <style>, and any [contenteditable], plus our own debug banner.
function walkText(root, transform) {
	var skipParents = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT)$/;
	var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: function (n) {
			if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
			var p = n.parentNode;
			while (p && p !== root) {
				if (p.tagName && skipParents.test(p.tagName)) return NodeFilter.FILTER_REJECT;
				if (p.classList && p.classList.contains('design-debug-banner')) return NodeFilter.FILTER_REJECT;
				p = p.parentNode;
			}
			return NodeFilter.FILTER_ACCEPT;
		}
	});
	var nodes = [];
	for (var n; (n = walker.nextNode()); ) nodes.push(n);
	nodes.forEach(function (node) { node.nodeValue = transform(node.nodeValue); });
}

function pseudoLong(s) {
	// Append the same string again — doubles visible width without changing meaning
	return s.trim() ? s + ' ' + s : s;
}

function pseudoShort(s) {
	// Replace every Latin word with a single Han ideograph 一 (U+4E00,
	// canonical representative CJK width). \u-escape keeps source ASCII
	// per the lint guard; runtime string is identical.
	return s.replace(/\b[A-Za-z]+\b/g, '\u4e00');
}

function showBanner(flags) {
	var banner = E('div', { 'class': 'design-debug-banner' }, [
		'⚠ i18n debug active: ' + flags.join(', '),
		' · ',
		E('a', { 'href': location.pathname }, 'exit')
	]);
	document.body.appendChild(banner);
}

function applyFlags(flags) {
	if (flags.indexOf('rtl') !== -1) {
		document.documentElement.setAttribute('dir', 'rtl');
	}
	if (flags.indexOf('outline') !== -1) {
		var style = document.createElement('style');
		style.textContent = '* { outline: 1px solid rgba(255,0,0,0.25) !important; }';
		document.head.appendChild(style);
	}

	// Text transforms — defer briefly so LuCI's view has rendered first.
	if (flags.indexOf('pseudo-long') !== -1) {
		setTimeout(function () { walkText(document.body, pseudoLong); }, 1500);
	}
	if (flags.indexOf('pseudo-short') !== -1) {
		setTimeout(function () { walkText(document.body, pseudoShort); }, 1500);
	}
}

return baseclass.extend({
	__init__: function () {
		var flags = getFlags();
		if (!flags) return;
		showBanner(flags);
		applyFlags(flags);
		// Re-walk every 3 sec to catch dynamically-loaded content
		// (cards inject after page load)
		if (flags.indexOf('pseudo-long') !== -1 || flags.indexOf('pseudo-short') !== -1) {
			var fn = flags.indexOf('pseudo-long') !== -1 ? pseudoLong : pseudoShort;
			setInterval(function () { walkText(document.body, fn); }, 3000);
		}
	}
});
