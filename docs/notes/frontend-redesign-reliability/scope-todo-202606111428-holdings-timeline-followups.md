---
slug: frontend-redesign-reliability-holdings-timeline-followups
source: scope-grill
created: 2026-06-11
tickets: []
required_reading:
  - docs/notes/frontend-redesign-reliability/scope-todo-202606101138-frontend-redesign-reliability.md
  - docs/notes/frontend-redesign-reliability/gap-fix-20260611-dashboard-chart-grid-followups.md
superseded_by: null
---

# Todo: Holdings And Timeline Follow-Ups

> For agents starting a fresh session: read all files listed in `required_reading` before implementation. This todo extends the original frontend redesign reliability scope and the June 11 dashboard chart/grid gap note; it does not replace either file.

## Release Invariant

All financial numbers rendered across Dashboard, Portfolio, Reports, and Ticker must remain backend-authoritative, market-aware, FX-aware, and honestly labeled when incomplete. Do not synthesize chart points, silently convert with missing FX, or display native values as reporting-currency values.

Before starting this follow-up implementation, check current Codex review feedback for this branch. Any unresolved Codex review feedback must be fixed before implementing the new scope below.

## Locked Scope

1. Add two per-share columns to holdings tables where cost/P&L is allowed:
   - `Avg cost`: average cost per share.
   - `Unit P&L`: current unit price minus average cost per share.
2. `Unit P&L` shows amount plus percentage. Existing `P&L`, `Best P&L`, and `Worst P&L` continue to mean total unrealized position P&L.
3. Per-share values are exact, not abbreviated. Reporting currency is primary and native currency is secondary when they differ. If FX is unavailable, show the native value and an honest missing-FX state.
4. Dashboard Top Holdings, Portfolio Dashboard-style Top Holdings, and Reports holdings tables show `Avg cost` and `Unit P&L` by default.
5. Portfolio detailed Holdings exposes `Avg cost` and `Unit P&L` in column settings, but they are not default-visible. Implement explicit default-hidden support or a preference migration so existing/default portfolio detailed layouts do not show them by accident.
6. Ticker Account Breakdown shows the same values as compact native-currency metrics, not configurable columns and not reporting-currency conversions.
7. Public share holdings are excluded from `Avg cost` and `Unit P&L` to avoid exposing cost basis/P&L. Public share may receive `instrumentName` and responsiveness fixes only.
8. Add `instrumentName` to shared holdings DTOs and render it beneath ticker ID where available. Prefer Traditional Chinese display name for `zh-TW`, then fallback to default instrument name, then omit.
9. Fix holdings filter/search toolbar overlap and standardize holdings responsiveness:
   - `lg+`: desktop table, horizontal scroll allowed, sticky first column.
   - below `lg`: mobile/card rows instead of squeezed columns.
   - filter toolbars wrap cleanly; preset chips may horizontally scroll.
   - column drag/reorder and resizing remain desktop/table behavior.
10. Dashboard sortable analytical cards are full-row: Portfolio Trend, Allocation Snapshot, Return %, Top Holdings, and Dividends. Hero/summary cards keep their current separate responsive layout.
11. Add shared timeline controls for strict snapshot charts:
   - Dashboard Portfolio Trend and Dashboard Return % both show shared period controls and `Timeline: Auto / Day / Week / Month / Year`.
   - Changing either Dashboard chart updates the shared period/timeline state.
   - Reports Performance Trend uses report-level range controls and adds only `Timeline: Auto / Day / Week / Month / Year`.
   - Timeline mode changes ticks/labels only; snapshot data is never aggregated, interpolated, or invented.
12. Introduce one shared timeline-axis utility used by Dashboard Portfolio Trend, Dashboard Return %, Reports Performance Trend, and Ticker Overview. It owns auto timeline resolution, tick generation, label formatting, and label thinning.
13. Ticker Overview gets real range controls: `1M`, `3M`, `YTD`, `1Y`, `3Y`, `5Y`, `All`, and `Custom`.
14. Ticker `Custom` uses arbitrary `startDate` and `endDate`. Backend accepts either `range` or `startDate/endDate` and returns requested/resolved/available/truncated metadata.
15. Ticker custom ranges are limited to 10 years. `All` returns all locally stored bars. Range selection must not trigger provider backfill automatically.
16. Ticker chart values stay in native market currency. Large ticker `All` ranges may downsample for rendering only, using source points, preserving first/last and local highs/lows where practical, with an explicit downsampling note.
17. Dividend review charts are unchanged; their existing month/year dividend bucket controls are a different chart model.
18. Add English and Traditional Chinese translations for every new UI label, tooltip, validation message, truncated/downsampled note, and table column label. Avoid hardcoded English in touched UI.

## Implementation Steps

- [x] Check existing Codex review feedback for this branch and fix all unresolved review feedback before new implementation.
- [x] Cross-check every unchecked item in `scope-todo-202606101138-frontend-redesign-reliability.md` and `gap-fix-20260611-dashboard-chart-grid-followups.md`; carry forward any still-undelivered item into this implementation or explicitly document why it remains deferred.
- [x] Add shared helpers for unit price metrics: average-cost display, `Unit P&L` amount, `Unit P&L` percent, FX fallback, and missing-FX display state.
- [x] Add or extend holdings DTOs/read models with `instrumentName` for Dashboard, Portfolio, Reports, and public share where safe. Dashboard/ticker DTOs, report rows, public share rows, and grouped holdings now carry safe instrument names where the backend can resolve them.
- [x] Add `Avg cost` and `Unit P&L` columns to Dashboard Top Holdings and Portfolio Dashboard-style Top Holdings, default-visible with sorting support for `Unit P&L`. Portfolio's `Dashboard Top Holdings` style renders `DashboardHoldingsPreview` with Portfolio data, while `Portfolio Holdings` keeps the detailed table path.
- [x] Add `Avg cost` and `Unit P&L` columns to Reports holdings cards, default-visible with sorting support for `Unit P&L`.
- [x] Add `Unit P&L` to Portfolio detailed Holdings column settings and ensure `Avg cost`/`Unit P&L` are available but default-hidden in the detailed layout.
- [x] Add compact native-currency `Avg cost` and `Unit P&L` metrics to Ticker Account Breakdown.
- [x] Keep public share holdings free of cost-basis/P&L values; add only safe ticker name/responsiveness improvements there.
- [x] Standardize holdings toolbar wrapping, chip overflow, sticky first column, desktop horizontal scroll, and below-`lg` mobile/card rows across Dashboard, Portfolio, Reports, and public share where applicable. Dashboard, Portfolio, and Reports now use mobile/card rows below `lg`; public share keeps its privacy-safe horizontal table layout and now renders safe ticker names.
- [x] Make Dashboard analytical sortable cards full-row while preserving user card order.
- [x] Build the shared timeline-axis utility with `auto`, `day`, `week`, `month`, and `year` modes.
- [x] Add shared Dashboard Portfolio Trend and Return % period/timeline state and controls.
- [x] Add Reports Performance Trend timeline control without duplicating report-level range controls.
- [x] Extend ticker chart shared types, API query validation, backend service, and web fetch path for range/custom date requests and chart metadata.
- [x] Add Ticker Overview range/custom date controls, URL state for custom dates, native-currency chart display, truncation notes, and visual-only downsampling note.
- [x] Add English and zh-TW dictionary entries for all new labels, tooltips, validation messages, notes, and column labels.
- [x] Add unit/component tests for unit P&L calculation/display, missing FX behavior, default-hidden portfolio detailed columns, holdings responsiveness states, shared timeline auto/tick generation, and ticker range validation. Focused API, service, component, public-share privacy, ticker page, Portfolio/Dashboard/Reports holdings, and direct timeline-axis coverage now pass.
- [x] Add API tests for ticker chart range/custom date behavior, available/truncated metadata, and 10-year custom range validation.
- [ ] Run `/aaa` or equivalent E2E planning for new user-facing flows.
- [ ] Add or update E2E coverage for Dashboard shared timeline controls, Reports Performance Trend timeline controls, holdings table responsiveness/columns, Portfolio table style/details behavior, and Ticker custom range controls.
- [ ] Validate in the existing Chrome session against Vakwen Dev after deployment/branch availability: Dashboard, Portfolio, Reports, Ticker Overview, and representative public share view.
- [ ] Run the smallest relevant tests first, then broader regression gates. Only claim all tests pass if all eight repo-defined suites pass. Focused checks listed below have run; full eight-suite gate remains pending.

## Status Update — 2026-06-11

Delivered in this pass:

- Existing Codex review feedback was addressed before/alongside this scope: ticker catalog-only market resolution, scoped report diagnostics, report cache currency keying, report stale date comparison, and market-scoped snapshot recompute scheduling.
- Shared holdings metrics now compute reporting/native average cost and `Unit P&L` amount/percent without silently converting through missing FX.
- Dashboard and Reports holdings cards expose `Avg cost` and `Unit P&L`; Dashboard and Reports sort menus now include `Unit P&L` while existing total-position P&L presets remain unchanged.
- Per-share values now render reporting-currency primary values with native-currency secondary values when currencies differ across Dashboard-style holdings, Portfolio detailed holdings, and Reports holdings.
- Portfolio now switches to the actual Dashboard Top Holdings implementation through `DashboardHoldingsPreview` when `Dashboard Top Holdings` is selected; `Portfolio Holdings` remains the default detailed table.
- Portfolio detailed holdings exposes `Unit P&L`; `Avg cost` and `Unit P&L` are default-hidden for detailed layouts, including old saved preferences that did not explicitly order those new columns.
- Ticker Account Breakdown shows native-currency `Avg cost` and `Unit P&L`.
- Ticker Overview supports `1M`, `3M`, `YTD`, `1Y`, `3Y`, `5Y`, `All`, and `Custom` chart requests; custom range is date-based, range state is reflected in `chartRange`/`chartStart`/`chartEnd`, chart values stay native-currency, and large local series are render-downsampled with a note.
- Dashboard Portfolio Trend, Dashboard Return %, Reports Performance Trend, and Ticker Overview use the shared timeline-axis utility.
- Dashboard Portfolio Trend, Allocation Snapshot, Return %, Top Holdings, and Dividends are full-row dashboard cards.

Still open or partial:

- Full reusable shared holdings grid extraction remains deferred/open, matching the original scope note.
- Admin/system repair wording separation, admin diagnostics/repair preview, focused E2E additions, live Vakwen Dev validation after deployment, PR/CI/Codex review loop, and full eight-suite validation remain pending.

Validation so far:

- `npx tsc --noEmit --pretty false --project apps/web/tsconfig.json` — passed.
- `npx tsc --noEmit --pretty false --project apps/api/tsconfig.json` — passed.
- `npx eslint apps/web/components/holdings/HoldingsColumnSettings.tsx apps/web/components/portfolio/HoldingsTable.tsx apps/web/components/dashboard/DashboardHoldingsPreview.tsx apps/web/components/dashboard/PortfolioTrendCard.tsx apps/web/components/dashboard/ReturnPercentCard.tsx apps/web/components/reports/ReportsClient.tsx apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx apps/web/app/share/[token]/page.tsx apps/web/lib/holdingsMetrics.ts apps/web/lib/timelineAxis.ts apps/api/src/services/reports.ts apps/api/src/services/publicShareView.ts libs/shared-types/src/index.ts apps/web/test/components/portfolio/HoldingsTable.test.tsx apps/web/test/components/reports/ReportsClient.test.tsx` — passed.
- `npx vitest run -c vitest.config.ts test/features/portfolio/services/tickerDetailsService.test.ts test/app/tickers/TickerHistoryClient.test.tsx test/app/share/publicSharePage.test.tsx` from `apps/web` — 22 tests passed; existing React `act` warning remains in one ticker test.
- `npx vitest run -c vitest.config.ts test/components/portfolio/HoldingsTable.test.tsx test/components/portfolio/PortfolioClient.test.tsx test/components/reports/ReportsClient.test.tsx test/features/dashboard/components.test.tsx` from `apps/web` — 50 tests passed; existing Recharts zero-size, React `act`, and Radix SSR warnings remain.
- `npx vitest run -c vitest.config.ts test/lib/timelineAxis.test.ts` from `apps/web` — 2 tests passed.
- `npm run test --prefix apps/web` — passed after fixing report route-cache currency partitioning: 39 files / 215 tests, then 55 files / 365 tests. Existing non-failing Recharts zero-size, React `act`, Radix SSR/useLayoutEffect, and admin act-environment warnings remain.
- `npx vitest run apps/api/test/unit/tickerDetails.test.ts apps/api/test/unit/dashboardHoldingGroups.test.ts apps/api/test/unit/publicShareView.test.ts apps/api/test/integration/ticker-details.integration.test.ts` — 25 tests passed.
- `git diff --check` — passed.
- Component spec hangs were fixed by stabilizing holdings column-settings defaults and skipping value-equal settings writes.

## Acceptance Checks

- Dashboard Top Holdings, Portfolio Dashboard-style Top Holdings, Reports holdings, and Portfolio detailed Holdings expose consistent `Avg cost` and `Unit P&L` semantics.
- Public share holdings do not expose average cost, cost basis, `Unit P&L`, or total P&L.
- Existing total unrealized P&L sorting/chips are unchanged and not confused with `Unit P&L`.
- Portfolio detailed Holdings does not show the new per-share columns by default unless the user enables them.
- Holdings filter controls do not overlap at the currently reported viewport, and no holdings page has incoherent page-level horizontal overflow.
- Dashboard Portfolio Trend and Return % use the same selected period and timeline mode; both remain strict snapshot-only.
- Reports Performance Trend uses report range for data window and timeline mode for ticks/labels only.
- Ticker Overview range/custom date selection fetches real backend-supported chart data, shows honest truncation/downsampling state, and does not auto-backfill provider data.
- All new UI strings have English and Traditional Chinese translations.
- Existing Codex review feedback is resolved before this follow-up work is treated as complete.
- Every item in the two required-reading notes is cross-checked as delivered, explicitly deferred, or still open with rationale.

## Gap And Contradiction Decisions

- Public share is a privacy-sensitive exception to "all holdings tables"; do not add cost/P&L columns there.
- Portfolio detailed default visibility requires explicit default-hidden support or migration because current column-settings defaults otherwise make new columns visible.
- Ticker Account Breakdown is native market context; show native-currency metrics only.
- Existing Codex review feedback is a hard pre-implementation gate.

## References

- Original locked scope: `docs/notes/frontend-redesign-reliability/scope-todo-202606101138-frontend-redesign-reliability.md`
- Dashboard/chart/grid gap note: `docs/notes/frontend-redesign-reliability/gap-fix-20260611-dashboard-chart-grid-followups.md`
- Worktree: `/Users/lume/repos/tw-portfolio-fix-dashboard-redesign-user-issues`
- Branch: `codex/fix-dashboard-redesign-user-issues`
