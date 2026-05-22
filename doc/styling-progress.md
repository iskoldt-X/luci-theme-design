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
| Phase 2 — 图标系统 | ⏳ 待开始 | Lucide SVG sprite + node-name registry；删 icomoon（下轮） |
| Phase 3 — 关键页重设计 | ⏳ 待开始 | 登录页、Overview Dashboard tile 化（下轮） |
| Phase 4 — 微交互打磨 | 🟡 部分完成 | Focus ring ✅、reduce-motion ✅；主题切换、skeleton 待做 |
| Phase 5 — 防御层 | ✅ 完成 | CJK / 长德文兜底；硬件能力 fallback；relative color fallback |

**累计 step：11**

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





