# Luci-Theme-Design 进阶升级计划（Upgrade Proposal v2）

> v1 起草时间：2026-05-22
> **v2 修订时间：2026-05-22**（同日，对照源码 / OpenWrt 实情核查 + 用户拍板范围后）
> 前置：[styling-progress.md](styling-progress.md) 视觉系统升级已完成 20 个 Step
> 关联：[finalplan.md](finalplan.md) 代码健康度 31/32 修复已完成
> 性质：**功能性**升级（不只是视觉），让主题从"漂亮的管理面板"变成"实用的控制台"
> 配套预览：[upgrade-preview.html](upgrade-preview.html) — 单文件可交互 demo

---

## 🎯 v2 修订摘要（读这一节就够）

### 范围决定（用户 2026-05-22 拍板）

| 决定 | 影响 |
|---|---|
| ❌ 删除 **B2 Pull-to-Refresh** | 手势冲突调试成本高、桌面用户零价值 |
| ❌ 删除 **B3 系统健康分** | v1 自评"做作"，且会让用户对小波动焦虑 |
| ✅ 其他全部保留**在主题包内** | 不拆分独立 `luci-app-*`，换主题 = 拿到全套体验 |
| ✅ 新增**「渐进增强 / 优雅降级」**原则（§0.5） | 依赖外部包的功能在缺失时显示样式化引导，安装后自动启用 |
| ✅ 接受**主题包带 CGI 脚本** | v1 隐含禁止，v2 明确允许（部署到 `/www/cgi-bin/design/`） |

### 事实性修正（v1 写错的点）

| v1 写法 | v2 修正 |
|---|---|
| `fetch('/cgi-bin/luci/admin/status/sysinfo').then(r=>r.json())` | LuCI 该 endpoint 返回 HTML view，**不是 JSON**。改为 ubus call `system.info`（见 S3） |
| CGI 脚本放在 `htdocs/luci-static/design/speedtest/*.cgi` | `/luci-static/` 是 uhttpd 静态资源目录，**不会执行 CGI**。改部署到 `root/www/cgi-bin/design/`（见 §0.5、A1、A5） |
| "拦截 `ui.addNotification` 让每次保存都顺滑" | 全屏"应用配置" modal 由 `ui.changes.displayChanges()` 渲染，**不走** notification。拆为 **S2a**（通用 toast 层）+ **S2b**（应用变更体验重塑，吸收原 B4） |
| 累计工时 ~36h | 含 a11y / i18n / 移动端 / 错误兜底实际 **~70h ≈ 1.5–2 周全职** |
| CSS gzip ≤ 25 KB · JS gzip ≤ 15 KB | 加完 Cmd+K + sparkline + WAN + 测速 + 设备列表 + 流量分析必破。**v2 提到 35 / 35 KB**，仍远低于普通 Web app |

### 实施波次（v2 重排）

| 波次 | 范围 | 工时 | 部署复杂度 |
|---|---|---|---|
| 第一波 | 纯主题增量（Cmd+K / Toast / Bottom Sheet / Lucide 完整迁移） | ~16h | 零（仍是纯静态资源） |
| 第二波 | CGI 基础设施 + 实时数据（Sparkline / WAN Hero / 测速） | ~18h | 引入 `/www/cgi-bin/design/` |
| 第三波 | 交互深化（设备列表 / 快速操作 / 应用变更重塑） | ~15h | 不增加 |
| 第四波 | 流量分析渐进增强（nlbw 装/未装两套 UI） | ~10h | 不增加 |
| 长期 | 工程优化（CSS 拆分 / i18n 压测 / Lighthouse CI / 兼容矩阵） | ~11h | 独立 PR |
| **合计** | | **~70h** | |

### 📊 实施进度（2026-05-23 更新）

执行细节见 [styling-progress.md §4](styling-progress.md)，task 跟踪见 session task list。

| Task | 提案章节 | 工时 | 状态 |
|---|---|---|---|
| **第一波 — 纯主题增量** | | **16h** | **✅ 完成** |
| T3 S1 Cmd+K 命令面板 | §1.S1 | 8h | ✅ shipped (4278ed3..[next]) |
| T4 S2a Toast 通知层 | §1.S2a | 3h | ✅ shipped (本批) |
| T5 B1 移动端 Bottom Sheet | §3.B1 | 2h | ✅ shipped (本批) |
| T6 C2 Lucide SVG 迁移（主菜单） | §4.C2 | 3h | ✅ shipped (本批) — `::after` 箭头 + 状态图标下次清理 |
| **Phase 0 — 基础设施** | | **40 min** | **✅ 完成** |
| T1 nightly pre-release 修复 | — | 30min | ✅ shipped (本批) — perms 移到 workflow-level |
| T2 Node 24 actions 升级 | — | 10min | ✅ shipped (本批) — v4 → v5 + escape env |
| **第二波 — CGI + 实时数据** | | **18h** | ⏳ 下批 |
| T7 §0.5 CGI 基础设施（blocker） | §0.5 | 2h | ⏳ |
| T8 S3 Sparkline / Live Metrics | §1.S3 | 6h | ⏳ |
| T9 A1 WAN Hero | §2.A1 | 6h | ⏳ |
| T10 A5 Wi-Fi/LAN 测速 | §2.A5 | 4h | ⏳ |
| **第三波 — 交互深化** | | **15h** | ⏳ |
| T11 A2 设备列表 + OUI | §2.A2 | 7h | ⏳ |
| T12 A3 快速操作浮层 | §2.A3 | 3h | ⏳ |
| T13 S2b 应用变更体验重塑 | §1.S2b | 5h | ⏳ |
| **第四波 — 流量分析** | | **10h** | ⏳ |
| T14 D2 流量分析（渐进增强） | §5.D2 | 10h | ⏳ |
| **长期 — 工程加固** | | **11h** | ⏳ |
| T15 C1 CSS 拆分 | §4.C1 | 4h | ⏳ |
| T16 C3 i18n 压测 | §4.C3 | 2h | ⏳ |
| T17 C4 Lighthouse CI | §4.C4 | 2h | ⏳ |
| T18 C5 CGI 安全审计 | §4.C5 | 1h | ⏳ blocked by T7 |
| T19 C6 LuCI 兼容矩阵 | §4.C6 | 2h | ⏳ |
| **加固 — 部署期 backlog** | | **~10h** | ⏳ |
| T20 Build-time CSS diff | finalplan §10.7 | 2h | ⏳ |
| T21 Visual regression test | finalplan §10.7 | 6-8h | ⏳ |

**进度**：6 / 21 task 完成（28.6%），16.7h / 70h 工时（24%）。

---

## 0. 总指导原则

让这套主题真正区别于"又一个开源 LuCI 皮肤"的，不是**色彩**，而是**信息组织方式**和**交互流畅度**。本计划提案的所有功能围绕四个目标：

1. **快速找到东西** — LuCI 100+ 菜单项分散在 3 级嵌套里，导航成本高
2. **看清正在发生什么** — 静态数字 vs. 动态数据可视化
3. **操作流畅自然** — 现代 Web 应用的反馈节奏 vs. 90 年代式 modal/alert
4. **渐进增强 / 优雅降级（v2 新增）** — 主题在最小依赖下 100% 可用；进阶功能（流量分析需 nlbw、温度需 thermal_zone、ISP 查询需第三方 API）以**可选启用**形式提供，未满足时显示样式化的安装/缺失说明，而不是默默 hide 或抛错

每个升级项都标注 **优先级 / 工时 / 风险 / 实现路径**，按 Tier 组织：

| Tier | 取向 | 是否推荐 |
|---|---|---|
| **S** | Game changers（颠覆性提升） | ⭐ 强烈推荐先做 |
| **A** | 高实用度（每天用得到） | 推荐做 |
| **B** | UX 打磨 / 锦上添花 | 看时间 |
| **C** | 工程优化（不可见但重要） | 长期债 |
| **D** | 大胆但争议（值得讨论） | 谨慎 |

---

## 0.5 CGI / RPC 基础设施（v2 新增章节）

**为什么需要这一节：** v1 默认主题只含静态资源（HTML / CSS / JS / SVG / 字体）。但 S3 温度读取、A1 ping 延迟、A5 测速这些功能浏览器无法纯靠 LuCI 现有 API 完成，必须有少量服务器侧执行。v2 明确允许主题包**自带 CGI 脚本**。

### 主题包目录约定

```
luci-theme-design/
├── htdocs/luci-static/design/   静态资源（CSS/JS/SVG/字体/图片）
│                                浏览器访问：/luci-static/design/*
├── root/etc/uci-defaults/       首装脚本
├── root/www/cgi-bin/design/     ← v2 新增：主题自带 CGI
│                                浏览器访问：/cgi-bin/design/*
└── luasrc/                      LuCI 模板 + 可选 RPC handler
```

### 主题自带 CGI 一览

| 路径 | 用途 | 大小 | 服务于 |
|---|---|---|---|
| `/cgi-bin/design/ping` | latency 测试（echo "pong"） | < 100B | A1 WAN Hero · A5 测速 |
| `/cgi-bin/design/download` | 下行测速（`dd if=/dev/urandom`） | < 200B | A5 测速 |
| `/cgi-bin/design/upload` | 上行测速（读 stdin 丢弃） | < 200B | A5 测速 |
| `/cgi-bin/design/temp` | 温度读取（遍历 `/sys/class/thermal/`） | < 400B | S3 sparkline |
| `/cgi-bin/design/clients` | 客户端聚合（dhcp.leases + iwinfo 合并 JSON） | < 1 KB | A2 设备列表（可选优化项） |

**CGI 总体积 ≤ 2 KB**，单个脚本调用响应 < 50ms（除测速下载本身）。

### Makefile 改动

```makefile
define Package/luci-theme-design/install
	$(CP) ./htdocs $(1)/www/
	$(CP) ./luasrc $(1)/usr/lib/lua/luci/view/
	$(CP) ./root/* $(1)/
	chmod +x $(1)/www/cgi-bin/design/*    # ← v2 新增
endef
```

### uci-defaults 增强

```sh
#!/bin/sh
# root/etc/uci-defaults/30_luci-theme-design (v2)

if [ "$PKG_UPGRADE" != 1 ]; then
    uci get luci.themes.Design >/dev/null 2>&1 || uci batch <<-EOF
        set luci.themes.Design=/luci-static/design
        set luci.main.mediaurlbase=/luci-static/design
        commit luci
    EOF
fi

# v2: ensure uhttpd CGI is enabled
[ -f /etc/config/uhttpd ] && [ -z "$(uci -q get uhttpd.main.cgi_prefix)" ] && {
    uci set uhttpd.main.cgi_prefix='/cgi-bin'
    uci commit uhttpd
    /etc/init.d/uhttpd reload 2>/dev/null
}

exit 0
```

### 渐进增强协议

每个依赖外部能力的卡片实现一个 `detect()` 函数：

```javascript
// htdocs/luci-static/design/js/capability.js
window.designCap = {
    async nlbw() {
        return await L.resolveDefault(L.uci.load('luci-app-nlbw'), null) !== null;
    },
    async thermal() {
        try {
            const r = await fetch('/cgi-bin/design/temp', { signal: AbortSignal.timeout(800) });
            return r.ok && (await r.text()).trim().length > 0;
        } catch { return false; }
    },
    async wireless() {
        const sys = await L.rpc.declare({ object: 'iwinfo', method: 'devices' })().catch(() => null);
        return sys && sys.devices && sys.devices.length > 0;
    },
    async cgi(name) {
        try {
            const r = await fetch('/cgi-bin/design/' + name + '?probe=1', { signal: AbortSignal.timeout(800) });
            return r.ok;
        } catch { return false; }
    }
};
```

**卡片渲染前一律先 detect：**

```javascript
if (await designCap.nlbw()) {
    renderTrafficAnalysis();
} else {
    renderInstallPlaceholder({
        title: _('Traffic Analysis'),
        requires: 'luci-app-nlbw',
        unlocks: [_('Per-device real-time bandwidth'), _('24h / 7-day cumulative ranking'), _('Hourly usage timeline per device')],
        cta: { label: _('Open Package Manager'), href: L.url('admin/system/opkg') }
    });
}
```

**样式化占位卡片**（统一模板）：

```
┌──────────────────────────────────────────────┐
│ 📊 流量分析                                   │
│ ─────────────────────────────────────────────│
│  此功能需要 luci-app-nlbw                     │
│                                              │
│  安装后可看到：                               │
│  • 实时分用户带宽占用                         │
│  • 24h / 7 天累计排行                         │
│  • 设备每小时使用图                           │
│                                              │
│            [ 打开软件包管理 → ]              │
└──────────────────────────────────────────────┘
```

占位卡片用主题统一的 token（圆角、阴影、留白），**不是丑陋的 inline alert**。

---

## 0.6 i18n 规范（v2 新增章节）

### 总原则：英文是源，其余语言走 LuCI 核心翻译 + fallback

LuCI 的 i18n 工具链以**英文为提取 key**——所有 `_('...')` / `<%:...%>` 包装的字符串由 `xgettext` 提取，翻译者据此翻其他语言。源代码直接写中文 = 工具链反着工作，其他语言贡献者完全迷失。

**约定：所有源代码字符串使用英文。**

### 规则

1. **JS 字符串** — 用 `_('English text')` 包装：

    ```javascript
    // ❌ 反模式
    toast.success('Wi-Fi 已重启');
    const DEVICE_TYPES = { 'macbook': { type: '电脑' } };

    // ✅ 正确
    toast.success(_('Wi-Fi restarted'));
    const DEVICE_TYPES = { 'macbook': { type: _('Computer') } };
    ```

2. **HTML / Lua 模板** — 用 `<%:English text%>` 包装：

    ```html
    <button aria-label="<%:Open command palette%>">⌘K</button>
    <input placeholder="<%:Search menus, settings...%>" />
    ```

3. **代码注释也用英文** — 方便其他贡献者阅读。

4. **不维护 `po/` 翻译文件** — 这是务实取舍。本主题不自带 .po/.lmo，依赖：
   - **LuCI 核心已翻译**的通用字符串（"Save" / "Apply" / "Network" / "Wireless" → 50+ 语言自动适配）
   - **主题特有字符串**（"Command palette" / "Wi-Fi Link Test" / "Computer" 等）→ 用户语言里没翻译时 **fallback 到英文 key 显示**
   - 维护负担：0；用户体验：与英文标签混合的界面（接受这个代价）

5. **本文档约定** — `upgrade.md` 内：
   - **视觉示意图**（ASCII art 框框，含 `┌──┐` / `╭──╮`）保留中文 placeholder — 这是给中文读者的设计直觉，**不会进代码**
   - **代码块**（` ```javascript / ```sh / ```html / ```css `）**全部英文** — 它们是给实施者直接 copy-paste 的

### CI 强制（lint.yml 已落地）

`.github/workflows/lint.yml` 加了一条规则：**禁止源代码非注释处出现 CJK 字符**。任何后续贡献（包括 AI agent）写硬编码中文会被 CI 拒绝。

```python
# Goes inside lint.yml's "Forbid raw CJK in source files" step
import re, sys, glob
fail = []
patterns = ['htdocs/**/*.js', 'luasrc/**/*.htm', 'htdocs/**/*.css']
for path in sum((glob.glob(p, recursive=True) for p in patterns), []):
    src = open(path).read()
    src = re.sub(r'//.*$', '', src, flags=re.M)
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.DOTALL)
    src = re.sub(r'<!--.*?-->', '', src, flags=re.DOTALL)
    src = re.sub(r'<%#.*?%>', '', src, flags=re.DOTALL)
    for i, line in enumerate(src.split('\n'), 1):
        if re.search(r'[\u4e00-\u9fff]', line):
            fail.append(f'{path}:{i}: {line.strip()[:80]}')
if fail:
    print('FAIL — raw CJK outside comments:')
    print('\n'.join(fail))
    sys.exit(1)
```

### 实施清单（每个 step 完成前核查）

- [ ] 所有新增 user-visible JS string 包在 `_()` 里
- [ ] 所有新增 user-visible HTML/Lua template string 包在 `<%:%>` 里
- [ ] 字符串内容**英文**（即使开发者母语是中文）
- [ ] 占位卡 / 错误消息 / 设备类型标签 / aria-label / placeholder / title 也走 i18n
- [ ] 注释用英文
- [ ] `act` 或 GitHub Actions 跑 lint.yml — "Forbid raw CJK" step 通过

---

## 1. Tier S — Game Changers

> **如果你只做三件事，做这三件。**
>
> 它们都满足：增量功能、不破坏现有流程、风险低、可独立 revert、视觉冲击大。

### S1 · Cmd+K 命令面板（**最高优先级**）

**Why this matters:**

LuCI 自带 100+ 菜单项，分散在"状态/网络/服务/防火墙/系统"等 3 级嵌套里。用户找东西全靠记位置。这是 LuCI 用了 15 年的根本痛点。

Cmd+K 让用户说出意图，UI 找路径。Linear / Notion / Vercel / Arc / GitHub 都有。这是 modern productivity tool 的分界线。

**视觉效果：**

```
[ 用户按 ⌘K / Ctrl+K（移动端点放大镜图标） ]

╭───────────────────────────────────────╮
│ 🔍 wifi__                              │
├───────────────────────────────────────┤
│ 📡 网络 → 无线                          │
│ 📡 网络 → 无线 → 客户端                 │
│ 🛡 防火墙 → 流量规则                    │
│ 📊 统计 → 无线信号                      │
│ ⚙️ 系统 → WireGuard                     │
├───────────────────────────────────────┤
│ ↑↓ 选 · ↵ 跳转 · esc 关闭              │
╰───────────────────────────────────────╯
```

**实现路径：**

```javascript
// 1. Data source: recursively walk ui.menu.load() output
//    Note: menu-design.js:48 already calls ui.menu.load() — reuse the result
async function buildMenuIndex() {
    const tree = await ui.menu.load();
    const flat = [];
    walk(tree, [], flat);
    return flat;   // [{ path, breadcrumb, title, name, keywords }, ...]
}

// 2. Trigger: ⌘K / Ctrl+K + magnifier icon on mobile
document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
    }
});

// 3. Filter: fuzzy match (English / CJK / pinyin initials)
function filter(items, q) {
    const re = new RegExp(q.split('').map(escape).join('.*'), 'i');
    return items
        .map(i => ({ ...i, score: scoreMatch(i, q) }))
        .filter(i => i.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
}

// 4. Navigate: jump to the page
function open(item) {
    location.href = L.url(item.path);
}
```

**Production-ready 要做完的事（v2 明确）：**

- [x] 基础 fuzzy match
- [ ] 键盘导航 ↑↓ / Enter / Esc / Tab
- [ ] 移动端顶栏放大镜图标触发
- [ ] aria-activedescendant + 屏幕阅读器支持
- [ ] i18n（菜单 title 已 i18n，但搜索框 placeholder 也要走 `<%:Search...%>`）
- [ ] 拼音首字母支持（中文用户搜"wxsz"找到"无线设置"）
- [ ] 最近使用 5 项置顶（localStorage 持久化）
- [ ] 高亮匹配字符

| 维度 | 评估 |
|---|---|
| 工时 | 核心代码 ~3h，**production-ready ~8h** |
| 风险 | 极低（纯附加 UI，不改任何现有流程） |
| 依赖 | LuCI `ui.menu` API（已存在） |
| 兼容性 | 全现代浏览器；移动端从顶栏放大镜按钮触发 |
| 可访问性 | role="combobox" + aria-controls + aria-activedescendant |

**Bonus（v2+）：** 后续可扩展为"搜配置项"——不仅搜菜单，还能搜 CBI 字段（"DNS 服务器"直接跳到那个配置框）。先发 v1。

---

### S2 · 反馈系统（v2 拆为两层）

v1 把 "Toast 通知" 和 "替换应用配置 modal" 混为一谈。实际上：

| 子项 | 拦截对象 | 难度 | 风险 |
|---|---|---|---|
| **S2a Toast 通知层** | `ui.addNotification` | 简单 | 低 |
| **S2b 应用变更体验重塑** | `ui.changes.displayChanges` | 复杂 | 中（吸收 v1 的 B4 diff viewer） |

#### S2a · Toast 通知层

**Why：** LuCI 的 `ui.addNotification` 在保存配置 / 错误提示等场景被广泛调用，默认渲染是页面顶部的 banner。Toast 是非阻塞的、自动消失的、可堆叠的、可携带 action 的——它是**每一次小操作**的反馈语言。

**范围限定（v2）：** 只拦截 `addNotification`，**不**碰"应用配置时的全屏阻塞 modal"。那是 S2b 的事。

**视觉效果：**

```
                              ╭─────────────────────────────╮
                              │ ✓ 配置已保存                  │
                              │   24 项变更已应用              │
                              │                     [撤销]    │
                              ╰─────────────────────────────╯
                                                          ↑
                                右下角（移动端从底部），2 秒自动消失
```

**支持的 4 种类型：**

| Type | 何时出现 | 视觉 |
|---|---|---|
| `success` | 保存成功 / 重启成功 / 应用成功 | 绿色 ✓ |
| `info` | 提示信息（"已为你选中最优信道"） | 蓝色 ⓘ |
| `warning` | 软警告（"DNS 响应慢"） | 橙色 ⚠ |
| `error` | 失败（"无法连接到 WAN"） | 红色 ✕，**不自动消失** |

**实现路径：**

```javascript
window.toast = {
    success(msg, opts = {}) { return show('success', msg, opts); },
    info(msg, opts = {})    { return show('info',    msg, opts); },
    warning(msg, opts = {}) { return show('warning', msg, opts); },
    error(msg, opts = {})   { return show('error',   msg, opts); },
    dismiss(id) { /* ... */ }
};

// Intercept LuCI's existing ui.addNotification
if (typeof ui !== 'undefined' && ui.addNotification) {
    const orig = ui.addNotification;
    ui.addNotification = (title, msg, level) => {
        toast[level || 'info'](msg || title);
    };
}
```

| 维度 | 评估 |
|---|---|
| 工时 | ~80 行 JS + ~50 行 CSS（**3h**） |
| 风险 | 低 |
| 覆盖范围 | 所有 inline notification（保存、错误、提示） |
| 可访问性 | `role="status"` + `aria-live="polite"`；error 用 `aria-live="assertive"` |

#### S2b · "应用变更"体验重塑（v2 新，合并原 B4 Diff Viewer）

**Why this matters:**

LuCI 当前"保存并应用"流程：

1. 用户点 **Save & Apply**
2. 一个**全屏阻塞 modal** 显示"正在应用配置..."（由 `ui.changes.displayChanges()` 渲染）
3. 15-30 秒后页面刷新或 modal 关闭

这个 modal 用户每天看几十次，2010 年代体验。**v2 重塑**为现代流程：

```
[ 用户点 "Save & Apply" ]
        ↓
╭────────────────────────────────────────╮
│ 即将应用 3 项变更                       │
├────────────────────────────────────────┤
│ network.lan                              │
│   + ipaddr  = 192.168.1.1                │
│   - ipaddr  = 192.168.0.1                │
│                                          │
│ wireless.radio0                          │
│   + channel = 11                         │
│   - channel = auto                       │
│                                          │
│ firewall.@redirect[0]                    │
│   + new redirect (dest_port=80)          │
├────────────────────────────────────────┤
│ ⚠ 修改 LAN IP 会断开你的浏览器连接       │
│                                          │
│         [ 取消 ]  [ 确认应用 ]          │
╰────────────────────────────────────────╯
        ↓ 用户确认
[ 右下角 toast: ⟳ 应用中 0:08 ]
        ↓ 完成
[ 右下角 toast: ✓ 配置已应用 · [撤销] ]
```

**实现路径：**

```javascript
// monkey-patch ui.changes.displayChanges
if (window.L && L.ui && L.ui.changes) {
    const origDisplay = L.ui.changes.displayChanges.bind(L.ui.changes);
    L.ui.changes.displayChanges = async function() {
        let changes;
        try { changes = await L.uci.changes(); }
        catch { return origDisplay(); }   // fallback: replay native flow if API shape unknown

        const confirmed = await showDiffModal(changes);
        if (!confirmed) return;

        const tId = toast.info(_('Applying...'), { duration: 0, progress: true });
        try {
            await L.uci.apply();
            toast.dismiss(tId);
            toast.success(_('Configuration applied'), {
                action: { label: _('Undo'), onClick: () => L.uci.revert() }
            });
        } catch (e) {
            toast.dismiss(tId);
            toast.error(_('Apply failed') + ': ' + e.message);
        }
    };
}
```

**危险变更标记（吸收原 B4）：**

```javascript
const DANGEROUS_KEYS = [
    { match: /^network\.lan\.ipaddr$/,    warn: _('Changing the LAN IP will disconnect your browser') },
    { match: /^network\.lan\.netmask$/,   warn: _('Changing the subnet mask may interrupt access') },
    { match: /^firewall\..*\.enabled$/,
      check: c => c.value === '0', warn: _('Disabling the firewall increases security risk') },
    { match: /^dhcp\.lan\.ignore$/,
      check: c => c.value === '1', warn: _('Disabling DHCP prevents clients from getting an IP automatically') },
    { match: /^system\.@system\[0\]\.hostname$/, warn: _('Old hostname links become invalid after rename') },
];
```

| 维度 | 评估 |
|---|---|
| 工时 | ~120 行 JS + ~80 行 CSS + diff 渲染器（**5h**） |
| 风险 | **中** —— `L.ui.changes` 内部 API 不是 stable contract，LuCI 升级（21→22→23→24）可能改 |
| 兜底 | 检测到 API 签名变化时 `try/catch` 回退到原生 displayChanges |
| 测试矩阵 | LuCI 21.02 / 22.03 / 23.05 / 24.10 各跑一次（见 C6） |
| 可访问性 | modal 用 `<dialog>` + focus trap + Escape 关闭 |

---

### S3 · Sparkline / Live Metrics（**Dashboard 从静态变活的**）

**Why this matters:**

当前主题（也包括所有商业路由器 admin）的状态总览，CPU 显示 12%——但这是**这一秒**的 12%。下一秒它可能跳到 85%。用户无法判断系统是否健康。

Sparkline 把"瞬时数字"变成"过去 5 分钟的趋势"。一眼看见 CPU 是稳定 12% 还是震荡 5%↔85%。

**视觉效果：**

```
┌─────────────────────────┐  ┌─────────────────────────┐
│ ⚡ CPU 负载              │  │ 🧠 内存使用              │
│                          │  │                          │
│   18%   ↗ +5%           │  │   91%                    │
│                          │  │                          │
│   ▂▃▃▄▃▅▇▆▅▄▃           │  │   ▓▓▓▓▓▓▓▓░░░           │
│   过去 5 分钟            │  │   3.4 / 3.7 GB           │
└─────────────────────────┘  └─────────────────────────┘

┌─────────────────────────┐  ┌─────────────────────────┐
│ 🌐 实时流量              │  │ 🌡 温度                  │
│   ↑12 ↓45 Mbps          │  │   52°C  ●正常            │
│   ╲╱╲╱╲╱╲╱╲╱╲          │  │   ─────────              │
└─────────────────────────┘  └─────────────────────────┘
```

**数据源（v2 修正：用 LuCI ubus，不用 HTML endpoint）：**

| 指标 | v1 错误写法 | v2 正确写法 | 可用性 |
|---|---|---|---|
| CPU loadavg | `fetch('/admin/status/sysinfo').json()` ❌（是 HTML） | `ubus call system info` → `.load[0..2]` | ✅ 100% |
| 内存 | 同上 | `ubus call system info` → `.memory` | ✅ 100% |
| 实时流量 | `/proc/net/dev` 差分 | `ubus call network.device status` 差分 | ✅ 100% |
| 温度 | `fetch('/sys/class/thermal/.../temp')` ❌（浏览器无法直接读 `/sys/`） | CGI `/cgi-bin/design/temp` | **需 fallback** |
| DHCP 客户端数 | `cat /tmp/dhcp.leases` ❌（同上） | `ubus call luci-rpc getDHCPLeases` | ✅ |

**ubus 调用方式（LuCI 内置 RPC）：**

```javascript
const sysinfo = L.rpc.declare({
    object: 'system',
    method: 'info',
    expect: { '': {} }
});

setInterval(async () => {
    const sys = await sysinfo();
    cpuRing.push(sys.load[0] / 65536);   // ubus returns load as fixed-point Q16
    memRing.push(1 - sys.memory.available / sys.memory.total);
    renderTile('cpu', cpuRing);
    renderTile('mem', memRing);
}, 5000);
```

**温度 CGI（v2 新增）：**

```sh
#!/bin/sh
# root/www/cgi-bin/design/temp
echo "Content-Type: application/json"
echo ""
TEMPS=""
for z in /sys/class/thermal/thermal_zone*/temp; do
    [ -r "$z" ] || continue
    T=$(cat "$z" 2>/dev/null) || continue
    [ -n "$T" ] || continue
    [ -n "$TEMPS" ] && TEMPS="$TEMPS,"
    TEMPS="$TEMPS$((T/1000))"
done
printf '{"zones":[%s]}\n' "$TEMPS"
```

**温度卡片渐进增强：**

```javascript
if (await designCap.thermal()) {
    renderTempTile();
} else {
    // Hide the card entirely, or render _('Temperature sensor unavailable')
    hideTile('temp');
}
```

**Sparkline 渲染（用 SVG 不用 canvas）：**

```javascript
class MetricRing {
    constructor(max = 60) { this.max = max; this.data = []; }
    push(v) {
        this.data.push(v);
        if (this.data.length > this.max) this.data.shift();
    }
    sparklinePath(width, height) {
        // Returns SVG <path d="M0,30 L20,22 ..."/>
    }
}

function renderSparkline(svg, ring) {
    const path = ring.sparklinePath(200, 40);
    svg.querySelector('.line').setAttribute('d', path);
    svg.querySelector('.fill').setAttribute('d', path + ' L200,40 L0,40 Z');
}
```

| 维度 | 评估 |
|---|---|
| 工时 | ~120 行 JS + ~60 行 CSS + 温度 CGI（**6h**） |
| 风险 | 低（纯前端 SVG，ubus 是稳定 API） |
| 数据依赖 | `system.info` ubus（LuCI 19+ 都有） |
| 性能 | 5s 轮询，单次 ~500 字节响应，可忽略 |
| 移动端 | 完全兼容；卡片在小屏单列 |
| 渐进增强 | 温度无传感器时自动隐藏卡片 |

**进阶想法（v2+）：**
- 长按 tile 弹出"过去 1 小时"详细图表
- 历史持久化：用 `localStorage` 跨页面刷新保留 5 分钟数据
- 如果装了 `collectd-mod-cpu`，直接拉 24 小时历史

---

## 2. Tier A — 高实用度

### A1 · WAN / 互联网状态 Hero 卡片

**Why：** 用户打开管理面板，**首要问题**是"我的网是好的吗？"。把这个问题做成首屏最大的一张卡片。

**🌍 全球用户考虑：**

原方案用第三方 API 自动查 ISP（"China Telecom"），有 3 个问题：
1. **隐私**：用户公网 IP 离开路由器到第三方服务
2. **可达性**：部分地区/国家网络无法访问 ipapi.co 类服务
3. **本地化**：ISP 名永远是英文（不会显示"中国电信"或"Deutsche Telekom"）

**默认 = 零第三方依赖，全靠 LuCI 自己知道的数据：**

```
┌──────────────────────────────────────────────────────────┐
│ 🌐 互联网 · 在线              延迟到网关 ●●●●○ 1.2ms      │
│                                                          │
│  公网 IP    203.0.113.45      WAN 接口                   │
│  连接方式   PPPoE             pppoe-wan · 1 Gbps         │
│                                                          │
│  ↑ 12 Mbps   ↓ 487 Mbps       已连续在线 9d 14h          │
│  ─────────                    [ 立即测速 (LAN) → ]      │
└──────────────────────────────────────────────────────────┘
```

**所有显示项 100% 本地获取：**

| 字段 | 来源 | 全球可用？ |
|---|---|---|
| 在线状态 | `ubus call network.interface.wan status` `.up` | ✅ |
| 公网 IP | 同上 `.ipv4-address[0].address` | ✅ |
| 连接方式 | `.proto`（pppoe / dhcp / static / wireguard） | ✅ |
| WAN 接口 + 速率 | `ethtool ${ifname}` 或 `/sys/class/net/${ifname}/speed`（通过 ubus 包装） | ✅ |
| 延迟到网关 | 浏览器 `fetch('/cgi-bin/design/ping')` 测毫秒 ✅ | ✅ |
| 实时上下行 | `ubus call network.device status` 差分（5s 轮询） | ✅ |
| 在线时长 | `network.interface.wan.uptime` | ✅ |

**CGI 路径修正（v2）：** v1 写 `fetch('/luci-static/design/ping.cgi')` 是错的——`/luci-static/` 是 uhttpd 静态资源目录，**不会执行 CGI**。正确路径见 §0.5：`/cgi-bin/design/ping`。

**ISP 显示作为可选功能，opt-in：**

UCI 配置：

```sh
uci set luci-theme-design.appearance.show_isp='1'
uci set luci-theme-design.appearance.isp_provider='ipapi.co'   # or ip-api.com / ipinfo.io
uci commit luci-theme-design
```

启用后：

1. 第一次显示前弹 modal：「将发送您的公网 IP `203.0.113.45` 至 `ipapi.co` 查询运营商信息，是否继续？」
2. 用户同意后查询，结果缓存 1 小时（避免 rate limit）
3. 用户可随时关闭这个开关

**默认 = OFF**。这样全球用户**不会因为打开主题而泄露 IP**，喜欢看 ISP 信息的中国用户可以主动开。

**i18n：** ISP provider 列表里包含支持本地化的服务（`ip-api.com` 返回的 `org` 字段对国内 ISP 也有中文）。

| 维度 | 评估 |
|---|---|
| 工时 | ~120 行 JS + ~80 行 CSS + ping CGI + 同意 modal（**6h**） |
| 风险 | 低（默认无外部依赖） |
| 隐私 | 默认 100% 本地；ISP 功能 opt-in + 显式同意 |
| 渐进增强 | WAN 接口找不到时显示"网络配置缺失"占位 |

---

### A2 · 设备列表（紧凑单行 + 智能图标）

**Why：** DHCP 客户端 / 无线客户端表格里 `a4:c4:94:6c:8f:33` 谁知道是什么设备。

**范围澄清（v2）：**

主题**不替换** LuCI 自带的 `admin/network/dhcp` 页面（那个 controller / view 由 LuCI 提供，主题动不了）。主题的做法：

1. **Overview 页新增"LAN 客户端"卡片**（紧凑单行 + 点击展开），用主题 JS 后注入
2. **保留** LuCI 自带的 dhcp 页面（详细管理用），只用 CSS 美化统一表格 token
3. 用户日常用 Overview 卡片就够了；需要详细管理 → 进 LuCI dhcp 页

**关键决定：紧凑布局**

原方案多列表格占太多垂直空间，10 个设备就要滚动。**重新设计为单行 + 点击展开详情**。

**单行视觉（每行约 40px 高）：**

```
🖥 MacBook-Pro                     .100   ●●●●  -41dBm   3h
📱 iPhone-John                     .105   ●●●○  -52dBm   现在
📺 LG-TV                           .110   有线  1Gbps    1h
🌡 SmartThermostat                 .122   ●○○○  -78dBm   8h
🎮 Switch                          .130   ●●●●  -48dBm   30m
📷 Doorbell-Cam                    .150   ●●○○  -65dBm   现在
🖨 HP-LaserJet (灰)                .200   有线           3d
```

**点击一行展开详情：**

```
🖥 MacBook-Pro                                          ▲
   ╭───────────────────────────────────────────────╮
   │ 完整 IP   192.168.1.100      MAC  3C:22:FB:8A:1B:42  │
   │ 厂商      Apple (OUI 3C:22:FB)                 │
   │ 信号      ●●●● -41 dBm (优)                    │
   │ 连接      Wi-Fi 5GHz · 信道 149 · 80MHz        │
   │ 协商速率  866 Mbps                              │
   │ 本次会话流量  ↓ 1.2 GB  ↑ 142 MB · 持续 3h 22m │
   │                                                 │
   │ [ 改名 ] [ 加入白名单 ] [ 阻止 ] [ 限速 ]      │
   ╰───────────────────────────────────────────────╯
```

**数据源最佳实现：**

| 优先级 | 信号 | 推断什么 | 可靠度 |
|---|---|---|---|
| ① | hostname 关键词 | 设备**类型** | 80%+ |
| ② | MAC OUI prefix | 设备**厂商** | >99% |
| ③ | 连接方式（有线/2.4/5G） | 形态线索 | 100% |

**hostname 是关键**：`iPhone-John` → 一眼能看出 iPhone。MAC OUI 只能猜厂商（同一个 Apple OUI 可能是 iPhone / Mac / iPad / AppleTV / HomePod / Apple Watch，分不出）。

**实现：**

```javascript
const DEVICE_TYPES = {
    'macbook|imac|mac-?mini':       { icon: 'laptop',     type: _('Computer') },
    'iphone':                       { icon: 'smartphone', type: _('Phone') },
    'ipad':                         { icon: 'tablet',     type: _('Tablet') },
    'android|pixel|samsung-galaxy': { icon: 'smartphone', type: _('Android device') },
    'tv|bravia|webos|chromecast':   { icon: 'tv',         type: _('TV') },
    'switch|nintendo|ps5|xbox':     { icon: 'gamepad',    type: _('Game console') },
    'thermostat|nest|hue|aqara':    { icon: 'thermo',     type: 'IoT' },
    'camera|cam|doorbell|ring':     { icon: 'camera',     type: _('Camera') },
    'printer|laserjet|brother':     { icon: 'printer',    type: _('Printer') },
    'echo|alexa|homepod':           { icon: 'mic',        type: _('Smart speaker') },
};

// Curated ~200 common OUI prefixes (vendor only, no device-type hint)
const OUI = {
    '3C:22:FB': 'Apple',           'A4:C4:94': 'Samsung',
    'B8:27:EB': 'Raspberry Pi',    '00:1A:11': 'Google',
    'DC:A6:32': 'Espressif IoT',   '04:03:D6': 'Nintendo',
    // ...
};

function inferDevice(client) {
    for (const [pattern, info] of Object.entries(DEVICE_TYPES)) {
        if (new RegExp(pattern, 'i').test(client.hostname || '')) {
            return { ...info, vendor: ouiVendor(client.mac) };
        }
    }
    const vendor = ouiVendor(client.mac);
    return { icon: 'device-generic', type: vendor ? vendor + ' ' + _('device') : _('Unknown device'), vendor };
}
```

**数据获取（v2 修正）：**

```javascript
// Use LuCI RPC instead of reading /tmp/dhcp.leases directly
const leases  = await L.rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases' })();
const assocs  = await L.rpc.declare({ object: 'iwinfo',   method: 'assoclist',
                                       params: ['device'] })({ device: radio });

// Merge by MAC
const clients = mergeByMac(leases, assocs);
```

**信号强度展示：**

bars + dBm 数字双重信息。颜色：

- ≥ -50 dBm → 4 格全绿（优）
- -50 ~ -65 → 3 格绿（良好）
- -65 ~ -75 → 2 格橙（一般）
- < -75 → 1 格红（弱）

| 维度 | 评估 |
|---|---|
| 工时 | ~80 行 JS + ~120 行 CSS + 200 项 OUI 表 + 展开详情面板（**7h**） |
| 风险 | 低 |
| 数据来源 | `luci-rpc.getDHCPLeases` + `iwinfo.assoclist` + 内置 OUI |
| 渐进增强 | 无 Wi-Fi 时只显示有线（隐藏信号列） |

**Bonus：** 用户可以**手动给设备改名**（存 UCI），下次显示就用自定义名。比如把 `android-1234567890` 改成 `老婆的手机`。

---

### A3 · 快速操作浮层

**Why：** 重启 Wi-Fi / 应用变更 / 释放 DHCP 这些常用操作，目前都得"系统 → ... → 确认"3 步。一个固定位置的⚡按钮 ≈ 3 倍效率。

**视觉：**

```
顶栏右侧（挨着主题切换按钮）：
                                                    ⚡
                                                    ↓
                                ╭──────────────────────╮
                                │ 待应用 3 项变更       │
                                │ [ 应用并保存 ]        │
                                ├──────────────────────┤
                                │ 🔄 重启 Wi-Fi         │
                                │ ↻  重启路由器         │
                                │ 🌐 释放并续约 DHCP    │
                                │ 📶 立即测速            │
                                │ ⚙️ 重新加载防火墙      │
                                ╰──────────────────────╯
```

**实现：** 一个下拉 popover + 调用 LuCI 现有 ubus 接口。每个危险操作前用 S2b 的 diff/confirm modal。

| 维度 | 评估 |
|---|---|
| 工时 | ~80 行 JS + ~60 行 CSS（**3h**） |
| 风险 | 中（涉及实际操作，每个都需 confirm） |
| 渐进增强 | 检测各能力存在性，不存在的项灰掉 |

---

### A5 · Wi-Fi / LAN 链路测速（替换原 v1 WAN Speedtest）

**Why：** 用户抱怨"Wi-Fi 慢"时，原本无法判断是 Wi-Fi 慢还是 WAN 慢。这个功能测的是**浏览器 ↔ 路由器**的实际连接质量——直接反映用户当前 Wi-Fi 体验。

**与 WAN 测速的区别：**

| 测速类型 | 测什么 | 实现位置 |
|---|---|---|
| **WAN Speedtest**（不做） | 路由器到公网测速服务器 | 需要装外部包（librespeed 等） |
| **LAN / Wi-Fi 测速**（要做） | 浏览器到路由器 | 主题自带 CGI + JS，零依赖 |

**视觉：**

```
┌──────────────────────────────────────────────────┐
│ 📡 Wi-Fi 链路测试                                 │
│                                                  │
│  ↓ 下载  487.2 Mbps          ↑ 上传  92.4 Mbps   │
│  ╭────────╮                  ╭────────╮          │
│  │ ▓▓▓▓▓▓ │ 86% of theory   │ ▓▓     │ 92 Mbps  │
│  ╰────────╯                  ╰────────╯          │
│                                                  │
│  延迟  2.1 ms      抖动  0.3 ms     丢包  0%     │
│                                                  │
│  📶 信号 ●●●●○ -41 dBm · 信道 149 · 5GHz 80MHz   │
│  📊 理论上限 ~600 Mbps（实测占 86%）              │
│                                                  │
│  [ 重新测试 ]   [ 对比 2.4G vs 5G ]              │
└──────────────────────────────────────────────────┘
```

**实用场景：**

- 抱怨"Wi-Fi 慢" → 测一下证明是不是 Wi-Fi 的事（vs WAN）
- 比较"我在卧室 vs 客厅" → 拿着手机走一圈测
- 比较"2.4G vs 5G" → 切 SSID 后再测
- 验证"刚调过功率 / 换了天线 / 改了信道"有没有效果

**实现路径：**

#### 浏览器侧 JS

```javascript
async function runSpeedtest() {
    // 1. Latency test (10 samples, take median)
    const pings = [];
    for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        await fetch('/cgi-bin/design/ping?t=' + Date.now());
        pings.push(performance.now() - t0);
    }
    const latency = median(pings);
    const jitter = stddev(pings);

    // 2. Download test (fetch a big file, measure time)
    const downloadStart = performance.now();
    const resp = await fetch('/cgi-bin/design/download?bytes=20000000');
    const blob = await resp.blob();
    const downloadMs = performance.now() - downloadStart;
    const downloadMbps = (blob.size * 8 / 1e6) / (downloadMs / 1000);

    // 3. Upload test (POST big blob)
    const uploadBlob = new Blob([new Uint8Array(10_000_000)]);
    const uploadStart = performance.now();
    await fetch('/cgi-bin/design/upload', { method: 'POST', body: uploadBlob });
    const uploadMs = performance.now() - uploadStart;
    const uploadMbps = (10 * 8) / (uploadMs / 1000);

    return { latency, jitter, downloadMbps, uploadMbps };
}
```

#### 服务器侧 CGI（v2 路径修正）

**v1 写错：** `htdocs/luci-static/design/speedtest/*.cgi` ❌
**v2 正确：** `root/www/cgi-bin/design/*` ✅

```sh
# root/www/cgi-bin/design/ping
#!/bin/sh
echo "Content-Type: text/plain"
echo ""
echo "pong"
```

```sh
# root/www/cgi-bin/design/download
#!/bin/sh
echo "Content-Type: application/octet-stream"
echo "Cache-Control: no-store"
echo ""
BYTES=$(echo "$QUERY_STRING" | sed -n 's/.*bytes=\([0-9]\+\).*/\1/p')
BYTES=${BYTES:-1000000}
# /dev/urandom prevents intermediate router / browser caching
dd if=/dev/urandom bs=$BYTES count=1 2>/dev/null
```

```sh
# root/www/cgi-bin/design/upload
#!/bin/sh
echo "Content-Type: text/plain"
echo ""
# Read stdin but discard — measuring throughput only
dd of=/dev/null 2>/dev/null
echo "ok"
```

**Bonus 功能：**

- **理论上限对比**：根据当前 wireless mode（802.11ac 80MHz 等）算理论速率，告诉用户"你的链路实测占理论 86%"
- **2.4G vs 5G 对比模式**：用户先连 5G 测一次，切到 2.4G 再测，对比两次结果
- **历史记录**：最近 10 次测试用 localStorage 存，看趋势

| 维度 | 评估 |
|---|---|
| 工时 | ~150 行 JS + ~80 行 CSS + 3 个 CGI（**6h**） |
| 风险 | 低（纯前端 + 自带 CGI） |
| 依赖 | 0 外部依赖 |
| 兼容性 | 全浏览器；CGI 在 OpenWrt 上 100% 可用 |
| 渐进增强 | CGI 探测失败时显示 "CGI 未启用" 提示 |

---

## 3. Tier B — UX 打磨

### B1 · 移动端 Bottom Sheet

**Why：** 小屏上把 modal 改成从底部滑起的 sheet（iOS Settings、Telegram 同款），手感原生。

```
[ 桌面：modal 居中 ]      [ 移动：从底部滑起 ]
   ╭──────╮                ╭──────────────╮
   │ Modal│                │              │
   │      │                │  (内容居中)   │
   ╰──────╯                ├──────────────┤
                           │ 确认变更      │
                           │ 24 项配置...  │
                           │              │
                           │ [取消][应用]  │
                           ╰──────────────╯
```

| 工时 | ~70 行 CSS + ~30 行 JS（媒体查询切换，**2h**） |
| 风险 | 低 |

---

### ~~B2 · Pull-to-Refresh~~（v2 删除）

**v2 决定：删除。**

理由：
- 手势冲突调试成本高（与 iOS Safari 边缘划返回、长页面正常滚动、原生 iOS Web 拉出 URL 都冲突）
- 桌面用户零价值
- 移动用户可用浏览器原生刷新 / A3 快速操作里加"刷新数据"按钮替代

---

### ~~B3 · 系统健康分（Health Score）~~（v2 删除）

**v2 决定：删除。**

理由：
- v1 提案自评"容易显得做作 / 不真实"
- 累加打分容易让用户对小波动焦虑（87 → 85 触发不必要的关注）
- 已有 S3 sparkline 提供每个指标的趋势，无需聚合分数

---

### ~~B4 · 配置变更预览（Diff Viewer）~~（v2 合并到 S2b）

合并入 **S2b "应用变更体验重塑"**。Diff Viewer 是替换 LuCI 全屏 modal 的核心内容，没必要单独列。

---

## 4. Tier C — 工程优化（不可见但重要）

### C1 · CSS 文件拆分 + stylelint

**Why：** 当前 [style.css](htdocs/luci-static/design/css/style.css) = **4141 行 / 93 KB** 单文件（v2 实测）。继续往上加规则会失控。

**拆分方案：**

```
htdocs/luci-static/design/css/
├── tokens.css       ~150 行  设计 token + 防御层
├── base.css         ~400 行  reset, typography, scrollbar
├── components.css   ~1000 行 buttons, inputs, cards, badges
├── layout.css       ~500 行  header, sidebar, navbar, footer
├── pages.css        ~400 行  login, overview-dashboard
├── plugins.css      ~800 行  cbi-samba, openvpn, vssr, nlbw
├── responsive.css   ~700 行  @media queries
└── style.css        ~10 行   只 @import 上面所有 + Apache 头
```

加 stylelint 规则：

- `no-duplicate-selectors`
- `declaration-block-no-redundant-longhand-properties`
- `color-named: never`
- `unit-allowed-list: [px, rem, em, %, vh, vw, fr, deg, ms, s]`

| 工时 | ~3h（拆分）+ ~1h（CI 配置） = **4h** |
| 风险 | 中（拆分时容易破坏 cascade 顺序） |

---

### C2 · 完整迁移图标到 Lucide SVG

**Why：** 当前主题图标系统是混合的：
- 主菜单图标：'design' icon font + CSS `[data-node-name]` 选择器
- 新组件：Lucide SVG sprite（主题切换按钮等）
- 部分小图标：散落在 CSS 里的字符（`\eb03` 之类）

完整迁移到 Lucide：

- 删除 'design' 字体（~22 KB）
- 删除所有 `[data-node-name="xxx"]:before { content: "\eXXX" }` CSS 规则（~50 条）
- menu-design.js 直接渲染 `<svg><use href="..."/></svg>`

| 工时 | **4h** |
| 风险 | 中（涉及很多插件适配；需要把 design icon font 的所有码位映射到 Lucide 名） |
| 收益 | -22 KB 字体；可单独着色每个图标；不依赖字体加载 |

---

### C3 · 国际化压力测试

**Why：** 我们已经加了 CJK / 长德文的 overflow 兜底（finalplan Phase 5），但没真正测过。德语 "Speichern und übernehmen"（24 字符）在按钮里是不是真的好看？

**解法：** 开发用"伪长串"模式：

```javascript
if (location.search.includes('debug=pseudo-long')) {
    document.querySelectorAll('button, label, .nav-item').forEach(el => {
        el.textContent = el.textContent + ' ' + el.textContent;
    });
}
```

把所有标签 ×2，看哪里崩。还可以做"短串"模式（CJK 字符），"RTL"模式（阿拉伯/希伯来）。

| 工时 | **2h**（脚本 + 修补发现的问题） |
| 风险 | 极低 |

---

### C4 · 性能预算 + Lighthouse CI

**Why：** 加 features 容易，但每加一个都让首屏变慢一点。需要硬约束。

**方案：**

- `.github/workflows/lighthouse.yml` PR 触发
- 用 `lhci` 跑 Lighthouse
- 性能 < 90 / 可访问性 < 95 直接 fail
- 资源体积超出预算（CSS > 100 KB / JS > 50 KB 未压缩）fail

| 工时 | **2h** |
| 风险 | 零 |

---

### C5 · CGI 脚本安全审计（v2 新增）

**Why：** v2 引入 `/cgi-bin/design/*`，每个脚本都暴露给 LuCI 鉴权后的用户。需要确保：

- 输入参数严格白名单（`bytes` 只接受数字，`temp` 不接任何参数）
- 没有 shell injection（`$QUERY_STRING` 不直接 eval）
- 没有路径穿越
- `download` 的 `bytes` 上限（避免被恶意请求 GB 级流量）
- shellcheck 跑过

**工作清单：**

- [ ] `shellcheck root/www/cgi-bin/design/*` 在 lint workflow 跑通
- [ ] 每个脚本顶部加 `set -u` + 输入校验
- [ ] `download` 的 `bytes` clamp 到 [1KB, 100MB]
- [ ] 在 README 写明"CGI 仅响应 LuCI 鉴权后的请求"（依赖 uhttpd 配置）

| 工时 | **1h** |
| 风险 | 低（但漏审计可能引入 CVE） |

---

### C6 · LuCI 版本兼容矩阵 CI（v2 新增）

**Why：** S2b monkey-patch `L.ui.changes.displayChanges`、S3 用 `system.info` ubus、A2 用 `luci-rpc.getDHCPLeases`——这些都假设了 LuCI 的内部 API 形状。LuCI 21.02 / 22.03 / 23.05 / 24.10 之间会有差异。

**方案：**

```yaml
# .github/workflows/luci-compat.yml
strategy:
  matrix:
    luci: [21.02, 22.03, 23.05, 24.10]
steps:
  - run: |
      docker run --rm -v $PWD:/theme openwrt/sdk:${{ matrix.luci }} \
          /theme/.ci/check-luci-api.sh
```

`check-luci-api.sh` 用 `grep -F` 验证关键 API 在该版本 LuCI 源码里存在：

```sh
for sym in 'ui.menu.load' 'ui.addNotification' 'L.ui.changes.displayChanges' 'system.info' 'luci-rpc.getDHCPLeases'; do
    grep -rq "$sym" /openwrt/feeds/luci/ || { echo "MISSING: $sym"; exit 1; }
done
```

| 工时 | **2h** |
| 风险 | 零（CI only） |
| 价值 | 每次 LuCI 主版本发布后，自动告知主题哪里要适配 |

---

## 5. Tier D — 流量分析

> v1 的 D1 (WAN Speedtest) 和 D3 (AI 助手) 已删除。剩下的 D2 是流量分析。

### D2 · 流量分析（实时 + 历史累计 + 渐进增强）

**Why：**
- 实时："谁在用我的带宽？"
- 历史："过去 24 小时谁用得最多？"——用于发现"为啥昨晚网那么卡（哦原来 LG-TV 看了 4 小时 Netflix）"

**渐进增强（v2 修订）：**

参考 §0.5 渐进增强协议。

- **装了 nlbw** → 显示完整功能（实时 + 历史 + 时段切换）
- **没装 nlbw** → 显示样式化占位卡片 + 一键跳转 opkg 安装

**两个 Tab + 时段切换（装了 nlbw 才显示）：**

#### Tab 1: 实时

```
现在 LAN 流量构成                    ⚪ 实时 · 自动 2s 刷新

📱 iPhone-John      ████████████████  124 Mbps  ↓
🖥 MacBook-Pro      ████████          56 Mbps   ↓
📺 LG-WebOS-TV      ████              23 Mbps   ↓
🌡 IoT (5 个)       ▌                 0.8 Mbps
─────────────────────────────────────────────
总计                                  211 Mbps
峰值（过去 1 分钟）                    348 Mbps · 7s ago
```

#### Tab 2: 累计

```
累计流量      [ 1h ] [ 6h ] [ 12h ] [✓ 24h ]   ←时段切换

📱 iPhone-John      ████████████████  48.2 GB
                    ↓ 45.0 GB  ↑ 3.2 GB

🖥 MacBook-Pro      ████████          28.7 GB
                    ↓ 26.1 GB  ↑ 2.6 GB

📺 LG-TV            ████              12.5 GB
                    ↓ 12.5 GB  ↑ 0.0 GB  (Netflix?)

🌡 IoT (5 个)       ▎                 0.8 GB

─────────────────────────────────────────────
总计                                  92.1 GB ↓ + 6.2 GB ↑
峰值                                  487 Mbps · 昨晚 21:34

[ 导出 CSV ]   [ 设置流量警报 ]
```

#### 没装 nlbw 时

```
┌──────────────────────────────────────────────┐
│ 📊 流量分析                                   │
│ ─────────────────────────────────────────────│
│  此功能需要 luci-app-nlbw                     │
│                                              │
│  安装后可看到：                               │
│  • 实时分用户带宽占用                         │
│  • 24h / 7 天累计排行                         │
│  • 设备每小时使用图                           │
│                                              │
│            [ 打开软件包管理 → opkg ]         │
└──────────────────────────────────────────────┘
```

**Bonus 功能（装了 nlbw 才有）：**

- **导出 CSV**：把累计数据导出，自己拿去分析
- **流量警报**：设备超过 X GB / 小时时 toast 提醒（"iPhone-John 1 小时用了 8 GB，可能在看 4K 视频"）
- **设备时间线**：点设备名展开，看它**过去 24h 每小时**的曲线（哪几个小时最忙）

| 维度 | 评估 |
|---|---|
| 工时 | 实时 Tab ~80 行 + 历史 Tab ~150 行 + 没 nlbw 占位 ~30 行 = **10h** |
| 风险 | 中（重度依赖 nlbw API） |
| 依赖 | 主功能需 `luci-app-nlbw`；占位卡 0 依赖 |

---

## 6. 实施建议

### 推荐顺序（v2 重排，按依赖度 + 风险分波）

#### 🌊 第一波 · 纯主题增量（无 CGI，无外部依赖）— **~16h**

> 单 PR 合并，主题立刻显著进化，零部署复杂度。

| Step | 项 | 工时 |
|---|---|---|
| 1 | **S1 Cmd+K 命令面板** | 8h |
| 2 | **S2a Toast 通知层** | 3h |
| 3 | **B1 移动端 Bottom Sheet** | 2h |
| 4 | **C2 完整 Lucide SVG 迁移**（删除 design icon font） | 3h |

第一波完成后主题仍是纯静态资源 ipk，跟现在的部署方式完全一致。

#### 🌊 第二波 · CGI 基础设施 + 实时数据 — **~18h**

> 引入 `root/www/cgi-bin/design/`，需要 Makefile chmod、uci-defaults 微调。一次性投入，后面 S3/A1/A5 都受益。

| Step | 项 | 工时 |
|---|---|---|
| 5 | **§0.5 CGI 基础设施**（目录 + Makefile + uci-defaults + capability.js） | 2h |
| 6 | **S3 Sparkline**（用 ubus + 温度 CGI） | 6h |
| 7 | **A1 WAN Hero**（用 ubus + ping CGI） | 6h |
| 8 | **A5 Wi-Fi/LAN 测速**（download/upload/ping CGI） | 4h |

第二波后用户看到首页有：实时活的指标卡 + 网络状态 Hero + 主动测速能力。

#### 🌊 第三波 · 交互深化 — **~15h**

| Step | 项 | 工时 |
|---|---|---|
| 9 | **A2 设备列表 + OUI** | 7h |
| 10 | **A3 快速操作浮层** | 3h |
| 11 | **S2b "应用变更"体验重塑**（含原 B4 diff viewer） | 5h |

#### 🌊 第四波 · 流量分析渐进增强 — **~10h**

| Step | 项 | 工时 |
|---|---|---|
| 12 | **D2 流量分析**（nlbw 检测 + 装/未装两套 UI） | 10h |

#### 🔧 长期工程优化（每项独立 PR）— **~11h**

| 项 | 工时 |
|---|---|
| C1 CSS 文件拆分 + stylelint | 4h |
| C3 i18n 伪长串 / 短串 / RTL 压测 | 2h |
| C4 性能预算 + Lighthouse CI | 2h |
| C5 CGI 脚本安全审计 + shellcheck | 1h |
| C6 LuCI 21/22/23/24 兼容性 CI | 2h |

### 累计工时

| 波次 | 工时 |
|---|---|
| 第一波 | 16h |
| 第二波 | 18h |
| 第三波 | 15h |
| 第四波 | 10h |
| 长期 | 11h |
| **合计** | **70h ≈ 1.5–2 周全职** |

### 已删除（曾在 v1 提案中）

- ~~A4 PWA 安装引导~~ — v1 用户反馈不需要
- ~~D1 WAN Speedtest~~ — 超出主题边界（应作为外部包）
- ~~D3 AI 助手~~ — 跑偏
- ~~B2 Pull-to-Refresh~~ — **v2 删除**（见 B2 节）
- ~~B3 系统健康分~~ — **v2 删除**（见 B3 节）
- ~~B4 Diff Viewer~~ — **v2 合并到 S2b**

---

### 风险红线（v2 修订）

- ❌ 不重写 LuCI 数据层（不动 controller / dispatcher）
- ❌ 不引入构建工具（npm / webpack / vite 全 no）
- ❌ 不引入运行时框架（Vue / React / Alpine 全 no，最多用 ~5 KB 工具库）
- ✅ **允许**主题自带 CGI 脚本（v1 隐含禁止，**v2 明确允许**，部署到 `/www/cgi-bin/design/`）
- ✅ **允许**主题自带 LuCI controller / RPC handler（如果纯 CGI 不够）
- ❌ 不超过 35 KB gzip CSS / 35 KB gzip JS / 0 web font（C2 完成后字体归零）

### 性能预算（v2 修订）

| 资源 | 当前 | v1 上限 | **v2 上限** | 理由 |
|---|---|---|---|---|
| 主 CSS gzipped | ~18 KB | 25 KB | **35 KB** | 新功能 CSS ~10–15 KB |
| 主 JS gzipped | ~3 KB | 15 KB | **35 KB** | Cmd+K + sparkline + speedtest + diff viewer 累计 ~30 KB |
| 字体加载 | 22 KB | 25 KB | **0**（C2 完成后） | Lucide SVG 替代 design icon font |
| SVG sprite | 5.3 KB | 15 KB | **15 KB** | 加 ~30 个新图标 |
| CGI 脚本总量 | 0 | n/a | **< 5 KB**（v2 新增） | ping / download / upload / temp / clients |
| 首屏 LCP | ? | < 1.5s | **< 1.5s @ LAN** | 不变（Lighthouse CI 强制） |
| 首次 Cmd+K 打开时间 | n/a | n/a | **< 100ms**（v2 新增） | 菜单 index 在 idle 时预建 |

---

## 7. 与已有文档的关系

| 文档 | 范围 | 状态 |
|---|---|---|
| [gemini.md / codex.md / claude.md](.) | 第一轮代码审计 | 历史参考 |
| [finalplan.md](finalplan.md) | 代码健康度修复（31/32 项） | ✅ 已完成 |
| [claude_style.md](claude_style.md) | 视觉设计系统提案 | ✅ 已完成 |
| [styling-progress.md](styling-progress.md) | Phase 0-5 视觉执行日志（20 个 Step） | ✅ 已完成 |
| **upgrade.md（本文 v2）** | **功能性升级提案** | **active proposal** |
| [upgrade-preview.html](upgrade-preview.html) | 单文件可交互 demo | 配套 |

本文是**功能层面**的提案，不重复视觉设计相关内容（那些在 claude_style.md）。所有功能假设视觉系统已就位。

---

## 8. 最后一句话

v1 写："如果只能选一件事先做：Cmd+K。"

**v2 依然成立。** 它把 LuCI 用了 15 年的"我得记得这个设置在哪"——变成"我说我要什么，UI 帮我找"。这是从 90 年代式管理面板进化到 2025 年式 productivity tool 的本质跨越。

v2 在 v1 的基础上把"做"的承诺说清楚：

- **第一波 16h 出活**，主题保持纯静态资源，零部署复杂度
- **第二波之后接受 CGI**，换来真正的 dashboard 能力
- 依赖外部包（nlbw / 温度传感器）的功能都走**渐进增强**——缺失时显示样式化引导，不报错不静默 hide
- 累计 **~70h 是 1.5–2 周全职**，不是 v1 估的"5 天"
- 性能预算从 v1 的 25/15 KB 提到 **35/35 KB**，仍远低于普通 Web app

> **"做事就做到极致"** —— v2 的含义是：每个功能都做完整（CGI 安装、a11y、i18n、移动端、错误兜底、渐进增强占位、LuCI 跨版本兼容、shellcheck），不留半成品。
>
> 漂亮已经有了（styling-progress 20 Step）；v2 要把它变成**实用**。
