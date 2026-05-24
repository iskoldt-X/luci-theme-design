# Claude Style — luci-theme-design 设计系统提案

> 起草时间：2026-05-22
> 作者：Claude（综合 codex 的架构判断、其他 AI 的细节建议、本人的视觉观察）
> 状态：**讨论稿** —— 等你拍板后再分阶段实施

---

## 0. 一段话设计哲学

> **"克制的高级感"**：用对的字体、严谨的间距、稳定的色彩系统说话，而不是用渐变、模糊、动效喊话。
>
> 用户来这里**修问题**，不是来看风景。每一个像素都要为"快速看懂状态、安全做出修改"服务。漂亮是副产物，不是目的。

参考坐标系（**取其神不取其形**）：

| 项目 | 学什么 |
|---|---|
| **Linear** | 排版即设计；强调色用得克制 |
| **Stripe Dashboard** | 数据密集时如何保持呼吸感 |
| **Vercel / shadcn** | Token 系统的工程化 |
| **Arc Browser** | 微妙的层级与圆角节奏 |
| **iOS Settings** | 移动端表单的密度 |

**不学**：Glassmorphism 满屏的 2021 风、电竞 RGB、Tailwind 演示页那种"所有 utility 全用上"的拼贴。

---

## 1. 八条设计原则

1. **系统优于装饰** —— 没有 token 系统支撑的"漂亮"是欠债。
2. **排版承担 80% 的设计** —— 选对字体 + 字号梯度比换 100 次配色更重要。
3. **一种节奏** —— 所有间距都是 4px 的倍数；所有圆角从一组里选。
4. **强调色是稀缺资源** —— 强调色越少出现，每次出现越有力。整屏不应有超过 5 处饱和色块。
5. **暗色模式是独立设计，不是颜色反转** —— 灰阶分层、强调色微调、阴影换边框。
6. **数据 > 容器** —— 卡片是数据的衬托，不是主角。卡片不要竞争注意力。
7. **性能即设计** —— 路由器嵌入式浏览器、4G 移动网络都是真实场景。CSS 不超过 60 KB、不加载 web font 是硬约束。
8. **不为截图设计** —— 设计为每天用 10 次的人服务，不为发 Hacker News 服务。
9. **形态适配信息(节奏感)** —— 同一个 overview 上有"表格""key-value 列表""带进度条的 KV""卡片"等多种信息形态。**每种形态都有它最佳表达,不强求统一**。Round 43 Chrome-Claude 提出 + 用户拍板永久原则。

   - LAN Clients 是**"表格的样板"** —— 真正多行 × 多列的数据。表头大写 letter-spacing,IP/MAC 等宽,Signal pill,Lease emerald + 箭头。
   - System / UPnP port table = **真表格**,该跟着 LAN Clients 的对齐 + 字号梯度 + 表头处理。
   - Hostname / Uptime / Load / CPU% = **key-value 形态**,定义列表风格(label 浅灰小字、value 正常字号),**不**套表格 wrapper。
   - Memory / Active Connections / Online Users = **key-value-with-bar**,同上。
   - 唯一 polish: KV 列表里像 Firmware Version / Kernel Version / IP / MAC / Hash 这种**技术字符串**用 mono 字体(取得"高级感"而不破坏 KV 形态)。
   - **让真表格都长得像 LAN Clients,让 key-value 卡保持 key-value 的样子。** 这样 overview 才有节奏感,不变成"风格强迫症"。

10. **表头对齐策略** —— Round 43 用户拍板永久规则。

    **所有表头居中**。但不是 column 整个空间的居中,而是**相对于该列实际内容的左右边界的居中** —— column 宽度应跟随内容,不留过多空白让 header"漂浮"。
    
    具体应用:数据 cell 可以左对齐(如 DEVICE 列的图标 + 名字)、右对齐(如 LEASE 列的剩余时间)或居中(如 SIGNAL pill)—— 数据各自走最自然的对齐;**表头一律居中**,跟所在 column 走。
    
    CSS 实现:对 `<th>` / grid-header cell 用 `text-align: center`(配合 column 宽度本身跟内容走)。

---

## 2. Design Tokens（核心）

> 这是整个系统的"宪法"。后续所有 CSS 都基于这些变量；不允许在组件里写魔法数字。

### 2.1 颜色 Tokens

```css
:root {
  /* ─── Brand / Accent ─── */
  --color-accent-50:  #ecfdf5;
  --color-accent-100: #d1fae5;
  --color-accent-200: #a7f3d0;
  --color-accent-300: #6ee7b7;
  --color-accent-400: #34d399;
  --color-accent-500: #10b981;   /* 主强调色 */
  --color-accent-600: #059669;   /* 主操作 hover */
  --color-accent-700: #047857;
  --color-accent-800: #065f46;
  --color-accent-900: #064e3b;

  /* ─── Neutrals (浅色模式) ─── */
  --color-bg:           #fafafa;   /* 页面底色 */
  --color-surface-0:    #ffffff;   /* 卡片底色 */
  --color-surface-1:    #f4f4f5;   /* 嵌套区块 / 输入框 */
  --color-surface-2:    #e4e4e7;   /* 分割块 */

  --color-text:         #18181b;   /* 主文字 */
  --color-text-muted:   #52525b;   /* 次要文字 */
  --color-text-subtle:  #a1a1aa;   /* 占位 / 注释 */
  --color-text-onAccent:#ffffff;   /* 强调色上的文字 */

  --color-border-subtle:#e4e4e7;
  --color-border-default:#d4d4d8;
  --color-border-strong:#a1a1aa;

  /* ─── Semantic ─── */
  --color-success: #10b981;        /* 与 accent 一致；强调"安全/正常" */
  --color-warning: #f59e0b;        /* amber-500 */
  --color-danger:  #ef4444;        /* red-500 */
  --color-info:    #3b82f6;        /* blue-500 */

  /* 语义色的浅底（用于 alert background） */
  --color-success-bg: #d1fae5;
  --color-warning-bg: #fef3c7;
  --color-danger-bg:  #fee2e2;
  --color-info-bg:    #dbeafe;

  /* ─── Focus Ring ─── */
  --color-focus-ring: rgb(16 185 129 / 35%);  /* accent-500 35% */
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg:           #0a0a0b;   /* 不用纯黑，避免 OLED 锐利感 */
    --color-surface-0:    #18181b;
    --color-surface-1:    #27272a;
    --color-surface-2:    #3f3f46;

    --color-text:         #fafafa;
    --color-text-muted:   #a1a1aa;
    --color-text-subtle:  #71717a;
    --color-text-onAccent:#ffffff;

    --color-border-subtle:#27272a;
    --color-border-default:#3f3f46;
    --color-border-strong:#52525b;

    /* 强调色在深色下提一档亮度，确保对比 */
    --color-accent-500: #34d399;
    --color-accent-600: #10b981;

    /* 语义色浅底改成低饱和度深底 */
    --color-success-bg: rgb(16 185 129 / 12%);
    --color-warning-bg: rgb(245 158 11 / 12%);
    --color-danger-bg:  rgb(239 68 68 / 12%);
    --color-info-bg:    rgb(59 130 246 / 12%);

    --color-focus-ring: rgb(52 211 153 / 40%);
  }
}
```

### 2.2 字号 Tokens

严格 1.25 比例（Major Third），不要再有 `0.92rem` 这种神秘数字。

```css
:root {
  --text-xs:   0.75rem;    /* 12px — 注释、标签 */
  --text-sm:   0.875rem;   /* 14px — 表单标签、次要正文 */
  --text-base: 1rem;       /* 16px — 正文 */
  --text-lg:   1.125rem;   /* 18px — 卡片标题 */
  --text-xl:   1.25rem;    /* 20px — 区段标题 */
  --text-2xl:  1.5rem;     /* 24px — 页面标题 */
  --text-3xl:  1.875rem;   /* 30px — 数据大字（Dashboard tile） */

  --leading-tight:  1.25;
  --leading-normal: 1.5;
  --leading-relaxed:1.7;

  --weight-normal:   400;
  --weight-medium:   500;
  --weight-semibold: 600;
  --weight-bold:     700;
}
```

### 2.3 间距 Tokens

4px 节拍，**没有 5、7、9、11、13、15**。

```css
:root {
  --space-1:  4px;
  --space-2:  8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;
}
```

### 2.4 圆角 Tokens

```css
:root {
  --radius-sm:  6px;   /* 徽章、标签 */
  --radius-md: 10px;   /* 按钮、输入框 */
  --radius-lg: 14px;   /* 卡片 */
  --radius-xl: 20px;   /* 模态、登录卡片 */
  --radius-pill: 999px;/* 开关、tag */
}
```

### 2.5 阴影 Tokens

**浅色模式**：

```css
:root {
  --shadow-xs: 0 1px 2px rgb(0 0 0 / 4%);
  --shadow-sm: 0 2px 4px rgb(0 0 0 / 5%);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 6%), 0 1px 2px rgb(0 0 0 / 4%);
  --shadow-lg: 0 12px 32px rgb(0 0 0 / 10%), 0 2px 4px rgb(0 0 0 / 4%);
  --shadow-focus: 0 0 0 3px var(--color-focus-ring);
}
```

**深色模式**：阴影几乎看不见，改用边框：

```css
@media (prefers-color-scheme: dark) {
  :root {
    --shadow-xs: none;
    --shadow-sm: none;
    --shadow-md: 0 0 0 1px rgb(255 255 255 / 6%);
    --shadow-lg: 0 0 0 1px rgb(255 255 255 / 10%), 0 12px 32px rgb(0 0 0 / 40%);
  }
}
```

### 2.6 动效 Tokens

```css
:root {
  --motion-fast:   120ms;
  --motion-normal: 200ms;
  --motion-slow:   320ms;

  --ease-out:    cubic-bezier(0.2, 0, 0, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 尊重用户偏好 */
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-fast: 0ms;
    --motion-normal: 0ms;
    --motion-slow: 0ms;
  }
}
```

### 2.7 z-index 层级（命名化，不再裸数字）

```css
:root {
  --z-base:     0;
  --z-sticky:  10;
  --z-header:  20;
  --z-sidebar: 30;
  --z-overlay: 40;
  --z-modal:   50;
  --z-toast:   60;
  --z-tooltip: 70;
}
```

---

## 3. 排版系统

### 3.1 字体栈（**不加载 web font**）

```css
:root {
  --font-sans:
    -apple-system, BlinkMacSystemFont,         /* Apple */
    "Segoe UI Variable", "Segoe UI",           /* Windows */
    "PingFang SC",                             /* macOS CJK */
    "Hiragino Sans GB",                        /* macOS CJK 备选 */
    "Microsoft YaHei", "Microsoft YaHei UI",   /* Windows CJK */
    "Noto Sans CJK SC", "Source Han Sans SC",  /* Linux CJK */
    Roboto, "Helvetica Neue", Arial, sans-serif;

  --font-mono:
    "SF Mono", "JetBrains Mono", "Fira Code",
    Menlo, Monaco, Consolas,
    "Liberation Mono", monospace;

  --font-numeric:
    "SF Pro Text", "Segoe UI Variable",
    var(--font-sans);
  font-variant-numeric: tabular-nums;  /* 数据等宽 */
}
```

**理由：**
- 路由器后台不该让用户为字体多等 100ms
- Apple/Windows/Linux 系统都有合格的 CJK 字体；强行加载 Inter 反而在中文环境降级
- 数字 tile 用 `tabular-nums`，CPU 使用率从 5% 跳到 15% 时不会"挤位"

**主动删除：** Cocon-Regular-Font（70 年代装饰字体，与现代 dashboard 风格冲突）。

### 3.2 字号梯度的实际应用

| 用途 | Token | 字重 | 行高 |
|---|---|---|---|
| 页面大标题（h1, "状态概览"） | `--text-2xl` | semibold | tight |
| 区段标题（h2, "系统"） | `--text-lg` | semibold | tight |
| 卡片标题（h3） | `--text-base` | semibold | tight |
| 表单标签（label） | `--text-sm` | medium | normal |
| 正文 / 表单值 | `--text-base` | normal | normal |
| 注释 / 帮助文字 | `--text-sm` | normal | relaxed |
| 徽章 / 微标签 | `--text-xs` | medium | tight |
| Dashboard 大数据（"45%"） | `--text-3xl` | semibold | tight + tabular-nums |

**反原则：** 不要再用 `--color-accent` 给标题上色。标题靠**字重和字号**建立层级，颜色用 `--color-text`。强调色省给"需要点击的东西"。

---

## 4. 色彩使用纪律

### 4.1 「强调色配额」

整屏可见强调色块**不超过 5 处**。包括：

- 1 个 active 菜单项
- 1-2 个主操作按钮（"保存并应用"）
- 1 个状态徽章（如"运行中"）
- 1 个图表强调线

**禁止：** 给所有按钮上色、给所有链接上色、给图标普遍上色。绝大多数交互元素用 `--color-text-muted`，只有真正主操作才点亮。

### 4.2 「语义色不混用」

| 颜色 | 仅用于 |
|---|---|
| Success (绿) | "运行中"、"已连接"、"已保存"、强调色 |
| Warning (橙) | 配置变更未保存、低风险警告 |
| Danger (红) | 错误、删除操作、root 无密码警告 |
| Info (蓝) | 中性提示、`<noscript>`、提示性 alert |

**当前问题：** `.warning` 类用了 `#FF7D60` 橙红，`.danger` 也用了 `#ff7d60` —— 两个语义共用一个颜色。要拆开。

### 4.3 「不上渐变」

按钮、卡片、徽章一律纯色。渐变只允许出现在：

1. Dashboard 的 sparkline / 流量图（数据可视化）
2. 大尺寸状态指示器（如 CPU 仪表盘的弧形条）

按钮加渐变会让整个界面**老 5 年**。

---

## 5. 核心组件规格

### 5.1 按钮（5 种，仅 5 种）

```css
/* Primary — 主操作，每屏最多 1 个 */
.btn-primary {
  background: var(--color-accent-500);
  color: var(--color-text-onAccent);
  border: 0;
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
  font: var(--weight-medium) var(--text-sm)/1.5 var(--font-sans);
  transition: background var(--motion-fast) var(--ease-out),
              transform var(--motion-fast) var(--ease-out),
              box-shadow var(--motion-fast) var(--ease-out);
}
.btn-primary:hover { background: var(--color-accent-600); transform: translateY(-1px); }
.btn-primary:active { transform: translateY(0); }
.btn-primary:focus-visible { box-shadow: var(--shadow-focus); outline: none; }

/* Secondary — 次操作 */
.btn-secondary {
  background: var(--color-surface-0);
  color: var(--color-text);
  border: 1px solid var(--color-border-default);
  /* ...其余同上... */
}
.btn-secondary:hover { background: var(--color-surface-1); border-color: var(--color-border-strong); }

/* Ghost — 列表内联操作 */
.btn-ghost { background: transparent; color: var(--color-text-muted); border: 0; }
.btn-ghost:hover { background: var(--color-surface-1); color: var(--color-text); }

/* Danger — 删除、重置 */
.btn-danger { background: var(--color-danger); color: white; }
.btn-danger:hover { background: #dc2626; }

/* Link — 仅文本 */
.btn-link { background: transparent; color: var(--color-accent-600); text-decoration: underline; }
```

**反原则：**
- ❌ 不要 `text-transform: uppercase`
- ❌ 不要 `min-width: 80px`（让按钮按内容尺寸）
- ❌ 不要给所有按钮加 hover 阴影（只 primary 有 translateY）

### 5.2 输入框

```css
.input {
  background: var(--color-surface-1);
  color: var(--color-text);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font: var(--weight-normal) var(--text-base)/1.5 var(--font-sans);
  transition: border-color var(--motion-fast) var(--ease-out),
              box-shadow var(--motion-fast) var(--ease-out);
}
.input:hover { border-color: var(--color-border-strong); }
.input:focus {
  outline: none;
  border-color: var(--color-accent-500);
  box-shadow: var(--shadow-focus);
}
.input:disabled { opacity: 0.6; cursor: not-allowed; }
.input.is-invalid { border-color: var(--color-danger); }
```

**关键改动 vs 现状：**
- 当前 `.cbi-input-text:focus` 用 `#948FE1` 紫色 box-shadow —— 莫名其妙的紫，全主题没第二处。改成强调色。
- 当前 `min-width` 用 `15rem` —— 改用容器自适应。

### 5.3 卡片（`cbi-section`）

```css
.card,
.cbi-section {
  background: var(--color-surface-0);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--space-4);
}

.card-header,
.cbi-section > h3:first-child {
  font: var(--weight-semibold) var(--text-lg) var(--font-sans);
  color: var(--color-text);
  margin-bottom: var(--space-4);
  padding: 0;
  border: 0;
}

.card-description,
.cbi-section-descr {
  font: var(--weight-normal) var(--text-sm) var(--font-sans);
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
}
```

**关键改动 vs 现状：**
- 当前圆角混用 `3px` / `8px`，统一到 `--radius-lg`
- 当前卡片标题用 `--activeColor`（强调色），改为 `--color-text`，靠字重区分
- 当前阴影：`3px 3px 3px rgba(0,0,0,0.05)` —— **不对称**的阴影（不该有 x 偏移）；改用对称的 `--shadow-sm`

### 5.4 表单行（label / value）

**当前问题：** "主机名: OpenWrt" 在一行，标签固定 35%，值固定 65%，中间留巨大空白。

**新规格：**

```css
.cbi-value {
  display: grid;
  grid-template-columns: minmax(140px, 200px) 1fr;
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border-subtle);
  min-height: 48px;  /* 触摸友好 */
}

.cbi-value:last-child { border-bottom: 0; }

.cbi-value-title {
  font: var(--weight-medium) var(--text-sm) var(--font-sans);
  color: var(--color-text-muted);
  /* 不再 35% 死宽 */
}

.cbi-value-field {
  font: var(--weight-normal) var(--text-base) var(--font-sans);
  color: var(--color-text);
}

/* 移动端折叠成两行 */
@media (max-width: 640px) {
  .cbi-value {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }
  .cbi-value-title { font-size: var(--text-xs); }
}
```

### 5.5 模态 / 弹窗

```css
.modal {
  background: var(--color-surface-0);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  max-width: 480px;
  padding: var(--space-6);
}

#modal_overlay {
  background: rgb(0 0 0 / 50%);
  backdrop-filter: blur(8px);  /* 唯一允许 backdrop-filter 的地方 */
  -webkit-backdrop-filter: blur(8px);
}
```

### 5.6 徽章 / 标签

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  font: var(--weight-medium) var(--text-xs) var(--font-sans);
  line-height: 1.5;
}
.badge-success { background: var(--color-success-bg); color: var(--color-success); }
.badge-warning { background: var(--color-warning-bg); color: var(--color-warning); }
.badge-danger  { background: var(--color-danger-bg);  color: var(--color-danger);  }
.badge-info    { background: var(--color-info-bg);    color: var(--color-info);    }
.badge-neutral { background: var(--color-surface-2);  color: var(--color-text-muted); }
```

### 5.7 进度条

```css
.cbi-progressbar {
  background: var(--color-surface-2);
  border-radius: var(--radius-pill);
  height: 8px;            /* 当前是 1.5rem 太胖 */
  overflow: hidden;
  position: relative;
}
.cbi-progressbar > div {
  background: var(--color-accent-500);
  height: 100%;
  border-radius: inherit;
  transition: width var(--motion-normal) var(--ease-out);
}
/* 把百分比文字移到外部，不要叠在条上 */
```

### 5.8 Toggle 开关（新增）

LuCI 原生用 checkbox，UI 上没有 toggle。我们覆盖 `input[type="checkbox"].cbi-input-checkbox` 重做成药丸开关：

```css
input[type="checkbox"].cbi-input-checkbox {
  appearance: none;
  width: 44px;
  height: 24px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-2);
  position: relative;
  cursor: pointer;
  transition: background var(--motion-fast) var(--ease-out);
}
input[type="checkbox"].cbi-input-checkbox::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 20px; height: 20px;
  background: white;
  border-radius: 50%;
  box-shadow: var(--shadow-sm);
  transition: transform var(--motion-fast) var(--ease-out);
}
input[type="checkbox"].cbi-input-checkbox:checked {
  background: var(--color-accent-500);
}
input[type="checkbox"].cbi-input-checkbox:checked::after {
  transform: translateX(20px);
}
```

---

## 6. 布局规格

### 6.1 顶栏（Header）

| 维度 | 现状 | 新规格 |
|---|---|---|
| 高度 | 55px | **56px**（恰好 14 × 4） |
| 背景 | `var(--bgwhite)` | `var(--color-surface-0)` + `border-bottom: 1px solid var(--color-border-subtle)` |
| Brand 字体 | **Cocon Regular** ⚠️ | `var(--font-sans)` weight 600，字号 `--text-lg` |
| 阴影 | `17rem 2px 4px ...` （奇怪 x 偏移） | `--shadow-xs` |
| Indicator 小圆点 | 浮在右上无 label | 改为带文字的徽章，hover 显示详情 |

新增：**Header 右上角加一个"主题切换"按钮**（sun/moon icon），覆盖 `prefers-color-scheme`。许多用户想强制深色或浅色。

### 6.2 侧栏（Sidebar）

| 维度 | 现状 | 新规格 |
|---|---|---|
| 宽度 | 17rem (272px) | **15rem (240px)** —— 桌面留更多内容空间 |
| 背景 | `var(--mainleftbgColor)` 纯白 | `var(--color-surface-0)` + `border-right: 1px solid var(--color-border-subtle)` |
| 菜单项字号 | 1.1rem | `--text-sm` weight medium —— 不大 |
| Active 样式 | 渐变青色背景 | `background: var(--color-accent-50)` + `color: var(--color-accent-700)` + `border-left: 3px solid var(--color-accent-500)` |
| 二级菜单 | 缩进字体小 | 缩进 `var(--space-4)`，字号同样 `--text-sm` |
| Hover | 一会儿白一会儿青 | `background: var(--color-surface-1)` 永远 |

### 6.3 底部导航（Mobile）

| 维度 | 现状 | 新规格 |
|---|---|---|
| 高度 | 50px + safe area | **64px** + safe area（更舒展） |
| 背景 | `rgba(255,255,255,0.7)` + blur | 保留 backdrop-filter（合理使用） |
| 图标 | **5 个不同风格的 PNG** ⚠️ | 全部 Lucide SVG，统一线条粗细 1.5 |
| 文字 | 无 | 加 `--text-xs` 文字标签（参考 iOS Tab Bar） |
| 数量 | 硬编码 5 个 | **UCI 可配置**，默认 4-5 个 |
| Active 状态 | 没有 | 当前所在页面图标 + 文字变 `--color-accent-500` |

### 6.4 内容区

```css
#maincontent > .container {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--space-5) var(--space-5) var(--space-7);
}

@media (max-width: 992px) {
  #maincontent > .container { padding: var(--space-4); }
}
```

去掉当前 `30px 30px 50px 30px` 的不对称 margin。

### 6.5 响应式断点

```css
/* 不要再有 1280 / 992 / 700 / 470 / 400 / 370 六个断点 */
/* 改为标准 3 档 */
--bp-mobile:  640px;   /* 手机 */
--bp-tablet:  1024px;  /* 平板 / 小笔电 */
--bp-desktop: 1280px;  /* 桌面 */
```

---

## 7. 图标系统

### 7.1 选库：Lucide

理由：开源、MIT、SVG（可调色）、风格统一线条款、社区活跃、~1.2 KB / icon (gzipped)。

**不用 Material Symbols**：太具产品识别度（Google 调性）。
**不用 Heroicons**：相对单调。
**不用 Iconify**：是聚合库，体积爆炸。

### 7.2 Node Name Registry（codex 的好想法）

```javascript
// htdocs/luci-static/resources/icon-registry.js
export const ICON_MAP = {
  // 一级菜单
  'status':       'gauge',
  'system':       'settings',
  'services':     'puzzle',
  'network':      'network',
  'docker':       'container',
  'nas':          'hard-drive',
  'vpn':          'shield',

  // 二级 / 插件
  'overview':     'home',
  'firewall':     'flame',
  'routes':       'route',
  'syslog':       'file-text',
  'processes':    'cpu',
  'realtime':     'activity',
  'wireguard':    'shield-check',
  'openclash':    'globe',
  'nlbw':         'bar-chart-3',
  'wizard':       'wand-2',
  'istore':       'package',
  'samba':        'folder-share',
  'logout':       'log-out',
  'reboot':       'rotate-cw',

  // 默认 fallback
  '_default':     'circle-dot',
};
```

然后 `menu-design.js` 渲染时：

```javascript
function iconFor(nodeName) {
  return ICON_MAP[nodeName] || ICON_MAP._default;
}

ul.appendChild(E('li', {...}, [
  E('a', {...}, [
    E('svg', { 'data-icon': iconFor(children[i].name), ... }),
    E('span', {}, [_(children[i].title)])
  ]),
  ...
]));
```

**优点：**
- CSS 里彻底告别 `[data-title="..."]` 这种脆弱选择器
- 添加新插件只需在 registry 加一行
- 找不到的菜单项有稳定 fallback，不会"图标位置空着"
- 全主题视觉一致（来自同一套 Lucide）

### 7.3 图标尺寸规则

| 用途 | 尺寸 | 颜色 |
|---|---|---|
| 侧栏一级菜单 | 18px | `currentColor`（继承 a 的色） |
| 侧栏二级菜单 | 16px | `currentColor` |
| 底栏 | 24px | `currentColor` |
| 卡片 inline | 16px | `currentColor` |
| 按钮 leading icon | 16px | `currentColor` |
| Dashboard tile | 24px | `--color-accent-500` |

**SVG 默认 `stroke-width: 1.5`**（Lucide 默认 2，调细一档更现代）。

---

## 8. 关键页面设计

### 8.1 登录页（**重新设计**）

**现状（见 [preview/login.png](preview/login.png)）：** 纯黑背景，居中两个无 label 的输入框 + "登录" + "复位"按钮。无品牌、无层级、无设计。

**新设计：**

```
┌──────────────────────────────────────────┐
│                                          │
│              [Router Logo]               │
│                                          │
│              openwrt.lan                 │
│         OpenWrt 23.05.5 · r1234          │
│                                          │
│   ┌─────────────────────────────────┐    │
│   │  Welcome back                    │   │
│   │  Sign in to manage your router   │   │
│   │                                  │   │
│   │  Username                        │   │
│   │  [👤 root________________]       │   │
│   │                                  │   │
│   │  Password                        │   │
│   │  [🔒 _________________  👁]      │   │
│   │                                  │   │
│   │  [        Sign in →        ]    │   │
│   └─────────────────────────────────┘    │
│                                          │
│         主题切换 · 语言 · GitHub          │
└──────────────────────────────────────────┘
```

要点：
- 上方：**hostname + 版本号**，建立环境识别
- 居中卡片 `max-width: 400px`，`var(--shadow-lg)`
- 输入框带 **leading icon**（user / lock）
- 密码字段加 **眼睛切换显隐**
- **删除"复位"按钮**（毫无意义）
- 底部脚注：主题切换 + 语言 + GitHub 链接
- 背景：浅色 `var(--color-bg)` / 深色 `var(--color-bg)`，**不要纯黑**

### 8.2 Overview Dashboard（**Tile 化**）

**现状：** "状态" 页是一个长长的 label/value 列表，从 hostname 一直到 CPU/内存。

**新设计：**

```
┌─────────────────────────────────────────────────────────────────┐
│  状态概览                                              [刷新 ↻]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────┐  │
│  │ CPU 负载    │  │ 内存使用    │  │ 上行 / 下行 │  │ 温度    │ │
│  │             │  │             │  │             │  │        │  │
│  │   12%       │  │  91% 已用   │  │  ↑12 ↓45   │  │  52°C  │  │
│  │   ▁▂▃▃▂▅▇▆ │  │  ▓▓▓▓▓▓▓░ │  │   Mbps     │  │  ▼ 正常 │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────┘  │
│                                                                 │
│  ┌──────────────────────────────┐  ┌──────────────────────────┐ │
│  │ 系统信息                     │  │ 网络接口                 │ │
│  │ 主机名     OpenWrt          │  │  • eth0   ↑ 1.2 GB       │ │
│  │ 固件       OpenWrt 23.05    │  │  • wlan0  ↑ 850 MB       │ │
│  │ 运行时间   9d 14h 22m       │  │  • lan    ↑ 420 MB       │ │
│  │ 平均负载   0.05  0.11  0.17 │  │                          │ │
│  └──────────────────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

要点：
- 顶部 4 个**关键指标 tile**：CPU / 内存 / 网络 / 温度
- 每个 tile 含数字（大字 `--text-3xl tabular-nums`）+ 微图表（sparkline / 进度条）
- 下方两栏布局：系统信息 + 接口流量
- 全部 tile 使用 CSS Grid

### 8.3 配置页（密度优化）

**当前问题：** 每个 `cbi-value` 行很高（标签和值并排但中间空白），导致典型配置页要滚动很多屏。

**新设计：**

```css
.cbi-value {
  /* 上面已定义：grid + minmax(140px, 200px) + 1fr */
  min-height: 48px;
  padding: var(--space-3) 0;
}

/* 表单分组用 fieldset 视觉化 */
.cbi-section > .cbi-section-node > * {
  margin: 0;  /* 行之间靠 border-bottom 分隔，不靠 margin */
}
```

### 8.4 状态页表格

**当前问题：** 表格用 `border: 0px solid #eee` + 自定义 `.tr.placeholder`，看着像 Excel。

**新设计：** zebra 条纹 + 表头粘性：

```css
.cbi-section-table .tr:nth-child(odd) {
  background: var(--color-surface-1);
}
.cbi-section-table .tr.cbi-section-table-titles {
  position: sticky;
  top: 0;
  background: var(--color-surface-0);
  border-bottom: 1px solid var(--color-border-default);
  font: var(--weight-semibold) var(--text-xs) var(--font-sans);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}
```

---

## 9. 微交互

### 9.1 Focus Ring

**所有可交互元素**（按钮、输入框、链接、checkbox、tab）都用同一个 focus ring：

```css
*:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
  border-radius: var(--radius-md);
}
```

注意用 `:focus-visible`（键盘 focus）而非 `:focus`（任何 focus），避免点击后留下视觉环。

### 9.2 Hover 提升

仅 **primary 按钮** + **dashboard tile** 有 `translateY(-1px)`：

```css
.btn-primary:hover,
.tile:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
```

其余元素 hover 只改背景色或边框色，**不要"全员上浮"**——会让界面飘。

### 9.3 Transition 规则

- 颜色变化：`var(--motion-fast)` = 120ms
- 尺寸/位置：`var(--motion-normal)` = 200ms
- 入场/出场：`var(--motion-slow)` = 320ms

```css
.button, .input, .link, .tab {
  transition:
    background-color var(--motion-fast) var(--ease-out),
    border-color    var(--motion-fast) var(--ease-out),
    color           var(--motion-fast) var(--ease-out),
    box-shadow      var(--motion-fast) var(--ease-out);
}
```

### 9.4 加载状态：Skeleton Loaders

替代当前的 "Collecting data..." 文字 spinner：

```css
.skeleton {
  background: linear-gradient(90deg,
    var(--color-surface-1) 0%,
    var(--color-surface-2) 50%,
    var(--color-surface-1) 100%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-md);
}
@keyframes skeleton-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Status 页未加载时显示 4 个 `<div class="skeleton" style="height:80px"></div>`。比"转圈圈"专业 3 个档次。

---

## 10. 暗色模式专项

### 10.1 设计原则

> "暗色模式不是把亮色翻转，是为同一界面**重新配光**。"

| 项 | 浅色 | 深色 | 理由 |
|---|---|---|---|
| 页面底色 | `#fafafa` | `#0a0a0b` | 深色不用 #000：OLED 锐利 / LCD 像没开 |
| 卡片底色 | `#ffffff`（高于背景） | `#18181b`（高于背景） | 浅色靠白 = 突出；深色靠灰 = 突出 |
| 嵌套区块 | `#f4f4f5`（低于卡片） | `#27272a`（高于卡片） | 浅色"凹下去"，深色"凸起来" |
| 主文字 | `#18181b` | `#fafafa` | 浅色不要纯黑（太硬） |
| 强调色 | `#10b981` | `#34d399` | 深色提一档明度才能保对比 |
| 阴影 | `--shadow-md` | **无阴影** + `border-color` | 深色环境阴影几乎不可见 |

### 10.2 手动切换

支持 3 态：`auto` / `light` / `dark`。存在 `localStorage`。

```html
<button id="theme-toggle" class="btn-ghost" aria-label="Toggle theme">
  <svg class="icon-sun"></svg>
  <svg class="icon-moon" hidden></svg>
</button>
```

```javascript
const stored = localStorage.getItem('design-theme') || 'auto';
document.documentElement.dataset.theme = stored;
// CSS 用 [data-theme="dark"] 覆盖 prefers-color-scheme
```

---

## 11. 可访问性（强制基线）

| 指标 | 要求 | 当前问题 |
|---|---|---|
| 文字对比度 | 正文 ≥ 4.5:1, 大字 ≥ 3:1 | dark mode 强调色不够亮，部分 muted 文字不达标 |
| 触摸目标 | ≥ 44 × 44 px | `.cbi-button` height 35px 不达标 |
| Focus 可见 | 所有 interactive 元素 `:focus-visible` 可见 | 当前 focus 用紫色 box-shadow，视觉冲突 |
| 键盘导航 | Tab 顺序合理；Esc 关 modal | 当前 modal 无 Esc 关闭 |
| 屏幕阅读器 | 所有 img 有 alt；button 有 label | navbar img 已修复，其他需要扫一遍 |
| 减少动画 | 尊重 `prefers-reduced-motion` | 当前不支持 |
| 颜色不传递信息 | 不能仅靠颜色区分（如 error 要有图标） | 当前 `.cbi-input-invalid` 只改色 |

---

## 12. 性能预算（硬约束）

| 资源 | 上限 |
|---|---|
| 主 CSS gzipped | < 20 KB |
| 主 JS gzipped | < 10 KB |
| 字体加载 | **0**（系统字体） |
| 图标库总尺寸 | < 15 KB（只 bundle 用到的 Lucide） |
| 首屏 LCP | < 1s（同 LAN 环境） |
| 单页 reflow | 跳转后 < 200ms |

**禁止：**
- 加载 Google Fonts / CDN 字体
- 加载 jQuery / 任何 80KB+ 库
- 给 navbar 之外的元素加 `backdrop-filter`（CPU 重）

---

## 13. **不做的事**（明确反原则）

> 这一节和"做什么"同样重要。说"不"是设计师最重要的能力。

### 13.1 ❌ 不堆 Glassmorphism

毛玻璃只用在 navbar 底部条（已经在了）和 modal overlay。
**不用在：** 侧栏、下拉菜单、tooltip、卡片。

理由：路由器嵌入式浏览器对 `backdrop-filter` 性能不佳；满屏模糊视觉疲劳；2021 风。

### 13.2 ❌ 不给按钮加渐变

按钮就是按钮，纯色 + hover 加深一档。
渐变只允许：dashboard 数据可视化 / 大型状态环。

### 13.3 ❌ 不抄 Tailwind 演示页风

Tailwind 文档里那种"几十个颜色徽章贴满一页"是 utility 示范，不是好设计。
我们的设计：**整屏强调色不超过 5 处**。

### 13.4 ❌ 不学 Material Design 3

LuCI Material 已经是 Material 派系。我们改的方向是**离开 Material**，向 **system UI / iOS / Linear** 靠拢。
不要 ripple、不要 elevation 阴影梯度、不要 FAB。

### 13.5 ❌ 不为截图设计

不要因为"截图好看"就把侧栏做得过宽、字体过大、图标过艳。
设计为每天打开 5-10 次的用户服务。

### 13.6 ❌ 不上深色玻璃质感的"黑客感"

不要绿色文字 + 黑底 + monospace 字体的"黑客 UI"。
这是路由器后台，不是 sci-fi 电影道具。

### 13.7 ❌ 不重写 LuCI 数据层

只换皮。CBI、dispatcher、template 这些 LuCI 底层不动。
**主题做的事 = 让数据更好看，而不是改 LuCI 架构**。

---

## 14. 实施路线图

> 这是讨论后落地的顺序建议。每个阶段独立可上线，不依赖后面阶段。

### 阶段 0：建立 Tokens（**0.5 天，不改任何外观**）

- 新建 `htdocs/luci-static/design/css/tokens.css`
- 把上述所有 token 定义进去
- 在 `style.css` 顶部 `@import "tokens.css"` 或合并
- **不改任何其他 CSS** —— 这一步的成果是"所有后续修改可以用 `var(--xxx)` 引用"

✅ 验收：tokens.css 存在，所有变量定义；style.css 暂时不引用，但已就位。
✅ 风险：零。

---

### 阶段 1：基础组件迁移（**1 天，第一轮视觉变化**）

把 style.css 中以下选择器**迁移到 token 引用**：

- 按钮（cbi-button 系列）
- 输入框（input / select / textarea）
- 卡片（cbi-section）
- 表单行（cbi-value）
- 进度条（cbi-progressbar）
- 徽章（label / data-indicator）

**关键改动：**
- 删 Cocon-Regular 字体加载与引用
- 删 icomoon 字体（保留 design 字体临时用）—— 之后阶段 2 全换 SVG
- 统一圆角到 `--radius-md/lg`
- 统一阴影到 `--shadow-sm/md`

✅ 验收：浅色 + 深色模式下，按钮 / 输入框 / 卡片样式一致，无紫色 focus，无 uppercase 按钮。
✅ 风险：低（每个组件单独可测）。

---

### 阶段 2：图标系统重做（**1-2 天**）

- 选 Lucide 图标，bundle 到 `htdocs/luci-static/resources/icons/` 作 SVG sprite
- 写 `icon-registry.js`（Node Name → Icon 映射）
- 改 `menu-design.js`：渲染时插入 `<svg use:href="#icon-{name}">`
- 删 icomoon 字体文件、`@font-face 'icomoon'`、design 字体的 fallback 引用
- 底栏 5 个 PNG 图标 → SVG（统一线条）
- CSS 里所有 `[data-title="X"]:before { content: "\eXXX" }` 删除

✅ 验收：菜单图标全部基于 node name，新增插件只需在 registry 加一行。
✅ 风险：中（涉及 menu-design.js 渲染逻辑），需要测各种插件菜单。

---

### 阶段 3：关键页面重设计（**2-3 天**）

- **登录页**：重新布局 + leading icon + 删复位 + 加 hostname 卡片
- **Overview Dashboard**：CSS Grid 4-tile + sparkline（用 CSS draw 简单 sparkline，不引图表库）
- **配置页**：表单行 grid 化、密度优化

✅ 验收：登录页和首页观感"完全不同"，但其他页面仍然好用。
✅ 风险：中（涉及 LuCI 模板 + CSS），需要每个改过的页面手动验证。

---

### 阶段 4：微交互 + 暗色模式打磨（**1 天**）

- Focus ring 全面应用
- Skeleton loaders 替代 spinner
- 手动主题切换按钮
- `prefers-reduced-motion` 支持
- 深色模式 token 微调

✅ 验收：键盘 Tab 走一遍所有 focus 可见；切换深浅观感各自专业。
✅ 风险：低。

---

### 阶段 5（可选）：高级功能（**3-5 天**）

- Cmd+K 命令面板（搜任意菜单）
- 底栏 UCI 配置
- 状态页 sparkline + 历史趋势

✅ 风险：中-高，是新功能不是重构。

---

## 15. 视觉示意（文字描述版）

> 等真做出来时再换成 mockup 截图。这里先用 ASCII / 文字描述大致观感。

### 浅色 Dashboard 应有的感觉

- 整页底色 `#fafafa`（不是纯白）
- 卡片是纯白 + 极浅边框 + 几乎不可见的阴影 → 有"浮出来"的感觉但不张扬
- 顶栏纯白 + 1px 下边框 + hostname `font-weight: 600`
- 侧栏纯白 + 右侧 1px 边框 + 当前项有 `accent-50` 的极浅绿底 + 3px 强调色左边框
- 按钮：主操作是饱和的 `#10b981`，其余都是边框灰白
- 数据数字（CPU 12%）用 tabular-nums + semibold + `--text-3xl`，统计感
- 整屏除了"主操作按钮"和"当前选中菜单"，看不到饱和色块

### 深色 Dashboard 应有的感觉

- 整页底色 `#0a0a0b`（极深灰，不是纯黑）
- 卡片是 `#18181b` 比页面亮 → 有微妙的"浮起"
- 文字主色 `#fafafa`（不是纯白）
- 强调色提亮到 `#34d399`，在深色下对比足够
- 阴影换成 1px 高光边框（`rgb(255 255 255 / 6%)`）
- 整体氛围："深色但不刺眼，专业但不冷冰冰"

### 移动端应有的感觉

- 底栏 64px 高 + 4-5 个 tab + 文字标签 + 当前 tab 强调色
- 顶栏 56px 高 + hamburger 按钮 + hostname + 主题切换 + 通知点
- 内容区上下都有 chrome 但中间有充足滚动空间
- 表单行折叠成"label 在上 value 在下"两行布局
- 输入框、按钮都 ≥ 44px 高度，拇指友好

---

## 16. 待你拍板的开放问题

讨论时希望你回答这些（不用都答，挑你有想法的）：

### Q1：主强调色保留"青"还是换"绿"？

| 选项 | 颜色 | 性格 |
|---|---|---|
| (A) 保留原项目精神，用 **现代化的青色** `#0d9488` (teal-600) | 沉稳 / 略冷 |
| (B) 换成 **emerald** `#10b981` | 明快 / 健康 |
| (C) 大胆换 **indigo** `#6366f1` | 科技 / 专业 |
| (D) 换 **cyan** `#0891b2` | 数据 / 清新 |

我个人倾向 **B (emerald)**——和"运行中"语义自然挂钩。

### Q2：字体是用系统栈还是引一个 Web Font？

| 选项 | 利 | 弊 |
|---|---|---|
| (A) 纯系统栈（我的推荐） | 0 加载、CJK 完美兜底 | 不同 OS 字体不同 |
| (B) 引 Inter + Noto Sans SC | 视觉统一、设计感强 | 多 100-300 KB 加载 |

### Q3：Material 风的 Ripple 涟漪点击效果？

| 选项 | |
|---|---|
| (A) 完全不要 ripple（我的推荐） | 静态系统更耐看 |
| (B) 保留低调 ripple | 触觉反馈强 |

### Q4：Dashboard tile 上要不要画小图表（sparkline）？

| 选项 | |
|---|---|
| (A) 要（推荐） | 信息量更大，但需要数据采样 |
| (B) 不要 | 实现简单，但 tile 略空 |

### Q5：底栏文字标签？

| 选项 | |
|---|---|
| (A) 加文字 label（推荐） | 像 iOS Tab Bar，可访问性好 |
| (B) 不加，保留当前纯图标 | 紧凑 |

### Q6：登录页背景？

| 选项 | |
|---|---|
| (A) 纯色（推荐） | 干净，不抢卡片焦点 |
| (B) 极淡的 dot pattern | 略有质感 |
| (C) Router 拓扑图案 | 有故事，但容易过度设计 |

### Q7：从哪个阶段开始？

- (A) 阶段 0：先把 tokens.css 建好（推荐，零风险）
- (B) 阶段 1：直接做组件迁移（视觉立刻有变化，但风险中）
- (C) 阶段 3：直接重设计登录页 / Dashboard（最快出"截图效果"，但和当前不协调）

---

## 17. 一句话承诺

如果按这套系统全部实施完，**你的主题不会像任何现成开源主题**——既不像 Material 派，也不像 Tailwind 派，也不像那种"AI 一键生成"的现代 admin 模板。

它会像一个**真的请了设计师**做的产品。

但不会像 Cocon 字体那么奇怪。

---

## 附录：与现有 finalplan.md 的关系

- **finalplan.md**：管"代码健康度"——修 bug、清死代码、补可访问性硬指标。**已完成 31/32**。
- **claude_style.md (本文)**：管"视觉与体验系统"——重做 UI 表达。**尚未开始**。

两份文档**互补不冲突**。本文不动 LuCI 数据层、不破坏 finalplan 已修复的稳定性、不重复 finalplan 已覆盖的工程问题（如 a11y 的 alt/aria 部分 finalplan 已做，这里只补充 focus ring 和触摸目标）。
