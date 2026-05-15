# UI Reshape — Scope Todo (Phased Delivery)

**Status:** Frozen 2026-05-15. Pre-merge corrections allowed.
**Design reference:** [`design-202605151200-locked-scope.md`](./design-202605151200-locked-scope.md).
**Worktree:** `.claude/worktrees/ui-reshape-shadcn`.

Single ticket; phased delivery via sequential commits on the same branch. Each phase is independently verifiable (lint + typecheck + targeted suite) and produces a working app — no half-broken main.

---

## Phase 0 — Substrate

**Goal:** add shadcn infra without changing any visual output. Existing pages still look identical because the legacy-token alias bridge keeps every old class name resolving.

**Deliverables**

- [ ] `apps/web/components.json` — style `new-york`, base color `neutral`, RSC `true`, TSX `true`, aliases `@/components`, `@/lib/utils`, `@/components/ui`, `@/components/ui/lib`, `@/hooks`.
- [ ] `apps/web/tsconfig.json` — add `"@/*": ["./*"]` to `paths`, keep existing `@vakwen/shared-types` alias.
- [ ] `apps/web/lib/utils.ts` — `cn(...)` helper (`clsx` + `tailwind-merge`). Re-export from existing path if already present.
- [ ] Install deps in `apps/web/package.json`: `next-themes`, `geist`, `tailwindcss-animate`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`. (CVA, clsx already present — verify; install missing only.)
- [ ] `apps/web/tailwind.config.mjs` — add `darkMode: ["class"]`; extend `colors` with HSL-variable entries (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `success`, `warning`, `border`, `input`, `ring`); extend `borderRadius` with `--radius` derivation; add `tailwindcss-animate` plugin.
- [ ] `apps/web/app/globals.css` — replace top section with:
  - `:root` block with full token contract (Section 3.3 of design doc)
  - `.dark` block
  - `[data-density="comfortable"]` block
  - Legacy alias-bridge block (Section 3.4)
  - Drop body radial-gradient backgrounds and `body::before` grid mesh
  - Add `*, ::before, ::after { border-color: hsl(var(--border)); }` baseline
  - Add typography baselines (`text-wrap: balance` on headings, `text-wrap: pretty` on body)
  - Keep `.glass-panel` / `.glass-inset` classes temporarily aliased to the flat surface (deleted in Phase 7)
- [ ] `apps/web/app/layout.tsx` — wrap children in `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>` from `next-themes`; load Geist Sans + Geist Mono via `geist/font/sans` and `geist/font/mono`; keep Noto Sans/Serif TC as CSS fallback only (drop `next/font` Noto entries if any).
- [ ] `apps/web/components/theme-provider.tsx` — wrapper component re-exporting `next-themes`'s `ThemeProvider` with project defaults.
- [ ] Rename Tailwind alias `muted` (background) → `ink-muted` (foreground text) ONLY in the legacy alias-bridge block. New `muted` token follows shadcn semantics (background). Audit + rename any existing `text-muted` usages to `text-ink-muted` via grep — implementer's task.
- [ ] Verify: `npx eslint .`, `npm run typecheck`, `npm run build -w @vakwen/web` all green.

**Verification gate:** `apps/web` builds. Existing pages render identical (visually) because alias bridge keeps legacy classes working. No component swaps yet.

**Files touched:** ~6 files. Single commit.

---

## Phase 1 — Wave A primitives + adapter shims

**Goal:** install shadcn primitives, adapt existing custom UI components to re-export shadcn equivalents. No call-site changes; existing component API surface preserved via shims.

**Deliverables**

- [ ] `npx shadcn@latest add -c apps/web button card input label form select dropdown-menu dialog alert-dialog sheet tabs tooltip popover badge separator skeleton sonner command scroll-area switch checkbox radio-group`
- [ ] Audit each generated file under `apps/web/components/ui/` for correctness (shadcn's defaults are reasonable; no edits expected).
- [ ] Update **adapter shims** (preserve existing exports, internally use shadcn):
  - `apps/web/components/ui/Button.tsx` — keep `Button` + `buttonVariants` exports; rewrite to wrap shadcn `Button`; map old variant names (`default → default`, `secondary → secondary`, `ghost → ghost`); add new variants (`destructive`, `outline`, `link`); add new sizes (`xs`, `lg`, `icon`).
  - `apps/web/components/ui/Card.tsx` — re-export shadcn `Card`, `CardHeader`, `CardContent`, `CardFooter`. Preserve any custom prop API by adding a thin wrapper.
  - `apps/web/components/ui/Drawer.tsx` — replace internal impl with shadcn `Sheet` (rename `<Drawer>` → wraps `<Sheet>`; keep export name `Drawer`).
  - `apps/web/components/ui/Popover.tsx` — re-export shadcn `Popover`, `PopoverTrigger`, `PopoverContent`.
  - `apps/web/components/ui/Tabs.tsx` — re-export shadcn `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`. Preserve existing test IDs (`admin-settings-tab-*`).
  - `apps/web/components/ui/TooltipInfo.tsx` — wrap shadcn `Tooltip` with the existing `<TooltipInfo content={...}>` API.
- [ ] `apps/web/components/ui/Money.tsx` — new component. `<Money value={1234.56} currency="NT$" />` renders with Geist Mono + `tabular-nums`. Used in every numeric cell going forward.
- [ ] Sonner mounted in `app/layout.tsx` for toasts.
- [ ] Verify: `npx eslint .`, `npm run typecheck`, `npm run test --prefix apps/web`, `npm run build -w @vakwen/web` all green. No E2E run yet (deferred to Phase 4 where visual changes accumulate).

**Verification gate:** All call sites compile. Existing custom-component imports unchanged. Snapshots of unit tests pass (Vitest). Visual diff: tooltips/dialogs may look slightly different (shadcn defaults) but the shell, pages, fonts unchanged.

**Files touched:** ~25–30 generated files in `components/ui/`, 6 adapter shims, 1 new `Money.tsx`, 1 layout update. Single commit (large diff but mostly generated).

---

## Phase 2 — Theme toggle + accent palette + density

**Goal:** ship user-facing theme switching. End of this phase: user can change light/dark/system, pick from 8 accent presets, switch density.

**Deliverables**

- [ ] DB migration: add `theme_accent` and `density` columns to `user_preferences` table.
- [ ] `apps/api/src/persistence/postgres.ts` + `memory.ts` — read/write new columns.
- [ ] `libs/shared-types/src/user-preferences.ts` (or wherever the DTO lives) — extend type with `themeAccent` and `density`. No runtime export changes (per Turbopack rule).
- [ ] `apps/web/lib/theme.ts` — accent → CSS variable map (8 presets, light + dark values).
- [ ] `apps/web/components/layout/ThemeToggle.tsx` — 3-state segmented control (☀ / 🌓 / 🌙) in `TopBar`.
- [ ] `apps/web/components/layout/AccentSwatchPicker.tsx` — row of 8 swatches; click sets accent. Lives in Settings → Display.
- [ ] `apps/web/components/layout/DensityToggle.tsx` — switch in Settings → Display.
- [ ] Effective preferences resolver hook in `apps/web/features/settings/hooks/useEffectivePreferences.ts` — reads DTO, applies CSS vars on `<html>`, sets `data-density` attribute.
- [ ] AdminSettings panel: add Display tab (or extend existing) with accent + density admin defaults.
- [ ] `apps/web/features/settings/i18n.ts` — new keys for `Theme`, `Light`, `System`, `Dark`, `Accent color`, `Density`, `Compact`, `Comfortable`. Strings only, no functions (per `nextjs-i18n-serialization.md`).
- [ ] Visual QA every authenticated route in light + dark + each accent (admin walks through). Capture screenshots into `docs/004-notes/ui-reshape-shadcn/qa-202605XXX-theme-pass/`.

**Verification gate:** Lint + typecheck + full vitest + full Postgres integration + suite 6 (E2E bypass:mem) + suite 7 (E2E oauth:mem). E2E test added: theme toggle persists, accent change persists, density change persists.

**Files touched:** ~15 files + migration + 1 DTO. 2–3 commits (DB+API, web wiring, AdminSettings UI).

---

## Phase 3 — Sidebar + AppShell decomposition + command palette

**Goal:** retire 1458-line `AppShell` and 532-line `TopBar`. Replace with shadcn `Sidebar` block + decomposed top bar + ⌘K palette.

**Deliverables**

- [ ] `npx shadcn@latest add -c apps/web sidebar breadcrumb navigation-menu avatar progress`
- [ ] `apps/web/components/layout/AppSidebar.tsx` — primary nav using shadcn `Sidebar`.
- [ ] `apps/web/components/layout/AppShell.tsx` — slim down to: `SidebarProvider` + `AppSidebar` + `SidebarInset` containing the page. Target: <300 lines.
- [ ] `apps/web/components/layout/TopBar.tsx` — slim down: brand link + `Breadcrumb` + `<CommandPalette>` trigger + `<NotificationBell>` + `<ProfileMenu>` + `<ThemeToggle>`. Target: <200 lines.
- [ ] `apps/web/components/layout/CommandPalette.tsx` — shadcn `CommandDialog`. Routes, actions ("Add transaction"), tickers (typeahead → API), shortcuts (`Switch to dark`, `Change accent → Emerald`).
- [ ] Update `apps/web/components/admin/AdminShell.tsx` to mirror pattern with the secondary tint.
- [ ] All page testids preserved.

**Verification gate:** Lint + typecheck + full vitest + suite 6 + suite 7. Page-object updates required in `libs/test-e2e/src/pages/` for any sidebar locator additions.

**Files touched:** ~10 files. 1–2 commits.

---

## Phase 4 — DataTable migration (retire dual-DOM)

**Goal:** single-DOM responsive tables. Retire the `hidden lg:block` + `lg:hidden` dual layout.

**Deliverables**

- [ ] `npx shadcn@latest add -c apps/web table` + add `data-table` recipe.
- [ ] `apps/web/components/ui/DataTable.tsx` — generic wrapper around shadcn `Table` with: column priority API, sticky first column on `md<`, optional row-stack at `sm<`, density-aware row heights via `--row-h` token.
- [ ] Migrate tables (one per commit):
  - `apps/web/components/portfolio/HoldingsTable.tsx`
  - `apps/web/components/portfolio/TransactionHistoryTable.tsx`
  - `apps/web/components/portfolio/FeeProfilesTable.tsx`
  - `apps/web/components/admin/Admin{Audit,Instruments,Invites,Providers,Users}*.tsx`
- [ ] Delete the `ProviderRow` / `ProviderCard` pair; replace with single `DataTable`.
- [ ] Update page objects in lockstep with each migration.
- [ ] Update `.claude/rules/responsive-dual-layout-testid-prefixes.md` — mark superseded; keep history per `doc-management.md`.
- [ ] Update `.claude/rules/playwright-page-object-testid-drift.md` — relevant grep recipes still apply.

**Verification gate:** Lint + typecheck + full vitest + full Postgres integration + suite 6 + suite 7 + suite 8 (HTTP). Heaviest test phase.

**Files touched:** ~15–20 files (tables + page objects). 5–7 commits.

---

## Phase 5 — IA: dividends merge, AuthShell, dashboard re-prio

**Goal:** ship the IA changes.

**Deliverables**

- [ ] Merge `/dividends` + `/dividends/review`: route becomes `/dividends` with a `?status=needs-review` query state surfaced as a filter chip.
- [ ] `apps/web/components/layout/AuthShell.tsx` — centered card, no app chrome. Used by `/login`, `/auth/error`, `/invite/[code]`.
- [ ] Public share view at `/share/[token]` — distinct visitor chrome per design doc Section 8 #6.
- [ ] Dashboard re-prioritization: portfolio total + day Δ + biggest movers above the fold; demote `ActionCenterSection` + `QuickTransactionSection` to a single floating ⨁ button that opens a `Sheet` quick-action panel.
- [ ] Verify: full eight-suite test gate.

**Files touched:** ~10–12 files. 2–3 commits.

---

## Phase 6 — Charts on shadcn `chart` recipe

**Goal:** unify chart rendering, get dark mode for free.

**Deliverables**

- [ ] `npx shadcn@latest add -c apps/web chart`
- [ ] Migrate `PortfolioTrendCard`, `AllocationSnapshotCard`, any other Recharts consumers to use shadcn `ChartContainer` + theme-aware config.
- [ ] Charts derive accent from `--primary` (auto-follows user's accent choice).

**Files touched:** ~5 files. 1 commit.

---

## Phase 7 — Cleanup

**Goal:** delete the alias bridge and dead code.

**Deliverables**

- [ ] Delete `glass-panel`, `glass-inset`, `surface-glass`, `bg-sheen` CSS rules from `globals.css`.
- [ ] Delete legacy token alias-bridge block.
- [ ] Audit and remove unused `apps/web/components/ui/FloatingStatsBubble.tsx` if no consumers remain.
- [ ] Remove legacy `Noto Serif TC` font load if zero consumers.
- [ ] Delete adapter shims in `apps/web/components/ui/{Button,Card,Drawer,Popover,Tabs,TooltipInfo}.tsx` once every consumer imports shadcn directly. If timeline is tight, defer this last step to a follow-up ticket — shims are not load-bearing.
- [ ] Update `.claude/rules/` for any rule that referenced retired patterns.

**Files touched:** ~5–10 files. 1 commit.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tailwind alias rename (`muted`) breaks call sites | High | Grep audit at Phase 0; rename in same commit. |
| shadcn primitives don't match existing API shape | Med | Adapter shims in Phase 1 preserve call-site API. |
| Playwright tests fail because of bundled-standalone staleness | Med | Always rebuild `apps/web/.next/standalone/` before suites 6/7 (per existing rule). |
| Page-object locator drift in Phase 4 | High | Update locators in lockstep with each table migration; Code Reviewer cross-greps. |
| Test ID drift on tab triggers in Phase 3 | Med | Architect-design list of locked test IDs before Phase 3 commit (per existing rule). |
| Light/dark token gap on a route nobody tested | Med | Phase 2 visual QA walks every authenticated route + admin in both modes; screenshots saved. |
| Density mode introduces table-row layout regressions | Low | Density toggle ships behind a user preference; existing default is compact (close to current row heights). |

---

## Commit message format

This reshape is on the `ui-enhancement` waiver track (no Linear ticket). PR will carry `waiver:linear-ticket` label with `## Waiver` section in body per `commit-format.md`. Commits use:

```
type(scope): subject

Phase N — short context.
```

Example: `feat(web): adopt shadcn substrate (Phase 0)`.
