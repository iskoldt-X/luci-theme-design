'use strict';
'require baseclass';
'require ui';

// Local helper: short alias for document.querySelector with null tolerance.
function qs(sel) { return document.querySelector(sel); }

// Animation helpers that replace jQuery's slideUp / slideDown ("fast" = 200 ms).
// Use max-height transitions so we don't need jQuery; cb runs at transition end.
function slideUp(el, cb) {
	if (!el) { if (cb) cb(); return; }
	el.style.overflow = 'hidden';
	el.style.maxHeight = el.scrollHeight + 'px';
	void el.offsetHeight; // force reflow so the first max-height takes effect
	el.style.transition = 'max-height 200ms ease';
	el.style.maxHeight = '0px';
	var done = function () {
		el.removeEventListener('transitionend', done);
		el.style.transition = '';
		el.style.maxHeight = '';
		el.style.overflow = '';
		if (cb) cb();
	};
	el.addEventListener('transitionend', done);
}

function slideDown(el, cb) {
	if (!el) { if (cb) cb(); return; }
	el.style.overflow = 'hidden';
	el.style.maxHeight = '0px';
	el.style.display = 'block';
	void el.offsetHeight;
	el.style.transition = 'max-height 200ms ease';
	el.style.maxHeight = el.scrollHeight + 'px';
	var done = function () {
		el.removeEventListener('transitionend', done);
		el.style.transition = '';
		el.style.maxHeight = '';
		el.style.overflow = '';
		el.style.display = '';
		if (cb) cb();
	};
	el.addEventListener('transitionend', done);
}

return baseclass.extend({
	__init__: function() {
		ui.menu.load().then(L.bind(this.render, this));
	},

	render: function(tree) {
		var node = tree,
		    url = '';

		this.renderModeMenu(node);

		if (L.env.dispatchpath.length >= 3) {
			for (var i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.renderTabMenu(node, url);
		}

		var showSide = qs('.showSide');
		if (showSide)
			showSide.addEventListener('click', ui.createHandlerFn(this, 'handleSidebarToggle'));

		var darkMask = qs('.darkMask');
		if (darkMask)
			darkMask.addEventListener('click', ui.createHandlerFn(this, 'handleSidebarToggle'));

		var loading = qs('.main > .loading');
		if (loading) {
			loading.style.opacity = '0';
			loading.style.visibility = 'hidden';
		}

		var mainLeft = qs('.main-left');
		if (mainLeft && window.innerWidth <= 992)
			mainLeft.style.width = '0';

		var mainRight = qs('.main-right');
		if (mainRight)
			mainRight.style.overflow = 'auto';

		window.addEventListener('resize', this.handleSidebarToggle, true);
	},

	handleMenuExpand: function(ev) {
		var a = ev.target, slide = a.parentNode, slide_menu = a.nextElementSibling;
		var collapse = false;

		// Snapshot the currently expanded <li>s BEFORE making any change.
		// The CSS rule that actually drives submenu visibility is
		//   .main > .main-left > .nav > .slide.active > ul { display: block }
		// — it keys off `.active` on the <li>, NOT on the inner <ul> or <a>.
		// Without maintaining <li>.active here, slideDown briefly shows the
		// submenu via its inline `display:block`, then transitionend's cleanup
		// hands control back to CSS, which immediately hides it again because
		// the parent <li> has no `.active`. Net effect: submenu expands and
		// instantly collapses. (Reported 2026-05-23 on ImmortalWrt 24.10.)
		var activeSlides = document.querySelectorAll(
			'.main .main-left .nav > li.slide.active'
		);

		activeSlides.forEach(function (activeSlide) {
			var ul = activeSlide.querySelector(':scope > ul.slide-menu');
			slideUp(ul, function () {
				activeSlide.classList.remove('active');
				if (ul) ul.classList.remove('active');
				if (ul && ul.previousElementSibling)
					ul.previousElementSibling.classList.remove('active');
			});
			if (!collapse && ul === slide_menu) {
				collapse = true;
			}
		});

		if (!slide_menu)
			return;

		if (!collapse) {
			var submenu = slide.querySelector('.slide-menu');
			if (submenu) {
				// Add <li>.active IMMEDIATELY (synchronously, before slideDown
				// starts) so the CSS keep-visible rule applies as soon as
				// slideDown's inline `display:block` is cleared on transitionend.
				slide.classList.add('active');
				slideDown(submenu, function () {
					slide_menu.classList.add('active');
					a.classList.add('active');
				});
			}
			a.blur();
		}
		ev.preventDefault();
		ev.stopPropagation();
	},

	renderMainMenu: function(tree, url, level) {
		var l = (level || 0) + 1,
		    ul = E('ul', { 'class': level ? 'slide-menu' : 'nav' }),
		    children = ui.menu.getChildren(tree);

		if (children.length == 0 || l > 2)
			return E([]);
		for (var i = 0; i < children.length; i++) {
			var isActive = ((L.env.dispatchpath[l] == children[i].name) && (L.env.dispatchpath[l - 1] == tree.name)),
				submenu = this.renderMainMenu(children[i], url + '/' + children[i].name, l),
				hasChildren = submenu.children.length;

			// Build class list as array to avoid "null active" bug from string coercion
			var liCls = [];
			if (hasChildren) liCls.push('slide');
			if (isActive)    liCls.push('active');
			var aCls = [];
			if (hasChildren) aCls.push('menu');
			if (isActive)    aCls.push('active');

			if (isActive)
				ul.classList.add('active');

			ul.appendChild(E('li', { 'class': liCls.length ? liCls.join(' ') : null }, [
				E('a', {
					'href': L.url(url, children[i].name),
					'click': (l == 1) ? ui.createHandlerFn(this, 'handleMenuExpand') : null,
					'class': aCls.length ? aCls.join(' ') : null,
					'data-node-name': children[i].name,
					'data-title': children[i].title.replace(/\s+/g, '_'),
				}, [_(children[i].title)]),
				submenu
			]));
		}

		if (l == 1) {
			var container = qs('#mainmenu');
			if (container) {
				container.appendChild(ul);
				container.style.display = '';
			}
		}

		return ul;
	},

	renderModeMenu: function(tree) {
		var ul = qs('#modemenu'),
		    children = ui.menu.getChildren(tree);

		if (!ul) return;

		for (var i = 0; i < children.length; i++) {
			var isActive = (L.env.requestpath.length ? children[i].name == L.env.requestpath[0] : i == 0);

			ul.appendChild(E('li', {}, [
				E('a', {
					'href': L.url(children[i].name),
					'class': isActive ? 'active' : null
				}, [ _(children[i].title) ])
			]));

			if (isActive)
				this.renderMainMenu(children[i], children[i].name);

			if (i > 0 && i < children.length)
				ul.appendChild(E('li', {'class': 'divider'}, [E('span')]))
		}

		if (children.length > 1)
			ul.parentElement.style.display = '';
	},

	renderTabMenu: function(tree, url, level) {
		var container = qs('#tabmenu'),
			l = (level || 0) + 1,
			ul = E('ul', { 'class': 'tabs' }),
			children = ui.menu.getChildren(tree),
			activeNode = null;

		if (!container || children.length == 0)
			return E([]);

		for (var i = 0; i < children.length; i++) {
			var isActive = (L.env.dispatchpath[l + 2] == children[i].name),
				activeClass = isActive ? ' active' : '',
				className = 'tabmenu-item-%s %s'.format(children[i].name, activeClass);

			ul.appendChild(E('li', { 'class': className }, [
				E('a', { 'href': L.url(url, children[i].name) }, [_(children[i].title)])
			]));

			if (isActive)
				activeNode = children[i];
		}

		container.appendChild(ul);
		container.style.display = '';

		// Recurse for nested tabs. The recursive call itself appends its own
		// <ul> to #tabmenu; doing an outer container.appendChild() on the
		// return value would re-append (i.e. move) the same node and produce
		// wrong DOM order at deeper levels.
		if (activeNode)
			this.renderTabMenu(activeNode, url + '/' + activeNode.name, l);

		return ul;
	},

	handleSidebarToggle: function(ev) {
		var width = window.innerWidth,
		    darkMask = qs('.darkMask'),
		    mainRight = qs('.main-right'),
		    mainLeft = qs('.main-left');

		if (!mainLeft || !mainRight || !darkMask) return;

		var open = mainLeft.style.width == '';

			if (width > 992 || ev.type == 'resize')
				open = true;
				
		darkMask.style.visibility = open ? '' : 'visible';
		darkMask.style.opacity = open ? '': 1;

		if (width <= 992)
			mainLeft.style.width = open ? '0' : '';
		else
			mainLeft.style.width = ''

		// 初始化设置，css后置设置导致刷新会闪现。
		mainLeft.style.transition = 'visibility 2000ms, width 200ms';
		mainLeft.style.visibility = open ? '' : 'visible';

		mainRight.style['overflow-y'] = open ? 'auto' : 'visible';

		// box-shadow handled via CSS @media in style.css instead of JS
	},
});

