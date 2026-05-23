'use strict';
'require baseclass';
'require ui';

// Step 83 (Round 13): SVG namespace helpers — see sparkline.js.
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
// Toast notification layer — upgrade.md §1.S2a
//
// Non-blocking corner toasts that replace LuCI's inline notification banner.
// 4 types:
//   success — green tick, auto-dismiss 3.5s
//   info    — blue, auto-dismiss 4s
//   warning — amber, auto-dismiss 5s
//   error   — red, NO auto-dismiss (user must close)
//
// Programmatic API (exposed on window):
//   toast.success('Configuration saved')
//   toast.info('Channel auto-selected')
//   toast.warning('DNS slow', { duration: 6000 })
//   toast.error('Failed to apply: ' + err.message)
//   toast.success('Wi-Fi restarted', { action: { label: _('Undo'), onClick: fn } })
//   var id = toast.info(_('Applying...'), { duration: 0 });
//   toast.dismiss(id);
//
// We also patch ui.addNotification so all of LuCI's existing inline alerts
// flow through toast automatically. No LuCI app code needs to change.
//
// All user-visible strings via _() per doc/upgrade.md §0.6.
// ─────────────────────────────────────────────────────────────────────────────

var DEFAULT_DURATIONS = {
	success: 3500,
	info:    4000,
	warning: 5000,
	error:   0       // 0 = persistent until user closes
};

var ICONS = {
	success: 'i-check-circle',
	info:    'i-info',
	warning: 'i-alert-triangle',
	error:   'i-alert-triangle'
};

return baseclass.extend({
	__init__: function() {
		this.idCounter = 0;
		this.iconBase  = (L.env && L.env.mediaurlbase ? L.env.mediaurlbase : '/luci-static/design') + '/icons.svg';

		this.mount();
		this.exposeGlobalAPI();
		this.interceptLuCI();
	},

	mount: function() {
		this.container = E('div', {
			'class':      'toast-container',
			'role':       'region',
			'aria-label': _('Notifications')
		});
		document.body.appendChild(this.container);
	},

	exposeGlobalAPI: function() {
		var self = this;
		window.toast = {
			success: function(msg, opts) { return self.show('success', msg, opts); },
			info:    function(msg, opts) { return self.show('info',    msg, opts); },
			warning: function(msg, opts) { return self.show('warning', msg, opts); },
			error:   function(msg, opts) { return self.show('error',   msg, opts); },
			dismiss: function(id)        { return self.dismiss(id); }
		};
	},

	// Patch ui.addNotification so existing LuCI app code routes through toast.
	// LuCI signature: addNotification(title, contents, ...classes)
	//   - title    : string | null
	//   - contents : DOM node, string, or array
	//   - classes  : variadic strings like 'warning', 'error', 'notice'
	// We can't replace the return value perfectly (LuCI returns the rendered
	// alert node and some callers .remove() it). We return a fake node that
	// callers can manipulate without crashing; the real toast still works.
	//
	// Step 49: defer-patch retry. The original implementation did a single
	// synchronous check on ui.addNotification at __init__ and silently
	// bailed if it wasn't there. On ImmortalWrt 24.10 / LuCI 26.x the ui
	// module is sometimes still wiring up addNotification at footer-script
	// run time → our wrap never happened and notifications fell through
	// to LuCI's inline banner. Poll for up to 10s (40 × 250ms).
	interceptLuCI: function() {
		this._interceptAttempts = 0;
		this._tryIntercept();
	},

	_tryIntercept: function() {
		var self = this;
		// Step 55: probe both the require-local `ui` and the LuCI singleton
		// `L.ui`. In LuCI 26.x they SHOULD reference the same object, but
		// the user's probe couldn't see `window.ui` directly, so we use
		// `L.ui` as the authoritative reference. Wrap both bindings to be
		// safe against future LuCI versions diverging the two.
		var localUi = (typeof ui !== 'undefined') ? ui : null;
		var globalUi = (window.L && window.L.ui) ? window.L.ui : null;
		// Pick whichever has addNotification ready
		var primary = (localUi && localUi.addNotification) ? localUi
		            : (globalUi && globalUi.addNotification) ? globalUi
		            : null;

		if (!primary) {
			if ((self._interceptAttempts = (self._interceptAttempts || 0) + 1) > 40) return;
			setTimeout(L.bind(self._tryIntercept, self), 250);
			return;
		}
		if (primary.addNotification && primary.addNotification.__designWrapped) {
			// Already wrapped — but still apply to the other ref if they diverge
			if (globalUi && globalUi !== primary && globalUi.addNotification &&
			    !globalUi.addNotification.__designWrapped) {
				globalUi.addNotification = primary.addNotification;
			}
			return;
		}

		var wrapped = function(title, contents) {
			// Type detection from variadic classes
			var type = 'info';
			for (var i = 2; i < arguments.length; i++) {
				var cls = arguments[i];
				if (typeof cls !== 'string') continue;
				if (cls === 'error' || cls === 'danger')   { type = 'error';   break; }
				if (cls === 'warning')                      { type = 'warning'; break; }
				if (cls === 'notice' || cls === 'success')  { type = 'success'; break; }
			}

			// Extract text from contents
			var text = '';
			if (contents) {
				if (Array.isArray(contents)) {
					text = contents.map(function(n) {
						if (n && n.nodeType) return n.textContent || '';
						return String(n || '');
					}).join(' ').trim();
				} else if (contents.nodeType) {
					text = contents.textContent || contents.innerText || '';
				} else {
					text = String(contents);
				}
			}

			var msg = title ? (text ? title + ': ' + text : title) : text;
			self.show(type, msg);

			// Return a detached node so old callers that .remove() it work
			return E('div', { 'class': 'cbi-notification-stub', 'style': 'display:none' });
		};
		wrapped.__designWrapped = true;

		// Step 55: assign to BOTH refs. In LuCI 26.x both point to the same
		// object so the second assignment is a no-op, but harmless.
		primary.addNotification = wrapped;
		if (globalUi && globalUi !== primary) {
			globalUi.addNotification = wrapped;
		}
		if (localUi && localUi !== primary && localUi !== globalUi) {
			localUi.addNotification = wrapped;
		}

		// Step 55: explicit success log — user's probe showed
		// `toastWrapped: false` from window.ui check, but that was a
		// misleading test (window.ui != L.ui in LuCI 26.x). This log
		// gives us unambiguous "wrap landed" confirmation in DevTools.
		if (console && console.log) {
			console.log('toast: ui.addNotification wrap installed', {
				wrappedLocal:  !!(localUi && localUi.addNotification && localUi.addNotification.__designWrapped),
				wrappedGlobal: !!(globalUi && globalUi.addNotification && globalUi.addNotification.__designWrapped),
				sameRef:       localUi === globalUi
			});
		}
	},

	show: function(type, message, opts) {
		opts = opts || {};
		var id = 'toast-' + (++this.idCounter);
		var duration = (opts.duration !== undefined) ? opts.duration : DEFAULT_DURATIONS[type];

		var children = [
			svgEl('svg', { 'class': 'svg-icon toast-icon', 'aria-hidden': 'true' },
				svgUse(this.iconBase + '#' + (ICONS[type] || ICONS.info))),
			E('div', { 'class': 'toast-body' }, message)
		];

		// Optional action button (e.g. "Undo")
		if (opts.action && opts.action.label && typeof opts.action.onClick === 'function') {
			children.push(E('button', {
				'type':  'button',
				'class': 'toast-action',
				'click': L.bind(function() {
					try { opts.action.onClick(); } catch (e) { /* swallow user errors */ }
					this.dismiss(id);
				}, this)
			}, opts.action.label));
		}

		// Close button (always present, important for errors)
		children.push(E('button', {
			'type':       'button',
			'class':      'toast-close',
			'aria-label': _('Dismiss'),
			'click':      L.bind(this.dismiss, this, id)
		}, '×'));   // × multiplication sign

		var toastEl = E('div', {
			'id':         id,
			'class':      'toast toast-' + type,
			'role':       type === 'error' ? 'alert' : 'status',
			'aria-live':  type === 'error' ? 'assertive' : 'polite',
			'aria-atomic': 'true'
		}, children);

		this.container.appendChild(toastEl);

		if (duration > 0) {
			setTimeout(L.bind(this.dismiss, this, id), duration);
		}

		return id;
	},

	dismiss: function(id) {
		var el = document.getElementById(id);
		if (!el) return;
		el.classList.add('toast-leaving');
		// After leave animation, remove from DOM
		setTimeout(function() {
			if (el.parentNode) el.parentNode.removeChild(el);
		}, 220);
	}
});
