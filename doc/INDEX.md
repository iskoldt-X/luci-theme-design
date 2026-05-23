# `doc/` Index

> Round 12 / Step 70 (2026-05-23). Living index of the project's documentation.
> When a new contributor (human OR AI agent) opens this folder, they should
> read this file first to know **where to look for what** without reading
> all 7,500 lines.

---

## 🚀 If you're a brand-new AI session continuing this project — START HERE

User's kickoff message will probably be **one line** pointing to this file.
Read it once, then orient yourself with the steps below. Don't read everything.

### Required reading (~15 min, in order)

1. **This section (you're here)** — current state, workflow, preferences
2. **The 3 memory files** at `~/.claude/projects/-Users-nht435-GitHub-luci-theme-design/memory/` — should auto-load into your context. They cover non-obvious LuCI 26.x quirks: `L.uci.changes()` returns Promise; `network.device.status` is ACL-denied for browser RPC; Save&Apply uses `L.ui.changes.apply()` not `displayChanges()`. Knowing these saves hours.
3. **`doc/styling-progress.md` LAST 2 ROUNDS** (search "## 🚀" or "## 🤝" headings, read the most recent 2-3) — current journal state. Don't try to read all 2500 lines.
4. **`doc/development.md`** — the dev-sync.sh / dev-tail.sh workflow
5. **`git log --oneline -15`** + **`git status`** — what shipped, what's uncommitted

After that you should be able to function as if you'd been on the project all along.

### Current state (snapshot — update this when work paces)

- **Branch:** `js`. The default working branch. Direct commits OK, NEVER push to `origin` without explicit user permission.
- **Rounds shipped:** 13 (Round 1 = initial cleanup, Round 13 = SVG namespace + CSS layout polish via Chrome-Claude agent collab)
- **Steps shipped:** 85+ (each Step = one focused commit)
- **What's in flight:** Chrome-Claude verification pass on Steps 83-85. User reports Chrome-Claude saw "19/42 SVGs in HTML namespace" — but I verified the router files ARE refactored correctly (mtimes recent). It's stale browser cache. User is being told to clear site data + hard refresh, then re-verify.

### Working principles (these are durable, not snapshot)

- **One Step = one commit** on `js`. Atomic. User can revert any Step independently. Match the existing Step numbering (currently 85, next Step is 86).
- **dev-sync.sh is running on the user's Mac.** It watches the source tree and rsyncs every save to the router at 192.168.45.1 within ~1s. So you commit → it's on the device immediately. NO need to push to GitHub for testing. Push is only for CI validation / releases.
- **Chrome-Claude is the field reporter.** User has Claude in Chrome extension installed; it inspects the live page (network / DOM / console) and reports back. Treat its findings as ground truth even when surprising — it has more visibility than you. Don't argue, just diagnose and fix.
- **Static checks before commit:** `node --check` every .js file you touched, CSS brace balance via the inline Python snippet (`re.sub(r'/\\*.*?\\*/', '', src, flags=re.DOTALL); count { vs }`), `grep -rlP '\\x01'` to catch the Edit-tool's SOH-byte corruption (rare but happens). All three are in `.github/workflows/lint.yml`.
- **Commit messages are long-form.** Open with a one-line summary, then 3-5 paragraphs explaining root cause + fix + verification. The journal in `styling-progress.md` re-uses this content. Look at recent commits for the format.
- **Never push to origin without permission.** dev-sync handles all dev iteration. Push is a separate explicit action the user OK's. When you do push, the CI may fail on the size budget — re-tune in `.github/workflows/lint.yml` if so (precedent: Step 72 bumped JS budget 35→60 KB).
- **Memory files auto-load.** When you save a new LuCI 26.x discovery, add a memory file under `~/.claude/projects/-Users-nht435-GitHub-luci-theme-design/memory/`. Always link related memories with `[[other-name]]`.

### User preferences (durable)

- **No Chinese i18n.** Even though user reads Chinese, they explicitly declined adding `.po` for theme strings. Source code stays English-only (`_('...')` wrappers around English).
- **Target environment:** ImmortalWrt 24.10-SNAPSHOT / LuCI 26.x on x86/64 (QEMU at 192.168.45.1). Lean OpenWrt 18.06/19.07 is the "be universal" secondary target — defensive code patterns, but x86/64 24.10 is what we test against.
- **User's role:** owner + verifier. They flash, observe, occasionally hand-relay Chrome-Claude's findings. They trust you to drive code/round planning.
- **Round granularity:** 3-6 Steps per round. Each round ends with a clean recap. Don't blast 12 Steps in one turn without summary.

### How to recognize you're done with a round

- All identified bugs have a Step.
- Each Step has its own commit on `js`.
- `styling-progress.md` has a "Round NN" header + Step entries at the bottom.
- Either: (a) user has verified, or (b) you've handed off a clear "verify list" message for them to relay to Chrome-Claude.

### How to start a new round

- Decide a theme (e.g. "Round 14 — Traffic Analysis preview parity").
- Mark a chapter with the `mcp__ccd_session__mark_chapter` tool.
- List Steps with risk + time estimate.
- Ship.

---

## 🎯 If you only have time for one file

**`development.md`** — How to work on this theme locally. SSH + fswatch +
rsync workflow. Setup walkthrough. **Read this first** if you plan to make
any changes.

## Active docs (read these for current state)

| File | Lines | Role | Read it when |
|---|---|---|---|
| **`development.md`** | 209 | Local dev workflow (`scripts/dev-sync.sh`, `dev-tail.sh`, SSH setup) | About to write code |
| **`styling-progress.md`** | 2300+ | **Engineering journal** — every Step 1 through 70+ with what/why/break-change/verify | Looking for "why is X this way" → grep here |
| **`luci-compat.md`** | 105 | LuCI API compatibility matrix, verified versions, internal vs public surface | About to monkey-patch a LuCI internal |
| **`upgrade.md`** | 1431 | Functional feature roadmap (v2). Tier S/A/B/C/D priorities + i18n contract + CGI policy | Planning a new feature card |
| **`finalplan.md`** | 1166 | Consolidated P0/P1/P2/P3 fix plan (v2). Original code-quality audit + responses | Wondering about a fix's rationale |
| **`claude_style.md`** | 1209 | Initial design system proposal (tokens, palette, spacing rhythm, font policy) | Touching design tokens in style.css §1 |

## Visual reference (open in browser)

| File | Role |
|---|---|
| `style-preview.html` | Static design system showcase — tokens, components, layouts |
| `upgrade-preview.html` | Interactive demo of every Tier S/A/B feature from `upgrade.md` — the **visual target** we keep diffing against |

To preview locally: `open doc/upgrade-preview.html` (macOS) or just drag into any browser.

## Historical analysis (read only if you need archaeology)

These three docs were the initial AI-led audits of the codebase before any
fixes shipped. Their conclusions are now **digested into `finalplan.md`**
and largely **superseded by `styling-progress.md`** (which tracks what
actually got done). Keep around for accountability — they record what was
known when.

| File | Role |
|---|---|
| `gemini.md` (84) | Most concise of the three audits — 8 core issues |
| `claude.md` (576) | Most detailed audit — found `style copy.css`, favicon PNG-as-ICO, etc. |
| `codex.md` (416) | Identified `null active` class bug, deprecated DOMSubtreeModified |

Don't expect these to reflect current code — they're 2026-05-22 snapshots.

## Project memory (~/.claude/projects/...)

Beyond `doc/`, there's project-specific memory at
`~/.claude/projects/-Users-nht435-GitHub-luci-theme-design/memory/`. These
are knowledge artifacts a future AI agent loads automatically:

- **LuCI 26.x: `L.uci.changes()` returns Promise** — historical sync API got asyncified
- **LuCI 26.x: `network.device.status` is ACL-denied for browser RPC** — `-32002` error; CGI bypass workaround
- **LuCI 26.x: Save&Apply uses `L.ui.changes.apply()`** — not `displayChanges()`; must patch both

These three live-fire LuCI 26.x discoveries (Steps 50, 53, 58) are the kind
of thing that ate hours of debugging. Saved as memory so future sessions
know about them on day one.

## How docs evolve

| When to update |
|---|
| Every shipped Step → entry in `styling-progress.md` |
| New LuCI API discovery → entry in `luci-compat.md` + project memory file |
| New tool / workflow → section in `development.md` |
| New roadmap proposal → entry in `upgrade.md` |
| Design system change → claude_style.md is the **frozen** original; current state lives in `style.css` §1 + `styling-progress.md` |

If a doc grows past ~2,000 lines, consider splitting (we did this for
`styling-progress.md` rounds — should probably do it again for upgrade.md).

## 📐 Reading order recommendations

**"I want to ship a new feature"**:
1. `upgrade.md` — is it already planned? Which Tier?
2. `development.md` — set up local dev loop
3. `styling-progress.md` last round — what's the current node count, recent gotchas?
4. `claude_style.md` — token names if touching CSS
5. `luci-compat.md` — any LuCI surface you'll touch?

**"I want to understand why X is the way it is"**:
1. `grep -rn "X" doc/styling-progress.md` — usually the journal explains
2. Check git log for the commit message + linked Step

**"I want to fix a bug"**:
1. `development.md` — dev-sync loop
2. `styling-progress.md` — has this bug been seen / fixed / regressed before?
3. Project memory in `~/.claude/projects/...` — LuCI 26.x gotchas

**"I'm a new AI agent opening this project"**:
1. **This file** (INDEX.md)
2. The 3 memory files in `~/.claude/projects/...` auto-load
3. README.md for user-facing summary
4. `styling-progress.md` for the current state (start with the latest round summary at the bottom)
