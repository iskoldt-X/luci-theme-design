# Copyright (C) 2021-2023 luci-theme-design contributors
# Round 42 fork: continued as luci-theme-design-x.
# Licensed to the public under the Apache License 2.0 (see LICENSE in repository root)
# The OpenWrt Makefile template below is GPL-2.0-or-later, which is compatible with
# Apache 2.0 via GPLv3. Both license declarations are intentional.

include $(TOPDIR)/rules.mk

# PKG_NAME is set explicitly (rather than inherited from $(notdir $(CURDIR)))
# so the package keeps the design-x identity regardless of which directory
# downstream users clone us into. luci.mk uses `?=`, so this assignment wins.
PKG_NAME:=luci-theme-design-x
PKG_VERSION:=6.0
PKG_RELEASE:=20260524
PKG_LICENSE:=Apache-2.0

# Conflicts with the legacy package: both ship to /www/luci-static/design-x/
# is impossible (one would clobber the other), and historically both also
# claimed /www/luci-static/resources/icons/*.svg paths now resolved in
# Step 157. Forcing opkg-level mutual exclusion gives users a clean
# "remove old → install new" upgrade path instead of mysterious file
# conflicts.
PKG_CONFLICTS:=luci-theme-design

LUCI_TITLE:=Design Theme (luci-theme-design-x fork, Round 42)
LUCI_DESCRIPTION:=Modern LuCI theme. Round 42 fork from luci-theme-design \
  to escape file-collisions with immortalwrt 24.10's luci-base. Installs \
  to /www/luci-static/design-x/, mutually exclusive with the legacy \
  luci-theme-design package via PKG_CONFLICTS.
LUCI_DEPENDS:=+luci-base

# Hook definitions MUST come BEFORE include luci.mk — luci.mk's trailing
# `$(eval $(call BuildPackage,...))` materialises the package definition,
# at which point Package/<name>/<hook> variables are resolved.  Defining
# them afterwards is a silent no-op (Codex P1-3, observed Round 42).
#
# Step 115 (Round 31): added init.d + uci-defaults +x guards. The ipk
# packing pipeline can lose the +x bit on files; uhttpd refuses to exec
# non-executable CGI, procd refuses non-exec init scripts.

define Package/$(PKG_NAME)/postinst-pkg
#!/bin/sh
[ -d "$${IPKG_INSTROOT}/www/cgi-bin/design" ] && \
    chmod -R +x "$${IPKG_INSTROOT}/www/cgi-bin/design/" 2>/dev/null
[ -f "$${IPKG_INSTROOT}/etc/init.d/design-host-acct" ] && \
    chmod +x "$${IPKG_INSTROOT}/etc/init.d/design-host-acct" 2>/dev/null
[ -f "$${IPKG_INSTROOT}/etc/uci-defaults/40_design-host-acct" ] && \
    chmod +x "$${IPKG_INSTROOT}/etc/uci-defaults/40_design-host-acct" 2>/dev/null
# Round 42 Step 163: rpcd ubus object script needs +x. The IPKG_INSTROOT
# guard around the rpcd reload ensures we only call /etc/init.d/rpcd at
# real install time (target), not at ipk pack time (fakeroot).
[ -f "$${IPKG_INSTROOT}/usr/libexec/rpcd/luci-theme-design-x" ] && \
    chmod +x "$${IPKG_INSTROOT}/usr/libexec/rpcd/luci-theme-design-x" 2>/dev/null
if [ "$${IPKG_INSTROOT}" = "" ] && [ -x /etc/init.d/rpcd ]; then
    /etc/init.d/rpcd reload 2>/dev/null
fi
exit 0
endef

# Clean shutdown on package removal — stop the acct service, remove the
# cron entry. Without this, the cron line lives on after uninstall and
# fails silently every 5 minutes.
define Package/$(PKG_NAME)/prerm
#!/bin/sh
if [ -x /etc/init.d/design-host-acct ]; then
    /etc/init.d/design-host-acct stop 2>/dev/null
    /etc/init.d/design-host-acct disable 2>/dev/null
fi
if [ -f /etc/crontabs/root ]; then
    sed -i '/design-host-acct refresh/d' /etc/crontabs/root 2>/dev/null
    /etc/init.d/cron restart 2>/dev/null
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
