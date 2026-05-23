# Local Development Workflow

> 起飞时间：Round 10 / Step 59 (2026-05-23)
> 目标：把 "edit → see change" 单次循环从 **~15 分钟** 压到 **~5 秒**。

## 它解决什么问题

在 Round 1-9 期间，每改一行 CSS / JS / 模板，都要走：

```
edit → commit → push → wait CI build (3-5 min)
     → download zip → unzip → scp → ssh opkg install
     → reload browser → see change
≈ 15 分钟 / 次
```

跑了 9 轮以后总共烧掉好几小时纯等待。本地开发回路用 `fswatch` + `rsync` 把这条流水线压成：

```
edit → save → rsync (~0.5s) → Cmd+R → see change
≈ 5 秒 / 次
```

180× 加速。新的 round 我们 1 天能跑 30 次迭代而不是 3 次。

---

## 一次性 setup (Mac 端，约 10 分钟)

### 1. 装 fswatch

```bash
brew install fswatch
```

唯一的新依赖。`brew uninstall fswatch` 可以一秒卸掉。

### 2. SSH 免密 key（不动你已有的 key）

```bash
# 新建一个 luci-dev 专用 key（独立文件，不覆盖 id_ed25519）
ssh-keygen -t ed25519 -C "luci-dev" -f ~/.ssh/id_luci_dev -N ""

# 推到路由器（输一次密码）
ssh-copy-id -i ~/.ssh/id_luci_dev.pub root@192.168.45.1

# 配 SSH alias
cat >> ~/.ssh/config <<'EOF'

Host luci-router 192.168.45.1
    HostName 192.168.45.1
    User root
    IdentityFile ~/.ssh/id_luci_dev
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

`IdentitiesOnly yes` 关键：只用这个 key，**不**碰你的 `id_ed25519`。撤销也只需删 `id_luci_dev` 一个文件。

验证：

```bash
ssh luci-router "echo ok"
# 应该直接打印 "ok"，不问密码
```

### 3. 初装主题 ipk（一次性，让 `/www/luci-static/design/` 等目录存在）

走 GH Actions 出的官方 ipk：

```bash
# 在路由器上跑：
opkg update && opkg install luci-theme-design
# 或者把本地 build 出的 ipk scp 过去：
scp -O luci-theme-design_*.ipk luci-router:/tmp/
ssh luci-router "opkg install --force-reinstall /tmp/luci-theme-design_*.ipk"
```

这一步给后面的 rsync 创建目标目录，之后再也不需要装 ipk —— dev-sync 直接覆盖里面的文件。

---

## 日常用：一行命令

```bash
./scripts/dev-sync.sh
```

预期输出：

```
[10:23:45] preflight: probing luci-router...
[10:23:46] preflight: OK
[10:23:46] initial sync...
[10:23:47] ✓ synced in 1s
[10:23:47] watching: htdocs/ luasrc/ root/www/  (Ctrl-C to stop)
```

跑着别关。你编辑器里改任何文件 + 保存，1 秒内自动 sync。浏览器（DevTools Disable cache 勾着）按 Cmd+R 立即看效果。

Ctrl-C 退出 watch 模式。

### 单次同步（不监听）

需要 push 当前状态但不想跑 watch：

```bash
./scripts/dev-sync.sh --once
```

### 换路由器 IP

默认走 `~/.ssh/config` 里的 `luci-router` alias。临时换：

```bash
ROUTER=root@10.0.0.1 ./scripts/dev-sync.sh
```

---

## 同步目标速查

| 本地 | 路由器 | 用 `--delete` |
|---|---|---|
| `htdocs/luci-static/design/` | `/www/luci-static/design/` | ✅ (theme 自己的子目录) |
| `htdocs/luci-static/resources/` | `/www/luci-static/resources/` | ❌ (与 LuCI core 共享，删了会炸) |
| `luasrc/view/themes/design/` | `/usr/lib/lua/luci/view/themes/design/` | ✅ |
| `root/www/cgi-bin/design/` | `/www/cgi-bin/design/` | ✅ + 自动加可执行位 |

---

## 出问题时的恢复手段

### 1. 我把 LuCI 改崩了，登录界面打不开

```bash
# Mac 端 — 让分支回到 origin/js 已知好状态
git stash    # 保存当前修改
./scripts/dev-sync.sh --once
# 修好后再 git stash pop
```

或者更彻底，路由器上重装官方 ipk：

```bash
ssh luci-router "opkg install --force-reinstall /tmp/luci-theme-design_*.ipk"
```

### 2. 路由器丢链接，连不上 SSH

物理重启路由器即可。`/etc/config/` 没动，dev-sync 只动 `/www/` 和 `/usr/lib/lua/luci/`，重启后服务依靠 init.d 重读配置，不会持久坏。

### 3. 一行 JS 一改就整页崩

打开 DevTools Console → 看红色 stack trace → 行号定位。dev-sync 没改 `?v=` cache-buster，所以你需要 hard refresh (Cmd+Shift+R)。

或者在 DevTools Network 面板勾 "Disable cache"，**keep DevTools 开着** —— 之后每次 Cmd+R 自动 bust cache。

### 4. dev-sync.sh 报 "theme dirs missing"

`/www/luci-static/design/` 或 `/usr/lib/lua/luci/view/themes/design/` 不存在。**先装一次 ipk** (见上面 setup §3)。

---

## 跟现有工具的关系

| 流程 | 适用场景 |
|---|---|
| `./scripts/dev-sync.sh` | **日常**开发，秒级反馈 |
| `git push origin js` → GH Actions | 验证 build pipeline（CI 跑 lint + 产 ipk 给用户分发） |
| `opkg install ...ipk` | 首次安装 / 完全重置 / 用户分发 |

dev-sync **不替代** CI 和 ipk 分发。它只是让 dev 期内的反馈循环快起来。所有改动最终仍然要 commit → push → CI → ipk 才发布。

---

## 配套工具

### `./scripts/dev-tail.sh` — 实时看路由器日志（Step 66 已上）

dev-sync 推了代码,但页面行为不对?LuCI / CGI 多半在 `logread` 里留了痕迹。

```bash
./scripts/dev-tail.sh                # 全量
./scripts/dev-tail.sh design         # 只看含 'design' 的行
./scripts/dev-tail.sh error,fail     # 多 pattern,逗号分隔
```

输出按严重度上色：

| 颜色 | 触发关键词 |
|---|---|
| 红粗 | `error` / `fail` / `denied` / `crash` / `segfault` / `panic` |
| 黄 | `warn` / `timeout` / `retry` / `drop` |
| 暗灰 | 其余正常 |

推荐用法：开个分屏，左边 `dev-sync.sh`,右边 `dev-tail.sh`,改代码立即看 sync + 日志反馈。

## 计划中的 Phase 2 (Round 12+)

| 增强 | 价值 | 工时 |
|---|---|---|
| Playwright e2e 测试，跑在 `luci-router` 上 | 把 Round 1-9 的 9 个 deployment-discovered bug 全部写成回归测试 | ~4-6h |
| LiveReload 浏览器扩展集成 | 改文件后 Cmd+R 都省了，浏览器自己刷 | ~1h |
| `./scripts/dev-revert.sh` | 一键回滚到 git HEAD 状态（不止 stash） | ~30 min |
| ssh ControlMaster 加 `~/.ssh/config` | 4 个 rsync 共用 1 个 SSH 连接,每次 sync 省 300-800ms | ~10 min |

按需上。
