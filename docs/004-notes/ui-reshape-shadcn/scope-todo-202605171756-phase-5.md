---
slug: ui-reshape-phase-5
source: scope-grill
created: 2026-05-17
tickets: []
required_reading:
  - docs/004-notes/ui-reshape-shadcn/design-202605151200-locked-scope.md
  - docs/004-notes/ui-reshape-shadcn/scope-todo-202605151201-phases.md
  - docs/004-notes/ui-reshape-shadcn/scope-todo-202605171244-phase-4.md
superseded_by: null
---

# Todo: Phase 5 — IA: dividends merge, AuthShell, dashboard re-prio

> **For agents starting a fresh session:** read all files listed in `required_reading` before starting implementation. This todo supersedes the Phase 5 line items in `scope-todo-202605151201-phases.md` (which had an under-scoped file count and missing per-decision detail — corrected per scope-grill session 2026-05-17).

Waiver track per `commit-format.md` (`ui-reshape-shadcn`; no Linear ticket; PR carries `waiver:linear-ticket` label with `## Waiver` section).

---

## Scope-grill outcomes (2026-05-17)

Six locked decisions:

1. **Dividends merge** — Tabs on `/dividends` with `?view=calendar` (default) / `?view=ledger`. NOT a quick-action segmented control. NOT a calendar-deletion.
2. **"Needs review" chip** — ledger tab toolbar only. Toggle, not button. URL `?status=…` without `?view=` implies ledger.
3. **`/dividends/review` cleanup** — DELETE the route. No backward-compat redirect. Update every caller in the merge commit.
4. **`BiggestMoversCard`** — client-derived from `dashboard.holdings`. Top 5 by `|dailyChangePercent|`. Inside the hero, non-draggable.
5. **`DashboardHero`** — slim, ~50 LOC, total + day Δ. Delete `SummarySection.tsx` (orphaned).
6. **Floating ⨁ Sheet** — Add transaction / Recompute / Generate snapshots. Hidden on shared context. Delete `ActionCenterSection.tsx` + `QuickTransactionSection.tsx`. Integrity issue → standalone persistent Alert above hero.
7. **`AuthShell`** — children-only API. Migrate `/login`, `/auth/error`, `/invite/[code]`.
8. **Public share polish** — top strip + footer CTA + i18n keys only. No body restructure.

---

## Commit cadence (6 commits proposed)

### Commit 1 — `feat(web): merge /dividends + /dividends/review into tabbed route (Phase 5a)`

- [ ] Create `apps/web/components/dividends/DividendsTabsClient.tsx` — shadcn `Tabs` wrapper with `calendar` / `ledger` values driven by `?view=` query param.
  - Default tab: `calendar` (when `view` absent AND `status`/other ledger-only params absent).
  - Implied tab: `ledger` (when `view=ledger` OR any ledger-only param present without `view=calendar`).
  - URL sync via `router.replace(...)` + `window.history.replaceState(...)` per `.claude/rules/playwright-navigation-patterns.md` (sync URL for E2E `page.url()` assertions).
  - Tab testids: `dividends-tab-calendar`, `dividends-tab-ledger`.
  - Tab switch from ledger → calendar drops all ledger-only params (status, sortBy, etc.).
- [ ] Rewrite `apps/web/app/dividends/page.tsx` to be the tabs container. Server-side: fetch BOTH calendar AND review data (parallel `Promise.all`), pass both to `DividendsTabsClient`. Lazy-render is acceptable but the SSR-fetched data is the simpler path for now.
- [ ] **DELETE** `apps/web/app/dividends/review/page.tsx` (entire `review/` directory). No redirect.
- [ ] **DELETE** the `/dividends/review` entry from `apps/web/lib/breadcrumb-titles.ts` if present.
- [ ] Update `DividendReviewClient` to use the ledger-tab toolbar slot for the "Needs review" chip. Chip testid: `dividends-needs-review-chip`. Toggle behavior: clicking flips `?status=needs-review` ↔ `?status=all`.
- [ ] Grep for `/dividends/review` references across the repo: `grep -rln "/dividends/review" apps/web --include="*.ts" --include="*.tsx" | grep -v .next`
  - Update every match: internal links, navigation calls, breadcrumb-titles fallbacks, E2E spec URL strings.
- [ ] Update affected E2E specs (`apps/web/tests/e2e/specs/dividend-review-aaa.spec.ts` + siblings) — every `navigateToRoute("/dividends/review")` becomes `navigateToRoute("/dividends?view=ledger")`. Every `page.url()` assertion containing `dividends/review` becomes `dividends?view=ledger`.
- [ ] Update page-object: `libs/test-e2e/src/pages/dividends/DividendReviewPage.ts` — `navigateToReview()` helper points at `/dividends?view=ledger`.
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 2 — `feat(web): AuthShell component (Phase 5b)`

- [ ] Create `apps/web/components/layout/AuthShell.tsx` — children-only API:
  ```tsx
  export function AuthShell({ children }: { children: ReactNode }) {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-background px-4"
        data-testid="auth-shell"
      >
        <Card className="w-full max-w-sm">{children}</Card>
      </main>
    );
  }
  ```
- [ ] Migrate `apps/web/app/login/page.tsx` — replace `<main>` + `<Card>` with `<AuthShell>`. Existing `Card` removed (the shell provides it).
- [ ] Migrate `apps/web/app/auth/error/page.tsx` — same pattern.
- [ ] Migrate `apps/web/app/invite/[code]/page.tsx` — both states (initial + already-claimed).
- [ ] No new i18n keys (children-only; pages keep their own copy).
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7 (login/error/invite flows).

### Commit 3 — `feat(web): public share view top strip + footer CTA (Phase 5c)`

- [ ] Edit `apps/web/app/share/[token]/page.tsx`:
  - Add slim top strip rendering "Shared by {ownerName} · Powered by Vakwen". Owner name from `view.ownerName` (verify DTO has this field; if not, add to `PublicShareViewDto` + API serialization). Testid: `public-share-top-strip`.
  - Add footer CTA: "Sign up for your own portfolio" linking to `/login`. Testid: `public-share-signup-cta`.
- [ ] Add i18n keys for both strings (English + zh-TW):
  - `sharing.publicLinks.publicView.sharedByLabel` ("Shared by {ownerName}")
  - `sharing.publicLinks.publicView.poweredByLabel` ("Powered by Vakwen")
  - `sharing.publicLinks.publicView.signUpCta` ("Sign up for your own portfolio")
- [ ] Verify read-only ticker detail links work in shared context (no-op if they already do).
- [ ] Verify: lint + typecheck + web vitest + suite 6.

### Commit 4 — `feat(web): dashboard hero + biggest movers (Phase 5d)`

- [ ] Create `apps/web/components/dashboard/DashboardHero.tsx` (~50 LOC). Props: `summary: DashboardOverviewSummaryDto`, `locale`, `dict`. Renders:
  - Total portfolio value (formatted via `formatCurrencyAmount`, reporting currency)
  - Day Δ (amount + percent, with tone via `getDailyChangeTone`)
  - Layout: stacked at `<sm`, side-by-side `≥sm`.
  - Testids: `dashboard-hero`, `dashboard-hero-total`, `dashboard-hero-day-delta`.
- [ ] Create `apps/web/components/dashboard/BiggestMoversCard.tsx`. Props: `holdings: DashboardOverviewHoldingDto[]`, `locale`, `dict`. Derives:
  - Filter holdings where `dailyChangePercent !== null` and `quoteStatus !== "missing"`.
  - Sort by `|dailyChangePercent|` desc.
  - Take top 5.
  - Render as compact list: ticker · % change · absolute Δ.
  - Empty state when no eligible holdings.
  - Testid: `dashboard-biggest-movers`, `dashboard-biggest-movers-row-{ticker}`.
- [ ] Refactor `apps/web/components/dashboard/DashboardClient.tsx`:
  - Render `<DashboardHero>` ABOVE `<SortableCardGrid>`.
  - Render `<BiggestMoversCard>` either inside the hero block or as a sibling at `lg+` (implementer's call — locked: non-draggable, NOT in `DASHBOARD_CARDS` registry).
  - Hero block layout container: hero metrics on the left, BiggestMovers on the right at `lg+`; stacked below at `<lg`.
- [ ] **DELETE** `apps/web/components/dashboard/SummarySection.tsx` (orphaned, unused).
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 5 — `feat(web): floating quick-actions sheet (Phase 5e)`

- [ ] Create `apps/web/components/dashboard/FloatingQuickActions.tsx`:
  - Floating button (shadcn `Button` + lucide `Plus` icon), `fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 safe-area-inset-bottom`. Testid: `floating-quick-actions-trigger`. Hidden when `isSharedContext === true`.
  - Click opens shadcn `Sheet` (side="bottom" on `<md`, side="right" on `≥md`). Testid: `floating-quick-actions-sheet`.
  - Sheet body lists 3 actions:
    1. **Add transaction** — opens existing `RecordTransactionDialog`. Testid: `floating-action-add-transaction`.
    2. **Recompute portfolio** — invokes `recomputeAction.runRecompute` (existing hook, supports `{ skipConfirm }` per Phase 3e). Testid: `floating-action-recompute`.
    3. **Generate snapshots** — invokes `generateSnapshots` (existing handler). Testid: `floating-action-generate-snapshots`.
  - Sheet has `SheetTitle` (sr-only acceptable per shadcn a11y rule).
- [ ] Wire `<FloatingQuickActions>` into `DashboardClient.tsx` (renders alongside the hero + grid).
- [ ] Render persistent `<Alert variant="destructive">` above `<DashboardHero>` when `dashboard.actions.integrityIssue !== null`. Includes "Fix in Settings" `<Button asChild><Link href="/settings">…</Link></Button>`. Testid: `dashboard-integrity-alert`. NOT dismissible.
- [ ] **DELETE** `apps/web/components/dashboard/ActionCenterSection.tsx`.
- [ ] **DELETE** `apps/web/components/dashboard/QuickTransactionSection.tsx`.
- [ ] Update `apps/web/components/dashboard/cards.ts`:
  - Remove `{ slug: "action-center", fullWidth: true }` entry from `DASHBOARD_CARDS`.
  - `mergeCardOrder` already drops unknown slugs from user preferences; no migration needed.
- [ ] Remove the `case "action-center":` branch from `DashboardClient.tsx`'s `SortableCardGrid` switch.
- [ ] i18n keys for floating actions (English + zh-TW):
  - `dashboard.floatingActions.triggerLabel` ("Quick actions")
  - `dashboard.floatingActions.sheetTitle` ("Quick actions")
  - `dashboard.floatingActions.addTransactionLabel` ("Add transaction")
  - `dashboard.floatingActions.recomputeLabel` ("Recompute portfolio")
  - `dashboard.floatingActions.generateSnapshotsLabel` ("Generate snapshots")
  - `dashboard.integrityAlert.fixInSettingsCta` ("Fix in Settings")
- [ ] Verify: lint + typecheck + web vitest + suite 6 + suite 7.

### Commit 6 — `test(web): mobile + E2E coverage for Phase 5 surfaces (Phase 5f)`

- [ ] New E2E spec `apps/web/tests/e2e/specs/dividends-tabs-aaa.spec.ts`:
  - `[tab-A]` `/dividends` defaults to calendar tab.
  - `[tab-B]` clicking ledger tab navigates to `?view=ledger` and renders `DividendReviewClient`.
  - `[tab-C]` `/dividends?status=needs-review` (no `view=`) auto-resolves to ledger tab with filter applied.
  - `[tab-D]` "Needs review" chip toggles `?status=needs-review` ↔ `?status=all`.
  - `[tab-E]` tab switch from ledger → calendar drops ledger-only params.
- [ ] New E2E spec `apps/web/tests/e2e/specs/dashboard-hero-aaa.spec.ts`:
  - `[hero-A]` `DashboardHero` renders total + day Δ above the grid.
  - `[hero-B]` `BiggestMoversCard` renders top-5 movers when holdings have quotes.
  - `[hero-C]` `BiggestMoversCard` shows empty state when no holdings have quotes.
  - `[hero-D]` integrity Alert appears when `integrityIssue` present; "Fix in Settings" routes to `/settings`.
- [ ] New E2E spec `apps/web/tests/e2e/specs/floating-quick-actions-aaa.spec.ts`:
  - `[floating-A]` button visible; opens sheet on click.
  - `[floating-B]` "Add transaction" opens `RecordTransactionDialog`.
  - `[floating-C]` "Recompute portfolio" invokes recompute (no confirm dialog).
  - `[floating-D]` button hidden when shared context active (via PortfolioSwitcher).
- [ ] Extend `apps/web/tests/e2e/specs/mobile-tables-aaa.spec.ts` OR new `mobile-dashboard-aaa.spec.ts`:
  - `[mobile-hero]` hero stacks vertically at `chromium-mobile` viewport.
  - `[mobile-floating]` floating ⨁ uses `bottom` Sheet variant at `<md`.
- [ ] Update page-object `libs/test-e2e/src/pages/dashboard/DashboardPage.ts`:
  - Add `dashboardHero`, `dashboardHeroTotal`, `dashboardHeroDayDelta`, `dashboardBiggestMovers`, `dashboardIntegrityAlert`, `floatingQuickActionsTrigger`, `floatingQuickActionsSheet` locators.
  - Drop any locators for the deleted `action-center` / `quick-transaction` slots.
- [ ] Run `/aaa` if any new spec needs assistant/page-object scaffolding beyond AppShellActions.
- [ ] **Full 8-suite gate** — lint, typecheck, web vitest, api unit + memory, Postgres integration, suites 6, 7, 8. Treat any failure as blocker.

---

## E2E test phase (per `/scope-grill` skill convention)

- [ ] Run `/aaa` to add or update E2E tests covering: dividends tabs + chip, dashboard hero + biggest movers, integrity alert, floating quick-actions sheet, mobile dashboard layout. (Likely yes — most new specs above need fixture extensions, especially `DashboardPage` locator additions and a new `FloatingQuickActionsPage` if added.)

---

## Open items (carry forward)

- [ ] **Tanstack revisit** (carried from Phase 4): if dashboard refactor surfaces a need for sortable/filterable lists beyond what `<DataTable>` covers, escalate per Phase 4 open item.
- [x] **Phase 7 dead-code sweep** (carried from Phase 4): `SummarySection.tsx` deletion gets us partway; full `glass-panel` / `glass-inset` retirement still pending. Phase 5d also drops `glass-inset` from the deleted dashboard sections, accelerating cleanup. Completed by Phase 7 cleanup on 2026-05-19; live app grep gates are zero-hit and the bridge is removed.

---

## Implementation notes (non-blocking)

1. **Tab URL discipline:** per `.claude/rules/playwright-navigation-patterns.md`, ALL tab navigation pairs `router.replace(...)` with `window.history.replaceState(...)` so `page.url()` updates synchronously for E2E assertions.
2. **Sidebar nav active state:** prefix-match on `/dividends` already covers both tab views — no nav changes needed.
3. **Breadcrumb:** stays as just "Dividends" for both tabs; the tab UI is the wayfinding affordance.
4. **Floating ⨁ z-index:** `z-40` keeps it below shadcn `Sheet` / `Dialog` (z-50) but above page content. Standard tailwind.
5. **Integrity Alert** uses shadcn's `<Alert>` primitive (per `.claude/rules/shadcn` — "Callouts use Alert"). Variant `destructive`.
6. **Floating ⨁ on mobile:** `Sheet` `side="bottom"` for thumb reach; on `≥md` use `side="right"` for spatial consistency with content.
7. **No backward-compat redirect** for `/dividends/review` (G1 = B). Bookmark holders get 404 — acceptable on the waiver track.
8. **Hero responsive:** total + delta side-by-side at `sm+`; movers below at `<lg`, beside at `lg+`. Hero composition handled inside `DashboardHero` (movers passed via slot OR rendered as sibling at consumer level — implementer's call).
9. **`DASHBOARD_CARDS` removal:** dropping `action-center` causes `mergeCardOrder` to drop stale references from user-preferences `cardOrder.dashboard` arrays. No migration needed (handled by existing logic).
10. **Public share data:** verify `view.ownerName` exists on `PublicShareViewDto`. If not, surface as an open item — backend addition required (out of original scope; may bump commit 3 or get carved out).
11. **AuthShell migration touchpoints:** check whether `/invite/[code]` page has secondary states (already-claimed, expired). Each state migrates inside the same `<AuthShell>` wrap.

---

## References

- Locked design: [`design-202605151200-locked-scope.md`](./design-202605151200-locked-scope.md) — §8 IA changes (items 4, 5, 6, 7)
- Parent scope-todo: [`scope-todo-202605151201-phases.md`](./scope-todo-202605151201-phases.md) (Phase 5 line items superseded by this file)
- Phase 4 reference: [`scope-todo-202605171244-phase-4.md`](./scope-todo-202605171244-phase-4.md) — for `<DataTable>` patterns + `useIsSmallScreen` hook reuse
- Project rules consulted:
  - `.claude/rules/playwright-navigation-patterns.md` — `router.replace` + `window.history.replaceState` pair for E2E URL state
  - `.claude/rules/shadcn-breadcrumb-sibling-structure.md` — sibling pattern (no risk here but worth re-reading)
  - `.claude/rules/playwright-page-object-testid-drift.md` — audit recipe per commit
  - `.claude/rules/playwright-web-bundle-rebuild.md` — rebuild discipline
- Linear tickets: none (waiver track)
