---
slug: market-value-reconciliation-ux-performance
source: codex-thread-market-value-mismatch-review
created: 2026-06-14
base_branch: dev
branch: codex/market-value-reconciliation-ux-performance
status: scope-locked
tickets: []
required_reading:
  - AGENTS.md
  - apps/api/AGENTS.md
  - apps/web/AGENTS.md
  - docs/notes/performance-smooth-pages/scope-todo-20260601-performance-smooth-pages.md
  - docs/notes/frontend-redesign-reliability/gap-fix-20260611-dashboard-chart-grid-followups.md
  - docs/notes/dashboard-reporting-ui/scope-todo-2026060316-dashboard-reports.md
---

# Todo: Market Value Reconciliation, UX, And Page Performance

## Problem

Dashboard hero market value and Portfolio Trend market value can diverge when current holdings can be valued from latest market data but the latest complete performance snapshot has not caught up. The previous incident was resolved after instrument backfill and snapshot regeneration, but the UI did not explain why the values differed or how to repair the gap.

Users reasonably assume the values should be in sync for the same context and reporting currency. The implementation should keep the accounting sources honest while making mismatches understandable, actionable, and cheaper to detect.

This work also covers the agreed page-performance target: dashboard valuation and related page reads should render useful content in 2-3 seconds where practical and never exceed 5 seconds for the Dashboard valuation path under normal production conditions.

## Current Behavior Model

- Hero/current valuation is a current read model. It is derived from current positions, latest available market data, reporting-currency FX conversion, and current portfolio context.
- Portfolio Trend and report performance charts are snapshot read models. They must remain snapshot-only and should not synthesize the latest point from live holdings.
- A mismatch is not automatically a bug. It is material only when it exceeds configurable relative and absolute thresholds after minor rounding tolerance is ignored.
- The likely causes are stale or missing snapshots, stale or missing latest bars, pending/incomplete instrument backfill, FX coverage gaps, or a mixed-context/currency cache mismatch.
- Dashboard/report reads must not trigger full snapshot generation as a side effect.

## Performance Baseline To Preserve

From `docs/notes/performance-smooth-pages/scope-todo-20260601-performance-smooth-pages.md`:

| Page | Original usable content baseline | Post-deploy measured ready | This work target |
|---|---:|---:|---:|
| `/dashboard` | ~29.7s | ~5.1s | 2-3s target, 5s hard cap for valuation path |
| `/portfolio` | ~32.3s | ~9.8-10.8s | no regression; use route cache for smoother revisit |
| `/transactions` | ~29.1s | ~4.0s | no regression |
| `/cash-ledger` | ~25.7s | ~7.7-8.8s | out of scope except no regression |
| `/dividends` | not in first baseline table | ~11.3-12.3s | out of scope except no regression |
| `/sharing` | not in first baseline table | ~1.6-2.6s | no regression |
| `/settings/profile` | not in first baseline table | ~1.5-2.5s | no regression |
| `/settings/accounts` | not in first baseline table | ~8.2-9.2s | out of scope except no regression |

## Locked Scope

- Keep hero/current valuation and Portfolio Trend/report performance charts as separate backend-owned read models.
- Add API-owned reconciliation diagnostics that compare the current valuation with the latest usable snapshot valuation for the active context and reporting currency.
- Treat rounding-only differences below minor-unit tolerance as healthy.
- Add configurable materiality thresholds in `app_config`: relative basis points and fixed absolute thresholds for AUD, USD, TWD, and KRW.
- Show valuation-health UX on Dashboard hero, Dashboard Portfolio Trend, and Reports Portfolio/Market performance charts.
- Use one shared frontend valuation-health panel/detail component across Dashboard and Reports.
- Include affected-holdings rows with ticker, market, current reporting value, latest bar date, latest snapshot date, status, and recommended action.
- Show admin-only remediation CTAs for backfill and targeted snapshot repair. Normal users get explanatory copy.
- After successful admin backfill for active held instruments, enqueue targeted snapshot repair.
- Add minimal `/admin/settings` controls for valuation-health thresholds.
- Add admin-configurable route cache policy in `app_config`.
- Move route DTO cache from `localStorage` to `sessionStorage`; do not migrate old entries, but clear known old localStorage keys opportunistically.
- Apply session route cache to Dashboard, Dashboard Performance, Portfolio, and all Reports tabs.
- Cache success means revisited pages render immediately from sessionStorage and skip automatic client-side refetches while fresh.
- Manual refresh bypasses cache.
- Full reload may still call server-seeded APIs. This scope does not require a full reload to skip server seed.
- Invalidate affected caches after mutations, recompute, snapshot generation, reporting-currency change, context change, logout, or session change.
- Remove unnecessary quote loading from `/dashboard/performance`.
- Optimize latest-bar lookup before adding any persistent latest-quote cache table.

## Cache Policy Decisions

Admin-configurable modes:

| Mode | Dashboard primary | Hero/enrichment | Dashboard trend | Portfolio | Reports | Stale-usable window |
|---|---:|---:|---:|---:|---:|---:|
| Fresh | 30s | 15s | 60s | 30s | 60s | 3m |
| Balanced | 120s | 60s | 300s | 120s | 300s | 10m |
| Low Load | 300s | 180s | 900s | 300s | 900s | 20m |
| Custom | admin-entered | admin-entered | admin-entered | admin-entered | admin-entered | admin-entered |

Bounds:

- TTL minimum: 5s.
- TTL maximum: 30m.
- Stale-usable window minimum: 30s.
- Stale-usable window maximum: 60m.
- Stale-usable window must be greater than or equal to the largest configured TTL.

User-level route-cache overrides are out of scope for this branch.

## UX Direction

Reference current UI assets:

- `docs/notes/dashboard-reporting-ui/mockups/screenshots/dashboard-desktop.png`
- `docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-report-desktop.png`
- `docs/notes/dashboard-reporting-ui/mockups/screenshots/market-report-desktop.png`
- `docs/004-notes/ui-reshape-shadcn/screenshots/29-admin-settings-light.png`

Mockup artifacts for this scope:

- `docs/notes/market-value-reconciliation-ux-performance/mockups/valuation-health-ui.html`
- `docs/notes/market-value-reconciliation-ux-performance/mockups/screenshots/valuation-health-dashboard-desktop.png`
- `docs/notes/market-value-reconciliation-ux-performance/mockups/screenshots/valuation-health-reports-desktop.png`
- `docs/notes/market-value-reconciliation-ux-performance/mockups/screenshots/cache-policy-admin-desktop.png`
- `docs/notes/market-value-reconciliation-ux-performance/mockups/screenshots/valuation-health-mobile.png`

Design requirements:

- Keep the operational dashboard style: compact top controls, white cards, restrained status badges, dense metric cards, and no marketing copy.
- The mismatch state should explain source difference without claiming the numbers should be identical.
- The default state should not alarm users for tiny rounding deltas.
- The details panel must answer: what value is current, what snapshot point is being charted, which holdings are blocking freshness, and what action fixes it.
- Admin CTAs must be clearly separated from normal-user explanation.
- Cache status should be visible but quiet: restored from session cache, fresh for N seconds, stale but usable, refreshing, or refresh failed.

## Implementation Steps

- [x] Add backend reconciliation DTOs for Dashboard and Reports.
  Evidence: `libs/shared-types/src/index.ts` adds valuation-health DTOs and route-cache DTOs; API wires valuation health into Dashboard overview/enrichment and Portfolio/Market reports.
- [x] Add valuation-health threshold config schema, defaults, validation, persistence, and admin update API.
  Evidence: flat nullable `app_config` columns in `db/migrations/076_kzo216_valuation_health_and_route_cache.sql`; bounds in `apps/api/src/services/appConfig/bounds.ts`; persistence + admin PATCH/GET support in `apps/api/src/persistence/*` and `apps/api/src/routes/adminRoutes.ts`; defaults in `apps/api/src/services/appConfig/valuationHealth.ts`.
- [x] Add affected-holdings diagnostics from latest bars, latest snapshots, active positions, and backfill state.
  Evidence: `apps/api/src/services/valuationHealth.ts` computes holding diagnostics using latest-bar lookup, latest holding snapshots by scope, current active holdings, and instrument backfill status.
- [x] Add targeted snapshot repair enqueue after successful admin backfill for active held instruments.
  Evidence: centralized helper `enqueueSnapshotRepairIfActiveHeld(...)` in `apps/api/src/services/snapshotRepair.ts` is used by the existing backfill worker hook in `apps/api/src/plugins/pgBoss.ts`, gating enqueue to active held scopes only.
- [x] Add admin `/admin/settings` controls for valuation thresholds.
  Evidence: backend GET/PATCH DTO/schema support added in `apps/api/src/routes/adminRoutes.ts`.
- [x] Add route cache policy config schema, defaults, validation, persistence, and admin update API.
  Evidence: flat nullable `app_config` columns in migration 076; defaults and effective-policy resolution in `apps/api/src/services/appConfig/valuationHealth.ts`; bounds + stale-window validation in `apps/api/src/services/appConfig/bounds.ts` and `apps/api/src/routes/adminRoutes.ts`; persistence in `apps/api/src/persistence/*`.
- [x] Add effective route-cache policy to authenticated settings/AppShell payload.
  Evidence: authenticated settings responses now include `effectiveRouteCachePolicy` from `apps/api/src/routes/registerRoutes.ts`.
- [x] Replace route DTO `localStorage` cache with `sessionStorage`.
  Evidence: `apps/web/lib/routeDtoCache.ts` now reads/writes `sessionStorage` and opportunistically clears legacy route DTO keys from `localStorage`.
- [x] Add cache metadata: owner/context, reporting currency, route, range/tab, createdAt, ttlMs, staleUntilMs, appVersion/cacheVersion.
  Evidence: route keys now partition by owner/context/range/tab/reporting currency via `buildRouteDtoCacheKey(...)`; cache envelopes persist `createdAt`, `ttlMs`, `staleUntilAt`, `tags`, and `version`; focused unit coverage in `apps/web/test/lib/routeDtoCache.test.ts`.
- [x] Add targeted invalidation after mutation/recompute/snapshot/reporting-currency/context/session events.
  Evidence: targeted tag clears are wired through `apps/web/components/layout/useSharedContext.ts`, `apps/web/components/layout/useSnapshotGeneration.ts`, `apps/web/features/portfolio/hooks/useTransactionMutations.ts`, and reporting-currency/session transitions in `apps/web/components/layout/AppShell.tsx`.
- [x] Apply route cache to Dashboard, Dashboard Performance, Portfolio, and all Reports tabs.
  Evidence: cached restore + refresh wiring lands in `apps/web/features/dashboard/hooks/useDashboardData.ts`, `apps/web/features/dashboard/hooks/useDashboardPerformance.ts`, `apps/web/features/portfolio/hooks/usePortfolioPageData.ts`, `apps/web/features/portfolio/hooks/useTransactionsPrimaryData.ts`, and `apps/web/features/reports/hooks/useReportData.ts`; runtime TTLs now consume `effectiveRouteCachePolicy` from the authenticated settings/AppShell payload; fresh `sessionStorage` restores skip automatic client fetch, stale-usable entries render first and refresh in the background, and expired handling is enforced at the cache utility layer. Live validation found the Dashboard refresh button only refreshed primary/enrichment data; `apps/web/components/dashboard/DashboardClient.tsx` now refreshes both dashboard primary data and Dashboard Performance, with regression coverage in `apps/web/test/components/dashboard/DashboardClient.test.tsx`.
- [x] Remove unnecessary quote loading from `/dashboard/performance`.
  Evidence: `apps/api/src/routes/registerRoutes.ts` keeps `/dashboard/performance` limited to prefs, store, `asOf`, and `translatePerformancePoints(...)` only, while `/dashboard/overview` and `/dashboard/enrichment` now build `valuationHealth` from `buildRecentValuationPerformance(...)`; `apps/api/src/services/valuationHealth.ts` fixes that helper to the recent `"1M"` window instead of reusing the full performance route payload.
- [x] Optimize latest-bar lookup for reconciliation diagnostics.
  Evidence: `apps/api/src/persistence/postgres.ts#getLatestBarDatesForReconciliation` uses `LEFT JOIN LATERAL ... ORDER BY bar_date DESC LIMIT 1` rather than the broader latest-bars window query.
- [x] Reduce remaining page-read database pressure found during live validation.
  Evidence:
  - `/portfolio/instrument-index` now uses `Persistence.listTransactionInstrumentOptions(...)` instead of hydrating the full store; focused coverage in `apps/api/test/unit/smooth-page-read-paths.test.ts` asserts the route emits `list_transaction_instruments` timing and no `load_store` timing.
  - Portfolio/report FX display-rate helpers now fetch independent source-currency FX rates concurrently while preserving duplicate-source de-duping and row ordering; focused coverage in `apps/api/test/unit/dashboardReportingCurrency.test.ts`.
- [x] Add shared valuation-health frontend component and wire it into Dashboard hero, Portfolio Trend, Reports Portfolio, and Reports Market charts.
  Evidence: shared `apps/web/components/valuation/ValuationHealthPanel.tsx` is rendered from `DashboardHero`, `PortfolioTrendCard`, and `components/reports/ReportsClient.tsx`; non-admin rendering shows explanation-only copy with no repair actions, while admin repair CTA routing now targets the market-data repair/backfill workspace via `apps/web/components/valuation/valuationHealthAdminLink.ts`.
- [x] Add API, web unit, E2E, and HTTP coverage for reconciliation, cache policy, invalidation, and UX states.
  Frontend evidence so far:
  - `npx vitest run test/components/valuation/ValuationHealthPanel.test.tsx test/components/admin/AdminSettingsClient-timeframes.test.tsx test/lib/routeDtoCache.test.ts test/features/dashboard/hooks/useDashboardPrimaryData.test.tsx test/features/portfolio/hooks/usePortfolioPrimaryData.test.tsx test/features/portfolio/hooks/useTransactionsPrimaryData.test.tsx test/features/reports/hooks/useReportData.test.tsx` from `apps/web` passed on 2026-06-14 with 7 files and 47 tests passed before the current route-contract correction.
  - Coverage includes fresh-cache fetch suppression, stale-usable background refresh, non-admin repair-action hiding, and admin CTA routing to the targeted market-data repair workspace.
  Backend evidence so far:
  - `npm run test --prefix apps/api -- test/unit/valuationHealth.test.ts test/integration/dashboard.integration.test.ts` passed on 2026-06-14 with 2 files and 18 tests passed.
  - `apps/api/test/integration/dashboard.integration.test.ts` now asserts that `/dashboard/overview` and `/dashboard/enrichment` derive `valuationHealth` from the recent 1M aggregation window by spying on `getAggregatedSnapshotsInReportingCurrency("user-1", "2026-05-14", "2026-06-14", "TWD")`.
  - The same integration file also asserts that `/dashboard/performance?range=YTD` does not return `valuationHealth`, preserving the lean route contract after the temporary regression.
  - `npm run test:http --prefix apps/api -- test/http/specs/dashboard-reporting-currency-aaa.http.spec.ts` passed on 2026-06-14 with 6 passed and 2 skipped.
  - `npx eslint apps/api/src/routes/registerRoutes.ts apps/api/src/services/valuationHealth.ts apps/api/test/integration/dashboard.integration.test.ts --max-warnings=0` passed on 2026-06-14.
  - `npx tsc -p apps/api/tsconfig.json --noEmit --pretty false` passed on 2026-06-14.
  Full-gate evidence:
  - `npx eslint .` passed on 2026-06-14.
  - `npm run typecheck` passed on 2026-06-14.
  - `npm run test --prefix apps/web` passed on 2026-06-14: 98 files, 622 tests passed.
  - `npm run test --prefix apps/api` passed on 2026-06-14 after the latest performance patches: 149 files passed, 42 skipped; 1558 tests passed, 419 skipped.
  - `npm run test:integration:full:host` passed on 2026-06-14 after a clean rerun against an isolated Postgres/Redis stack: 82 files, 829 passed, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed on 2026-06-14: 271 passed, 13 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed on 2026-06-14: 120 passed.
  - `npm run test:http --prefix apps/api` passed on 2026-06-14: 288 passed, 2 skipped.
  - GitHub Actions run `27506582429` passed on commit `d47d73f2`, and dev deploy run `27506822424` completed successfully before live Chrome validation.
  - GitHub Actions run `27510245695` passed on commit `a5e35293` after the final review fixes: lint, PR gate, build/typecheck, unit tests, integration tests, deploy config validation, Docker build validation, OAuth E2E, and bypass E2E passed.
- [x] Capture Chrome performance evidence against deployed dev after deployment.
  Evidence: dev validation for deployed commit `d47d73f2` confirmed the healthy valuation state, material-gap incident UX, restore behavior, and the 2-3s target for Dashboard, Portfolio, Reports, and Dashboard revisit. Final validation for deployed commit `a5e35293` confirmed the same valuation-health flow in the existing Chrome profile after deploy run `27510584804`; screenshots are stored in `docs/notes/market-value-reconciliation-ux-performance/screenshots/`.

## Post-Deploy Live Validation

Latest deployed validation for branch head `d47d73f2`:

- GitHub Actions run `27506582429` was green on `d47d73f2` before deployment: lint, PR gate, build/typecheck, unit tests, integration tests, deploy config validation, Docker build validation, OAuth E2E, and bypass E2E passed.
- Dev deploy run `27506822424` completed successfully on `d47d73f2`; `vakwen-dev-web`, `vakwen-dev-api`, `vakwen-dev-postgres`, `vakwen-dev-redis`, and `vakwen-dev-cloudflared` were running, with web/API health checks passing.
- Chrome validation used the existing authenticated Vakwen Dev tab at `https://vakwen-dev-web.kzokvdevs.dpdns.org/dashboard`.
- Healthy baseline showed current valuation `$663,017.84`, chart valuation `$663,017.84`, delta `$0`, relative delta `0%`, valuation health `Healthy`, latest bar `Jun 12, 2026`, and latest snapshot `Jun 12, 2026`. Portfolio Trend showed the same market value.
- Incident simulation changed the latest `000660` KR snapshot row for `2026-06-12` from `172,000,000` to `100,000,000` native value, reducing the latest snapshot total from `184,046,223.92` to `112,046,223.92`.
- A fresh authenticated tab after the simulation settled in `3.881s` and showed `Material gap`: current valuation `$663,017.84`, chart valuation `$615,497.84`, delta `$47,520`, relative delta `7.2%`, latest bar `Jun 12, 2026`, and latest snapshot `Jun 12, 2026`. Dashboard hero and Portfolio Trend both exposed the same warning and admin repair guidance.
- Existing-tab manual refresh during the simulation kept showing the cached healthy DTO because the route DTO was still fresh in tab-scoped `sessionStorage`; the API did receive fresh dashboard route requests. This confirms the agreed cache behavior: fresh TTL favors immediate render until TTL expiry, manual route fetches do not force every already-fresh child cache entry to be discarded.
- Restoring the snapshot row returned a fresh authenticated tab to `Healthy` in `3.296s` with current/chart `$663,017.84`, delta `$0`, relative delta `0%`, latest bar `Jun 12, 2026`, and latest snapshot `Jun 12, 2026`.
- Evidence screenshots:
  - `docs/notes/market-value-reconciliation-ux-performance/screenshots/live-dev-material-gap-20260615.jpg`
  - `docs/notes/market-value-reconciliation-ux-performance/screenshots/live-dev-restored-healthy-20260615.jpg`

Live page-performance matrix after deploy:

| Surface | Settled UI time | UI evidence | API timing evidence |
|---|---:|---|---|
| Dashboard | `2.516s` | no progressbar, no waiting placeholder; Market Value `USD 663K`, exact `$663,017.84`; health `Healthy` | `/dashboard/primary` `14.91-105.18ms`; `/dashboard/performance` `257.25-428.68ms`; `/dashboard/enrichment` usually `324.05-719.13ms`, with one concurrent-load sample at `1203.55ms` |
| Portfolio | `2.020s` | no progressbar, no waiting placeholder; 4 positions and 3 markets rendered | `/portfolio/primary` `70.92-204.64ms`; `/portfolio/enrichment` `303.63-391.82ms`; `/portfolio/instrument-index` API `30.21-66.79ms` via `list_transaction_instruments` |
| Reports | `1.666s` | no progressbar, no waiting placeholder; Daily Review, Portfolio Report, and Market Report rendered | `/reports/daily-review` `248.92-594.38ms` |
| Dashboard revisit | `2.350s` | no progressbar, no waiting placeholder; current/chart valuation remained `$663,017.84` | Dashboard route cache reused fresh `sessionStorage` entries where applicable and refreshed stale route data in the background |

Final validation for deployed branch head `a5e35293`:

- GitHub Actions run `27510245695` and PR Gate run `27510245297` were green on `a5e35293`; Codex review on `a5e35293` reported no major issues and there were no unresolved review threads.
- Dev deploy run `27510584804` completed successfully on `a5e35293` in `19m29s`; `vakwen-dev-web`, `vakwen-dev-api`, `vakwen-dev-postgres`, `vakwen-dev-redis`, and `vakwen-dev-cloudflared` were running, with API `/health/live` and `/health/ready` passing through the public dev API domain.
- Chrome validation connected to the existing authenticated Vakwen Dev tab at `https://vakwen-dev-web.kzokvdevs.dpdns.org/dashboard`. The original tab kept its tab-scoped cached material-gap DTO until a fresh tab was opened, confirming the agreed `sessionStorage` behavior for already-fresh route data.
- Incident simulation on the dev DB changed `daily_holding_snapshots` rows for `000660` / `KR` on `2026-06-10`, `2026-06-11`, and `2026-06-12` to `close_price=1,250,000`, `value_native=100,000,000`, and `market_value=100,000,000`, while leaving latest bars and transactions unchanged.
- A fresh authenticated Chrome tab settled in `3.903s` and showed `Material gap`: current valuation `$663,017.84`, chart valuation `$615,497.84`, delta `$47,520`, relative delta `7.2%`, latest bar `Jun 12, 2026`, and latest snapshot `Jun 12, 2026`. Dashboard hero and Portfolio Trend both showed the valuation-health panel.
- Restoring the three `000660` / `KR` rows to their original values returned a fresh authenticated Chrome tab to `Healthy` in `4.819s`: current/chart `$663,017.84`, delta `$0`, relative delta `0%`, latest bar `Jun 12, 2026`, and latest snapshot `Jun 12, 2026`.
- Final evidence screenshots:
  - `docs/notes/market-value-reconciliation-ux-performance/screenshots/live-dev-final-widened-gap-20260615.jpg`
  - `docs/notes/market-value-reconciliation-ux-performance/screenshots/live-dev-final-restored-20260615.jpg`

## Acceptance Criteria

- Hero and Portfolio Trend/report performance charts remain source-honest and explain material mismatches.
- A user can tell when the trend value is older than current valuation and why.
- Admin users can start remediation from the mismatch details when the reason is backfill or snapshot repair.
- Thresholds are configurable at admin level and safely validated.
- Revisited Dashboard, Portfolio, and Reports pages render immediately from sessionStorage when cache entries are fresh.
- Stale-usable entries render immediately with an explicit refreshing state.
- Manual refresh bypasses cache and updates the entry.
- Mutations and context/currency/session changes invalidate affected entries.
- Dashboard valuation path is within the 2-3s target where practical and below the 5s hard cap under normal production conditions.
- No regression against the prior measured page-performance matrix.

## Verification Plan

Use focused checks while implementing, then run the full required repo gate before PR readiness:

1. API unit and integration coverage for reconciliation diagnostics, thresholds, snapshot repair enqueue, and route-cache policy config.
2. Web unit coverage for valuation-health display states, admin/non-admin branching, sessionStorage TTL/stale behavior, and invalidation.
3. Focused E2E for Dashboard mismatch, Reports mismatch, admin threshold/cache settings, cache revisit, stale-usable refresh, and manual refresh bypass.
4. API HTTP coverage for admin settings validation and authenticated effective settings payload.
5. Browser performance sweep on deployed dev/prod for Dashboard, Portfolio, Reports, and no-regression pages.
6. Full required suites from root before declaring all tests pass:
   - `npx eslint .`
   - `npm run typecheck`
   - `npm run test --prefix apps/web`
   - `npm run test --prefix apps/api`
   - `npm run test:integration:full:host`
   - `npm run test:e2e:bypass:mem --prefix apps/web`
   - `npm run test:e2e:oauth:mem --prefix apps/web`
   - `npm run test:http --prefix apps/api`

Focused verification completed for this correction:

- `npm run test --prefix apps/api -- test/unit/valuationHealth.test.ts test/integration/dashboard.integration.test.ts` → 2 files, 18 tests passed
- `npm run test:http --prefix apps/api -- test/http/specs/dashboard-reporting-currency-aaa.http.spec.ts` → 6 passed, 2 skipped
- `npx eslint apps/api/src/routes/registerRoutes.ts apps/api/src/services/valuationHealth.ts apps/api/test/integration/dashboard.integration.test.ts --max-warnings=0` → passed
- `npx tsc -p apps/api/tsconfig.json --noEmit --pretty false` → passed
- `npx vitest run test/unit/smooth-page-read-paths.test.ts -t "instrument options|portfolio primary|dashboard primary"` from `apps/api` → 6 passed, 5 skipped
- `npx vitest run test/unit/smooth-page-read-paths.test.ts` from `apps/api` → 11 passed
- `npx vitest run test/unit/dashboardReportingCurrency.test.ts test/unit/dashboardHoldingGroups.test.ts` from `apps/api` → 2 files, 30 tests passed
- `npx eslint apps/api/src/services/dashboardReportingCurrency.ts apps/api/src/services/fxConversionRates.ts apps/api/test/unit/dashboardReportingCurrency.test.ts --max-warnings=0` → passed
- `npx tsc -p apps/api/tsconfig.json --noEmit --pretty false` → passed

Full local gate verification completed for the current branch head:

- `npx eslint .` → passed
- `npm run typecheck` → passed
- `npm run test --prefix apps/web` → 98 files, 622 tests passed
- `npm run test --prefix apps/api` → 149 files passed, 42 skipped; 1558 tests passed, 419 skipped
- `npm run test:integration:full:host` → 82 files, 829 passed, 1 skipped
- `npm run test:e2e:bypass:mem --prefix apps/web` → 271 passed, 13 skipped
- `npm run test:e2e:oauth:mem --prefix apps/web` → 120 passed
- `npm run test:http --prefix apps/api` → 288 passed, 2 skipped

## Out Of Scope

- Full visual redesign.
- Making every app page hit 2-3 seconds in this branch.
- Cash Ledger, Dividends, Settings Accounts, or Portfolio full-page read-path rewrites beyond no-regression work.
- Service worker/offline caching.
- TanStack Query/SWR migration.
- Persistent latest-quote cache table unless latest-bar tuning fails the Dashboard target.
- Making full browser reload skip server seed.
- User-level route-cache overrides.
- Changing accounting semantics or injecting live current valuation into historical snapshot series.
