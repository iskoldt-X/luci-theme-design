# Chrome-Claude briefing template

> A copy-paste prompt prefix for the **browser-side Claude** (Claude in
> Chrome, or another agent driving a real browser against the dev router)
> when asking it to review UI of `luci-theme-design`. The goal is to
> get useful findings on the **first** try instead of the third, by
> front-loading project-specific context that the agent otherwise has
> to guess at.
>
> Past rounds repeatedly burned cycles because Chrome-Claude got the
> dark-mode selector wrong (it assumed `[data-darkmode="true"]` —
> the actual selector is `html[data-theme="dark"]`), invented design
> token names that don't exist, or didn't know what was already
> rejected as out of scope. This file fixes that.

---

## Table of contents

1. [When to use this](#when-to-use)
2. [The briefing — generic UI review](#the-briefing--generic-ui-review)
3. [Variant: light-mode audit](#variant-light-mode-audit)
4. [Variant: dark-mode audit](#variant-dark-mode-audit)
5. [Variant: responsive (narrow viewport) audit](#variant-responsive-narrow-viewport-audit)
6. [Variant: accessibility quick-pass](#variant-accessibility-quick-pass)
7. [After the review — integrating findings](#after-the-review--integrating-findings)
8. [Things Chrome-Claude consistently gets wrong](#things-chrome-claude-consistently-gets-wrong)

---

## When to use

Reach for Chrome-Claude (vs. just running this CLI Claude in the
repo) when you need a **real browser** in the loop:

- Pixel-level visual review of a card/page (does the new LAN Clients
  card look right?)
- Compare light vs dark mode (find one that breaks contrast)
- Resize the window to phone-narrow and check what reflows badly
- Click-through a flow (Rename → confirm → toast → table updates) and
  report what actually happened vs. what should happen
- Diff a screenshot against a Figma / mockup

Do NOT use Chrome-Claude for:

- Reading the source tree (it doesn't have the repo; this CLI does)
- Editing files, committing, pushing
- Anything that touches router state via SSH
- Asking "is this correct architecturally" — that's this CLI Claude
  + the engineering journal

---

## The briefing — generic UI review

Paste the block below into Chrome-Claude as the first message of a
session. Fill in the **`<<task here>>`** placeholder with what you
actually want reviewed.

```
You are reviewing the LuCI web UI for the theme "luci-theme-design"
(project luci-theme-design, branch js). Read this briefing fully
before doing anything.

ENVIRONMENT
- Router: http://192.168.45.1 (ImmortalWrt 24.10-SNAPSHOT, LuCI 26.x)
- Login: root + the password I provided separately
- Target browsers: current Chrome, Firefox, Safari (evergreen)
- The router is dev-only — feel free to click around, but DO NOT
  run /etc/init.d/* commands, DO NOT change UCI from the browser,
  DO NOT click Save&Apply on anything you don't understand. If a
  page warns about unsaved changes, navigate away without saving.

DARK MODE — the part everybody gets wrong
- The theme switches via `html[data-theme="dark"]` (set on the
  <html> element, NOT body, NOT a `data-darkmode` attribute).
- Toggle via the moon/sun button in the header. Verify the
  attribute is what changed (devtools → Elements → <html>).
- Light mode is the default (no `data-theme` attribute, OR
  `data-theme="light"`).

DESIGN TOKENS (CSS custom properties, on :root)
Verified against current style.css. Use ONLY these names — do not
invent. If a value you want doesn't exist here, flag it as "new token
needed", do NOT propose a hex literal.

Backgrounds:
  --color-bg               primary page surface
  --color-surface-0        primary card / panel surface
  --color-surface-1        alt-row / hover / nested surface
  --color-surface-2        pressed / deeper nested

Text:
  --color-text             primary text
  --color-text-muted       secondary text
  --color-text-subtle      tertiary text / placeholder
  --color-text-onaccent    text on top of an accent fill (white-ish)

Borders:
  --color-border-default   standard border (form fields, cards)
  --color-border-strong    emphasized border (hover, focus)
  --color-border-subtle    quiet divider (table rows)

Status (each has matching -bg variant for soft tint):
  --color-success / --color-success-bg     green — "good" / "up"
  --color-warning / --color-warning-bg     amber — "caution"
  --color-danger  / --color-danger-bg      red — "bad" / "down"
  --color-info    / --color-info-bg        blue — informational

Accent / brand (Emerald, 9-stop scale):
  --color-accent-50, -100, -200, -300, -400, -500 (base),
  -600, -700, -800, -900
  --color-accent-500-12   12% alpha (subtle tint background)
  --color-accent-500-35   35% alpha (focus ring)
  --shadow-focus uses -35.

Spacing (4px cadence):
  --space-1=4  --space-2=8  --space-3=12  --space-4=16
  --space-5=24 --space-6=32 --space-7=48  --space-8=64

Type sizes:
  --text-xs (12px) --text-sm (14px) --text-base (16px)
  --text-lg (18px) --text-xl (20px) --text-2xl (24px) --text-3xl (30px)

Weights:
  --weight-normal (400) / -medium (500) / -semibold (600) / -bold (700)

Radii (no --radius-full — use --radius-pill for circles/pills):
  --radius-sm (6px)  --radius-md (10px)  --radius-lg (14px)
  --radius-xl (20px) --radius-pill (999px)

Shadows:
  --shadow-xs   1px hairline
  --shadow-sm   2px soft
  --shadow-md   4-12px
  --shadow-lg   12-32px modal-grade
  --shadow-focus  accent-tinted focus ring (use on :focus-visible)

Motion:
  --motion-fast (120ms)  --motion-normal (200ms)  --motion-slow (320ms)
  --ease-out  --ease-in-out

Z-index ladder (use a token, don't pick numbers):
  --z-base (0) --z-sticky (10) --z-header (20) --z-sidebar (30)
  --z-overlay (40) --z-modal (50) --z-toast (60) --z-tooltip (70)

Both light and dark mode bind the SAME token names to mode-appropriate
values. Propose your fix as a token name, not a hex.

CONVENTIONS
- Buttons: use the `.btn` base + ONE of `.btn-primary`, `.btn-secondary`,
  `.btn-ghost`, `.btn-warning`, `.btn-danger`. Do NOT propose
  `.cbi-button-*` classes — those are legacy upstream LuCI; we have
  migrated off them.
- Trend arrows use ▲▼ (filled triangle), NOT ↑↓ (arrow).
- Action button color hierarchy:
    primary action  = `.btn-primary`
    safe/secondary  = `.btn-secondary`
    quiet/tertiary  = `.btn-ghost`
    "are you sure"  = `.btn-warning`
    destructive     = `.btn-danger`
- Status indication: **feature-scoped** (we have NO global `.pill` BEM
  family). Toasts use `.toast-success/-info/-warning/-error`. Trend
  pills use `.design-tile-trend-up/-down`. If you need a new status
  indicator, propose a feature-scoped class that consumes the
  `--color-{success,warning,danger,info}` + `-bg` token pair, mirroring
  the toast pattern.
- Cards: feature-scoped (`.devices-card`, `.wan-tile`, `.design-tile`,
  `.feature-card`, etc.). There is no global `.card` base class —
  shared card chrome lives in each feature's own CSS section.
- Hostnames in any context must be valid per RFC 1123:
  `^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$`. If you see a UI accepting more
  liberal input, flag it as a BUG — it can crash dnsmasq.

WHAT IS EXPLICITLY OUT OF SCOPE — do NOT suggest these
- Chinese (or any non-English) translations of source strings. The
  source strings stay English with `_()` wrapper for future i18n;
  translations belong in .po files that someone else owns.
- OpenClash integration.
- Crontab editor UX.
- Reboot-confirmation modal redesign.
- Per-host bandwidth widget (Round 31) — known broken, needs full
  redesign, not tweaks. Mention bugs you see but don't propose CSS
  patches to it.

REVIEW DELIVERABLE
For each issue you find, give me:
  1. Where (URL + selector path + ideally a screenshot region)
  2. What you observed (the actual behavior / appearance)
  3. What's expected (per convention above, or a reasoned argument)
  4. A specific fix — selector + property + value, using the design
     tokens above. If you don't know the token, name the *intent*
     and say "needs a token here".
  5. Severity: P0 (broken / unreadable / crash-risk) / P1 (visibly
     wrong) / P2 (polish).

DO NOT
- Make up token names. If you need a value not in the token list,
  flag it.
- Submit "the whole page looks fine" as a review — say specifically
  what you checked (which cards, which interactions, which viewport
  widths).
- Propose patches to per-host bandwidth or other listed out-of-scope
  items.

TASK
<<task here — be specific. e.g. "Review the LAN Clients card on
Status Overview at full-width and at 768px. Both light and dark
mode. Focus on alignment, contrast, and the Set Static button.">>
```

---

## Variant: light-mode audit

Replace the **TASK** section above with:

```
TASK — LIGHT MODE AUDIT
1. Ensure html does NOT have data-theme="dark". Toggle if needed.
2. Visit each of:
   - /admin/status/overview
   - /admin/network
   - /admin/network/dhcp
   - /admin/system/system
3. For each page, report:
   - Any text below 4.5:1 contrast against its background
   - Any element whose color comes from a hardcoded hex / rgb
     instead of a token (devtools → Computed → look for direct
     color values not traced to a custom property)
   - Any place a `.btn-*` class is missing where a button-like
     element exists
   - Any place the cursor doesn't change to pointer for
     interactive elements
4. Don't comment on dark-mode behavior in this pass — separate audit.
```

---

## Variant: dark-mode audit

Replace TASK with:

```
TASK — DARK MODE AUDIT
1. Toggle to dark mode. Verify html element has data-theme="dark".
2. Same page list as light-mode audit.
3. Specific to dark mode, watch for:
   - White-on-white or near-white surfaces (a card whose --color-bg
     resolves the same as the page background)
   - Hardcoded `color: #000` or `color: black` showing as invisible
   - Inline `style="background-color: white"` from upstream LuCI
     templates — flag the selector, then I will add an attribute
     selector override (see doc/luci-theme-toolbox.md §3)
   - Icons that don't tint (SVGs using `fill="#000"` instead of
     CSS mask + currentColor — see doc/luci-theme-toolbox.md §4)
   - Form inputs that lose their border outline
4. Take screenshots of each page in dark mode for the journal.
```

---

## Variant: responsive (narrow viewport) audit

Replace TASK with:

```
TASK — RESPONSIVE AUDIT
1. Resize the browser window to 768px wide.
2. Visit /admin/status/overview.
3. Report:
   - Any horizontal scrollbar on the body (means something is
     overflowing — name the element)
   - Any table whose columns squash to unreadable widths (name
     the table + which column)
   - Cards that wrap awkwardly (e.g. 3-up tiles becoming
     2 + 1 with the 1 stretched)
   - Touch targets smaller than 32×32 (action buttons especially)
4. Resize to 414px (iPhone-ish). Same checks.
5. Resize to 320px (smallest viable). Same checks — but at this
   width some compromise is acceptable; just note it.
6. The Sidebar nav on narrow viewport: does the hamburger work?
   does the menu cover the page or push it?
```

---

## Variant: accessibility quick-pass

Replace TASK with:

```
TASK — ACCESSIBILITY QUICK-PASS
1. Tab through /admin/status/overview from page load.
   - Does focus visit every interactive element?
   - Is the focus ring visible at every stop?
   - Does Tab order match visual reading order?
2. Use the browser's accessibility devtools (Chrome: F12 →
   Lighthouse → Accessibility, or Axe DevTools if installed).
   Report each finding with: rule, element, my fix proposal.
3. Specifically check:
   - All buttons (.btn-*) have accessible names (visible text OR
     aria-label OR aria-labelledby)
   - All icon-only buttons have aria-label
   - Form inputs have associated <label>
   - Table headers use <th> with scope
   - The dark-mode toggle button has aria-pressed reflecting state
   - Color is not the only thing distinguishing meaning (e.g. up/down
     arrows AND color, not color alone)
4. Don't propose accessibility "nice-to-haves" we can ignore — only
   flag real WCAG-A or AA failures.
```

---

## After the review — integrating findings

Chrome-Claude returns a list of issues. Bring them back to this CLI
Claude (or do it yourself):

1. **Triage.** Cluster findings by severity and by file. Discard
   anything that fell into a listed out-of-scope area despite the
   briefing (it happens).
2. **Decide grouping.** Multiple polish items in one CSS file = one
   Step. A P0 contrast bug = its own Step. Don't bundle a P0 with
   five P2s; the user wants to be able to revert any Step
   independently.
3. **Open a backlog entry** in `doc/backlog.md` for any P2 you're
   not doing immediately. Link the Chrome-Claude finding ID.
4. **For each Step:** edit the file → verify on the router via
   dev-sync → commit with a `Step N:` message → update the journal
   `doc/styling-progress.md` either now or at the round's end.
5. **Verify the fix landed** — ideally by asking Chrome-Claude to
   re-screenshot the same spot. Keep the before/after pair in the
   journal entry.

---

## Things Chrome-Claude consistently gets wrong

Document these here so future briefings can pre-empt them. Add a
line every time the agent makes the same mistake twice.

| What it gets wrong | Correct | First seen |
|---|---|---|
| `[data-darkmode="true"]` for dark mode | `html[data-theme="dark"]` | Round 33 |
| Hex color suggestions | Use design tokens (see briefing) | Round 33 |
| `.cbi-button-primary` etc. | `.btn-primary` etc. | Round 38 |
| Suggesting Chinese translations | Source strings stay English with `_()` | Round 32 |
| `↑` / `↓` for trend arrows | `▲` / `▼` | Round 37 |
| Proposing CSS tweaks to per-host bandwidth | Out of scope (needs full redesign) | Round 41 |
| Touching upstream LuCI templates directly | Override via theme CSS (see toolbox §1, §2, §3) | Rounds 32-34 |
| Treating `lease.expires` as Unix timestamp | It's remaining-seconds | Round 38 |

---

## Variant: backend-feature end-to-end verification (Round 46+)

Use when shipping a feature where the backend can be exercised
independently of the UI. The Block feature (Round 46) is the
canonical example: rpcd methods can be called via `ubus call ...`
without ever touching the Clients-card button, so we verify them
before wiring UI.

Pattern: 1-script ssh batch returning numbered check-list. Each
check is either a single ubus / nft / shell command + expected
verdict. Chrome-Claude (or you, manually) runs the batch, returns
PASS/FAIL per item.

```bash
ssh luci-router '
echo "=== 1. files in place ==="
ls -l /path/to/file1 /path/to/file2

echo "=== 2. service config reloaded (rpcd .list contains new methods) ==="
/etc/init.d/rpcd reload && sleep 1
ubus -S call $UBUS_OBJECT list 2>&1

echo "=== 3. mechanism primitive works ==="
# e.g. nft list table inet design_x

echo "=== 4. happy-path RPC ==="
ubus call $UBUS_OBJECT some-method "{\"arg\":\"value\"}"

echo "=== 5. side-effect visible on filesystem ==="
cat /some/state/file | grep expected-content

echo "=== 6. invalid input rejected ==="
ubus call $UBUS_OBJECT some-method "{\"arg\":\"garbage\"}"
# expect: {"error":"invalid-arg"}

echo "=== 7. inverse operation works ==="
ubus call $UBUS_OBJECT undo-method "{\"arg\":\"value\"}"

echo "=== 8. persistence across service reload ==="
ubus call $UBUS_OBJECT some-method "{\"arg\":\"persist-test\"}"
$SERVICE reload && sleep 1
# check state still present

echo "=== 9. no rule duplication on multiple reloads ==="
$SERVICE reload && sleep 1; $SERVICE reload && sleep 1
# check rule count unchanged

echo "=== 10. cleanup ==="
ubus call $UBUS_OBJECT undo-method "{\"arg\":\"persist-test\"}"
'
```

**Gates**: ALL items must PASS before UI work starts. Any FAIL = a
hotfix step BEFORE UI. Round 46 caught 3 backend bugs (Step 242a
path / Step 242b atomic-replace / Step 242c paste-not-found) this
way — every one would have surfaced as a UI bug if we'd shipped UI
first.

**See Round 46 Step 242 + 242a/b/c for the live application** of
this template.

---

## Cross-references

- `doc/styling-progress.md` — the engineering journal (Rounds 1–N).
  If Chrome-Claude needs context on "why does the WAN tile look like
  X", point it at the Round entry for that change.
- `doc/luci-theme-toolbox.md` — the techniques. If a fix Chrome-Claude
  proposes requires `:has()` or attribute selectors or SVG mask, the
  toolbox has the canonical pattern.
- `doc/CLAUDE.md` — historical audit. Don't ask Chrome-Claude to
  re-audit issues already closed there.
- `doc/backlog.md` — what's deferred. If Chrome-Claude proposes
  something already in backlog, no action needed — note it landed
  there once already.

---

*Last updated: 2026-05-26 (Round 47, Step 247). Bump this date
whenever you append to "Things Chrome-Claude consistently gets wrong"
so the briefing stays current.*
