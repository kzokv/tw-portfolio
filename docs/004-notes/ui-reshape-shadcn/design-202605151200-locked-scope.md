# UI Reshape — Locked Design Scope

**Status:** Frozen 2026-05-15. Pre-merge corrections allowed per `.claude/rules/doc-management.md`. After merge, immutable — record of decisions at locking time.

**Scope ticket:** UI reshape onto shadcn/ui with full visual refresh, light + dark + system theme support, user-selectable accent palette, density preference, retired glass aesthetic, decomposed shell, new IA, responsive-everywhere convention.

**Worktree:** `.claude/worktrees/ui-reshape-shadcn` on branch `worktree-ui-reshape-shadcn`.

---

## 1. Design principles

1. **Data leads, chrome follows.** Every surface makes the user's number the loudest element. No gradient, shadow, or decorative panel competes with content.
2. **One accent, two modes, three roles.** Single brand accent (user-selectable). Light + dark (+ system auto-switch). Three semantic colors: success, danger, warning — tuned for AA contrast in both modes.
3. **Quiet by default, loud on signal.** Borders before shadows. Backgrounds before borders. Color only for direction/state, never decoration.
4. **Bilingual-aware.** zh-TW and Latin coexist; typography and spacing flatter both.
5. **Tokens as the contract.** Every color, radius, spacing decision is a CSS variable. No component hardcodes a hex. Light↔dark is a config flip, not a refactor.
6. **Responsive everywhere.** Every page, every table, every text container reflows. Container queries where they help, breakpoint media queries elsewhere. No fixed pixel widths in content; spacing uses `clamp()`.

## 2. Aesthetic — what dies, what lives

**Retired** (deleted entirely in Phase 7):
- Three radial gradients on `body`
- `body::before` grid mesh overlay
- `glass-panel`, `glass-inset`, `surface-glass` classes
- `bg-sheen` gradient utility
- `shadow-card: 0 24px 80px rgba(2,6,23,0.45)` (heavy drop)
- Indigo gradient default on every `<Button>`
- Serif display font on headings

**Adopted**:
- Flat surfaces: `bg-card border border-border` cards
- `shadow-sm` only on interactive cards (drag handle, hover-elevate states)
- Single accent gradient allowed at most **once per page**, on the hero CTA or stats hero
- Borders carry structure; `--border` is the load-bearing token
- One sentence per visual element. No competing accents within a card.

## 3. Theme system

### 3.1 Mode resolution

- `next-themes` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`.
- Theme stored in `localStorage` (per-device; intentional — different machines may have different ambient light).
- Theme toggle in TopBar is a 3-state segmented control: ☀ Light · 🌓 System · 🌙 Dark.
- Hydration: `next-themes` ships its own inline script to prevent FOUC; we use that.

### 3.2 Accent palette

8 curated presets. Mutates **only** `--primary`, `--primary-foreground`, and `--ring`. Status colors (success/danger/warning) and neutral scale stay constant — direction signals must never shift with accent.

| Preset | Light primary | Dark primary | Default |
|---|---|---|---|
| Indigo | `238 84% 60%` | `238 84% 67%` | ✓ |
| Violet | `262 83% 58%` | `262 83% 65%` | |
| Blue | `217 91% 60%` | `217 91% 65%` | |
| Cyan | `188 86% 38%` | `188 86% 52%` | |
| Emerald | `158 64% 40%` | `158 64% 52%` | |
| Amber | `35 92% 50%` | `35 92% 60%` | |
| Rose | `347 77% 50%` | `347 77% 62%` | |
| Slate | `222 47% 11%` | `210 40% 98%` | |

Persisted per-account via `user_preferences.themeAccent`. Default `indigo`. Resolver path: user → admin default → built-in default (3-tier per `.claude/rules/phased-ticket-scope-completeness.md`).

### 3.3 Token contract

shadcn HSL-variable contract (Tailwind v3, since `apps/web/tailwind.config.mjs` is on v3):

```css
:root {
  --background: 0 0% 100%;          /* page surface, light */
  --foreground: 222 47% 11%;        /* primary text */
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 238 84% 60%;           /* accent — replaced by user choice */
  --primary-foreground: 0 0% 100%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --accent: 210 40% 96%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --success: 142 71% 36%;
  --success-foreground: 0 0% 100%;
  --warning: 38 92% 50%;
  --warning-foreground: 222 47% 11%;
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 238 84% 60%;              /* follows --primary */
  --radius: 0.625rem;
  --row-h: 36px;                    /* compact default */
  --row-px: 12px;
}

.dark {
  --background: 222 47% 6%;
  --foreground: 210 40% 98%;
  --card: 222 47% 9%;
  --card-foreground: 210 40% 98%;
  --popover: 222 47% 9%;
  --popover-foreground: 210 40% 98%;
  --primary: 238 84% 67%;
  --primary-foreground: 222 47% 11%;
  --secondary: 217 33% 17%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217 33% 17%;
  --muted-foreground: 215 20% 65%;
  --accent: 217 33% 17%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --success: 142 71% 45%;
  --success-foreground: 222 47% 6%;
  --warning: 38 92% 60%;
  --warning-foreground: 222 47% 11%;
  --border: 217 33% 17%;
  --input: 217 33% 17%;
  --ring: 238 84% 67%;
}

[data-density="comfortable"] {
  --row-h: 52px;
  --row-px: 20px;
}
```

### 3.4 Legacy-token alias bridge (Phase 0 → Phase 7)

To keep existing call sites green while reshape proceeds file-by-file, alias the legacy tokens to the new tokens for one PR cycle:

```css
:root {
  --bg: hsl(var(--background));
  --surface: hsl(var(--card));
  --surface-soft: hsl(var(--muted));
  --text: hsl(var(--foreground));
  --muted: hsl(var(--muted-foreground));  /* note name collision; resolved below */
  --accent: hsl(var(--primary));
  --accent-strong: hsl(var(--primary));
  --line: hsl(var(--border));
}
```

Conflict on `--muted` (old name = the muted surface bg; new name = muted text fg). Resolve by renaming old `text-muted` Tailwind alias to `text-ink-muted` during Phase 0; tokens use new names from Phase 0 onward. See scope-todo Phase 0 for exact migration steps.

Bridge is **deleted in Phase 7**. Any remaining legacy var references are blocking findings.

## 4. Typography

- **Display + body:** Geist Sans (variable). Replaces Noto Serif TC heading + Noto Sans TC body.
- **Numeric:** Geist Mono with `font-variant-numeric: tabular-nums` on every monetary container. Apply via `.tabular` utility class and a `<Money>` component.
- **CJK fallback:** Noto Sans TC kept in `font-family` chain for zh-TW glyphs. Browser substitutes per-glyph automatically.
- **Heading style:** `font-semibold tracking-tight` (no serif, no `-0.02em` global letterspacing).
- **zh letterspacing override:** `:lang(zh-TW) h1, :lang(zh-TW) h2, :lang(zh-TW) h3, :lang(zh-TW) h4 { letter-spacing: 0; }`.
- **Scale:** shadcn defaults — `text-xs` 12, `text-sm` 14, `text-base` 16, `text-lg` 18, `text-xl` 20, `text-2xl` 24, `text-3xl` 30. Headings use `font-semibold`.

## 5. Text-wrap and responsive convention

Adopted globally:

| Rule | CSS | Where |
|---|---|---|
| Headings balance lines | `text-wrap: balance` | `h1`–`h4` |
| Body text wraps pretty | `text-wrap: pretty` | `p`, `li`, `dd` |
| Long unbreakable strings break | `overflow-wrap: anywhere` | ticker codes, hashes, emails, URLs |
| Single-line truncation | `truncate` utility | table cells (name columns), nav items |
| Multi-line truncation | `line-clamp-{1,2,3}` | card descriptions, notification messages |
| No fixed width in content | `min/max/clamp` for paddings; `w-full` for inputs | every container |
| Container queries first | `@container (min-width: …)` | reusable components (cards, list items) |
| Media queries for layout shifts | `sm/md/lg/xl` Tailwind breakpoints | page-level grid shifts |
| Tables: column priority + scroll | `overflow-x-auto` + sticky first column on `<md`; column hiding via Tailwind `hidden md:table-cell` | every DataTable |
| Tables: stack on mobile (opt-in) | CSS grid template per-row at `<sm` | optional per-table; default is scroll |
| Touch targets | min 44×44px | all interactive elements at any breakpoint |
| Form inputs | `w-full` by default, `max-w-*` clamp | every form field |

**Breakpoint contract:** `sm` 640px · `md` 768px · `lg` 1024px · `xl` 1280px · `2xl` 1536px (Tailwind defaults; do not customize).

**Mobile-first authoring:** every component renders correctly at 320px without horizontal scroll. Add `sm:` / `md:` / `lg:` modifiers to expand at wider viewports. Reverse (desktop-first with `max-w` clauses) is prohibited.

## 6. Density

Two modes, user-selectable in Settings → Display → Density. Persisted per-account via `user_preferences.density`. Default `compact`.

- **Compact** (default): `--row-h: 36px`, `--row-px: 12px`. ~10–12 rows per laptop viewport. Standard for tables.
- **Comfortable**: `--row-h: 52px`, `--row-px: 20px`. ~5–6 rows per laptop viewport. Better for touch / tablet / users who prefer breathing room.

Applied via `[data-density="comfortable"]` selector on `<html>` element, set by a small ThemeProvider sibling. Components that respect density: tables, list items, dropdowns, dense forms. Forms with rich inputs (date picker, combobox) stay comfortable regardless to avoid cramped controls.

## 7. Component primitives

### Wave A — substrate (Phase 1)

`button` · `card` · `input` · `label` · `form` · `select` · `dropdown-menu` · `dialog` · `alert-dialog` · `sheet` · `tabs` · `tooltip` · `popover` · `badge` · `separator` · `skeleton` · `sonner` (toast) · `command` · `scroll-area` · `switch` · `checkbox` · `radio-group`

### Wave B — data & navigation (Phase 3)

`table` + `data-table` recipe · `breadcrumb` · `sidebar` block · `navigation-menu` · `avatar` · `progress` · `resizable`

### Wave C — specialty (Phase 5)

`calendar` + `date-picker` · `combobox` recipe (replaces `InstrumentCombobox`) · `chart` (Recharts wrapper)

### Adapter strategy (Phase 1)

Existing `apps/web/components/ui/{Button,Card,Drawer,Popover,Tabs,TooltipInfo}.tsx` become re-export shims that map old API to shadcn equivalents. Call sites do not churn. Once all consumers migrated (gradually, per-feature), shims deleted in Phase 7.

## 8. Information architecture

### Locked changes

1. **Sidebar block** as primary nav. Left rail with icons + labels; collapsible to icon-only on `md`; `Sheet` overlay on `<md`. Replaces current TopBar nav-menu pattern.
2. **TopBar** decomposed to: brand, breadcrumbs, ⌘K command palette trigger, notifications, profile menu, theme toggle.
3. **⌘K command palette** as first-class nav (`apps/web/components/layout/CommandPalette.tsx`). Use cases: go to route, find ticker, switch accent, change theme, "Add transaction" quick-action, "Open Settings → API keys" deep link.
4. **Merge `/dividends` + `/dividends/review`** into one route with a "Needs review" filter chip in the page header.
5. **Unified `AuthShell`** (`components/layout/AuthShell.tsx`) for `/login`, `/auth/error`, `/invite/[code]`. Centered card, no app chrome, calm background.
6. **Public share view (`/share/[token]`)** uses **distinct visitor chrome** — no sidebar, no ⌘K, no add buttons. Slim top strip: "Shared by {ownerName} · Powered by Vakwen". Read-only ticker detail links allowed. "Sign up for your own" CTA in footer.
7. **Dashboard re-prioritization**: Above-the-fold = portfolio total + day Δ + biggest movers. Below = trend chart, allocation, recent transactions, dividends. Decorative `ActionCenterSection` / `QuickTransactionSection` collapsed into one floating + button or `Sheet` quick-action.
8. **Admin shell** keeps `AdminShell` separate but adopts same sidebar pattern. Distinct sidebar tint (use `--secondary` instead of `--card`) so operators always know they're in admin.
9. **Settings drawer** stays a drawer, rebuilt on shadcn `Sheet`.

## 9. Responsive strategy — retire dual-DOM tables

The current `hidden lg:block` table + `lg:hidden` card-grid pattern (source of `.claude/rules/responsive-dual-layout-testid-prefixes.md`) is retired. Replacement:

- One shadcn `DataTable`.
- Below `md`: horizontal scroll with sticky first column.
- Below `sm` (opt-in per table): switch to CSS-grid stacked rows.
- Same `data-testid` per row across breakpoints — one set of test IDs.
- Page objects update once.

The dual-layout rule remains in `.claude/rules/` until Phase 4 completes; then promoted to "superseded by single-DOM `DataTable`" in the rule body.

## 10. New `user_preferences` keys (locked)

| Key | Type | Default |
|---|---|---|
| `themeAccent` | `"indigo" \| "violet" \| "blue" \| "cyan" \| "emerald" \| "amber" \| "rose" \| "slate"` | `"indigo"` |
| `density` | `"compact" \| "comfortable"` | `"compact"` |

Both per-account, synced. Resolver follows 3-tier (user → admin → built-in default). Schema migration + DTO field + Settings UI all land in **Phase 2** alongside the theme toggle.

**Not** persisted per-account: light/dark/system mode (per-device by design; user wakes their work laptop in a dark office, their phone in daylight).

## 11. Constraints preserved

- i18n flat `Record<string, string>` for `dict.settings` (per `i18n-flat-record-dict-settings.md`).
- No functions in i18n dicts (per `nextjs-i18n-serialization.md`).
- `KZO-XX:` commit-message convention does **not** apply — this is the `ui-enhancement` waiver track (per `commit-format.md`). PR will carry `waiver:linear-ticket` label with `## Waiver` section.
- shared-types barrel Turbopack rule respected — no runtime exports added to `libs/shared-types` for this reshape.
- Every page must rebuild `.next/standalone/` before Playwright runs (per `playwright-web-bundle-rebuild.md`).
- Testid contracts preserved in Phase 4 — page-object locators move in lockstep.

## 12. Out of scope (explicit)

- No marketing/landing page redesign (current `/` is a 5-line redirect; keep).
- No changes to backend APIs other than the two new `user_preferences` columns.
- No new pages (only IA reorganization).
- No replacement of Recharts after install (settle on Recharts).
- No custom hex picker in v1 (8 presets only).
- No bottom-nav for mobile (this is a tool, not a consumer app).
