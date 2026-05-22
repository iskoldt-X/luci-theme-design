# Luci-Theme-Design 项目扫描与分析报告 (Claude)

> 扫描时间：2026-05-22
> 扫描范围：`htdocs/`、`luasrc/`、`root/`、`Makefile`、`.github/workflows/`、`manifest.json`、`README.md`、`LICENSE`
> 验证手段：源码逐行阅读 + grep 统计 + `file(1)` 检查二进制资源 + `diff` 对比备份文件

本报告分两部分：
- **第 1 章**：严重的、确定会导致功能/视觉/安全问题的 broken/不干净代码。
- **第 2 章**：可低成本改善的代码味道（code smell）。
- **第 3 章**：建议修复优先级。

---

## 1. 严重不符合干净代码 / Broken 风险的部分

### 1.1 CSS 引用了硬编码的匿名 UCI section ID（确定 broken）

位置：`htdocs/luci-static/design/css/style.css:3392, 3396`

```css
#cbi-samba-cfg010f89-_tmpl .cbi-value-title{
    width: 15%;
}
#cbi-samba-cfg010f89-_tmpl .cbi-value-field{
    width: 95%;        
}
```

**问题：** `cfg010f89` 是 OpenWrt UCI 在创建匿名 section 时**随机生成的 ID**，仅对开发者当时的那台设备有效。任何其他用户安装这个主题，他们设备上的 samba 配置 section ID 都不会是 `cfg010f89`——这条规则永远不会命中，是 100% 的死代码。

**建议：** 改用 `[data-tab="template"]`、`[name="..."]` 或更稳定的属性选择器；可参考 `style.css:2693` 已有的 `#cbi-samba [data-tab="template"]` 写法。

---

### 1.2 `@font-face` 'design' 字体声明半残（确定 broken）

位置：`htdocs/luci-static/design/css/style.css:107-115`

```css
@font-face {
  font-family: 'design';
  src: url('');                                     /* ← 空 URL */
  src: url('?#iefix') format('embedded-opentype'),   /* ← 无效路径 */
  url('../fonts/iconfont-Regular.woff2') format('woff2'),
  url('../fonts/iconfont-Regular.woff') format('woff'),
  url('../fonts/iconfont-Regular.ttf') format('truetype'),
  url('#iconfont') format('svg');                    /* ← 仅 fragment */
}
```

**问题：**
- 第一行 `src: url('')` 会被浏览器解析为"当前页面"，触发一次无意义的 404。
- `url('?#iefix')` 同样会请求当前页面，根本不是真实的 EOT。
- `url('#iconfont') format('svg')` 是 fragment-only URL，对 SVG 字体来说没有具体的字体路径。
- 多个 `src:` 第二个会覆盖第一个，这种写法应该改为单个 `src:` 多个 url。

虽然 woff2/woff/ttf 三种格式在大多数浏览器里仍可正确加载（修复了"看起来还工作"的假象），但开发者工具会持续报错，且首屏会浪费一次错误的网络请求。

**建议：** 删除 `src: url('')`、`url('?#iefix')` 和 `url('#iconfont')` 三个无效声明；合并为一条 `src:` 并按 woff2 → woff → ttf 排列。

---

### 1.3 全局 `div { font-family: 'HYk2gj'; }` 是死规则

位置：`htdocs/luci-static/design/css/style.css:121-123`

```css
div{
    font-family: 'HYk2gj';
}
```

**问题：** 'HYk2gj' 是「汉仪卡通体」的字体名，但项目里**没有对应的 `@font-face` 声明**。浏览器找不到字体，会回退到下一层（body 的 `-apple-system, 'Microsoft Yahei'`），所以表面上"看起来"没事——但这就是典型的死代码：声明了别人理解不了的意图，又不产生效果。

**建议：** 直接删除。如果确实希望对中文字体做兜底，在 `html, body` 上一次性声明即可。

---

### 1.4 导航栏硬编码第三方插件 + 硬编码 LuCI 路径

位置：`luasrc/view/themes/design/header.htm:87-93`

```html
<div class="navbar">
  <a href="/cgi-bin/luci/admin/status/overview"><img src="<%=media%>/images/home.png" /></a>
  <a href="/cgi-bin/luci/admin/services/openclash"><img src="<%=media%>/images/openclash.png" /></a>
  <a href="/cgi-bin/luci/admin/network/network"><img src="<%=media%>/images/link.png" /></a>
  <a href="/cgi-bin/luci/admin/status/realtime"><img src="<%=media%>/images/rank.png" /></a>
  <a href="/cgi-bin/luci/admin/system/admin"><img src="<%=media%>/images/user.png" /></a>
</div>
```

**问题：**
- **硬编码 `/cgi-bin/luci`**：LuCI 自身可以被反代或者跑在非默认路径下，应该使用 `<%=url('admin/status/overview')%>` 让 LuCI dispatcher 来生成路径。
- **硬编码 openclash 路由**：用户未安装 openclash 时，点击图标会直接 404。同时项目的 CSS 里没有任何 `node-services-openclash` 适配（这反过来证明导航栏的 openclash 是孤立的硬编码）。
- 图片标签缺 `alt`，可访问性差。

**建议：**
- 用 `url('admin/...')` 生成路径。
- 通过 `dispatcher.lookup('admin/services/openclash')` 之类判断菜单是否存在再决定是否渲染；或者改为 UCI 可配置快捷栏。
- 给图片加 `alt`。

---

### 1.5 空的 root 弱密码警告块（疑似安全回归）

位置：`luasrc/view/themes/design/header.htm:105-106`

```html
<%- if luci.sys.process.info("uid") == 0 and luci.sys.user.getuser("root") and not luci.sys.user.getpasswd("root") and path ~= "admin-system-admin-password" then -%>
<%- end -%>
```

**问题：** 条件命中的恰恰是「以 root 运行 + root 用户存在 + root 无密码 + 当前不在改密码页」——LuCI 原本会在这里渲染一条**红色的醒目警告**提示用户立即设置 root 密码。当前主题保留了条件，删掉了警告体，等于在一个非常重要的安全场景里"吞掉"了原本的提示。

这比单纯的"空逻辑块"更严重，建议视为**安全相关问题**而非纯代码味道。

**建议：** 恢复 LuCI 默认的告警内容（`<div class="alert-message warning">...</div>`），或者明确决定"主题不提供该警告，留给用户首次登录后自行注意"，并把整个 `if/end` 都删掉。

---

### 1.6 `style.js` 用了已废弃的 `DOMSubtreeModified` 且会因为空值崩溃

位置：`htdocs/luci-static/design/js/style.js:13-18`

```javascript
document.getElementById("indicators").addEventListener('DOMSubtreeModified', function () {
    var child = document.getElementById("indicators");
    if (child.firstElementChild.getAttribute("data-indicator") != "uci-changes") {
        child.firstElementChild.textContent = eval("''")
    }
}, false);
```

**问题：**
- `DOMSubtreeModified` 属于 [Mutation Events，已被 W3C 废弃](https://developer.mozilla.org/en-US/docs/Web/API/MutationEvent)，主流浏览器有移除计划；同时触发频率极高，性能差。
- `child.firstElementChild` 没有空值保护：当 `indicators` 容器被清空时（LuCI 在重渲染过程中会出现这种瞬时状态），`firstElementChild` 是 `null`，调用 `.getAttribute(...)` 会抛 `TypeError: Cannot read properties of null (reading 'getAttribute')`，进而中断后续 JS。
- `eval("''")` 完全没有必要——它只是把字符串字面量再 eval 一次。这会被 CSP / 静态分析工具标红，也带来微小的安全面。

**建议：**
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

---

### 1.7 `style.js` 针对 openclash 的 viewport 注入，与 `header.htm` 冲突

位置：`htdocs/luci-static/design/js/style.js:3-10` vs `header.htm:39`

```javascript
// style.js
var url = self.location.href; 
if ((/(iPhone|iPad|iPod|iOS|Mac|Macintosh)/i.test(navigator.userAgent)) && url.indexOf("openclash") != -1 ) {
    var oMeta = document.createElement('meta');
    oMeta.content = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=0,viewport-fit=cover';
    oMeta.name = 'viewport';
    document.getElementsByTagName('head')[0].appendChild(oMeta);
}
```

```html
<!-- header.htm:39 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0,viewport-fit=cover" />
```

**问题：**
- `header.htm` 里已经声明过一份内容**几乎完全相同**的 viewport meta，这里在运行时再追加一份。多个 `viewport` meta 的行为是 [implementation-defined](https://drafts.csswg.org/css-device-adapt/#viewport-meta)，不同浏览器/版本表现可能不一致。
- 把第三方插件名 `openclash` 写死在主题全局 JS 里，是典型的低耦合违例。
- `user-scalable=0, maximum-scale=1` 禁止用户缩放，是一个**WCAG 1.4.4 违规**，损害可访问性。

**建议：**
- 直接删除整段 if，开启的 viewport 已在 `header.htm` 解决问题。
- 如果某个具体页面需要特殊样式，依靠 `body[data-page="admin-services-openclash"]` 这类 selector 用 CSS 解决，不要在 JS 里嗅探 URL。
- 顺便把 `header.htm:39` 的 `user-scalable=0, maximum-scale=1.0` 去掉。

---

### 1.8 jQuery 版本标记和实际不一致 + 版本极旧

位置：
- 标记：`luasrc/view/themes/design/header.htm:61` → `?v=3.5.1`
- 实际：`htdocs/luci-static/design/js/jquery.min.js:1` → `/*! jQuery v1.11.3 ... */`

```bash
$ head -1 htdocs/luci-static/design/js/jquery.min.js
/*! jQuery v1.11.3 | (c) 2005, 2015 jQuery Foundation, Inc. | jquery.org/license */
```

**问题：**
- 给浏览器的 URL `?v=3.5.1` 暗示这是 3.5.1，但文件是 2015 年的 1.11.3——这是一个会误导维护者和缓存策略的元数据谎言。
- jQuery 1.11.3 距今 10 年，曾有 [CVE-2015-9251](https://www.cvedetails.com/cve/CVE-2015-9251/)（jQuery <3.0.0，跨域 jsonp XSS）和 [CVE-2019-11358](https://www.cvedetails.com/cve/CVE-2019-11358/)（prototype 污染）等已知漏洞。
- 整个项目对 jQuery 的依赖**非常少**：`grep` 显示只有 4 处 `$(...)` 调用，全部是简单的 `.css()` 和 `.slideUp/.slideDown` 动画，完全可以用原生 DOM API + CSS transition 替代。

**建议：**
- 短期：把 URL 参数改为真实版本（`?v=1.11.3`），或者升级到 jQuery 3.7.x slim 版。
- 长期：去 jQuery 化。`menu-design.js:47, 62` 的 `slideUp/slideDown` 可以用 CSS `max-height` + `transition`；`style.js:21-27` 直接改 CSS `@media`。

---

### 1.9 LICENSE 不一致

位置：
- `LICENSE` → Apache License 2.0
- `Makefile:1-4` → GPL v2 or later
- `header.htm:18`、`footer.htm:18`、`style.css:10` → Apache License 2.0

**问题：** 同一项目里两个许可证。Makefile 头部声明 GPLv2，根 LICENSE 是 Apache 2.0。Apache 2.0 和 GPLv2 是 [单向兼容](https://www.gnu.org/licenses/license-list.html#apache2)（Apache 2.0 代码可以进 GPLv3 但**不能进 GPLv2**），混用会让下游打包和合规变复杂。

**建议：** 选定一个，且在 README 顶部明确写出"本项目以 X 许可证发布，部分继承自 luci-theme-material/neobird 的文件保留各自原始声明"。

---

### 1.10 大段 CSS 选择器整体重复（视觉无害但维护陷阱）

位置：`htdocs/luci-static/design/css/style.css`

实测重复样例：

| 选择器 | 出现行号 | 备注 |
| --- | --- | --- |
| `html { ... }` | 139, 237 | 两条都是 text-size-adjust，可合并 |
| `.a-to-btn { text-decoration: none; }` | 1305, 1313 | 完全相同 |
| `.cbi-input-apply, .cbi-button-apply, .cbi-button-edit { color:#fff !important; background:var(--activeColor); }` | 1283, 3458 | 内容相同（第二处只多了 `.cbi-button-positive`） |
| `.node-main-login > .main .cbi-section { margin-top:10px !important; }` | 2542, 2611 | 后一段（2611-2671）是前一段（2542-2602）的整段复制 |
| `#detail-bubble` / `#detail-bubble.in` / `#detail-bubble .head` / `#detail-bubble #bubble-table` | 5 次 | 在 1280、992、700、470、370 五个断点上几乎复制粘贴 |
| 大段被注释的 `.modemenu-buttons` / `#modemenu` 规则 | 569-613 | ~45 行死注释 |

**问题：** 第二段 `.node-main-login` 复制粘贴明显是改动时漏删，留下 60 行无效代码。`#detail-bubble` 在多个断点写同样内容更适合用 `@media (max-width: 992px)` 一次性覆盖。

**建议：** 用 PostCSS / stylelint 加一个 `no-duplicate-selectors` 规则，并整体重排顺序：变量 → 基础 → 组件 → 工具类 → 媒体查询 → 插件兼容。

---

### 1.11 PWA Manifest 的图标尺寸说谎 + 字段陈旧

位置：`htdocs/luci-static/design/manifest.json`

```json
{
  "icons":[
    {"src":"images/icon.png", "sizes":"144x144", "type":"image/png"},
    {"src":"images/icon.png", "sizes":"192x192", "type":"image/png"}
  ],
  "gcm_sender_id":"524223308106",
  "gcm_user_visible_only":true,
  "status":"ok"
}
```

实测：
```bash
$ file htdocs/luci-static/design/images/icon.png
... PNG image data, 267 x 267, 8-bit/color RGB, non-interlaced
```

**问题：**
- 同一个 267×267 的 PNG 文件被声明成 144×144 和 192×192 两个尺寸——iOS / Android 桌面安装时会按声明尺寸缩放，效果不正常。
- `gcm_sender_id` / `gcm_user_visible_only` 来自 Chrome 推送通知早期的 GCM 协议，**Google 已于 2024 年彻底关闭 GCM**，这两个字段现在等同于无效。
- `status:"ok"` 不是 [Web App Manifest 规范字段](https://www.w3.org/TR/appmanifest/)，会被浏览器忽略。

**建议：**
- 生成真正的 192×192 和 512×512 PNG，分别声明。
- 删除 `gcm_sender_id`、`gcm_user_visible_only`、`status`、`prompt_message`。
- 加上 `theme_color`、`background_color`。

---

### 1.12 `favicon.ico` 不是真正的 ICO

```bash
$ file htdocs/luci-static/design/favicon.ico
... PNG image data, 267 x 267, 8-bit/color RGBA, non-interlaced
```

**问题：** 大多数现代浏览器会容忍 PNG-as-ICO，但 IE/老 Edge、某些爬虫、桌面快捷方式工具会读取失败。

**建议：** 生成一个真正的多尺寸 ICO（16/32/48），或者改用 `<link rel="icon" href=".../favicon.png" type="image/png">`。

---

### 1.13 备份/复件文件被提交进仓库

位置：`htdocs/luci-static/design/css/style copy.css` (75 KB)

```bash
$ ls -la htdocs/luci-static/design/css/
... 75040 ... style copy.css
... 74232 ... style.css
$ diff style.css "style copy.css" | wc -l
3951
```

**问题：**
- 文件名带空格，明显是 macOS "复制"的产物。
- 75 KB 会被打进 ipk 增加固件体积。
- 与 `style.css` 已经存在 3951 行差异，留着只会让人困惑哪个是真正的源文件。

**建议：** `git rm "htdocs/luci-static/design/css/style copy.css"`。

---

### 1.14 `menu-design.js` 中的 `null active` class 拼接 bug

位置：`htdocs/luci-static/resources/menu-design.js:82-97`

```javascript
slideClass = hasChildren ? 'slide' : null,
menuClass = hasChildren ? 'menu' : null;
if (isActive) {
    ul.classList.add('active');
    slideClass += " active";
    menuClass += " active";
}

ul.appendChild(E('li', { 'class': slideClass }, [
    E('a', { ..., 'class': menuClass, ... }, ...),
    ...
]));
```

**问题：** 如果 `hasChildren` 是 0（无子菜单）且 `isActive` 为 true，`slideClass` 会从 `null` 经过 `null + " active"` 强制转成字符串 `"null active"`，结果 DOM 上真的会出现 `<li class="null active">`。这是隐式类型转换 bug，CSS 也匹配不到。

**建议：**
```javascript
var classes = [];
if (hasChildren) classes.push('slide');
if (isActive)   classes.push('active');
// 然后用 classes.join(' ') 或者 null
```

---

## 2. 可以简单改善的部分

### 2.1 删掉 JS 监听 resize 改 box-shadow，改为 CSS 媒体查询

位置：
- `htdocs/luci-static/design/js/style.js:21-27`
- `htdocs/luci-static/resources/menu-design.js:193-197`

两处同样的逻辑：

```javascript
if (window.innerWidth <= 992) {
    $("header").css("box-shadow", "0 2px 4px rgb(0 0 0 / 8%)")
} else {
    $("header").css("box-shadow", "17rem 2px 4px rgb(0 0 0 / 8%)")
}
```

**建议：**

```css
@media (max-width: 992px) {
    header { box-shadow: 0 2px 4px rgb(0 0 0 / 8%); }
}
```

然后两段 JS 全部删掉。这同时少一个 jQuery 调用点，朝去 jQuery 化推进一步。

---

### 2.2 清理 8 处空 CSS 规则

位置（脚本扫描自动列出）：

```
951:  h4 { }
1240: .cbi-button + .cbi-button { }
1569: .cbi-rowstyle-2 .cbi-button-down { }
2546: .node-main-login > .main .cbi-map { }
2549: .node-main-login > .main div.cbi-section .cbi-value { }
2581: .node-main-login > .main form > div:nth-last-child(1) { }
2615: .node-main-login > .main .cbi-map { }
2618: .node-main-login > .main div.cbi-section .cbi-value { }
2650: .node-main-login > .main form > div:nth-last-child(1) { }
```

加上 `#swaptotal div div small,...{}` 这类被清空的占位规则（3375-3385 行附近），共约 12 处。直接删除即可。

---

### 2.3 清理大段注释掉的代码

`style.css` 共有 **103 行单行注释**，其中约 60 行是被注释的 CSS 规则；另外还有以下大段：
- 569-613：`.modemenu-buttons` / `#modemenu` 整段被注释（~45 行）。
- 2905-2918：IE hacks 整段被注释。
- 2728-2733：`[data-page^=admin-system-admin]` 整段被注释。
- 多处 `/* background-color: #f9f9f9; */` 散落。

注释代码不属于版本控制范畴——`git log` 才是；建议清理。

---

### 2.4 拆分主 CSS

`style.css` 已经 3611 行 / 74 KB，混杂了：
- 基础重置
- LuCI 组件（cbi-*）
- 插件适配（vssr / openclash / samba / nlbw / ttyd / OpenVPN）
- 5 个媒体查询断点

**建议** 按 `style/base.css`、`style/components.css`、`style/plugins.css`、`style/responsive.css` 拆分；如果不想拆文件，也至少用 `/* ===== 1. Base ===== */` 这种段落注释做视觉分隔。

---

### 2.5 替换 `eval("''")` 为常量

参见 1.6。即使其他都不动，这一行也应该改成：
```javascript
child.firstElementChild.textContent = '';
```

---

### 2.6 修拼写错误 `Inital Setup`

位置：`style.css:803`

```css
.main > .main-left > .nav > li > a[data-title="Inital Setup"]:before { ... }
```

应该是 `Initial Setup`。这意味着该图标永远不会显示（除非用户的语言文件也错拼成 Inital）。

类似地：`style.css:25, 66` 的 `--sectionShaddow` 是 `Shadow` 拼写错误。虽然 CSS 变量名拼错本身合法，但已经只用在被注释掉的代码里，整段变量都可以删。

---

### 2.7 头部 meta 与外部脚本顺序优化

位置：`luasrc/view/themes/design/header.htm:37-74`

观察：
- `<meta name="x5-fullscreen">`、`<meta name="x5-page-mode">` 是 [QQ X5 内核私有 meta](https://x5.tencent.com/docs/index.html)，使用国产 Android 浏览器的用户极少，可以删。
- `<meta name="browsermode" content="application">` 同上，UC 浏览器私有。
- `<meta name="msapplication-tap-highlight" content="no">` IE/Edge Legacy 已死，可以删。
- 同尺寸的图标声明了三遍（icon / apple-touch-icon / msapplication-TileImage）。
- `<script src=".../jquery.min.js">` 放在 `<head>` 里，**阻塞首屏渲染**。LuCI 自己的 cbi.js / luci.js 也放在 head，不可避免，但 jquery 完全可以移到 footer 或加 `defer`。

**建议：** 删除 X5 / UC / IE 私有 meta；图标合并；jquery 加 `defer`。

---

### 2.8 `width: calc(0% + 10rem)` 这种诡异写法

位置：`style.css:502, 2934`

```css
width: calc(0% + 10rem);   /* 等同于 10rem */
width: calc(0% + 17rem);   /* 等同于 17rem */
```

`0% + X` 没有任何作用，可能是从某个用 `calc(100% - 17rem)` 风格拷来后忘了改。直接写 `10rem` / `17rem`。

---

### 2.9 Makefile 缺 `LUCI_DEPENDS`，硬编码版本号

位置：`Makefile`

```makefile
LUCI_DEPENDS:=
PKG_VERSION:=6.0
PKG_RELEASE:=20230224
```

**建议：**
- 如果主题确实依赖某些字体/资源包，写到 `LUCI_DEPENDS`。
- 把 `PKG_RELEASE` 改为 `$(shell git log -1 --format=%cd --date=format:%Y%m%d 2>/dev/null || echo 1)` 之类自动生成，避免每次手改。

---

### 2.10 CI 与 SDK 版本严重过时

位置：`.github/workflows/release.yml`

```yaml
runs-on: ubuntu-20.04
# ...
wget https://archive.openwrt.org/releases/18.06.9/targets/x86/64/openwrt-sdk-18.06.9-x86-64_gcc-7.3.0_musl.Linux-x86_64.tar.xz
```

**问题：**
- `ubuntu-20.04` 已[2025-04 EoL](https://github.com/actions/runner-images/issues/11101)，CI 会被强制升级，过段时间随时挂。
- OpenWrt 18.06.9 是 2020 年发布的版本，目标用户的 lede 大多基于 19.07+ / 21.02+。SDK 版本和实际用户环境不匹配也不会立即出错（主题包是纯静态资源），但意味着没有真正测试过较新 LuCI 的兼容性。
- 没有 push / PR 触发的轻量静态检查，意味着语法错误只能在 release 时才暴露。

**建议：**
- `runs-on: ubuntu-latest` 或 `ubuntu-24.04`。
- SDK 升级到 23.05 / 24.10。
- 增加一个 `lint.yml`：`node --check`、`shellcheck`、CSS lint。

---

### 2.11 可访问性低成本改善

位置：`header.htm`

- `<span class="showSide">` 是承担按钮行为的 span，缺少 `role="button"`、`tabindex="0"`、键盘事件——应该换成 `<button type="button" aria-label="Toggle menu">`。
- `.brand` 是 `<a href="#">`，点击会让浏览器跳到顶部并修改 URL（追加 `#`），改成 `href="<%=url('admin/status/overview')%>"` 或 `<span>` 都更合理。
- `navbar` 里 5 张 `<img>` 全部没有 `alt`，屏幕阅读器无法读出。

这些改动都是几分钟的事但显著提升可访问性评分。

---

### 2.12 uci-defaults 脚本会静默覆盖用户主题

位置：`root/etc/uci-defaults/30_luci-theme-design:3-9`

```sh
if [ "$PKG_UPGRADE" != 1 ]; then
    uci get luci.themes.Design >/dev/null 2>&1 || \
    uci batch <<-EOF
        set luci.themes.Design=/luci-static/design
        set luci.main.mediaurlbase=/luci-static/design
        commit luci
    EOF
fi
```

第二行 `set luci.main.mediaurlbase=...` 是**强制把当前主题切到 Design**，不论用户当前使用的是什么。对一个主题包来说这是常规行为，但建议在 README 里明确说明，否则用户首次安装会困惑"为什么我之前的主题不见了"。

---

## 3. 建议修复优先级

按"风险 × 修复成本"排序：

| 优先级 | 任务 | 文件 | 预估工时 |
| --- | --- | --- | --- |
| **P0** | 删除 `style copy.css` | css/ | 1 min |
| **P0** | 删除 `#cbi-samba-cfg010f89-_tmpl` 死规则 | style.css:3392 | 1 min |
| **P0** | 修 `style.js` 的 `eval` + 空值保护 + `MutationObserver` | style.js:13-18 | 10 min |
| **P0** | 恢复或彻底删除 root 空密码警告块 | header.htm:105 | 5 min（看选择） |
| **P0** | 修 `menu-design.js` 的 `null active` class bug | menu-design.js:82 | 5 min |
| **P1** | 导航栏改用 `url(...)` + 处理 openclash 缺失 | header.htm:87 | 30 min |
| **P1** | 删除全局 `div { font-family: 'HYk2gj'; }` + 修 `@font-face` 'design' | style.css:107-123 | 10 min |
| **P1** | 删除 style.js 中 openclash viewport 注入 | style.js:3-10 | 2 min |
| **P1** | 合并/删除 `.node-main-login` 重复段落 | style.css:2542-2671 | 15 min |
| **P1** | manifest.json 修图标尺寸 + 删 GCM 字段 | manifest.json | 10 min |
| **P1** | 修 jQuery 版本号谎报（或干脆升级） | header.htm:61 + jquery.min.js | 取决于路线 |
| **P2** | 用 `@media` 替代 JS 改 box-shadow | style.js + menu-design.js | 10 min |
| **P2** | 清空所有空 CSS 规则 + 大段注释 | style.css | 30 min |
| **P2** | 统一 LICENSE 声明 | LICENSE + Makefile | 5 min |
| **P2** | 修拼写 `Inital Setup` | style.css:803 | 1 min |
| **P3** | CI 升级 Ubuntu / SDK + 增加 lint workflow | release.yml | 1 h |
| **P3** | 可访问性补齐 (button / alt / aria) | header.htm | 30 min |
| **P3** | 拆分 CSS 文件结构 | style.css | 2-3 h |
| **P3** | 去 jQuery 化（移除 jquery.min.js） | js/ | 1-2 h |

---

## 附录：本次扫描的统计数据

- `style.css`：3611 行 / 74 KB
- `style copy.css`：3353 行 / 75 KB（应删除）
- `!important` 在 `style.css` 中出现：**173 次**
- CSS 单行注释：约 103 处，其中约 60 处是被注释掉的 CSS 规则
- `node-main-login` 选择器出现：44 次（其中很多重复）
- `.cbi-button-*` 系列规则：超过 20 处分散
- jQuery 依赖点：4 处（全部可改为原生 + CSS）
- 已废弃 / 私有浏览器 meta：约 6 个
- 硬编码插件名出现：`openclash`、`vssr`、`samba`、`nlbw`、`ttyd`、`vsftpd`、`OpenVPN` 等共 7 个

如果只能选一件事先做：**P0 那 5 个加起来不到 30 分钟，建议立即处理**。
