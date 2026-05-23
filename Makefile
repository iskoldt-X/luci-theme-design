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

# Ensure theme-provided CGI scripts under /www/cgi-bin/design/ are executable.
# Required for Phase 2+ features (sparkline temp probe, WAN ping, speedtest).
# See doc/upgrade.md §0.5.
define Package/$(PKG_NAME)/postinst-pkg
#!/bin/sh
[ -d "$${IPKG_INSTROOT}/www/cgi-bin/design" ] && \
    chmod -R +x "$${IPKG_INSTROOT}/www/cgi-bin/design/" 2>/dev/null
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
