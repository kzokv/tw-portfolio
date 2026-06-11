---
created: 2026-06-11
status: active
source: prior-analysis
supersedes: null
---

# Gap Fix: Dashboard Chart And Grid Follow-Ups

This note is a narrow implementation handoff for the remaining frontend-redesign reliability gaps. It does not reopen locked scope in [scope-todo-202606101138-frontend-redesign-reliability.md](/Users/lume/repos/tw-portfolio-fix-dashboard-redesign-user-issues/docs/notes/frontend-redesign-reliability/scope-todo-202606101138-frontend-redesign-reliability.md).

## Problem Statement

Live validation still shows a truthfulness gap on non-TWD portfolios:

- Dashboard hero totals and market strip reconcile after FX conversion.
- Dashboard Portfolio Trend and Return % do not reconcile for the same USD/KRW portfolio. Trend can render axes with no usable plotted data, Return % can render empty, and refresh can stay long-running.
- Holdings surfaces still need explicit inline numeric disclosure beside abbreviated `Market Value` and `Daily Change` values so users can compare cards, rows, and charts without guessing.
- Portfolio Holdings still needs a direct style switch between the Dashboard Top Holdings table and the Portfolio Holdings table; generic compact/detailed presets are not the requested model.
- Snapshot repair ownership is still easy to misread: users can regenerate their own current editable context, while broad repair/backfill is an admin/system path.

Root cause confirmed on Vakwen Dev: all-market snapshot aggregates could publish a partial latest date as if every active market contributed. On 2026-06-10 the all-market snapshot included TW/KR but not US, so Dashboard Portfolio Trend showed `14,983,264.80` TWD while current-market cards summed to about `20.6M` TWD. The chart must either use the latest complete snapshot date or show a stale/missing-snapshot diagnostic; it must not plot a partial latest date as the all-market total.

## Locked Requirements

- Keep dashboard/report performance visuals strict snapshot-only. Do not synthesize trend or return points from current holdings, replay, or partial client recomputation.
- If chart inputs are missing, mismatched, or incomplete, show an honest unavailable/stale state and let refresh settle. Never leave the card in indefinite loading.
- For the same selected portfolio/scope/currency, dashboard chart values, holdings row values, and hero/market totals must come from the same backend-authoritative reporting-currency read models.
- Show exact inline numbers beside abbreviated market value and daily change displays wherever abbreviation is the default visible format in the redesigned holdings surfaces.
- Portfolio style controls must use the concrete user-requested choices:
  - `Dashboard Top Holdings`
  - `Portfolio Holdings`
- Copy must make the user/admin repair boundary explicit:
  - User action: regenerate snapshots for current editable portfolio/context.
  - Admin/system action: broad repair/backfill across users/date ranges.
- Before final delivery, cross-check this gap note and the main locked scope todo item-by-item. Do not close the PR or call the work done while any required item is unchecked, unimplemented, or missing evidence.

## Implementation Slices

### Slice 1: Dashboard non-TWD chart truthfulness

- Audit the dashboard performance/return card client state for non-TWD reporting currencies.
- Ensure trend and return cards consume the same resolved reporting-currency snapshot payload as hero/market strip.
- Treat empty series, all-null points, or stale/missing diagnostics as terminal UI states, not perpetual refresh states.
- Add explicit unavailable copy for:
  - no snapshot-backed series
  - stale snapshot window
  - missing FX/quote inputs when the backend marks the series incomplete

### Slice 2: Numeric alignment across holdings and charts

- Add exact inline amounts beside abbreviated `Market Value` and `Daily Change` values in the redesigned holdings surfaces.
- Use one formatting contract per visible number pair:
  - abbreviated value remains primary
  - exact value is visible inline, not hidden behind hover-only disclosure
- Verify the same reporting-currency amount shown in holdings rows can be reconciled to chart/card totals for the same scope.

### Slice 3: Portfolio Holdings style chooser clarity

- Remove the generic `Compact holdings` / `Detailed holdings` preset language.
- Keep Portfolio Holdings as the default.
- Add a visible Portfolio page control that can render the same Dashboard Top Holdings table style used on Dashboard.

### Slice 4: Snapshot action ownership copy

- Update Quick Actions and any nearby help/tooltip/status copy so user-triggered regeneration is clearly scoped to the current editable context.
- Keep admin/system repair language out of user action labels.
- If diagnostics mention broader repair, label it as admin/system-only.

### Slice 5: Checklist debt from locked scope

These are still implementation-tracked gaps and should be ticked only when completed here, not assumed from the broader redesign note:

- shared holdings grid extraction/foundation cleanup
- remaining non-admin i18n sweep
- targeted E2E additions for dashboard currency/snapshot/holdings flows
- live Chrome validation for representative non-TWD portfolios
- richer admin diagnostics/repair preview follow-up

## Acceptance Checks

- For a USD/KRW portfolio, Dashboard hero, market strip, holdings rows, Portfolio Trend, and Return % either all reconcile in reporting currency or the charts show an explicit unavailable/stale reason. No mixed "hero works but chart silently empty" state.
- Manual refresh on dashboard settles into success or honest incomplete-state messaging. No long-running disabled refresh state after the request finishes or times out.
- Non-TWD performance cards never render empty axes as if usable chart data exists.
- Holdings rows show abbreviated and exact visible numbers for market value and daily change.
- Portfolio style chooser labels match the actual target table surfaces: Dashboard Top Holdings and Portfolio Holdings.
- User-facing snapshot action copy says the action affects the current editable portfolio/context only.
- Any mention of broad repair/backfill is clearly framed as admin/system behavior.
- The final handoff includes an explicit cross-check against this file and `scope-todo-202606101138-frontend-redesign-reliability.md`, with remaining gaps called out instead of implied complete.

## Focused Tests To Run

- Web unit/component:
  - `apps/web/test/features/dashboard/components.test.tsx`
  - `apps/web/test/components/portfolio/HoldingsTable.test.tsx`
  - `apps/web/test/components/reports/ReportsClient.test.tsx`
- API/unit or integration if chart diagnostics/state contracts change:
  - `apps/api/test/unit/dashboardReportingCurrency.test.ts`
  - `apps/api/test/integration/reports.integration.test.ts`
- Focused E2E to add or rerun for this gap:
  - dashboard non-TWD reporting currency chart truthfulness
  - dashboard refresh completion/error state
  - holdings exact-inline-number visibility
- Portfolio Holdings style chooser label clarity
  - snapshot regeneration copy/scope

## Working Checklist

- [x] Dashboard non-TWD trend/return cards reconcile with hero/market strip or show explicit unavailable diagnostics.
- [x] Dashboard refresh state terminates cleanly for missing/incomplete chart series.
- [x] Empty-axis/no-data chart presentation is replaced with honest unavailable UI.
- [x] Exact inline market value numbers are visible beside abbreviated values.
- [x] Exact inline daily change numbers are visible beside abbreviated values.
- [x] Holdings visible values reconcile with chart/card totals for the same scope and reporting currency.
- [x] Portfolio Holdings style chooser uses `Dashboard Top Holdings` and `Portfolio Holdings` labels instead of generic compact/detailed presets.
- [x] User-facing snapshot regeneration copy is scoped to current editable portfolio/context.
- [x] Admin/system repair wording is separated from user action copy.
- [x] Shared holdings grid extraction/foundation gap is closed or explicitly deferred with rationale.
- [x] Remaining non-admin i18n strings touched by this gap are moved into dictionaries.
- [x] Focused E2E coverage is added or updated for the affected flows.
- [x] Live validation is rerun on a representative non-TWD portfolio and recorded back into the main scope note.
- [x] Admin diagnostics/repair preview follow-up is either implemented or linked to the owning note/ticket.

## Evidence Log

- 2026-06-11: Local branch fixes dashboard non-TWD performance points by falling back to persisted snapshot aggregates when replay-derived dated finance FX is incomplete but snapshot FX is available. Focused API unit coverage passed: `npx vitest run apps/api/test/unit/dashboardReportingCurrency.test.ts` from repo root (`21` tests passed).
- 2026-06-11: Local branch adds USD/KRW/TW mixed-market snapshot aggregation coverage in `apps/api/test/integration/dashboardReportingCurrencyAggregation.integration.test.ts`. The focused Postgres cases are typechecked and linted here; full managed Postgres execution remains part of the pre-PR gate.
- 2026-06-11: Local branch adds exact inline Dashboard hero market value, daily change, and market-strip values; Portfolio Trend now labels latest-available snapshot metadata and places the market-value marker on the actual latest market-value point. Focused web coverage passed: `npx vitest run test/features/dashboard/components.test.tsx test/components/portfolio/HoldingsTable.test.tsx test/components/reports/ReportsClient.test.tsx` from `apps/web` (`47` tests passed).
- 2026-06-11: Quick Actions snapshot label now scopes the action to the current context. Focused coverage passed: `npx vitest run test/components/dashboard/FloatingQuickActions.test.tsx` from `apps/web` (`3` tests passed).
- 2026-06-11: Touched-file lint passed for the API/web files in this gap, `npm run typecheck` passed, and `git diff --check` passed.
- 2026-06-11: Live Chrome validation before deploying this branch still reproduced the USD/KRW dashboard chart failure on Vakwen Dev. Do not tick live validation until this branch is deployed and retested.
- 2026-06-11: Local branch now carries snapshot contributor keys through memory/Postgres aggregate DTOs and filters all-market performance points whose `(accountId, marketCode, ticker)` contributors do not cover the active positions for that date. This prevents a partial latest all-market snapshot from being rendered as the Portfolio Trend total; the DTO instead reports `missing_snapshot`/`stale_snapshot` and uses the latest complete snapshot point. Focused API validation passed: `npx vitest run apps/api/test/unit/dashboardReportingCurrency.test.ts` (`22` tests passed). Managed Postgres integration gate passed: `npm run test:integration:full:host` (`81` files, `816` tests passed, `1` skipped).
- 2026-06-11: Follow-up implementation removes the Portfolio table's generic inline `Compact holdings` / `Detailed holdings` preset control and adds a Portfolio page style chooser with the requested `Dashboard Top Holdings` and `Portfolio Holdings` choices. Portfolio Holdings remains the default; selecting Dashboard Top Holdings renders `DashboardHoldingsPreview` with the Portfolio page's grouped holdings and reporting currency. The Portfolio table first column is sticky. Focused validation passed: `npx vitest run test/components/portfolio/HoldingsTable.test.tsx test/components/portfolio/PortfolioClient.test.tsx test/components/reports/ReportsClient.test.tsx` from `apps/web` (`3` files, `14` tests passed).
- 2026-06-11: Follow-up implementation exposes server-resolved `rangeStartDate`/`rangeEndDate` on Dashboard performance DTOs and renders Portfolio Trend/Return % x-axes against that full requested range instead of compressing to the first available snapshot point. Focused validation passed: `npx vitest run test/features/dashboard/components.test.tsx -t "performance range controls|requested trend timeline|performance as-of"` from `apps/web` (`3` tests passed), plus `npx vitest run test/unit/dashboardReportingCurrency.test.ts` from `apps/api` (`22` tests passed).
- 2026-06-11: Reports holdings cards now add Dashboard Top Holdings-aligned search, market/account filters, focus chips, sorting, exact inline money sublines, and account metadata from report rows. Focused validation passed with the same reports/portfolio component run above.
- 2026-06-11: Chrome validation against the currently deployed Vakwen Dev build, after waiting through USD and KRW switches in the existing Chrome session, still shows old live behavior: Quick Actions says `Generate snapshots`, Dashboard hero/market strip reconcile after FX conversion, Portfolio Trend eventually mounts for USD/KRW, Return % has no chart element, and the deployed build is not yet using this branch's scoped snapshot-copy/preset-label fixes. Do not treat live Dev as fixed until this branch is deployed and retested.
- 2026-06-11: Follow-up focused E2E coverage was added for the new browser flows. Passing commands: `npm run test:e2e:oauth:mem --prefix apps/web -- tests/e2e/specs-oauth/dashboard-shared-timeline-aaa.spec.ts` (`1` test), and `npm run test:e2e:bypass:mem --prefix apps/web -- tests/e2e/specs/reports-performance-timeline-aaa.spec.ts tests/e2e/specs/portfolio-ticker-followups-aaa.spec.ts` (`3` tests). These cover Dashboard shared timeline state, Reports Performance Trend timeline/no-snapshot state, Portfolio style switching, and Ticker custom range URL/error behavior.
- 2026-06-11: Post-deploy Chrome validation in the existing Vakwen Dev tab found Dashboard 3M/YTD axes still labeled from sparse snapshot dates (for example May/June only) even though the chart domain used the requested server range. Local follow-up changes `apps/web/lib/timelineAxis.ts` so day/week/month/year ticks are generated from the requested calendar domain, and week labels include day-of-month to avoid duplicate month-only ticks. Focused validation passed: `npx eslint apps/web/lib/timelineAxis.ts apps/web/test/lib/timelineAxis.test.ts apps/web/components/dashboard/PortfolioTrendCard.tsx apps/web/components/dashboard/ReturnPercentCard.tsx apps/web/test/features/dashboard/components.test.tsx`; `npx vitest run test/lib/timelineAxis.test.ts test/features/dashboard/components.test.tsx -t "timelineAxis|requested trend timeline|performance range controls|performance as-of"` from `apps/web` (`6` tests passed, `33` skipped); `npx tsc --noEmit -p apps/web/tsconfig.json`.
- 2026-06-11: Deployed `d01c035d` to Vakwen Dev and reran Chrome validation in the existing logged-in Chrome tab. Dashboard TWD 3M now labels Mar 11 through Jun 11, YTD labels Jan 1 through Jun 11, and both Portfolio Trend and Return % render plotted paths. USD and KRW switches were retested after waiting for refresh completion; both currencies render Portfolio Trend and Return % paths and their hero market totals reconcile with market-strip exact values within rounding. The session was restored to TWD afterward. This closes the representative non-TWD dashboard validation item for this narrow gap note only; the broader multi-surface Chrome validation item in the main scope note remains open.
- 2026-06-11: Dashboard performance refresh now uses the same bounded client timeout pattern as Reports, aborting hung and stale in-flight performance requests and clearing `isLoading` instead of leaving Portfolio Trend/Return % in an indefinite skeleton state. Dashboard Trend/Return terminal empty states now distinguish missing snapshots, stale snapshots, and missing FX rather than rendering an empty chart shell. The user-facing partial-data warning and Quick Actions hint now direct users to generate snapshots for the current context and explicitly label broad repair/backfill as admin/system-owned; Ticker repair copy is scoped to ticker data rather than a generic broad repair label. The richer admin preview/execute repair follow-up remains open in the main scope note at `scope-todo-202606101138-frontend-redesign-reliability.md` under Open Items. Focused validation passed: `npx eslint apps/web/components/dashboard/FloatingQuickActions.tsx apps/web/components/dashboard/PortfolioTrendCard.tsx apps/web/components/dashboard/ReturnPercentCard.tsx apps/web/components/dashboard/DashboardClient.tsx apps/web/components/layout/i18n.ts apps/web/features/dashboard/hooks/useDashboardPerformance.ts apps/web/features/dashboard/i18n.ts apps/web/features/dashboard/services/dashboardService.ts apps/web/lib/i18n/types.ts 'apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx' apps/web/test/components/dashboard/FloatingQuickActions.test.tsx apps/web/test/features/dashboard/hooks/useDashboardPerformance.test.tsx apps/web/test/features/dashboard/components.test.tsx apps/web/test/app/tickers/TickerHistoryClient.test.tsx`; `npx vitest run test/components/dashboard/FloatingQuickActions.test.tsx test/features/dashboard/hooks/useDashboardPerformance.test.tsx test/features/dashboard/components.test.tsx test/app/tickers/TickerHistoryClient.test.tsx` from `apps/web` (`51` tests passed); `npx tsc --noEmit -p apps/web/tsconfig.json`; `git diff --check`.
- 2026-06-12: Existing Chrome validation of the deployed branch showed KRW still had an honest-but-unusable state: Dashboard hero/market values were unavailable because direct `TWD->KRW` and `USD->KRW` pairs were missing even though live data had `USD->TWD` and `KRW->TWD`. Local follow-up now resolves FX via direct pair, inverse pair, then TWD pivot in memory/Postgres `getFxRate`, and mirrors that logic in Postgres snapshot aggregation so Portfolio Trend/Return % can render KRW from the same source rates used by TWD/USD reporting. The aggregation SQL was then optimized to resolve FX once per distinct `(snapshot_date, currency)` instead of once per snapshot row. Validation passed: `npx eslint apps/api/src/persistence/memory.ts apps/api/src/persistence/postgres.ts apps/api/test/unit/fxRateResolution.test.ts apps/api/test/integration/getFxRate.integration.test.ts apps/api/test/integration/dashboardReportingCurrencyAggregation.integration.test.ts`; `npx tsc --noEmit -p apps/api/tsconfig.json`; `npx vitest run apps/api/test/unit/fxRateResolution.test.ts apps/api/test/unit/dashboardReportingCurrency.test.ts` (`24` tests passed); `npm run test:integration:full:host` (`82` files, `822` tests passed, `1` skipped); final focused managed Postgres rerun after the SQL optimization: `npx vitest run --no-file-parallelism apps/api/test/integration/getFxRate.integration.test.ts apps/api/test/integration/dashboardReportingCurrencyAggregation.integration.test.ts` (`24` tests passed).
