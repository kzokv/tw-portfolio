# Implementation Note: Holdings And Timeline Follow-Ups

Date: 2026-06-11

## Overview

This note records the implementation state for `scope-todo-202606111428-holdings-timeline-followups.md`. The work extends the frontend redesign reliability effort with per-share holdings metrics, timeline controls, and ticker chart range/custom-date support.

## Delivered

- Added shared frontend holdings metric helpers for average cost and `Unit P&L` amount/percent.
- Added `Avg cost` and `Unit P&L` to Dashboard Top Holdings and Reports holdings cards, including a `Unit P&L` sort mode.
- Rendered per-share reporting-currency values first and native-currency values second when currencies differ in Dashboard-style holdings, Portfolio detailed holdings, and Reports holdings.
- Added the requested Portfolio page style switch: `Dashboard Top Holdings` renders `DashboardHoldingsPreview` with Portfolio data, while `Portfolio Holdings` keeps the detailed holdings table as the default.
- Added `Unit P&L` to Portfolio Holdings column settings; `Avg cost` and `Unit P&L` are default-hidden for Portfolio detailed layouts, including old saved preferences that did not explicitly order the new columns.
- Added native-currency `Avg cost` and `Unit P&L` metrics to Ticker Account Breakdown.
- Extended ticker chart contracts with range/custom-date metadata and backend validation for `range` versus `startDate`/`endDate`.
- Added Ticker Overview range controls for `1M`, `3M`, `YTD`, `1Y`, `3Y`, `5Y`, `All`, and `Custom`.
- Kept ticker charts native-currency and local-data-only; custom ranges do not trigger provider backfill.
- Added shared timeline-axis utility and wired it into Dashboard Portfolio Trend, Dashboard Return %, Reports Performance Trend, and Ticker Overview.
- Made Dashboard analytical cards full-row.
- Added safe `instrumentName` delivery/rendering for Reports and public share holdings.
- Added Portfolio below-`lg` mobile/card rows for the detailed holdings table and kept desktop drag/resize behavior table-only.
- Stabilized holdings column settings so default-hidden column migrations do not trigger value-equivalent state loops.
- Fixed timeline axis label formatting to use UTC dates so range ticks do not drift by local timezone.
- Fixed ticker chart render downsampling to preserve the latest point.
- Fixed Ticker Account Breakdown `Unit P&L` so missing average cost renders unavailable instead of `0`.
- Resolved current Codex review feedback around scoped snapshot diagnostics, report cache currency partitioning, ticker catalog market resolution, date-only staleness comparison, and market-scoped snapshot recompute scheduling.

## Still Open

- Full shared holdings grid extraction is still deferred.
- Admin/system repair wording separation, admin diagnostics/repair preview, E2E additions, live Vakwen Dev validation after deployment, PR/CI/Codex review loop, and full eight-suite validation remain pending.

## Validation

- `npx tsc --noEmit --pretty false --project apps/web/tsconfig.json` passed.
- `npx tsc --noEmit --pretty false --project apps/api/tsconfig.json` passed.
- `npx vitest run -c vitest.config.ts test/features/portfolio/services/tickerDetailsService.test.ts test/app/tickers/TickerHistoryClient.test.tsx test/app/share/publicSharePage.test.tsx` from `apps/web` passed: 22 tests.
- `npx vitest run -c vitest.config.ts test/components/portfolio/HoldingsTable.test.tsx test/components/portfolio/PortfolioClient.test.tsx test/components/reports/ReportsClient.test.tsx test/features/dashboard/components.test.tsx` from `apps/web` passed: 50 tests.
- `npx vitest run -c vitest.config.ts test/lib/timelineAxis.test.ts` from `apps/web` passed: 2 tests.
- `npx vitest run apps/api/test/unit/tickerDetails.test.ts apps/api/test/unit/dashboardHoldingGroups.test.ts apps/api/test/unit/publicShareView.test.ts apps/api/test/integration/ticker-details.integration.test.ts` passed: 25 tests.
- Focused ESLint passed for changed TS/TSX files, including API report/public-share services, shared types, holdings settings, Dashboard, Portfolio, Reports, Ticker, public share, and focused tests.
- `git diff --check` passed.

## Validation Caveat

Earlier component spec hangs were resolved by stabilizing holdings column-settings defaults and suppressing value-equivalent state writes. The focused component group now passes, but the full eight-suite repo gate, E2E additions, CI, live Vakwen Dev validation, and post-deploy Chrome validation are still pending. Existing non-failing warnings remain in focused web tests: React `act`, Radix SSR/useLayoutEffect, and Recharts zero-size warnings.
