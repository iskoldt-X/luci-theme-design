# Luci-Theme-Design 最终修复计划与文档校勘记录

> 整合时间：2026-05-22
> 整合来源：`doc/gemini.md`、`doc/codex.md`、`doc/claude.md` + 复核扫描
> 本文档是**单一可信来源（Single Source of Truth）**：每条问题都经过回到代码的二次验证，附带"原始来源"标注，并对前三份报告里被证伪/夸大的说法做明确标注（见第 5 章）。

---

## 0. 全景一览（一图概括）

```
风险高 ┌────────────────────────────────────────────┐
       │  P0  运行时崩溃 / 完全死代码  (5 项, ~30min)   │
       ├────────────────────────────────────────────┤
       │  P1  功能受损 / 用户可见问题  (6 项, ~2h)     │
       ├────────────────────────────────────────────┤
       │  P2  代码味道 / 性能 / 噪声   (8 项, ~2h)     │
       ├────────────────────────────────────────────┤
       │  P3  长期改善 / 工程化         (8 项, ~1 day)  │
风险低 └────────────────────────────────────────────┘

P0 不动 P1 →  会有用户投诉
P0 + P1 全修 → 项目脱离"业余维护"状态
+ P2 → 进入"可长期维护"
+ P3 → 现代化
```

---

## 1. P0 — 必须立即修（运行时崩溃 / 100% 死代码）

### P0-1 菜单 `data-title` 选择器集体失效（**复核新发现**）

| 项 | 内容 |
|---|---|
| 位置 | [menu-design.js:96](htdocs/luci-static/resources/menu-design.js#L96) vs [style.css:787, 803](htdocs/luci-static/design/css/style.css#L787) |
| 现象 | `Bandwidth Monitor` 和 `Inital Setup`（即向导）两个菜单项的图标**永远不显示** |
| 根因 | JS 渲染时 `children[i].title.replace(" ", "_")` 把空格换成下划线，DOM 实际是 `data-title="Bandwidth_Monitor"`；但 CSS 选择器写的是 `[data-title="Bandwidth Monitor"]`，永不匹配。`style.css:807` 的 fallback `[href="/cgi-bin/luci//admin/wizard"]` 还有个多余双斜杠，`L.url()` 通常也不产出双斜杠 |
| 修复 | 任选其一：(a) CSS 选择器改成 `[data-title="Inital_Setup"]` 和 `[data-title="Bandwidth_Monitor"]`；(b) JS 把 `.replace(" ", "_")` 改成 `/\s+/g` 替换后再用空格匹配；(c) 改用 `data-node-name` 等稳定 key |
| 工时 | 5 min |

```javascript
// menu-design.js:96 当前（顺便修掉冗余三元）
'data-title': hasChildren ? children[i].title.replace(" ", "_") : children[i].title.replace(" ", "_"),
// → 改为
'data-title': children[i].name,
```

```css
/* style.css 同步把所有 [data-title="..."] 改成 [data-node-name="..."] 或者直接用 name */
```

### P0-2 `null active` class bug

| 项 | 内容 |
|---|---|
| 位置 | [menu-design.js:82-97](htdocs/luci-static/resources/menu-design.js#L82) |
| 现象 | 当无子菜单的叶子项处于 active 状态时，DOM 真的出现 `<li class="null active">` 和 `<a class="null active">` |
| 根因 | `slideClass = null` 时执行 `slideClass += " active"`，JS 隐式转换为 `"null active"` |
| 修复 | 用数组拼接 |
| 工时 | 5 min |

```javascript
// 推荐写法
var liCls = [];
if (hasChildren) liCls.push('slide');
if (isActive)    liCls.push('active');
var aCls = [];
if (hasChildren) aCls.push('menu');
if (isActive)    aCls.push('active');

ul.appendChild(E('li', { 'class': liCls.length ? liCls.join(' ') : null }, [
    E('a', {
        'href': L.url(url, children[i].name),
        'click': (l == 1) ? ui.createHandlerFn(this, 'handleMenuExpand') : null,
        'class': aCls.length ? aCls.join(' ') : null,
        'data-node-name': children[i].name,
    }, [_(children[i].title)]),
    submenu
]));
```

### P0-3 `style.js` 三连问题（崩溃 + 已弃用 API + 无用 eval）

| 项 | 内容 |
|---|---|
| 位置 | [style.js:13-18](htdocs/luci-static/design/js/style.js#L13) |
| 现象 | (a) `DOMSubtreeModified` 已弃用且会被移除；(b) `firstElementChild` 可能为 null，调用 `.getAttribute()` 抛 TypeError 中断 JS；(c) `eval("''")` 解析一个常量字符串纯属多余，影响 CSP |
| 修复 | 改用 `MutationObserver`，加 null 保护，删 eval |
| 工时 | 10 min |

```javascript
var indicators = document.getElementById("indicators");
if (indicators) {
    new MutationObserver(function () {
        var first = indicators.firstElementChild;
        if (first && first.getAttribute("data-indicator") !== "uci-changes") {
            first.textContent = '';
        }
    }).observe(indicators, { childList: true, subtree: true });
}
```

### P0-4 删除 `style copy.css`

| 项 | 内容 |
|---|---|
| 位置 | [htdocs/luci-static/design/css/style copy.css](htdocs/luci-static/design/css/style%20copy.css) (75 KB) |
| 现象 | macOS "复制粘贴"产物，与 `style.css` 已有 3951 行 diff |
| 修复 | `git rm "htdocs/luci-static/design/css/style copy.css"` |
| 工时 | 1 min |

### P0-5 删除 `#cbi-samba-cfg010f89-_tmpl` 死规则

| 项 | 内容 |
|---|---|
| 位置 | [style.css:3392, 3396](htdocs/luci-static/design/css/style.css#L3392) |
| 现象 | `cfgXXXXXX` 是 LuCI/UCI 匿名 section 的随机 ID，仅对原开发者本机有效。即便 samba 这里用的是 named section，硬编码这个 ID 对其他用户的 LuCI 也无法命中 |
| 修复 | 删除整段；如确需 width 调整，参考 style.css:2693 已有的 `#cbi-samba [data-tab="template"]` 写法 |
| 工时 | 1 min |

---

## 2. P1 — 优先修（功能受损 / 用户可见问题）

### P1-1 导航栏硬编码 LuCI 路径 + openclash

| 位置 | [header.htm:87-93](luasrc/view/themes/design/header.htm#L87) |
|---|---|
| 现象 | (a) `/cgi-bin/luci/...` 写死，反代/挂载子路径下失效；(b) 未装 openclash 的用户点击直接 404；(c) 5 张 img 没有 alt |
| 修复 | 用 `<%=url('admin/status/overview')%>` 生成路径（同一文件 67 行已经在用了）；用 `disp.lookup('admin/services/openclash')` 判断后再渲染；补 alt |
| 工时 | 30 min |

### P1-2 `.node-main-login` 整段 60 行重复

| 位置 | [style.css:2542-2602](htdocs/luci-static/design/css/style.css#L2542) vs [style.css:2611-2671](htdocs/luci-static/design/css/style.css#L2611) |
|---|---|
| 现象 | 改动时漏删，两段是字面复制（被 4 行 `.node-system-reboot` 隔开） |
| 修复 | 整段删除 2611-2671 |
| 工时 | 5 min |

### P1-3 jQuery 版本谎报 / 实际 1.11.3

| 位置 | [header.htm:61](luasrc/view/themes/design/header.htm#L61) + [jquery.min.js:1](htdocs/luci-static/design/js/jquery.min.js#L1) |
|---|---|
| 现象 | URL 标 `?v=3.5.1`，文件实际 `jQuery v1.11.3`（2015 年版本）。误导缓存策略和维护者；1.11.3 有已知 XSS / prototype 污染 |
| 修复 | 短期：把 `?v=3.5.1` 改为 `?v=1.11.3` 不再说谎；长期：见 P3-3 去 jQuery 化 |
| 工时 | 1 min (短期) |

### P1-4 `manifest.json` 图标尺寸说谎 + 死字段

| 位置 | [manifest.json](htdocs/luci-static/design/manifest.json) |
|---|---|
| 现象 | 声明 144x144 和 192x192，实际 `icon.png` 是 267x267。iOS/Android 安装时按声明尺寸缩放，体验异常。`gcm_sender_id` / `gcm_user_visible_only` 是 Google 2024 已关闭的 GCM 字段，`status:"ok"` 不是 Web App Manifest 规范字段 |
| 修复 | (a) 生成真实的 192/512 PNG，分别声明；(b) 删除 `gcm_sender_id`、`gcm_user_visible_only`、`status`、`prompt_message`；(c) 加 `theme_color` 和 `background_color` |
| 工时 | 10 min（图标生成另算） |

### P1-5 `style.js` openclash viewport 冗余注入

| 位置 | [style.js:3-10](htdocs/luci-static/design/js/style.js#L3) |
|---|---|
| 现象 | header.htm:39 已有内容几乎相同的 viewport meta，此处运行时再追加。多 viewport meta 行为依赖浏览器实现；同时把 `openclash` 写死在主题全局 JS 里是耦合违规 |
| 修复 | 整段 if 删除。如真需要 openclash 页特殊样式，用 `body[data-page="admin-services-openclash"]` 配 CSS 即可 |
| 工时 | 2 min |

### P1-6 menu-design.js 多处 querySelector 无空保护

| 位置 | [menu-design.js:26, 29, 32, 33, 36, 38, 103, 113, 138, 171-173](htdocs/luci-static/resources/menu-design.js) |
|---|---|
| 现象 | 9+ 处 `document.querySelector(x).addEventListener/style` 没有 null 检查。当前模板下确实存在，但模板拆分或登录页等场景元素缺失时会直接抛错中断整页 JS |
| 修复 | 加 helper `function $(sel) { return document.querySelector(sel); }` + 关键位置 `if (!el) return;` |
| 工时 | 15 min |

---

## 3. P2 — 该清的代码味道（性能 / 噪声 / 维护成本）

### P2-1 用 `@media` 替代 JS 改 box-shadow

| 位置 | [style.js:21-27](htdocs/luci-static/design/js/style.js#L21) + [menu-design.js:193-197](htdocs/luci-static/resources/menu-design.js#L193) |
|---|---|
| 现状 | 两处同样的 resize 监听 + jQuery `.css()` 写死 box-shadow，纯断点逻辑 |
| 修复 | 改写为 `@media (max-width: 992px) { header { box-shadow: 0 2px 4px rgb(0 0 0 / 8%); } }`，两段 JS 全删 |
| 工时 | 10 min |

### P2-2 删除 8+ 处空 CSS 规则

| 位置 | style.css:951, 1240, 1569, 2546, 2549, 2581, 2615, 2618, 2650, 3375-3385 |
|---|---|
| 现状 | `h4 {}`, `.cbi-button + .cbi-button {}`, `.cbi-rowstyle-2 .cbi-button-down {}` 等纯空规则 |
| 修复 | 删 |
| 工时 | 10 min |

### P2-3 无效 / 错误的 CSS 声明

| 位置 | 多处 |
|---|---|
| 现状 | (a) `background-color: none;` (1399 行)，应为 `transparent`；(b) `border: 1px;` (974, 3517 行)，无 style 不显示；(c) `width: calc(0% + 10rem);` (502, 2934 行)，等同于 `10rem`；(d) `--sectionShaddow` (25, 66 行) 拼写为 Shadow，且只用在被注释代码里 |
| 修复 | 逐一改/删 |
| 工时 | 10 min |

### P2-4 header.htm 中过时的 meta 标签

| 位置 | [header.htm:43-47](luasrc/view/themes/design/header.htm#L43) |
|---|---|
| 现状 | `x5-fullscreen`、`x5-page-mode`（QQ X5 内核私有）、`browsermode`（UC 私有）、`msapplication-tap-highlight`（IE/Edge Legacy）都已死 |
| 修复 | 全删 |
| 工时 | 2 min |

### P2-5 头部图标 link 标签合并

| 位置 | [header.htm:53-55, 62](luasrc/view/themes/design/header.htm#L53) |
|---|---|
| 现状 | 同尺寸图标声明 3 遍（msapplication-TileImage / icon / apple-touch-icon），又有单独的 shortcut icon 指向 .ico |
| 修复 | 合并为 `<link rel="icon">`、`<link rel="apple-touch-icon">` 两条 |
| 工时 | 5 min |

### P2-6 jQuery 移到 body 底部 / 加 defer

| 位置 | [header.htm:61](luasrc/view/themes/design/header.htm#L61) |
|---|---|
| 现状 | `<script src=".../jquery.min.js">` 在 `<head>` 内，阻塞首屏 |
| 修复 | 加 `defer`（如果删不掉 jQuery）：`<script src="..." defer></script>` |
| 工时 | 1 min |

### P2-7 大段注释掉的 CSS

| 位置 | style.css:569-613, 2728-2733, 2905-2918 等 |
|---|---|
| 现状 | ~60 行被注释的死规则，包括完整的 `.modemenu-buttons` 和 IE hacks 块 |
| 修复 | 删除。版本控制是 git log，不是注释 |
| 工时 | 15 min |

### P2-8 `@font-face 'design'` 中的死 url 条目

| 位置 | [style.css:107-115](htdocs/luci-static/design/css/style.css#L107) |
|---|---|
| 现状 | `src: url('')` 第一行被第二行 `src:` 覆盖（**字体实际能正常加载**，参考 woff2/woff/ttf）；但 `url('?#iefix')` 和 `url('#iconfont')` 是无效 url，浏览器 DevTools 会报错 |
| 修复 | 合并为单个 `src:` 仅保留 woff2/woff/ttf |
| 工时 | 2 min |

### P2-9 删除 `div { font-family: 'HYk2gj'; }` 死规则

| 位置 | [style.css:121-123](htdocs/luci-static/design/css/style.css#L121) |
|---|---|
| 现状 | 项目里没有对应 `@font-face`，回退到 body 字体。完全是死代码，且 `div { ... }` 的全局选择器开销不小 |
| 修复 | 直接删除 |
| 工时 | 1 min |

### P2-10 favicon.ico 实际是 PNG

| 位置 | [favicon.ico](htdocs/luci-static/design/favicon.ico) |
|---|---|
| 现状 | `file(1)` 报 `PNG image data, 267 x 267`，不是真正的 ICO 容器 |
| 修复 | 生成真正的多尺寸 ICO（16/32/48），或改用 `<link rel="icon" href="favicon.png" type="image/png">` |
| 工时 | 10 min |

---

## 4. P3 — 长期改善 / 工程化

### P3-1 `root` 空密码警告块（**降级**：不是安全回归）

| 位置 | [header.htm:105-106](luasrc/view/themes/design/header.htm#L105) |
|---|---|
| 现状 | LuCI 默认 Material 主题在此渲染"root 无密码"红框告警，此处保留条件、删除告警内容。属于 UX 回退而非安全漏洞 |
| 修复 | 要么恢复 `<div class="alert-message warning">...</div>`，要么把整个 if 块删干净 |
| 工时 | 5 min |
| 备注 | claude.md 1.5 把它定性为"安全回归"过重；codex 1.2 描述更准确 |

### P3-2 LICENSE 风格统一（**降级**：实际兼容）

| 位置 | [LICENSE](LICENSE) + [Makefile:1-4](Makefile#L1) |
|---|---|
| 现状 | LICENSE 是 Apache 2.0，Makefile 头部声明 GPL-2.0-**or-later**（包含 GPLv3），与 Apache 2.0 通过 GPLv3 路径兼容。所以**不存在许可证冲突**，只是视觉上不统一 |
| 修复 | (a) 在 README 顶部统一声明项目以 Apache 2.0 发布、Makefile 沿用 OpenWrt 包模板 GPL-2.0+；(b) 或者把 Makefile 头部 GPL boilerplate 改成与 Apache 一致 |
| 工时 | 5 min |
| 备注 | codex 1.8 把它说成"不兼容"过重，已修正 |

### P3-3 去 jQuery 化

| 位置 | js/, menu-design.js |
|---|---|
| 现状 | 实际 jQuery 调用只有 4 处（`$(...).css/.slideUp/.slideDown/resize`），全部可用原生 + CSS transition 替代 |
| 修复 | 删 `jquery.min.js`（80+ KB），删 `<script>` 引用，4 处调用改原生 |
| 工时 | 1-2 h |

### P3-4 CSS 文件拆分 + lint

| 位置 | style.css (3611 行 / 74 KB) |
|---|---|
| 现状 | 单文件混杂基础 / 组件 / 插件兼容 / 5 个媒体查询断点；173 处 `!important`；多处重复选择器 |
| 修复 | 拆为 `base.css` / `components.css` / `plugins.css` / `responsive.css`；接入 stylelint 加 `no-duplicate-selectors`、`declaration-block-no-redundant-longhand-properties` 等规则 |
| 工时 | 2-3 h |

### P3-5 可访问性

| 位置 | [header.htm](luasrc/view/themes/design/header.htm) |
|---|---|
| 现状 | (a) `<span class="showSide">` 承担按钮但缺 `role/tabindex/键盘事件`；(b) `.brand` 是 `<a href="#">`，点击会跳顶 + 修改 URL；(c) navbar 5 张 img 缺 alt；(d) viewport 里 `user-scalable=0, maximum-scale=1` 违反 WCAG 1.4.4 |
| 修复 | showSide → `<button type="button" aria-label>`；brand → 改 `href` 或 `<span>`；补 alt；去掉 `user-scalable=0` |
| 工时 | 30 min |

### P3-6 CI 升级 + 轻量 lint

| 位置 | [.github/workflows/release.yml](.github/workflows/release.yml) |
|---|---|
| 现状 | `runs-on: ubuntu-20.04`（已 EOL）；OpenWrt SDK 锁 `18.06.9`（2020 年）；只有 release 触发，PR 无静态检查 |
| 修复 | `runs-on: ubuntu-24.04`；SDK 升级到 23.05 或 24.10；新增 `lint.yml` 跑 `node --check` / `shellcheck` / `stylelint` / `jsonlint` |
| 工时 | 1 h |

### P3-7 Makefile 版本号动态化

| 位置 | [Makefile:10-11](Makefile#L10) |
|---|---|
| 现状 | `PKG_VERSION:=6.0`、`PKG_RELEASE:=20230224` 硬编码 |
| 修复 | `PKG_RELEASE:=$(shell git log -1 --format=%cd --date=format:%Y%m%d 2>/dev/null || echo 1)`；`LUCI_DEPENDS:=` 留空可保持 |
| 工时 | 5 min |

### P3-8 uci-defaults 行为在 README 说明

| 位置 | [root/etc/uci-defaults/30_luci-theme-design](root/etc/uci-defaults/30_luci-theme-design) |
|---|---|
| 现状 | 首次安装强制把全局主题切到 Design（`set luci.main.mediaurlbase=...`）。对主题包是常见行为但应在 README 明示 |
| 修复 | README 顶部加一段说明 |
| 工时 | 2 min |

---

## 5. 文档校勘记录（前三份报告的错误与遗漏）

> 这部分专门记录在分析过程中发现的**前期报告的事实错误、定性过重或过轻、以及共同遗漏**，作为后续协作和复盘的参考。

### 5.1 `doc/gemini.md` 评估

**优点**：精炼，列出的 8 条核心问题都成立。

**遗漏（重要）**：

| 漏点 | 等级 |
|---|---|
| `DOMSubtreeModified` 已废弃 + null 崩溃风险（只说了 eval） | P0 |
| `menu-design.js` 的 `null active` class bug | P0 |
| `.replace(" ", "_")` 与 CSS data-title 选择器不匹配 | P0 |
| jQuery 版本号谎报（标 3.5.1 实际 1.11.3） | P1 |
| `.node-main-login` 60 行字面重复 | P1 |
| `manifest.json` 图标尺寸说谎 + GCM 死字段 | P1 |
| `#cbi-samba-cfg010f89-_tmpl` 死规则 | P0 |
| 无效 CSS (`background-color: none`, `border: 1px`, `calc(0% + 10rem)`) | P2 |
| `favicon.ico` 实际是 PNG | P2 |
| 大量空 CSS 规则、`@font-face` 死 url | P2 |

**定性偏差**：

| 内容 | gemini 立场 | 实际 |
|---|---|---|
| `header.htm:105-106` 空 if 块 | "纯代码整洁问题" | 是 UX 回退（删了 root 无密码告警），应为 P3 但有故事 |

### 5.2 `doc/codex.md` 评估

**优点**：是三份里最详尽的，发现了 `null active` bug、deprecated DOM 事件、jQuery 版本不一致、license boilerplate 等。多个高优先级问题都准确识别。

**事实错误**：

| 内容 | codex 主张 | 真相 |
|---|---|---|
| **1.8 License 不兼容** | "Apache 2.0 不能进 GPLv2，会让下游打包合规变复杂" | Makefile 写的是 GPL-2.0-**or-later**，包含 GPLv3，与 Apache 2.0 兼容。无冲突，只是 boilerplate 没清理 |
| **1.9 Inital Setup 拼写错误** | 怀疑是 Initial 的拼写错误 | luci-app-wizard 上游就是 `Inital Setup`（已传承的拼写错误）。本项目的真实 bug 是 `.replace(" ", "_")` 导致选择器永不命中 |

**遗漏**：

| 漏点 | 等级 |
|---|---|
| `.node-main-login` 60 行字面重复（codex 提了 `!important` 多、选择器深，但没指出这个具体的复制粘贴） | P1 |
| `manifest.json` 图标尺寸说谎（codex 只说了字段陈旧） | P1 |
| `favicon.ico` 实际是 PNG | P2 |
| `width: calc(0% + 10rem)` 写法 | P2 |
| `.replace(" ", "_")` 与 CSS data-title 不匹配 | P0 |

### 5.3 `doc/claude.md` 评估（自评）

**优点**：发现了 `.node-main-login` 60 行重复、favicon PNG 伪装、manifest 图标尺寸说谎、`#cbi-samba-cfg010f89-_tmpl` 随机 ID、`@font-face` 死 url 等 codex/gemini 没看到的具体问题。给了带工时估算的优先级表。

**事实错误**：

| 内容 | claude 主张 | 真相 |
|---|---|---|
| **1.2 @font-face 'design' 半残 broken** | "url('') 会 404；多个 src 第二个会覆盖第一个，broken" | 字体**实际能正常加载**：第二个 `src:` 内有 woff2/woff/ttf 合法 url，浏览器选 woff2 用。`url('')` 这行确实是死的，但不影响功能。应归到 P2 "代码味道" |
| **2.6 "Inital Setup" 拼写错误** | "应该是 Initial Setup" | 同 codex，上游就是这样拼。但本项目 CSS 选择器仍然失效（因为 `.replace` 把空格变成下划线），结论歪打正着，理由错 |

**定性过重**：

| 内容 | claude 立场 | 应调整为 |
|---|---|---|
| **1.5 root 空密码 = 安全回归** | 标 P0，作为"安全相关问题" | 实际是 UX 回退，标 P3 |
| **1.1 `#cbi-samba-cfg010f89-_tmpl` 100% 死代码** | 完全肯定语气 | 在 samba 用 named section 时不一定是 100%，但**仍应删**：硬编码个例 ID 对其他用户无意义 |
| **1.10 `#detail-bubble` 在 5 个断点上复制粘贴** | "5 次重复" | 实际只有 992/700 两个断点真正复制；470 略有差别（display: block vs inline-table）；1280 是独有规则 |

**遗漏**：

| 漏点 | 等级 |
|---|---|
| `.replace(" ", "_")` 与 CSS data-title 选择器不匹配 | P0（这是复核第二轮才发现的，三份原稿都没抓到） |
| `border: 1px;` 无 style（codex 提了，claude 没单独列） | P2 |
| `background-color: none;` 无效（codex 提了，claude 没单独列） | P2 |
| 冗余三元 `hasChildren ? A : A`（codex 提了） | P0 修复时顺手 |

### 5.4 三份报告共同遗漏

复核才发现，三份原稿都没看到的：

1. **`menu-design.js:96` 的 `.replace(" ", "_")` 与 CSS data-title 选择器互相不匹配** —— 这是导致 `Bandwidth Monitor` 和 `Inital Setup` 图标永远显示不出来的真实根因。三份原稿都"擦肩而过"——codex 看到了"两个三元分支相同"的代码冗余，没追到 CSS 命中失效；claude 看到了"Inital Setup 拼写错误"，定性错根因。

2. **`style.css:807` 的 fallback `[href="/cgi-bin/luci//admin/wizard"]` 双斜杠**：`L.url()` 通常不产出双斜杠，所以这条 fallback 也大概率不命中。

3. **`renderTabMenu` 在 `container.appendChild(this.renderTabMenu(...))` 时会移动已经被内层 appendChild 的同一节点**：codex 1.5 提了"非常绕"，但没明说这是 DOM 元素被移动（先 append 到 container，外层又 append，导致从原位置移走）。

---

## 6. 修复执行 Checklist（按时间顺序）

> 建议按下面的顺序提交，每个 P0/P1 一个 commit，方便回滚。

### 第一波：P0 (~30 min)

- [ ] **commit 1** `git rm "htdocs/luci-static/design/css/style copy.css"` (P0-4)
- [ ] **commit 2** 删除 [style.css:3392-3398](htdocs/luci-static/design/css/style.css#L3392) 的 `#cbi-samba-cfg010f89-_tmpl` (P0-5)
- [ ] **commit 3** 重写 [style.js:13-18](htdocs/luci-static/design/js/style.js#L13) 为 MutationObserver + null 检查（顺便去 eval）(P0-3)
- [ ] **commit 4** 改 [menu-design.js:82-97](htdocs/luci-static/resources/menu-design.js#L82) 用数组拼 class（顺便修冗余三元 line 96）(P0-2)
- [ ] **commit 5** 改 CSS data-title 选择器或 JS replace 逻辑，让 `Bandwidth Monitor` / `Inital Setup` 图标真的出现 (P0-1)

### 第二波：P1 (~2 h)

- [ ] **commit 6** 删除 [style.css:2611-2671](htdocs/luci-static/design/css/style.css#L2611) 60 行 `.node-main-login` 重复 (P1-2)
- [ ] **commit 7** 删除 [style.js:3-10](htdocs/luci-static/design/js/style.js#L3) openclash viewport 注入 (P1-5)
- [ ] **commit 8** [header.htm:87-93](luasrc/view/themes/design/header.htm#L87) 导航栏改用 `<%=url(...)%>` + dispatch.lookup 判断 + 补 alt (P1-1)
- [ ] **commit 9** [manifest.json](htdocs/luci-static/design/manifest.json) 删 GCM/status/prompt_message，先把 icons 尺寸改实际值（267 或重新生成） (P1-4)
- [ ] **commit 10** [header.htm:61](luasrc/view/themes/design/header.htm#L61) jQuery URL 改真实版本 `?v=1.11.3` (P1-3)
- [ ] **commit 11** [menu-design.js](htdocs/luci-static/resources/menu-design.js) 加 null 保护 helper (P1-6)

### 第三波：P2 (~2 h)

- [ ] **commit 12** style.js + menu-design.js 删 box-shadow JS，加 CSS @media (P2-1)
- [ ] **commit 13** 删除空 CSS 规则 + 无效 CSS (`border:1px;`、`background-color:none;`、`calc(0%+10rem)`) (P2-2, P2-3)
- [ ] **commit 14** [header.htm:43-47, 53-55](luasrc/view/themes/design/header.htm#L43) 删过时 meta + 合并 icon links + jquery 加 defer (P2-4, P2-5, P2-6)
- [ ] **commit 15** style.css 删大段注释 + 整理 `@font-face design` + 删 `div { font-family: HYk2gj }` (P2-7, P2-8, P2-9)
- [ ] **commit 16** favicon 处理 (P2-10)

### 第四波：P3（一周内有空再做）

- [ ] root 警告恢复或删除 (P3-1)
- [ ] LICENSE 文档统一 (P3-2)
- [ ] 去 jQuery 化 (P3-3)
- [ ] CSS 拆分 + stylelint (P3-4)
- [ ] 可访问性补齐 (P3-5)
- [ ] CI 升级 + lint workflow (P3-6)
- [ ] Makefile 版本号动态化 (P3-7)
- [ ] README 补充 uci-defaults 说明 (P3-8)

---

## 7. 关键速查表

| ID | 文件 | 行号 | 问题 | 工时 |
|---|---|---|---|---|
| P0-1 | `htdocs/luci-static/resources/menu-design.js` | 96 | data-title 下划线与 CSS 不匹配 | 5 min |
| P0-2 | `htdocs/luci-static/resources/menu-design.js` | 82-97 | null active class | 5 min |
| P0-3 | `htdocs/luci-static/design/js/style.js` | 13-18 | DOMSubtreeModified + null + eval | 10 min |
| P0-4 | `htdocs/luci-static/design/css/style copy.css` | 全部 | 备份文件 | 1 min |
| P0-5 | `htdocs/luci-static/design/css/style.css` | 3392 | 随机 UCI ID 死规则 | 1 min |
| P1-1 | `luasrc/view/themes/design/header.htm` | 87-93 | 导航栏硬编码 | 30 min |
| P1-2 | `htdocs/luci-static/design/css/style.css` | 2611-2671 | 60 行复制粘贴 | 5 min |
| P1-3 | `luasrc/view/themes/design/header.htm` | 61 | jQuery 版本谎报 | 1 min |
| P1-4 | `htdocs/luci-static/design/manifest.json` | 全部 | 图标尺寸 + GCM 死字段 | 10 min |
| P1-5 | `htdocs/luci-static/design/js/style.js` | 3-10 | openclash viewport 注入 | 2 min |
| P1-6 | `htdocs/luci-static/resources/menu-design.js` | 26-173 | 多处 querySelector 无 null 检查 | 15 min |
| P2-1 | style.js + menu-design.js | 多处 | JS 改 box-shadow → CSS @media | 10 min |
| P2-2 | style.css | 多处 | 8+ 处空 CSS 规则 | 10 min |
| P2-3 | style.css | 974, 1399, 502, 2934, 3517 | 无效/错误声明 | 10 min |
| P2-4 | header.htm | 43-47 | 过时 meta | 2 min |
| P2-5 | header.htm | 53-55, 62 | 图标 link 合并 | 5 min |
| P2-6 | header.htm | 61 | jquery 加 defer | 1 min |
| P2-7 | style.css | 569-613 等 | 大段注释 CSS | 15 min |
| P2-8 | style.css | 107-115 | @font-face 死 url | 2 min |
| P2-9 | style.css | 121-123 | `div { font-family: HYk2gj }` | 1 min |
| P2-10 | favicon.ico | - | PNG 伪装 ICO | 10 min |
| P3-1 | header.htm | 105-106 | root 空告警块 | 5 min |
| P3-2 | LICENSE + Makefile | - | 风格统一 | 5 min |
| P3-3 | js/ | - | 去 jQuery 化 | 1-2 h |
| P3-4 | style.css | - | 拆分 + stylelint | 2-3 h |
| P3-5 | header.htm | - | 可访问性 | 30 min |
| P3-6 | .github/workflows/ | - | CI 升级 + lint | 1 h |
| P3-7 | Makefile | 10-11 | 版本号动态化 | 5 min |
| P3-8 | README.md | - | uci-defaults 说明 | 2 min |

**累计：P0 ≈ 22 min · P1 ≈ 63 min · P2 ≈ 66 min · P3 ≈ 4.5 h · 总计 ≈ 7 h**

---

## 附录 A：本次复核确认过的统计数据

- `style.css`：3611 行 / 74 KB
- `style copy.css`：3353 行 / 75 KB（删除目标）
- `!important` 出现：173 次（style.css）
- CSS 单行注释：~103 处，其中 ~60 处为被注释规则
- `node-main-login` 选择器出现：44 次（含 60 行整段重复）
- 空 CSS 规则块：≥ 8 处
- jQuery 调用点：4 处（`$(window).resize`, `$(ul).stop().slideUp`, `$(slide).find().slideDown`, `$("header").css`）
- 已废弃 / 私有浏览器 meta：6 个
- 硬编码插件名：openclash、vssr、samba、nlbw、ttyd、vsftpd、OpenVPN
- jQuery 实际版本：1.11.3（标记 3.5.1）
- favicon.ico 实际格式：PNG 267×267
- icon.png 实际尺寸：267×267（manifest 声明 144 + 192）

---

## 附录 B：参考文档

- [gemini.md](gemini.md) - 简明版本，列出 8 项核心问题
- [codex.md](codex.md) - 最详尽的初版分析（注意 license / Inital Setup 两项需校正）
- [claude.md](claude.md) - 含工时估算（注意 @font-face / root 警告 / `#detail-bubble` 三项需校正）
- 本文档：在三者基础上交叉验证 + 新增 `.replace` 与 CSS 不匹配 这一根因发现
