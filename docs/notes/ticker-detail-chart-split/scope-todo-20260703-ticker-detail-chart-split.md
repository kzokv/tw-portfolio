---
slug: ticker-detail-chart-split
source: scope-grill
created: 2026-07-03
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Ticker Detail Chart Split

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Split ticker detail chart rendering by metric while keeping the same visible chart card and metric toggle.
- Current Price vs Average Cost must use only `detailsState.chart.points`.
- Unrealized P&L must use only `detailsState.unrealizedPnlHistory`.
- Remove the frontend fallback that maps `unrealizedPnlHistory` into Current Price chart data.
- Remove frontend-only `price` and `averageCost` from `TickerDetailUnrealizedPnlPoint`.
- Keep backend API `closePrice` and `averageCostPerShare` fields unchanged.
- Keep existing ticker detail query params unchanged.
- Give each metric independent loading and empty-state logic.
- Preserve unrelated ticker-detail PR work; do a targeted design revert only for the bad price fallback coupling.

## Implementation Steps

- [x] In `apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx`, extract separate chart data builders for Current Price vs Average Cost and Unrealized P&L.
- [x] Remove `snapshotPriceChartPoints`, `resolveTickerHistoryPrice`, `resolveTickerHistoryAverageCost`, and any Current Price dependency on `detailsState.unrealizedPnlHistory`.
- [x] Split rendering into internal metric-specific chart components, such as `PriceVsAverageCostChart` and `UnrealizedPnlChart`, under the existing chart card shell.
- [x] Keep the visible chart controls, metric toggle, date range controls, and route query params unchanged.
- [x] Implement metric-specific loading and empty states: Current Price is based on `chart.points`; Unrealized P&L is based on `unrealizedPnlHistory`.
- [x] In `apps/web/features/portfolio/services/tickerDetailsService.ts`, remove frontend `price` and `averageCost` mapping from `TickerDetailUnrealizedPnlPoint`.
- [x] Keep shared API DTO fields `closePrice` and `averageCostPerShare` in `libs/shared-types/src/index.ts` and backend response construction unchanged.
- [x] Add focused unit tests for the separated series builders and empty-state decisions.
- [x] Run `/aaa` to add or update E2E tests covering the flows agreed in this scope session.
- [x] Add a standard `appPages` E2E regression using a unique synthetic TW ticker, seeded trades, seeded daily bars, and the existing dashboard snapshot generation flow.
- [x] In the E2E regression, assert real Recharts SVG output: Current Price renders at least two `.recharts-line-curve` paths and y-axis tick labels; Unrealized P&L renders at least one `.recharts-line-curve` path and y-axis tick labels.
- [ ] Validate manually in Chrome against Vakwen Dev for `2330` after deployment, clearing storage only as a sanity check rather than treating storage as the root cause.

## Evidence

- Focused unit: `cd apps/web && npx vitest run test/app/tickers/TickerHistoryClient.test.tsx test/features/portfolio/services/tickerDetailsService.test.ts` passed, 47 tests.
- TypeScript/build: `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npm run build -w @vakwen/config -w @vakwen/test-framework -w @vakwen/test-e2e -w @vakwen/web` passed.
- Focused E2E: `npx playwright test apps/web/tests/e2e/specs/ticker-detail-chart-split-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts` passed after rebuilding the production app bundle. The spec validates desktop and mobile chart rendering.
- Recorded validation issue: running Playwright directly before rebuilding served stale `.next/standalone` output and produced a false failure with x-axis-only chart DOM. Rebuilt before accepting E2E evidence.
- Full gate 1: `npx eslint .` passed with existing Playwright conditional-in-test warnings in unrelated AI connector specs.
- Full gate 2: `npm run typecheck` passed.
- Full gate 3: `npm run test --prefix apps/web` passed, 456 tests.
- Full gate 4: `npm run test --prefix apps/api` passed, 1884 tests with 437 skipped.
- Full gate 5: `npm run test:integration:full:host` passed, 950 tests with 1 skipped.
- Full gate 6: `npm run test:e2e:bypass:mem --prefix apps/web` passed, 313 tests with 17 skipped.
- Full gate 7: `npm run test:e2e:oauth:mem --prefix apps/web` passed, 121 tests. A first full run exposed one transient failure in existing card reorder coverage; the exact failed test passed in isolation, and the full OAuth suite passed on rerun.
- Full gate 8: `npm run test:http --prefix apps/api` passed, 301 tests with 2 skipped.
- Diff hygiene: `git diff --check` passed.

## Open Items

- [ ] None.

## References

- Ticker detail client: `apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx`
- Ticker details service mapper: `apps/web/features/portfolio/services/tickerDetailsService.ts`
- Shared ticker details DTOs: `libs/shared-types/src/index.ts`
- Backend ticker details service: `apps/api/src/services/tickerDetails.ts`
- Existing ticker page object: `libs/test-e2e/src/pages/tickers/TickerDetailPage.ts`
- Existing ticker assertions: `libs/test-e2e/src/assistants/tickers/TickerDetailAssert.ts`
- Existing snapshot E2E pattern: `apps/web/tests/e2e/specs/portfolio-snapshots-aaa.spec.ts`
