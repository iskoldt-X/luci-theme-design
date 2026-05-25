# WAN Traffic Tile — 审计与修复计划

> 创建:2026-05-24,Round 43 进行中。
> 状态:**待 ship**。建议合并到 Round 44 polish 一起 ship,不单独走。
> 触发:用户报告"上传期间数字高但虚线看不到,上传完一小会儿虚线突然出现",
> 加上 Chrome-Claude live DOM observations,加上对源码
> (`sparkline.js`, `wan-stats.js`, `wan-hero.js`, features.css §sparkline) 的逐行 review。
>
> 适用范围:`design-tile-net` (id `design-tile-net`,WAN Traffic dual-value tile)。
> CPU/Mem/Temp 三 tile **不在本 doc 修复范围内** —— 它们走 sparkline.js 的
> 单线分支,本 doc 的所有修法都保持向后兼容。

---

## 一、症状回顾

**用户观察 (2026-05-24)**:
- 上传文件期间 WAN Traffic tile 的**数字**显示正确 (e.g. `↑ 1.6 Mbps`)
- 但**虚线 sparkline** (`.design-tile-spark-line-secondary`,dashed,plot tx)
  在上传持续期间**几乎看不见**
- 上传结束**约一两秒后**,虚线"突然出现"且形态正确(高峰 → 下跌)

**Chrome-Claude 同期 live DOM 实测**:
- `yMax = 37.0, yMin = 25.5`(viewBox `0..40` 中底部 1/3 区域)
- 60 个点里 59 个 y=37.0(贴底),只有 1 个 y=7.3(尖峰)
- footer `Peak 3.4 Mbps` 持续显示不变

这两组证据**指向同一个根因**:历史尖峰把当前小流量压扁到 viewBox 底部。

---

## 二、架构(数据链)

```
[wan-stats.js] 单例 poll 每 2s
   /sys/class/net/<wan>/statistics/{rx,tx}_bytes via rpcd ubus
   差分 → ×8 (Bytes/sec → bits/sec)
   emit { rxBitsPerSec, txBitsPerSec, deviceName, online }
        ↓ subscribe (× 2 consumers)
[sparkline.js] design-tile-net "WAN Traffic" (dualValue=true)
   - netRx (MetricRing 60-sample window) ← rxBitsPerSec
   - netTx (MetricRing 60-sample window) ← txBitsPerSec
   ↓ renderTileSpark()
   - primary line  (.design-tile-spark-line, 实线绿, plot rx)
   - fill          (.design-tile-spark-fill, 绿 0.18 opacity, 仅 primary 线下方)
   - secondary line(.design-tile-spark-line-secondary, dashed 3 2, opacity 0.55, plot tx)

[wan-hero.js] 顶部 hero 卡的 "↑ N Mbps · ↓ M Mbps" 行
   同一 subscribe,只渲数字,不画图,不在本 doc 范围
```

**关键参数**:
- 每 2 秒一次 emit → 两 ring 都 push 一次
- Ring 容量 60 → **滑动窗口 = 2 分钟**(不是 5 分钟。sparkline.js 顶部
  `SAMPLE_INTERVAL_MS=5000` 是 CPU/Mem/Temp 的 tick() 速率,WAN 由 wan-stats.js
  自驱动 2s,绕过那个常量)

---

## 三、根因(按 confidence 高到低)

### 🔴 P0 — `sharedHi` cross-ring 量程污染(真正主病)

**位置**:`htdocs/luci-static/resources/design-x/sparkline.js:258-266`
(Step 139 / Round 37 引入)

**逻辑**:
```js
var sharedHi = null;
if (ringSecondary) {
    var rxHi = 0, txHi = 0;
    for (...) rxHi = max(rxHi, ring.data[i]);
    for (...) txHi = max(txHi, ringSecondary.data[k]);
    sharedHi = Math.max(rxHi, txHi);
}
var linePath = ring.path(SPARK_W, SPARK_H, sharedHi);
// ...
lineSecondaryEl.setAttribute('d',
    ringSecondary.path(SPARK_W, SPARK_H, sharedHi) || '');
```

`MetricRing.prototype.path()` 内部:
```js
if (sharedHi != null && sharedHi > hi) hi = sharedHi;
```

**问题**:取两 ring 的当前最大值再 max 作为统一 Y 轴上限。后果:
**任一方向曾经有过尖峰**(在 2-min 窗口内未滑出),**另一方向的小流量会被压扁到 viewBox 底部**。

**用户场景重建**:
- 1 分钟前下载 50 Mbps → `rxHi = 50M` 还在 ring 里
- 现在轻量上传 500 Kbps → `txHi = 500K`
- `sharedHi = max(50M, 500K) = 50M`
- secondary tx 算路径:`local hi=500K`,`sharedHi(50M) > 500K` → `hi → 50M`
- tx 值 500K 映射:`y = h - (500K/50M)*0.85h - 0.075h ≈ 0.91h` → **贴底**

Chrome-Claude 实测 `yMax=37, yMin=25.5` 全部 ≥ 0.64h,正是这个症状。

**Step 139 的原设计意图**:让 rx 和 tx 在**同一时刻**的相对大小一目了然 —— 这本身有价值。
但实现上,**当前 max 也加入对比**,导致历史尖峰污染当前显示比例,完全违反作者意图。

### 🟡 P1 — secondary line 视觉对比度极低(叠加放大 P0)

**位置**:`htdocs/luci-static/design-x/css/features.css:549-557`

```css
.design-tile-spark-line-secondary {
    stroke: var(--color-accent-500);    /* 设计绿 */
    stroke-width: 1.5;                   /* 比 primary 的 2 细 */
    stroke-dasharray: 3 2;               /* 短 dash */
    opacity: 0.55;                       /* 半透明 */
}
```

加上:
- `<svg preserveAspectRatio="none" viewBox="0 0 220 40">` 横向拉伸,纵向不拉伸
- `stroke-dasharray` 是 viewBox 单位 → 横向拉伸后 dash 段实际尺寸不均(横向被拉,纵向不变)
- 上传时 tx 高 → secondary 线画在 viewBox 顶部 y ≈ 3px → **几乎贴 tile 内边距上沿**
- 顶部**没有 fill 区域**做对比背景(fill 只覆盖 primary 下方到 viewBox 底)
- → 浅色 tile 背景(`--color-surface-1`,接近白)上的 0.55 opacity 绿色 dash
  → 视觉对比度极低,接近不可读

上传一停,tx 跌向 0 → 跌穿 fill 覆盖的下半区域(0.18 opacity 浅绿) →
同样的 dash 突然**有了背景对比** → 这就是用户看到的"突然出现"。

**P0 + P1 是叠加效应**:
- ring 干净(无历史尖峰): tx 画在它该在的位置,但因 P1 视觉不显
- ring 有 rx 历史尖峰: tx 被 P0 压到底部,**且**因 P1 半透明,与底部 fill 视觉混杂
- → 两种情况下 secondary 都"看不到"

### 🟢 P2 — empty-state 检查只看 primary,会误清 secondary — ✅ Round 45 Step 236

**位置**(改前):`sparkline.js:272-287`

```js
if (!linePath) {           // linePath 来自 primary (rx) ring.path()
    /* ... 重置 primary 到 dashed baseline ... */
    if (lineSecondaryEl) lineSecondaryEl.setAttribute('d', '');  // 清空 tx
    return;
}
```

理论上:如果 rx ring `< 2 samples` 但 tx ring 已有数据,secondary 会被误清。
实际上:rx 和 tx 由同一 emit 一起 push (`sparkline.js:548-549`),两 ring 长度同步。
这是 **latent bug**,被当前的对称推送掩盖。

**Step 236 (Round 45)** ship 了 §五 Fix-4 的修法:
1. linePath + secPath 同时 precompute
2. empty-state 改成 `if (!linePath && !secPath)`
3. 拆出 primary-empty / primary-curve 两分支,让 primary 在 secondary 有数据时仍然能正确退回 dashed baseline,而 secondary 独立渲染
4. 单 ring tile(CPU/Mem/Temp)行为不变(ringSecondary undefined → secPath = '' → 等价旧路径)

### 🟢 P2 — `fmtBpsSplit` 在两处定义且逐行相同

`wan-hero.js:17-23` 和 `sparkline.js:423-429`。Step 43 注释说
"5-line helper isn't worth a module boundary",但 Round 36 Step 137 的单位
rename (`rxBps → rxBitsPerSec`) 已经需要**两处同时改**,漂移过一次。

修法:提取到 `design-x/util.js`。低优先级。

---

## 四、被否决的方案 — 为什么不走这条路

### ❌ Chrome-Claude 推荐的"镜像布局"(↑ 朝上 / ↓ 朝下)

**反对理由**:
1. **信息密度减半**:40px viewBox 中线分割后,每条线只剩 20px 可画。dasharray + opacity 的
   secondary 在 20px 高度近乎不可读
2. **空间利用不均**:住宅 WAN 流量严重不对称(下载 >> 上传)。镜像版本中**上半永远空旷,下半永远满**,
   浪费一半画布
3. **跟其他 tile 视觉脱节**:CPU/Mem/Temp 都是单线常规 sparkline,WAN 突然镜像会破坏
   design-tile-grid 的视觉一致性
4. **改动量大**:需要重写 makeTile()、renderTileSpark()、CSS 卡片可能要重定高度。
   ROI 远低于 Fix-1+2+3 的组合

### ❌ Chrome-Claude 推荐的 `mode: 'bounded' | 'rate' | 'bipolar'` 抽象

**反对理由**:
1. **抽象时机过早**:目前只有 WAN 一个 rate 指标。未来要加磁盘 IOPS / 网卡 pps 再抽不迟
2. **YAGNI 风险**:`bipolar` 是为镜像服务的,但镜像被否决 → 留下 unused enum
3. **替代方案存在**:Fix-1 的"不传 sharedHi 就 auto-scale" 已经是 implicit mode switch,
   不需要显式参数

### ❌ "把 sharedHi 改成只在两 ring 当前值相近时启用"

提案:`if (max(rxNow, txNow) > min(rxNow, txNow) * 0.5) sharedHi = ...`

**反对理由**:
1. **行为不可预期**:同一组数据,显示比例随两 ring 的瞬时关系切换
2. **edge case 不收敛**:阈值选 0.5?0.1?讲不清什么时候该共享什么时候不
3. **不解决根本问题**:历史尖峰污染依然存在,只是触发条件变窄

### ❌ "Peak 文字加到 footer 但保留 sharedHi"

提案:做 Fix-3 不做 Fix-1。

**反对理由**:Fix-3 是 Fix-1 的**信息补偿**,前提是 Fix-1 已经把视觉量级关系拿掉了。
保留 sharedHi 的话,视觉本来就在试图传达量级,加 Peak 文字反而**冗余且互相矛盾**
(图说 tx 贴底,文说 tx peak 800 Kbps,用户不知道信哪个)。

---

## 五、修复方案 — 推荐(最小有效)

按 ROI 排序。**建议合并到 Round 44 polish ship,不单独走**。

> **2026-05-25 收尾状态(Step 236 之后):全部 Fix 已 ship。**
> - Fix-1 (P0 sharedHi removal) → **Round 44 Step 205** ✅
> - Fix-2 (P1 contrast bump) → **Round 44 Step 205** ✅ (实际颜色升级版:Step 206 改成 hue separation `--color-info` 蓝色,比文档建议的同色 + 透明度更强)
> - Fix-3 (Peak meta line) → **Round 44 Step 206** ✅
> - Fix-4 (empty-state two-ring guard) → **Round 45 Step 236** ✅ (落后 Fix-1 半轮 ship,latent bug 修了)
> - Fix-5 (fmtBpsSplit 抽 util) → **未做**(P3,优先级最低,功能性零影响)
>
> 全程跨 Round 44 + 45,**实际 atomic 4 步**(Step 205 + 206 + 236;Fix-4 被 Step 236 单独 ship 而非合并 Fix-1)。原计划"3 atomic Steps,~2.5h"实际是分阶段 ship,但合计代码改动量符合预估。

### Fix-1:删除 sharedHi 跨 ring 同步,两线独立 auto-scale ⭐ P0 — ✅ Round 44 Step 205

**改动**:`sparkline.js:248-309` 的 `renderTileSpark()`

```js
function renderTileSpark(tileEl, ring, ringSecondary) {
    var lineEl          = tileEl.querySelector('.design-tile-spark-line');
    var fillEl          = tileEl.querySelector('.design-tile-spark-fill');
    var lineSecondaryEl = tileEl.querySelector('.design-tile-spark-line-secondary');

    var linePath = ring.path(SPARK_W, SPARK_H);  // ← 不传 sharedHi
    var secPath  = ringSecondary ? ringSecondary.path(SPARK_W, SPARK_H) : '';

    // empty-state: 两 ring 都缺数据才触发(Fix-4 一起做)
    if (!linePath && !secPath) {
        var baseY = (SPARK_H / 2).toFixed(1);
        lineEl.setAttribute('d', 'M 0,' + baseY + ' L ' + SPARK_W + ',' + baseY);
        lineEl.classList.add('design-tile-spark-line-empty');
        lineEl.setAttribute('stroke', '#a1a1aa');
        lineEl.setAttribute('stroke-width', '1.5');
        lineEl.setAttribute('stroke-dasharray', '4 4');
        lineEl.setAttribute('opacity', '0.85');
        fillEl.setAttribute('d', '');
        if (lineSecondaryEl) lineSecondaryEl.setAttribute('d', '');
        return;
    }

    // primary
    if (linePath) {
        lineEl.classList.remove('design-tile-spark-line-empty');
        lineEl.setAttribute('d', linePath);
        lineEl.setAttribute('stroke', '#10b981');
        lineEl.setAttribute('stroke-width', '2');
        lineEl.removeAttribute('stroke-dasharray');
        lineEl.removeAttribute('opacity');
        fillEl.setAttribute('d', linePath + ' L' + SPARK_W + ',' + SPARK_H +
                                  ' L0,' + SPARK_H + ' Z');
    } else {
        lineEl.setAttribute('d', '');
        fillEl.setAttribute('d', '');
    }

    // secondary
    if (lineSecondaryEl) {
        lineSecondaryEl.setAttribute('d', secPath || '');
    }
}
```

**`MetricRing.prototype.path()` 的第三参数 `sharedHi` 保留不删**,backward compat
(CPU/Mem/Temp 调用都不传第三参,行为不变)。**Step 139 注释里关于 sharedHi 的用法说明应同步更新**,
标记为"已弃用,WAN tile 不再使用,保留供未来场景"。

**Trade-off**:rx 和 tx 在视觉上不再可直接比较 —— 10 Mbps 下载和 100 Kbps 上传都看起来
"各自填满轨道"。**用户必须读 meta 文字才知道幅度**。

**为什么接受这个 trade-off**:
1. 40px 高 viewBox 容不下"既保留相对比例又两线都可读"—— 物理上必输一项
2. 当前实现是"两项都输"(P0 压扁 + P1 看不见)
3. 改完是"相对比例输,两线可读" → 严格优于现状
4. 量级信息从 meta line 补回(Fix-3)

### Fix-2:secondary line 视觉对比度补丁 ⭐ P1 — ✅ Round 44 Steps 205 + 206

**改动**:`htdocs/luci-static/design-x/css/features.css:549-557`

```css
.design-tile-spark-line-secondary {
    stroke: var(--color-accent-500);
    stroke-width: 2;                  /* 1.5 → 2,与 primary 同级 */
    stroke-dasharray: 5 3;            /* 3 2 → 5 3,稀疏 + 单 dash 更长,横拉后仍清晰 */
    opacity: 0.85;                    /* 0.55 → 0.85,从近不可读回到读得到 */
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
}
```

**理由**:
- opacity 0.55 在浅 `--color-surface-1` 上 WCAG 对比度约 1.5:1(远低于 AA 3:1)。
  0.85 提到约 2-2.5:1。**仍低于 AA 文字要求,但 sparkline 属图形元素 + 配合 primary
  做主要信号,可接受**
- stroke-width 提到 2 跟 primary 相同 —— **主次差异完全由 dashed vs solid 承担**,
  不再用粗细做次级
- dasharray 5 3 比 3 2 稀疏,viewBox 220 单位横拉到 ~340px 屏幕宽度时,
  每 dash 屏幕 ~7.7px,gap ~4.6px → 视觉密度合理(目测)

**为什么不更激进**(opacity 1.0, stroke-width 3):
- secondary **应该**与 primary 视觉有区分(虚 vs 实是核心区分手段)
- 加得过重会让两条线"等权重",失去主次,信息架构反而混乱

### Fix-3:meta line 显示双向 peak(信息补偿) ⭐ P1 — ✅ Round 44 Step 206

**改动**:`sparkline.js:556-575` 的 `onWanStats` meta 计算

```js
// 双向 peak,在 2-min 滑动窗口内
var rxPeak = 0, txPeak = 0;
for (var i = 0; i < this.rings.netRx.data.length; i++)
    if (this.rings.netRx.data[i] > rxPeak) rxPeak = this.rings.netRx.data[i];
for (var k = 0; k < this.rings.netTx.data.length; k++)
    if (this.rings.netTx.data[k] > txPeak) txPeak = this.rings.netTx.data[k];

var peakStr = '';
if (rxPeak > 0 || txPeak > 0) {
    var rp = fmtBpsSplit(rxPeak);
    var tp = fmtBpsSplit(txPeak);
    // Format: "eth1 · Peak ↓3.4Mbps ↑850Kbps"
    peakStr = ' · ' + _('Peak') + ' ↓' + rp.num + rp.unit +
              ' ↑' + tp.num + tp.unit;
}

setTile(this.tileNet, {
    // ... 其他 prefix/num/unit 不变 ...
    meta: (data.deviceName || '') + peakStr
});
```

**为什么必须做**:补偿 Fix-1 的视觉信息丢失。两线 auto-scale 后,用户无法直接从图形看
"↓ 比 ↑ 大 4 倍"这种相对量级。Peak 文字把这个**量化信息**回填。

### Fix-4:empty-state 改成"两 ring 都缺才触发" — ✅ Round 45 Step 236

**实际 ship 历史**:Fix-1(Step 205)的 sharedHi 删除已经把 secondary 改成独立 auto-scale,但 empty-state 检查仍是单 ring(只看 primary 的 `!linePath`)。该 path 在生产路径上从未触发(rx/tx 由 wan-stats 同一 emit push,长度同步),但 **latent**。Step 236 把检查改成"两 ring 都缺数据才进 empty state",同时拆出 (primary 空 + secondary 有数据) 分支让 primary 显示 dashed baseline 而不影响 secondary 渲染。

`sparkline.js:284-326` 改动 ~30 LOC 净增加(含三个 Step 注释 + 两段并存 path)。CPU/Mem/Temp 单 ring 调用方传 `undefined ringSecondary` → `secPath = ''` → 行为等价于 Step 236 之前(linePath 主导一切)。**Backward compat 严格保持**。

### Fix-5:`fmtBpsSplit` 抽到 util module ⭐ P3 — ⏸ 未做(Step 236 不含)

**改动**:新建 `htdocs/luci-static/resources/design-x/util.js`(~10 行),把 helper 搬过去。
wan-hero.js / sparkline.js 都 `'require design-x.util'`。

**不紧急**,**Round 45+ 配合其他清理一起做**。本 doc 范围内只标注,不实施。

---

## 六、Verification 协议(改前 + 改后必须跑)

### 改之前的 ground-truth 验证(Chrome-Claude 协助)

**Step 1 — 确认 secondary path 存在**(纠正 Chrome-Claude Bug #2 的 false alarm):
```js
var paths = document.querySelectorAll('#design-tile-net path');
console.log('paths count:', paths.length);                            // 应为 3
console.log('classes:', Array.from(paths).map(p => p.getAttribute('class')));
// 期望:["design-tile-spark-fill",
//       "design-tile-spark-line ...",
//       "design-tile-spark-line-secondary"]

var sec = document.querySelector('.design-tile-spark-line-secondary');
console.log('secondary d:', sec ? sec.getAttribute('d') : 'MISSING');
// 期望:非空 path string (类似 "M 0,3.0 L 3.7,3.1 ...") 或 ""(empty-state)
```

**Step 2 — 确认 d 在被更新**(纠正 Chrome-Claude Bug #3 的 observer 配错):
```js
var sec = document.querySelector('.design-tile-spark-line-secondary');
var obs = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
        console.log('d changed:', sec.getAttribute('d').substring(0, 60));
    });
});
obs.observe(sec, { attributes: true, attributeFilter: ['d'] });  // ← 这两个必须显式
// 等 10 秒,应看到 ~5 次 d change (每 2s 一次 onWanStats trigger)
// 如果 0 次 → renderTileSpark 真没在调用 → 不是 observer 配错,是别的 bug
```

**Step 3 — 触发 P0 bug 重现**:
1. 先做一次大下载(e.g. 100 MB file via wget on a connected device)制造 rx 尖峰
2. 等下载结束,看 footer Peak 显示约几十 Mbps
3. **立刻**开始一次小上传(iCloud sync / git push / 手机照片备份,几百 KB/s)
4. 观察 secondary 线应明显贴底(被 rxHi 压扁) — 这是 P0 症状
5. 等 2 分钟让 rx 尖峰滑出窗口(footer Peak 数字应同步减小)
6. 观察 secondary 线应回到合理位置

**Step 4 — 触发 P1 视觉对比度 bug**:
1. 在干净 ring (无历史尖峰) 状态下做一次稳定的中等上传(e.g. iCloud 同步,1-3 Mbps)
2. 观察 secondary 线**画在合理高度**(viewBox 中上部),但 opacity 0.55 + 浅背景下
   视觉极弱
3. 临时改 secondary 的 opacity 到 1.0(DevTools Style 面板)→ 验证线确实在画

### 改完后验证

**Step 5 — Fix-1 验证**:重复 Step 3 → secondary 线应不再被 rx 尖峰压扁
**Step 6 — Fix-2 验证**:重复 Step 4 → secondary 线视觉清晰度提升
**Step 7 — Fix-3 验证**:meta line 显示 `Peak ↓X ↑Y` 双向数值
**Step 8 — 回归**:CPU/Mem/Temp 三 tile 视觉无变化(它们不传 ringSecondary,
   走单线分支;path() 不传 sharedHi 等价于之前传 null,行为完全不变)
**Step 9 — Hero 卡回归**:WAN Hero 顶部 "↑/↓" 数字行无变化(那个卡只 subscribe
   wan-stats,跟 sparkline 无关)

---

## 七、不要做的事

1. **不要单独 ship 这套 fix**。本 doc 写于 Round 43 末尾,Round 44 大主题是
   per-host bandwidth conntrack 重写。这套 polish 合进 Round 44 ship 更经济
   (one round, one journal entry, one verify pass)
2. **不要在 §六 Step 1-2 验证之前就改 setAttribute('d') 路径**。Chrome-Claude
   Bug #3 极可能是 observer 配错,但需要先证实
3. **不要把 secondary 的 dasharray 改成实线**。dashed vs solid 是 primary/secondary
   的核心视觉区分;改实线 = 退化为"两条难分辨的实线"
4. **不要给 secondary 加 `transition: stroke-dashoffset`** 之类的动画。sparkline
   每 2s 全量重画 `d` 属性,动画会持续触发,CPU/GPU 浪费且视觉抖动
5. **不要给 secondary 也加 fill 区域**。dual fill 在 40px viewBox 里会让两条线
   的覆盖区域互相重叠,视觉混乱(参 §四"镜像布局"否决理由 §1)
6. **不要顺手"清理"`MetricRing.prototype.path()` 第三参数 sharedHi 的整段逻辑**。
   保留供未来场景(比如真要加 disk read/write 双值 tile 且**对称**时)。删除是 YAGNI 的反面
7. **不要触碰 `wan-stats.js`**。它的 32-bit wrap 处理 (`parseInt` JS 端) /
   counter wrap 跳样本逻辑 (Step 50 注释) / × 8 单位 (Step 137) 都已经
   battle-tested,本次 fix 不涉及数据层

---

## 八、风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Fix-1 让 rx/tx 视觉量级关系丢失 | 100% | 中 | Fix-3 用 meta line 文字补偿 |
| Fix-2 opacity 0.85 后 secondary 看起来"太重",失去 secondary 语义 | 20% | 低 | 上线后看实际表现,不行回调到 0.7 |
| dasharray 5 3 在某些浏览器渲染异常 | 5% | 低 | Step 80 SVG namespace fix 后,Chrome/Safari 16+/Firefox 全行;< 16 已退役支持 |
| 改 renderTileSpark 影响 CPU/Mem/Temp tile | <1% | 高 | 它们调 `renderTileSpark(tile, ring)` 不传 ringSecondary,走 `if (!ringSecondary)` 分支(secPath 计算前置 if 守卫),严格等价于之前 |
| 删 sharedHi 后未来要加 disk IOPS 双值再用上,要重写 | 30% | 低 | 真到那时再说,先 YAGNI。path() 第三参保留 |
| Chrome-Claude 的 Bug #1 Peak 实际是另一个 bug | 10% | 中 | §六 Step 1-2 的实证验证会暴露 —— 如果 secondary path 实际不存在,本 doc 整个判断需重做 |

---

## 九、估时

| 任务 | 行数 | 估时 | 风险 |
|---|---|---|---|
| §六 Step 1-4 ground-truth 验证(Chrome-Claude 协助) | - | 30 min | 中 |
| Fix-1 (sharedHi 删 + empty-state 改) | ~15 行净变 | 30 min | 低 |
| Fix-2 (CSS 视觉) | 3 行 | 10 min | 低 |
| Fix-3 (peak 双向 meta) | ~15 行 | 20 min | 低 |
| Step 注释/journal 写作 | - | 30 min | 低 |
| §六 Step 5-9 改后验证 | - | 30 min | 中 |
| **合计**(不含 Fix-5) | **~33 行** | **~2.5h** | **低** |

**Fix-5 (util module) 延后到 Round 45+ 独立 ship**,不算入本次估时。

---

## 十、推荐时序

1. **现在**(Round 43 收尾前):用户在 router 上跑 §六 Step 1-2 (5 min)。
   两个目的:**(a)** 校验 Chrome-Claude Bug #2/#3 是否 false alarm(本 doc 强烈
   预测是),**(b)** 锁定 §三 P0 判断是否准
2. **同时**(独立线程):per-host bandwidth conntrack report 等待回执
3. **conntrack report 回来后**,开 Round 44 总 polish 轮,把:
   - per-host bandwidth daemon 重写(主 work,Round 44 主线)
   - WAN tile 本 doc 的 Fix-1 + Fix-2 + Fix-3(辅 work,3 个 Step)
   - sparkline.js 注释更新(WAN 不再使用 sharedHi,标注 deprecation)
   一起 ship。每 Fix 一 Step,one commit each,符合项目原子性原则
4. Round 44 收尾做完整 verify pass(§六 Step 5-9)
5. Round 45+ 再考虑 Fix-5 util module 抽取

---

## 十一、引用

- **Round 36 Step 137** — `rxBps → rxBitsPerSec` 单位 rename,`× 8 at source`
  (Chrome-Claude 当时实测 837 KB/s 显示 "839.8 Kbps",指认了单位混淆)
- **Round 36 Step 138** — `↑/↓` 数据方向 与 trend pill `▲/▼` 趋势方向区分
  (Step 139 dual-value 设计的前置)
- **Round 37 Step 139** — dual-value tile 引入(本 doc 的 P0 sharedHi 起点)
- **Step 80 / Round 13** — `svgEl()` SVG namespace fix(`createElementNS`),
  为本次 fix 提供正确的 path 元素操作基础
- **Step 89 / Round 15** — `MetricRing.avg()` 加入,sparkline 模板成型
- **doc/luci-theme-toolbox.md §13** — Tooltip vs inline 决策框架,支持本 doc
  Fix-3 选择 inline meta line 而非 hover tooltip 显示双向 peak

---

**文档负责人**:下次接手 Round 44 polish 的 AI session,**请先重读 §六
verification 协议,再动代码**。本 doc 的整个判断架构以"§三 P0 判断成立"为前提,
若 §六 Step 1-2 校验时发现 secondary path 在 DOM 中实际**不存在**(而不只是 d=""),
说明本 doc 的故事错了,需要重新立案。
