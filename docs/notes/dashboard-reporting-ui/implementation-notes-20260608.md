# Dashboard Reporting UI Implementation Notes

Updated: 2026-06-09

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

The `/reports` page uses a bounded server-seed budget for the active report. If a scoped report is slow, the route aborts the server-seed fetch, renders the report shell first, and lets the client cache/silent-refresh path populate the data instead of blocking first paint. Single-market performance refreshes now use one scoped aggregate snapshot query rather than per-holding snapshot fanout, so TW-scoped reports do not initially paint and then fail on the later refresh path for that reason. The report controls read the effective range list from user/admin preferences and snap unsupported URL ranges to the first effective range.

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

Dashboard holding-group DTOs now carry the same explicit reporting-price lineage for current unit price: `reportingCurrentUnitPrice` is emitted on translated dashboard holding groups and children when FX is available. The dashboard Holdings preview consumes that field first and only falls back to `reportingMarketValueAmount / quantity` for older cached DTOs that predate the field.

## Stale-While-Revalidate route DTO cache

The web app uses a localStorage-backed route DTO cache in `apps/web/lib/routeDtoCache.ts`.

- Cache prefix: `vakwen:route-dto-cache`
- Schema version: `2026-06-09-dashboard-reporting-ui-v2`
- Default TTL: 3 minutes
- Behavior:
  - restore cached route DTO immediately when there is no server-seeded payload
  - keep visible content mounted during refresh
  - revalidate in the background and replace data on success
  - manual refresh bypasses cache for the fetch, but still rewrites cache from the fresh response

Current key dimensions:

- reports: route, tab, signed-in session user, shared-context scope cookie, locale, report scope, currency mode, effective currency token, range
- dashboard: route, signed-in session user, shared-context scope cookie, locale
- portfolio: route, signed-in session user, shared-context scope cookie, locale
- transactions: route, signed-in session user, shared-context scope cookie, locale

Dashboard additionally validates restored primary DTOs against the expected reporting currency resolved from the current server-seeded `/dashboard/primary` response or `/user-preferences`. If the expected currency cannot be established during server render, the dashboard skips local cache restore rather than risking a cached payload with values from a different reporting currency.

Invalidation is prefix-wide today. Reporting-currency changes, shared-context switches, sign-out, API-driven 401 logout, and signed-in session user changes clear the full route DTO cache prefix rather than performing route-specific eviction.

## Dashboard command surface

Dashboard is the primary daily command surface.

- The command modules rendered above the card grid are `Today`, `Market Pulse`, and `Portfolio Health`.
- The hero exposes the active reporting currency and writes changes through `PATCH /user-preferences`.
- The hero lists resolved FX conversion rows when the active reporting currency differs from one or more native holding currencies.
- The hero market strip deep-links into `/reports?tab=market...` using the active reporting currency.
- The dashboard holdings module is a top-holdings preview, not the full portfolio holdings table. It prioritizes server-provided reporting-currency value/price, search, sorting, market filtering, ticker links, an always-visible FX strip for visible cross-currency holdings, and tap/click detail disclosure for native price and FX rate.
- Desktop dashboard holdings use a sticky-header/sticky-first-column table to keep the rich data scannable. Mobile dashboard holdings use stacked cards with detail disclosure instead of forcing table scanning.
- Holding Focus now restores account-level visibility on the dashboard. Desktop rows can expand into account rows inside the holdings-first table, and mobile/detail disclosure uses a sheet with `Summary`, `Accounts`, `Cost/P&L`, and `FX/Price` sections. The currently verified detail-sheet content includes Book Cost, portfolio allocation, average cost, latest price, and ticker navigation; `FX-Translated Cost` and market-allocation detail remain follow-up work.
- Holding Focus chip preferences persist under the existing `user_preferences.preferences.dashboardHoldingFocus` JSON key. The saved object shape is `{ presetOrder, hiddenPresets, selectedPreset }`. This change does not introduce a migration or a new table.
- `PATCH /user-preferences` keeps the existing top-level merge semantics for preferences: `dashboardHoldingFocus` is patched as a full object, `dashboardHoldingFocus: null` clears the key, and there is no sub-object merge path for this preference. `cardOrder` remains the only special-cased nested merge key.
- The command palette registry includes `/reports` as a first-class route command with `reports`, `analysis`, `daily`, and `market` keywords.

Current follow-up validation:

- `apps/web/components/dashboard/DashboardHoldingsPreview.tsx` currently has UX refinements for the preview root wrapper, search/sort/filter controls, visible FX-rate strip, desktop table layout, daily-change label/cell selectors, visible native-price cues, click/tap price translation details, and quote-status wording (`Current`, `Provisional`, `No market data`).
- `apps/web/components/dashboard/DashboardHoldingsPreview.tsx` also hydrates/persists `dashboardHoldingFocus` preferences by writing the full `{ presetOrder, hiddenPresets, selectedPreset }` object through `PATCH /user-preferences`.
- `apps/api/src/services/dashboardReportingCurrency.ts` now adds performance freshness metadata (`requestedAsOf`, `lastReliableDate`, `marketDataStaleSince`) from the last reliable point, so dashboard/report charts can explain when a selected range extends beyond available market data.
- `apps/web/components/dashboard/PortfolioTrendCard.tsx`, `apps/web/components/dashboard/ReturnPercentCard.tsx`, and `apps/web/components/reports/ReportsClient.tsx` display `As of {date}` and `Market data stale since {date}` from that server metadata. Report performance charts do not bridge null-valued gaps, and dashboard/report performance labels now call the stable cost line `Book Cost`.
- `apps/web/components/reports/ReportsClient.tsx` currently has signed finance-tone formatting, FX/reporting badges, native/reporting price disclosure, mobile card detail sheets, sticky desktop table headers/first columns, and explicit mobile `Open ticker` actions for report holding cards.
- `apps/web/features/reports/hooks/useReportData.ts` accepts matching refreshed server-seeded report DTOs after context/range changes and writes them back to the route DTO cache instead of treating `initialReport` as a one-time value.
- Matching E2E selector updates live in `libs/test-e2e/src/pages/dashboard/DashboardPage.ts` and `libs/test-e2e/src/assistants/dashboard/DashboardAssert.ts`.
- Focused Holding Focus coverage currently comes from:
  - `apps/web/test/features/dashboard/components.test.tsx` for desktop account-row expansion, mobile/detail-sheet sections, preference hydration/PATCH persistence, active-chip fallback when hiding the selected preset, chip reorder, and reset/default behavior.
  - `apps/api/test/http/specs/user-preferences-aaa.http.spec.ts` for `dashboardHoldingFocus` round-trip, `null` clear, and invalid-preference rejection.
  - `apps/api/test/integration/user-preferences.integration.test.ts` for memory parity and managed Postgres persistence semantics: full-object replace and `dashboardHoldingFocus: null` clear.
  - Affected dashboard/mobile selector assertions remain covered through the existing dashboard/mobile E2E suites listed in Evidence.

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

MCP report input parsing accepts both `currency` and `reportingCurrency`. When `reportingCurrency` is provided without an explicit `currencyMode`, the server treats it as `currencyMode=specified` so ChatGPT/tool callers receive the requested reporting currency instead of falling back to auto currency resolution.

## Current read-path and performance limitations

- Report builders still start from `persistence.loadStore(userId)` and then scope/translate in memory. There is no narrow Postgres report projection yet.
- `GET /dashboard/primary`, `GET /portfolio/primary`, and `GET /transactions/primary` still rely on `loadStore()` for consistency with existing grouped-holdings and fee-profile behavior.
- The ticker web route still depends on dashboard primary data plus filtered transaction history instead of a route-owned primary endpoint.
- Report performance for single-market scopes now scopes the aggregate snapshot read through `getAggregatedSnapshotsInReportingCurrencyForScope()` and reuses the dashboard performance translator. When scoped snapshots are absent, the same translator falls back to synthetic trade replay against the scoped store instead of returning an empty chart. A broader report-specific projection remains a follow-up because report builders still begin from `loadStore(userId)`.
- Cache invalidation is deliberately coarse. Currency/context changes clear the whole route DTO cache prefix.

These are known transitional costs, not accidental behavior.

## Evidence

- API integration coverage for report routes, scoped performance aggregation, and ticker split:
  - `apps/api/test/integration/reports.integration.test.ts`
  - Scoped portfolio/market report tests assert `getAggregatedSnapshotsInReportingCurrencyForScope()` is used, `getHoldingSnapshotsForTicker()` is not used for scoped performance aggregation, and scoped reports synthesize performance points when scoped snapshots are absent but daily bars/trades exist.
- MCP tool registration and advice-boundary coverage:
  - `apps/api/test/unit/mcpReportTools.test.ts`
- Web route and client coverage for `/reports` fallback and URL-backed state sync:
  - `apps/web/test/app/reports/reportsPage.test.tsx`
  - `apps/web/test/components/reports/ReportsClient.test.tsx`
  - `apps/web/test/features/reports/reportState.test.ts`
  - `apps/web/test/features/reports/hooks/useReportData.test.tsx`
  - `apps/web/test/lib/routeDtoCache.test.ts`
  - `apps/web/test/app/heavyPages.serverSeed.test.ts`
- Dashboard holdings FX visibility and UX coverage:
  - `apps/web/test/features/dashboard/components.test.tsx`
  - `apps/web/tests/e2e/specs/dashboard-daily-change-aaa.spec.ts`
  - `apps/web/tests/e2e/specs/mobile-tables-aaa.spec.ts`
- Holding Focus preference and persistence coverage:
  - `apps/api/test/http/specs/user-preferences-aaa.http.spec.ts`
  - `apps/api/test/integration/user-preferences.integration.test.ts`
  - `apps/web/test/features/dashboard/components.test.tsx`
- Dashboard holding-group reporting unit-price coverage:
  - `apps/api/test/unit/dashboardHoldingGroups.test.ts`
  - `apps/web/test/features/dashboard/components.test.tsx`
- Dashboard/report performance stale-data coverage:
  - `apps/api/test/unit/dashboardReportingCurrency.test.ts`
  - `apps/web/test/features/dashboard/components.test.tsx`
  - `apps/web/test/components/reports/ReportsClient.test.tsx`
- Dashboard reporting-currency cache-restore coverage:
  - `apps/web/test/features/dashboard/hooks/useDashboardPrimaryData.test.tsx`
- AI Connector settings catalog coverage:
  - `apps/web/test/components/settings/AiConnectorsSettingsClient.test.tsx`
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
- Follow-up coverage for the 2026-06-09 route-cache/report/MCP fixes:
  - Focused web: `npx vitest run test/lib/routeDtoCache.test.ts test/components/reports/ReportsClient.test.tsx test/features/reports/hooks/useReportData.test.tsx` passed: 9 tests.
  - Focused API: `npx vitest run test/unit/mcpReportTools.test.ts test/integration/reports.integration.test.ts --no-file-parallelism` passed: 10 tests.
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 192 + 326 tests across the split web package run.
  - `npm run test --prefix apps/api` passed: 1,478 tests, 412 skipped.
  - `npm run test:integration:full:host` passed: 802 tests, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 258 tests, 9 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 119 tests.
  - `npm run test:http --prefix apps/api` passed: 284 tests, 2 skipped.
- Follow-up coverage for the scoped no-snapshot fallback, report URL sync, and dashboard holdings FX strip:
  - Focused API: `npx vitest run test/unit/dashboardHoldingGroups.test.ts test/integration/reports.integration.test.ts --no-file-parallelism` passed: 11 tests.
  - Focused web: `npx vitest run test/features/dashboard/components.test.tsx test/components/reports/ReportsClient.test.tsx` passed: 24 tests.
  - Targeted lint for the changed API/web/shared-type files passed.
  - `npm run typecheck` passed.
  - Full local eight-suite gate passed on 2026-06-09:
    - `npx eslint .`
    - `npm run typecheck`
    - `npm run test --prefix apps/web`: 193 + 331 tests passed.
    - `npm run test --prefix apps/api`: 1,478 tests passed, 412 skipped.
    - `npm run test:integration:full:host`: 802 tests passed, 1 skipped.
    - `npm run test:e2e:bypass:mem --prefix apps/web`: 258 tests passed, 9 skipped.
    - `npm run test:e2e:oauth:mem --prefix apps/web`: 119 tests passed.
    - `npm run test:http --prefix apps/api`: 284 tests passed, 2 skipped.
    - Final process audit found no orphan app/test runners; only the expected Homebrew Postgres service remained.
- Follow-up coverage for dashboard reporting-currency cache hardening and MCP catalog visibility:
  - `npx vitest run test/features/dashboard/hooks/useDashboardPrimaryData.test.tsx test/components/settings/AiConnectorsSettingsClient.test.tsx` from `apps/web` passed: 12 tests.
  - `npx vitest run test/features/dashboard/components.test.tsx test/components/reports/ReportsClient.test.tsx test/features/dashboard/hooks/useDashboardPrimaryData.test.tsx test/components/settings/AiConnectorsSettingsClient.test.tsx` from `apps/web` passed: 37 tests.
- Final local eight-suite gate after dashboard reporting-currency cache hardening and the semantic finance-token E2E assertion update:
  - Focused E2E: `npm run test:e2e:bypass:mem --prefix apps/web -- tests/e2e/specs/dashboard-daily-change-aaa.spec.ts` passed: 5 tests.
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 193 + 333 tests across the split web package run.
  - `npm run test --prefix apps/api` passed: 1,479 tests, 412 skipped.
  - `npm run test:integration:full:host` passed: 803 tests, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 258 tests, 9 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 119 tests.
  - `npm run test:http --prefix apps/api` passed: 284 tests, 2 skipped.
  - Process audits before and after the E2E/API HTTP gates found no orphan app/test runners; only the expected Homebrew Postgres service remained.

Current validation status: the latest recorded branch-wide verification is the 2026-06-09 final local eight-suite gate after dashboard reporting-currency cache hardening and the semantic finance-token E2E assertion update.
