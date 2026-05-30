---
slug: kzo-162
source: scope-grill
created: 2026-04-25
tickets: [KZO-162]
required_reading:
  - docs/004-notes/kzo-158/transition-202604250900-kzo-161-customize-and-reorder.md
  - docs/004-notes/kzo-158/scope-todo-202604241500-kzo-161-refined.md
  - docs/004-notes/kzo-158/design-202604241630-kzo-161-initial.md
superseded_by: null
---

# Todo: KZO-162 — extend `<SortableCardGrid>` to non-dashboard pages

> **For agents starting a fresh session:** read all files in `required_reading` above before starting implementation. The KZO-161 transition guide is the canonical reference for the primitive's contract; the KZO-161 scope-todo carries the locked decisions that this ticket inherits.

## Scope summary

Wire the page-agnostic `<SortableCardGrid>` primitive (shipped in KZO-161) to two new surfaces:

- **Transactions right-stack** — the `[StatusStripCard, RecentTransactionsCard]` pair inside the existing 2-column transactions layout. `AddTransactionCard` stays anchored on the left.
- **Portfolio section** — the `[HoldingsTable, DividendsSection]` pair.

Plus a meaningful expansion of the Reset-Layout UX: the Display tab grows from one global Reset button to **four** always-visible buttons (per-page reset for each reorderable surface, plus "Reset all layouts"). This requires a non-trivial schema + persistence change — the `cardOrder` zod schema gains per-key null clears, and the JSONB merge in `setUserPreferencePatch` must interpret per-key null as "delete this sub-key" rather than "store null."

Out of scope: `/dividends`, `/cash-ledger` (sequential workflow content, not card grids), mobile TouchSensor coverage (manual-only carry-forward), card visibility toggles, admin-controlled card order.

## Implementation Steps

### Phase 1 — Schema + persistence (foundation)

- [ ] Extend `cardOrderSchema` in `apps/api/src/routes/registerRoutes.ts:1937` to accept three top-level keys (`dashboard`, `transactions`, `portfolio`), each typed as `z.union([z.array(z.string().min(1).max(64)).max(50), z.null()]).optional()`. Outer `.strict()` preserved.
- [ ] Update the JSONB merge in `setUserPreferencePatch`:
  - **Postgres backend:** apply patch then run `jsonb_strip_nulls()` over `cardOrder` so per-key null leaves are dropped rather than stored as `dashboard: null`.
  - **Memory backend:** explicit `delete obj.cardOrder[key]` when patch value is null after merge.
- [ ] Add a new test to `apps/api/test/integration/user-preferences.integration.test.ts` covering JSONB sub-key deletion semantics (Postgres + Memory parity). Assert `getUserPreferences` after `{ cardOrder: { dashboard: null } }` returns a `cardOrder` object that does NOT contain a `dashboard` field.

### Phase 2 — HTTP coverage

- [ ] Modify `apps/api/test/http/specs/user-preferences-card-order-aaa.http.spec.ts`:
  - **Replace** the existing `[card-order-api]: PATCH cardOrder with extra key (strict schema) → 400` test (lines 203-226) — change the rejected example from `portfolio` (now valid) to `cash-ledger` (durably out of scope per Q1).
  - **Add** acceptance tests: `cardOrder.transactions: [...]` valid round-trip; `cardOrder.portfolio: [...]` valid round-trip.
  - **Add** per-key null clear tests (one per key — `dashboard`, `transactions`, `portfolio`). Each PATCH `{ cardOrder: { {key}: null } }`, then GET, then assert the returned shape has the cleared key **absent** (not `null`). This is the round-trip regression guard against null-storage drift.
  - **Add** mixed-op test: `PATCH { cardOrder: { dashboard: ["a"], transactions: null } }` → 200, GET shows `cardOrder.dashboard = ["a"]` and no `transactions` field.

### Phase 3 — i18n + AAA framework

- [ ] Update `apps/web/features/settings/i18n.ts` (en + zh-TW dictionaries):
  - Rename `resetLayoutButton` → `resetAllLayoutsButton` ("Reset all layouts" / "重設全部版面").
  - Add `resetDashboardLayoutButton`, `resetTransactionsLayoutButton`, `resetPortfolioLayoutButton`.
  - Reuse existing `resetLayoutSuccess` / `resetLayoutError` for all 4 paths (the user knows what they clicked).
- [ ] Update `apps/web/lib/i18n/types.ts` to match the new key shape.
- [ ] Update AAA framework helpers in `libs/test-e2e/src/assistants/layout/AppShellActions.ts` and `AppShellAssert.ts`:
  - Rename `clickResetLayoutButton()` → `clickResetAllLayoutsButton()`.
  - Add `clickResetDashboardLayoutButton`, `clickResetTransactionsLayoutButton`, `clickResetPortfolioLayoutButton`.
  - Update testid references: `reset-layout-btn` → `reset-all-layouts-btn`. Add per-page testids `reset-dashboard-layout-btn`, `reset-transactions-layout-btn`, `reset-portfolio-layout-btn`.

### Phase 4 — Display tab UI

- [ ] Modify `apps/web/components/settings/DisplayTabSection.tsx`:
  - Replace the single Reset Layout button with **4 always-visible buttons** in the `display-layout-section`. No conditional rendering, no disabled state.
  - Per-page buttons PATCH `{ cardOrder: { {page}: null } }` and call a new `onPageLayoutReset(page)` callback.
  - Global "Reset all layouts" PATCHes `{ cardOrder: null }` (existing semantics preserved) and calls existing `onLayoutReset()`.
  - Visual hierarchy: divider above "Reset all layouts"; secondary style for per-page buttons; primary style for global. Settle exact treatment at design time (non-critical).
- [ ] Update existing dashboard `[card-B]` E2E test in `card-reorder-aaa.spec.ts` to use the renamed helper `clickResetAllLayoutsButton()` and updated testid.

### Phase 5 — AppShell wiring (per-key remount counters)

- [ ] Refactor `cardLayoutResetCount` in `AppShell.tsx:120-121` to a counter map: `{ dashboard: 0, transactions: 0, portfolio: 0 }`.
- [ ] Pass `onPageLayoutReset(page: "dashboard" | "transactions" | "portfolio")` to `DisplayTabSection` so each per-page Reset bumps the relevant counter.
- [ ] Existing `onLayoutReset` (global "Reset all") bumps all three counters atomically.
- [ ] Each `<SortableCardGrid>` instance uses `key={\`card-grid-{page}-${counters[page]}\`}` — page-specific remount on per-page reset.

### Phase 6 — Transactions wire-up

- [ ] In the `if (section === "transactions")` block of `AppShell.tsx` (lines 963-1057), preserve the existing `xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]` 2-column layout.
- [ ] Replace the right-stack `<div className="grid min-w-0 gap-6">` body (currently containing `StatusStripCard` + `RecentTransactionsCard`) with:
  ```tsx
  <SortableCardGrid
    key={\`card-grid-transactions-${counters.transactions}\`}
    orderKey="transactions"
    cards={[
      { slug: "transactions-status", fullWidth: true },
      { slug: "transactions-recent", fullWidth: true },
    ]}
  >
    {(slug) => {
      switch (slug) {
        case "transactions-status": return <StatusStripCard ... />;
        case "transactions-recent": return <RecentTransactionsCard ... />;
        default: return null;
      }
    }}
  </SortableCardGrid>
  ```
- [ ] Both cards declared `fullWidth: true` so `xl:col-span-2` collapses the primitive's 2-column grid to a vertical stack inside the constrained right column. Required to preserve the right-stack composition.
- [ ] Add a one-line comment next to the `cards` array: "To add a card here, append a `{slug, fullWidth}` entry AND add a `case` to the switch below."
- [ ] Drag-handle testids `card-transactions-status` / `card-drag-handle-transactions-status` (and the recent equivalents) are automatic via the primitive — no manual testid wiring needed.

### Phase 7 — Portfolio wire-up

- [ ] In the `if (section === "portfolio")` block of `AppShell.tsx` (lines 922-961), wrap the `<HoldingsTable>` + `<DividendsSection>` block with:
  ```tsx
  <SortableCardGrid
    key={\`card-grid-portfolio-${counters.portfolio}\`}
    orderKey="portfolio"
    cards={[
      { slug: "holdings-table", fullWidth: true },
      { slug: "dividends-section", fullWidth: true },
    ]}
  >
    {(slug) => {
      switch (slug) {
        case "holdings-table": return <HoldingsTable ... />;
        case "dividends-section": return <DividendsSection ... />;
        default: return null;
      }
    }}
  </SortableCardGrid>
  ```
- [ ] Slugs `holdings-table` and `dividends-section` are intentionally reused from `DASHBOARD_CARDS` — same React components, different `cardOrder.{key}` namespace. No collision risk.
- [ ] Inline `cards` array with the same one-line "to add a card" comment as Transactions.

### Phase 8 — E2E AAA specs

- [ ] Run `/aaa` to scaffold and add the new E2E specs covering the flows agreed in this scope session. The specifics:
- [ ] Create `apps/web/tests/e2e/specs-oauth/transactions-card-reorder-aaa.spec.ts` with 3 tests:
  - `[transactions-A]` Drag swap status ↔ recent → debounce → state read-back via GET `/user-preferences` shows `cardOrder.transactions = ["transactions-recent", "transactions-status"]`.
  - `[transactions-B]` Display tab → "Reset Transactions Layout" → only `cardOrder.transactions` cleared (assert `cardOrder.dashboard` and `cardOrder.portfolio` unchanged if seeded).
  - `[transactions-C]` After drag, `AddTransactionCard` (testid `add-transaction-card` or equivalent) remains in the LEFT column — composition regression guard for Q2's right-stack-only decision.
- [ ] Create `apps/web/tests/e2e/specs-oauth/portfolio-card-reorder-aaa.spec.ts` with 2 tests:
  - `[portfolio-A]` Drag swap holdings ↔ dividends → state read-back via `cardOrder.portfolio`.
  - `[portfolio-B]` Display tab → "Reset Portfolio Layout" → only `cardOrder.portfolio` cleared.
- [ ] Add `[card-D]` test to existing `apps/web/tests/e2e/specs-oauth/card-reorder-aaa.spec.ts`:
  - Seed orders for all 3 pages (dashboard, transactions, portfolio).
  - Open Display tab, click "Reset all layouts."
  - State read-back: GET `/user-preferences` shows `cardOrder` is `null` (or all sub-keys absent) — atomic global clear.
  - State assertion only; do not navigate to each page (cost vs. confidence — primitive remount is covered by per-page tests).

**Out of scope for testing** (DO NOT add):
- Rollback duplication on transactions/portfolio (primitive-level coverage stands via dashboard `[card-C]` and `SortableCardGrid.test.tsx` unit test).
- Full-width cards specs (no half-width cards on either page; layout is uniformly stacked).
- Mobile TouchSensor / long-press toast (carry-forward as manual-only known gap from KZO-161).

### Phase 9 — Cleanup + pre-PR gate

- [ ] Cleanup `apps/web/components/layout/mergeCardOrder.ts` — remove or rename the misleading `DashboardCard` type re-export. Either point to `SortableCard` from `SortableCardGrid.tsx` or rename to a generic `CardSpec`. Don't delete without checking call sites.
- [ ] Run `/code-reviewer` to produce a structured review doc at `docs/004-notes/kzo-162/review-{YYYYMMDDHHmm}-pre-pr.md`. Work the review fix list top-down before opening the PR.
- [ ] Full 8-suite gate before opening PR:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
- [ ] Open PR. Title format: `feat(api,web): KZO-162: extend SortableCardGrid to transactions + portfolio + per-page resets`.

## Locked decisions (carried forward into design)

| # | Decision | Rationale |
|---|---|---|
| 1 | Wire only Transactions right-stack + Portfolio. /dividends, /cash-ledger out. | /dividends, /cash-ledger render sequential workflow content via `children`, not card grids. Reorder adds no UX value. |
| 2 | Transactions: keep 2-column composition; SortableCardGrid wraps right-stack only; AddTransactionCard fixed left. | Form is the primary action surface (KZO-160 polish). Right-stack is purely informational and genuinely interchangeable. |
| 3 | Page-level keys: `cardOrder.transactions`, `cardOrder.portfolio`. Symmetric with `cardOrder.dashboard`. | Symmetry > YAGNI future-proofing. Existing HTTP test uses `portfolio` as rejected-extra-key example; rewrite to `cash-ledger` (out of scope). |
| 4 | Display tab grows from 1 to 4 always-visible Reset buttons (per-page + "Reset all"). | User mental model: one place to manage all layout resets. Always-visible — clicking a no-op reset is harmless. |
| 5 | Schema: per-key null clears (`{cardOrder: {dashboard: null}}` deletes JSONB sub-key, not store null). | Required by Q4. Postgres `jsonb_strip_nulls()`; Memory explicit delete. Round-trip semantic test guards both. |
| 6 | Slug naming: `transactions-status`, `transactions-recent`, `holdings-table`, `dividends-section`. All `fullWidth: true`. | Prefix transactions slugs (DOM testid clarity); reuse dashboard slugs for Portfolio (same components, different `cardOrder.{key}` namespace). All `fullWidth: true` collapses primitive's xl:grid-cols-2 to vertical stack — preserves current visual layout. |
| 7 | Inline `cards` arrays at AppShell call sites. No per-page `cards.ts` files. | 2 entries each; inline keeps slugs + JSX wiring on one screenful. |
| 8 | Per-key remount counter map in AppShell, not single counter or imperative refetch. | Per-page reset bumps only the relevant counter. "Reset all" bumps all three atomically. Clean, explicit, no callback indirection. |
| 9 | E2E: 3 tx + 2 portfolio + 1 reset-all + HTTP extensions. No rollback/fullwidth duplication. | Primitive is unchanged; rollback covered by primitive unit test + dashboard `[card-C]`. Full-width: no half-width cards on either page. |

## Open Items

(none — all decisions resolved in scope-grill session 2026-04-25)

## References

- **Linear:** [KZO-162](https://linear.app/kzokv/issue/KZO-162/ui-extend-dnd-kit-sortablecardgrid-primitive-to-non-dashboard-pages)
- **KZO-161 transition guide:** `docs/004-notes/kzo-158/transition-202604250900-kzo-161-customize-and-reorder.md` — primitive contract
- **KZO-161 scope-todo:** `docs/004-notes/kzo-158/scope-todo-202604241500-kzo-161-refined.md` — locked decisions inherited
- **KZO-161 design doc:** `docs/004-notes/kzo-158/design-202604241630-kzo-161-initial.md` — algorithms + test matrix precedent
- **KZO-159 transition guide:** `docs/004-notes/kzo-158/transition-202604221054-kzo-159-user-prefs-infra.md` — `user_preferences` PATCH contract
- **Architecture:** `docs/001-architecture/web-frontend.md` § "Dashboard Card Layout (KZO-161)"
- **Primitive source:** `apps/web/components/layout/SortableCardGrid.tsx`
- **Display tab source:** `apps/web/components/settings/DisplayTabSection.tsx`
- **Existing reorder spec:** `apps/web/tests/e2e/specs-oauth/card-reorder-aaa.spec.ts`
- **Existing HTTP spec:** `apps/api/test/http/specs/user-preferences-card-order-aaa.http.spec.ts`
