# Pre-PR Review: Dashboard Reporting UI

Date: 2026-06-08
Branch: `codex/dashboard-reporting-ui`
Scope: dashboard command surface, `/reports`, report APIs, MCP report tools, DTO cache/loading behavior, ticker split API.

## Findings

### Fixed: invalid report range query values bypassed fallback

`apps/web/features/reports/reportState.ts` validated tab, scope, currency mode, and currency, but accepted any non-empty `range` query value. This contradicted the locked URL fallback contract and could pass unsupported range strings into report API calls.

Resolution:
- Reused `dashboardPerformanceRangesSchema` for range grammar validation.
- Added `reportState.test.ts` coverage for invalid range fallback.

Focused verification:
- `npx vitest run test/components/reports/ReportsClient.test.tsx test/features/reports/reportState.test.ts test/features/reports/reportService.test.ts test/app/reports/reportsPage.test.tsx`

### Fixed: report tab switches could render a stale DTO through the wrong report view

`ReportsClient` kept stale report data mounted during refresh, which is correct for same-report refreshes. On tab changes, however, the previous tab's DTO could be cast into the new tab view before `useReportData` fetched the new DTO. A daily-review DTO rendered through the portfolio view could crash on missing `performance` fields.

Resolution:
- Added a DTO-shape guard before rendering tab-specific report bodies.
- Added `ReportsClient.test.tsx` coverage for daily-review data under a portfolio tab URL.

Focused verification:
- `npx vitest run test/components/reports/ReportsClient.test.tsx test/features/reports/reportState.test.ts test/features/reports/reportService.test.ts test/app/reports/reportsPage.test.tsx`

### Fixed: single-market report scope could include same-ticker trades from another market

`scopeStore()` selected holdings by resolved market, but selected trades by `trade.marketCode === scope || account:ticker is in scoped holdings`. If the same account held the same ticker symbol in two markets, realized P&L from the other market could leak into the selected market report.

Resolution:
- Scoped trades strictly by `trade.marketCode`.
- Filtered scoped instruments to the selected market and relevant tickers.
- Added an integration regression asserting AU same-ticker realized P&L excludes a US trade.

Focused verification:
- `npx vitest run apps/api/test/unit/reportContext.test.ts apps/api/test/unit/mcpReportTools.test.ts apps/api/test/integration/reports.integration.test.ts`

### Fixed: scoped report snapshot reads could fan out without a concurrency limit

The follow-up scoped-performance fix removed serial `(accountId, ticker)` snapshot reads, but the first pass used raw `Promise.all(...)`. For large portfolios, that could replace one slow path with a database fan-out spike.

Resolution:
- Added bounded concurrency for scoped snapshot reads.
- Kept empty-scope short-circuiting and per-date FX lookup memoization.

Focused verification:
- `npx vitest run test/integration/reports.integration.test.ts` from `apps/api`

### Fixed: mobile report holding cards had weak ticker navigation affordance

Report rows linked ticker text to the ticker page, but mobile cards emphasized `View details`, making the ticker route easy to miss. The first mobile stat pass also rendered the `Weight` percentage twice by passing both a formatted value override and a percent subline.

Resolution:
- Added an explicit `Open ticker` action with a lucide external-link icon on mobile report cards.
- Centralized ticker href generation and removed the duplicate `Weight` percent prop.

Focused verification:
- `npx vitest run test/components/reports/ReportsClient.test.tsx test/features/dashboard/components.test.tsx` from `apps/web`

### Fixed: report holding rows lacked native/original price disclosure fields

The dashboard could expose native price from its holding-group DTO, but formal report rows only carried reporting amounts. That made Top holdings, Market detail, and holding cards unable to disclose the original ticker price when the selected report currency differed from the ticker currency.

Resolution:
- Added native price/value fields, reporting unit price fields, and row-level `fxRateToReporting` to `ReportHoldingRowDto`.
- Populated those fields in the report service from translated holding groups.
- Added report table/card price disclosure with reporting price, native price, FX rate, and quote status.

Focused verification:
- `npx vitest run test/integration/reports.integration.test.ts` from `apps/api`
- `npx vitest run test/components/reports/ReportsClient.test.tsx` from `apps/web`

### Fixed: dashboard holdings preview was hard to scan at desktop density

The dashboard holdings card had useful data, but the preview was optimized as compact cards only. That made desktop users lose table-style scanning, sorting, and first-column context while reviewing rich holdings data.

Resolution:
- Added search, market filtering, and value/daily/P&L/ticker sort controls.
- Kept mobile as cards with tap-to-detail disclosure.
- Added a desktop shadcn table with sticky header, sticky first column, reporting-currency price/value, native/FX popovers, finance tone formatting, ticker links, and detail actions.
- Preserved active market scope when opening the Portfolio Report from the dashboard holdings card.

Focused verification:
- `npx vitest run test/features/dashboard/components.test.tsx` from `apps/web`

### Fixed: AI Connector settings could hide available MCP tools behind empty overrides

The settings page rendered the server catalog in the global policy area, but per-connection controls could still show only "No tool-level overrides." That made the report MCP tools look unavailable when the connector simply inherited policy defaults.

Resolution:
- Added per-connector tool rows sourced from the server tool catalog.
- Each row now shows inherited default, connector override, disabled-by-policy, or missing-scope state.

Focused verification:
- `npx vitest run test/components/settings/AiConnectorsSettingsClient.test.tsx` from `apps/web`

## Analyzer Notes

- `code-reviewer/scripts/pr_analyzer.py --base dev` flagged `apps/api/test/integration/reports.integration.test.ts` for hardcoded secrets. Manual review confirmed these are test-only OAuth/session fixture values used with `signSessionCookie`.
- The same analyzer flagged `apps/web/components/reports/ReportsClient.tsx` for SQL concatenation. Manual review confirmed the matched code is a client-side ticker `Link` href with `encodeURIComponent`, not a SQL/query construction path.

## Follow-Up Review: 2026-06-09

### Fixed: route DTO cache could be reused across signed-in users

The route DTO cache key previously partitioned by selected portfolio context but not by the authenticated session user. On shared machines, OAuth re-login, or test/demo user switches, cached dashboard/portfolio/report DTOs could be restored for the wrong signed-in user.

Resolution:
- Added signed-in session user id to the route DTO context scope.
- Bumped the cache schema version.
- Clear route DTO cache on sign-out, API-driven 401 logout, and app-shell session-user changes.

Focused verification:
- `npx vitest run test/lib/routeDtoCache.test.ts test/components/reports/ReportsClient.test.tsx test/features/reports/hooks/useReportData.test.tsx`

### Fixed: reports could keep unsupported hidden `5Y` range behavior

Reports still rendered a hard-coded `5Y` option even when the effective dashboard/report range settings did not allow it.

Resolution:
- Report controls now render effective ranges from user/admin preferences.
- Unsupported URL ranges snap to the first effective range.

Focused verification:
- `npx vitest run test/components/reports/ReportsClient.test.tsx`

### Fixed: MCP `reportingCurrency` alias did not imply specified currency mode

ChatGPT/MCP callers using `reportingCurrency` could have the alias mapped to `currency` while the report still resolved through auto currency mode.

Resolution:
- `toReportInput()` now maps `reportingCurrency` to `currency`.
- If no explicit `currencyMode` is supplied, the presence of `currency`/`reportingCurrency` infers `currencyMode=specified`.

Focused verification:
- `npx vitest run test/unit/mcpReportTools.test.ts test/integration/reports.integration.test.ts --no-file-parallelism`

### Fixed: scoped reports dropped upcoming dividend events without ledger rows

Single-market report scoping filtered market dividend events through scoped dividend ledger entries, so future events without ledger rows were excluded from Daily Review, Portfolio Report, and Market Report summaries.

Resolution:
- Scoped market dividend events now use market-matching event ids rather than ledger-derived event ids.
- Report summary DTOs expose upcoming dividend count and amount.
- Reports render an Upcoming income summary card.

Focused verification:
- `npx vitest run test/unit/mcpReportTools.test.ts test/integration/reports.integration.test.ts --no-file-parallelism`

### Full-gate verification

2026-06-09 full local gate passed after these fixes:
- `npx eslint .`
- `npm run typecheck`
- `npm run test --prefix apps/web`
- `npm run test --prefix apps/api`
- `npm run test:integration:full:host`
- `npm run test:e2e:bypass:mem --prefix apps/web`
- `npm run test:e2e:oauth:mem --prefix apps/web`
- `npm run test:http --prefix apps/api`

The same analyzer false positives remain: test-only session strings, client ticker links mistaken for SQL concatenation, mockup console output, and the durable todo filename/content itself.

## Residual Risks

- The web ticker route still has not adopted the new ticker primary DTO cache/return-navigation path; this remains explicitly unticked in the durable todo.
- Report SQL/read-model optimization is documented but not deeply rewritten in this PR; full Postgres integration and CI still need to run.
- Browser-level UX/performance validation still needs the deployed dev branch and Chrome extension check.
