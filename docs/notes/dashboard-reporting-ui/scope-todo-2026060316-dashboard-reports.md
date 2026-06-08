---
slug: dashboard-reporting-ui
source: scope-grill
created: 2026-06-03
updated: 2026-06-08
tickets: []
required_reading:
  - docs/notes/performance-smooth-pages/scope-todo-20260601-performance-smooth-pages.md
  - docs/notes/dashboard-reporting-ui/mockups/reports-mockup.html
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/dashboard-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/dashboard-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/daily-review-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/daily-review-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-report-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-report-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/market-report-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/market-report-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-loading-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-loading-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/ticker-detail-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/ticker-detail-mobile.png
superseded_by: null
---

# Todo: Dashboard Reporting UI

> For agents starting a fresh session: read all files listed in `required_reading` before starting implementation.

## Locked Scope

1. Create one coordinated release/PR on this branch, implemented as phased vertical commits.
2. Use the waiver path for git and PR metadata because there is no Linear ticket.
3. PR waiver block:
   ```md
   ## Waiver
   Reason: Product/reporting scope exploration approved without Linear ticket
   Approved-by: @kzokv
   Scope: both
   ```
4. Dashboard is the daily command surface; `/reports` is the structured analysis surface.
5. The release is foundation-first: correctness and performance must be addressed before report UI polish.
6. All report, dashboard, portfolio, and ticker numbers are server-authoritative. Client code formats and displays values, but must not recompute accounting semantics from raw transactions.
7. Quantity, current holdings, cost basis, average cost, realized P&L, unrealized P&L, market value, daily change, and FX/reporting values come from server projections, read models, or report DTOs.
8. Historical chart values come from server snapshots/read models. If a chart cannot be calculated correctly yet, show a limited/empty state instead of an approximate client-calculated line.
9. Regression fixtures must cover buy, sell, partial sell, fees, realized P&L, unrealized P&L, average cost, and FX conversion.
10. Client-side accounting fallbacks, including ticker fallback chart/cost-basis reconstruction from transactions, must be removed, replaced, or quarantined outside formal reporting surfaces.
11. Review SQL/query/read-path costs for dashboard, portfolio, ticker, and report endpoints. Prefer targeted read-model optimization over a full accounting rewrite.
12. Heavy pages use the performance pattern from the prior smooth-page work: server-provided route-primary DTO, client-side secondary/enrichment fetch, no blanking existing content during refresh, and visible freshness/loading state.
13. Bounded stale-while-revalidate localStorage caching is in scope for primary DTOs: dashboard primary, portfolio primary, report summaries, and ticker primary.
14. Cache keys include route/report, portfolio context owner/user id, scope, currency mode, effective/reporting currency, range where relevant, ticker/market/account where relevant, and schema version.
15. Cache TTL is short, around 2-5 minutes. Manual refresh bypasses cache.
16. Cache invalidates after trade mutation, recompute, currency preference change, shared context switch, account changes, and fee-profile/binding changes.
17. Refresh UX includes page-level refresh plus section-level refresh for independent secondary data such as performance charts, report charts, ticker chart, and quote/freshness.
18. Refreshes must not blank existing content. Existing rows/cards stay mounted with local pending states.
19. Route audit decisions are locked: `/portfolio` and `/transactions` currently passing `initialPrimaryData={null}` is a regression/mismatch and must be fixed.
20. `/dashboard` is partially aligned already, but still needs DTO cache, freshness labels, and refresh controls.
21. `/tickers/[ticker]` is in scope because ticker navigation is part of the dashboard/portfolio back-navigation pain.
22. `/tickers/[ticker]` gets a primary/enrichment split. Primary includes identity, position summary, transaction history preview, account breakdown, and basic quote/status. Enrichment includes chart series, fundamentals, dividends, quote freshness, and provider/backfill metadata.
23. `/tickers/[ticker]` primary data is cache-restored on return navigation and refreshed silently.
24. `/dividends`, `/cash-ledger`, and `/settings/accounts` are acknowledged slow/mismatched routes but are deferred, except for report API data dependencies.
25. Dashboard hero shows active global reporting currency, FX status, and a section settings currency switcher.
26. Dashboard hero currency switcher updates the global reporting currency preference.
27. Dashboard hero includes a compact per-market value strip using the active dashboard reporting currency.
28. Dashboard command modules are `Today`, `Market Pulse`, and `Portfolio Health`.
29. Dashboard should prune or compress duplicate summary/report sections and keep only priority daily-review data.
30. Reports live on a dedicated `/reports` page and are URL-addressable.
31. Report tabs are `Daily Review`, `Portfolio Report`, and `Market Report`; no standalone Currency Report in v1.
32. FX/currency conversion health is integrated across all reports because exchange rate is the major factor for multi-market portfolio reporting.
33. Shared report controls are `scope`, `currencyMode`, `currency`, and range where relevant.
34. `scope = all | TW | US | AU | KR`.
35. `currencyMode = auto | specified`.
36. `currency = TWD | USD | AUD | KRW` when specified.
37. Auto currency behavior: whole portfolio uses user reporting currency; single-market scope uses native market currency via `currencyFor(market)`.
38. Specified currency behavior: all report values convert to the selected currency.
39. Report state is encoded in URL query params with validation and predictable fallbacks.
40. Reports use shadcn-style composition: tabs, cards, badges, controls, drawer/sheet patterns, tables, and charts.
41. Mobile reports use stacked cards and tap-to-detail drawer/sheet patterns instead of forcing table scanning.
42. Desktop reports use charts and tables; wide comparison tables use sticky headers and sticky first columns when applicable.
43. Large money display uses compact units (`K`, `M`, `B`) in hero strips, dashboard compact cards, chart axes, small chart labels, and tight mobile cards.
44. Precise full currency display remains for holdings tables, transaction rows, report detail tables, drawer/sheet detail rows, exports/MCP data, and chart tooltips where exact values matter.
45. Compact money labels include currency code, for example `AUD 1.2M`.
46. `Portfolio Report` is a comprehensive fixed report, not a custom builder.
47. `Portfolio Report` sections: summary, performance trend, allocation, concentration, income, data health, holdings detail.
48. `Market Report` is a full report with scoped performance support.
49. `Market Report` sections: market summary, native/reporting currency handling, performance comparison, top holdings, concentration, data health, detail drilldown.
50. `Daily Review` suggestions are deterministic rule-based suggestions derived from report/dashboard data.
51. Add dedicated MCP report read tools under existing `portfolio:mcp_read`, mirroring the UI report DTOs.
52. MCP tool wording must stay descriptive and avoid investment, tax, suitability, target-price, buy/sell/hold, or rebalancing advice claims.
53. Report endpoints return complete summaries/aggregates plus bounded detail rows with pagination/detail controls.

## Implementation Steps

- [x] Commit 1: add shared correctness/performance foundation.
- [x] Commit 1: add or update accounting/report regression fixtures for buy, sell, partial sell, fees, realized/unrealized P&L, average cost, and FX conversion. Existing portfolio, cash-ledger, snapshot, and FX wallet suites cover the accounting matrix; this branch adds report scope/currency and ticker-split coverage.
- [x] Commit 1: add shared report scope/currency parsing and resolver utilities.
- [x] Commit 1: add shared typed report DTOs for Daily Review, Portfolio Report, Market Report, and report data-health/fx status.
- [x] Commit 1: add compact currency formatting helper with exact-tooltip/full-detail usage rules.
- [x] Commit 1: add bounded DTO cache utility with schema version, TTL, cache-key parts, manual-refresh bypass, and invalidation hooks.
- [x] Commit 1: add route regression tests/guards proving heavy pages with primary endpoints do not pass null primary data.
- [x] Commit 1: review and document current SQL/read-path hotspots for dashboard, portfolio, ticker, and report endpoints.
- [x] Commit 2: align dashboard, portfolio, and transactions loading behavior.
- [x] Commit 2: keep dashboard server-seeded primary data and add local DTO cache/freshness state/page refresh/section refresh controls.
- [x] Commit 2: server-fetch `fetchPortfolioPrimaryData()` in `/portfolio/page.tsx` and pass it to `PortfolioClient`.
- [x] Commit 2: seed AppShell portfolio config from portfolio primary data.
- [x] Commit 2: restore `/transactions` server seeding via `fetchTransactionsPrimaryData()` and pass the payload to `TransactionsClient`.
- [x] Commit 2: use transaction primary portfolio config to avoid duplicate shell config bootstrap where possible.
- [x] Commit 2: add portfolio primary DTO cache restore and silent refresh without blanking holdings/cards.
- [x] Commit 2: add dashboard/portfolio/transactions tests for server seeding, cached restore, manual refresh, and mutation/context invalidation.
- [x] Commit 3: add report API and scope/currency engine.
- [x] Commit 3: add `GET /reports/daily-review` with bounded detail and deterministic suggestions.
- [x] Commit 3: add `GET /reports/portfolio` with comprehensive portfolio sections.
- [x] Commit 3: add `GET /reports/market` with market summaries and scoped market performance.
- [x] Commit 3: implement scoped performance support for all-market and single-market report scopes.
- [x] Commit 3: ensure report values are server-authoritative and include `fxStatus`/data-health metadata.
- [x] Commit 3: add API validation and report service tests for scope/currency resolution, FX conversion, and bounded detail.
- [x] Commit 4: add `/reports` UI.
- [x] Commit 4: add `/reports` page with URL-backed tab/scope/currency/range state.
- [x] Commit 4: build report controls using shadcn-style tabs, controls, badges, cards, charts, and tables.
- [x] Commit 4: implement mobile card layouts and tap-to-detail drawer/sheet behavior.
- [x] Commit 4: implement desktop report tables with sticky header and conditional sticky first column.
- [x] Commit 4: add report page cache restore, silent refresh, page-level refresh, and section-level refresh.
- [x] Commit 4: add web tests for URL fallback, tab switching, report controls, responsive detail behavior, cache restore, and refresh states.
- [x] Commit 5: polish dashboard as command surface.
- [x] Commit 5: add dashboard hero reporting currency indicator, FX status, and section settings currency switcher.
- [x] Commit 5: add dashboard hero market strip with links into `/reports?tab=market&scope=...`.
- [x] Commit 5: add `Today`, `Market Pulse`, and `Portfolio Health` command cards.
- [x] Commit 5: prune or compress duplicate dashboard summary/report sections.
- [x] Commit 5: apply compact currency formatting to hero strip, compact cards, chart axes, and tight mobile cards.
- [x] Commit 5: add dashboard tests for currency switch refresh, report deep links, market strip currency, and duplicate-content pruning.
- [x] Commit 6: optimize ticker detail navigation.
- [x] Commit 6: split `/tickers/[ticker]` into primary and enrichment DTOs/endpoints or equivalent route-owned primary/enrichment fetches.
- [x] Commit 6: make ticker primary include identity, position summary, transaction history preview, account breakdown, and basic quote/status.
- [x] Commit 6: make ticker enrichment include chart series, fundamentals, dividends, quote freshness, and provider/backfill metadata.
- [ ] Commit 6: add ticker primary DTO cache restore and silent refresh for return navigation. Deferred: the API split exists, but the web ticker route still server-seeds the existing details model and fetches enrichment into that model.
- [x] Commit 6: remove or quarantine client-side ticker accounting/chart fallback reconstruction from formal reporting paths. Formal reports use server report DTOs; legacy ticker fallback remains outside `/reports` and is documented as follow-up work.
- [ ] Commit 6: add ticker tests for primary/enrichment split, cached restore, and server-authoritative chart/position values. Partial: split endpoint tests exist; cache-restore route tests remain pending with the deferred web ticker adoption.
- [x] Commit 7: add MCP report tools.
- [x] Commit 7: add MCP tools `get_daily_review_report`, `get_portfolio_report`, and `get_market_report`.
- [x] Commit 7: map MCP tools to the same typed report DTOs and bounded detail controls.
- [x] Commit 7: update MCP tool schemas, discovery, policy mapping, and integration tests.
- [x] Commit 7: enforce descriptive-only wording with no investment, tax, suitability, target-price, buy/sell/hold, or rebalancing advice claims.
- [x] Commit 8: add documentation and final targeted test evidence.
- [x] Commit 8: update this todo with implemented checkboxes and note any deferred route tuning.
- [x] Commit 8: run API unit/integration coverage for report endpoints, query validation, scope/currency resolution, FX conversion, scoped performance, and ticker split.
- [x] Commit 8: run web unit/component coverage for report controls, URL query fallback, mobile drawer behavior, dashboard hero currency switcher, cache restore, refresh controls, and route seeding.
- [ ] Commit 8: run E2E smoke for dashboard currency switching, dashboard market chip report links, report URL restoration, portfolio cached return, transactions primary restoration, and ticker return navigation. Full PR gate is green, but dedicated `/reports` URL restoration and ticker return-cache E2E coverage is still pending with the deferred ticker web adoption.
- [x] Commit 8: run MCP integration tests for all three report tools and schema exposure.

## Open Items

- [x] Final PR gate can run the full eight-suite matrix when preparing the PR, but phased implementation uses targeted coverage first. Completed locally before PR creation.
- [x] Native market currency mapping must remain centralized through `currencyFor(market)` and covered by tests.
- [x] Currency Report remains out of v1; add only if a future scope requires dedicated FX/currency exposure analysis.
- [x] Export/PDF/CSV and custom report builder remain out of v1.
- [x] `/dividends`, `/cash-ledger`, and `/settings/accounts` page-performance tuning remains out of this PR except for report data dependencies.
- [ ] `/settings/fee-config` still uses `loadUserStore`; optimize in a follow-up unless this release needs it to meet transaction/portfolio first-paint goals.
- [ ] `/dashboard/primary`, `/portfolio/primary`, and `/transactions/primary` may still need narrow Postgres projections after this scope stabilizes. Do targeted read-model optimization where feasible, but do not rewrite accounting projections wholesale in this PR.
- [x] Existing mockups remain durable. Regenerate screenshots only if implementation materially diverges from the locked UI structure.

## Verification Log

- [x] Focused API coverage: `npx vitest run apps/api/test/unit/reportContext.test.ts apps/api/test/unit/mcpReportTools.test.ts apps/api/test/integration/reports.integration.test.ts`
- [x] Focused web coverage: `npx vitest run test/features/dashboard/components.test.tsx test/features/reports/reportState.test.ts test/features/reports/reportService.test.ts test/app/reports/reportsPage.test.tsx test/components/reports/ReportsClient.test.tsx test/lib/utils.test.ts test/lib/routeDtoCache.test.ts test/app/portfolio/portfolioPage.test.tsx test/app/transactions/transactionsPage.test.tsx test/app/tickers/tickerHistoryPage.test.tsx test/app/tickers/TickerHistoryClient.test.tsx test/features/dashboard/hooks/useDashboardPrimaryData.test.tsx test/features/portfolio/hooks/usePortfolioPrimaryData.test.tsx test/features/portfolio/hooks/useTransactionsPrimaryData.test.tsx test/features/portfolio/services/portfolioService.test.ts`
- [x] Targeted typechecks: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty false`; `npx tsc --noEmit -p apps/api/tsconfig.json`; `npx tsc --noEmit -p apps/api/test/unit/tsconfig.json`; `npx tsc --noEmit -p apps/api/test/integration/tsconfig.json`
- [x] Pre-PR code review completed: `docs/004-notes/dashboard-reporting-ui/review-20260608-dashboard-reporting-ui.md`
- [x] Full eight-suite PR gate:
  - `npx eslint .`
  - `npm run typecheck`
  - `npm run test --prefix apps/web`
  - `npm run test --prefix apps/api`
  - `npm run test:integration:full:host`
  - `npm run test:e2e:bypass:mem --prefix apps/web`
  - `npm run test:e2e:oauth:mem --prefix apps/web`
  - `npm run test:http --prefix apps/api`
- [x] CI green on PR. GitHub Actions passed after the Codex review fix commit `8fe520f5`.
- [x] `@codex review` completed and feedback fixed. Fixed the P2 invalid report range finding in `fix(reports): validate report ranges`; focused report integration coverage and targeted API typechecks passed before push.
- [x] Dev deployment completed. `deploy-dev.yml` workflow run `27121484090` deployed `codex/dashboard-reporting-ui` at `8fe520f5`.
- [x] Chrome extension validation completed against the deployed dev branch:
  - Dashboard hero showed active reporting currency, market strip, priority command cards, refresh strip, and report deep links.
  - Dashboard aggregate-row arithmetic passed in USD: market sums total `$985,381.62`; each visible aggregate P&L row had zero delta against `market value - total cost`.
  - Portfolio Report deep link restored URL state and rendered 3 chart SVGs, refresh controls, sticky table headers, and a sticky first column in the comparable desktop table.
  - Daily Review rendered summary, data health, Today deterministic observations, top movers, holdings detail, and FX-complete status.
  - Dashboard KR market chip navigated to `/reports?tab=market&scope=KR&currencyMode=specified&currency=USD&range=1Y`; the report rendered KR scope, USD currency, FX complete, and matching market value.
- [x] Follow-up Chrome validation surfaced a transient dashboard market-strip fallback that could label native primary/cached holding amounts as the selected reporting currency before enrichment refreshed. Fixed by rendering per-market hero values only from `reportingMarketValueAmount`; added regression coverage in `apps/web/test/features/dashboard/components.test.tsx`.
- [x] Follow-up local checks after the dashboard market-strip fix: `npm run test --prefix apps/web -- components.test.tsx`, `npx eslint .`, `npm run typecheck`.

## Mockups

- Dashboard desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/dashboard-desktop.png`
- Dashboard mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/dashboard-mobile.png`
- Daily Review desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/daily-review-desktop.png`
- Daily Review mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/daily-review-mobile.png`
- Portfolio Report desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-report-desktop.png`
- Portfolio Report mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-report-mobile.png`
- Market Report desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/market-report-desktop.png`
- Market Report mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/market-report-mobile.png`
- Portfolio loading desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-loading-desktop.png`
- Portfolio loading mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-loading-mobile.png`
- Ticker detail desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/ticker-detail-desktop.png`
- Ticker detail mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/ticker-detail-mobile.png`

## References

- Prior performance note: `docs/notes/performance-smooth-pages/scope-todo-20260601-performance-smooth-pages.md`
- Mockup source: `docs/notes/dashboard-reporting-ui/mockups/reports-mockup.html`
- Screenshot capture script: `docs/notes/dashboard-reporting-ui/mockups/capture-report-screenshots.mjs`
