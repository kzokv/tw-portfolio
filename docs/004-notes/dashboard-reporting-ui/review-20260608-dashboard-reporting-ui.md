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

## Residual Risks

- The web ticker route still has not adopted the new ticker primary DTO cache/return-navigation path; this remains explicitly unticked in the durable todo.
- Report SQL/read-model optimization is documented but not deeply rewritten in this PR; full Postgres integration and CI still need to run.
- Browser-level UX/performance validation still needs the deployed dev branch and Chrome extension check.
