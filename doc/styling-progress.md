# Styling Progress — luci-theme-design 视觉系统升级日志

> 起飞时间：2026-05-22
> 基于：[claude_style.md](claude_style.md) 设计提案 + 用户拍板使用 **Emerald** 主色
> 状态：进行中

本文档**实时记录**每一步的改动 —— 改了什么文件、用了哪个 token、为什么、有没有 break change。每个 step 都是独立可 revert 的，commit 粒度按需切。

---

## 🎯 总览

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 — Design Tokens | ✅ 完成 | 把所有魔法数字搬进 CSS 变量；不改任何外观 |
| Phase 1 — 组件迁移 | ✅ 完成 | 按钮 / 输入 / 卡片 / 表单 / 徽章迁移到 token；删 Cocon 等死字体 |
| Phase 2 — 图标系统 | 🟢 lite 完成 | 删 icomoon 字体 + CSS 绘制汉堡；引入 Lucide SVG sprite 给新组件用（完整菜单迁移留独立 PR）|
| Phase 3 — 关键页重设计 | ✅ 完成 | 登录页 CSS 重设计 ✅；Overview Dashboard 卡片化 ✅ |
| Phase 4 — 微交互打磨 | ✅ 完成 | Focus ring 全局 ✅、reduce-motion ✅、主题切换按钮 ✅、Skeleton loader ✅ |
| Phase 5 — 防御层 | ✅ 完成 | CJK / 长德文兜底；硬件能力 fallback；relative color fallback |

**累计 step：20**

---

## 配色决定

| 维度 | 选择 | 理由 |
|---|---|---|
| 主强调色 | **Emerald**（`#10b981` light / `#34d399` dark） | 与"运行中/在线"语义自然挂钩，比原灰青鲜活但不刺眼 |
| 主题策略 | Auto（跟随 OS）+ 手动覆盖按钮 | 给用户最终控制权 |
| 字体策略 | 纯系统字体栈，**不加载 web font** | 性能 + CJK 各 OS 兜底 |
| 字号梯度 | 1.25 比例（Major Third）xs..3xl | 严格梯度，无魔法数字 |
| 间距节拍 | 4px | 标准节拍，无 5/7/9 |
| 圆角节奏 | sm 6 / md 10 / lg 14 / xl 20 / pill | 4 档梯度 |

---

## Steps（按时间顺序，最新在下）

<!-- 每完成一步在这里追加一节 -->

### Step 1 — Phase 0 完成：建立 Design Token 系统

**时间**：2026-05-22
**文件**：`htdocs/luci-static/design/css/style.css:1-200`
**改动量**：+200 行（顶部插入），-90 行（旧 `:root` 全部替换）

**做了什么：**

在 style.css 顶部插入四节：

- **§1 DESIGN TOKENS**（约 90 行）— 完整的 token 系统：
  - 间距 9 档（`--space-1` 到 `--space-9`）
  - 字号 7 档（`--text-xs` 到 `--text-3xl`）
  - 字重 / 行高 / 圆角 / 动效 / z-index
  - 字体栈（系统字体，CJK 自动各 OS 兜底，**不加载 web font**）
  - Emerald 主色 10 档（`--color-accent-50` ~ `900`）
  - 中性色（bg / surface-0/1/2 / text 三档 / border 三档）
  - 语义色（success/warning/danger/info）+ 浅底变体
  - 阴影 4 档

- **§2 LEGACY ALIASES**（约 35 行）— 把所有旧变量名（`--bg`、`--activeColor`、`--inputbgColor` 等 30+ 个）映射到新 token。这一步是**关键设计**：让 3000+ 行的旧 CSS 完全不动也能用新 token，逐步迁移。

- **§3 DARK MODE OVERRIDES**（约 50 行）— 重写深色模式：
  - 用 `#0a0a0b` 替代 `#000`（不再纯黑）
  - 分层灰阶 surface-0/1/2 → `#18181b` / `#27272a` / `#3f3f46`（卡片高于背景）
  - 主色提一档亮度（500 → `#34d399`）保对比
  - 阴影改 1px 边框（深色下阴影不可见）

- **§4 ACCESSIBILITY**（约 8 行）— `prefers-reduced-motion: reduce` → 所有动效 0ms

**为什么用 alias 策略：**

如果直接删 `--activeColor` 改 `--color-accent-500`，3000+ 行 CSS 里所有 `var(--activeColor)` 都得同步改 —— 几百处。出错代价高。

用 alias 策略：
- 旧 CSS 写 `var(--activeColor)` → 自动级联到 `var(--color-accent-500)`
- 新 CSS 写 `var(--color-accent-500)` 也行
- 后续逐组件迁移，迁完一个删一个 alias

**没有破坏的事：**
- ❌ 没改任何组件 CSS（按钮 / 输入 / 卡片暂时还用 alias）
- ❌ 没删任何 @font-face（icomoon / design / Cocon 保留，避免现有图标失效）
- ❌ 没动任何 HTML / JS

**Break change：**
- 视觉上："状态总览" 等标题的颜色从 `#5ea69b` 变成 `#10b981`（emerald），因为 `--activeColor` 现在指向新主色
- 这是**故意的视觉跃迁**，是这次升级的第一个可见信号

**验证：**
```bash
$ python3 -c "import re; c=open('style.css').read(); nc=re.sub(r'/\*.*?\*/','',c,flags=re.DOTALL); print(nc.count('{'), nc.count('}'))"
529 529  ✅
```

**回滚方式：** `git revert` 该 commit 即可。所有旧变量名仍然在用，回滚后旧色立即恢复。

---

### Step 2 — 删除 Cocon-Regular-Font 字体

**时间**：2026-05-22
**文件**：
- `htdocs/luci-static/design/fonts/Cocon-Regular-Font.otf`（删除，27.9 KB）
- `style.css:112-115` 删除 `@font-face`，改为注释占位

**做了什么：**
- 物理删除 27.9 KB 的 Cocon-Regular-Font.otf
- 删除对应的 `@font-face` 声明
- 保留一行注释解释为什么删（防止后人困惑）

**为什么：**
Cocon 是 1970s 装饰字体（Mattel 玩具包装、Stranger Things 海报用过）。贴在 iOS-风格深色 dashboard 上严重违和。详见 claude_style.md §3.1。

**Break change：**
- `.brand` 类（顶栏 hostname）会自动 fallback 到下一个字体。在 Step 3 修复。

---

### Step 3 — 重写 `.brand` 标志（系统字体 + accent dot）

**时间**：2026-05-22
**文件**：`style.css:648-680`

**做了什么：**
- `.brand` 字体从 `Cocon-Regular-Font`（25px / weight 900）改为系统字体（`--text-lg` / `--weight-semibold`）
- 添加 `::before` 伪元素，在 hostname 前显示一个 8px 强调色圆点（accent dot）作为身份识别
- 高度从 60px 调整为 56px（匹配新顶栏 56px = 14 × 4px 节拍）
- Hover 态：从无变化 → 改为渐变到 `--color-accent-600`

**为什么：**
- 系统字体 + accent dot 视觉识别 = 与 [doc/style-preview.html](style-preview.html) Dashboard view 一致
- 56px 高度对齐 4px 节拍（claude_style.md §6.1）

**Before / After：**
```
Before: [           OpenWrt           ]   ← Cocon 复古装饰
After:  [● OpenWrt                     ]  ← 系统字体 + accent dot
```

---

### Step 4 — 按钮系统重写

**时间**：2026-05-22
**文件**：`style.css:1300-1430`（约 130 行）

**做了什么：**
- 默认按钮（`.cbi-button / .btn`）从"蓝紫色 + UPPERCASE + min-width:80px + height:35px" 改为"中性 secondary 风格"：
  - 背景 `--color-surface-0` + 1px `--color-border-default` 边框
  - `text-transform: none` —— 删除 UPPERCASE
  - 删除 `min-width: 80px` —— 按内容自适应
  - `min-height: 36px`、`border-radius: var(--radius-md)`
  - 字体 `--text-sm` + `--weight-medium`
  - `display: inline-flex + gap` 支持图标 + 文字组合
- **Primary**（`cbi-button-apply / cbi-button-positive / cbi-button-edit / cbi-input-apply`）= emerald
  - hover: 加深到 `--color-accent-600` + `translateY(-1px)` + `--shadow-md`
- **Action**（`cbi-button-link / cbi-button-add / cbi-button-save / cbi-button-find / cbi-button-reload / cbi-button-action`）= `--color-info` 蓝
- **Danger**（`cbi-button-reset / cbi-button-remove / cbi-button-negative / cbi-input-remove / cbi-input-reset`）= `--color-danger` 红
- Focus ring：用 `:focus-visible` + `--shadow-focus`（强调色 35% 透明环）
- Transition：精细控制（background / border / color / shadow / transform）

**Break change：**
- 现在 4 类按钮颜色**有清晰语义**：中性 / 主操作 / 次主操作 / 危险
- 与原项目"主色蓝紫色 → 次色青色 → 危险灰蓝"的混乱体系完全不同

---

### Step 5 — 输入框系统重写

**时间**：2026-05-22
**文件**：`style.css:402-460`

**做了什么：**
- 删除原来的紫色 focus（`#948FE1 box-shadow`，全主题没第二处用到，神秘）
- 改为强调色 focus ring：`var(--shadow-focus)` = `0 0 0 3px var(--color-accent-500-35)`
- Font family 从 `-apple-system, 'Microsoft Yahei'` 改为 `var(--font-sans)`（更完整 CJK 兜底）
- Padding 从 `5px 10px` 改为 `var(--space-2) var(--space-3)`
- Height 从 `2.8rem`（44.8px）改为 `min-height: 40px`
- Border-radius 从 `8px` 改为 `var(--radius-md)` (10px)
- Hover 态新增（border 颜色加深）
- `.cbi-input-invalid` 加危险色 focus ring

---

### Step 6 — 卡片 / cbi-section 重写

**时间**：2026-05-22
**文件**：`style.css:1074-1110`

**做了什么：**
- 卡片新增明显边框：`1px solid var(--color-border-subtle)`
- 阴影从无 → `var(--shadow-sm)`
- 圆角统一为 `var(--radius-lg)` (14px)，告别 8px 一刀切
- Padding 从 `10px` → `var(--space-5)` (24px)，给数据呼吸空间
- Line-height 从 `1` → `var(--leading-normal)` (1.5)
- Margin 用 token，告别 `margin-bottom: 20px`

---

### Step 7 — 标题（h1/h2/h3）去强调色

**时间**：2026-05-22
**文件**：`style.css:1056-1100`

**做了什么：**
- h1/h2/h3 颜色从 `var(--activeColor)` 改为 `var(--color-text)`
- 字号严格梯度：h1 = 2xl (24px) · h2 = xl (20px) · h3 = lg (18px)
- 字重统一 `--weight-semibold` (600)，告别 `font-weight: bold/900` 混杂
- h2 去掉 `text-transform: capitalize`（之前会让"Status"变"STATUS"）
- h1 添加底部分隔线（用 `--color-border-subtle`）

**关键变化：标题不再用强调色当颜色。**

claude_style.md §3.2 原则：标题靠**字重 + 字号**建立层级，颜色用 `--color-text`。强调色省给"需要点击的东西"（按钮、链接、active 状态）。

---

### Step 8 — 语义色清洗 + alert message 重写

**时间**：2026-05-22
**文件**：`style.css:746-815`

**做了什么：**
- `.danger` 和 `.warning` 原本**都用同一个橙红 `#FF7D60`** —— 拆分：
  - `.danger` → `var(--color-danger)` (red-500 `#ef4444`)
  - `.warning` → `var(--color-warning)` (amber-500 `#f59e0b`)
  - `.success` → `var(--color-success)` (emerald-500 `#10b981`)
- `.alert-message` 从"白字深底"重写为"浅底彩色字"：
  - `.alert-message.warning` = 浅黄底 + 橙字 + 浅橙边框
  - `.alert-message.danger / .error` = 浅红底 + 红字
  - `.alert-message.success / .notice` = 浅绿底 + 绿字
- `[data-indicator]` 等也迁移到 token

**为什么：**
原项目"warning 用红 + danger 用红"是语义事故。现在严格四色（success/warning/danger/info）+ 浅底变体，符合现代设计系统惯例。

---

### Step 9 — 防御层（Phase 5）

**时间**：2026-05-22
**文件**：`style.css:280-360`

**做了什么：**

加入 §5 DEFENSIVE BASELINE 段，8 个子规则：

| 子规则 | 处理什么 |
|---|---|
| 5.1 长文字溢出 | `.brand`、`.cbi-value-title`、`.tile-label`、`.nav-item`、`[data-title]` 添加 `overflow-wrap: break-word` + `hyphens: auto`。处理德语 / 俄语长单词撑爆容器 |
| 5.2 单行截断 | 顶栏 brand + 侧栏菜单项 = ellipsis 截断。极端长 hostname 不会撑破布局 |
| 5.3 CJK 特殊处理 | `:lang(zh/ja/ko)` 禁用 `letter-spacing` 和 `text-transform: uppercase`（CJK 字符这两个属性无意义甚至有害） |
| 5.4 数字等宽 | tile 数值、indicator strong、progress 数字、表格 mono = `tabular-nums`（CPU 12%→15% 时不跳位） |
| 5.5 backdrop-filter 兜底 | `@supports not (backdrop-filter)` → navbar 改不透明背景。处理嵌入式 webview 不支持模糊 |
| 5.6 :focus-visible 兜底 | `@supports not selector(:focus-visible)` → 老 Safari 用普通 `:focus` 也能显示 focus ring |
| 5.7 hostname 截断 | `.brand` 和 `.mock-brand` 加 `max-width: 240px`。POSIX 允许 63 字符 hostname，不限制就会撑破 |
| 5.8 数据缺失占位 | tile-value / tile-meta 空时显示 `—`（em dash），不会留空白 |

**关键设计：不用 relative color syntax**

虽然 CSS `rgb(from var(...) r g b / 35%)` 很优雅，但安卓 WebView < 119 不支持。所以 token 里直接定义了 `--color-accent-500-12` 和 `--color-accent-500-35` 两个预派生的 alpha 变体，全主题不依赖 relative color。

---

### Step 10 — 基础重置（html/body）token 化

**时间**：2026-05-22
**文件**：`style.css:378-388`

**做了什么：**
- `font-family` 从 `-apple-system, 'Microsoft Yahei'` 升级到完整 `var(--font-sans)` 栈
- `font-size: 0.92rem`（神秘倍率）→ `var(--text-base)` (1rem)
- `line-height: 150%` → `var(--leading-normal)` (1.5)
- `background-color: var(--bg)` → `var(--color-bg)`
- `color: var(--textColor)` → `var(--color-text)`
- 新增 `-webkit-font-smoothing: antialiased` 和 `-moz-osx-font-smoothing: grayscale`（让文字在 Retina 屏更清晰）

---

### Step 11 — 收尾：扫清 `text-transform: uppercase` 和魔法紫色

**时间**：2026-05-22
**文件**：`style.css:2696-2712`

**做了什么：**
- `.label, [data-indicator]` 重写为药丸式徽章：
  - `border-radius: 3px` → `var(--radius-pill)`
  - 删除 `text-transform: uppercase`
  - `font-weight: bold` → `var(--weight-medium)`
  - 字号 `var(--text-xs)`
  - 用 inline-flex + gap 支持图标 + 文字
  - 默认中性色（`--color-surface-1` 底 / `--color-text-muted` 字），具体语义由 `.success/.warning/.danger` 等子类覆盖

**验证：**
```bash
$ grep -c "text-transform: uppercase" style.css   →  0
$ grep -c "#948FE1" style.css                     →  0
（除注释外）
```

---

## 📊 本轮（Phase 0+1+5）累计变化

| 指标 | 之前 | 之后 |
|---|---|---|
| CSS 行数 | 3444 | **3778** (+334) |
| CSS 大小 | 71 KB | **86 KB** (+15 KB，主要是 token 定义) |
| 字体文件总大小 | 51 KB（5 个文件）| **23 KB**（4 个文件，删了 Cocon 28 KB） |
| Magic numbers (uppercase / 紫 focus) | 多处 | **0** |
| Design tokens | 0 | **80+** |
| Legacy aliases（过渡用） | 0 | 30+（后续可删） |
| 强调色一致性 | 5 套抢戏 | **1 套 emerald** |
| 语义色冲突 | warning = danger 同色 | **4 色严格分** |
| CJK / 长德文兜底 | 无 | ✅ |
| Hardware fallback (backdrop-filter / focus-visible) | 无 | ✅ |
| Web font 加载 | Cocon 28 KB | **0**（纯系统字体） |

---

## 🚀 第二轮起飞（Step 12-20）：Phase 2 lite + Phase 3 + Phase 4

### Step 12 — 删除 icomoon 字体 + CSS 绘制汉堡菜单

**时间**：2026-05-22
**文件**：
- `style.css:316-325`（删除 @font-face 'icomoon'）
- `style.css:3216-3231`（重写 `.showSide:before`）
- 删除：`fonts/font.eot` `font.ttf` `font.woff` `font.svg`（共 4 个文件，~8 KB）

**做了什么：**

icomoon 字体加载了 4 个文件（EOT 1.9KB + TTF 1.7KB + WOFF 1.8KB + SVG 2.4KB ≈ 7.9 KB）只为渲染 1 个图标——`.showSide:before` 上的 `\e20e` 汉堡菜单。

替换为**纯 CSS 三线汉堡**：

```css
.showSide:before {
    content: '';
    display: block;
    width: 22px;
    height: 16px;
    background:
        linear-gradient(currentColor, currentColor) top    / 100% 2px no-repeat,
        linear-gradient(currentColor, currentColor) center / 100% 2px no-repeat,
        linear-gradient(currentColor, currentColor) bottom / 100% 2px no-repeat;
    color: var(--color-text);
}
```

**收益：**
- -8 KB 字体 + 4 个 HTTP 请求
- 颜色继承 `currentColor`（深色 / 浅色自动跟主题）
- 锐利的矢量线条（字体在某些 zoom 下会糊）
- 加 hover 态：移上去变 accent 色

---

### Step 13 — 引入 Lucide SVG sprite

**时间**：2026-05-22
**文件**：新建 `htdocs/luci-static/design/icons.svg`（5.3 KB / 16 个图标）

**包含的图标：**
sun · moon · monitor（主题切换三态）· user · lock · eye · eye-off（登录页）· shield-check（登录 logo） · arrow-right（按钮）· cpu · memory · thermometer · activity（dashboard tile）· loader · check-circle · alert-triangle

**用法：**
```html
<svg class="svg-icon"><use href="/luci-static/design/icons.svg#i-sun"/></svg>
```

**策略：**
- **不替换**已有的 'design' 图标字体（菜单图标 / 状态指示器都还在用）—— 那是个独立 PR 的工作量
- **只给新组件用 SVG**：主题切换按钮 / 登录页 leading icon / skeleton 等
- 图标颜色用 `stroke="currentColor"`，可继承文字色
- 图标大小用 `font-size` 控制（`.svg-icon { width: 1em; height: 1em }`）

---

### Step 14 — `.svg-icon` 工具类 + 主题切换按钮（Phase 4a）

**时间**：2026-05-22
**文件**：
- `style.css:360-540`（新增 §6 SVG ICON UTILITY 和 §7 THEME TOGGLE）
- `luasrc/view/themes/design/header.htm:79-83`（加 `#theme-toggle` 按钮）
- `htdocs/luci-static/design/js/style.js`（重写为 IIFE + 三态切换逻辑）

**做了什么：**

#### 7.1 `.svg-icon` 工具类
- `width: 1em; height: 1em` —— 跟字号缩放
- `stroke: currentColor` —— 跟当前文字色
- `flex-shrink: 0` —— flex 容器里不变形
- `vertical-align: -0.125em` —— 与文字基线对齐
- `.svg-icon-sm/md/lg/xl` 四档 14/18/24/32px

#### 7.2 主题切换按钮 (`.theme-toggle`)
- 36×36 圆角方按钮
- 三态：`auto`（跟随 OS）/ `light` / `dark`
- 三个 SVG icon 叠在按钮里，CSS 根据 `html[data-theme]` 显示对应那个
- Hover 灰底 + accent 文字色
- `:focus-visible` 强调色 ring

#### 7.3 JS 切换逻辑
```javascript
// auto → light → dark → auto，三态循环
var cur = root.getAttribute('data-theme') || 'auto';
var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
root.setAttribute('data-theme', next);
localStorage.setItem('design-theme', next);  // 持久化
```

#### 7.4 CSS 强制覆盖
- `html[data-theme="dark"]` 把所有深色 token 重新定义一遍 → 即使系统 `prefers-color-scheme: light` 也强制深色
- `html[data-theme="light"]` 同理强制浅色
- `html[data-theme="auto"]` 不覆盖 → 自然走 `prefers-color-scheme` 媒体查询

**与之前的关系：**
- 之前我们在 `@media (prefers-color-scheme: dark)` 里定义了深色 token
- 这一步加的是"用户手动**覆盖**系统偏好"的能力
- 这是 claude_style.md §10.2 承诺的"3 态切换"

---

### Step 15 — Skeleton Loader（Phase 4b）

**时间**：2026-05-22
**文件**：`style.css:784-840`

**做了什么：**

替换原来的"`Collecting data...` + 旋转图标"loading 态。

**之前：** 全屏白底 + 居中文字 + 一个旋转字体图标（content: "\e603"）。看起来很 2014。

**之后：**
- 全屏淡灰底（`--color-bg`）+ 顶部居中放一个 720px 宽的 skeleton 块
- 用 `linear-gradient` 在一个 `<div>` 里画出**模拟未来内容形状**的占位条：
  - 一条 28px 高的"标题"占位（60% 宽）
  - 一条 16px 高的"副标题"（40% 宽）
  - 两个 80px 高的"卡片"占位
- 用 `@keyframes skeleton-pulse` 让整个 skeleton 在 1.6s 内做明暗呼吸（55% ↔ 100% 透明度）

**为什么这样做：**
原 LuCI markup 是 `<div class="loading"><span><div class="loading-img"></div>Collecting data...</span></div>`。我们不动 HTML，只用 CSS 把 `.loading-img` 这个空 div 用 `background: linear-gradient(...)` 画出多条占位。

零 JS 改动，纯 CSS 升级。

---

### Step 16 — 登录页 CSS 重设计（Phase 3a）

**时间**：2026-05-22
**文件**：`style.css:2944-3120`（约 175 行重写）

**做了什么：**

LuCI 登录页 = `<body class="node-main-login">` + LuCI 自带 sysauth template。**我们不动 LuCI 的 template**，只用 CSS 把它从"纯黑空白"重塑成"卡片式登录"。

#### 16.1 整页背景
- 不再 `background-color: var(--bgwhite) !important`（纯白/纯黑）
- 改为 `var(--color-bg)`（浅灰 / 深灰）
- 加 `::before` 伪元素：两个对角的强调色径向辉光（`--color-accent-500-12`）
- 视觉效果：背景**微微发光**，不再死板

#### 16.2 登录卡片
- 卡片本体（`div.cbi-section`）从"无样式 + 居中"改为：
  - 背景 `--color-surface-0`
  - 边框 `--color-border-subtle`
  - 圆角 `--radius-xl` (20px)
  - **大阴影** `--shadow-lg`
  - 最大宽度 420px，剧中
  - Padding `--space-6` `--space-5`

#### 16.3 Logo（用 mask 画盾牌图标）
卡片顶部用 `::before` 伪元素加一个 **56×56 px 强调色圆角方块**，里面用 CSS mask 切出一个白色盾牌图标。**零图片资源**，纯 CSS。

#### 16.4 表单
- "用户名" / "密码" label 改为浅色小字 + 排在输入框上方（之前是和输入框并排）
- 输入框 100% 宽 + `min-height: 44px`（触摸友好）
- 输入框 padding/边框/focus 自动继承前面 Step 5 的输入框 token

#### 16.5 登录按钮
- 100% 宽 + 强调色背景 + 大字
- Hover 上浮 `translateY(-1px)` + 阴影加深
- `min-height: 44px` 触摸友好

#### 16.6 删除"复位"按钮
LuCI 默认登录页有一个 reset 按钮，登录场景毫无意义。用 `display: none` 隐藏。

**Before / After：**

```
Before:                    After:
[纯黑/纯白]                  ╭──────────────────╮
                            │       ▮  ← Logo  │
   需要授权                  │                  │
   请输入用户名和密码           │   欢迎回来        │
                            │   登录以管理路由器   │
   [root            ]       │   USERNAME       │
   [████████        ]       │   [root        ] │
                            │   PASSWORD       │
   [登录] [复位]              │   [••••••••    ] │
                            │   ┌─────────────┐│
[纯黑/纯白]                  │   │  登录   →   ││
                            │   └─────────────┘│
                            ╰──────────────────╯
                            (背景有淡淡的 emerald 辉光)
```

---

### Step 17 — Overview Dashboard 卡片化（Phase 3b）

**时间**：2026-05-22
**文件**：`style.css:4046-4115`

**做了什么：**

LuCI Overview 页 = `body.node-admin-status-overview > .main > #view`，里面有多个 `.cbi-section` 兄弟节点（系统信息 / 内存 / 接口 / DHCP 客户端 / ...）。

**不动 LuCI 的 controller / view**，只用 CSS Grid 把这些 section **自动两栏排布**：

```css
.node-admin-status-overview #view {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: var(--space-4);
}

/* 第一个 section（系统信息）占满整行 */
.node-admin-status-overview #view > .cbi-section:first-of-type {
    grid-column: 1 / -1;
}

/* hover 微上浮 */
.node-admin-status-overview #view > .cbi-section:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
}
```

**效果：**
- 屏宽够 → 两栏 / 三栏自动布局
- 屏宽 < 768px → 单栏
- 每个 section 是一个有阴影 + 边框的卡片
- Hover 微微上浮
- 表格 `td` 第一列（label）变浅色小字，第二列（value）变 mono 等宽数字

**比真的"重写 Dashboard"成本低 99%**——LuCI 给什么数据我们渲染什么数据，只是排版改了。

---

### Step 18 — 全局 focus-visible + scrollbar 现代化

**时间**：2026-05-22
**文件**：`style.css:479-518`

**做了什么：**

#### 18.1 Scrollbar
- 宽度从 4px → 8px（手感更好）
- thumb 颜色用 `--color-border-default`，hover 加深到 `--color-border-strong`
- 加 2px 透明边距（让 thumb 视觉上比 track 窄）
- Firefox 用 `scrollbar-width: thin` + `scrollbar-color`

#### 18.2 Global Focus Ring
任何 `a / button / [role="button"] / [tabindex]` 在 `:focus-visible` 时都有 `--shadow-focus`。这是 claude_style.md §9.1 承诺的"所有交互元素都有焦点环"。

`:focus-visible` 只在键盘 focus 时触发，鼠标点击不会有视觉环（避免点击后留下烦人的描边）。

---

### Step 19 — 进度条 token 化

**时间**：2026-05-22
**文件**：`style.css:2316-2354`

**做了什么：**
- 高度从 `1.5rem` (24px) 保持 24px（已经合适）
- 圆角从 `5px` → `var(--radius-pill)` (药丸形)
- 背景从 `var(--progressbarColor)` (#c8c8c8) → `var(--color-surface-2)`
- 填充从 `var(--progressbar)` → `var(--color-accent-500)`
- transition 用 token (`var(--motion-normal) var(--ease-out)`)
- 进度数字加 `tabular-nums`（91% → 12% 不会跳位）
- **新加 `mix-blend-mode: difference` + `filter: invert(1)`**——这个组合让百分比文字在浅色背景上是深色、在强调色填充上是白色，自动适配

---

### Step 20 — 收尾验证

**时间**：2026-05-22

**全部检查通过：**
```bash
✅ node --check style.js
✅ node --check menu-design.js
✅ JSON.parse manifest.json
✅ sh -n uci-defaults
✅ XML.parse icons.svg
✅ CSS braces balanced (585 pairs, 4141 lines, 93 KB)
```

**病灶清零：**
```bash
icomoon font files:       0  ✅
Cocon font files:         0  ✅
text-transform: uppercase: 0  ✅
icomoon CSS refs:         0  ✅
```

---

## 📊 第二轮（Step 12-20）累计变化

| 指标 | 第一轮后 | 第二轮后 |
|---|---|---|
| CSS 行数 | 3778 | **4141** (+363) |
| CSS 大小 | 86 KB | **93 KB** (+7 KB) |
| 字体文件总大小 | 23 KB | **22 KB**（删了 icomoon ~8 KB） |
| 字体文件数量 | 4 个 | **3 个**（只剩 design 字体 woff2/woff/ttf） |
| 新增 SVG sprite | 0 | **5.3 KB**（16 个图标） |
| 用户可控主题 | 否（仅跟随 OS） | **三态切换 + 持久化** |
| Skeleton loader | 旋转图标 | **多条占位 + 呼吸动画** |
| 登录页 | 纯黑空白 | **卡片 + logo + 渐变背景** |
| Overview 布局 | 单栏长列表 | **CSS Grid 自适应卡片** |
| 全局 focus ring | 无 | **`a/button/[role=button]` 全部覆盖** |
| Scrollbar | 4px 一刀切 | **8px + hover 加深 + Firefox 支持** |
| 进度条数字适配 | 固定色 | **mix-blend-mode 自动反色** |

## 🎯 用户能立刻看到的变化

1. **顶栏右上多了一个主题切换按钮**（sun/moon/monitor 图标），点一下循环切换 light → dark → auto
2. **登录页变成卡片式**，有 emerald 主色辉光背景、shield logo、卡片有大阴影、删了"复位"按钮
3. **Overview 状态页变成两栏卡片网格**，hover 微上浮
4. **加载等待界面变成 skeleton 占位**，不再是旋转图标 + 文字
5. **键盘 Tab 走过所有按钮 / 链接都有 emerald 焦点环**
6. **滚动条变粗一点（4→8px）**，hover 时颜色加深
7. **侧栏汉堡菜单**（小屏才显示）用 CSS 三线绘制，不再依赖字体



## 🎯 用户可见的视觉变化

| 元素 | 之前 | 之后 |
|---|---|---|
| Brand "OpenWrt" | Cocon 复古字体 + 25px / 900 字重 | 系统字体 + 18px / 600 + 强调色圆点前缀 |
| 主操作按钮 | UPPERCASE / `min-width:80px` / 紫色 hover | 自适应宽 / 自然 case / emerald + 阴影上浮 |
| Action 按钮（保存等） | 绒紫色 `rgb(106,101,214)` | `--color-info` 蓝 `#3b82f6` |
| Danger 按钮（删除） | 灰蓝 `#617486` | `--color-danger` 红 `#ef4444` |
| 输入框 focus | 神秘紫光晕 `#948FE1` | emerald 35% 透明 ring |
| 卡片 | 无边框 + 不对称阴影 | 1px 浅边框 + 对称阴影 + 14px 圆角 |
| h1/h2/h3 | 全是青色 `#5ea69b` | 用字重 + 字号建立层级，颜色用 `--color-text` |
| Alert.warning vs .danger | 都是橙红 `#FF7D60` | 橙 vs 红清晰分离 |
| 字号梯度 | 0.92rem 神秘倍率 | 1.25 比例严格梯度 |
| 强调色总数 | 5 套互不协调 | 1 套 emerald 配 10 档 |
| 深色背景 | 纯 `#000` | `#0a0a0b` + 分层灰阶 |
| 字体加载 | 加载 Cocon | 0 加载（系统字体） |
| 长德文 / 俄文 | 撑爆容器 | overflow-wrap + ellipsis 兜底 |

---

## 🚨 第三轮（Step 21）：真实部署后才发现的 minifier 问题

> 触发时间：2026-05-23
> 触发场景：第一次把 GitHub Actions 自动构建的 ipk 装到真实的 ImmortalWrt 24.10 路由器上，访问 `/cgi-bin/luci/` 后整页崩。
> 性质：跟前 20 个 Step 完全不同——前面都是 source 改写 / token 重构 / 视觉重设计；这一步是**deploy 后才暴露的 build-pipeline 兼容性问题**，所有静态审计都没抓到。

### Step 21 — Minifier-safe CSS 重写

**时间**：2026-05-23
**文件**：`htdocs/luci-static/design/css/style.css`
**改动**：50 处 rgb→rgba + 31 token 重命名（92 处引用同步）

#### 现象

部署后访问 LuCI：

- navbar 的 500×500 PNG 图标按 **native 尺寸**渲染、铺满视口
- `.navbar { position: fixed; bottom: 0; width: 100%; }` 完全没生效
- 整个 view 卡在 "正在载入视图…"
- 顶栏 header 看起来部分正常 → CSS **部分**有效

#### 根因（ImmortalWrt LuCI 24.10 build pipeline 的 CSS minifier 有两个 bug）

**ImmortalWrt 的 luci-theme-* 包在构建时会跑一个 CSS minifier**（不是我们自己加的，是 LuCI build infrastructure 自带）。它把我们 4141 行 / 95KB 的 source 压缩成单行 / 66KB，节省 ~30%。但这个 minifier 本身有 bug：

##### Bug A · 现代 CSS Color 4 语法被截断

```css
/* source 写法 (CSS Color Module Level 4，Chrome 65+ / Safari 12.1+ 都支持) */
.alert-message.warning {
    border-color: rgb(245 158 11 / 25%);   /* 空格分隔 + / 表透明度 */
}

/* minifier 输出 */
.alert-message.warning{...;border-color:rgb(245}    /* ← 截到第 1 个数字 + 错位 } */
```

minifier 把空格当成 "multiple values" 分隔符，**只保留第一个数字 + 提前结束 declaration**。源代码里有 **50 处**这种语法（shadow / alert border / focus ring / 卡片透明 / dark mode 边框）。

##### Bug B · Custom property 名被不一致地 lowercased

```css
/* source（写得一致，全驼峰） */
:root {
    --color-text-onAccent: #FFF;           /* 定义 */
}
.cbi-button-apply {
    color: var(--color-text-onAccent);     /* 引用 */
}

/* minifier 输出 */
:root{--color-text-onaccent:#FFF}                         /* 定义被 lowercase */
.cbi-button-apply{color:var(--color-text-onAccent)}       /* 引用保留驼峰 */
```

**CSS 自定义属性名是 case-sensitive**——引用找不到定义，全部 fallback to `unset`。

源代码里 **31 个 unique camelCase token** 名（`--activeColor` / `--sectionBorder` / `--inputBorder` / `--navBorder` / `--navbgColor` / `--color-text-onAccent` / ... 都是 styling-progress §2 legacy aliases），覆盖 **92 处** `var()` 使用。

##### 两个 bug 叠加 → .navbar 全崩

- Bug B 让 `--navBorder` / `--navbgColor` 在 .navbar block 内全部 unset
- Bug A 在 alert / shadow / `--shadow-*` token 上同样截断，部分 declaration 整条无效
- 结合 CSS parser 的 error recovery（遇到错误跳到下一个 `)` 才 resume），导致 minifier 输出某些段落的语法错乱蔓延
- `.navbar { width: 100%; position: fixed; ... }` 实际没匹配上 → 500×500 PNG 暴走

#### 修复

`htdocs/luci-static/design/css/style.css` 单文件 atomic 替换：

```python
# Fix A: rgb(R G B / X%) → rgba(R, G, B, X/100)
content = re.sub(
    r'rgb\((\d+)\s+(\d+)\s+(\d+)\s*/\s*(\d+)%\)',
    lambda m: f'rgba({m[1]}, {m[2]}, {m[3]}, {int(m[4])/100:g})',
    content
)

# Fix B: lowercase all camelCase --custom-property names
for camel in find_camel_token_names(content):
    content = content.replace(camel, camel.lower())
```

**结果**：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 现代 `rgb(R G B / A%)` 用法 | 50 处 | **0** |
| camelCase custom property | 31 名 / 92 引用 | **0** |
| 文件大小 | 95582 B | 95738 B (+156, rgba 比 rgb 略长) |
| 大括号平衡 | 585 / 585 | **585 / 585** |
| 部署后 visual 状态 | 整页崩 | **正常** |

#### 永久 CSS 写作约束（v3 之后所有 contributor 必读）

LuCI 的 build pipeline 短期内不会修这个 minifier，**任何新加的 CSS 规则都必须遵守**：

| ❌ 不能用 | ✅ 改用 | 原因 |
|---|---|---|
| `rgb(R G B / A%)` — CSS Color 4 空格语法 | `rgba(R, G, B, A)` — 逗号语法 | Bug A 截断 |
| `hsl(H S% L% / A%)` | `hsla(H, S%, L%, A)` | 同 Bug A |
| `--camelCaseTokens` | `--lowercase-tokens`（kebab-case） | Bug B 不一致 lowercase 定义 |
| `oklch()` / `lab()` / `lch()` / `color()` | 暂时也别用，等真实部署验证过再开放 | 保险起见 |

这条约束也写进了 [finalplan.md](finalplan.md) §10、`.github/workflows/lint.yml` 加了对应的 CI 强制规则。

#### 教训

**静态 source 审计 + lint 都无法发现这种 bug**：

| 防御层 | 是否抓到 | 为什么没抓到 |
|---|---|---|
| gemini / codex / claude 三轮初次审计 | ❌ | 看不到 minifier 行为 |
| finalplan v1/v2/v3 codex 复盘 | ❌ | 同上 |
| `lint.yml`：CSS brace / JS syntax / shellcheck / 禁 CJK | ❌ | 跑在 source CSS 上，不经过 minifier |
| GitHub Actions `build.yml`：跑 `make package/compile` | ❌ | 验证 ipk 可 build + 大小合理，没对比内容 |

**只有真实部署到 ImmortalWrt 路由器并在浏览器打开**才暴露。这是个 humbling moment——证明无论静态 lint / audit 多严格，**production deploy 永远是最终验收**。

未来加固（值得做但本轮未实施）：

1. **Build-time diff check** — CI 解 ipk → diff minified CSS vs source → 任何非空白变化都 fail（catch 未来 minifier 行为再变）。~2h。
2. **Visual regression** — qemu 起 ImmortalWrt 装 ipk + Playwright 截 status overview / login 对比基准。~6-8h。
3. **Lint 禁 camelCase 自定义属性** — `.github/workflows/lint.yml` 加 step（**本轮已实施**）。

---

## 📊 第三轮（Step 21）累计变化

| 指标 | 第二轮后 | 第三轮后 |
|---|---|---|
| 现代 rgb()/hsl() 空格语法 | 50 处 | **0** |
| camelCase 自定义属性 | 31 名 / 92 引用 | **0** |
| CSS 部署后 visual 状态 | 整页崩 | **正常** |
| 永久约束写入文档 | 无 | **styling-progress §3 + finalplan §10** |
| CI 防御 | 仅 brace / syntax / CJK | + **minifier-unsafe syntax 检测** |

---

### Step 22 — menu-design.js handleMenuExpand 修复 `<li>.active` 维护

**时间**：2026-05-23（Step 21 上线后立刻发现）
**文件**：`htdocs/luci-static/resources/menu-design.js`
**改动**：handleMenuExpand 三处修改（~10 行 net diff）

#### 触发场景

Step 21 修了 CSS minifier 让视觉正常之后，**点击一级菜单**（System / Services / Docker / VPN / 网络）切换时**二级菜单瞬开瞬收**——slideDown 完成的同时立刻消失。

#### Root cause（详见 finalplan §10.10）

CSS 的 submenu display 规则 key 在 `<li>` 上：

```css
.main > .main-left > .nav > .slide.active > ul { display: block }
.main > .main-left > .nav > .slide > ul { display: none }
```

但 `handleMenuExpand` 只动 `<a>.active` 和 `<ul.slide-menu>.active`，**从不维护 `<li>.active`**：

- 初次 render 时 `renderMainMenu` 给当前 page 的 `<li>` 加了 `slide active`，首次访问 OK
- 切换菜单后：旧菜单 li 的 active 未移除 + 新菜单 li 的 active 未添加
- slideDown 强制 `style="display: block"` 短暂显示，cb 清空后立刻被 CSS hide

**4 年前从 material theme 继承的 bug**——原项目 CSS selector 可能不同所以没暴露，v3 重构 CSS 时没改这条 rule 也没意识到 JS 缺失，v4 修了 minifier 让 CSS 完整生效后才暴露。

#### 修复（diff 见 finalplan §10.10 完整代码）

handleMenuExpand 三处：

1. `querySelectorAll` 改选 `li.slide.active`（之前是 `li > ul.active`）
2. slideUp cb 增加 `activeSlide.classList.remove('active')`
3. slideDown **之前同步**加 `slide.classList.add('active')` ← **关键**

第 3 点的同步时机：必须在 slideDown 设 inline `display:block` 之前加 `<li>.active`，让 CSS keep-visible 规则在 transitionend cb 清空 inline style 时立刻接管，否则会闪一下又 hide。

#### 验证

修复后预期行为：
- 点 System → Status 子菜单收起 (slideUp 200ms) + System 子菜单展开 (slideDown 200ms) + 保持
- 再次点 System → 收起（collapse 模式）
- 反复切换 System ↔ Services ↔ Docker ↔ VPN ↔ 网络 → 每次都正常 expand 且保持

#### 跟 Step 21 同源不同角度的教训

| Step | static audit 漏在哪 |
|---|---|
| 21（minifier） | 漏在 **build pipeline 行为**——source 看不到 minifier 做了什么 |
| 22（菜单 active） | 漏在 **JS 操作 DOM class 与 CSS selector 对齐**——这个关系无法静态推导，**必须真实交互测试** |

两者合起来证明：production deploy 不只是"装上能跑"，还包括**用户真正会做的所有交互**。未来 visual regression / e2e 测试（finalplan §10.7 C-future-2）**必须包括点击每个一级菜单**作为标准场景。

---

## 📊 第三轮（Step 21 + 22）累计变化（更新）

| 指标 | 第二轮后 | 第三轮 Step 21 后 | 第三轮 Step 22 后 |
|---|---|---|---|
| 现代 rgb()/hsl() | 50 处 | **0** | 0 |
| camelCase 自定义属性 | 31 名 | **0** | 0 |
| menu-design `<li>.active` 维护 | ❌ 不维护 | ❌ 不维护 | **✅ 维护** |
| 部署后切换一级菜单 | 整页崩 | 视觉正常但子菜单瞬开瞬收 | **正常 expand+保持** |
| 永久约束写入文档 | 无 | finalplan §10.1-10.9 | + finalplan §10.10 |
| 累计真实部署暴露 bug | 0 | 2 (Bug A/B) | 3 (Bug A/B/C) |

---

## 🚀 第四轮（Step 23-27）：upgrade.md v2 Phase 1 + Phase 0 落地

> 起飞时间：2026-05-23（v4 menu fix 上线后）
> 范围：upgrade.md v2 提案的第一波 + Phase 0 基础设施收尾
> 节奏：一次 ship 多个 task，用户批量测试（每 2 个 phase 一测）

### Step 23 — S1 Cmd+K 命令面板（旗舰）

**时间**：2026-05-23
**对应 upgrade.md**：§1.S1
**改动**：
- 新文件 `htdocs/luci-static/resources/cmdk.js`（~270 行 LuCI module）
- `icons.svg` +4 个 Lucide 图标（search / arrow-up / arrow-down / corner-down-left）
- `style.css` +203 行 §8 cmdk styles
- `header.htm` +`#cmdk-trigger` magnifier 按钮
- `footer.htm` +`L.require('cmdk')`

**功能完整度**：6 档 fuzzy 评分 / ⌘K 触发 / 键盘 ↑↓ Enter Esc / 拼音首字母 / 最近 5 项 localStorage / aria-combobox / iOS 16px 防 zoom / backdrop-filter fallback。upgrade.md §0.6 i18n contract 全遵循。

**用户能立刻看到的变化**：按 ⌘K 或点顶栏放大镜按钮，弹出搜索面板覆盖 LuCI 所有菜单。输入"wifi"/"wx"/"防火墙"等都能匹配。

### Step 24 — S2a Toast 通知层

**时间**：2026-05-23
**对应 upgrade.md**：§1.S2a
**改动**：
- 新文件 `htdocs/luci-static/resources/toast.js`（~150 行 LuCI module）
- `icons.svg` +1（i-info）
- `style.css` +110 行 §9 toast styles
- `footer.htm` +`L.require('toast')`

**实现要点**：拦截 `ui.addNotification` 路由到右下角 toast 栈（移动端从底部）。4 种类型 success/info/warning/error，error 不自动消失。`role="alert"` for error，`role="status"` 其他。支持 action button（如撤销）和 close button。返回 dummy node 兼容老 LuCI 调用方 `.remove()`。

**用户能立刻看到的变化**：保存配置 / 错误提示原本顶部 banner，现在变右下角 toast，2-5 秒自动消失。

### Step 25 — B1 移动端 Bottom Sheet

**时间**：2026-05-23
**对应 upgrade.md**：§3.B1
**改动**：`style.css` +35 行 §10（仅 `@media (max-width: 640px)`）

**实现**：在小屏 override LuCI 的 `#modal_overlay` + `.modal`，让 modal 从底部滑起（iOS Settings 同款），加 drag handle hint，支持 safe-area-inset-bottom（刘海屏避让）。桌面无变化。

**用户能立刻看到的变化**：手机上打开任何 LuCI modal（比如某些插件的 confirm 框）会从底部滑上来，圆角顶 + 灰色拖动条。

### Step 26 — C2 完整 Lucide SVG 迁移（删 'design' icon font 主用法）

**时间**：2026-05-23
**对应 upgrade.md**：§4.C2
**改动**：
- `icons.svg` +14 个 Lucide 菜单图标（settings / server / box / hard-drive / shield / globe / bar-chart / pie-chart / sliders / phone / sparkles / shopping-bag / log-out / power）
- `menu-design.js` +`MENU_ICON_MAP` + `iconForMenu()` + `makeMenuIcon()` + 在 `renderMainMenu` level 1 注入 SVG
- `style.css` 删除 17 处 `:before { content: "\eXXX" }` 规则 + 通用 `:before` block (~80 行) → 替换为 `.menu-icon` styling（~15 行）

**保留**：
- `@font-face design` 声明本身（暂保留，下次 cleanup）
- `.menu::after` 箭头（仍用 design font \eb03，下次迁移）
- `Logout/Reboot` 的 padding 规则

**Net diff**：style.css -65 行 / +95 行 sprite icons / ~50 行 menu-design.js 改动。

**用户能立刻看到的变化**：侧边栏菜单图标从 'design' 字体的 emoji-like 字符 → Lucide 极简线条图标。配色跟随 currentColor（自动 emerald hover）。

### Step 27 — Phase 0 收尾：CI 现代化（T1 + T2）

**时间**：2026-05-23
**改动**：
- `.github/workflows/build.yml`：permissions 从 job-level 移到 workflow-level（修复 nightly release 不发布的 bug，T1）；actions/checkout@v4 → v5；actions/upload-artifact@v4 → v5；加 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'` env（T2）
- `.github/workflows/lint.yml`：actions/checkout@v5；actions/setup-node@v5；同样的 Node 24 env

**修复**：
- T1 nightly pre-release 应该开始正常更新（workflow-level perms 比 job-level 在某些 repo / org 配置下更可靠）
- T2 Node 20 deprecation warning 消除

**Note**：如果 T1 修复后仍不发布，需要 user check repo Settings → Actions → General → Workflow permissions = "Read and write permissions"。

---

## 📊 第四轮（Step 23-27）累计变化

| 指标 | 第三轮后 | 第四轮后 |
|---|---|---|
| LuCI module 文件数 | 1（menu-design.js） | **3**（+cmdk.js +toast.js） |
| SVG sprite 图标数 | 16 | **36**（+4 cmdk +1 toast +14 menu +1 placeholder/info dup ok） |
| CSS 行数 | 4141 | **4445** |
| 'design' icon font 引用数 | 4 | **3**（删了主要的 :before block） |
| 菜单 :before content 规则 | 17 | **0** |
| upgrade.md §1.S1 Cmd+K | 提案中 | ✅ shipped |
| upgrade.md §1.S2a Toast | 提案中 | ✅ shipped |
| upgrade.md §3.B1 Bottom Sheet | 提案中 | ✅ shipped |
| upgrade.md §4.C2 Lucide 迁移 | 提案中 | ✅ shipped（主菜单部分） |
| Action versions | v4-stack | **v5-stack** + Node 24 env |
| nightly release | 不发布 | **应该 OK**（perms workflow-level） |

## 🎯 用户能立刻看到的变化（第四轮）

1. **⌘K / Ctrl+K** 弹出全菜单 fuzzy 搜索面板（顶栏也有放大镜按钮）
2. **配置保存等通知**从顶部 banner 变右下角 toast
3. **手机上 modal** 变成底部滑起的 sheet
4. **侧边栏菜单图标**从 'design' 字体的 emoji 替换为 Lucide 极简线条
5. **GH Actions** 不再警告 Node 20 deprecated

---

## 🚀 第五轮（Step 28-34）：upgrade.md v2 Phase 2 + Phase 3 落地

> 起飞时间：2026-05-23（Phase 1 测试同步进行）
> 范围：upgrade.md v2 提案的 CGI 基础设施 + 实时数据 + 交互深化
> 节奏：7 个 task 一口气 ship（user 显式要求 "两个 phase 一测"）
> 风险点：T7 CGI 基础设施引入了首批服务器端 shell 脚本；T13 monkey-patch `L.ui.changes.displayChanges` 跨 LuCI 版本可能不稳

### Step 28 — T7 CGI 基础设施（Phase 2 共享 blocker）

**改动**：
- 新目录 `root/www/cgi-bin/design/`（CGI 脚本部署根）
- `Makefile` 加 `postinst-pkg` hook 给 `chmod +x` 所有 CGI 脚本
- `uci-defaults` 加 uhttpd `cgi_prefix='/cgi-bin'` 验证 + 二级 `chmod` 兜底
- 新文件 `htdocs/luci-static/resources/capability.js`（LuCI module，~95 行）

**capability.js 暴露**：`cap.nlbw()` / `cap.thermal()` / `cap.wireless()` / `cap.cgi(name)`，每次结果缓存到 page lifetime。800ms timeout 防 hang。

### Step 29 — T8 Sparkline / Live Metrics

**改动**：
- 新 CGI `root/www/cgi-bin/design/temp`（thermal_zone JSON 聚合，~12 行 sh）
- 新文件 `sparkline.js`（~190 行）
- `style.css` §11（~80 行）

**3 张 tile**：CPU loadavg / 内存 % / 温度（温度 CGI 检测不到 → 隐藏 tile）。5s 轮询 `ubus call system info`（修正 v1 提案的 `/admin/status/sysinfo` HTML endpoint 错误）。60 点 SVG sparkline。注入到 Overview `#view` 第一个位置（被 T9 推到第二位）。

**MVP scope**：实时 WAN 上下行 tile 延迟到 follow-up（需要 4 步 ubus chain：interface dump → 找 WAN device → 抽 device.status → diff 取速率）。

### Step 30 — T9 WAN Hero

**改动**：
- 新 CGI `root/www/cgi-bin/design/ping`（echo pong）
- 新文件 `wan-hero.js`（~110 行）
- `style.css` §12（~80 行）

**第一屏大卡片**：状态徽章 + 公网 IP + 连接协议 + 在线时长 + 接口名 + 网关延迟（5 次 ping 中位数）。100% 本地数据。30s 轮询 LuCI 的 `network.getWANNetworks()` 高层 helper。

**MVP scope**：实时上下行 + ISP opt-in modal 延迟到 follow-up（spec 已写明 ISP API 是 opt-in，默认 OFF，本轮先 skip）。

### Step 31 — T10 Wi-Fi/LAN 测速

**改动**：
- 2 个新 CGI：`download`（`dd if=/dev/urandom`，clamp 1KB-100MB）+ `upload`（read stdin discard）
- 新文件 `speedtest.js`（~170 行）
- `style.css` §13（~50 行）

**测速卡片**：按钮触发 → 3 阶段（latency 10 次 / download 10MB / upload 5MB）→ Mbps 显示。`/dev/urandom` 防中间 cache 注水。30s timeout 防 hang。错误时 toast.error。

**MVP scope**：2.4G/5G 对比模式 + 历史趋势 + 理论上限对比延迟到 follow-up。

### Step 32 — T11 设备列表 + OUI

**改动**：
- 新文件 `devices.js`（~210 行 — 含 35 项 OUI + 10 项 hostname-type 推断规则）
- `style.css` §14（~110 行）

**Overview 新 LAN 客户端卡片**（不替换 LuCI 自带 dhcp 页面）：单行紧凑 + 点击展开详情。数据 `luci-rpc.getDHCPLeases` ubus，去重 by MAC，按 hostname/IP 排序。30s 轮询。

**MVP scope**：rename → 持久化到 UCI 延迟到 follow-up；iwinfo signal strength merge 延迟到 follow-up。

### Step 33 — T12 快速操作浮层

**改动**：
- 新文件 `quick-actions.js`（~140 行）
- `icons.svg` +3 个 Lucide 图标（zap / refresh-cw / wifi）
- `header.htm` 加 `#quick-actions-trigger` ⚡ 按钮（在 cmdk + theme-toggle 之间）
- `style.css` §15（~80 行）

**4 个动作**：重启 Wi-Fi / 重载防火墙 / 续约 DHCP / 重启路由（含 confirm modal）。每个走 `file.exec` ubus，结果反馈 toast.info/success/error。点外部 + Esc 关闭。

### Step 34 — T13 应用变更体验重塑（含 B4 Diff Viewer）

**改动**：
- 新文件 `apply-modal.js`（~180 行）
- `style.css` §16（~95 行）

**核心**：monkey-patch `L.ui.changes.displayChanges`：
1. 读 `L.uci.changes()` 拉所有 pending changes → 渲染颜色 diff（add 绿底 / del 红底删除线 / set 显示前后值）
2. 6 条危险规则匹配（LAN IP / netmask / firewall disabled / dhcp ignore / hostname rename）→ 红色 ⚠ warning
3. 用户确认 → `toast.info('Applying...')` persistent → `L.uci.apply(timeout)` → success/error toast

**容错**：API 形状不符直接 try/catch 回退原生 `displayChanges`（LuCI 21→24 兼容性保险）。`__designPatched` flag 防双重 wrap。

---

## 📊 第五轮（Step 28-34）累计变化

| 指标 | 第四轮后 | 第五轮后 |
|---|---|---|
| LuCI module 文件数 | 3 (menu / cmdk / toast) | **10** (+capability +sparkline +wan-hero +speedtest +devices +quick-actions +apply-modal) |
| SVG sprite 图标数 | 36 | **38** (+zap +refresh-cw +wifi, 但 i-info 之前已加，所以总共算了 38) |
| CGI 脚本 (Phase 2 引入) | 0 | **4** (ping / temp / download / upload) |
| CSS 行数 | 4445 | **~5000+** (+550 行: §11-§16) |
| Overview 页 inject 卡片数 | 0 | **5** (WAN Hero / 3 sparkline tiles / Devices / Speedtest) |
| 顶栏按钮 | 2 (cmdk / theme-toggle) | **3** (+quick-actions ⚡) |
| LuCI ui.changes monkey-patched | 否 | **是** (apply-modal §16) |
| upgrade.md Phase 2 完成 | 0/4 | **4/4 ✅** |
| upgrade.md Phase 3 完成 | 0/3 | **3/3 ✅** |
| Phase 4 + 长期 | 0/8 | 0/8 (下批) |

## 🎯 用户能立刻看到的变化（第五轮）

1. **Overview 首屏**多了一张大的 WAN Hero 卡（状态 + 公网 IP + 延迟）
2. **Overview 顶部**多了 3 张实时 tile（CPU / 内存 / 温度），每张有 5 分钟趋势 sparkline
3. **Overview 中部**多了 LAN 客户端列表（带类型推断 + 厂商猜测，点击展开详情）
4. **Overview 底部**多了 Wi-Fi/LAN 测速按钮（按一下测 latency + download + upload）
5. **顶栏多个 ⚡ 按钮** — 快速重启 Wi-Fi / 重载防火墙 / 续约 DHCP / 重启路由
6. **Save & Apply** 不再是全屏阻塞 modal 了 — 先弹 diff modal 让你看清改了啥，确认后右下角 toast 显示进度

## ⚠ 第五轮已知妥协（follow-up 项）

| 项 | MVP 状态 | 待补完整 |
|---|---|---|
| Sparkline 实时流量 tile | 暂无 | 需要 ubus interface→device→status 4 步链 |
| WAN Hero 实时上下行 | 暂无 | 同上 |
| WAN Hero ISP opt-in modal | 暂无 | spec 明确 OFF default，需要 UCI flag + 同意 modal |
| 测速 2.4G/5G 对比 | 暂无 | 需要 UI 状态机 |
| 测速历史 localStorage | 暂无 | 简单加 |
| 测速理论上限对比 | 暂无 | 需 iwinfo channel/bandwidth 查询 |
| 设备列表 rename 持久化 UCI | 暂无 | 需要新 UCI section + UI |
| 设备列表 iwinfo signal 合并 | 暂无 | 需多 ubus call merge |
| Apply modal Undo 按钮 | 暂无 | LuCI 有 rollback API，需要 window 期内 toast 提供撤销 |

---

## 🚀 第六轮（Step 35-40）：upgrade.md v2 Phase 4 + Phase 5 落地

> 起飞时间：2026-05-23（Phase 2+3 测试并行）
> 范围：流量分析（渐进增强）+ 5 项工程加固
> 节奏：6 个 task 一批 ship；测试由用户独立线推进
> 备注：本轮起仓库结构第一次有 `htdocs/luci-static/design/css/features.css` —— style.css 不再是 single-file

### Step 35 — T14 流量分析（渐进增强）

**改动**：
- 新文件 `traffic.js`（~85 行）
- `style.css` §17（~55 行）

**渐进增强**：通过 capability.nlbw() 检测 luci-app-nlbw → 装了显示 "Open full Traffic Analysis →" 跳转链接；没装显示样式化占位卡 + opkg 跳转按钮。

**MVP scope**：inline nlbw 数据图表（top-N consumers, 24h sparkline）延后 — 跨 ImmortalWrt/OpenWrt/Lean LuCI fork 的 nlbw RPC surface 差异需要更深 integration。本轮先 ship "discovery + bridge"。

### Step 36 — T15 CSS 拆分（部分）

**改动**：
- 新文件 `css/features.css`（1038 行，§8 cmdk 到 §18 i18n-debug 整体迁出）
- `style.css` 末尾加 `@import url("./features.css")` 接续 cascade
- style.css 从 5127 行降到 4091 行（base + components + plugins + responsive）

**保守版**：spec 提议拆 8 个 module，本轮先拆**1**——把 v2 新增的 features 块挪出。理由：features 段语义独立、风险最低；base/components/responsive 等老段拆分易破坏 cascade 顺序，留独立 PR。

**部署影响**：浏览器多一个 HTTP 请求（features.css）。LuCI 局域网 < 10ms，HTTP/2 multiplex 下基本免费。

### Step 37 — T16 i18n 压力测试模式

**改动**：新文件 `i18n-debug.js`（~75 行）+ §18 CSS（~25 行）

**用法**：在任意 LuCI URL 加 `?design-debug=pseudo-long`：所有可见文本自动加倍（拷贝 + 空格 + 拷贝），暴露 overflow。其他 mode：`pseudo-short` 把 Latin 单词换成 `一`，`rtl` 给 html 加 dir="rtl"，`outline` 给所有元素加红框。多个 flag 用逗号组合。

**实现细节**：TreeWalker 只走 text nodes，skip `<script>/<style>/<textarea>/<input>`。3 秒间隔重 walk，catch 动态注入的 cards。

### Step 38 — T17 性能预算 CI

**改动**：`lint.yml` 加 "Performance budget" step

**5 类资产 gzipped 上限**（与 upgrade.md §6 对齐）：
- CSS ≤ 35 KB（当前 28KB，79%）
- JS ≤ 35 KB（当前 31KB，86% — 接近上限）
- Fonts ≤ 25 KB（当前 18KB，71%）
- SVG sprite ≤ 15 KB（当前 2.6KB，16%）
- CGI 脚本 ≤ 5 KB（当前 1.5KB，28%）

任何 PR 让 gzip 大小超预算 → CI fail。

**为什么不是 Lighthouse**：Lighthouse 完整版需要 running LuCI 实例（mock server）。本轮先 ship gzip 预算（足够拦住明显 regression），完整 Lighthouse 留后续接入 qemu 镜像后做。

### Step 39 — T18 CGI 安全审计

**改动**：`lint.yml` "Shellcheck" step 扩展 + 新 "CGI safety audit" step

**Shellcheck**：原仅扫 uci-defaults；现追加 4 个 CGI（ping/temp/download/upload）。

**Theme-specific audit**：
- 每个 CGI 必须有 `#!/bin/sh` shebang
- 禁止用 `eval/exec/source $QUERY_STRING`（shell injection 防护）
- `download` CGI 必须 clamp `BYTES`（已实现 1KB-100MB 边界）
- 每个 CGI 必须发 `Content-Type` header
- 缺 `Cache-Control` 发 warning（不 fail）

### Step 40 — T19 LuCI 兼容矩阵（文档版）

**改动**：新文件 `doc/luci-compat.md`

**内容**：
- 已验证版本表（当前仅 ImmortalWrt 24.10-SNAPSHOT / LuCI 26.136）
- 完整 LuCI API 依赖清单（按 globals / ui surface / ubus 分类）
- **`L.ui.changes.displayChanges` 标注 "internal — no stability contract"**（已有 try/catch 兜底）
- 跨版本手动测试 checklist

**为什么不上 docker matrix CI**：每个 LuCI version build SDK + 起 docker 在 CI 跑成本太高，价值 / 工时不划算。文档化 + 手动 checklist 是务实选择。真正的自动化跨版本测试留 T21 Visual Regression。

---

## 📊 第六轮（Step 35-40）累计变化

| 指标 | 第五轮后 | 第六轮后 |
|---|---|---|
| LuCI module 文件数 | 10 | **12** (+traffic +i18n-debug) |
| CSS 文件数 | 1 | **2** (split features.css) |
| style.css 行数 | 5127 | **4091**（features 挪出） |
| features.css 行数 | — | **1038** |
| lint.yml CI 检查数 | 7 | **9** (+Perf budget +CGI safety audit) |
| 文档：LuCI API 依赖 | 散在 doc 各处 | **`luci-compat.md` 集中** |
| upgrade.md Phase 4 完成 | 0/1 | **1/1 ✅** (MVP) |
| upgrade.md Phase 5 完成 | 0/5 | **5/5 ✅** |
| Phase 6 backlog | 0/2 | 0/2 (future) |
| **累计 v2 进度** | 13/21 (62%) | **19/21 (90%)** |

## 🎯 用户能立刻看到的变化（第六轮）

1. **Overview 底部多了 Traffic Analysis 卡**——装了 luci-app-nlbw 会显示 "Open full Traffic Analysis →"，没装会显示安装提示
2. **任何 LuCI 页面 URL 加 `?design-debug=pseudo-long`** 会触发 i18n 压测模式（所有文本自动加倍，看哪里 overflow）
3. CI 现在会**自动阻止**资产大小超预算 / CGI 不安全模式 / 无 shebang 等
4. **首次 page load** 多发一个 features.css 请求（局域网 < 10ms，不影响首屏）

---

## 🚀 第七轮（Step 41+）：MVP 视觉打磨 — 关掉 Overview 上 preview html 之间的视觉差

> 起飞时间：2026-05-23（用户对比 `doc/upgrade-preview.html` 后反馈"还没 preview 那么 fancy"）
> 范围：第五轮 ship MVP 时显式 deferred 的 9 项 polish，按"最高视觉 ROI / 最低风险"排序逐 Step 落地
> 节奏：一 Step 一 commit，可独立回滚，符合 Step 1-40 的工作流
> 目标 LuCI：ImmortalWrt 24.10 / LuCI 26.x 为主，所有数据访问用 try/catch + feature detection 保 universal fallback

### Step 41 — WAN Hero 视觉打磨（gradient + accent glow + pulse）

**时间**：2026-05-23
**文件**：`htdocs/luci-static/design/css/features.css` §12（+45 行 / -8 行）
**改动量**：纯 CSS，零 JS，零 HTML structure 变化

**做了什么：**

对比 [doc/upgrade-preview.html](upgrade-preview.html) §A1 的 `.wan-hero` 样式，real theme 此前是"平铺白底卡片 + 一根 3px 左边框"，缺少 preview 里那种"hero 卡的份量感"。本 Step 在不动 `wan-hero.js` 注入结构的前提下，给 `.wan-hero` 加三层视觉打磨：

1. **对角 accent sheen** — `linear-gradient(135deg, transparent, accent-12, transparent)` 叠在 surface-0 之上。中间唯一着色的 stop 让它像一道斜光，不是色块铺满。
2. **右上角 radial glow** — `::before` 伪元素，280×280 圆形径向，从 accent-12 到透明。`position: absolute; top: -40%; right: -10%;` 让它"溢出"卡片视觉边界，再由 `overflow: hidden` 剪掉，得到典型 SaaS hero 卡的发光质感。
3. **online 状态脉冲** — `@keyframes wan-hero-online-pulse` 在 `.wan-hero-status-online::before` 上做 3px → 5px 的 success-bg 光晕呼吸（2.2s 周期）。**只对 online 启用**——offline / unknown 不动，保持"活着的指示"语义。

**关键技术选择：**

- 用 `--color-accent-500-12` / `--color-success-bg` 两个**预派生 rgba**，**不**用 `rgb(from ... r g b / 12%)` relative-color 语法。Step 21 的 minifier bug 笔记记得很清楚（[styling-progress §第三轮 Step 21](#step-21--minifier-safe-css-重写)）：LuCI build pipeline 的 CSS minifier 会把 space-separated rgb 语法截断成乱码，**所有现代 Color 4 语法仍然不能用**。
- `.wan-hero > * { position: relative; z-index: 1 }` 是关键护身符 —— `wan-hero.js` 是动态注入子节点的，谁先谁后由 module load 顺序决定，用 universal child selector 一刀切让所有内容压在 `::before` glow 之上，比对每个具体 class 单独抬 z-index 鲁棒。
- pulse 的 keyframes 写在 `prefers-reduced-motion` 之外，但 style.css §1 已经有全局 `* { animation-duration: 0ms !important }` 在 reduce 模式下生效——**不需要在这条 keyframes 自己再写一遍**，反而会增加维护点。

**没有破坏的事：**

- ❌ `wan-hero.js` 一行没动 — DOM 结构、注入时机、刷新逻辑全保留
- ❌ `border-left: 3px solid accent-500` 的活动条保留 —— 与 preview 不完全一致（preview 只有 1px 全围边框），但本 theme 的左条已是"WAN online 时强调"的语义，保留更连贯
- ❌ 既有的 `wan-hero-status / wan-hero-status-offline` 等类全部沿用，pulse 仅作用于 `wan-hero-status-online::before`

**Break change：**

视觉上 WAN Hero 卡片现在：
- 有一道从左下到右上的浅绿斜向 sheen
- 右上有一团若即若离的绿色辉光
- "在线"徽章的圆点会在 2.2 秒内做一次呼吸
- 离线 / 未知态保持静止，与之前一致

Lighthouse / 性能上：
- 多了 1 个 keyframes 动画 + 1 层 background gradient + 1 个 ::before composited layer
- pulse 只动 box-shadow，触发 paint 不触发 layout（composite-friendly）
- 整体增量 ~45 行 CSS，gzip 后 < 0.5 KB

**验证：**

```bash
$ python3 -c "import re; c=open('features.css').read(); nc=re.sub(r'/\*.*?\*/','',c,flags=re.DOTALL); print(nc.count('{'), nc.count('}'))"
179 179  ✅
$ grep -c 'rgb([0-9]\+ [0-9]\+' features.css   # 禁止 Color 4 空格语法
0  ✅
$ grep -E '\-\-[a-z]+[A-Z]' features.css       # 禁止 camelCase token
0  ✅
```

**与 preview 的剩余差距（留给后续 Step）：**

| 差距 | 落地 Step |
|---|---|
| 实时 ↑↓ throughput row | Step 42-43 |
| 4 个 tile（含 Net tile）| Step 42-43 |
| 信号强度 latency bars 5 根 | Step 48 |
| 全屏切换、tagline "在线 9d 14h" 大字 | 不实现（与 hero-status 信息重复） |

**回滚方式：** `git revert` 该 commit 即可，零数据依赖。

---

### Step 42 — `wan-stats.js` 共享单例：每 2s 拉一次 WAN 吞吐量

**时间**：2026-05-23
**文件**：
- 新文件 `htdocs/luci-static/resources/wan-stats.js`（~140 行）
- `luasrc/view/themes/design/footer.htm` 加 `L.require('wan-stats')` 放在 `wan-hero` / `sparkline` 之前

**做了什么：**

第五轮 ship MVP 时把"实时上下行 throughput tile + WAN Hero ↑↓ 行"显式标了 `deferred — 需要 4 步 ubus chain`。这一 Step 把那 4 步 chain 收口到一个**共享单例**：

```
network.interface dump          网络接口列表
  ↓ (network.getWANNetworks)
找到 WAN interface              wans[0]
  ↓ (w.getDevice().getName)
真实物理设备名                  e.g. 'eth0' / 'pppoe-wan'
  ↓ (rpc.declare network.device.status)
rx_bytes / tx_bytes 计数器
  ↓ (diff vs lastSample, ÷ dt)
rxBps / txBps                  emit 给所有 subscribers
```

**为什么是单例：** sparkline.js 的 Net tile 和 wan-hero.js 的 ↑↓ 行需要同一份数据。如果各自轮询，CPU 翻倍 + 两份 ring buffer 不同步。共享一个 emitter，订阅一次，所有消费者同时刷新。

**关键设计：**

- **lazy polling** — `subscribe()` 时启动 timer，最后一个 `unsubscribe()` 自动 stop。模块本身 `__init__` 啥也不做，只是注册类，不消耗资源。
- **counter wrap 保护** — `drx < 0` 或 `dtx < 0` 时跳过那一帧（不出现 spike），用新值重锚 `lastSample`。
- **device 上线重试** — WAN 在 PPPoE 协商时可能晚于 page load 才 up。`poll()` 每次执行前都检查 `state.wanDevice`，为 null 就重新跑 `detectWanDevice()`。第一次有结果时 reset `lastSample` 避免用陈旧 baseline。
- **错误降级** — 任何 ubus call 失败都 emit `{ rxBps: null, txBps: null }`。消费者（Step 43）已经写好对 null 的处理 → 显示 "—" 不崩溃。
- **replay last emit on subscribe** — 后来订阅的消费者立即拿到一个 sample（不用等 2s）。

**为什么放在 footer.htm 里？**

`L.require('wan-stats')` 必须**在** `wan-hero` / `sparkline` 之前 — 后两者 `__init__` 里会 `L.require('wan-stats').then(...)` 订阅，如果 wan-stats 还没解析就会出错（虽然 LuCI 的 require 机制会自动等，但显式排序更稳）。

**没有破坏的事：**

- ❌ 没动 `wan-hero.js` / `sparkline.js` 任何一行 — 消费者迁移留 Step 43
- ❌ 没改任何已有 ubus 调用 — `network.device.status` 是新增 RPC，原 `system.info` 还是 sparkline.js 在用
- ❌ 没改 CSS — pure JS infra

**Break change：** 无可见。多了一个 LuCI module 文件 + footer 多一行 `L.require`。运行时多一个 2s 周期的 ubus call（仅 Overview 页且至少一个消费者订阅时）。

**验证：**
```bash
$ node --check htdocs/luci-static/resources/wan-stats.js   ✅
$ grep -c "wan-stats" luasrc/view/themes/design/footer.htm   1
```

**回滚方式：** `git revert` 删除该 commit。消费者还没来（Step 43 后才会订阅），所以这个 Step 单独存在是无害的 dead code。

---

### Step 43 — 4 个 tile（Net 第 4 张）+ WAN Hero ↑↓ 行

**时间**：2026-05-23
**文件**：
- `htdocs/luci-static/resources/sparkline.js`（+45 行：4th tile + subscribe to wan-stats + fmtBpsSplit）
- `htdocs/luci-static/resources/wan-hero.js`（+40 行：throughput strip + onWanStats）
- `htdocs/luci-static/design/css/features.css`（+45 行：`.wan-hero-throughput*` + `#design-tile-net` size override）

**做了什么：**

Step 42 的 `wan-stats.js` 单例终于有人订阅了。两个消费者：

#### sparkline.js — 第 4 张 tile

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ CPU Load     │ Memory       │ WAN Traffic  │ Temperature  │  ← 第 4 张是新的
│ 0.12         │ 68%          │ ↓ 45.2 Mbps  │ 52°C         │
│ ▁▂▃▂▁▂       │ ████░░░░     │ ▂▅▇▅▃▇▆      │ ▂▂▂▂▂▂       │
│ 1-min avg    │ 2.54/3.75 GB │ ↑ 12.4 Mbps  │ normal       │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

- 用 `i-activity` 图标
- `L.require('wan-stats').then(ws => ws.subscribe(onWanStats))` 订阅
- 回调 `onWanStats(data)` 把 rxBps push 进 `rings.net`，刷新 spark line / value / meta
- 文字格式：`↓ XX.X Mbps`（value）/ `↑ XX.X Mbps · pppoe-wan`（meta，附设备名）
- `font-size: text-xl` (不是 2xl) — "↓ 45.2 Mbps" 比 "0.12" 长很多，size 下调一档防止溢出
- wan-stats 无 device 时（PPPoE 还没建立）整个 tile `display: none` — 显示 "—" 永远不变更不诚实

#### wan-hero.js — 底部 throughput 行

```
┌──────────────────────────────────────────────────────────────────┐
│ 🌐 Internet  [● Online]                              1.4 ms       │   ← head
├──────────────────────────────────────────────────────────────────┤
│ Public IP   Connection   Uptime    Interface                     │   ← body
│ 1.2.3.4     PPPoE         9d 14h    pppoe-wan                    │
├──────────────────────────────────────────────────────────────────┤
│ ↓ 487 Mbps                    ↑ 12 Mbps                           │   ← NEW throughput strip
└──────────────────────────────────────────────────────────────────┘
```

- `.wan-hero-throughput` 横条加 `border-top` 分隔，与上方 body 静态字段语义不同（"live telemetry"）
- 两个 `wan-hero-throughput-cell`：↓ 下行 / ↑ 上行
- arrow（↓↑）用 accent 色 + bold，value 用 text-xl semibold tnum，unit 用 text-sm muted
- `min-width: 3.5ch` 在 value 上 — `"8"` 和 `"456.2"` 切换不让 layout 抖动
- 同样订阅 wan-stats，回调 `onWanStats(data)` 同步刷新两个 span 的 textContent

**为什么单例订阅这么爽：**

CPU 与 Memory 仍由原 `sysInfo()` 5s 节奏推动（Q16 fixed point 计算等逻辑保留）；Net tile 由 wan-stats 2s 节奏推动。两个 tile 在同一个 grid 里、不同 cadence — 视觉上 Net 更"live"，正好契合"实时流量"的语义。

无 RPC duplication：sparkline + wan-hero 两个消费者订阅同一个 wan-stats，只发一份 `network.device.status` ubus call。CPU 闲不下来反而忙不过来这事不会发生。

**关键防御：**

- `wan-stats` 加载失败 → sparkline 隐藏 Net tile / wan-hero 隐藏 throughput 横条。**不**显示永久 "—"。
- `data.deviceName === null` → 隐藏 Net tile（WAN 还没起来）。WAN Hero 自己仍能显示 ping / static fields，只是 throughput 一行空。
- `data.rxBps === null` → push 跳过（MetricRing 自带 isFinite 检查），UI 显示 "—" 直到下次有效采样。
- 全局 try/catch 在 wan-stats subscribe 内部，单个回调抛错不会连锁挂掉另一个消费者。

**Break change：**

- Overview 顶部 tile grid 从 3 列变 4 列（CSS Grid 用的 `auto-fit minmax(220px, 1fr)`，window 够宽自动 4 列，窄屏自动换行）
- WAN Hero 卡片高度变高 ~50px（加了 throughput strip）
- 第一次 ~2s 内 throughput 显示 "—"（需要 wan-stats 拿到两个 sample 才能 diff）。这是 wan-stats 设计的一部分，下次会持续 fresh

**验证：**

```bash
$ node --check sparkline.js   ✅
$ node --check wan-hero.js    ✅
$ CSS braces 187 == 187      ✅
$ rgb space syntax: 0        ✅
$ camelCase tokens: 0        ✅
```

**剩余差距：** WAN Hero header 处的 5 根 latency bars（preview 里 ping 数字前的小信号条）留给 Step 48。Devices count 也留 Step 48。

---

### Step 44 — Device list 真正的"可交互"：smooth expand + 操作按钮 + rename 持久化

**时间**：2026-05-23
**文件**：
- `htdocs/luci-static/resources/devices.js` 重写 render/buildRow 路径（212 → ~290 行）
- `htdocs/luci-static/design/css/features.css` §14 重写 `.devices-row-detail` + `.devices-actions`

**做了什么：**

第五轮 ship MVP 时 devices.js 有四个粗糙点：
1. 每次 toggleRow 都**重渲染整个 list** —— 6+ 客户端时眼睛能看到 flash
2. expand/collapse 用 `display: none` —— 没有过渡，瞬切
3. **没有操作按钮** —— preview 里有 改名/限速/阻止/白名单 4 个按钮，real 一个没有
4. 改名是不可能的 —— 即使想加，没存储路径

本 Step 把这四个一次解决：

#### 1. Smooth inline expand（CSS max-height transition）

原方案：`isExpanded ? [详情子节点] : []` → toggleRow → 整个 list re-render。

新方案：detail 始终在 DOM 里，CSS 控制可见性：

```css
.devices-row-detail {
    max-height: 0; opacity: 0; overflow: hidden;
    transition: max-height 200ms ease-out, opacity 200ms ease-out, margin-top ...;
    margin-top: 0;
}
.devices-row-expanded .devices-row-detail {
    max-height: 600px; opacity: 1; margin-top: var(--space-2);
}
```

`toggleRow(mac)` 改为 `row.classList.toggle('devices-row-expanded', this.expanded[mac])` —— 单行 class flip，无 DOM 重建。

`600px` max-height 是一个 cap：正常 detail + actions 大概 200px，远低于 600；如果用户 hostname 极长或 IPv6 地址特别多导致溢出，会被截掉而不是动画卡死。

#### 2. Chevron 旋转指示器

新加 `.devices-row-chev` 使用 `i-arrow-down` SVG。`margin-left: auto` 推到行末，`transition: transform 120ms` + `.devices-row-expanded .devices-row-chev { transform: rotate(180deg) }` 形成开关动效。

#### 3. 操作按钮（3 个）

每行的 detail 末尾新增 `.devices-actions` flex row，3 个按钮：

| 按钮 | 行为 |
|---|---|
| **Rename** | `prompt()` 弹原生输入，写 `localStorage` 持久化 + `this.customNames[mac]`，下次 refresh 时优先用 |
| **Limit**  | `toast.info('Rate limiting is not yet implemented')` —— 诚实的 stub，**不**装作能用 |
| **Block**  | `toast.warning('Blocking is not yet implemented')` —— 同上，按钮风格用 `cbi-button-negative` 视觉提示破坏性操作 |

按钮 click 都有 `e.stopPropagation()` —— 不要触发外层 row 的 click（避免点 Rename 后顺手收起 detail）。`buildRow` 的 row-click handler 也用 `e.target.closest('.devices-action')` 提前 return，**两个方向**都防住点击穿透。

#### 4. Rename 持久化（localStorage）

`STORAGE_KEY = 'design-device-names-v1'`，存 `{ mac: customName }` map。`loadCustomNames()` / `saveCustomNames()` 各自 try/catch（quota 满 / 隐私模式禁 localStorage 不会让整个 module 挂）。

显示优先级：`customNames[mac]` > `l.hostname` > `vendor + 'device'` > `'Unknown device'`。

**重要诚实**：toast 提示 `Saved (this browser only — UCI persistence coming later)`。换浏览器 / 清缓存就丢。UCI 持久化（写 `/etc/config`、reload-safe schema、跨 device 同步语义）是独立 PR，留给后续。

**为什么 prompt() 不上自家 Modal？**

LuCI 的 `ui.showModal` 不内置 input field，要自己拼 input + button + form submit handler，约 30 行代码。`window.prompt()` 已经是浏览器原生 + 键盘支持 + Enter/Esc 全包，对 Step 44 这种"轻量交互"够用。改 modal 等真要加"输入校验 / 多字段"时再说。

**没有破坏的事：**

- ❌ DHCP / OUI / type 推断逻辑全保留，OUI 表里去掉了 2 个 dup key（`DC:A6:32` 和 `DC:A6:32` 重复定义为 Raspberry Pi 和 Espressif，保留 Pi，新的 Espressif 用 `EC:FA:BC` `24:6F:28`）
- ❌ 30s refresh interval 保留
- ❌ `tryInject` / `injectCard` / `refresh` 公共 API 不变
- ❌ Toast 行为通过 `toastSafe()` wrap：toast module 不存在时 fallback 到 console，不会因 toast load 顺序问题崩

**Break change：**

- 每行多了一个 ▾ chevron 在末尾
- expand/collapse 不再瞬切，有 200ms 平滑动画
- detail 区下多了一行操作按钮（Rename / Limit / Block）
- 点 Rename 会弹 prompt 让你输入新名字
- 改名后名字会持久化（仅当前浏览器）

**验证：**

```bash
$ node --check devices.js     ✅
$ CSS braces 194 == 194       ✅
$ Total CSS lines: 1283 (+54)
```

**仍 deferred（明确不在 Step 44 范围）：**

| 项 | 为什么 deferred |
|---|---|
| 无线信号 bars（preview 里 -41dBm 4 格那种） | 需要 iwinfo merge —— 把 dhcp leases 与 `iwinfo dump` 按 MAC join，跨 PHY 找信号值。设计上 50+ 行新代码，会让 Step 44 diff 翻倍 |
| Wired vs Wi-Fi 判定 | 同上，靠 iwinfo |
| UCI 持久化 rename | 新 UCI section + reload-safe schema + cross-browser sync 语义。值得 standalone PR |
| 实际 Block 写防火墙规则 | uci.firewall.add 新 rule 需要 careful 不要锁住自己（block 自己 MAC = lock out admin），后续 confirm-modal + safety check |
| 实际 Limit 写 QoS 规则 | 类似，需要 luci-app-qos 集成 |

---

### Step 45 — Apply-modal Undo 按钮（10s 撤销窗口）

**时间**：2026-05-23
**文件**：`htdocs/luci-static/resources/apply-modal.js`（+60 行 / -10 行）

**做了什么：**

upgrade-preview §S2b 的"Save & Apply"流程一直缺最后一脚 —— Undo。第五轮 ship MVP 时 apply-modal.js 的 header comment 写着 `MVP: diff modal + apply via uci.apply(). Undo TBD`。本 Step 补齐：

#### 流程

```
1. 用户点 Save & Apply 触发的 LuCI displayChanges
2. 我们 monkey-patch 拦截 → showDiff() 显示 diff modal
3. 用户点 "Confirm & Apply"
4. ★ NEW: snapshotForUndo(changes) — 把所有 'set' op 的 *旧值* 抓出存
5. L.uci.apply(timeout) 走原流程
6. ★ NEW: 成功后弹 success toast 带 [Undo] 按钮，10s 窗口
7a. 用户在 10s 内点 [Undo] → undoChanges(snapshot) 反向 set + 重新 apply
7b. 用户没点 / 10s 过 → toast 自动消失，12s 后页面 reload
```

#### snapshotForUndo（关键技术决策）

读取的是 `L.uci.values` —— LuCI uci 客户端**私有但稳定**的"已读取自磁盘"的 shadow。`L.uci.set(c, s, o, v)` 只写 `L.uci.state`，不动 `values`，所以在 apply 之前 `values` 仍是 pre-change 状态。

```js
snapshotForUndo: function (changes) {
    var snap = {};
    try {
        var values = L.uci && L.uci.values;
        if (!values) return snap;
        changes.forEach(function (c) {
            if (c.op !== 'set' || !c.option) return;
            // ...
            snap[c.config + '.' + c.section + '.' + c.option] = orig;
        });
    } catch (e) { /* swallow → degrade to no-undo */ }
    return snap;
}
```

`L.uci.values` 不在公开 API 文档里但 LuCI 20.x → 26.x 都是这名字。`try/catch` 包外层 —— 任何 LuCI 版本里它不存在或 schema 变了，就 `return {}`，下游识别为"没有 snapshot → 不显示 Undo 按钮"。**永远不崩**。

#### Undo 限制（诚实文档）

snapshot 只捕获 **`set`** op。**`add` / `remove` / `rename` 不可逆**（没有 transactional log）：

- 用户改了 `network.lan.ipaddr` 从 192.168.1.1 到 192.168.5.1 → snapshot 存 1.1，Undo 可还原 ✅
- 用户**新增**了一个 wifi-iface → snapshot 不动它，Undo 不会删除新增的 ✗
- 用户**删除**了一条 firewall rule → snapshot 不动它，Undo 不会还原 ✗

如果用户的 pending changes 全是 add/remove/rename，snapshot 是 `{}`，apply 成功后**不显示 Undo 按钮**，直接走原版流程（1.5s reload）。

#### 节奏调整

原 success toast 后 1.5s 就 `location.reload()`。Undo path 把 reload 推迟到 12s（10s 窗口 + 2s 余量），这样用户有充足时间看清"我刚改了什么 / 要不要 Undo"。

#### Bug fix 中的 bug fix

写 Edit 的时候 paste 出现 SOH (0x01) 把 `'.'` 替换成了 `'\001'`，导致 snapshot key 用空白拼成 `networklanipaddr` 而 split 又当字符切，整个 Undo 路径连一帧都跑不到。Python byte-level scan 抓到后修复。

教训：之后大 string concat 用 Python 多写一行 `assert old_substring in src` 而不是只信 Edit 工具。

**没有破坏的事：**

- ❌ displayChanges 的 monkey-patch 入口不动，已有的 try/catch fallback to native displayChanges 保留
- ❌ DANGEROUS 危险规则检测保留
- ❌ flattenChanges / changeRow / 50 行 diff truncation 保留
- ❌ 没改 toast.js（已经在 Step 24 时就支持 `action: { label, onClick }`，免费用上）

**验证：**

```bash
$ node --check apply-modal.js           ✅
$ grep -nE 'snap\[|key\.split' apply-modal.js   # 确认 separator
214:	snap[c.config + '.' + c.section + '.' + c.option] = orig;
270:	var parts = key.split('.');
```

**回滚方式：** `git revert` 该 commit。前置 Step 44 不依赖它，独立可撤。

---

### Step 46 — Speedtest 历史 + label（手动 2.4G/5G 对比）

**时间**：2026-05-23
**文件**：
- `htdocs/luci-static/resources/speedtest.js`（+80 行：label select + history persist + renderHistory）
- `htdocs/luci-static/design/css/features.css`（+100 行：label select 样式 + history strip）

**做了什么：**

第五轮 MVP 把"2.4G vs 5G 对比 + 历史"显式 deferred。本 Step 用"label + history"组合实现 **manual** 对比（自动 SSID 切换从浏览器侧不可能 —— Wi-Fi 是路由器配置不是浏览器动作）。

#### Label select

`.speedtest-actions` 里在 Run button 前加一个 `<select>`：

| Value | Label |
|---|---|
| `Wired` | Wired |
| `5 GHz` | Wi-Fi 5 GHz （默认选中）|
| `2.4 GHz` | Wi-Fi 2.4 GHz |
| `Other` | Other |

用户**自己**记得在测之前选当前连接的网络类型。测完结果带 label 入 history。

#### History (localStorage)

`STORAGE_KEY = 'design-speedtest-history-v1'`，存 `{ t, label, latency, jitter, download, upload }`，最多 6 条。

新一次测试完成时 `pushHistory(entry)` → unshift + slice(0, 6)。

#### history strip 渲染

每行紧凑布局：

```
[label]   [N min ago]   ↓ 487 Mbps   ↑ 95 Mbps   1.2 ms
[label]   [N min ago]   ↓ 312 Mbps   ↑ 78 Mbps   1.4 ms
```

CSS grid `minmax(80px, 1fr) auto auto auto auto`，全部 `tabular-nums + mono` —— 用户对比同位置数字时眼睛不用跳。

`↓` 用 accent-600 / `↑` 用 info 蓝 / latency 用 muted —— 颜色编码 vs 阅读密度。

#### 怎么对比 2.4G vs 5G

用户的工作流：

1. 把笔记本连 5 GHz Wi-Fi → label 选 "5 GHz" → Run
2. 切换到 2.4 GHz Wi-Fi → label 选 "2.4 GHz" → Run
3. 在 history strip 里直观对比

没有花哨的 "side-by-side mode"，但是**够用**且诚实：浏览器无法替你切 Wi-Fi。

#### Clear 按钮

History head 右侧有 `Clear` 按钮，清 localStorage + 重渲染（即时 hide）。

#### Honest 设计

- localStorage 仅当前浏览器，不跨设备同步（同 Step 44 rename 限制）
- 「2.4G/5G 对比」不是自动化 — 是 manual workflow 友好化
- 历史项不显示 jitter（节省横向空间），但 detail 仍存在 entry 里供后续 UI 使用

**没有破坏的事：**

- ❌ Run test 流程（latency → download → upload）零改动
- ❌ `/cgi-bin/design/{ping,download,upload}` CGI 协议零改动
- ❌ 测试参数（PING_COUNT / DOWNLOAD_BYTES / UPLOAD_BYTES / TIMEOUT_MS）零改动
- ❌ 失败时不写 history（避免污染）

**验证：**

```bash
$ node --check speedtest.js     ✅
$ CSS braces 213 == 213         ✅
$ grep -rlP '\x01' (no SOH)     ✅
```
