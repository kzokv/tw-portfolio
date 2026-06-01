---
slug: performance-smooth-pages
source: codex-performance-investigation
created: 2026-06-01
tickets: []
required_reading:
  - AGENTS.md
  - apps/web/AGENTS.md
  - apps/api/AGENTS.md
  - docs/notes/portfolio-holdings-aggregation/scope-todo-202606011425-holdings-aggregation.md
superseded_by: null
---

# Todo: Smooth Page Performance Baseline

## Problem

Authenticated shared-portfolio navigation currently renders the shell quickly but delays usable page content for roughly 25-32 seconds on `/dashboard`, `/portfolio`, `/transactions`, and `/cash-ledger`. Investigation against the deployed main branch and latest `dev` found that the app still globally fetches `/dashboard/overview` from `AppShell` and blocks route content on that data, while hot backend routes hydrate broad store state through `loadStore()` for page reads.

Latest `dev` also moved grouped holdings and reporting-currency holding-group translation into `/dashboard/overview`, so the endpoint is now both heavier and more central. This performance slice must preserve grouped-holdings behavior while removing it from the global shell bootstrap path.

## Baseline Measurements

Captured via Codex Chrome plugin on 2026-06-01 against `https://vakwen-web.kzokvdevs.dpdns.org` while viewing the shared portfolio labeled `Wen-Ping Chuang`.

| Route | Route/document ready | Usable content |
|---|---:|---:|
| `/dashboard` | ~0.84s | ~29.7s |
| `/portfolio` | ~0.82s | ~32.3s |
| `/transactions` | ~0.62s | ~29.1s |
| `/cash-ledger` | navigation timed out at 10s | ledger rows ~25.7s, shared labels later |

Unauthenticated public checks were much faster (`/login` TTFB ~1.37s, public `/dashboard` TTFB ~1.79s), so the primary root cause is application/data-loading architecture rather than raw static serving or QNAP hardware alone.

## Performance Baseline Pattern

- Shell data: profile, locale, shared-owner context, nav, unread count, and command/search basics only.
- Page primary data: one route-specific read model that renders first useful content.
- Secondary data: charts, quote freshness, performance series, and richer actions load after first paint.
- Enrichment: quote, FX, freshness, and grouped-holding translation work must not block unrelated routes.
- Shared portfolio context must be visible immediately from profile/shared-context state.
- Existing content should remain stable during refreshes; route transitions should use skeleton regions instead of an empty shell.

## Target Budgets

| Surface | Target |
|---|---:|
| Shell/profile/shared context | P95 < 300ms |
| Dashboard primary content | P95 usable UI < 2.5s |
| Portfolio primary content | P95 usable UI < 2.0s |
| Transactions primary content | P95 usable UI < 2.0s |
| Cash ledger first page | P95 usable UI < 2.5s |
| Primary page read endpoint | P95 < 800ms where realistic, < 1000ms max for cash ledger |
| Blank shell before meaningful page content | Never > 1s without route skeleton |

## Implementation Status

The architecture baseline and the implemented smooth-page pattern are now documented in:

- `docs/001-architecture/web-frontend.md` — shell vs page boundaries, primary vs secondary data, frontend budgets, and verification expectations
- `docs/001-architecture/backend-db-api.md` — page-read endpoint rules, targeted read-model guidance, timing instrumentation, and backend verification expectations

The worktree now implements the first production baseline:

- `AppShell` no longer calls `useDashboardData()` and no longer gates all routes on `/dashboard/overview`.
- `/settings` uses a targeted `getUserSettings()` persistence read with `Server-Timing` instead of full store hydration.
- `/portfolio` reads primary content from `/portfolio/page-data`; this endpoint deliberately omits dashboard summary/actions/settings and FX translation, while preserving cached quote snapshots and freshness fields for holdings.
- Shell quick search reads `/portfolio/instrument-index` before falling back to the broader instrument catalog, so the command palette no longer depends on dashboard overview.
- `/transactions` renders primary content from recent transactions plus lightweight shell account config instead of dashboard overview.
- `/cash-ledger` no longer fetches dashboard overview for locale, seeds account metadata for first paint, and uses targeted read paths for ledger rows and account balances.
- `/dashboard/overview` remains dashboard-owned and instrumented, preserving grouped-holdings behavior for dashboard consumers.

Fresh deployed before/after browser measurements are still required before claiming the route budget table above is met in production.

## Locked Scope

- Add lightweight server/API timing instrumentation for hot page read paths.
- Decouple `AppShell` from global dashboard data.
- Preserve shared-context behavior and grouped-holdings behavior from latest `dev`.
- Create route-specific page data boundaries for dashboard, portfolio, transactions, and cash ledger.
- Replace full-store hydration on the highest-impact read paths with targeted read models or narrowly scoped queries.
- Remove cash ledger's dashboard fetch for locale and avoid raw UUID account-label flashes.
- Keep mutation, recompute, and domain-consistency paths safe; do not remove `loadStore()` from write-heavy flows merely for cleanup.
- Add docs/tests so future page work follows the same performance pattern.

## Implementation Steps

- [x] Add instrumentation.
  - [x] Emit `Server-Timing` and structured duration logs for `/settings`, `/dashboard/overview`, `/dashboard/performance`, `/portfolio/page-data`, `/portfolio/instrument-index`, `/portfolio/cash-ledger`, and `/accounts?includeBalances=true`.
  - [x] Track DB/query time, app time, total time, response bytes where practical.
  - [x] Keep instrumentation low-noise and safe for production logs.
- [x] Split shell data from dashboard data.
  - [x] Remove `useDashboardData()` from `AppShell`.
  - [x] Define a shell-level context that only carries profile, locale, shared context, nav/search essentials, notification state, and global action handlers.
  - [x] Replace global `dashboard.isBootstrapping` route gating with page-level loading states.
  - [x] Ensure shared portfolio banner/owner label renders before portfolio page data resolves.
- [x] Create route-specific page data flows.
  - [x] Dashboard owns dashboard summary, holdings preview/grouped holdings, actions, and performance lazy load.
  - [x] Portfolio owns grouped holdings page data and allocation-basis preference handling.
  - [x] Transactions owns recent transactions, account options, and lightweight verification/status data.
  - [x] Cash ledger owns first-page ledger rows, account labels, balances, and filters.
- [x] Optimize backend read paths.
  - [x] Add targeted persistence/read-model methods for page reads instead of broad `loadStore()` where the route only needs projections.
  - [x] Preserve existing DTO compatibility where callers still expect `holdings`, `holdingGroups`, accounts, fee profiles, or instruments.
  - [x] Keep grouped-holdings math and reporting-currency semantics consistent with `portfolio-holdings-aggregation`.
- [x] Fix cash ledger first.
  - [x] Remove server-side `fetchDashboardSnapshot()` from `/cash-ledger` page.
  - [x] Return account display metadata with cash ledger data or otherwise guarantee no UUID label flash.
  - [x] Replace `/accounts?includeBalances=true` full-store hydration with a targeted account/balance query.
  - [x] Replace cash-ledger enrichment via `loadUserStore()` with SQL joins or targeted batched lookups.
- [x] Add performance regression coverage.
  - [x] Add backend timing helpers and route tests for hot read-path `Server-Timing` coverage.
  - [x] Add focused tests proving portfolio/cash-ledger read boundaries no longer require `/dashboard/overview` before primary content can render.
  - [x] Preserve existing shared-context/impersonation HTTP and E2E coverage; the final HTTP gate caught and verified the `/settings` context-read contract.
- [x] Update documentation.
  - [x] Document the page performance baseline pattern in architecture and backend/frontend docs.
  - [x] Update route/data-loading notes touched by the implementation.
  - [ ] Capture deployed before/after measurements in this note or a follow-up transition note.

## Acceptance Criteria

- `/portfolio`, `/transactions`, and `/cash-ledger` primary content can render without waiting for `/dashboard/overview`.
- `/dashboard/overview` grouped-holdings behavior remains correct for dashboard consumers.
- `/portfolio` grouped holdings remain correct and preserve allocation-basis behavior.
- Cash ledger first render uses human account labels for shared portfolio accounts, not raw account UUIDs.
- Shared-context owner/read-only UI remains visible and correct during page loading.
- Hot read endpoints expose timing evidence sufficient to identify backend vs frontend delay.
- Focused tests cover the new page-data boundaries and shared-context behavior.
- Relevant documentation is updated.
- Full repository gates required by `AGENTS.md` are run before final PR readiness is claimed.

## Verification Plan

Run smallest relevant checks during implementation, then the full gate before PR readiness:

1. Focused unit/API tests for new read-model methods and grouped-holdings compatibility.
2. Web component/hook tests for decoupled shell and page-level loading states.
3. Focused E2E for dashboard, portfolio, transactions, and cash ledger shared portfolio loading.
4. Full required suites from root before declaring "all tests pass":
   - `npx eslint .`
   - `npm run typecheck`
   - `npm run test --prefix apps/web`
   - `npm run test --prefix apps/api`
   - `npm run test:integration:full:host`
   - `npm run test:e2e:bypass:mem --prefix apps/web`
   - `npm run test:e2e:oauth:mem --prefix apps/web`
   - `npm run test:http --prefix apps/api`

## Verification Evidence

Focused checks run locally in this worktree:

- `npx tsc -p apps/api/tsconfig.json --noEmit --pretty false` — passed
- `npx tsc -p apps/web/tsconfig.json --noEmit --pretty false` — passed after `npm install` materialized workspace dependencies
- `npx tsc -p apps/api/test/unit/tsconfig.json --noEmit --pretty false` — passed
- `npx tsc -p apps/api/tsconfig.json --noEmit --pretty false && npx tsc -p apps/web/tsconfig.json --noEmit --pretty false` — passed
- `npm run test --prefix apps/api -- --run test/unit/smooth-page-read-paths.test.ts test/unit/cash-ledger.test.ts test/unit/accounts-live-balances.test.ts` — passed
- `npm run test --prefix apps/web -- --testTimeout 20000 test/features/cash-ledger/CashLedgerClient.test.tsx test/features/cash-ledger/accountOptions.test.ts` — passed

Sample local timing evidence from memory-backed unit routes:

- `/settings`: `Server-Timing` included `user_settings;dur=...`; observed total around 1.23ms in the focused test.
- `/portfolio/page-data`: `Server-Timing` included `load_quotes`, `build_portfolio_page_data`, `freshness`, and `build_holding_groups`; observed total around 70ms in the focused test before quote regression coverage and around 1ms in the added cached-quote regression case.
- `/portfolio/cash-ledger`: `Server-Timing` included `list_cash_ledger`, `cash_ledger_enrichment`, and `map_response`.
- `/accounts?includeBalances=true`: `Server-Timing` included `accounts_with_balances`.

Cloud Codex review follow-up:

- Fixed PR #201 review finding about `/portfolio/page-data` dropping quote/freshness fields by reusing the dashboard quote snapshot input/resolution flow, applying freshness enrichment, rebuilding holding groups after enrichment, and adding route-level regression coverage.
- Focused check: `npm run test --prefix apps/api -- --run test/unit/smooth-page-read-paths.test.ts` — passed, 3 tests.

Full repo gates run locally in this worktree:

- `npx eslint .` — passed
- `npm run typecheck` — passed
- `npm run test --prefix apps/web` — passed, 454 tests
- `npm run test --prefix apps/api` — passed, 1388 tests passed, 408 skipped
- `npm run test:integration:full:host` — passed, 755 tests passed, 1 skipped
- `npm run test:e2e:bypass:mem --prefix apps/web` — passed, 258 tests passed, 9 skipped
- `npm run test:e2e:oauth:mem --prefix apps/web` — passed, 130 tests
- `npm run test:http --prefix apps/api` — passed after fixing `/settings` to read `contextUserId`, 274 tests passed, 2 skipped

Fresh deployed shared-portfolio before/after browser timings are still pending because these changes have not been deployed yet.

## Follow-up: Dev Deployment Sweep On 2026-06-02

Captured via the Codex Chrome Extension against `https://vakwen-dev-web.kzokvdevs.dpdns.org` using the already-open authenticated `/transactions` tab. Direct API tab navigation was blocked by Chrome policy for `vakwen-dev-api.kzokvdevs.dpdns.org`, so attribution used route-visible timing plus code-path inspection.

| Route | Warm usable content | Finding |
|---|---:|---|
| `/transactions` | ~0.8s | Healthy; no dashboard dependency observed. |
| `/cash-ledger` | ~1.3s | Healthy after prior split. |
| `/dashboard` | ~11.6s | Still slow by its own `/dashboard/overview` + quote/freshness/translation work. |
| `/portfolio` | ~10.0s | Still slow by `/portfolio/page-data` quote/freshness work preserved by the review fix. |
| `/settings/accounts` | ~10.0s before this follow-up | Still called `useDashboardData()`, so Accounts waited for `/dashboard/overview`. Fixed in this follow-up by consuming AppShell's narrow fee/account config. |
| `/dividends` | ~10.2s before this follow-up | Server page called `fetchDashboardSnapshot()` only to get accounts. Fixed in this follow-up by reading `/settings/fee-config` instead. |
| `/settings/profile`, `/settings/tickers` | ~0.8-1.0s warm | Healthy. |
| `/settings/display` | ~4.4s warm | Some route/chunk or settings-shell delay remains, but it does not use dashboard data. |

Follow-up fixes:

- Exposed AppShell's narrow account/fee-profile config through `AppShellDataContext` so route children can reuse it without extra dashboard reads.
- Rewired `AccountsSettingsClient` from `useDashboardData()` to the shell account config.
- Replaced `/dividends` server-side `fetchDashboardSnapshot()` with `/settings/fee-config` for account filter metadata.
- Added `Server-Timing` coverage for `/settings/fee-config`.

Remaining performance work:

- Split dashboard and portfolio into primary/secondary data phases: render stale/cached holdings immediately, then stream or fetch quote freshness, FX translation, performance series, and freshness badges as secondary updates.
- Add deployed API timing access that is visible from app-origin fetches or logs for `/dashboard/overview`, `/dashboard/performance`, `/portfolio/page-data`, `/settings/fee-config`, and dividend review endpoints.
- Keep the baseline rule: a secondary route must not import `useDashboardData()` or `fetchDashboardSnapshot()` for account/profile/filter metadata.

## PR Notes

This work is repo/process/performance improvement without a Linear ticket. Per repo rules, use the waiver path for PR metadata:

- PR label: `waiver:linear-ticket`
- PR body `## Waiver` fields:
  - `Reason: performance baseline and page-load architecture improvement requested directly in Codex thread`
  - `Approved-by: @lume`
  - `Scope: title|commits|both`

PR base branch must be `dev`, assignee must be `@me`, and primary label should include `enhancement`.
