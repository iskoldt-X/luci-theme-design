# MAC Vendor Lookup — 落地计划

> 创建:2026-05-24,Round 43 进行中。
> 状态:**✅ 全部 SHIPPED & VERIFIED (2026-05-25, Round 45 Step 238)**。
>   - Phase 1 verification:2026-05-24(确认 Phase 2A unreachable,锁 Phase 2B)
>   - Phase 2B 实施:Round 44 Step 204(vendor.js 模块 + devices.js 集成 + NOTICE 文件)
>   - Build CI:Round 44 Step 204(`.github/workflows/build.yml` 拉 Wireshark manuf → gzip → ~330 KB)
>   - Live verification:Round 45 Step 238(Chrome-Claude 4/4 PASS)— **见 §零**
> 触发:LAN Clients 卡 expand-row Vendor 字段长期是 `Unknown` placeholder
> (Step 148 加上 MAC 列后这个 placeholder 更显眼)
> 上游研究:`doc/OpenWrtMACVendorLookupArchitecture.md`(deep research 报告,
> Phase 1 验证已确认其 PR #7931 / ufp-neigh 路径在 ImmortalWrt 24.10 上 unreachable,
> 见 §一.五 验证结果)

---

## 〇、Round 45 Step 238 verification(2026-05-25)

Chrome-Claude 在用户实机 router 上跑了 4-check audit,全 PASS:

| Check | 结果 | 实测数据 |
|---|---|---|
| 1. Data file | ✅ | `GET /luci-static/design-x/data/oui.json.gz` → 200,Content-Length **337,601 bytes (~330 KB)**。lazy fetch(首次 lookup 才请求,page load 时不拉)。 |
| 2. Lookup call | ✅ | `vendor.lookup('3C:22:FB:00:00:00', null)` → `"Apple"`。cold-start 95 ms(fetch + DecompressionStream + JSON parse + map lookup)。 |
| 3. UI integration | ✅ | 13 行 spot check,12 行显示真实厂商名:ProxmoxServe / TpLinkTechno / QingpingElec / Espressif / QingdaoIntel / Apple / 等。1 个 Unknown vendor(`BC:23:23`,Wireshark manuf 数据盘里没有 — 上游数据缺口,**不是 pipeline 失败**)。LAA prefix(`2A:`,`B2:`,`AE:`,`96:`,`22:`,`3A:`)→ `"Private (randomized)"` 全部正确。 |
| 4. Console health | ✅ | 60 秒观察窗口,**零** errors / warnings / unhandled rejections。无 vendor / oui / DecompressionStream / Response 相关报错。 |

**实际渲染格式**:`"VendorShortName (XX:XX:XX)"`(parens + 空格分隔),如 `"ProxmoxServe (BC:24:11)"`。原计划用 `" · "` 分隔(`"Apple · 3C:22:FB"`);**propose-then-reject**,parens 也清晰,不为美学差异 churn。

**Runtime characteristics**:
- **Lazy fetch**:`oui.json.gz` 不在 page load 时请求,首个 `lookup()` 时触发。
- **Singleton cache**:`L.require('design-x.vendor')` 跨 LuCI 导航返回同一实例,subsequent lookup 是 O(1) map hit。
- **Reset 路径**:`vendor.__reset__()` 清掉 in-memory cache。

**数据缺口**:`BC:23:23` 在用户实机上有一台设备命中,但 Wireshark `manuf` 数据 shard 里没有此 OUI。**上游数据限制,我们继承**。Wireshark `manuf` 是 community-curated,coverage 大约 IEEE OUI registry 的 70-80%(MA-L only,不含 MA-M / MA-S — 那俩需要的 28-bit / 36-bit 解析跟 build.yml 的 24-bit shard 不兼容,也是个 trade-off)。

**Net result**:Pipeline 干净 ship,0 代码改动,Step 238 是纯验证 + 文档收尾 step。`doc/backlog.md` 的"MAC vendor lookup"条目从 "Round 45 main work, ~4-5h" 划掉为 ✅ SHIPPED & VERIFIED。

---

## 一、用户决策(2026-05-24)

经 deep research 报告评估 + 4 方案对比后,用户拍板:

1. **先验证** ImmortalWrt 24.10 现状,再选实施路径
2. **如果 upstream 已经够用** → 走 Phase 2A(theme 只消费 `host_hints.vendor`)
3. **如果 upstream 不够用** → 走 Phase 2B(**embed in theme,不走独立数据包**)
4. **明确拒绝** report 力推的"独立 `luci-app-mac-vendor-data` 包"方案

> 用户原话:**"我不在乎解耦,我只在乎效果"**

这条决策值得展开。Report 的 MVC-clean 论证(arp-scan vs arp-scan-database 先例 +
OpenWrt 解耦哲学)技术上正确,但代价是**双 IPK 部署 + 第二个包的独立维护**。
对一个**单人维护的住宅路由 theme** 来说,这个 trade-off **不划算**——简单的单 IPK
ship 在用户体验上严格优于"装 theme 然后还要装一个 data 包才生效"。所以 Phase 2B
落 `htdocs/luci-static/design-x/data/oui.json.gz` 进 theme 自身。

LAA / Multicast bit 检测**在任何路径下都做**(JS 5 行,不需要数据库)。

---

## 一.五、Phase 1 验证结果(2026-05-24,用户在 router 上执行)

**全部 4 个 verification step 完成,结论明确:Phase 2A 不可行,锁定 Phase 2B。**

### 实测发现

| Verification | Expected (for 2A) | Actual | 结论 |
|---|---|---|---|
| `ubus call luci-rpc getHostHints` 返回 vendor 字段 | host[mac].vendor 存在且非空 | **不存在** — 每条 entry 只有 `ipaddrs / ip6addrs / name`(可选) | 2A 数据源缺失 |
| `ps w \| grep ufp` 找到 daemon | ufp-neigh 进程在跑 | **空输出** — daemon 不存在 | 2A 解析层缺失 |
| `opkg list-installed \| grep ufp` | ufp 包已装 | **未装**,只有 `luci-mod-status - 26.136.30825~c9cbaea` | 2A 软件栈缺失 |
| LuCI Software 页 filter "ufp" | 找到可装的包 | **No packages matching "ufp"** | **2A 结构上 unreachable** |

最后一条最关键:`ufp` 包不在 ImmortalWrt 24.10 的 feeds 里——不是"没装",是**装不上**。
即使我们让用户运行 `opkg install ufp` 也会失败。Report 推论的 PR #7931 mechanism
即使在 OpenWrt master 真存在,**也没 backport 到我们的目标发行版**。

### 用户实际设备的 LAA 分布(从 getHostHints 输出抽样 9 条)

| MAC | bit 0x02 | 分类 | 预期显示 |
|---|---|---|---|
| `00:23:57:6C:90:49` | 0 | UAA | 查 DB → "Pegatron" |
| `00:E0:4C:6A:73:88` (truenas) | 0 | UAA | 查 DB → "Realtek Semiconductor" |
| `02:00:00:91:22:91` | 1 | LAA | "Private (randomized)" |
| `02:42:0D:AC:D3:15` | 1 | LAA (Docker) | "Private (randomized)" |
| `10:91:A8:4F:1D:18` (W120) | 0 | UAA | 查 DB → "Wingtech Group" |
| `22:FF:84:E2:7D:C1` (Watch) | 1 | LAA | "Private (randomized)" |
| `3A:E0:FC:D2:C0:F8` (iPad) | 1 | LAA | "Private (randomized)" |
| `4C:10:D5:2A:E5:A0` | 0 | UAA | 查 DB |
| `58:2D:34:70:CA:7A` | 0 | UAA (Apple) | 查 DB → "Apple" |

**4/9 = 44% LAA**,跟 report §1 的 35-45% 估算吻合。这部分**仅靠 bit 检测 5 行
JS 就解决**,0 KB 数据投资。剩余 5/9 UAA 需要 manuf DB,这是 ~150 KB 数据投资换
回来的价值,正负反比合理。

### Phase 2A 章节(§三)状态

**Deprecated for current deployment**,但**保留**作 history/contingency:
- 未来若 ImmortalWrt 把 ufp 加入 feeds + 默认启用,我们的 vendor.js 已经在
  lookup() 入口检测 hostHintVendor 参数,**届时切回 hybrid 模式只需 0 行代码改动**
- §三 的 `resolveVendor(mac, hostHint)` 函数签名其实就是这个 future-proof 设计

---

## 二、Phase 1 — Verification(已完成,仅作历史参考)

进 Round 44/45 之前需要在 router 上跑完这一组验证。结果决定 Phase 2A vs 2B。

### Step 1 — 验证 host_hints 是否已有 vendor 字段

```bash
ssh luci-router 'ubus call luci-rpc getHostHints' | head -80
```

观察每个 host entry 是否包含 `vendor` 字段:
- ✅ 有 + 非空:`{ "AA:BB:CC:..": { "ipaddrs": [...], "name": "iPhone", "vendor": "Apple, Inc.", ... } }` → **Phase 2A**
- ❌ 无 / 总是空字符串:只有 `ipaddrs / name / hostname` → **Phase 2B**

### Step 2 — 验证 ufp-neigh daemon 存在

```bash
ssh luci-router 'ps w | grep -E "ufp|neigh"'
ssh luci-router 'opkg list-installed | grep -E "ufp|luci-mod-status"'
ssh luci-router 'ls /usr/share/ /usr/share/ieee* 2>&1 | grep -i "oui\|mac"'
```

如果 `ufp-neigh` 在跑 + `/usr/share/ieee-oui.txt` 存在,Phase 2A 可行性确认。

### Step 3 — 验证 report 引用的 commit 真实性

在浏览器打开:
- https://github.com/openwrt/luci/pull/7931
- https://github.com/openwrt/luci/commit/70b7176

如果 404 或内容不符 → report 在这一点上是 LLM 幻觉,但 Phase 2B 的路径**仍然成立**
(不依赖 upstream),只是 Phase 2A 的可能性消失。

### Step 4 — 用已知设备试 vendor 解析

如果 Step 1 找到 vendor 字段,挑一个已知 OUI 的设备验证准确性:
- iPhone 的 MAC 前 3 字节(很多 Apple OUI: F0:B3:EC / 8C:85:90 / ...)
- 看 host_hints 返回的 vendor 字符串是否合理
- 如果字段存在但**永远是空字符串**,等同于"无效",走 Phase 2B

### 决策表

| Step 1 vendor 字段 | Step 4 准确性 | 结论 |
|---|---|---|
| 有 + 准确 | iPhone → Apple,Samsung → Samsung | **Phase 2A** |
| 有 + 字符串怪 | iPhone → "0xff" or "" | **Phase 2B**(upstream 不可信) |
| 无 | n/a | **Phase 2B** |

---

## 三、Phase 2A — Upstream-only(Phase 1 验证通过时)

**前提**:Phase 1 决策表导向 2A。**最小工作量**。

### 改动点

`htdocs/luci-static/resources/design-x/devices.js`(LAN Clients render,
expand-row vendor 字段)。

```js
function resolveVendor(mac, hostHint) {
    // Bit checks 第一优先 — 不管 upstream 有没有 vendor,LAA/Multicast 都
    // 应该正确标识,而不是显示 "Apple" 给一个 randomized 的 iPhone MAC
    var octet1 = parseInt(mac.substring(0, 2), 16);
    if (!isFinite(octet1))     return _('Unknown');
    if (octet1 & 0x01)         return _('Multicast');
    if (octet1 & 0x02)         return _('Private (randomized)');

    // UAA → 信 upstream
    if (hostHint && hostHint.vendor) return hostHint.vendor;
    return _('Unknown');
}
```

调用点:`document.querySelector('.vendor-cell').textContent = resolveVendor(mac, hint);`

### 大小影响

**0 KB**。Theme 只多 ~10 行 JS。

### Trade-off

- ImmortalWrt 24.10 GA(2024-Q4)几乎肯定**没有**这个 feature
- 24.10-SNAPSHOT(rolling)可能 backport 了
- 如果用户运行的是 GA → 所有设备显示 "Unknown" + LAA 设备显示 "Private (randomized)"
- 这跟现状(Unknown 占满)相比仍是改进(LAA 标识至少做对了),但**不能解决 vendor 识别的主要诉求**

---

## 四、Phase 2B — Embed in theme(Phase 1 验证失败时)

**前提**:Phase 1 决策表导向 2B。**用户决策路径**。

### 数据源

- **源**:https://www.wireshark.org/download/automated/data/manuf (GPL-2.0,community-curated)
- **范围**:**24-bit MA-L only**。跳过 28-bit MA-M / 36-bit MA-S
  - Report 估 +30% 大小换 <5% 覆盖,marginal value 不值
- **实测大小**(Round 44 Step 202, 2026-05-24): 39 223 MA-L 条目 raw ~853 KB
  → **gzip -9 → ~332 KB**。Build CI ceiling 设为 450 KB(40% safety margin
  to catch future bloat / MA-M leakage),floor 250 KB(silent-fetch-fail
  protection)。**doc 原估的 150 KB 偏乐观** —— short name 12 字符 padded
  string 熵低,gzip 压不到 entropy-bound 那么紧。332 KB 仍在 IPK 接受范围。

### Build CI 集成

加 step 到 `.github/workflows/build.yml`(或新建专门 step):

```yaml
- name: Fetch + transform OUI database
  run: |
      mkdir -p htdocs/luci-static/design-x/data
      curl -fsSL --max-time 60 \
          https://www.wireshark.org/download/automated/data/manuf \
          -o /tmp/manuf
      awk '
          # 严格只取 24-bit MA-L (3 字节十六进制 + tab,无 mask)
          /^[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]\t/ {
              prefix = toupper($1)
              gsub(":", "", prefix)
              # 短名是 tab 分隔后第 2 列;长名 $3 跳过
              gsub(/[\\"]/, "", $2)
              if (length($2) > 0) entries[prefix] = $2
          }
          END {
              printf "{"
              first = 1
              for (p in entries) {
                  if (!first) printf ","
                  printf "\"%s\":\"%s\"", p, entries[p]
                  first = 0
              }
              printf "}"
          }
      ' /tmp/manuf | gzip -9 > htdocs/luci-static/design-x/data/oui.json.gz

      # Sanity check
      SIZE=$(stat -c%s htdocs/luci-static/design-x/data/oui.json.gz)
      echo "oui.json.gz size: $SIZE bytes"
      if [ "$SIZE" -gt 204800 ]; then  # 200 KB hard limit
          echo "ERROR: oui.json.gz exceeded 200 KB budget"
          exit 1
      fi
      if [ "$SIZE" -lt 80000 ]; then  # 80 KB sanity floor
          echo "ERROR: oui.json.gz suspiciously small — fetch may have failed"
          exit 1
      fi
```

**关键约束**:
- `oui.json.gz` **不 commit 到 git** —— Build CI 生成,IPK 阶段进 staging
- `.gitignore` 加 `htdocs/luci-static/design-x/data/oui.json.gz`
- 上下限 size check(200 KB 上限 + 80 KB 下限)防 silent failure

### Theme 内 vendor.js 模块

新建 `htdocs/luci-static/resources/design-x/vendor.js`(~80 行):

```js
'use strict';
'require baseclass';

var VENDOR_DATA_URL = '/luci-static/design-x/data/oui.json.gz';
var SESSION_KEY     = 'design-x.oui-map';
var _mapPromise = null;  // singleton

function bitsToCategory(mac) {
    var octet1 = parseInt(mac.substring(0, 2), 16);
    if (!isFinite(octet1)) return 'invalid';
    if (octet1 & 0x01)     return 'multicast';
    if (octet1 & 0x02)     return 'laa';
    return 'uaa';
}

function loadMap() {
    if (_mapPromise) return _mapPromise;

    // sessionStorage 跳过解压
    try {
        var cached = sessionStorage.getItem(SESSION_KEY);
        if (cached) {
            _mapPromise = Promise.resolve(JSON.parse(cached));
            return _mapPromise;
        }
    } catch (e) { /* QuotaExceeded / disabled storage,fall through */ }

    // 老浏览器 fallback — 不解压,所有 UAA 显示 "Unknown vendor"
    // Safari < 16.4 / Firefox < 113 / Chrome < 80 占比 < 2%
    if (typeof DecompressionStream === 'undefined') {
        _mapPromise = Promise.resolve({});
        return _mapPromise;
    }

    _mapPromise = fetch(VENDOR_DATA_URL).then(function (res) {
        if (!res.ok) throw new Error('vendor DB fetch failed: ' + res.status);
        var ds = new DecompressionStream('gzip');
        return new Response(res.body.pipeThrough(ds)).text();
    }).then(function (text) {
        var map = JSON.parse(text);
        try { sessionStorage.setItem(SESSION_KEY, text); } catch (e) {}
        return map;
    }).catch(function (e) {
        if (console && console.warn) console.warn('vendor: load failed', e);
        return {};
    });

    return _mapPromise;
}

function lookupSync(mac, map, hostHintVendor) {
    var cat = bitsToCategory(mac);
    if (cat === 'multicast') return _('Multicast');
    if (cat === 'laa')       return _('Private (randomized)');
    if (cat === 'invalid')   return _('Unknown');

    // UAA — upstream 信 hostHint;否则查本地 map
    if (hostHintVendor) return hostHintVendor;
    var prefix = mac.substring(0, 8).toUpperCase().replace(/:/g, '');
    return (map && map[prefix]) ? map[prefix] : _('Unknown vendor');
}

return baseclass.extend({
    // Public: lookup(mac, hostHintVendor?) → Promise<string>
    lookup: function (mac, hostHintVendor) {
        var cat = bitsToCategory(mac);
        // Bit checks 不需要 map,先返
        if (cat === 'multicast') return Promise.resolve(_('Multicast'));
        if (cat === 'laa')       return Promise.resolve(_('Private (randomized)'));
        if (cat === 'invalid')   return Promise.resolve(_('Unknown'));
        if (hostHintVendor)      return Promise.resolve(hostHintVendor);

        return loadMap().then(function (map) {
            return lookupSync(mac, map, null);
        });
    },

    // Sync variant — use after preload() resolved
    lookupSync: lookupSync,

    // Preload — call once on Overview mount
    preload: loadMap
});
```

### LAN Clients 集成

`htdocs/luci-static/resources/design-x/devices.js`(expand-row 渲染):

```js
'require design-x.vendor';

// Overview mount 时(很早),提前 kick off 解压 — 后续 lookup 全部 cached
L.require('design-x.vendor').then(function (vendor) {
    vendor.preload();
});

// expand row 渲染:
function renderVendorCell(cellEl, mac, hostHint) {
    L.require('design-x.vendor').then(function (vendor) {
        vendor.lookup(mac, hostHint && hostHint.vendor).then(function (name) {
            cellEl.textContent = name;
        });
    });
}
```

### License compliance

新建 `root/usr/share/luci-theme-design-x/NOTICE`(安装到设备 + commit 到 repo):

```
luci-theme-design-x — vendor data attribution

The runtime asset htdocs/luci-static/design-x/data/oui.json.gz is generated
at build time from the Wireshark manuf database
(https://www.wireshark.org/download/automated/data/manuf) and is subject
to the GPL-2.0 license.

This data file and the Apache-2.0-licensed theme code coexist as "mere
aggregation" per FSF guidelines:
https://www.gnu.org/licenses/gpl-faq.html#MereAggregation

Each component retains its own license; combining them in this package
does not relicense either.
```

---

## 五、LAA 检测的 UX 细节

无论 Phase 2A 还是 2B,LAA 都做。LAA 内部可分三类:

| 来源 | 第一字节 bit | 期望 UX |
|---|---|---|
| iOS/Android/Windows 随机 MAC | `0x02` set,真随机 | `Private (randomized)` |
| Docker / KVM / VMware | `0x02` set,通常前缀 pattern(`52:54` KVM,`02:42` Docker,`00:50:56` VMware) | `Locally Administered`(理想)或 `Private (randomized)`(实际接受) |
| 用户手动设的 LAA 静态 | `0x02` set | 同上 |

**实用判定**:在 LAN 客户端语境下,iOS/Android 占绝大多数,**统一显示 `Private (randomized)`** 是 accuracy/UX 的最佳平衡。Docker host 看到 `Private` 而不是 `Docker container` **不是 bug**——用户从详情页(IP / hostname / lease)依然能识别。

**未来增强**(不在本 phase): 识别 known LAA prefixes(`52:54` / `02:42` / `00:50:56`)
显示更精确标签。需要一个**小**的"已知 LAA 前缀"表(~20-50 条),内联到 vendor.js,
不需要外部数据。

---

## 六、Multicast / Broadcast 检测

`(octet1 & 0x01) === 1` → multicast。包含:
- `FF:FF:FF:FF:FF:FF` broadcast
- `01:00:5E:*` IPv4 multicast group mapping
- `33:33:*:*:*:*` IPv6 multicast group mapping
- `01:80:C2:*` STP / LLDP / 802.1X protocol multicast

LAN Clients 卡里**几乎不会**出现这些(它们不是 DHCP lease 来源)。但这条 bit 检测
是**纵深防御**——万一某个 lease 文件被破坏出现非法 MAC,UI 不会显示
"Apple, Inc." 给一个 broadcast 地址。

---

## 七、不要做的事

1. **不要 commit `oui.json.gz` 到 git** — Build CI 生成 + IPK staging。Repo 历史保持干净。`.gitignore` 必须加这一条
2. **不要 cron 自动刷新** — flash wear + silent network failures + 6-24 月静态快照对家用足够
3. **不要 ship pako 或其他 polyfill** — DecompressionStream 覆盖率已经够,< 2% 老浏览器 fallback 到 "Unknown" 比 +30 KB 划算
4. **不要走外部 API**(macvendors.com / maclookup.app)— 隐私灾难 + rate limit + 单点故障
5. **不要 server-side ubus 解析** — 路由 CPU 浪费,V8 在用户设备上 < 20ms 解压 38K 条 JSON
6. **不要 dedupe 多个 LAA 地址到同一台设备** — hostname/IP 可被恶意客户端 spoof,合并 LAA 是 security risk
7. **不要 ship MA-M / MA-S** — 多 30% 大小换 < 5% 覆盖
8. **不要给 vendor 名手工加省略号** — 直接 CSS `text-overflow: ellipsis` 让浏览器处理。data 层保留全名
9. **不要走 standalone 数据包路径** — 用户已明确拒绝(§一)。即使将来 OpenWrt 出官方 `oui-database` 包,我们也直接 hybrid (host_hints 先 → 本地 fallback),不依赖第三个包
10. **不要在 vendor.js 之外重复实现 bit 检测** — 集中在 vendor.js,其他模块 (devices.js 等) 只调 lookup() 接口

---

## 八、风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Phase 1 验证发现 PR #7931 是 LLM 幻觉 | 30% | 低 | Phase 2A 选项作废,直接走 2B,**计划仍成立** |
| Wireshark manuf URL 改变 / 服务下线 | 5%/year | 中 | Build CI 失败 → 用上次 commit 的旧 IPK,功能不丢失只是 stale |
| 用户浏览器 < Safari 16.4 / FF 113 / Chrome 80 | < 2% | 低 | vendor.js 检测 DecompressionStream 是否定义,fallback 到 "Unknown",其他功能不受影响 |
| sessionStorage quota 超 | < 1% | 低 | try/catch 包裹,下次刷新重解压(轻微性能损失) |
| ImmortalWrt 24.10 有 vendor 字段但名字与 Wireshark 不一致 | 10% | 低 | hybrid 默认信 upstream,只在 upstream 空时 fallback |
| awk 在 GitHub Actions 上的行为与本地 macOS 不同 | 10% | 低 | CI 用 ubuntu-latest 默认 awk(gawk),规则简单不会踩坑;sanity check size 兜底 |
| Wireshark manuf 格式变化(新增列 / TSV → 其他分隔) | 5% | 中 | awk 规则匹配第 1/2 列具体值,新增列不影响;格式根本变化需手工修 |

---

## 九、估时

| 任务 | 估时 | 风险 |
|---|---|---|
| Phase 1 验证(ssh + ubus + github check) | 30 min | 低 |
| Phase 2A 实施(LAA + 消费 host_hints.vendor) | 1h | 低 |
| Phase 2B 实施(Build CI + vendor.js + LAN Clients 集成 + NOTICE) | 3-4h | 中 |
| Verify on router(浏览器试 vendor 显示 + LAA 标签 + 大设备数性能) | 30 min | 中 |
| **Total Phase 2A** | **2h** | **低** |
| **Total Phase 2B** | **4-5h** | **中** |

---

## 十、推荐时序

1. **Round 43 末或现在**: 跑 §二 Phase 1 验证(30 min,你自己 ssh)
2. **结果决定后续**:
   - 2A → 拼进 Round 44 polish 一起 ship(很小,不需要单独轮)
   - 2B → **作为 Round 45 主线**(Round 44 = conntrack + WAN tile,Round 45 = MAC vendor + 也许 OUI vendor)
3. **完成后**:`doc/backlog.md` 把 OUI vendor 条目从候选移到 DONE,引用本 doc + 实际 Step 编号

---

## 十一、引用

- `doc/OpenWrtMACVendorLookupArchitecture.md` — 触发本 doc 的 deep research 报告。注:
  报告里 PR #7931 / commit 70b7176fc2 / `ufp-neigh` daemon 等关键 commit-level 引用
  **需 §二 Step 3 验证**。报告里的数学符号是 base64 嵌图(垃圾),可忽略
- `doc/luci-theme-toolbox.md §5` — UCI write validation 模板(本 feature 不写 UCI
  但 user-facing string rendering 也应该 safe / sanitize)
- `doc/wan_traffic.md` — Round 44 另一个 polish 候选,作为 batching 参考
- Step 148 (Round 40) — LAN Clients 加 MAC 列 + Set Static 按钮(本 feature 前置)
- Round 42 Step 163-167 — rpcd ubus + ACL skeleton(Phase 2A 如果 future 要走
  server-side 集成的话用得上,但本 doc 没用到)

---

**负责人**:接手 Round 45+ 的 AI session,**请先重读 §二 Phase 1**。
**不要跳过验证直接 ship 150 KB 本地 DB**——如果 ImmortalWrt 24.10 真有 upstream
vendor 解析,ship 这个数据就是浪费 flash + 重复造轮子。

**用户视角**:你拒绝了 report 的"独立数据包"方案是有道理的——这是住宅 theme,
不是企业 firmware suite,简单就是力量。本 doc Phase 2B 严格按"单 IPK ship,
效果优先"实施。
