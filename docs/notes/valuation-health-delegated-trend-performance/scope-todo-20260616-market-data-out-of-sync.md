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
- [x] Use synthetic regression fixtures and targeted dev DB manipulation for live validation; do not clone a broad prod DB snapshot.
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
- 2026-06-16 PR/CI/Codex review loop:
  - PR #223 targets `dev` with CI run `27608810475` green at `b22e542e` (`lint`, `build-and-typecheck`, `unit-tests`, `integration-tests`, `e2e-bypass`, `e2e-oauth`, `docker-build-validation`, `deploy-config-validation`) and PR Gate run `27608810269` green.
  - Codex review findings through `b22e542e` were fixed and replied to; all review threads were resolved before final live validation.
  - Late Codex review `3419769363` found that `ValuationHealthPanel` rendered the server literal `Market data out of sync`; fixed by deriving the visible title from i18n copy (`outOfSyncTitle`) and adding zh-TW regression coverage.
  - Focused follow-up validation passed: `npx eslint apps/web/components/valuation/ValuationHealthPanel.tsx apps/web/features/dashboard/i18n.ts apps/web/lib/i18n/types.ts apps/web/test/components/valuation/ValuationHealthPanel.test.tsx`; `npx vitest run test/components/valuation/ValuationHealthPanel.test.tsx` from `apps/web` (`14` tests passed); `npm run typecheck`.
- 2026-06-16 deployed Vakwen Dev validation at `b22e542e`:
  - Deploy run `27609541647` completed successfully in `12m23s`; qnap dev containers `vakwen-dev-web`, `vakwen-dev-api`, `vakwen-dev-postgres`, `vakwen-dev-redis`, and `vakwen-dev-cloudflared` were healthy after restart.
  - Dev DB did not contain the requested production identities `masterj71.tw@gmail.com` or `nocktkv@gmail.com`; the available dev validation identities were `c2974378@gmail.com` (`KC vtwin`, member) and `mmckchuang@gmail.com` (`mmc_kchuang`, admin). Live browser validation used the existing authenticated `mmckchuang@gmail.com` session and targeted dev DB manipulation.
  - Healthy baseline: dashboard settled with current valuation `$695,751.36`, chart valuation `$695,751.36`, delta `$0`, relative delta `0%`, latest bar/snapshot/comparable dates `Jun 16, 2026`, no admin repair links, and neutral `Valuation health` title.
  - Stale-US admin fixture: removed the synthetic AVGO `US` Jun 16 bar/snapshot and removed the AVGO Jun 15 snapshot, leaving AVGO latest bar `2026-06-15` and latest snapshot `2026-06-12` while TW/KR retained Jun 16 data. Dashboard showed `Market data out of sync`, current `$695,751.36`, chart `$663,017.84`, delta `$32,733.52`, relative delta `4.7%`, latest snapshot `Jun 12`, partial snapshot `Jun 16`, and a market-local admin link to `/admin/market-data/US/backfill?repair=valuation&tickers=AVGO&targetDate=2026-06-15&endDate=2026-06-15&fromDate=2026-06-12&startDate=2026-06-12`.
  - Admin repair flow: guided page prefilled market `US`, ticker `AVGO`, target `2026-06-15`, range `2026-06-12` to `2026-06-15`, status `0/1 complete`, and `Queue 1 eligible snapshot repair`; queueing completed in `6.0s`, flipped status to `1/1 complete`, disabled the queue button as `Queue 0 eligible snapshot repairs`, and showed AVGO latest snapshot `2026-06-15`.
  - Viewer handoff fixture: temporarily changed `mmckchuang@gmail.com` role to `member` and left AVGO latest bar/snapshot at Jun 15 while other markets retained Jun 16 data. Dashboard showed `Market data out of sync`, no admin links, one `Copy admin link · US` button, and viewer guidance to ask an admin; clicking it changed the button to `Admin link copied`. The Chrome bridge returned an empty clipboard read, so the actual copied-text assertion remains covered by the focused E2E/component tests.
  - Final-clear restore: restored `mmckchuang@gmail.com` to `admin`, reinserted the synthetic AVGO Jun 16 bar/snapshot, and refreshed the dashboard. The warning auto-cleared with no admin links, current/chart both `$695,751.36`, delta `$0`, and `hasOutOfSync=false`.
  - Observed deployed browser timings: healthy reload DOM `3.4s`; stale admin dashboard visible `10.2s` during cold secondary reload; admin guided page visible `1.6s`; viewer warning visible `3.8s`; final auto-clear visible `4.5s`; restored healthy tab visible `3.5s`. Warm mocked/E2E paths remain near the 2-3s target; provider/background job duration is excluded.
  - Live screenshots:
    - `docs/notes/valuation-health-delegated-trend-performance/screenshots/live-dev-b22e542e-healthy-final-20260616.png`
    - `docs/notes/valuation-health-delegated-trend-performance/screenshots/live-dev-b22e542e-stale-us-warning-20260616.png`
    - `docs/notes/valuation-health-delegated-trend-performance/screenshots/live-dev-b22e542e-admin-repair-ready-20260616.png`
    - `docs/notes/valuation-health-delegated-trend-performance/screenshots/live-dev-b22e542e-admin-repair-complete-20260616.png`
    - `docs/notes/valuation-health-delegated-trend-performance/screenshots/live-dev-b22e542e-viewer-copy-guidance-20260616.png`
    - `docs/notes/valuation-health-delegated-trend-performance/screenshots/live-dev-b22e542e-final-auto-clear-20260616.png`

## Open Items

- [x] Decide exact final copy for English and zh-TW strings during implementation review.
- [x] Confirm whether operation DTO should expose `completedAt` directly or whether the new readiness endpoint fully covers terminal timing needs.

## References

- Scope debate note: none
- Linear tickets: none
- Incident context: Wen-Ping delegated portfolio trend and US market data lag analysis from 2026-06-16 session.
