# Copyright (C) 2021-2023 luci-theme-design contributors
# Licensed to the public under the Apache License 2.0 (see LICENSE in repository root)
# The OpenWrt Makefile template below is GPL-2.0-or-later, which is compatible with
# Apache 2.0 via GPLv3. Both license declarations are intentional.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Design Theme
LUCI_DEPENDS:=
PKG_VERSION:=6.0
PKG_RELEASE:=20230224
PKG_LICENSE:=Apache-2.0

include $(TOPDIR)/feeds/luci/luci.mk

# Ensure theme-provided CGI scripts + init.d services are executable.
# Required because the ipk packing system can lose +x bits and uhttpd
# refuses to exec a non-executable CGI / procd refuses non-exec init scripts.
# Step 115 (Round 31): added init.d + uci-defaults paths.
define Package/$(PKG_NAME)/postinst-pkg
#!/bin/sh
[ -d "$${IPKG_INSTROOT}/www/cgi-bin/design" ] && \
    chmod -R +x "$${IPKG_INSTROOT}/www/cgi-bin/design/" 2>/dev/null
[ -f "$${IPKG_INSTROOT}/etc/init.d/design-host-acct" ] && \
    chmod +x "$${IPKG_INSTROOT}/etc/init.d/design-host-acct" 2>/dev/null
[ -f "$${IPKG_INSTROOT}/etc/uci-defaults/40_design-host-acct" ] && \
    chmod +x "$${IPKG_INSTROOT}/etc/uci-defaults/40_design-host-acct" 2>/dev/null
exit 0
endef

# Clean shutdown on package removal — stop the acct service, drop the
# nftables table, remove the cron entry. Without this, the table lives
# on after uninstall and shows zombie counters.
define Package/$(PKG_NAME)/prerm
#!/bin/sh
if [ -x /etc/init.d/design-host-acct ]; then
    /etc/init.d/design-host-acct stop 2>/dev/null
    /etc/init.d/design-host-acct disable 2>/dev/null
fi
# Remove the cron entry added by uci-defaults/40_design-host-acct
if [ -f /etc/crontabs/root ]; then
    sed -i '/design-host-acct refresh/d' /etc/crontabs/root 2>/dev/null
    /etc/init.d/cron restart 2>/dev/null
fi
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
