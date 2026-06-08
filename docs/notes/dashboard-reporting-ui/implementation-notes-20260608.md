# Dashboard Reporting UI Implementation Notes

Updated: 2026-06-08

This note records the current dashboard reporting UI contracts and known limits. It is implementation-facing, not a product scope doc.

## Report surfaces

- Web route: `/reports`
- API routes:
  - `GET /reports/daily-review`
  - `GET /reports/portfolio`
  - `GET /reports/market`
- Shared query params:
  - `scope`: `all | TW | US | AU | KR`
  - `currencyMode`: `auto | specified`
  - `currency`: `TWD | USD | AUD | KRW` when `currencyMode=specified`
  - `range`: freeform validated string, max length 20
  - `limit`: `1..100`
  - `offset`: `>= 0`

Route state is URL-backed on the web side. Invalid `tab`, `scope`, `currencyMode`, or `currency` values fall back predictably in the client parser instead of throwing.

The `/reports` page uses a bounded server-seed budget for the active report. If a scoped report is slow, the route aborts the server-seed fetch, renders the report shell first, and lets the client cache/silent-refresh path populate the data instead of blocking first paint. Single-market performance refreshes now use one scoped aggregate snapshot query rather than per-holding snapshot fanout, so TW-scoped reports do not initially paint and then fail on the later refresh path for that reason.

## Scope and currency semantics

- `scope=all` means the full visible portfolio context.
- Single-market scopes (`TW`, `US`, `AU`, `KR`) filter by holding/trade/instrument market first, with account/default-currency market only as a fallback.
- `currencyMode=auto` resolves reporting currency as:
  - full portfolio: user reporting currency preference
  - single-market scope: native market currency from `currencyFor(scope)`
- `currencyMode=specified` requires `currency` and forces all report totals into that currency.
- `query.nativeCurrency` is `null` for `scope=all` and the market-native currency for single-market scopes.

These semantics are implemented centrally in `apps/api/src/services/reportContext.ts`.

## DTO semantics

All three report DTOs share:

- `query`: resolved scope/currency/range/as-of metadata
- `summary`: server-authoritative totals for cost basis, market value, unrealized P&L, realized P&L, daily change, daily change %, and income
- `fxStatus`: `complete | partial | missing`, plus `reportingCurrency`, `nativeCurrencies`, and missing FX pairs
- `fxRates`: resolved conversion rows `{ fromCurrency, toCurrency, rate, asOf }` used to explain visible cross-market conversions
- `dataHealth`: holding count plus missing/provisional/stale quote and missing FX counts

Per-report sections:

- `DailyReviewReportDto`
  - `suggestions`: deterministic descriptive observations only
  - `topMovers`: up to five rows sorted by absolute daily move
  - `holdings`: bounded paged detail rows
- `PortfolioReportDto`
  - `performance`: scoped time series in reporting currency
  - `allocation`: `byMarket` and `byAccount`
  - `concentration.topHoldings`
  - `income`: trailing dividend amount and recent posted dividend count
  - `holdings`: bounded paged detail rows
- `MarketReportDto`
  - `performance`: same scoped-performance contract
  - `marketSummary`: market allocation buckets
  - `topHoldings`
  - `detail`: bounded paged detail rows

`ReportHoldingRowDto` is the common detail-row contract. Amount fields are already translated into `reportingCurrency`; the client formats them but does not recompute accounting semantics. Rows also carry native price/value fields, explicit reporting unit prices, and `fxRateToReporting` so UI and MCP consumers can disclose the original market price when the selected reporting currency differs from the ticker currency.

## Stale-While-Revalidate route DTO cache

The web app uses a localStorage-backed route DTO cache in `apps/web/lib/routeDtoCache.ts`.

- Cache prefix: `vakwen:route-dto-cache`
- Schema version: `2026-06-08-dashboard-reporting-ui-v1`
- Default TTL: 3 minutes
- Behavior:
  - restore cached route DTO immediately when there is no server-seeded payload
  - keep visible content mounted during refresh
  - revalidate in the background and replace data on success
  - manual refresh bypasses cache for the fetch, but still rewrites cache from the fresh response

Current key dimensions:

- reports: route, tab, shared-context scope cookie, locale, report scope, currency mode, effective currency token, range
- dashboard: route, shared-context scope cookie, locale
- portfolio: route, shared-context scope cookie, locale
- transactions: route, shared-context scope cookie, locale

Invalidation is prefix-wide today. Reporting-currency changes and shared-context switches clear the full route DTO cache prefix rather than performing route-specific eviction.

## Dashboard command surface

Dashboard is the primary daily command surface.

- The command modules rendered above the card grid are `Today`, `Market Pulse`, and `Portfolio Health`.
- The hero exposes the active reporting currency and writes changes through `PATCH /user-preferences`.
- The hero lists resolved FX conversion rows when the active reporting currency differs from one or more native holding currencies.
- The hero market strip deep-links into `/reports?tab=market...` using the active reporting currency.
- The dashboard holdings module is a top-holdings preview, not the full portfolio holdings table. It prioritizes reporting-currency value/price, search, sorting, market filtering, ticker links, and tap/click detail disclosure for native price and FX rate.
- Desktop dashboard holdings use a sticky-header/sticky-first-column table to keep the rich data scannable. Mobile dashboard holdings use stacked cards with detail disclosure instead of forcing table scanning.
- The command palette registry includes `/reports` as a first-class route command with `reports`, `analysis`, `daily`, and `market` keywords.

Current follow-up validation:

- `apps/web/components/dashboard/DashboardHoldingsPreview.tsx` currently has UX refinements for the preview root wrapper, search/sort/filter controls, desktop table layout, daily-change label/cell selectors, visible native-price cues, click/tap price translation details, and quote-status wording (`Current`, `Provisional`, `No market data`).
- `apps/web/components/reports/ReportsClient.tsx` currently has signed finance-tone formatting, FX/reporting badges, native/reporting price disclosure, mobile card detail sheets, sticky desktop table headers/first columns, and explicit mobile `Open ticker` actions for report holding cards.
- Matching E2E selector updates live in `libs/test-e2e/src/pages/dashboard/DashboardPage.ts` and `libs/test-e2e/src/assistants/dashboard/DashboardAssert.ts`.
- Focused dashboard web component coverage plus affected dashboard/mobile E2E assertions passed from the main session.

This keeps dashboard as the launch surface and `/reports` as the structured analysis surface.

## Ticker primary/enrichment split

Backend and shared-type contracts now define a split surface:

- `GET /tickers/:ticker/primary`
  - `identity`
  - `quote`
  - `position`
  - `transactions`
  - `dividends`
  - `holdingGroup`
  - `accountBreakdown`
- `GET /tickers/:ticker/enrichment`
  - `identity`
  - `chart`
  - `fundamentals`
  - `fundamentalsRefresh`

Current limitation:

- The web ticker page has not fully adopted these new endpoints yet.
- `app/tickers/[ticker]/page.tsx` still seeds its primary model by combining dashboard primary data, filtered transaction history, and repair instrument metadata.
- `TickerHistoryClient` then refreshes richer data through the legacy ticker-details fetch path.

Treat the split as the backend contract that should replace the legacy read path, not as a fully completed web-route migration.

## MCP report tool exposure and advice boundary

Three report tools are now exposed under `portfolio:mcp_read`:

- `get_daily_review_report`
- `get_portfolio_report`
- `get_market_report`

They reuse the report query shape and bounded detail controls from the web/API surface.

Tool descriptions explicitly stay on the descriptive side of the advice boundary:

- allowed: descriptive portfolio state, health, performance, holdings, deterministic observations
- not allowed: investment, tax, suitability, target-price, buy/sell/hold, or rebalancing advice

The AI Connector settings page also renders the server-provided tool catalog so users can discover the MCP report tools even when no connector-level tool override has been saved yet. Per-connector tool rows show whether each tool is inherited, overridden, policy-disabled, or blocked by missing consent scope.

## Current read-path and performance limitations

- Report builders still start from `persistence.loadStore(userId)` and then scope/translate in memory. There is no narrow Postgres report projection yet.
- `GET /dashboard/primary`, `GET /portfolio/primary`, and `GET /transactions/primary` still rely on `loadStore()` for consistency with existing grouped-holdings and fee-profile behavior.
- The ticker web route still depends on dashboard primary data plus filtered transaction history instead of a route-owned primary endpoint.
- Report performance for single-market scopes now uses `getAggregatedSnapshotsInReportingCurrencyForScope()` to aggregate all scoped `(accountId, ticker)` contributors in one persistence read, with FX conversion resolved inside that aggregate path. A broader report-specific projection remains a follow-up because report builders still begin from `loadStore(userId)`.
- Cache invalidation is deliberately coarse. Currency/context changes clear the whole route DTO cache prefix.

These are known transitional costs, not accidental behavior.

## Evidence

- API integration coverage for report routes, scoped performance aggregation, and ticker split:
  - `apps/api/test/integration/reports.integration.test.ts`
  - Scoped portfolio/market report tests assert `getAggregatedSnapshotsInReportingCurrencyForScope()` is used and `getHoldingSnapshotsForTicker()` is not used for scoped performance aggregation.
- MCP tool registration and advice-boundary coverage:
  - `apps/api/test/unit/mcpReportTools.test.ts`
- Web route and client coverage:
  - `apps/web/test/app/reports/reportsPage.test.tsx`
  - `apps/web/test/components/reports/ReportsClient.test.tsx`
  - `apps/web/test/features/reports/reportState.test.ts`
  - `apps/web/test/lib/routeDtoCache.test.ts`
  - `apps/web/test/app/heavyPages.serverSeed.test.ts`
- Full local PR gate after the 2026-06-08 scoped-report server-seed abort fix:
  - `npx eslint .`
  - `npm run typecheck`
  - `npm run test --prefix apps/web`
  - `npm run test --prefix apps/api`
  - `npm run test:integration:full:host`
  - `npm run test:e2e:bypass:mem --prefix apps/web`
  - `npm run test:e2e:oauth:mem --prefix apps/web`
  - `npm run test:http --prefix apps/api`
- Follow-up coverage for the scoped-report single-query aggregate and duplicate-pair hardening:
  - `npx vitest run test/integration/reports.integration.test.ts` from `apps/api`
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 515 tests.
  - `npm run test --prefix apps/api` passed: 1,476 tests, 412 skipped.
  - `npm run test:integration:full:host` passed: 801 tests, 1 skipped; includes Postgres scoped aggregate tests `INT-7` and `INT-8` in `dashboardReportingCurrencyAggregation.integration.test.ts`, including duplicate scoped pair inputs that must not double-count report performance values.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 258 tests, 9 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 119 tests.
  - `npm run test:http --prefix apps/api` passed: 284 tests, 2 skipped.
