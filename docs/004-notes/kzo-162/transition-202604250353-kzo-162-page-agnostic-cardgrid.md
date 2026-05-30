---
slug: kzo-162
ticket: KZO-162
type: transition-guide
created: 2026-04-25
status: final
companion: scope-todo-202604251530-initial.md
---

# Transition Guide: KZO-162 — `<SortableCardGrid>` extended to non-dashboard pages

## What shipped

KZO-162 wires the page-agnostic `<SortableCardGrid>` primitive (delivered in KZO-161) to two new surfaces, expands the Display tab Reset UI from one global button to four always-visible buttons (three per-page + global), and teaches the `cardOrder` JSONB merge to handle per-key clears.

| Slice | What shipped |
|---|---|
| **Schema** | `cardOrderSchema` in `apps/api/src/routes/registerRoutes.ts` now accepts three top-level keys (`dashboard`, `transactions`, `portfolio`), each typed as `union([array(string).max(50), null]).optional()`. Outer `.strict()` preserved. |
| **Persistence** | `setUserPreferencePatch` deep-merges `cardOrder` at the sub-key level. `{ cardOrder: { transactions: [...] } }` no longer wipes `cardOrder.dashboard`. `{ cardOrder: { transactions: null } }` clears just the `transactions` sub-key. Top-level `{ cardOrder: null }` still routes through delete-keys and removes the entire `cardOrder` row. Postgres uses `jsonb_set(..., '{cardOrder}', jsonb_strip_nulls(existing.cardOrder \|\| patch.cardOrder))`; Memory uses an explicit per-sub-key delete loop. Round-trip semantics asserted at suites 5 + 8. |
| **Transactions wire-up** | All three transactions cards (`AddTransactionCard`, `StatusStripCard`, `RecentTransactionsCard`) render through one `<SortableCardGrid orderKey="transactions">`. The previous 2-column composition (form fixed left, right-stack reorderable) was replaced after user feedback so the form itself is reorderable. All three slugs declare `fullWidth: true`, producing a vertical stack where any card can be dragged to any position. The `transactions-add` slot renders the form normally and a read-only notice in shared context — saved order survives context switches. New testids: `card-transactions-add`, `card-transactions-status`, `card-transactions-recent` (and matching `card-drag-handle-*`). |
| **Portfolio wire-up** | The `[HoldingsTable, DividendsSection]` block now renders through `<SortableCardGrid orderKey="portfolio">`. Slugs `holdings-table` and `dividends-section` are intentionally reused from `DASHBOARD_CARDS` — same React components, different `cardOrder.{key}` namespace, no collision risk. Both `fullWidth: true`. |
| **Display tab — 4 buttons** | The Layout section grew from one Reset Layout button to **four** always-visible buttons. Per-page buttons PATCH `{ cardOrder: { {page}: null } }` and remount only that surface; the global "Reset all layouts" PATCHes `{ cardOrder: null }` and remounts every surface atomically. New testids: `reset-dashboard-layout-btn`, `reset-transactions-layout-btn`, `reset-portfolio-layout-btn`, `reset-all-layouts-btn`. |
| **AppShell counter map** | `cardLayoutResetCount: number` was refactored into `cardLayoutResetCounts: { dashboard: number; transactions: number; portfolio: number }`. Each `<SortableCardGrid>` keys on its own counter, so per-page resets remount only the targeted surface. The new `onPageLayoutReset(page)` callback bumps just one counter; the existing `onLayoutReset` bumps all three. |
| **i18n** | `resetLayoutButton` renamed to `resetAllLayoutsButton` ("Reset all layouts" / "重設全部版面"). New keys: `resetDashboardLayoutButton`, `resetTransactionsLayoutButton`, `resetPortfolioLayoutButton`. `resetLayoutSuccess` and `resetLayoutError` reused for all four reset paths. |
| **AAA framework** | `clickResetLayoutButton()` renamed to `clickResetAllLayoutsButton()`. New helpers: `clickResetDashboardLayoutButton()`, `clickResetTransactionsLayoutButton()`, `clickResetPortfolioLayoutButton()`, `resetAllLayoutsButtonIsVisible()`, `resetDashboardLayoutButtonIsVisible()`, `resetTransactionsLayoutButtonIsVisible()`, `resetPortfolioLayoutButtonIsVisible()`. New `mxAssertDeepEqual` mixin promoted to `GenericAssertMixin` so all AAA assistants can use it. |
| **Tests** | New AAA specs: `transactions-card-reorder-aaa.spec.ts` (3 tests), `portfolio-card-reorder-aaa.spec.ts` (2 tests). New `[card-D]` test in `card-reorder-aaa.spec.ts` for the global reset. HTTP suite extended: `user-preferences-card-order-aaa.http.spec.ts` rewrites the rejected-extra-key example from `portfolio` (now valid) to `cash-ledger` (durably out of scope), and adds page-acceptance + per-key clear + mixed-op tests (13 cardOrder tests total). Integration suite gains memory + Postgres parity tests for the sub-key merge semantics. All 8 suites green. |

---

## API & UI surface changes for downstream callers

### Renamed (breaking for direct callers)

| Symbol | Before | After | Notes |
|---|---|---|---|
| Display-tab reset button | testid `reset-layout-btn` | testid `reset-all-layouts-btn` | The previous single global button is now the global "Reset all layouts" button; per-page testids are added alongside. |
| AAA helper | `clickResetLayoutButton()` | `clickResetAllLayoutsButton()` | Existing dashboard `[card-B]` test updated. New per-page helpers (`clickResetDashboardLayoutButton`, `clickResetTransactionsLayoutButton`, `clickResetPortfolioLayoutButton`) are additive. |
| AAA helper | `resetLayoutButtonIsVisible()` | `resetAllLayoutsButtonIsVisible()` | Add `resetDashboardLayoutButtonIsVisible()`, `resetTransactionsLayoutButtonIsVisible()`, `resetPortfolioLayoutButtonIsVisible()`. |
| i18n key | `dict.settings.resetLayoutButton` | `dict.settings.resetAllLayoutsButton` | Plus new `resetDashboardLayoutButton`, `resetTransactionsLayoutButton`, `resetPortfolioLayoutButton`. |
| AppShell prop | `cardLayoutResetCount: number` | `cardLayoutResetCounts: { dashboard, transactions, portfolio }` | Internal to AppShell — only relevant if a third party was destructuring this from AppShell's render path. |

### Additive

| Symbol | Source | Notes |
|---|---|---|
| `cardOrder.transactions` / `cardOrder.portfolio` | `PATCH /user-preferences` body | New sub-keys accepted by `cardOrderSchema`. Each `string[] \| null \| undefined`, capped at 50 slugs. |
| Per-key null clear | `PATCH /user-preferences` body | `{ cardOrder: { dashboard: null } }` clears just the `dashboard` sub-key. The cleared key is **absent** from GET responses, never returned as `null` (round-trip regression guard). |
| `card-transactions-add` testid + `card-drag-handle-transactions-add` | `AppShell.tsx` transactions section | The reorderable slot for `AddTransactionCard` (shared-context renders the read-only notice in the same slot). Saved order writes to `cardOrder.transactions`. |
| `mxAssertDeepEqual<T>(actual, expected, label?)` | `libs/test-framework/src/mixins/GenericAssertMixin.ts` | Promoted from `ApiAssertMixin` so all AAA assistants (including E2E `appShell.assert`) can use deep equality assertions. |

### Removed

- `dict.settings.resetLayoutButton` — replaced by `resetAllLayoutsButton`.
- testid `reset-layout-btn` — replaced by `reset-all-layouts-btn`.
- AAA helpers `clickResetLayoutButton()` / `resetLayoutButtonIsVisible()` — replaced by the `*All*` versions.
- The `DashboardCard` type re-export from `apps/web/components/layout/mergeCardOrder.ts` — no longer used; the `mergeCardOrder` function is generic and doesn't need the alias.

---

## Migration notes for in-progress branches

If you have a branch that touches the Display tab or `cardOrder`:

1. **Rename testid usage.** Anywhere a test queries `reset-layout-btn`, switch to `reset-all-layouts-btn`. Or migrate to the new per-page testid that matches your test's intent.
2. **Rename AAA helper calls.** `clickResetLayoutButton()` → `clickResetAllLayoutsButton()`.
3. **Update i18n references.** `dict.settings.resetLayoutButton` → `dict.settings.resetAllLayoutsButton`.
4. **`cardOrder` PATCH semantics.** A PATCH that does `{ cardOrder: { dashboard: [...] } }` no longer overwrites `transactions` or `portfolio` sub-keys. If you intend to wipe other sub-keys, send `{ cardOrder: null }` first, then re-PATCH the desired state.
5. **`<SortableCardGrid>` consumers.** The primitive is unchanged — `cards`, `orderKey`, render-prop child. Pass any new `orderKey` value (which becomes a new `cardOrder.{key}` sub-object). Make sure the new sub-key is added to `cardOrderSchema` (`apps/api/src/routes/registerRoutes.ts`) before it ships.
6. **Transactions composition reversal.** The original scope-todo (Q2) kept `AddTransactionCard` fixed in a left column with only the right-stack reorderable. That composition was reversed mid-implementation: the 2-column layout was removed, the `transactions-left-column` testid + helpers (`transactionsLeftColumnIsVisible`, etc.) no longer exist, and all three transactions cards (`transactions-add`, `transactions-status`, `transactions-recent`) are now reorderable inside one `<SortableCardGrid>` with `fullWidth: true`. If your branch added tests or styling against the old 2-column transactions composition, drop the column locator and use the per-card `card-transactions-*` testids directly.

---

## Hot-path summary for KZO-162 consumers

**Add a third reorderable surface (e.g. `/some-new-page`):**

1. Extend `cardOrderSchema` in `apps/api/src/routes/registerRoutes.ts` to add the new sub-key.
2. Add a `<SortableCardGrid orderKey="some-new">` block at the new page's AppShell render branch.
3. Inline the canonical `cards` array + `switch (slug)` body next to the call site (mirror the transactions/portfolio pattern).
4. Add a remount counter to `cardLayoutResetCounts` in AppShell.
5. Extend `DisplayTabSection` with a `Reset some-new layout` button — pattern is `runReset("some-new")` which hits the `else` branch and PATCHes `{ cardOrder: { "some-new": null } }`.
6. Add per-page testids and AAA helpers, mirroring `reset-transactions-layout-btn` and `clickResetTransactionsLayoutButton()`.
7. Update the architecture doc table at `docs/001-architecture/web-frontend.md` § "Card Layout (KZO-161 / KZO-162)".

**Wipe ALL saved card orders for a user (admin-style operation):**

`PATCH /user-preferences { cardOrder: null }` — atomic global clear. Clears every page's saved order in one DB UPDATE. Mirrors what the "Reset all layouts" button does.

---

## Test pattern: seed BEFORE navigate when the browser must observe seeded `cardOrder`

For Playwright OAuth specs that need the in-page `<SortableCardGrid>` to render against a known `cardOrder`, the seed PATCH must land **before** the page navigation that mounts the grid. `<SortableCardGrid>` only fetches `GET /user-preferences` once on mount; seeding after navigation produces stale UI and flake against shared OAuth user state.

The OAuth fixture pre-installs the session cookie on `page.context()` before the test body runs (see `sessionBase.ts`), so the cookie header is readable without a prior navigation. Use this seed-as-browser flow:

```ts
const cookieHeader = await getTestUserCookieHeader(page); // reads from page.context().cookies()
await seedAsBrowser(page, { cardOrder: { transactions: null } }); // PATCH via /__e2e/seed-user-preferences with that cookie
await appShell.actions.navigateToRoute("/transactions");          // grid mounts, GETs the seeded value
```

**Why a separate `seedAsBrowser` helper instead of `seedUserPreferences(testUser.userId, ...)`:** the OAuth fixture's browser session resolves to a different user than `testUser.userId` (the fixture's `e2eUserId` is not the same as the default `e2e-ci-google-sub-001` resolved-user). Seeding by `testUser.userId` writes to one user; the browser GETs from the other. Seed via the browser's actual session cookie so writer and reader are the same user.

This pattern is applied in:
- `apps/web/tests/e2e/specs-oauth/transactions-card-reorder-aaa.spec.ts` ([transactions-A/B/C])
- `apps/web/tests/e2e/specs-oauth/portfolio-card-reorder-aaa.spec.ts` ([portfolio-A/B])
- `apps/web/tests/e2e/specs-oauth/card-reorder-aaa.spec.ts` ([card-D])

Discovered during Codex pre-PR review of KZO-162. The earlier specs followed `mintSessionCookie + seedUserPreferences(testUser.userId, ...)`, which works for backend-only assertions but produces flake whenever the assertion path goes through the browser.

---

## Out of scope (carried forward)

| Item | Why | Tracking |
|---|---|---|
| Wire `/dividends`, `/cash-ledger` to `<SortableCardGrid>` | Sequential workflow content via `children`, not card grids. Reorder adds no UX value. | None — durably out of scope per KZO-162 Q1. |
| Mobile TouchSensor + long-press toast E2E | Needs a mobile viewport profile in `playwright.mobile.config.ts`. | Carry-forward (manual verification only). |
| Card visibility toggle (show/hide individual cards) | F5 / KZO-162 are reorder-only per the mockup. | None. |
| Admin-controlled card order | Out of scope per the original 158 grill (Q6). | None. |

---

## Cross-references

- Scope-todo: `docs/004-notes/kzo-162/scope-todo-202604251530-initial.md`
- KZO-161 transition (predecessor — primitive contract): `docs/004-notes/kzo-158/transition-202604250900-kzo-161-customize-and-reorder.md`
- KZO-159 transition (`user_preferences` PATCH contract): `docs/004-notes/kzo-158/transition-202604221054-kzo-159-user-prefs-infra.md`
- Architecture: `docs/001-architecture/web-frontend.md` § "Card Layout (KZO-161 / KZO-162)"
- Architecture: `docs/001-architecture/backend-db-api.md` § `user_preferences`
- Linear: KZO-162
