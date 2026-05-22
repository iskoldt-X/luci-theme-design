'use strict';
'require baseclass';
'require ui';

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
	interceptLuCI: function() {
		if (typeof ui === 'undefined' || !ui.addNotification) return;
		var self = this;

		ui.addNotification = function(title, contents) {
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
	},

	show: function(type, message, opts) {
		opts = opts || {};
		var id = 'toast-' + (++this.idCounter);
		var duration = (opts.duration !== undefined) ? opts.duration : DEFAULT_DURATIONS[type];

		var children = [
			E('svg', { 'class': 'svg-icon toast-icon', 'aria-hidden': 'true' },
				E('use', { 'href': this.iconBase + '#' + (ICONS[type] || ICONS.info) })),
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
