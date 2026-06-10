# Dashboard Reporting UI Implementation Notes

Updated: 2026-06-10

This note records the current dashboard reporting UI contracts and known limits. It is implementation-facing, not a product scope doc.

## Report surfaces

- Web route: `/reports`
- API routes:
  - `GET /reports/daily-review`
  - `GET /reports/portfolio`
  - `GET /reports/market`
- Shared query params:
  - `scope`: `all | TW | US | AU | KR`
  - `range`: freeform validated string, max length 20
  - `limit`: `1..100`
  - `offset`: `>= 0`

Route state is URL-backed on the web side and currently carries only `tab`, `scope`, and `range`. Invalid `tab`, `scope`, or `range` values fall back predictably in the client parser instead of throwing.

The reports web UI no longer exposes a page-local reporting-currency override. It always calls the API with `currencyMode=auto`, and reporting currency changes are owned by global Quick Actions. Compatibility callers may still send `currencyMode` or `currency`, but the current resolver normalizes report requests to the locked redesign behavior described below.

The `/reports` page does not server-seed the active report. It renders the report shell first and lets the client cache/silent-refresh path populate the data. This avoids starting duplicate expensive report builds from the Next.js server and the browser on scoped report pages. Single-market performance refreshes now use one scoped aggregate snapshot query rather than per-holding snapshot fanout, so TW-scoped reports do not initially paint and then fail on the later refresh path for that reason. The report controls read the effective range list from user/admin preferences and snap unsupported URL ranges to the first effective range.

## Scope and currency semantics

- `scope=all` means the full visible portfolio context.
- Single-market scopes (`TW`, `US`, `AU`, `KR`) filter by holding/trade/instrument market first, with account/default-currency market only as a fallback.
- Reporting currency resolves as:
  - full portfolio: user reporting currency preference
  - single-market scope: native market currency from `currencyFor(scope)`
- `resolveReportContext()` currently normalizes all report requests to `currencyMode: "auto"` and `currency: null`, even if a compatibility caller passes `currencyMode=specified` or `currency`.
- `query.nativeCurrency` is `null` for `scope=all` and the market-native currency for single-market scopes.

These semantics are implemented centrally in `apps/api/src/services/reportContext.ts` and mirrored by the URL-backed report state in `apps/web/features/reports/reportState.ts`.

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

Current naming/status note:

- Wire DTO field names are still `totalCostAmount` / `costBasisAmount`, but the dashboard/report chart labels now present that series as `Book Cost`.
- The newer transaction-date-FX, weighted-average Book Cost overlay is currently applied to performance points in `apps/api/src/services/dashboardReportingCurrency.ts`.
- The dated finance replay uses canonical lot allocations and stored realized P&L when sell allocation data is available; it only falls back to average reporting-cost reduction when a sell has no allocation projection.
- Dashboard/report summary totals, Holding Focus detail rows, `FX-Translated Cost` disclosure, and incomplete-count diagnostics have not yet been fully migrated to that newer Book Cost contract and remain documented follow-up work.
- Report responses now include an explicit `diagnostics` object for scope/currency/as-of/stale/FX/quote/row-count explainability, but Book Cost incomplete semantics still need the separate transaction-date-FX summary/detail migration before those totals can be marked complete/incomplete at aggregate level.

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
- The hero exposes the active reporting currency and points users to global Quick Actions when they need to change it.
- Global Quick Actions writes reporting-currency changes through `PATCH /user-preferences` and is the only primary reporting-currency switcher on authenticated editable surfaces.
- The hero lists resolved FX conversion rows when the active reporting currency differs from one or more native holding currencies.
- The hero market strip deep-links into `/reports?tab=market...` using the active reporting currency.
- The dashboard holdings module is a top-holdings preview, not the full portfolio holdings table. It prioritizes server-provided reporting-currency value/price, search, sorting, market filtering, ticker links, an always-visible FX strip for visible cross-currency holdings, and tap/click detail disclosure for native price and FX rate.
- Desktop dashboard holdings use a sticky-header/sticky-first-column table to keep the rich data scannable. Mobile dashboard holdings use stacked cards with detail disclosure instead of forcing table scanning.
- Holding Focus now restores account-level visibility on the dashboard. Desktop rows can expand into account rows inside the holdings-first table, and mobile/detail disclosure uses a sheet with `Summary`, `Accounts`, `Cost/P&L`, and `FX/Price` sections. The currently verified detail-sheet content includes Book Cost, portfolio allocation, average cost, latest price, and ticker navigation; `FX-Translated Cost` and market-allocation detail remain follow-up work.
- Holding Focus chip preferences persist under the existing `user_preferences.preferences.dashboardHoldingFocus` JSON key. The saved object shape is `{ presetOrder, hiddenPresets, selectedPreset }`. This change does not introduce a migration or a new table.
- `PATCH /user-preferences` keeps the existing top-level merge semantics for preferences: `dashboardHoldingFocus` is patched as a full object, `dashboardHoldingFocus: null` clears the key, and there is no sub-object merge path for this preference. `cardOrder` remains the only special-cased nested merge key.
- The command palette registry includes `/reports` as a first-class route command with `reports`, `analysis`, `daily`, and `market` keywords.

Operational note:

- Global Quick Actions is mounted at the authenticated app-shell level, not as a page-local dashboard/reports control. It is intentionally hidden in shared/read-only contexts.
- The global action set is currently `Add transaction`, `Recompute portfolio`, `Generate snapshots`, and `Change reporting currency`.
- Reporting-currency writes from Quick Actions invalidate the route DTO cache prefix so restored dashboard/report/portfolio/ticker payloads cannot be relabeled after a preference change.
- User-triggered snapshot generation is limited to the current editable portfolio/context. Broader stale/missing snapshot repair remains a backend/admin/system concern.

Current follow-up validation:

- `apps/web/components/dashboard/DashboardHoldingsPreview.tsx` currently has UX refinements for the preview root wrapper, search/sort/filter controls, visible FX-rate strip, desktop table layout, daily-change label/cell selectors, visible native-price cues, click/tap price translation details, and quote-status wording (`Current`, `Provisional`, `No market data`).
- `apps/web/components/dashboard/DashboardHoldingsPreview.tsx` also hydrates/persists `dashboardHoldingFocus` preferences by writing the full `{ presetOrder, hiddenPresets, selectedPreset }` object through `PATCH /user-preferences`.
- `apps/api/src/services/dashboardReportingCurrency.ts` now adds performance freshness metadata (`requestedAsOf`, `lastReliableDate`, `marketDataStaleSince`) from the last reliable point, so dashboard/report charts can explain when a selected range extends beyond available market data.
- `apps/api/src/services/dashboardReportingCurrency.ts` also overlays snapshot-backed performance points with transaction-date-FX finance data when store data is available, so snapshot Market Value can remain intact while Book Cost, realized P&L, dividends, Total Return, and Return % come from the newer read-time calculation path.
- `apps/web/components/dashboard/PortfolioTrendCard.tsx`, `apps/web/components/dashboard/ReturnPercentCard.tsx`, and `apps/web/components/reports/ReportsClient.tsx` display `As of {date}` and `Market data stale since {date}` from that server metadata. Report performance charts do not bridge null-valued gaps or synthesize current-holdings points when snapshots are absent, and dashboard/report performance labels now call the stable cost line `Book Cost`.
- `apps/web/components/reports/ReportsClient.tsx` currently has signed finance-tone formatting, FX/reporting badges, native/reporting price disclosure, mobile card detail sheets, sticky desktop table headers/first columns, and explicit mobile `Open ticker` actions for report holding cards.
- `apps/web/features/reports/hooks/useReportData.ts` still accepts a matching initial report DTO for compatibility, but `/reports` currently passes `initialReport={null}` so the server route does not start report builds before hydration.
- `apps/web/features/reports/hooks/useReportData.ts` now bounds client-side report refreshes with a 90s abort timeout. This prevents scoped reports whose client refresh stalls from leaving users in an indefinitely disabled refresh/loading state; the UI now surfaces a retryable report-unavailable message.
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

- The web ticker page has not fully adopted the route-owned `/tickers/:ticker/primary` endpoint yet.
- `app/tickers/[ticker]/page.tsx` still seeds its primary model by combining dashboard primary data, filtered transaction history, and repair instrument metadata.
- `TickerHistoryClient` now hydrates normal mount/return-navigation secondary data through `/tickers/:ticker/enrichment`, so chart/fundamentals refresh without repeating the full details payload.
- Ticker transaction mutations still refresh through `/tickers/:ticker/details` after reloading transactions because quantity, average cost, Book Cost, and related primary stats can change.
- `TickerHistoryClient` caches the hydrated ticker details model under the shared route DTO cache prefix with session-user, portfolio-context, locale, ticker, market, and account dimensions. Return navigation can restore the previously hydrated quote/position/chart/account details immediately while enrichment runs silently.

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

MCP report input parsing still accepts both `currency` and `reportingCurrency` for compatibility. The current report resolver normalizes those requests to the same auto/native currency semantics as the web UI, so callers should not expect a separate manual report-specific currency override path today.

## Current read-path and performance limitations

- Report builders still start from `persistence.loadStore(userId)` and then scope/translate in memory. There is no narrow Postgres report projection yet.
- `GET /dashboard/primary`, `GET /portfolio/primary`, and `GET /transactions/primary` still rely on `loadStore()` for consistency with existing grouped-holdings and fee-profile behavior.
- The ticker web route still depends on dashboard primary data plus filtered transaction history instead of a route-owned primary endpoint.
- Report performance for single-market scopes now scopes the aggregate snapshot read through `getAggregatedSnapshotsInReportingCurrencyForScope()` and reuses the dashboard performance translator. When scoped snapshots are absent, the report returns an empty performance series plus freshness metadata instead of synthesizing trade-replay points. Scoped store filtering still builds ticker/holding market indexes once per report so irrelevant dividend-event and instrument rows do not trigger repeated full-store scans before the report reaches the performance query. A broader report-specific projection remains a follow-up because report builders still begin from `loadStore(userId)`.
- Strict snapshot-only charts are intentional on dashboard/reporting surfaces. Missing or stale snapshots should surface as incomplete-state messaging, not as reconstructed trend data.
- Report diagnostics intentionally stay truthful when snapshot-backed valuation is unavailable. The server leaves last/latest reliable valuation dates unset and surfaces `missing_snapshot` rather than echoing the requested `asOf` date as if a valuation existed.
- Scoped snapshot aggregation is market-qualified by `(accountId, ticker, marketCode)` so same-account cross-listed holdings do not suppress valid single-market report trend points.
- Cache invalidation is deliberately coarse. Currency/context changes clear the whole route DTO cache prefix.

These are known transitional costs, not accidental behavior.

## Data health and report row semantics

- Holdings/report/public-share Data health surfaces the same user-facing axes: quote status, FX status, and snapshot/freshness reliability.
- Detailed holdings/report styles show Data health directly; compact surfaces may summarize it, but they still use the same underlying semantics.
- Missing reporting values stay unavailable when quote or FX inputs are incomplete. The UI does not relabel native values as reporting-currency values on dashboard, reports, portfolio, ticker, or public share surfaces.
- Public share pages keep active holdings with missing quotes visible. Quote-missing rows show unavailable market value/allocation plus warning/Data health state, and aggregate totals/allocation percentages exclude those rows rather than implying a precise denominator.
- Reports holdings now use the shared grid behaviors already shipped on this branch: persisted per-context settings, drag reorder, resize handles, wrapped headers/cells, detailed mobile sheets, and English/zh-TW shell/control/meta copy through the `reports` i18n namespace. Deeper body-copy/i18n follow-up remains open.

## Evidence

- API integration coverage for report routes, scoped performance aggregation, and ticker split:
  - `apps/api/test/integration/reports.integration.test.ts`
  - Scoped portfolio/market report tests assert `getAggregatedSnapshotsInReportingCurrencyForScope()` is used, `getHoldingSnapshotsForTicker()` is not used for scoped performance aggregation, market-qualified snapshot contributors are respected, and missing scoped snapshots return an empty performance series plus truthful diagnostics instead of synthetic points.
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
- Focused Book Cost overlay coverage:
  - `apps/api/test/unit/dashboardReportingCurrency.test.ts`
  - `apps/api/test/integration/dashboard.integration.test.ts`
  - `apps/api/test/integration/reports.integration.test.ts`
  - The unit suite covers canonical lot-allocation and realized-P&L replay under dated FX when allocated cost differs from running average cost.
  - The unit suite asserts dashboard/report trend performance stays strict snapshot-only when snapshots are absent instead of synthesizing same-ticker cross-market market values.
  - The reports integration suite now asserts scoped performance reads market-qualified snapshot contributors and returns empty truthful diagnostics when snapshots are absent, not synthetic repaired-bar history.
- Focused report refresh-timeout coverage:
  - `apps/web/test/features/reports/hooks/useReportData.test.tsx`
- Dashboard reporting-currency cache-restore coverage:
  - `apps/web/test/features/dashboard/hooks/useDashboardPrimaryData.test.tsx`
- Ticker hydrated-detail cache restore/write coverage:
  - `apps/web/test/app/tickers/TickerHistoryClient.test.tsx`
- AI Connector settings catalog coverage:
  - `apps/web/test/components/settings/AiConnectorsSettingsClient.test.tsx`
- AI Connector tool availability/unavailable-reason coverage:
  - `apps/api/test/unit/smooth-page-read-paths.test.ts`
  - `apps/web/test/components/settings/AiConnectorsSettingsClient.test.tsx`
  - `/ai/connectors/summary` now returns explicit per-tool `availability` and `unavailableReason` fields; settings renders policy-disabled, inactive-connection, and missing-scope reasons while keeping read-report tools visible.
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
- Follow-up coverage for the 2026-06-09 deployed scoped-report timeout:
  - Chrome extension validation on dev reproduced `scope=TW` Market Report ending in `Report refresh timed out` after the client waited for the report payload.
  - Direct Chrome navigation to the dev API report endpoint returned the TW Market Report payload but took about 50 seconds, isolating the issue to backend report-build latency rather than a frontend crash.
  - Scoped report store filtering was narrowed to precomputed market indexes in `apps/api/src/services/reports.ts`.
  - Focused local verification: `npx eslint apps/api/src/services/reports.ts apps/api/test/integration/reports.integration.test.ts`, `npm --prefix apps/api exec vitest run test/integration/reports.integration.test.ts -- --no-file-parallelism`, `npx tsc --noEmit -p apps/api/tsconfig.json --pretty false`, and `git diff --check`.
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
- Latest local branch-tip gate recorded in this note:
  - `npx vitest run test/unit/dashboardReportingCurrency.test.ts` from `apps/api` passed: 12 tests.
  - `npx vitest run test/integration/dashboard.integration.test.ts test/integration/reports.integration.test.ts --no-file-parallelism` from `apps/api` passed: 22 tests.
  - `npx eslint apps/api/src/services/dashboardReportingCurrency.ts apps/api/test/unit/dashboardReportingCurrency.test.ts` passed.
  - `npx tsc --noEmit -p apps/api/test/unit/tsconfig.json --pretty false` passed.
  - Branch-tip `354b0c05` subsequently passed PR Gate `27205068057`, CI `27205068660`, latest `@codex review` with no inline comments, and dev deploy `27205524079`.
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

Current validation status: PR #208 is CI green at head `ab97590b`. The latest `@codex review` is clean at `issuecomment-4663126252`, and dev deploy run `27229545853` succeeded for `ab97590b`. Chrome extension validation covered the dashboard, scoped TW Market Report, ticker page, and deployed desktop viewport flows; residual notes are one ticker-page DOM-content load beyond 30s and one non-blocking React hydration error. Live mobile resize was not available through the existing Chrome extension connection, so mobile confidence remains from regenerated mockups and Playwright E2E.
