---
slug: valuation-health-delegated-trend-performance
source: scope-grill
created: 2026-06-16
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Market Data Out Of Sync And Delegated Portfolio Trend

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Implementation Steps

- [x] Fix valuation health so hero valuation is compared against the latest fully comparable snapshot, not a newer partial market point.
- [x] Preserve newer partial Portfolio Trend points, but annotate partial/latest-not-comparable points with a subtle marker and tooltip.
- [x] Replace the current partial-market coverage loophole, including rewriting the test that keeps a newer health snapshot when an omitted market has no bar that day.
- [x] Make repair readiness market-calendar aware so legitimate market holidays/closed days do not produce impossible repair prompts.
- [x] Add dashboard-safe mismatch details with title "Market data out of sync", "Latest comparable date", per-market freshness, stale/missing tickers, latest partial date, and latest comparable date.
- [x] Add role-aware guidance: admins see fix actions; non-admin viewers see copyable admin-help text and prefilled admin deep-links only.
- [x] Generate one admin fix link per affected market, batching ticker lists at max 20 tickers per link.
- [x] Add a guided Admin Market Data valuation-repair mode opened by prefilled URL params for market, tickers, target repair date, and date range.
- [x] Extend admin backfill API/UI to support and display requested/effective date range, including provider floor clamp when applicable.
- [x] Default guided valuation repair backfill to bars plus dividends; show dividend failures as warnings, not blockers for market-value repair.
- [x] Add an admin-only repair readiness/status endpoint returning operation phase, progress counters, latest bar date, latest snapshot date, eligibility, and reasons per ticker.
- [x] Drive guided repair from status, not timeouts: after terminal backfill state, auto-queue snapshot repair only for tickers with `latestBarDate >= targetRepairDate`.
- [x] Treat partial success explicitly: repair eligible tickers, keep failed/unchanged tickers visible with retry or provider-unavailable guidance.
- [x] Define "fix complete" as snapshot readiness reaching target date, then refresh Portfolio Trend and valuation health; do not clear warnings on job completion alone.
- [x] Fix delegated/shared Portfolio Trend currency and cache scoping so owner/context reporting currency wins over delegate preferences.
- [x] Remove the duplicate dashboard valuation-health card and keep valuation health inside Portfolio Trend.
- [x] Limit performance work to Dashboard/Portfolio Trend and guided repair paths, targeting 2-3s frontend render when cache/data are warm while excluding provider background job duration.
- [ ] Use synthetic regression fixtures and targeted dev DB manipulation for live validation; do not clone a broad prod DB snapshot.
- [x] Add or update focused unit/integration tests for comparable snapshot selection, delegated reporting currency, admin range payloads, readiness gating, and role-specific UI behavior.
- [x] Run `/aaa` to add or update E2E tests covering the new dashboard mismatch details, copied admin-help link, admin guided repair flow, and delegated Portfolio Trend regression.
- [x] Create mockup screenshots referencing the current UI for Portfolio Trend mismatch details, non-admin copied admin-help flow, and admin guided valuation repair.
- [x] Add a runbook/docs update explaining stale bars vs snapshots, correct repair order, partial success handling, viewer-to-admin handoff, and performance expectations.
- [x] Run focused affected tests first, then the agreed repo test gates before PR handoff.

## Implementation Evidence

- 2026-06-16: Added strict comparable snapshot coverage for valuation health while preserving loose chart coverage with partial-point metadata in `apps/api/src/services/dashboardReportingCurrency.ts`; updated shared diagnostics fields in `libs/shared-types/src/index.ts`.
- 2026-06-16: Rewrote the omitted-market/no-bar unit test so a newer partial point no longer wins valuation health, and added a paired chart test proving the partial point remains renderable with marker metadata.
- 2026-06-16: Added valuation-health mismatch fields (`title`, latest comparable/partial dates, market freshness) in `apps/api/src/services/valuationHealth.ts`.
- 2026-06-16: Removed the duplicate Dashboard hero valuation-health panel, kept valuation health inside Portfolio Trend, added a partial-market badge/tooltip and chart marker, and changed delegated Portfolio Trend currency precedence to use the owner/context dashboard summary currency.
- 2026-06-16: Added per-market admin repair links with 20-ticker batching, target/start/end dates, and non-admin copy buttons in `ValuationHealthPanel`/`valuationHealthAdminLink`.
- 2026-06-16: Added backend admin backfill requested/effective date range DTOs and route plumbing through preview, execute, operation metadata, and queued backfill jobs.
- 2026-06-16: Added `/admin/market-data/:marketCode/valuation-repair/status` readiness endpoint with market-calendar gating, latest bar/snapshot dates, active snapshot scope counts, per-ticker reasons, operation phase/progress counters, and eligibility summary.
- 2026-06-16: Added guided Admin Market Data valuation-repair mode for `repair=valuation` links. The UI shows target date/range, bounded price/dividend backfill controls, requested/effective/provider-floor range summaries, readiness status, partial success reasons, manual eligible snapshot repair, and status-driven auto snapshot repair after terminal backfill state.
- 2026-06-16: Updated linked purge refill previews to preserve requested/effective backfill date range metadata.
- 2026-06-16: Added focused `DashboardClient` regression coverage proving delegated/shared performance cache keys and expected reporting currency use owner/context summary currency even when the delegate shell preference changes.
- 2026-06-16: Added mockup source and screenshots under `docs/notes/valuation-health-delegated-trend-performance/mockups/`:
  - `portfolio-trend-market-data-out-of-sync.png`
  - `viewer-admin-help-copy-flow.png`
  - `admin-guided-valuation-repair.png`
- 2026-06-16 focused validation passed:
  - `npx vitest run apps/api/test/unit/dashboardReportingCurrency.test.ts apps/api/test/integration/admin-snapshot-repair.integration.test.ts`
  - `npx vitest run test/components/admin/AdminMarketDataClient.test.tsx test/components/dashboard/DashboardClient.test.tsx test/components/valuation/ValuationHealthPanel.test.tsx` from `apps/web`
  - `npm run build -w libs/shared-types`
  - focused `npx eslint` over touched files
  - `npm run typecheck` after creating local worktree workspace symlinks with `npm install --ignore-scripts`
  - `git diff --check`
- 2026-06-16 focused revalidation passed after delegated currency regression coverage:
  - `npx vitest run test/components/dashboard/DashboardClient.test.tsx` from `apps/web`
  - `npm run typecheck`
- 2026-06-16 sidecar code review found and local implementation fixed these gaps:
  - guided valuation repair now polls async backfill operation status until terminal state before eligible-only snapshot repair
  - valuation-health UI now surfaces DTO title, latest comparable snapshot, latest partial snapshot, and per-market freshness counts
  - non-admin copy now writes admin-help text plus an absolute prefilled deep link, and only shows copied state after clipboard success
- 2026-06-16 main code-review follow-up found and fixed two repair-flow gaps:
  - admin valuation-repair links now use `expectedLatestValuationDate` for `targetDate`/`endDate`, so stale-bar incidents guide admins to advance bars/snapshots to the expected dashboard date rather than the stale latest bar date
  - guided snapshot repair now polls valuation-repair readiness after queueing snapshot jobs, so the UI reports completion only after snapshot readiness reaches the target date
- 2026-06-16 focused validation passed after sidecar fixes:
  - `npx eslint apps/web/components/admin/AdminMarketDataClient.tsx apps/web/components/valuation/ValuationHealthPanel.tsx apps/web/features/dashboard/i18n.ts apps/web/lib/i18n/types.ts apps/web/test/components/admin/AdminMarketDataClient.test.tsx apps/web/test/components/valuation/ValuationHealthPanel.test.tsx`
  - `npx vitest run test/components/admin/AdminMarketDataClient.test.tsx test/components/valuation/ValuationHealthPanel.test.tsx` from `apps/web` (`24` tests passed; existing React act-environment warnings remain)
  - `npx tsc --noEmit -p apps/web/tsconfig.json`
- 2026-06-16 focused E2E coverage added in `apps/web/tests/e2e/specs/valuation-health-guided-repair-aaa.spec.ts`:
  - non-admin Dashboard Portfolio Trend mismatch details plus copied admin-help deep link
  - admin guided repair deep link prefill for market, ticker, target date, and date range
  - delegated/shared Portfolio Trend regression proving owner/context AUD performance data renders even when the delegate preference is TWD
  - Validation passed: `npx playwright test tests/e2e/specs/valuation-health-guided-repair-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts` (`3` tests passed in `35.1s`; browser-visible checks completed in `3.0s`, `973ms`, and `1.7s`)
- 2026-06-16 performance scope evidence:
  - kept changes scoped to Dashboard/Portfolio Trend and Admin Market Data guided repair paths
  - Dashboard primary data and Portfolio Trend use sessionStorage route DTO cache with fresh/stale-usable windows, so warm return navigation renders cached data without blocking on a server request
  - added Portfolio Trend hook coverage proving fresh cached performance data restores without fetching and stale-usable cached performance data renders before background refresh
  - focused E2E browser-visible checks for the new paths remained near the 2-3s frontend render target when API data was mocked/warm (`3.4s`, `935ms`, `1.8s` on final run); provider backfill/snapshot job duration remains explicitly excluded
- 2026-06-16 `/si-review` found the durable cache/performance lessons are already covered by existing `.claude/rules/route-dto-cache-user-context.md` and `.claude/rules/smooth-page-performance-boundaries.md`; no duplicate `/si-promote` rule was added.
- 2026-06-16 final focused revalidation passed:
  - `npm run typecheck`
  - `npx eslint apps/api/src/routes/adminRoutes.ts apps/api/test/integration/admin-snapshot-repair.integration.test.ts apps/api/test/unit/dashboardReportingCurrency.test.ts apps/web/lib/adminMarketDataService.ts apps/web/app/admin/market-data/[marketCode]/[tab]/page.tsx apps/web/components/admin/AdminMarketDataClient.tsx apps/web/components/dashboard/DashboardClient.tsx apps/web/components/dashboard/DashboardHero.tsx apps/web/components/dashboard/PortfolioTrendCard.tsx apps/web/components/valuation/ValuationHealthPanel.tsx apps/web/components/valuation/valuationHealthAdminLink.ts apps/web/test/components/admin/AdminMarketDataClient.test.tsx apps/web/test/components/dashboard/DashboardClient.test.tsx apps/web/test/components/valuation/ValuationHealthPanel.test.tsx apps/web/tests/e2e/specs/valuation-health-guided-repair-aaa.spec.ts libs/shared-types/src/index.ts`
  - `npx vitest run apps/api/test/unit/dashboardReportingCurrency.test.ts apps/api/test/integration/admin-snapshot-repair.integration.test.ts` (`36` tests passed)
  - `npx vitest run test/components/admin/AdminMarketDataClient.test.tsx test/components/dashboard/DashboardClient.test.tsx test/components/valuation/ValuationHealthPanel.test.tsx test/features/dashboard/hooks/useDashboardPerformance.test.tsx` from `apps/web` (`36` tests passed; existing React act-environment warnings remain)
  - `npx vitest run test/features/dashboard/hooks/useDashboardPerformance.test.tsx` from `apps/web` (`6` tests passed)
  - `npx vitest run test/components/admin/AdminMarketDataClient.test.tsx` from `apps/web` (`14` tests passed; existing React act-environment warnings remain)
  - `npx vitest run test/components/valuation/ValuationHealthPanel.test.tsx` from `apps/web` (`12` tests passed)
  - `npx vitest run test/features/dashboard/components.test.tsx` from `apps/web` (`41` tests passed; existing Radix SSR `useLayoutEffect` warnings remain)
  - `npx playwright test tests/e2e/specs/valuation-health-guided-repair-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts` (`3` tests passed in `31.4s`; browser-visible checks completed in `3.4s`, `935ms`, and `1.8s`)
  - `git diff --check`
- 2026-06-16 full AGENTS.md gates passed:
  - `npx eslint .`
  - `npm run typecheck`
  - `npm run test --prefix apps/web` (`46` files / `261` tests passed, then `56` files / `394` tests passed; existing React/Radix warnings remain)
  - `npm run test --prefix apps/api` (`153` files / `1595` tests passed, `42` files / `422` tests skipped)
  - `npm run test:integration:full:host` (`85` files passed; `854` tests passed, `1` skipped)
  - `npm run test:e2e:bypass:mem --prefix apps/web` (`278` passed, `12` skipped)
  - `npm run test:e2e:oauth:mem --prefix apps/web` (`120` passed)
  - `npm run test:http --prefix apps/api` (`290` passed, `2` skipped)

## Open Items

- [x] Decide exact final copy for English and zh-TW strings during implementation review.
- [x] Confirm whether operation DTO should expose `completedAt` directly or whether the new readiness endpoint fully covers terminal timing needs.

## References

- Scope debate note: none
- Linear tickets: none
- Incident context: Wen-Ping delegated portfolio trend and US market data lag analysis from 2026-06-16 session.
