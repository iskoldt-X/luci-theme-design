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
LUCI_DEPENDS:=+luci-base +luci-lua-runtime
# Round 45 Step 232: dropped per-host bandwidth accounting entirely
# (Live Competition widget + Round 31 nft-bridge daemon + Round 44
# conntrack-poll daemon all removed). Remaining deps are only
# luci-base + luci-lua-runtime (for the Lua streaming controller at
# admin/design-x/{ping,download,upload}). For Round 44's full saga
# see doc/styling-progress.md "Round 44" + memory/sfo-bypasses-
# conntrack-events.md / memory/ucode-socket-no-netlink.md.

# Hook definitions MUST come BEFORE include luci.mk — luci.mk's trailing
# `$(eval $(call BuildPackage,...))` materialises the package definition,
# at which point Package/<name>/<hook> variables are resolved.  Defining
# them afterwards is a silent no-op (Codex P1-3, observed Round 42).
#
# Round 42 Step 163: rpcd ubus object script needs +x. The IPKG_INSTROOT
# guard around the rpcd reload ensures we only call /etc/init.d/rpcd at
# real install time (target), not at ipk pack time (fakeroot).


define Package/$(PKG_NAME)/postinst-pkg
#!/bin/sh
[ -f "$${IPKG_INSTROOT}/usr/libexec/rpcd/luci-theme-design-x" ] && \
    chmod +x "$${IPKG_INSTROOT}/usr/libexec/rpcd/luci-theme-design-x" 2>/dev/null
if [ "$${IPKG_INSTROOT}" = "" ] && [ -x /etc/init.d/rpcd ]; then
    /etc/init.d/rpcd reload 2>/dev/null
fi
exit 0
endef

# Round 45 Step 232: prerm hook was Round 31/44 daemon shutdown. Both
# daemons are gone, so the hook reduces to a no-op. Left as an empty
# define rather than removed so future installs that need a prerm
# trigger have a place to hang it without re-discovering the hook
# definition order constraint (Codex P1-3).
define Package/$(PKG_NAME)/prerm
#!/bin/sh
# Step 232: clean up any lingering Round 44 daemon state on upgrade
# from a pre-232 install. New installs are no-ops here.
for svc in design-host-acct design-host-acct-uc; do
    if [ -x "/etc/init.d/$$svc" ]; then
        "/etc/init.d/$$svc" stop 2>/dev/null
        "/etc/init.d/$$svc" disable 2>/dev/null
        rm -f "/etc/init.d/$$svc" 2>/dev/null
    fi
done
rm -f /usr/sbin/design-host-acct.sh /usr/sbin/design-host-acct.uc 2>/dev/null
rm -f /etc/uci-defaults/40_design-host-acct \
      /etc/uci-defaults/45_design-conntrack-acct \
      /etc/sysctl.d/11-design-conntrack-acct.conf 2>/dev/null
if [ -f /etc/crontabs/root ]; then
    sed -i '/design-host-acct refresh/d' /etc/crontabs/root 2>/dev/null
    [ -x /etc/init.d/cron ] && /etc/init.d/cron restart 2>/dev/null
fi
# Step 242 (Round 46): wipe Block feature state on package removal so
# uninstalling the theme doesn't leave a dangling nftables table that
# silently keeps dropping a previously-blocked MAC's traffic.
# IPKG_INSTROOT guard: only touch live kernel when we're on the target,
# not in the IPK pack fakeroot.
if [ "$${IPKG_INSTROOT}" = "" ]; then
    nft delete table inet design_x 2>/dev/null
fi
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

define theme_sed_version
	sed -i 's/@@PKG_VERSION@@-@@PKG_RELEASE@@/$(PKG_VERSION)-$(PKG_RELEASE)/g' \
		$(PKG_BUILD_DIR)/root/usr/share/ucode/luci/template/themes/design-x/header.ut
endef
Hooks/Prepare/Post += theme_sed_version

# call BuildPackage - OpenWrt buildroot signature
