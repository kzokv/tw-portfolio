# Transition Note — UI Reshape Phase 3a + 3b

**Date:** 2026-05-16  
**Branch:** `worktree-ui-reshape-shadcn`  
**Commits:** `4e5ca08` (Phase 3a — shadcn primitives) · `97eff19` (Phase 3b — renderSection extraction)  
**Status:** Frozen post-merge. Pre-merge corrections allowed per `doc-management.md`; post-merge immutable.  
**Parent spec:** `phase-3-spec-202605161110-shell-decomp.md` §3a + §3b  
**Validator:** 8/8 green · **Code Reviewer:** CLEAN, 0 findings

---

## Scope — what landed

### Phase 3a — Wave B shadcn primitives

Five new shadcn components added to `apps/web/components/ui/shadcn/`:

| Primitive | LOC | Purpose in later phases |
|---|---|---|
| `sidebar.tsx` | 773 | `SidebarProvider` / `AppSidebar` / `SidebarInset` in Phase 3c |
| `breadcrumb.tsx` | 115 | TopBar breadcrumb in Phase 3c |
| `navigation-menu.tsx` | 128 | TopBar nav; settings sub-nav in Phase 3d |
| `avatar.tsx` | 50 | `ProfileMenu` replaces hand-rolled `UserAvatarButton` in Phase 3c |
| `progress.tsx` | 28 | Progress indicators (backfill, upload flows) |

(`command` was already installed in Phase 1 — not reinstalled.)

`apps/web/lib/hooks/use-mobile.tsx` added (`useIsMobile()` required by `sidebar.tsx`'s Sheet-based mobile mode).

Tailwind config gained sidebar CSS custom-property tokens (`--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`). Inert until `SidebarProvider` wraps the layout in Phase 3c.

Zero call-site changes. The install is purely additive.

### Phase 3b — `renderSection` extraction

AppShell is now `children`-driven for all pages. Three new `*Client` components own their section JSX. Two DOM-invisible context providers bridge shared shell state to Clients. AppShell shrinks from 1,458 → ~920 LOC.

**New files:**

| File | Content |
|---|---|
| `apps/web/components/layout/AppShellDataContext.tsx` | `AppShellData` context + `AppShellDataProvider` + `useAppShellData()` hook |
| `apps/web/components/layout/CardLayoutResetContext.tsx` | `CardLayoutResetCounts` context + `CardLayoutResetProvider` + `useCardLayoutResetCount(page)` hook |
| `apps/web/components/layout/SectionHeroPanels.tsx` | `RouteHeroPanel` + `StatusStripCard` helpers (moved from AppShell) |
| `apps/web/components/dashboard/DashboardClient.tsx` | Former `renderSection` case `"dashboard"` JSX; calls `useDashboardPerformance({ enabled: true })` |
| `apps/web/components/portfolio/PortfolioClient.tsx` | Former `renderSection` case `"portfolio"` JSX |
| `apps/web/components/transactions/TransactionsClient.tsx` | Former `renderSection` case `"transactions"` JSX; calls `useRecentTransactions({ enabled: true })` |

**Modified files:**

| File | Change |
|---|---|
| `apps/web/components/layout/AppShell.tsx` | Deletes `renderSection()`, `RouteHeroPanel`, `StatusStripCard`. Wraps `<main>` in `<AppShellDataProvider>` + `<CardLayoutResetProvider>` (zero DOM nodes). Body: `children ?? null`. |
| `apps/web/app/dashboard/page.tsx` | `<AppShell ...><DashboardClient /></AppShell>` |
| `apps/web/app/portfolio/page.tsx` | `<AppShell ...><PortfolioClient /></AppShell>` |
| `apps/web/app/transactions/page.tsx` | `<AppShell ...><TransactionsClient /></AppShell>` |

**Unchanged:** dividends, cash-ledger, sharing, tickers pages (already used the children pattern). AdminShell (Phase 3f). All E2E specs. All API files. No database migrations.

---

## Hook ownership matrix POST-3b

| Hook | Location | Rationale |
|---|---|---|
| `useDashboardData` | **AppShell** | Chrome-critical + cross-section (locale, instruments, accounts, feeProfiles). Single fetch for 3 pages. |
| `useDashboardPerformance` | **DashboardClient** | Was gated `enabled: section === "dashboard"`. Now `enabled: true` — Client only mounts on dashboard. |
| `useRecentTransactions` | **TransactionsClient** | Was gated `enabled: section === "transactions"`. Now `enabled: true`. |
| `useTransactionSubmission` | **AppShell** | `transaction-status` banner is shell-level chrome. |
| `useTransactionMutations` | **AppShell** | `mutation-status` + `recompute-status` banners span sections. `recomputingSymbols` consumed by HoldingsTable on dashboard AND portfolio. |
| `useRecomputeAction` | **AppShell** | `recompute-status` banner is shell-level. |
| `useProfile` | **AppShell** | TopBar avatar. |
| `useNotifications` | **AppShell** | SSE pre-connect (`enabled: true`) — bell chrome is shell-level. |
| `useSharedContextOwnerId` | **AppShell** | Drives `?as=ownerId` deep-link guard. |
| `useEffectiveRanges` | **AppShell** | Range-snap `useEffect` (today's date within range) lives here; exposed via context. |
| `useSettingsSave` | **AppShell** | SettingsDrawer host — stays until Phase 3d. |

`performanceRange` state and `customizeRangesOpen` state live in AppShell because the range-snap `useEffect` and the popover depend on them. DashboardClient reads via context and passes `range` into `useDashboardPerformance`.

---

## New context surfaces

### `AppShellDataContext`

```ts
export interface AppShellData {
  dashboard: ReturnType<typeof useDashboardData>;
  uiDict: ReturnType<typeof getDictionary>;
  locale: LocaleCode;
  isSharedContext: boolean;
  transactionSubmission: ReturnType<typeof useTransactionSubmission>;
  mutations: ReturnType<typeof useTransactionMutations>;
  recomputeAction: ReturnType<typeof useRecomputeAction>;
  transactionAccountOptions: Array<{ id; name; feeProfileName; defaultCurrency; accountType? }>;
  performanceRange: DashboardPerformanceRange;
  setPerformanceRange: (range: DashboardPerformanceRange) => void;
  effectiveRanges: DashboardPerformanceRange[];
  refetchEffectiveRanges: () => void;
  customizeRangesOpen: boolean;
  setCustomizeRangesOpen: (open: boolean) => void;
  generateSnapshots: () => Promise<void>;
  isGeneratingSnapshots: boolean;
  setDrawerOpen: (open: boolean) => void;
  isBootstrapping: boolean;
  isI18nReady: boolean;
  contextRefreshSignal: number;   // ← see "contextRefreshSignal" section below
}
```

`useAppShellData()` throws immediately if called outside `<AppShellDataProvider>` — hard crash is intentional (loud failure > silent degradation).

### `CardLayoutResetContext`

```ts
export interface CardLayoutResetCounts {
  dashboard: number;
  transactions: number;
  portfolio: number;
}
```

AppShell owns `useState<CardLayoutResetCounts>`. `SettingsDrawer` calls `setCardLayoutResetCounts` via `onLayoutReset` / `onPageLayoutReset`. Clients read via `useCardLayoutResetCount("dashboard" | "portfolio" | "transactions")` and pass as `key` prop to `SortableCardGrid` — the key change unmounts/remounts the grid, resetting card order.

---

## Preserved on purpose

| Thing | Why kept | Where it moves |
|---|---|---|
| `section` prop on `AppShell` | Still drives `derivedShellTitle`, `derivedShellDescription`, `activeSectionOverride ?? section` for SideNavigation active state | Deleted in **Phase 3c** when breadcrumb + sidebar active-state replaces these derivations |
| `SettingsDrawer` in AppShell | Moving it would require 3d's `/settings/*` route wiring — out of scope for a zero-visual-change commit | Migrates in **Phase 3d** |
| All status banners in AppShell `<main>` | Shell-level chrome; must render above page content regardless of which page is active | Unchanged through all remaining phases |
| `useTransactionSubmission`, `useTransactionMutations`, `useRecomputeAction` in AppShell | Status banners + `recomputingSymbols` span sections — moving them would require cross-page pub/sub or duplicate hooks | Stay in AppShell until 3d/3e shape is clearer |

---

## Deviations from locked design

### 1. `contextRefreshSignal` counter + `firstSignalRef` skip-initial-mount pattern

**What the design specified:** AppShell would call `performance.refresh()` / `recentTransactions.refresh()` directly at 5 trigger sites when cross-section data needed re-fetching.

**What landed:** A `contextRefreshSignal: number` counter in `AppShellDataContext`. DashboardClient and TransactionsClient subscribe via:

```ts
const { contextRefreshSignal, dashboard } = useAppShellData();
const firstSignalRef = useRef(true);

useEffect(() => {
  if (firstSignalRef.current) { firstSignalRef.current = false; return; }
  dashboard.refresh();          // or recentTransactions.refresh()
}, [contextRefreshSignal]);
```

The `firstSignalRef` skips the initial mount to avoid a double-fetch (the hooks already fetch on mount).

**Why:** After `useDashboardPerformance` and `useRecentTransactions` moved into their Clients, AppShell no longer held references to their refresh functions. The counter is the clean decoupled equivalent. All 6 trigger sites wired in AppShell:

1. Context-cookie change handler (`refreshContextDependentData`)
2. Transaction submit callback (`refreshAfterTransaction`)
3. Recompute confirm callback (`refreshAfterRecompute`)
4. Snapshot generation callback (`onSnapshotsDone`)
5. Global-error retry `onClick`
6. Reporting-currency save (`onReportingCurrencySaved`)

**Ratification:** Code Reviewer confirmed all 6 sites present; pattern judged behavior-identical. CLEAN.

---

### 2. `hasOwnerEmptyRecentTransactions` length-check dropped

**What the design specified:** `hasOwnerEmptyRecentTransactions` in AppShell's shared-context dict override logic — a length check on `useRecentTransactions().items` before conditionally overriding `dict.transactions.recentLedgerEmpty`.

**What landed:** Unconditional override of `dict.transactions.recentLedgerEmpty` in shared context (AppShell lines 181–183).

**Why:** `useRecentTransactions` moved to TransactionsClient; `items` is no longer observable in AppShell. The length check cannot be replicated without threading items back up through context.

**Behavior-identical because:** `dict.transactions.recentLedgerEmpty` is only consumed in `RecentTransactionsCard.tsx:42` inside the `items.length === 0` empty-state branch. When items are present the branch doesn't render, so the unconditional override is harmless. The inline comment at AppShell line 163 documents this.

**Ratification:** Code Reviewer confirmed behavior-identical. CLEAN.

---

## Skeleton gate

**Before:** AppShell held:
```ts
const hasCustomChildren = children !== undefined;
const showPageSkeleton = !hasCustomChildren && (dashboard.isBootstrapping || !isI18nReady);
```

After 3b, `hasCustomChildren` is always `true`, so the old gate was always `false`.

**Fix:** Each Client owns the gate:
```tsx
const { isBootstrapping, isI18nReady } = useAppShellData();
if (isBootstrapping || !isI18nReady) return <DashboardLoading />;
```

Pattern is identical across DashboardClient, PortfolioClient, TransactionsClient.

---

## Verification — 8-suite gate

```
Suite 1  lint (eslint root)         PASS — exit 0, 0 warnings
Suite 2  typecheck (tsc --noEmit)   PASS — all configs clean
Suite 3  web vitest                 PASS — 402 passed (53 files, 17.98s)
Suite 4  api vitest                 PASS — 977 passed (80 files, 7.88s)
Suite 5  api integration            PASS — 699 passed, 1 skipped (73 files, ~5.5m)
Suite 6  E2E bypass                 PASS — 210 passed, 1 skipped (2.2m)
Suite 7  E2E oauth                  PASS — 126 passed (1.2m; Next.js bundle rebuilt fresh)
Suite 8  api http                   PASS — 276 passed, 2 skipped (23.2s)
lsof :4000/:3333/:4445/:4099        CLEAN before AND after
```

Zero test files modified across either commit.

---

## Follow-ups deferred to next team sessions

| Sub-phase | Description | Dependency |
|---|---|---|
| **3c** | Build new `AppShell` + `AppSidebar` + decomposed `TopBar`. Rewrite AppShell to `<SidebarProvider>` + `<AppSidebar>` + `<SidebarInset>`. Add `BreadcrumbProvider`. Rebuild `NotificationBell` (shadcn Popover) + `ProfileMenu` (DropdownMenu + Avatar). Delete `UserAvatarButton.tsx`. Target: AppShell ≤300 LOC, TopBar ≤200 LOC. Visual change intentional. | Requires 3b (AppShell children-driven) ✓ |
| **3d** | Migrate SettingsDrawer to `/settings/*` routes. New server routes (`/settings/profile`, `/settings/display`, `/settings/accounts`, etc.). Auto-save model. ~26 E2E spec files rewritten. `SettingsDrawer.tsx` deleted. | Requires 3c (settings linked from new ProfileMenu) |
| **3e** | `CommandDialog` (⌘K). Full scope: routes + ticker typeahead + actions (Switch theme, Change accent, Add transaction). Reuses `/market-data/search` endpoint. | Requires 3c (`CommandPaletteTrigger` in new TopBar) |
| **3f** | Admin shell mirror. `AdminShell` adopts `AppSidebar variant="admin"` (3px inset warning rail). `AdminSidebar.tsx` deleted. | Requires 3c (new AppSidebar primitive) |
| **3g** | Mobile responsive gate. Sheet-based mobile sidebar from brand/logo trigger. Mobile settings inner nav (top dropdown). `useViewport()` wiring. | Requires 3c (mobile sidebar is a 3c deliverable) |

3c is the critical path; 3d–3g can run in parallel after 3c lands clean.
