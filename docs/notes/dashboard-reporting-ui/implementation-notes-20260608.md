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

The `/reports` page uses a bounded server-seed budget for the active report. If a scoped report is slow, the route renders the report shell first and lets the client cache/silent-refresh path populate the data instead of blocking first paint.

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

`ReportHoldingRowDto` is the common detail-row contract. Amount fields are already translated into `reportingCurrency`; the client formats them but does not recompute accounting semantics.

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
- The dashboard holdings module is a compact top-holdings preview, not the full portfolio holdings table. It prioritizes reporting-currency value/price, sorting, market filtering, ticker links, and tap/click detail disclosure for native price and FX rate.
- The command palette registry includes `/reports` as a first-class route command with `reports`, `analysis`, `daily`, and `market` keywords.

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

The AI Connector settings page also renders the server-provided tool catalog so users can discover the MCP report tools even when no connector-level tool override has been saved yet.

## Current read-path and performance limitations

- Report builders still start from `persistence.loadStore(userId)` and then scope/translate in memory. There is no narrow Postgres report projection yet.
- `GET /dashboard/primary`, `GET /portfolio/primary`, and `GET /transactions/primary` still rely on `loadStore()` for consistency with existing grouped-holdings and fee-profile behavior.
- The ticker web route still depends on dashboard primary data plus filtered transaction history instead of a route-owned primary endpoint.
- Report performance for single-market scopes walks holding snapshots per `(accountId, ticker)` pair and performs FX lookups during aggregation.
- Cache invalidation is deliberately coarse. Currency/context changes clear the whole route DTO cache prefix.

These are known transitional costs, not accidental behavior.

## Evidence

- API integration coverage for report routes and ticker split:
  - `apps/api/test/integration/reports.integration.test.ts`
- MCP tool registration and advice-boundary coverage:
  - `apps/api/test/unit/mcpReportTools.test.ts`
- Web route and client coverage:
  - `apps/web/test/app/reports/reportsPage.test.tsx`
  - `apps/web/test/components/reports/ReportsClient.test.tsx`
  - `apps/web/test/features/reports/reportState.test.ts`
  - `apps/web/test/lib/routeDtoCache.test.ts`
  - `apps/web/test/app/heavyPages.serverSeed.test.ts`
