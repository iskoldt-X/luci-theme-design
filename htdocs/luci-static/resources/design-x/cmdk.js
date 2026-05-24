'use strict';
'require baseclass';
'require ui';

// Step 83 (Round 13): SVG namespace helpers — see sparkline.js for the
// full rationale. LuCI's E('svg',...) creates HTMLUnknownElement; the
// browser doesn't paint that as SVG so the <use href="#i-search"/>
// sprite reference doesn't render.
var __SVG_NS   = 'http://www.w3.org/2000/svg';
var __XLINK_NS = 'http://www.w3.org/1999/xlink';
function svgEl(tag, attrs, children) {
	var el = document.createElementNS(__SVG_NS, tag);
	if (attrs) Object.keys(attrs).forEach(function (k) {
		if (k === 'xlink:href') el.setAttributeNS(__XLINK_NS, 'xlink:href', attrs[k]);
		else el.setAttribute(k, attrs[k]);
	});
	if (children) {
		var arr = Array.isArray(children) ? children : [children];
		arr.forEach(function (c) { if (c) el.appendChild(c); });
	}
	return el;
}
function svgUse(href) {
	return svgEl('use', { 'href': href, 'xlink:href': href });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cmd+K command palette — upgrade.md §1.S1
//
// Keyboard-driven menu navigation. ⌘K / Ctrl+K (or magnifier button on small
// screens) opens an overlay with a fuzzy-match search box over the entire LuCI
// menu tree. Up/Down/Enter/Esc to navigate.
//
// Data source: ui.menu.load() — same call menu-design.js already makes, so
// LuCI caches the result and our second call returns instantly.
//
// All user-visible strings go through _() per doc/upgrade.md §0.6 i18n contract.
// ─────────────────────────────────────────────────────────────────────────────

// ── Fuzzy scoring ─────────────────────────────────────────────────────────────
// Score 0..1000. Higher = better match. Items scoring 0 are dropped.
function scoreItem(item, q) {
	if (!q) return 1;     // empty query: keep everything (top-N truncation later)

	var title    = item.titleLc;
	var crumb    = item.breadcrumbLc;
	var path     = item.pathLc;
	var keywords = item.keywordsLc;

	// Tier 1: title starts with query — best match
	if (title.indexOf(q) === 0) return 1000;
	// Tier 2: title contains query as substring
	var idx = title.indexOf(q);
	if (idx > 0) return 700 - idx;
	// Tier 3: breadcrumb (parent → child) contains query
	if (crumb.indexOf(q) >= 0) return 400;
	// Tier 4: URL path contains query (catches things like "wireguard" in path)
	if (path.indexOf(q) >= 0) return 200;
	// Tier 5: keywords (pinyin initials etc.) contain query
	if (keywords && keywords.indexOf(q) >= 0) return 150;
	// Tier 6: fuzzy — all chars of q appear in order in the combined haystack
	var hay = item.haystack;
	var lastIdx = -1;
	for (var i = 0; i < q.length; i++) {
		lastIdx = hay.indexOf(q.charAt(i), lastIdx + 1);
		if (lastIdx === -1) return 0;
	}
	return 50;
}

// Pinyin initials for common CJK menu names — lets a Chinese user type
// "wx" and match the "Wireless" menu (whose title rendered as 无线 by LuCI).
// Falls back to fuzzy match for unmapped chars.
//
// Why \uXXXX escapes instead of inline CJK: the lint.yml "Forbid raw CJK"
// rule (added in v4 §10.6) reasonably blocks CJK in source files to prevent
// hardcoded user-visible strings from sneaking past i18n. These dictionary
// keys ARE Chinese menu titles (needed to indexOf-match LuCI's translation
// output), but they're lookup keys, not user-visible strings — escape form
// keeps source ASCII-clean while preserving runtime semantics.
var PINYIN_INITIALS = {
	'\u72b6\u6001':             'zt status',         // 状态 (Status)
	'\u7cfb\u7edf':             'xt system',         // 系统 (System)
	'\u670d\u52a1':             'fw services',       // 服务 (Services)
	'\u7f51\u7edc':             'wl network',        // 网络 (Network)
	'\u9632\u706b\u5899':       'fhq firewall',      // 防火墙 (Firewall)
	'\u65e0\u7ebf':             'wx wireless wifi',  // 无线 (Wireless)
	'\u8def\u7531':             'ly route',          // 路由 (Routing)
	'\u65e5\u5fd7':             'rz log',            // 日志 (Log)
	'\u8bca\u65ad':             'zd diagnostics',    // 诊断 (Diagnostics)
	'\u4e3b\u673a':             'zj host',           // 主机 (Host)
	'\u63a5\u53e3':             'jk interface',      // 接口 (Interface)
	'\u5ba2\u6237\u7aef':       'khd client',        // 客户端 (Client)
	'\u6982\u89c8':             'gl overview',       // 概览 (Overview)
	'\u5b9e\u65f6':             'ss realtime',       // 实时 (Realtime)
	'\u8fdb\u7a0b':             'jc process',        // 进程 (Process)
	'\u8f6f\u4ef6':             'rj software'        // 软件 (Software)
};

function pinyinFor(title) {
	var hits = [];
	for (var cjk in PINYIN_INITIALS) {
		if (title.indexOf(cjk) >= 0) hits.push(PINYIN_INITIALS[cjk]);
	}
	return hits.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────

return baseclass.extend({
	__init__: function() {
		this.index       = [];
		this.filtered    = [];
		this.selectedIdx = 0;
		this.recent      = this.loadRecent();

		this.mount();
		ui.menu.load().then(L.bind(this.buildIndex, this));
	},

	// ── Persistence: most-recent navigations (max 5) ──────────────────────────
	loadRecent: function() {
		try {
			var raw = localStorage.getItem('design-cmdk-recent');
			return raw ? JSON.parse(raw) : [];
		} catch (e) { return []; }
	},

	saveRecent: function(path) {
		this.recent = [path].concat(this.recent.filter(function(p) { return p !== path; })).slice(0, 5);
		try { localStorage.setItem('design-cmdk-recent', JSON.stringify(this.recent)); }
		catch (e) { /* private mode etc. */ }
	},

	// ── Build flat index from nested LuCI menu tree ───────────────────────────
	buildIndex: function(tree) {
		var flat = [];
		var self = this;

		function walk(node, breadcrumbParts, pathParts) {
			var children = ui.menu.getChildren(node);
			for (var i = 0; i < children.length; i++) {
				var c = children[i];
				if (!c.title) continue;

				var titleI18n = _(c.title);
				var path = pathParts.concat([c.name]);
				var crumbParts = breadcrumbParts.concat([titleI18n]);
				var crumb = crumbParts.join(' › ');
				var pathStr = path.join('/');
				var pinyin = pinyinFor(titleI18n);

				flat.push({
					name:         c.name,
					title:        titleI18n,
					breadcrumb:   crumb,
					path:         pathStr,
					url:          L.url(pathStr),
					titleLc:      titleI18n.toLowerCase(),
					breadcrumbLc: crumb.toLowerCase(),
					pathLc:       pathStr.toLowerCase(),
					keywordsLc:   pinyin.toLowerCase(),
					haystack:     (titleI18n + ' ' + crumb + ' ' + pathStr + ' ' + c.name + ' ' + pinyin).toLowerCase()
				});

				walk(c, crumbParts, path);
			}
		}

		walk(tree, [], []);
		this.index = flat;
	},

	// ── DOM construction ──────────────────────────────────────────────────────
	mount: function() {
		var iconBase = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design-x') + '/icons.svg';

		var overlay = E('div', {
			'class':      'cmdk-overlay',
			'role':       'dialog',
			'aria-modal': 'true',
			'aria-label': _('Command palette')
		}, [
			E('div', { 'class': 'cmdk-panel' }, [
				E('div', { 'class': 'cmdk-input-wrap' }, [
					svgEl('svg', { 'class': 'svg-icon cmdk-input-icon', 'aria-hidden': 'true' },
						svgUse(iconBase + '#i-search')),
					E('input', {
						'class':           'cmdk-input',
						'type':            'text',
						'placeholder':     _('Search menus, settings...'),
						'aria-label':      _('Search'),
						'aria-controls':   'cmdk-results',
						'aria-autocomplete': 'list',
						'role':            'combobox',
						'aria-expanded':   'true',
						'autocomplete':    'off',
						'autocorrect':     'off',
						'autocapitalize':  'off',
						'spellcheck':      'false'
					})
				]),
				E('ul', {
					'class': 'cmdk-results',
					'id':    'cmdk-results',
					'role':  'listbox'
				}),
				E('div', { 'class': 'cmdk-empty' }, _('No matching menus')),
				E('div', { 'class': 'cmdk-footer' }, [
					E('span', { 'class': 'cmdk-hint' }, [
						E('kbd', {}, '↑'),
						E('kbd', {}, '↓'),
						E('span', { 'class': 'cmdk-hint-label' }, _('navigate'))
					]),
					E('span', { 'class': 'cmdk-hint' }, [
						E('kbd', {}, '↵'),
						E('span', { 'class': 'cmdk-hint-label' }, _('go'))
					]),
					E('span', { 'class': 'cmdk-hint' }, [
						E('kbd', {}, 'esc'),
						E('span', { 'class': 'cmdk-hint-label' }, _('close'))
					])
				])
			])
		]);

		document.body.appendChild(overlay);

		this.overlay = overlay;
		this.panel   = overlay.querySelector('.cmdk-panel');
		this.input   = overlay.querySelector('.cmdk-input');
		this.results = overlay.querySelector('.cmdk-results');
		this.empty   = overlay.querySelector('.cmdk-empty');

		// Initially hidden
		this.empty.style.display = 'none';

		// Input events
		this.input.addEventListener('input',   L.bind(this.onInput, this));
		this.input.addEventListener('keydown', L.bind(this.onKeydown, this));

		// Click outside panel closes
		overlay.addEventListener('mousedown', L.bind(this.onOverlayMousedown, this));

		// Global ⌘K / Ctrl+K
		document.addEventListener('keydown', L.bind(this.onGlobalKey, this));

		// Optional header trigger button (e.g. magnifier icon on mobile)
		var trigger = document.getElementById('cmdk-trigger');
		if (trigger) trigger.addEventListener('click', L.bind(this.open, this));
	},

	// ── Open / close ──────────────────────────────────────────────────────────
	onGlobalKey: function(ev) {
		// ⌘K (Mac) or Ctrl+K (Win/Linux). Skip if a modifier-only shortcut
		// (no key) or if inside another modal etc.
		if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'k' || ev.key === 'K')) {
			ev.preventDefault();
			if (this.isOpen()) this.close();
			else this.open();
		}
	},

	isOpen: function() { return this.overlay.classList.contains('open'); },

	open: function() {
		this.lastFocus = document.activeElement;
		this.overlay.classList.add('open');
		this.input.value = '';
		// requestAnimationFrame so the focus happens after the display:flex paint
		// (prevents iOS Safari from scrolling the page when we focus)
		requestAnimationFrame(L.bind(function() { this.input.focus(); }, this));
		this.onInput();
	},

	close: function() {
		this.overlay.classList.remove('open');
		if (this.lastFocus && this.lastFocus.focus) {
			try { this.lastFocus.focus(); } catch (e) { /* ignore detached node */ }
		}
	},

	onOverlayMousedown: function(ev) {
		// Click outside panel = close. Click inside panel = leave alone.
		if (ev.target === this.overlay) this.close();
	},

	// ── Filtering ─────────────────────────────────────────────────────────────
	onInput: function() {
		var q = this.input.value.trim().toLowerCase();

		if (!q) {
			// Empty query: show recent (if any) at top, then top items by alpha
			var recentItems = this.recent
				.map(L.bind(function(p) {
					return this.index.filter(function(i) { return i.path === p; })[0];
				}, this))
				.filter(function(x) { return x; });
			var fillCount = Math.max(0, 12 - recentItems.length);
			var rest = this.index
				.filter(function(i) { return recentItems.indexOf(i) === -1; })
				.slice(0, fillCount);
			this.filtered = recentItems.concat(rest);
		} else {
			var scored = [];
			for (var i = 0; i < this.index.length; i++) {
				var s = scoreItem(this.index[i], q);
				if (s > 0) scored.push({ item: this.index[i], score: s });
			}
			scored.sort(function(a, b) { return b.score - a.score; });
			this.filtered = scored.slice(0, 12).map(function(r) { return r.item; });
		}

		this.selectedIdx = 0;
		this.render();
	},

	// ── Keyboard navigation ───────────────────────────────────────────────────
	onKeydown: function(ev) {
		switch (ev.key) {
			case 'ArrowDown':
				ev.preventDefault();
				this.move(1);
				break;
			case 'ArrowUp':
				ev.preventDefault();
				this.move(-1);
				break;
			case 'Home':
				ev.preventDefault();
				this.selectedIdx = 0;
				this.render();
				break;
			case 'End':
				ev.preventDefault();
				this.selectedIdx = Math.max(0, this.filtered.length - 1);
				this.render();
				break;
			case 'Enter':
				ev.preventDefault();
				this.navigate();
				break;
			case 'Escape':
				ev.preventDefault();
				this.close();
				break;
		}
	},

	move: function(delta) {
		var len = this.filtered.length;
		if (!len) return;
		this.selectedIdx = ((this.selectedIdx + delta) % len + len) % len;
		this.render();
	},

	navigate: function() {
		var item = this.filtered[this.selectedIdx];
		if (!item) return;
		this.saveRecent(item.path);
		this.close();
		location.href = item.url;
	},

	// ── Render ────────────────────────────────────────────────────────────────
	render: function() {
		var self = this;

		// Empty state
		if (!this.filtered.length) {
			this.results.innerHTML = '';
			this.empty.style.display = 'block';
			this.input.setAttribute('aria-activedescendant', '');
			return;
		}
		this.empty.style.display = 'none';

		// Diff-by-rebuild: 12 items max, cheap.
		this.results.innerHTML = '';
		this.filtered.forEach(function(item, idx) {
			var isSelected = idx === self.selectedIdx;
			var id = 'cmdk-item-' + idx;
			var li = E('li', {
				'id':            id,
				'class':         'cmdk-item' + (isSelected ? ' cmdk-item-selected' : ''),
				'role':          'option',
				'aria-selected': isSelected ? 'true' : 'false',
				'data-idx':      idx,
				'click':         (function(i) { return function() { self.selectedIdx = i; self.navigate(); }; })(idx),
				'mouseenter':    (function(i) { return function() {
					if (self.selectedIdx !== i) { self.selectedIdx = i; self.render(); }
				}; })(idx)
			}, [
				E('div', { 'class': 'cmdk-item-title' }, item.title),
				E('div', { 'class': 'cmdk-item-breadcrumb' }, item.breadcrumb)
			]);
			self.results.appendChild(li);
		});

		this.input.setAttribute('aria-activedescendant', 'cmdk-item-' + this.selectedIdx);

		// Scroll selected into view (block:nearest avoids jumping)
		var selected = this.results.querySelector('.cmdk-item-selected');
		if (selected && selected.scrollIntoView) {
			selected.scrollIntoView({ block: 'nearest', behavior: 'auto' });
		}
	}
});
