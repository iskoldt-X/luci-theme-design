# Luci-Theme-Design 最终修复计划与文档校勘记录（v2）

> v1 整合时间：2026-05-22 · v2 修订时间：2026-05-22（同日，codex 复盘后）· **v2 执行完成时间：2026-05-22**
> 整合来源：`doc/gemini.md`、`doc/codex.md`、`doc/claude.md` + 两轮复核
> 本文档是**单一可信来源（Single Source of Truth）**。每条问题都经过回到代码的二次验证，附带"原始来源"标注，对前三份报告里被证伪 / 夸大的说法做明确标注（见 §5），并在 v2 修订中调整了 P0 严格度、修复方案的技术正确性（见 §8）。

---

## 🎯 执行状态总览（2026-05-22）

| 阶段 | 计划项 | 状态 | 实际工时 |
|---|---|---|---|
| **P0** 必须立即修 | 2 | ✅ **全部完成** | ~11 min |
| **P1** 优先修 | 9 | ✅ **全部完成** | ~85 min |
| **P2** 代码味道 | 11 | ✅ **10/11 完成**（P2-6 jquery defer 与 P3-2 合并处理） | ~75 min |
| **P3** 长期改善 | 7 | ⏳ 待办 | ~4.5 h |

**累计：21 项已修复 · 1 项延后 · 7 项 P3 待办**

### 已消除的硬编码病灶（grep 自动验证）

```
✅ DOMSubtreeModified 调用:    0 (代码已替换为 MutationObserver)
✅ eval() in style.js:          0
✅ openclash 硬编码 in JS:      0
✅ /cgi-bin/luci/ in header:    0  (改用 <%=url(...)%>)
✅ cbi-samba-cfg010f89 死规则:  0
✅ gcm_sender_id 死字段:        0
✅ favicon.ico (PNG 伪装):      已删
✅ style copy.css 备份文件:    已删
✅ calc(0% + X) 诡异写法:       0
✅ background-color: none:       0
✅ HYk2gj 死字体:                0
✅ --sectionShaddow 拼错变量:   0
```

### 文件变更统计

```
htdocs/luci-static/design/css/style copy.css | 3353 lines DELETED
htdocs/luci-static/design/css/style.css      |  167 lines net deletion
htdocs/luci-static/design/favicon.ico        |  Bin (PNG 伪装) DELETED
htdocs/luci-static/design/js/style.js        |   14 lines (was 28, IIFE removed)
htdocs/luci-static/design/manifest.json      |  18 lines (was 25, GCM 字段删除)
htdocs/luci-static/resources/menu-design.js  |  null active + qs() helper + 7 处 null 检查
luasrc/view/themes/design/header.htm         |  导航栏 url() 化 + 删私有 meta + root 警告恢复

净变化: 7 files changed, ~133 insertions(+), ~3650 deletions(-)
```

### 关键修复一览

| 修复 | 文件 | 影响 |
|---|---|---|
| MutationObserver 替代 DOMSubtreeModified | style.js | **消除潜在 TypeError 崩溃** |
| 删除 75 KB style copy.css | css/ | ipk 包瘦身 |
| null active class bug 修复 | menu-design.js | DOM class 正确 |
| data-node-name 加入选择器 | menu-design.js + style.css | nlbw / wizard 图标恢复显示 |
| 导航栏改用 url() + disp.lookup | header.htm | 反代场景可用 + openclash 缺失不再 404 |
| 恢复 root 无密码警告 | header.htm | 安全 UX 恢复 |
| menu-design 加 7 处 null 保护 | menu-design.js | 任何元素缺失不再连锁崩溃 |
| .node-main-login 60 行重复删除 | style.css | CSS 减少冗余 |
| @media 替代 JS 改 box-shadow | style.css | 性能 + 去 1 处 jQuery 依赖 |

### 验证

```bash
$ node --check htdocs/luci-static/design/js/style.js          ✅
$ node --check htdocs/luci-static/resources/menu-design.js   ✅
$ python3 -c "import json; json.load(...)"  manifest.json     ✅
$ sh -n root/etc/uci-defaults/30_luci-theme-design           ✅
$ CSS brace balance check                                     ✅ 527 pairs
```

---

## 0. 全景一览

```
风险高 ┌────────────────────────────────────────────┐
       │  P0  运行时崩溃 / 明显污染资源  (2 项, ~11 min) │
       ├────────────────────────────────────────────┤
       │  P1  功能受损 / 用户可见 / 安全 UX (9 项, ~85 min)│
       ├────────────────────────────────────────────┤
       │  P2  代码味道 / 性能 / 噪声     (11 项, ~75 min)│
       ├────────────────────────────────────────────┤
       │  P3  长期改善 / 工程化           (7 项, ~4.5 h) │
风险低 └────────────────────────────────────────────┘

P0 不动 → 部分用户会遇到 JS 崩溃；ipk 多 75 KB 无用资源
P0 + P1 全修 (~96 min) → 项目脱离"业余维护"状态
+ P2 → 进入"可长期维护"
+ P3 → 现代化
```

**v2 关键变化**：v1 的 P0 因为"运行时崩溃 / 100% 死代码"定义没贯彻，被收紧；data-title 选择器失效、null active class bug、root 警告等 3 项重新归类到 P1；死 CSS 规则归 P2。详见 [§8 v2 修订记录](#8-v2-修订记录codex-复盘后的修正)。

---

## 1. P0 — 必须立即修（运行时崩溃 / 明显污染资源）

> **严格定义**：会导致 JS 抛错中断、或会被打进 ipk 浪费用户固件空间的项。**仅 2 项**。

### P0-1 `style.js` 三连问题（崩溃 + 已弃用 API + 无用 eval）

| 项 | 内容 |
|---|---|
| 位置 | [style.js:13-18](htdocs/luci-static/design/js/style.js#L13) |
| 现象 | (a) `DOMSubtreeModified` 已弃用，主流浏览器有移除计划；(b) `firstElementChild` 可能为 null，调用 `.getAttribute()` 抛 TypeError 中断后续 JS；(c) `eval("''")` 解析一个常量字符串纯属多余，且影响 CSP |
| 修复 | 改用 `MutationObserver`，加 null 保护，删 eval，字符直接用 ASCII 写法 `''` |
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

### P0-2 删除 `style copy.css`

| 项 | 内容 |
|---|---|
| 位置 | [htdocs/luci-static/design/css/style copy.css](htdocs/luci-static/design/css/style%20copy.css) (75 KB) |
| 现象 | macOS "复制粘贴"产物，文件名带空格；与 `style.css` 已有 3951 行 diff；会被打进 ipk 浪费固件空间 |
| 修复 | `git rm "htdocs/luci-static/design/css/style copy.css"` |
| 工时 | 1 min |

---

## 2. P1 — 优先修（功能受损 / 用户可见 / 安全 UX）

### P1-1 菜单 `data-title` 选择器集体失效（**复核新发现**）

> v1 时被错放 P0，v2 调整到 P1 —— 仅图标不显示，不会崩溃。

| 项 | 内容 |
|---|---|
| 位置 | [menu-design.js:96](htdocs/luci-static/resources/menu-design.js#L96) vs [style.css:787, 803](htdocs/luci-static/design/css/style.css#L787) |
| 现象 | `Bandwidth Monitor` 和 `Inital Setup`（向导）两个菜单项的图标**永远不显示** |
| 根因 | JS 渲染时 `children[i].title.replace(" ", "_")` 把空格换成下划线，DOM 实际是 `data-title="Bandwidth_Monitor"`；但 CSS 选择器写的是 `[data-title="Bandwidth Monitor"]`，永不匹配。style.css:807 的 fallback `[href="/cgi-bin/luci//admin/wizard"]` 还有个双斜杠，`L.url()` 也不产出双斜杠 |
| 修复 | **推荐 (c)**：CSS 选择器改用 `data-node-name`，更耐翻译和菜单文案变化。备选 (a) CSS 改为 `[data-title="Inital_Setup"]`；(b) JS 改 `/\s+/g` 替换后用空格匹配 |
| 工时 | 5 min |

```javascript
// menu-design.js:96 — 同时去掉冗余三元 hasChildren ? A : A
'data-title': children[i].title.replace(" ", "_"),
'data-node-name': children[i].name,   // 新增稳定 key
```

```css
/* style.css 同步改 */
.main > .main-left > .nav > li > a[data-node-name="wizard"]:before { content: "\e67e"; }
.main > .main-left > .nav > .slide > a[data-node-name="nlbw"]:before { content: "\e764"; }
```

### P1-2 `null active` class bug

> v1 时被错放 P0，v2 调整到 P1 —— 仅 DOM 含错误 class，不会崩溃。

| 项 | 内容 |
|---|---|
| 位置 | [menu-design.js:82-97](htdocs/luci-static/resources/menu-design.js#L82) |
| 现象 | 无子菜单的叶子项处于 active 状态时，DOM 真的出现 `<li class="null active">` 和 `<a class="null active">` |
| 根因 | `slideClass = null` 时执行 `slideClass += " active"`，JS 隐式转换为 `"null active"` |
| 修复 | 用数组拼接 |
| 工时 | 5 min |

```javascript
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
        'data-title': children[i].title.replace(" ", "_"),
    }, [_(children[i].title)]),
    submenu
]));
```

### P1-3 root 空密码警告块（**安全相关 UX 回退**）

> v1 时被降到 P3 是矫枉过正，v2 上调到 P1。

| 项 | 内容 |
|---|---|
| 位置 | [header.htm:105-106](luasrc/view/themes/design/header.htm#L105) |
| 现象 | LuCI Material 主题默认会在此渲染"root 无密码"红框告警；本主题保留了 if 条件、删除了告警内容。用户在未设 root 密码时不会被主动提醒 |
| 修复 | 任选其一：(a) 恢复 LuCI 默认的 `<div class="alert-message warning">...</div>`；(b) 把整个 if 块删干净（明确"主题不提供该警告"） |
| 工时 | 5 min |

### P1-4 导航栏硬编码 LuCI 路径 + openclash

| 位置 | [header.htm:87-93](luasrc/view/themes/design/header.htm#L87) |
|---|---|
| 现象 | (a) `/cgi-bin/luci/...` 写死，反代 / 挂载子路径下失效；(b) 未装 openclash 的用户点击直接 404；(c) 5 张 img 没有 alt |
| 修复 | 用 `<%=url('admin/status/overview')%>` 生成路径（同一文件 67 行已经在用了）；用 `disp.lookup('admin/services/openclash')` 判断后再渲染；补 alt |
| 工时 | 30 min |

### P1-5 `.node-main-login` 整段 60 行重复

| 位置 | [style.css:2542-2602](htdocs/luci-static/design/css/style.css#L2542) vs [style.css:2611-2671](htdocs/luci-static/design/css/style.css#L2611) |
|---|---|
| 现象 | 改动时漏删，两段是字面复制（被 4 行 `.node-system-reboot` 隔开） |
| 修复 | 整段删除 2611-2671 |
| 工时 | 5 min |

### P1-6 jQuery 版本谎报 / 实际 1.11.3

| 位置 | [header.htm:61](luasrc/view/themes/design/header.htm#L61) + [jquery.min.js:1](htdocs/luci-static/design/js/jquery.min.js#L1) |
|---|---|
| 现象 | URL 标 `?v=3.5.1`，文件实际 `jQuery v1.11.3`（2015 年版本）。误导缓存策略和维护者；1.11.3 有已知 XSS / prototype 污染 |
| 修复 | **短期**：把 `?v=3.5.1` 改为 `?v=1.11.3` 不再说谎；**长期**：见 P3-2 去 jQuery 化 |
| 工时 | 1 min (短期) |

### P1-7 `manifest.json` 图标尺寸说谎 + 死字段

| 位置 | [manifest.json](htdocs/luci-static/design/manifest.json) |
|---|---|
| 现象 | 声明 144×144 和 192×192，实际 `icon.png` 是 267×267。iOS / Android 按声明尺寸缩放，体验异常。`gcm_sender_id` / `gcm_user_visible_only` 是 Google 2024 已关闭的 GCM 字段；`status:"ok"` 不是 Web App Manifest 规范字段 |
| 修复 | (a) 生成真实的 192 / 512 PNG，分别声明；(b) 删除 `gcm_sender_id`、`gcm_user_visible_only`、`status`、`prompt_message`；(c) 加 `theme_color` 和 `background_color` |
| 工时 | 10 min（图标生成另算） |

### P1-8 `style.js` openclash viewport 冗余注入

| 位置 | [style.js:3-10](htdocs/luci-static/design/js/style.js#L3) |
|---|---|
| 现象 | header.htm:39 已有内容几乎相同的 viewport meta，此处运行时再追加。多 viewport meta 行为依赖浏览器实现；同时把 `openclash` 写死在主题全局 JS 里是耦合违规 |
| 修复 | 整段 if 删除。如真需要 openclash 页特殊样式，用 `body[data-page="admin-services-openclash"]` 配 CSS |
| 工时 | 2 min |

### P1-9 menu-design.js 多处 querySelector 无空保护

> v2 修订：helper 命名从 `$()` 改为 `qs()`，避免与 jQuery 全局 `$` 冲突。

| 位置 | [menu-design.js:26, 29, 32, 33, 36, 38, 103, 113, 138, 171-173](htdocs/luci-static/resources/menu-design.js) |
|---|---|
| 现象 | 9+ 处 `document.querySelector(x).addEventListener/style` 没有 null 检查。当前模板下确实存在，但模板拆分或登录页等场景元素缺失时会直接抛错中断整页 JS |
| 修复 | 加 helper `function qs(sel) { return document.querySelector(sel); }`（**不要**用 `$()`，会和 jQuery 全局 `$` 冲突），关键位置 `var el = qs(sel); if (!el) return;` |
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
| 现状 | `h4 {}`、`.cbi-button + .cbi-button {}`、`.cbi-rowstyle-2 .cbi-button-down {}` 等纯空规则 |
| 修复 | 删 |
| 工时 | 10 min |

### P2-3 无效 / 错误的 CSS 声明

| 位置 | 多处 |
|---|---|
| 现状 | (a) `background-color: none;` (1399 行)，应为 `transparent`；(b) `border: 1px;` (974, 3517 行)，无 style 不显示；(c) `width: calc(0% + 10rem);` (502, 2934 行)，等同于 `10rem`；(d) `--sectionShaddow` (25, 66 行) 拼成 Shadow，且只用在被注释代码里 |
| 修复 | 逐一改 / 删 |
| 工时 | 10 min |

### P2-4 header.htm 中过时的 meta 标签

| 位置 | [header.htm:43-47](luasrc/view/themes/design/header.htm#L43) |
|---|---|
| 现状 | `x5-fullscreen`、`x5-page-mode`（QQ X5 内核私有）、`browsermode`（UC 私有）、`msapplication-tap-highlight`（IE / Edge Legacy）都已死 |
| 修复 | 全删 |
| 工时 | 2 min |

### P2-5 头部图标 link 标签合并

| 位置 | [header.htm:53-55, 62](luasrc/view/themes/design/header.htm#L53) |
|---|---|
| 现状 | 同尺寸图标声明 3 遍（msapplication-TileImage / icon / apple-touch-icon），又有单独的 shortcut icon 指向 .ico |
| 修复 | 合并为 `<link rel="icon">`、`<link rel="apple-touch-icon">` 两条 |
| 工时 | 5 min |

### P2-6 ~~jQuery 加 defer~~ → 脚本加载顺序整体方案（**v2 重写**）

> v1 建议"jquery 加 defer"会引入新崩溃（详见 §8.2 v2-④）。v2 改为三种保守方案。

| 位置 | [header.htm:61, 116](luasrc/view/themes/design/header.htm#L61) |
|---|---|
| 现状 | jquery 在 `<head>` 中同步加载，阻塞首屏。`style.js` 也在 head（line 116），且使用 `(function ($) { ... })(jQuery)` 依赖 jquery 已加载 |
| **⚠️ 反例** | **不能单独给 jquery 加 `defer`**：会导致 style.js 在 head 解析时先执行，此时 `jQuery is undefined`，整段 JS 崩溃 |
| 修复（三选一） | (1) **保守**：维持现状不动，体感差异 < 100 ms；(2) **同步 defer**：给 jquery + style.js + 其它依赖 jquery 的 LuCI 内置脚本（cbi.js / luci.js / translations）**统一**加 `defer`，由浏览器按 document order 顺序执行；(3) **整体下移**：把 jquery 和 style.js 一起移到 `</body>` 之前 |
| 工时 | 方案 (1) 0 min；方案 (2)(3) 各 10 min 含验证 |
| 推荐 | 与 P3-2 去 jQuery 化合并：**先不动**，待去 jQuery 化完成后顺手处理 |

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

### P2-11 删除 `#cbi-samba-cfg010f89-_tmpl` 死规则（**v2 从 P0 降级**）

| 项 | 内容 |
|---|---|
| 位置 | [style.css:3392, 3396](htdocs/luci-static/design/css/style.css#L3392) |
| 现状 | `cfgXXXXXX` 是 LuCI / UCI 匿名 section 的随机 ID，硬编码个例 ID 对其他用户无意义 |
| 修复 | 删除整段；如确需 width 调整，参考 style.css:2693 已有的 `#cbi-samba [data-tab="template"]` 写法 |
| 工时 | 1 min |
| v2 说明 | 既不崩溃也不打进 ipk（CSS 内联在 style.css 里没法单独剔除），只是死代码。从 P0 降到 P2 |

---

## 4. P3 — 长期改善 / 工程化

### P3-1 LICENSE 风格统一（**实际兼容，不是冲突**）

| 位置 | [LICENSE](LICENSE) + [Makefile:1-4](Makefile#L1) |
|---|---|
| 现状 | LICENSE 是 Apache 2.0，Makefile 头部声明 GPL-2.0-**or-later**（包含 GPLv3），与 Apache 2.0 通过 GPLv3 路径兼容。**不存在许可证冲突**，只是视觉上不统一 |
| 修复 | (a) 在 README 顶部统一声明项目以 Apache 2.0 发布、Makefile 沿用 OpenWrt 包模板 GPL-2.0+；(b) 或者把 Makefile 头部 GPL boilerplate 改成与 Apache 一致 |
| 工时 | 5 min |
| 备注 | codex 1.8 把它说成"不兼容"是误判 |

### P3-2 去 jQuery 化

| 位置 | js/, menu-design.js |
|---|---|
| 现状 | 实际 jQuery 调用只有 4 处（`$(...).css/.slideUp/.slideDown/resize`），全部可用原生 + CSS transition 替代 |
| 修复 | 删 `jquery.min.js`（80+ KB），删 `<script>` 引用，4 处调用改原生。完成后 P2-6 的脚本加载顺序问题自然消失 |
| 工时 | 1-2 h |

### P3-3 CSS 文件拆分 + lint

| 位置 | style.css (3611 行 / 74 KB) |
|---|---|
| 现状 | 单文件混杂基础 / 组件 / 插件兼容 / 5 个媒体查询断点；173 处 `!important`；多处重复选择器 |
| 修复 | 拆为 `base.css` / `components.css` / `plugins.css` / `responsive.css`；接入 stylelint 加 `no-duplicate-selectors`、`declaration-block-no-redundant-longhand-properties` 等规则 |
| 工时 | 2-3 h |

### P3-4 可访问性

| 位置 | [header.htm](luasrc/view/themes/design/header.htm) |
|---|---|
| 现状 | (a) `<span class="showSide">` 承担按钮但缺 `role / tabindex / 键盘事件`；(b) `.brand` 是 `<a href="#">`，点击会跳顶 + 修改 URL；(c) navbar 5 张 img 缺 alt；(d) viewport 里 `user-scalable=0, maximum-scale=1` 违反 WCAG 1.4.4 |
| 修复 | showSide → `<button type="button" aria-label>`；brand → 改 `href` 或 `<span>`；补 alt；去掉 `user-scalable=0` |
| 工时 | 30 min |

### P3-5 CI 升级（**v2 修订：拆分必做 / 可选**）

> v1 建议 SDK 跳到 23.05/24.10 过激，v2 保守拆分。详见 §8.2 v2-⑦。

| 位置 | [.github/workflows/release.yml](.github/workflows/release.yml) |
|---|---|
| 现状 | `runs-on: ubuntu-20.04`（已 EOL）；OpenWrt SDK 锁 `18.06.9`（与 Lean OpenWrt 18.06 分支对齐，**可能是刻意的**）；只有 release 触发，PR 无静态检查 |
| **必做** | (a) `runs-on: ubuntu-24.04` —— ubuntu-20.04 EOL 必须升；(b) 新增 `lint.yml` 跑 `node --check` / `shellcheck` / `stylelint` / `jsonlint`，PR 触发 |
| **可选** | 新增 matrix job 用 23.05 或 24.10 SDK 跑兼容性验证；原 18.06.9 job 保留 |
| **不做** | 直接把 18.06.9 SDK 删掉换成 23.05 —— README 明确写 "适用于 lede For Lean's OpenWRT Only"，激进升 SDK 可能引入 API 不兼容 |
| 工时 | 必做 1 h；可选另算 30 min |

### P3-6 Makefile 版本号自动化（**v2 修订：放在 release pipeline**）

> v1 推荐在 Makefile 用 `$(shell git log ...)` 是错的，v2 改为静态 + release 时 sed 替换。详见 §8.2 v2-⑥。

| 位置 | [Makefile:10-11](Makefile#L10) + [.github/workflows/release.yml](.github/workflows/release.yml) |
|---|---|
| 现状 | `PKG_VERSION:=6.0`、`PKG_RELEASE:=20230224` 硬编码 |
| **不做** | ~~`PKG_RELEASE:=$(shell git log -1 --format=%cd ... || echo 1)`~~ —— OpenWrt buildroot 解 tarball 时通常无 `.git`，fallback 触发会让所有无 git 环境拿到 `PKG_RELEASE=1`，违反可复现构建原则 |
| 推荐做法 | Makefile 保持静态 `PKG_RELEASE`；在 `.github/workflows/release.yml` 的 build step 里用 `sed -i "s/^PKG_RELEASE:=.*/PKG_RELEASE:=$(date +%Y%m%d)/" Makefile` 替换为构建时日期；`LUCI_DEPENDS:=` 留空可保持 |
| 工时 | 5 min |

### P3-7 uci-defaults 行为在 README 说明

| 位置 | [root/etc/uci-defaults/30_luci-theme-design](root/etc/uci-defaults/30_luci-theme-design) |
|---|---|
| 现状 | 首次安装强制把全局主题切到 Design（`set luci.main.mediaurlbase=...`）。对主题包是常见行为但应在 README 明示 |
| 修复 | README 顶部加一段说明 |
| 工时 | 2 min |

---

## 5. 文档校勘记录（前三份报告的错误与遗漏）

> 本节专门记录在分析过程中发现的**前期报告的事实错误、定性过重或过轻、以及共同遗漏**，作为后续协作和复盘的参考。

### 5.1 `doc/gemini.md` 评估

**优点**：精炼，列出的 8 条核心问题都成立。

**遗漏（重要）**：

| 漏点 | v2 等级 |
|---|---|
| `DOMSubtreeModified` 已废弃 + null 崩溃风险（只说了 eval） | P0 |
| `menu-design.js` 的 `null active` class bug | P1 |
| `.replace(" ", "_")` 与 CSS data-title 选择器不匹配 | P1 |
| jQuery 版本号谎报（标 3.5.1 实际 1.11.3） | P1 |
| `.node-main-login` 60 行字面重复 | P1 |
| `manifest.json` 图标尺寸说谎 + GCM 死字段 | P1 |
| `#cbi-samba-cfg010f89-_tmpl` 死规则 | P2 |
| 无效 CSS (`background-color: none`, `border: 1px`, `calc(0% + 10rem)`) | P2 |
| `favicon.ico` 实际是 PNG | P2 |
| 大量空 CSS 规则、`@font-face` 死 url | P2 |

**定性偏差**：

| 内容 | gemini 立场 | 实际 |
|---|---|---|
| `header.htm:105-106` 空 if 块 | "纯代码整洁问题" | 是 UX 回退（删了 root 无密码告警），P1 |

### 5.2 `doc/codex.md` 评估

**优点**：是三份里最详尽的，发现了 `null active` bug、deprecated DOM 事件、jQuery 版本不一致、license boilerplate 等。多个高优先级问题都准确识别。

**事实错误**：

| 内容 | codex 主张 | 真相 |
|---|---|---|
| **1.8 License 不兼容** | "Apache 2.0 不能进 GPLv2，会让下游打包合规变复杂" | Makefile 写的是 GPL-2.0-**or-later**，包含 GPLv3，与 Apache 2.0 兼容。无冲突，只是 boilerplate 没清理 |
| **1.9 Inital Setup 拼写错误** | 怀疑是 Initial 的拼写错误 | luci-app-wizard 上游就是 `Inital Setup`（已传承的拼写错误）。本项目的真实 bug 是 `.replace(" ", "_")` 导致选择器永不命中 |

**遗漏**：

| 漏点 | v2 等级 |
|---|---|
| `.node-main-login` 60 行字面重复（codex 提了 `!important` 多、选择器深，但没指出这个具体的复制粘贴） | P1 |
| `manifest.json` 图标尺寸说谎（codex 只说了字段陈旧） | P1 |
| `favicon.ico` 实际是 PNG | P2 |
| `width: calc(0% + 10rem)` 写法 | P2 |
| `.replace(" ", "_")` 与 CSS data-title 不匹配 | P1 |

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
| **1.5 root 空密码 = 安全回归** | 标 P0，作为"安全相关问题" | v1 自我矫正过度（P3），v2 修订为 P1 安全相关 UX 回退 |
| **1.1 `#cbi-samba-cfg010f89-_tmpl` 100% 死代码** | 完全肯定语气 | 在 samba 用 named section 时不一定是 100%，但**仍应删**：硬编码个例 ID 对其他用户无意义 |
| **1.10 `#detail-bubble` 在 5 个断点上复制粘贴** | "5 次重复" | 实际只有 992/700 两个断点真正复制；470 略有差别（display: block vs inline-table）；1280 是独有规则 |

**遗漏**：

| 漏点 | v2 等级 |
|---|---|
| `.replace(" ", "_")` 与 CSS data-title 选择器不匹配 | P1（复核第二轮才发现） |
| `border: 1px;` 无 style（codex 提了，claude 没单独列） | P2 |
| `background-color: none;` 无效（codex 提了，claude 没单独列） | P2 |
| 冗余三元 `hasChildren ? A : A`（codex 提了） | P1 修复时顺手 |

### 5.4 v1 finalplan.md 的自身错误（v2 修正）

| 错误 | v1 立场 | v2 修正 |
|---|---|---|
| P0 范围过宽 | 5 项放 P0 | 严格按"崩溃 / 资源污染"定义，收紧到 2 项 |
| root 警告优先级 | 自我矫正过度，P3 | 上调到 P1 |
| **P2-6 jquery 加 defer** | "加 defer 就好" | **该方案会引入新崩溃**：单独 defer jquery 会让 style.js 拿不到 `$`。改为三选一保守方案 |
| P1-6 helper 命名 | `function $(sel)` | 与 jQuery 全局 `$` 冲突。改为 `qs()` |
| P3-7 动态 PKG_RELEASE | `$(shell git log ...)` | OpenWrt tarball 无 `.git` 时 fallback `echo 1` 反而比硬编码差。改为静态 + release.yml sed |
| P3-6 SDK 升级 | 直接跳到 23.05 / 24.10 | README 明确 Lean OpenWrt only，激进升级可能引入不兼容。保留 18.06.9，必做仅 ubuntu runner |

### 5.5 三份报告共同遗漏

复核才发现，三份原稿都没看到的：

1. **`menu-design.js:96` 的 `.replace(" ", "_")` 与 CSS data-title 选择器互相不匹配** —— 这是导致 `Bandwidth Monitor` 和 `Inital Setup` 图标永远显示不出来的真实根因。三份原稿都"擦肩而过"——codex 看到了"两个三元分支相同"的代码冗余，没追到 CSS 命中失效；claude 看到了"Inital Setup 拼写错误"，定性错根因。

2. **`style.css:807` 的 fallback `[href="/cgi-bin/luci//admin/wizard"]` 双斜杠**：`L.url()` 通常不产出双斜杠，所以这条 fallback 也大概率不命中。

3. **`renderTabMenu` 在 `container.appendChild(this.renderTabMenu(...))` 时会移动已经被内层 appendChild 的同一节点**：codex 1.5 提了"非常绕"，但没明说这是 DOM 元素被移动（先 append 到 container，外层又 append，导致从原位置移走）。

---

## 6. 修复执行 Checklist（按时间顺序，**v2 重排**）

> 建议按下面的顺序提交，每个 P0/P1 一个 commit，方便回滚。

### 第一波：P0 (~11 min) ✅ **已完成 2026-05-22**

- [x] **commit 1** `rm "htdocs/luci-static/design/css/style copy.css"` (P0-2) ✅ 已删除 75 KB 备份文件
- [x] **commit 2** 重写 [style.js:13-22](htdocs/luci-static/design/js/style.js#L13) 为 MutationObserver + null 检查（去 eval） (P0-1) ✅ `node --check` 通过

### 第二波：P1 (~85 min) ✅ **已完成 2026-05-22**

- [x] **commit 3** 改 [menu-design.js:82-97](htdocs/luci-static/resources/menu-design.js#L82) 用数组拼 class（顺便修冗余三元 line 96，加 `data-node-name`）(P1-2) ✅ `node --check` 通过
- [x] **commit 4** 同步 CSS 给 nlbw / wizard 选择器加 `data-node-name` + `data-title="X_Y"` 双重保险 (P1-1) ✅
- [x] **commit 5** 删除 60 行 `.node-main-login` 重复 (P1-5) ✅ style.css 从 3611 行降到 3545 行
- [x] **commit 6** 删除 style.js openclash viewport 注入 (P1-8) ✅
- [x] **commit 7** [header.htm](luasrc/view/themes/design/header.htm) 导航栏改用 `<%=url(...)%>` + `disp.lookup` 判断 openclash + 补 alt/aria-label (P1-4) ✅
- [x] **commit 8** 恢复 LuCI 默认 root 无密码警告（用户选择保守方案）(P1-3) ✅
- [x] **commit 9** [manifest.json](htdocs/luci-static/design/manifest.json) 重写：删 GCM/status/prompt_message，加 theme_color/background_color，icon 尺寸改为实际 267×267 (P1-7) ✅ JSON valid
- [x] **commit 10** jQuery URL 改为真实版本 `?v=1.11.3` (P1-6) ✅
- [x] **commit 11** [menu-design.js](htdocs/luci-static/resources/menu-design.js) 加 `qs()` helper + 7 处 null 保护 (P1-9) ✅ `node --check` 通过

### 第三波：P2 (~75 min) ✅ **已完成 2026-05-22**

- [x] **commit 12** style.js + menu-design.js 删 box-shadow JS，加 CSS @media (P2-1) ✅ style.js IIFE 也去掉了，文件从 28 行降到 15 行
- [x] **commit 13** 删除空 CSS 规则（6 处）+ 无效 CSS（4 处：2 个 border:1px、background-color:none、2 个 calc(0%+X)）+ `#cbi-samba-cfg010f89-_tmpl` 死规则 + `--sectionShaddow` 拼错变量及其死注释引用 (P2-2, P2-3, P2-11) ✅
- [x] **commit 14** [header.htm](luasrc/view/themes/design/header.htm) 删 x5/UC/IE 私有 meta + 重排 icon links + favicon.ico 改用 PNG (P2-4, P2-5, P2-10) ✅
- [x] **commit 15** style.css 删大段注释（modemenu 45 行 + IE hacks 14 行 + admin-system-admin 6 行）+ 整理 `@font-face design`（删 3 个死 url）+ 删 `div { font-family: HYk2gj }` (P2-7, P2-8, P2-9) ✅
- [x] **commit 16** favicon.ico (PNG-伪装) 删除，header.htm 改用 image/png 类型直接引用 icon.png (P2-10) ✅
- [ ] **commit (合并 P3-2 时一起做)** ~~P2-6 jquery defer~~ —— 暂不动，与去 jQuery 化合并处理

### 第四波：P3（一周内有空再做）

- [ ] LICENSE 文档统一 (P3-1)
- [ ] 去 jQuery 化（同时解决 P2-6 加载顺序）(P3-2)
- [ ] CSS 拆分 + stylelint (P3-3)
- [ ] 可访问性补齐 (P3-4)
- [ ] CI 升级（必做：ubuntu runner；可选：SDK matrix）+ lint workflow (P3-5)
- [ ] Makefile + release.yml 联合处理版本号自动化 (P3-6)
- [ ] README 补充 uci-defaults 说明 (P3-7)

---

## 7. 关键速查表（**v2 重编号**）

| v2 ID | 文件 | 行号 | 问题 | 工时 |
|---|---|---|---|---|
| **P0-1** | `htdocs/luci-static/design/js/style.js` | 13-18 | DOMSubtreeModified + null + eval | 10 min |
| **P0-2** | `htdocs/luci-static/design/css/style copy.css` | 全部 | 备份文件 75 KB 打进 ipk | 1 min |
| **P1-1** | `htdocs/luci-static/resources/menu-design.js` + `style.css` | 96 vs 787,803,807 | data-title 下划线与 CSS 不匹配 | 5 min |
| **P1-2** | `htdocs/luci-static/resources/menu-design.js` | 82-97 | null active class | 5 min |
| **P1-3** | `luasrc/view/themes/design/header.htm` | 105-106 | root 空密码警告（安全 UX） | 5 min |
| **P1-4** | `luasrc/view/themes/design/header.htm` | 87-93 | 导航栏硬编码 + openclash | 30 min |
| **P1-5** | `htdocs/luci-static/design/css/style.css` | 2611-2671 | 60 行复制粘贴 | 5 min |
| **P1-6** | `luasrc/view/themes/design/header.htm` | 61 | jQuery 版本谎报 | 1 min |
| **P1-7** | `htdocs/luci-static/design/manifest.json` | 全部 | 图标尺寸 + GCM 死字段 | 10 min |
| **P1-8** | `htdocs/luci-static/design/js/style.js` | 3-10 | openclash viewport 注入 | 2 min |
| **P1-9** | `htdocs/luci-static/resources/menu-design.js` | 26-173 | querySelector 无 null 检查（用 `qs()`） | 15 min |
| **P2-1** | style.js + menu-design.js | 多处 | JS 改 box-shadow → CSS @media | 10 min |
| **P2-2** | style.css | 多处 | 8+ 处空 CSS 规则 | 10 min |
| **P2-3** | style.css | 974, 1399, 502, 2934, 3517 | 无效 / 错误声明 | 10 min |
| **P2-4** | header.htm | 43-47 | 过时 meta | 2 min |
| **P2-5** | header.htm | 53-55, 62 | 图标 link 合并 | 5 min |
| **P2-6** | header.htm + 各 js | - | 脚本加载顺序（**不能单独 defer**） | 0 / 10 min |
| **P2-7** | style.css | 569-613 等 | 大段注释 CSS | 15 min |
| **P2-8** | style.css | 107-115 | @font-face 死 url | 2 min |
| **P2-9** | style.css | 121-123 | `div { font-family: HYk2gj }` | 1 min |
| **P2-10** | favicon.ico | - | PNG 伪装 ICO | 10 min |
| **P2-11** | style.css | 3392 | `#cbi-samba-cfg010f89-_tmpl` 死规则 | 1 min |
| **P3-1** | LICENSE + Makefile | - | LICENSE 风格统一（实际兼容） | 5 min |
| **P3-2** | js/ | - | 去 jQuery 化 | 1-2 h |
| **P3-3** | style.css | - | 拆分 + stylelint | 2-3 h |
| **P3-4** | header.htm | - | 可访问性 | 30 min |
| **P3-5** | .github/workflows/ | - | CI 升级（ubuntu 必做 / SDK 可选） | 1 h |
| **P3-6** | Makefile + release.yml | - | 版本号自动化（release pipeline 而非 Makefile） | 5 min |
| **P3-7** | README.md | - | uci-defaults 说明 | 2 min |

**累计：P0 ≈ 11 min · P1 ≈ 85 min · P2 ≈ 75 min · P3 ≈ 4.5 h · 总计 ≈ 7 h**

---

## 8. v2 修订记录（codex 复盘后的修正）

> v1 发布后，codex 对计划做了第二轮审视，指出 6 处可调整。本节记录这些反馈、最终裁定与对应的文档改动，方便后续协作时追溯"为什么 P0/P1 分类与第一版不同"。

### 8.1 修订总览

| 编号 | codex 反馈 | 裁定 | v2 处理 |
|---|---|---|---|
| ① | v1 P0-1 data-title 不该放 P0（不是崩溃） | 接受 | 移到 v2 P1-1 |
| ② | v1 P0-5 死规则不该放 P0 | 接受 | 移到 v2 P2-11 |
| ③ | v1 P3-1 root 警告太低 | 接受 | 上调到 v2 P1-3 |
| ④ | v1 P2-6 jquery 单独 defer 会引入新崩溃 | **完全接受** | 改为三种保守方案，附明确警告 |
| ⑤ | v1 P1-6 helper 写成 `function $(sel)` 会与 jQuery 全局 `$` 冲突 | 接受 | 改名为 `qs()` |
| ⑥ | v1 P3-7 动态 PKG_RELEASE 在无 .git 环境失效 | 接受 | 改为 Makefile 保持静态、release.yml 替换 |
| ⑦ | v1 P3-6 SDK 跳到 23.05 过激（lede 用户基础） | **部分接受** | ubuntu runner 升 24.04；SDK 保持 18.06.9；可选 matrix |
| 附 | （codex 未指出，但同口径）v1 P0-2 null active 同理不是崩溃 | 主动调整 | 移到 v2 P1-2 |

### 8.2 各项详细说明

#### v2-① / 附 / v2-② P0 严格化

v1 的 P0 定义是"运行时崩溃 / 100% 死代码"，但实际归类时把"图标不显示"、"DOM 含错误 class"、"死 CSS 规则"也塞进了 P0。v2 严格按定义执行：

| v1 项 | v1 位置 | 实际影响 | v2 位置 |
|---|---|---|---|
| `style.js` MutationObserver | v1 P0-3 | 真的会抛 TypeError 中断 JS | **v2 P0-1** ✅ |
| `style copy.css` | v1 P0-4 | 75 KB 打进 ipk，"明显污染" | **v2 P0-2** ✅ |
| data-title 选择器失效 | v1 P0-1 | 图标不显示，无崩溃 | **v2 P1-1**（降级） |
| null active class | v1 P0-2 | DOM 含错误 class，无崩溃 | **v2 P1-2**（降级） |
| `#cbi-samba-cfg010f89-_tmpl` 死规则 | v1 P0-5 | 纯死代码，无运行时影响 | **v2 P2-11**（降级） |

**v2 P0 数量从 5 项收紧到 2 项。**

#### v2-③ root 空密码警告

v1 自我矫正过度。从 claude.md 的 P0"安全回归"摆到 finalplan v1 的 P3"长期改善"，钟摆太远。codex 指出这是**安全相关 UX 回退**——用户在未设密码时不会被 LuCI 主动提醒。v2 定为 **P1-3**。

#### v2-④ jQuery defer 警告 ⭐（v2 最关键的技术修正）

v1 的 P2-6 建议给 `header.htm:61` 的 jquery 加 `defer`。codex 指出**这会引入新崩溃**。实际加载顺序：

```html
<head>
  ...
  <script src=".../jquery.min.js?v=3.5.1"></script>   <!-- line 61, 同步 -->
  ...
  <script src=".../style.js?v=..."></script>           <!-- line 116, 同步 -->
</head>
```

如果只给 jquery 加 defer：

1. jquery 推迟到 HTML 解析后执行；
2. style.js 在 head 解析时立即执行；
3. style.js 内 `(function ($) { ... })(jQuery)` 拿到的 `jQuery` 是 `undefined`；
4. 整段 JS 崩溃。

**v2 的 P2-6 改为三选一**，并明确警告：
- (1) 保守不动；
- (2) 给 jquery + style.js + LuCI 内置脚本**统一**加 defer；
- (3) 整体移到 `</body>` 之前。

且推荐与 **P3-2 去 jQuery 化合并处理**——根除问题。

#### v2-⑤ `function $(sel)` 命名

v1 的 P1-6 修复方案里写了 helper `function $(sel)`，与 jQuery 全局 `$` 重名，会在加载到 menu-design.js 上下文时产生作用域困惑（即便不实际覆盖也增加阅读负担）。v2 改为 `qs()`，是 vanilla JS 项目惯用名（致敬 CSS.escape 和早期 querySelector 工具）。

#### v2-⑥ 动态 PKG_RELEASE

v1 P3-7 推荐 `PKG_RELEASE := $(shell git log -1 --format=%cd --date=format:%Y%m%d 2>/dev/null || echo 1)`。codex 指出：

- OpenWrt buildroot 解 tarball 时通常**不含 `.git`**；
- fallback 触发，所有无 git 环境拿到 `PKG_RELEASE=1`，**比硬编码还差**；
- 反复构建得到的版本号不一致，违反 reproducible build 原则。

v2 改为：**Makefile 保持静态** `PKG_RELEASE`，自动化放在 `.github/workflows/release.yml` 的 build step 里用 `sed` 替换为构建时日期。

#### v2-⑦ SDK 升级（部分接受）

README 明确"适用于 lede For Lean's OpenWRT Only [lede]"，18.06.9 SDK 与 Lean OpenWrt 18.06 分支对齐**是刻意的**。激进升 SDK 可能引入 API 不兼容。

但 `runs-on: ubuntu-20.04` 已 EOL，必须升。v2 拆分：

- **必做**：ubuntu runner 升 24.04（与 OpenWrt SDK 版本无关）；
- **必做**：新增 lint workflow 跑 PR；
- **可选**：matrix job 新增 23.05 SDK 跑兼容性测试，原 18.06.9 SDK job 保留；
- **不做**：直接把 18.06.9 SDK 删掉换成 23.05。

### 8.3 v2 整体差异

| 维度 | v1 | v2 |
|---|---|---|
| P0 数量 | 5 | **2** |
| P1 数量 | 6 | **9**（吸收了 v1 的 P0-1, P0-2, P3-1） |
| P2 数量 | 10 | **11**（吸收了 v1 的 P0-5；P2-6 内容重写） |
| P3 数量 | 8 | **7**（送出了 v1 的 P3-1 给 P1；P3-6/P3-7 修复方案重写） |
| 总工时估算 | ~7 h | ~7 h（不变） |

### 8.4 codex 复盘的贡献总结

| 贡献 | 价值 |
|---|---|
| 拒绝 P0 范围宽松化 | 保持优先级体系的严谨性 |
| **抓出 P2-6 jquery defer 的隐藏 bug** | **避免引入新崩溃**（v2 最有价值的单点修正） |
| 警告 `function $(sel)` 命名冲突 | 避免代码可读性灾难 |
| 警告动态 PKG_RELEASE 在 tarball 环境失效 | 守住 reproducible build 原则 |
| 警告激进升 SDK 与目标用户基础不符 | 保持向后兼容 |
| 将 root 警告归还到合理位置 | 纠正"钟摆式自我矫正" |

**6 比 0 偏向 codex** —— v1 的 finalplan.md 经过 codex 复盘后变得更稳健、更具可执行性。

---

## 附录 A：本次复核确认过的统计数据

- `style.css`：3611 行 / 74 KB
- `style copy.css`：3353 行 / 75 KB（删除目标）
- `!important` 出现：173 次（style.css）
- CSS 单行注释：~103 处，其中 ~60 处为被注释规则
- `node-main-login` 选择器出现：44 次（含 60 行整段重复）
- 空 CSS 规则块：≥ 8 处
- jQuery 调用点：4 处（`$(window).resize`、`$(ul).stop().slideUp`、`$(slide).find().slideDown`、`$("header").css`）
- 已废弃 / 私有浏览器 meta：6 个
- 硬编码插件名：openclash、vssr、samba、nlbw、ttyd、vsftpd、OpenVPN
- jQuery 实际版本：1.11.3（标记 3.5.1）
- favicon.ico 实际格式：PNG 267×267
- icon.png 实际尺寸：267×267（manifest 声明 144 + 192）

---

## 附录 B：参考文档

- [gemini.md](gemini.md) — 简明版本，列出 8 项核心问题
- [codex.md](codex.md) — 最详尽的初版分析（注意 license / Inital Setup 两项需校正）
- [claude.md](claude.md) — 含工时估算（注意 @font-face / root 警告 / `#detail-bubble` 三项需校正）
- 本文档 v1 → v2 — 在三者基础上交叉验证 + 复核新发现 `.replace` 与 CSS 不匹配 这一根因 + codex 第二轮复盘的 6 处修订
