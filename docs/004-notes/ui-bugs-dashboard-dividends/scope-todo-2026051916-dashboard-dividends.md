---
slug: ui-bugs-dashboard-dividends
source: scope-grill
created: 2026-05-19
tickets: []
required_reading: []
superseded_by: null
---

# Todo: UI Bugs - Dashboard Trend, Dividend Review, Transaction Accounts

> For agents starting a fresh session: this scope is locked. Use the waiver path for commit/PR metadata; no Linear ticket will be created.

## Locked Decisions

- Portfolio Trend must use date-specific historical market values, not repeated current quote values.
- If historical snapshot data appears invalid, treat those points as invalid or gapped and tell the user to repair the affected ticker through repair mode.
- Dashboard top cards may continue to use latest quote/current value.
- Dividend Review must include expected-but-unposted eligible dividends.
- Dividend Review composition belongs in the backend, not in an unbounded client-side merge.
- Add a dedicated `/portfolio/dividends/review` endpoint with `rowKind: "ledger" | "expected"`.
- Keep `/portfolio/dividends/ledger` ledger-only.
- The review endpoint must be SQL-first for Postgres: filtering, sorting, pagination, and aggregates should run server-side.
- Expected dividend review rows must not materialize ledger rows on read.
- Expected rows appear under `all` and `open`, but not under `needsReconciliation`, `matched`, `explained`, or `resolved`.
- Expected rows may open the posting drawer; reconciliation-only actions such as `Mark matched` stay unavailable until a real posted/materialized ledger row exists.
- The transaction form must filter accounts by the selected market's compatible currency and show the existing create-account prompt when no compatible account exists.
- No one-off dev/prod data repair is in scope unless implementation proves a persistent data invariant bug.
- UI mockup is not required for this bugfix.

## Implementation Steps

- [x] Add shared/API review row types for dividend review rows, including `rowKind: "ledger" | "expected"`.
- [x] Add persistence contract for combined dividend review listing with existing review filters, sorting, pagination, and aggregates.
- [x] Implement Postgres combined review query without `loadStore()` or full-history Node-side merging.
- [x] Ensure expected rows compute eligible quantity from trade events at the ex-dividend boundary and exclude account/event pairs with an active ledger row.
- [x] Preserve existing ledger listing behavior for `/portfolio/dividends/ledger`.
- [x] Add `GET /portfolio/dividends/review` route and response mapping.
- [x] Implement memory persistence parity for tests.
- [x] Update web dividend review service to call `/portfolio/dividends/review`.
- [x] Update Dividend Review UI to render `rowKind: "expected"` rows and hide/disable reconciliation-only actions for them.
- [x] Keep expected rows able to open the dividend posting drawer.
- [x] Fix transaction account filtering to use selected market currency compatibility and show `tx-no-account-error` / `tx-create-account-link` when no compatible accounts exist.
- [x] Fix Portfolio Trend/performance data path so historical points do not silently reuse current quote values.
- [x] Surface repair guidance when invalid historical trend points are detected for a ticker.
- [x] Add targeted API tests for expected dividend review rows, status filtering, aggregate totals, sorting, and pagination.
- [x] Add targeted web tests for incompatible transaction market/account behavior.
- [x] Add targeted web tests for Dividend Review expected rows and action availability.
- [x] Add targeted test coverage for Portfolio Trend invalid/gapped historical values and repair guidance.
- [x] Run the smallest relevant test scopes first.
- [x] Run the full 8-suite gate before declaring all tests pass.

## Open Items

- [x] During implementation, inspect whether repeated current quote values come from invalid persisted snapshots or from fallback logic. If persisted data is corrupt beyond display handling, stop and document the required migration/data-repair scope separately.

## Implementation Notes

- Portfolio Trend issue was fixed in fallback logic: synthetic historical points no longer reuse latest/current quotes for non-matching dates.
- Dividend Review expected rows are produced by the backend review endpoint and are not materialized as ledger entries on read.
- Dividend Review E2E now covers an expected row opening the posting drawer while withholding `Mark matched`.
- Transaction form account choices now follow the selected market's compatible currency and reuse the existing create-account prompt.

## Validation

- [x] `npm run test --prefix apps/api -- dividendReviewRows.test.ts dashboardReportingCurrency.test.ts`
- [x] `npm run test --prefix apps/api -- dividendReviewRows.test.ts dashboard.integration.test.ts`
- [x] `npx eslint .`
- [x] `npm run typecheck`
- [x] `npm run test --prefix apps/web` — 54 files, 400 tests passed
- [x] `npm run test --prefix apps/api` — 115 files, 1290 tests passed, 401 skipped
- [x] `npm run test:integration:full:host` — 74 files, 709 tests passed, 1 skipped
- [x] `npx playwright test --config=apps/web/tests/e2e/playwright.config.ts apps/web/tests/e2e/specs/account-market-binding-aaa.spec.ts apps/web/tests/e2e/specs/transaction-form-market-code-aaa.spec.ts apps/web/tests/e2e/specs/dividend-review-aaa.spec.ts`
- [x] `npx playwright test --config=apps/web/tests/e2e/playwright.config.ts apps/web/tests/e2e/specs/dividend-review-aaa.spec.ts` — 17 passed
- [x] `npm run test:e2e:bypass:mem --prefix apps/web` — 243 passed, 9 skipped
- [x] `npm run test:e2e:oauth:mem --prefix apps/web` — 129 passed
- [x] `npm run test:http --prefix apps/api` — 272 passed, 2 skipped
- [x] `git diff --check`

## References

- Worktree: `/Users/lume/repos/tw-portfolio/.claude/worktrees/ui-bugs-dashboard-dividends`
- Branch: `worktree-ui-bugs-dashboard-dividends`
- Base: `origin/dev` at `d334240`
