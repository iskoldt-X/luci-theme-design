# `doc/` Index

> Round 12 / Step 70 (2026-05-23). Living index of the project's documentation.
> When a new contributor (human OR AI agent) opens this folder, they should
> read this file first to know **where to look for what** without reading
> all 7,500 lines.

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
