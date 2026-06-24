---
slug: ticker-allocation
source: scope-grill
created: 2026-06-24
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Ticker Allocation

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Add a full-width `Ticker allocation` chart card to portfolio reports, replacing the current UI row that renders `Income` and `Concentration`.
2. Keep backend `income` and `concentration` DTO fields for compatibility, but stop rendering those cards.
3. Add `PortfolioReportDto.allocation.byTicker` as the authoritative data source.
4. Chart respects active report scope; `all` uses all markets, single-market scope uses that market.
5. Card supports market filter popover, chart mode `bars/pie`, and Top N mode `Auto/5/10/20/All`.
6. Persist chart mode + Top N via typed user preference/context settings; do not persist selected markets.
7. Show both `Portfolio weight` and `Selected weight`.
8. Use `Auto`: <=5 show all, 6-15 Top 10 + Other, 16+ Top 20 + Other.
9. `Other` is an aggregate row with aggregate popover, no ticker link.
10. Popovers show ticker/name, market, both weights, reporting value, account count, quote/FX status, fallback basis, and ticker link.
11. Mobile uses responsive chart plus ranked tappable list; desktop uses chart interactions.
12. Show allocation basis summary and fallback disclosure.
13. Ticker detail API computes market-denominator allocation for group and account rows.
14. Ticker detail UI shows market-scoped allocation in hero/summary plus account row contribution.
15. Add `Highest allocation` quick preset consistently to reports holdings cards and dashboard top holdings preview.
16. Tests: focused API/unit/component tests only; no new E2E in first implementation.

## Implementation Steps

- [x] Extend shared DTOs/preferences for `allocation.byTicker`, chart mode, Top N, and `Highest allocation`.
- [x] Populate `allocation.byTicker` in portfolio report service.
- [x] Add ticker detail market-denominator allocation computation.
- [x] Build the portfolio report ticker allocation card with controls, chart/list, popovers, `Other`, basis disclosure, and refresh.
- [x] Replace portfolio report Income/Concentration UI row with the new card.
- [x] Add ticker detail allocation UI.
- [x] Add `Highest allocation` preset to reports and dashboard holdings quick filters.
- [x] Update i18n strings.
- [x] Add/update API and web component/unit tests.

## Evidence

- `npm run build -w libs/shared-types`
- `npm run test --prefix apps/api -- reports.test.ts tickerDetails.test.ts`
- `npx vitest run --config vitest.config.ts test/components/reports/ReportsClient.test.tsx test/app/tickers/TickerHistoryClient.test.tsx test/features/dashboard/components.test.tsx`
- `npx eslint apps/api/src/services/reports.ts apps/api/src/services/tickerDetails.ts apps/api/test/unit/tickerDetails.test.ts apps/api/test/unit/reports.test.ts apps/web/components/reports/ReportsClient.tsx apps/web/app/tickers/'[ticker]'/TickerHistoryClient.tsx apps/web/components/dashboard/DashboardHoldingsPreview.tsx apps/web/features/dashboard/i18n.ts apps/web/lib/i18n/types.ts apps/web/test/components/reports/ReportsClient.test.tsx apps/web/test/app/tickers/TickerHistoryClient.test.tsx apps/web/test/features/dashboard/components.test.tsx libs/shared-types/src/index.ts`
- `git diff --check`
- `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npm run build -w @vakwen/config -w @vakwen/test-framework -w @vakwen/test-e2e -w @vakwen/web`
- `../../node_modules/.bin/playwright test --config=tests/e2e/playwright.config.ts tests/e2e/specs/redesign-fit-aaa.spec.ts -g "desktop-fit-reports" --project=chromium`
- `../../node_modules/.bin/playwright test --config=tests/e2e/playwright.config.ts tests/e2e/specs/mobile-redesign-fit-aaa.spec.ts -g "mobile-fit-reports" --project=chromium-mobile`

## Validation Notes

- First web component validation failed because one report preference assertion raced preference hydration and one ticker test still queried the old allocation test id. Both were fixed and rerun successfully.
- Direct `npm run test --prefix apps/web -- ...` expands through the package script and runs a broad web suite; focused validation used direct Vitest instead.
- `npm run typecheck` currently fails in the pre-existing API build path at `apps/api/src/services/market-data/registerCloseRefreshWorker.ts` and `apps/api/src/services/market-data/registerIntradayRefreshWorker.ts` (`JobWithMetadata` handler argument inferred against `never`). The allocation/shared-types errors from the stale parent workspace resolution were cleared after creating local worktree workspace links.
- Local `npm install --package-lock=false` initially installed newer tool versions that changed Vitest/Playwright behavior. This was corrected with `npm ci`; final focused web tests ran with lockfile-aligned Vitest `4.0.18` and Playwright `1.58.2`.
- Browser validation initially failed because the standalone web build was missing. The web build was completed and desktop/mobile report fit E2E passed afterward.
- A parallel desktop/mobile Playwright run failed once with `EADDRINUSE` on the shared OAuth test port `4445`; rerunning the two checks sequentially passed.

## Open Items

- None.

## References

- Scope debate note: none
- Linear tickets: none
