---
slug: realized-pnl-transaction-history
source: scope-grill
created: 2026-06-21
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Realized P&L Transaction History

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- `/transactions` becomes the canonical full transaction history browser.
- The full history surface is fixed at the top of the posted tab; add/status panels remain below.
- The filter toolbar should visually mirror the cash ledger filter toolbar with simple native date inputs, selects, chips, immediate fetch, and pagination below the table.
- Filters are URL-backed and shareable. Query params should only include non-default filters.
- Supported filters: `type=BUY|SELL|ALL`, `pnl=realized|any`, `marketCode=TW|US|AU|ALL`, `accountId=<id>|ALL`, `ticker=<symbol>`, `from=YYYY-MM-DD`, `to=YYYY-MM-DD`.
- Date filters use inclusive `tradeDate`, not booked date.
- `pnl=realized` means SELL rows with `realizedPnlAmount !== null`, including zero.
- `pnl=realized` forces SELL semantics. Conflicting URLs such as `type=BUY&pnl=realized` normalize to `type=SELL&pnl=realized`.
- Pagination is server-side offset pagination with `limit` and `offset`.
- Default page size is `50`; selectable sizes are `25`, `50`, and `100`; limit changes reset `offset=0`.
- Sorting is server-side. Default is `tradeDate desc`.
- Sortable fields are `tradeDate`, `type`, `ticker`, `account`, and `realizedPnl`.
- `account` sorts by account display name; `ticker` sorts by ticker then market code; `tradeDate` keeps deterministic history tie-breakers; `realizedPnl` puts null values last in both directions.
- Report Realized P&L cards deep-link to filtered `/transactions` with `returnTo`.
- Report drilldowns preserve market scope when the report scope is not `all`.
- Report drilldowns include resolved date range params, using `from=<rangeStartDate>` and `to=<rangeEndDate>`.
- Report summary Realized P&L must become range-scoped so the card total and transaction drilldown match.
- Add `rangeStartDate` and `rangeEndDate` to the report query DTO.
- Add `realizedPnlTransactionCount` to report summary and use it as the report card click condition.
- Report Realized P&L card is clickable only when `realizedPnlTransactionCount > 0`; otherwise it remains non-clickable.
- `/transactions` shows active filter chips, clear/reset, and a safe internal Back to report link when `returnTo` is present.
- `returnTo` is preserved during filter/pagination changes and removed by Clear all.
- `/transactions` shows native-currency realized P&L subtotals for the current filtered result set.
- When opened from a report, the UI should not imply native subtotals exactly equal the reporting-currency report amount unless currencies match.
- Row-level realized P&L math remains available from the Realized P&L cell.
- Ticker links navigate to ticker history for that ticker/account.
- Transaction edit/delete actions remain on ticker pages for V1.
- No transaction detail drawer in V1.
- No cash settlement amount column in V1.

## Implementation Steps

- [x] Extend shared report DTOs with `ReportQueryStateDto.rangeStartDate`, `ReportQueryStateDto.rangeEndDate`, and `ReportSummaryTotalsDto.realizedPnlTransactionCount`.
- [x] Resolve report range bounds in the report backend with the existing `resolveRangeBounds(range, asOf, earliestTradeDate)` domain helper.
- [x] Make report summary Realized P&L amount and transaction count range-scoped and market-scoped.
- [x] Add report API tests proving Realized P&L amount/count respect `1M`, `3M`, `YTD`, `1Y`, and market scope where practical.
- [x] Add `GET /transactions/history` without changing the existing array-compatible `GET /portfolio/transactions` endpoint.
- [x] Define the transaction history response shape with `items`, `total`, `limit`, `offset`, and `aggregates.realizedPnlByCurrency`.
- [x] Implement server-side transaction filters for type, realized P&L mode, market, account, ticker, inclusive trade-date range, limit, and offset.
- [x] Implement server-side sorting for `tradeDate`, `type`, `ticker`, `account`, and `realizedPnl` with the locked semantics.
- [x] Add API tests for transaction history filters, conflicting `type=BUY&pnl=realized` behavior, pagination totals, sorting, and realized P&L aggregates.
- [x] Add web service and hook code for fetching transaction history from URL-derived filters.
- [x] Add URL parsing, normalization, and serialization helpers for transaction history query state.
- [x] Normalize `type=BUY&pnl=realized` to `type=SELL&pnl=realized` with `router.replace`.
- [x] Refactor the current recent transactions table into a reusable transaction history component with compact recent mode and full-history mode.
- [x] Update `/transactions` so the full history surface is fixed at the top of the posted tab and existing add/status cards remain below.
- [x] Add the cash-ledger-style transaction filter toolbar, active filter chips, clear/reset, result count, pagination controls, and native realized P&L subtotals.
- [x] Add safe internal `returnTo` handling and Back to report link rendering.
- [x] Update report Realized P&L summary card rendering to show a visible drilldown affordance such as `View N records` when count is greater than zero.
- [x] Build report drilldown URLs with `type=SELL`, `pnl=realized`, `from`, `to`, optional `marketCode`, and encoded `returnTo`.
- [x] Add web unit/component tests for URL parsing, filter normalization, active chips, back-to-report link, report card link generation, and compact/full table behavior.
- [x] Run `/aaa` or otherwise add/update one focused E2E test covering report Realized P&L drilldown to filtered transaction history.

## Validation

- `npm run build -w apps/web` — passed.
- `npm run test -w apps/api -- test/integration/transaction-history.integration.test.ts test/integration/reports.integration.test.ts` — passed, 24 tests.
- `npx vitest run test/components/transactions/TransactionsClient.test.tsx test/components/transactions/TransactionHistoryBrowser.test.tsx test/components/transactions/TransactionHistoryTable.test.tsx test/components/reports/ReportsClient.test.tsx test/features/portfolio/transactionHistoryRouteState.test.ts test/features/portfolio/services/portfolioService.test.ts test/features/reports/hooks/useReportData.test.tsx` from `apps/web` — passed, 41 tests.
- `npm run build -w libs/test-framework` — passed; needed for local Playwright helper package exports.
- `npm run build -w libs/test-e2e` — passed; needed for local Playwright fixture package exports.
- `npx playwright test apps/web/tests/e2e/specs/reports-realized-pnl-drilldown-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts` — passed, 1 test.

## Review Addendum

Code review on 2026-06-21 fixed these issues:

- `pnl=realized` now normalizes any non-SELL type state, including default `ALL`, to explicit `type=SELL`.
- `/transactions` now refreshes the full history browser when the app shell emits a context/data refresh signal, not just the summary cards.
- Out-of-range history offsets are clamped back to the last valid page after filtered totals load.
- Daily-review report API requests now include the selected `range`, so shared summary cards use the same range semantics as portfolio and market reports.

Review validation:

- `npx eslint apps/web/components/transactions/TransactionsClient.tsx apps/web/components/transactions/TransactionHistoryBrowser.tsx apps/web/components/transactions/TransactionHistoryTable.tsx apps/web/features/portfolio/transactionHistoryRouteState.ts apps/web/features/reports/reportState.ts apps/web/features/reports/realizedPnlDrilldown.ts apps/web/components/reports/ReportsClient.tsx` — passed.
- `npm run test -w apps/api -- test/integration/transaction-history.integration.test.ts test/integration/reports.integration.test.ts` — passed, 24 tests.
- `npx vitest run test/components/transactions/TransactionsClient.test.tsx test/components/transactions/TransactionHistoryBrowser.test.tsx test/components/transactions/TransactionHistoryTable.test.tsx test/components/reports/ReportsClient.test.tsx test/features/portfolio/transactionHistoryRouteState.test.ts test/features/portfolio/services/portfolioService.test.ts test/features/reports/hooks/useReportData.test.tsx test/features/reports/reportState.test.ts test/features/reports/reportService.test.ts` from `apps/web` — passed, 52 tests.
- `npm run build -w apps/web` — passed.
- `npx playwright test apps/web/tests/e2e/specs/reports-realized-pnl-drilldown-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts` — passed, 1 test, with local Playwright web/API servers.
- Note: one E2E rerun failed while `npm run build -w apps/web` was running concurrently because `.next/standalone/apps/web/server.js` was being recreated. The same E2E passed when rerun serially after the build completed.

## Full Gate Evidence

Completed on 2026-06-21 before PR creation:

- `npx eslint .` — passed. Re-run after the final OAuth spec fix also passed.
- `npm run typecheck` — passed. Re-run after the final OAuth spec fix also passed.
- `npm run test --prefix apps/web` — passed: first web Vitest phase 52 files / 322 tests; second web Vitest phase 60 files / 414 tests.
- `npm run test --prefix apps/api` — passed: 172 files passed, 44 skipped; 1703 tests passed, 430 skipped.
- `npm run test:integration:full:host` — passed: 91 files passed; 883 tests passed, 1 skipped.
- `npm run test:e2e:bypass:mem --prefix apps/web` — passed with local Playwright web/API servers: 292 tests passed, 17 skipped.
- `npx playwright test tests/e2e/specs-oauth/transactions-card-reorder-aaa.spec.ts --config=tests/e2e/playwright.oauth.config.ts` from `apps/web` — passed after updating the stale transaction reorder spec: 3 tests passed.
- `npm run test:e2e:oauth:mem --prefix apps/web` — passed with local Playwright OAuth/web/API servers: 120 tests passed.
- `npm run test:http --prefix apps/api` — passed with local API/OAuth test services: 293 tests passed, 2 skipped.

## Open Items

- [ ] None.

## References

- Scope debate note: none.
- Linear tickets: none.
