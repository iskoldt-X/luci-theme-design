# Luci-Theme-Design 进阶升级计划（Upgrade Proposal）

> 起草时间：2026-05-22
> 前置：[styling-progress.md](styling-progress.md) 视觉系统升级已完成 20 个 Step
> 性质：**功能性**升级（不只是视觉），让主题从"漂亮的管理面板"变成"实用的控制台"
> 配套预览：[upgrade-preview.html](upgrade-preview.html) — 单文件可交互 demo

---

## 0. 总指导原则

让这套主题真正区别于"又一个开源 LuCI 皮肤"的，不是**色彩**，而是**信息组织方式**和**交互流畅度**。本计划提案的所有功能围绕三个目标：

1. **快速找到东西** — LuCI 100+ 菜单项分散在 3 级嵌套里，导航成本高
2. **看清正在发生什么** — 静态数字 vs. 动态数据可视化
3. **操作流畅自然** — 现代 Web 应用的反馈节奏 vs. 90 年代式 modal/alert

每个升级项都标注 **优先级 / 工时 / 风险 / 实现路径**，按 Tier 组织：

| Tier | 取向 | 是否推荐 |
|---|---|---|
| **S** | Game changers（颠覆性提升） | ⭐ 强烈推荐先做 |
| **A** | 高实用度（每天用得到） | 推荐做 |
| **B** | UX 打磨 / 锦上添花 | 看时间 |
| **C** | 工程优化（不可见但重要） | 长期债 |
| **D** | 大胆但争议（值得讨论） | 谨慎 |

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
[ 用户按 ⌘K / Ctrl+K ]

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
// 1. 数据源：递归遍历 ui.menu.load() 的结果
async function buildMenuIndex() {
    const tree = await ui.menu.load();
    const flat = [];
    walk(tree, [], flat);
    return flat;   // [{ path, breadcrumb, title, name }, ...]
}

// 2. 触发器：⌘K / Ctrl+K
document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
    }
});

// 3. 过滤：fuzzy match（支持英文 / 中文 / 拼音首字母）
function filter(items, q) {
    const re = new RegExp(q.split('').join('.*'), 'i');
    return items.filter(i => re.test(i.title) || re.test(i.path));
}

// 4. 导航：直接跳转
function open(item) {
    location.href = L.url(item.path);
}
```

| 维度 | 评估 |
|---|---|
| 工时 | ~150 行 JS + ~80 行 CSS（约 3-4 小时） |
| 风险 | 极低（纯附加 UI，不改任何现有流程） |
| 依赖 | LuCI `ui.menu` API（已存在） |
| 兼容性 | 全现代浏览器（不依赖任何新 API） |
| 移动端 | 自动适配——手机端按"搜索"图标触发 |

**Bonus：** 后续可扩展为"搜配置项"——不仅搜菜单，还能搜 CBI 字段（"DNS 服务器"直接跳到那个配置框）。

---

### S2 · Toast 通知系统（**改善每一次保存**）

**Why this matters:**
LuCI 当前每次"保存并应用"会弹一个**全屏阻塞 modal**："正在应用配置..."。15 秒后页面刷新。这是 2010 年代的反馈方式。

Toast 是非阻塞的、自动消失的、可堆叠的、可携带 action 的——它是**每一次用户操作**的反馈语言。

**视觉效果：**

```
                              ╭─────────────────────────────╮
                              │ ✓ 配置已保存                  │
                              │   24 项变更已应用              │
                              │                     [撤销]    │
                              ╰─────────────────────────────╯
                                                          ↑
                                右下角，2 秒自动消失，支持点击撤销
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
// 全局 API
window.toast = {
    success(msg, opts = {}) { show('success', msg, opts); },
    info(msg, opts = {}) { ... },
    warning(msg, opts = {}) { ... },
    error(msg, opts = {}) { ... }
};

// 用法
toast.success('Wi-Fi 已重启', { duration: 3000, action: { label: '撤销', onClick: undo } });

// 拦截 LuCI 现有 ui.addNotification 调用，自动走 toast
if (typeof ui !== 'undefined' && ui.addNotification) {
    const orig = ui.addNotification;
    ui.addNotification = (title, msg, level) => {
        toast[level || 'info'](msg || title);
    };
}
```

| 维度 | 评估 |
|---|---|
| 工时 | ~80 行 JS + ~50 行 CSS（约 2-3 小时） |
| 风险 | 低（拦截或覆盖 LuCI 现有 API） |
| 影响范围 | 全主题——每个保存动作都受益 |
| 移动端 | 自动适配——移动端从底部弹起而非右下 |
| 可访问性 | 需加 `aria-live="polite"` 让屏幕阅读器读出 |

**进阶想法：** Toast 堆叠时自动 collapse（"5 个保存成功"）；error toast 持久显示直到用户关闭。

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

**数据源（无依赖）：**

| 指标 | 路径 | 兼容性 |
|---|---|---|
| CPU 负载 | `/proc/loadavg` | 100% Linux |
| 内存使用 | `/proc/meminfo` | 100% Linux |
| 实时流量 | `/proc/net/dev`（轮询 + 差分） | 100% Linux |
| 温度 | `/sys/class/thermal/thermal_zone0/temp` | **需 fallback**（部分老硬件没有） |
| 网络客户端数 | `cat /tmp/dhcp.leases | wc -l` | 99% |

**实现路径：**

```javascript
// 维护一个 60 点滑动窗口（每 5 秒一个采样 = 5 分钟）
class MetricRing {
    constructor(max = 60) { this.max = max; this.data = []; }
    push(v) {
        this.data.push(v);
        if (this.data.length > this.max) this.data.shift();
    }
    sparklinePath(width, height) {
        // 返回 SVG <path d="M0,30 L20,22 ..."/>
    }
}

// 用 SVG 重绘而不是 canvas — 矢量、可主题化、轻量
function renderSparkline(svg, ring) {
    const path = ring.sparklinePath(200, 40);
    svg.querySelector('.line').setAttribute('d', path);
    svg.querySelector('.fill').setAttribute('d', path + ' L200,40 L0,40 Z');
}

// 5 秒一次轮询
setInterval(async () => {
    const cpu = await fetch('/cgi-bin/luci/admin/status/sysinfo').then(r => r.json());
    cpuRing.push(cpu.loadavg[0]);
    renderTile('cpu', cpuRing);
}, 5000);
```

| 维度 | 评估 |
|---|---|
| 工时 | ~120 行 JS + ~60 行 CSS（约 4 小时） |
| 风险 | 低（纯前端，SVG 绘制） |
| 数据依赖 | LuCI sysinfo endpoint（已存在 LuCI 21.02+） |
| 性能 | 5s 轮询，单次 ~200 字节响应，可忽略 |
| 移动端 | 完全兼容 |

**进阶想法：**
- 长按 tile 弹出"过去 1 小时"详细图表
- 历史持久化：用 `localStorage` 跨页面刷新保留 5 分钟数据
- 如果装了 `collectd-mod-cpu`，直接拉 24 小时历史

---

## 2. Tier A — 高实用度

### A1 · WAN / 互联网状态 Hero 卡片

**Why：** 用户打开管理面板，**首要问题**是"我的网是好的吗？"。把这个问题做成首屏最大的一张卡片。

**视觉：**

```
╔══════════════════════════════════════════════════════════╗
║ 🌐 互联网 · 在线                                          ║
║                                                          ║
║  公网 IP    203.0.113.45        延迟到 1.1.1.1            ║
║  运营商     China Telecom        ●●●●○ 14ms              ║
║                                                          ║
║  ↑ 92 Mbps    ↓ 487 Mbps        最近 24h 稳定            ║
║  ────────────                   ▁▂▃▃▂▅▇▆▅▄▃ 平均 14ms   ║
╚══════════════════════════════════════════════════════════╝
```

**实现：**
- 公网 IP：`ubus call network.interface.wan status` → `.address`
- ISP：可调用 `https://ipapi.co/{ip}/json` 或本地 GeoIP（隐私模式选项）
- 延迟：浏览器 `fetch('//1.1.1.1', {mode: 'no-cors'})` 测时间差
- 上下行：从 `/proc/net/dev` 取 wan 接口字节差分
- 历史：和 Sparkline 共享数据源

| 工时 | ~100 行 JS + ~80 行 CSS（3-4 小时） |
| 风险 | 低-中（ipapi 外部依赖可选）|

---

### A2 · 设备列表智能图标

**Why：** DHCP 客户端 / 无线客户端表格里，`a4:c4:94:6c:8f:33` 谁知道是什么设备。智能图标根据 hostname / MAC OUI 推断。

**视觉：**

```
设备                  IP              连接          状态
─────────────────────────────────────────────────────────
🖥 MacBook-Pro        192.168.1.100   Wi-Fi 5GHz   ●在线  -41 dBm
📱 iPhone-John        192.168.1.105   Wi-Fi 5GHz   ●在线  -52 dBm
📺 LG-WebOS-TV        192.168.1.110   有线         ●在线  1 Gbps
🌡 SmartThermostat    192.168.1.122   Wi-Fi 2.4G   8h ago
🎮 Switch-Nintendo    192.168.1.130   Wi-Fi 5GHz   ●在线
📷 Doorbell-Cam       192.168.1.150   Wi-Fi 2.4G   ●在线
🖨 HP-LaserJet        192.168.1.200   有线         离线 3d
```

**实现：**

```javascript
const DEVICE_TYPES = {
    // hostname 关键词 → icon
    'macbook|imac|mac-mini':       { icon: 'monitor',    type: '电脑' },
    'iphone|ipad':                 { icon: 'smartphone', type: '苹果设备' },
    'android|pixel|samsung':       { icon: 'smartphone', type: '安卓设备' },
    'tv|chromecast|appletv|roku':  { icon: 'tv',         type: '电视' },
    'switch|nintendo|playstation': { icon: 'gamepad-2',  type: '游戏机' },
    'thermostat|hue|nest|aqara':   { icon: 'thermometer',type: 'IoT' },
    'camera|cam|doorbell':         { icon: 'camera',     type: '摄像头' },
    'printer|laserjet|brother':    { icon: 'printer',    type: '打印机' },
    'echo|alexa|homepod':          { icon: 'mic',        type: '智能音箱' },
};

// MAC OUI prefix → 厂商
const OUI = {
    '3C:22:FB': 'Apple',    'A4:C4:94': 'Samsung',
    'B8:27:EB': 'Raspberry Pi',  '00:1A:11': 'Google',
    // ...精选 200 个常见
};

function inferDevice(client) {
    // 1. 先看 hostname 关键词
    // 2. 再看 MAC OUI
    // 3. 最后看连接方式（有线 vs 无线 vs 2.4/5GHz）
    return { icon, type };
}
```

| 工时 | ~50 行 JS + 200 项 OUI/hostname 表（4-5 小时含数据收集） |
| 风险 | 低 |
| 数据来源 | 已有 `dhcp.leases` + `iwinfo.assoclist` |

---

### A3 · 快速操作浮层

**Why：** 重启 Wi-Fi / 应用变更 / 释放 DHCP 这些常用操作，目前都得"系统 → ... → 确认"3 步。一个固定位置的⚡按钮 ≈ 3 倍效率。

**视觉：**

```
顶栏右侧（理论挨着主题切换按钮）：
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

**实现：** 一个下拉 popover + 调用 LuCI 现有的 ubus 接口。

| 工时 | ~80 行 JS + ~60 行 CSS（2-3 小时） |
| 风险 | 中（涉及实际操作，需 confirm） |

---

### A4 · PWA 安装引导

**Why：** 我们已经有了正确的 manifest.json，但用户不知道可以"添加到主屏幕"。

**视觉：**

```
第一次访问时，底部低调出现：

┌─────────────────────────────────────────────────┐
│ 💾 把 OpenWrt 添加到主屏幕，下次直接打开           │
│                                  [稍后] [安装]   │
└─────────────────────────────────────────────────┘
```

**实现：**

```javascript
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    if (localStorage.getItem('pwa-dismissed')) return;
    showInstallBanner(e);
});
```

| 工时 | ~30 行 JS + ~40 行 CSS（1-2 小时） |
| 风险 | 极低 |
| 兼容性 | Chrome / Edge / Android。iOS Safari 不支持 `beforeinstallprompt`，需要 fallback 提示"点击分享按钮" |

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

| 工时 | ~70 行 CSS + ~30 行 JS（媒体查询切换） |
| 风险 | 低 |

---

### B2 · Pull-to-Refresh

**Why：** 移动端 status 页用户最频繁的动作是"再看看数据更新了没"。原生下拉刷新手势 = iOS 体验。

```
[ 状态页顶部 ] ── 手指下滑 ──>  [ 显示 ↻ 旋转图标 ]
                                       ↓
                                  [ 刷新数据 + 触觉反馈 ]
```

**实现：** `touchstart / touchmove / touchend` + transform translateY。

| 工时 | ~80 行 JS（2-3 小时） |
| 风险 | 中（手势冲突需测：与 iOS Safari 边缘划返回不冲突，安全的下滑距离需要测）|

---

### B3 · 系统健康分（Health Score）

**Why：** 把 CPU / RAM / 温度 / Uptime / Load / 磁盘 聚合成 0-100 一个数。一眼判断系统状态。

```
        ╭──────────╮
        │          │       系统健康
        │   87     │       ↑ 1 分 vs 昨天
        │ /100     │       
        │          │       CPU         ●●●●○ 良好
        ╰──────────╯       内存        ●●●○○ 注意
       (SVG circle ring)   温度        ●●●●● 优
                           网络        ●●●●○ 良好
                           运行时长     ●●●●● 优
```

**坑：** 这种"打分"容易显得**做作 / 不真实**。建议：

- 算法**透明**：点开能看到每一项是怎么打分的
- 默认**隐藏**：UCI 配置开关，喜欢的人开，怕做作的人关
- 不显示**总分上升下降趋势**（容易让人焦虑）

| 工时 | ~60 行 JS + ~50 行 CSS（含 SVG circle） |
| 风险 | 低（实现），中（争议） |

---

### B4 · 配置变更预览（Diff Viewer）

**Why：** LuCI 自带 uci-change 显示"红/绿/灰"三色 diff，但藏在"未保存变更"小角落。**应用前**让用户清楚知道改了什么，是配置安全的关键。

**视觉：**

```
[ 应用变更 ] 按钮点击后弹出：

╭────────────────────────────────────────────╮
│ 你即将应用 3 项变更                          │
├────────────────────────────────────────────┤
│ network.lan                                  │
│   + ipaddr  = 192.168.1.1                    │
│   - ipaddr  = 192.168.0.1                    │
│                                              │
│ wireless.radio0                              │
│   + channel = 11                             │
│   - channel = auto                           │
│                                              │
│ firewall.@redirect[0]                        │
│   + dest_port = 80                           │
│   (new redirect rule)                        │
├────────────────────────────────────────────┤
│ ⚠ 修改 LAN IP 后你的浏览器会断开连接          │
│                                              │
│         [ 取消 ]    [ 确认应用 ]              │
╰────────────────────────────────────────────╯
```

**实现：** 已有 `uci.changes()` API 拉数据，包装一个 modal。

**特别有价值：** 危险变更（改 LAN IP / 关防火墙 / 改 DHCP 池）加红色警告。

| 工时 | ~100 行 JS + ~80 行 CSS（4-5 小时） |
| 风险 | 中（需测各种 plugin 的 UCI 变更格式） |

---

## 4. Tier C — 工程优化（不可见但重要）

### C1 · CSS 文件拆分 + stylelint

**Why：** 当前 style.css = 4141 行 / 93 KB 单文件。继续往上加规则会失控。

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

| 工时 | ~3 小时（拆分）+ ~1 小时（CI 配置） |
| 风险 | 中（拆分时容易破坏 cascade 顺序） |

---

### C2 · 完整迁移图标到 Lucide SVG

**Why：** 当前主题图标系统是混合的：
- 主菜单图标：'design' icon font + CSS `[data-node-name]` 选择器
- 新组件：Lucide SVG sprite（主题切换按钮等）
- 部分小图标：散落在 CSS 里的字符（`\eb03` 之类）

完整迁移到 Lucide：
- 删除 'design' 字体（~25 KB）
- 删除所有 `[data-node-name="xxx"]:before { content: "\eXXX" }` CSS 规则（~50 条）
- menu-design.js 直接渲染 `<svg><use href="..."/></svg>`

| 工时 | ~3-4 小时 |
| 风险 | 中（涉及很多插件适配） |
| 收益 | -25 KB 字体；可单独着色每个图标；不依赖字体加载 |

---

### C3 · 国际化压力测试

**Why：** 我们已经加了 CJK / 长德文的 overflow 兜底（finalplan Phase 5），但没真正测过。德语 "Speichern und übernehmen"（24 字符）在按钮里是不是真的好看？

**解法：** 开发用"伪长串"模式：

```javascript
if (location.search.includes('debug=pseudo-long')) {
    document.querySelectorAll('button, label, .nav-item').forEach(el => {
        el.textContent = el.textContent + ' '.repeat(0) + el.textContent;
    });
}
```

把所有标签 ×2，看哪里崩。还可以做"短串"模式（CJK 字符），"RTL"模式（阿拉伯/希伯来）。

| 工时 | ~2 小时（脚本 + 修补发现的问题） |
| 风险 | 极低 |

---

### C4 · 性能预算 + Lighthouse CI

**Why：** 加 features 容易，但每加一个都让首屏变慢一点。需要硬约束。

**方案：**
- `.github/workflows/lighthouse.yml` PR 触发
- 用 `lhci` 跑 Lighthouse
- 性能 < 90 / 可访问性 < 95 直接 fail
- 资源体积超出预算（CSS > 100 KB / JS > 50 KB）fail

| 工时 | ~2 小时 |
| 风险 | 零 |

---

## 5. Tier D — 大胆但争议

> 这些是"如果我们想做开源界没人做过的事"的方向。**不建议优先做**，但值得讨论。

### D1 · 内置 Speedtest

```
[ 立即测速 ] 点击后：

   ↓ 488.2 Mbps
   ↑ 92.4 Mbps
   延迟 14ms · 抖动 2ms
   服务器：China Telecom Shanghai

   [实时图表] [上次结果] [测速历史]
```

**实现：** 接入 [librespeed](https://github.com/librespeed/speedtest) 或者用浏览器原生 `fetch` 大文件测速。

**坑：** "测速"会消耗带宽，普通家用网络上跑速度测试一次几百 MB。需要明确告知用户。

| 工时 | ~6-8 小时（含 backend） |
| 风险 | 中（需安装额外包） |

---

### D2 · 实时流量地图（Top N 设备带宽火焰图）

```
现在 LAN 流量构成：

iPhone-John  ████████████████ 124 Mbps  ↓
MacBook-Pro  ████████ 56 Mbps           ↓
LG-WebOS-TV  ████ 23 Mbps               ↓
其他 (8 个)  ██ 8 Mbps
─────────────────────────────────
总计         211 Mbps
```

**实现：** 需要 `nlbw` 或 `collectd-mod-iptables` 数据源。如果用户没装，显示"安装统计模块以查看流量构成"。

**冒着 LuCI 主题边界**——理论上是"主题"不该有的功能。

| 工时 | 8-10 小时 |
| 风险 | 高（依赖外部包 + 设计复杂） |

---

### D3 · AI 助手按钮

```
顶栏 🤖 按钮 → 弹出对话窗：

╭─────────────────────────────────────────╮
│ 🤖 路由器助手                            │
├─────────────────────────────────────────┤
│ > 为什么 5GHz 信号弱？                   │
│                                         │
│ 我看了你当前的配置：                      │
│ • 信道 36（拥挤）→ 建议改为 149          │
│ • 发射功率 17 dBm（偏低）→ 建议 20      │
│ • 信道宽度 80MHz（合理）                 │
│                                         │
│ [ 自动优化 ]   [ 仅显示建议 ]           │
╰─────────────────────────────────────────╯
```

**实现：** 用户提供自己的 OpenAI / Claude / Gemini API key（本地存 `localStorage`），主题在浏览器侧组装 prompt + 调 API。**配置数据从不离开浏览器**（隐私友好）。

**这会让这个主题在 GitHub Trending 上拿到 10k+ stars。** 但也**完全跑偏 LuCI 主题边界**。

| 工时 | 8-12 小时 |
| 风险 | 高（产品定位 / 隐私争议 / API 成本） |
| 收益 | 病毒级传播潜力 |

---

## 6. 实施建议

### 推荐顺序

**第一波（必做，~1 个工作日 8h）：**
1. **S1 Cmd+K** → 立刻把 LuCI 的最大痛点（找东西）解决
2. **S2 Toast** → 替换 modal，让每次保存都顺滑
3. **S3 Sparkline** → 让首页"活"起来

**第二波（值得做，~2 个工作日 16h）：**
4. **A1 WAN Hero** → 答好"网通不通"
5. **A2 智能设备图标** → 让客户端列表有意义
6. **B4 Diff Viewer** → 配置变更安全感

**第三波（看时间，~2 个工作日 16h）：**
7. **A3 快速操作面板**
8. **A4 PWA 安装引导**
9. **B1 Bottom Sheet**
10. **B2 Pull-to-Refresh**

**长期工程优化（独立 PR）：**
- C1 CSS 拆分
- C2 完整 Lucide 迁移
- C3 i18n 压测
- C4 Lighthouse CI

**讨论后再定（**不一定要做**）：**
- B3 健康分（可能做作）
- D1 Speedtest（超出主题边界）
- D2 流量地图（依赖额外包）
- D3 AI 助手（完全跑偏，但极有冲击力）

---

### 风险红线

- ❌ **不重写 LuCI 数据层**：所有功能基于 LuCI 现有 API
- ❌ **不引入构建工具**：保持"一键放进去就能用"
- ❌ **不引入运行时框架**：纯原生 JS，最多用一个 ~5KB 工具库
- ❌ **不超过 100 KB CSS / 50 KB JS / 0 web font**

### 性能预算（继续 finalplan 的约束）

| 资源 | 当前 | 上限 |
|---|---|---|
| 主 CSS gzipped | ~20 KB | 25 KB |
| 主 JS gzipped | ~8 KB | 15 KB |
| 字体加载 | 22 KB (design icon font) | 25 KB |
| SVG sprite | 5.3 KB | 15 KB |
| 首屏 LCP | < 1s @ LAN | < 1.5s |

---

## 7. 与已有文档的关系

| 文档 | 范围 | 状态 |
|---|---|---|
| [gemini.md / codex.md / claude.md](.) | 第一轮代码审计 | 历史参考 |
| [finalplan.md](finalplan.md) | 代码健康度修复（31/32 项） | 已完成 |
| [claude_style.md](claude_style.md) | 视觉设计系统提案 | 已完成 |
| [styling-progress.md](styling-progress.md) | Phase 0-5 视觉执行日志（20 个 Step） | 已完成 |
| **upgrade.md（本文）** | **功能性升级提案** | **讨论中** |
| [upgrade-preview.html](upgrade-preview.html) | 单文件可交互 demo | 配套 |

本文是**功能层面**的提案，不重复视觉设计相关内容（那些在 claude_style.md）。所有功能假设视觉系统已就位。

---

## 8. 最后一句话

如果只能选一件事先做：**Cmd+K**。

它把 LuCI 用了 15 年的"我得记得这个设置在哪"——变成"我说我要什么，UI 帮我找"。这是从 90 年代式管理面板进化到 2025 年式 productivity tool 的**本质跨越**。

其他都好，但 Cmd+K **改变使用方式**。
