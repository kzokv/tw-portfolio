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
- `/portfolio` reads first-paint content from `/portfolio/primary`; `/portfolio/page-data` remains a compatibility endpoint for older callers.
- Shell quick search reads `/portfolio/instrument-index` before falling back to the broader instrument catalog, so the command palette no longer depends on dashboard overview.
- `/transactions` renders primary content from `/transactions/primary`, which seeds recent rows, account options, and lightweight shell account config instead of dashboard overview.
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

- Replace remaining route-primary `loadStore()` exceptions with narrow Postgres projections for `/dashboard/primary`, `/portfolio/primary`, and `/transactions/primary` once the UI contract is stable.
- Add deployed API timing access that is visible from app-origin fetches or logs for `/dashboard/primary`, `/dashboard/enrichment`, `/portfolio/primary`, `/portfolio/enrichment`, `/transactions/primary`, `/settings/fee-config`, and dividend review endpoints.
- Keep the baseline rule: a secondary route must not import `useDashboardData()` or `fetchDashboardSnapshot()` for account/profile/filter metadata.

## Round 2 Implementation On 2026-06-02

This round implemented the first explicit primary/enrichment split on the same PR branch:

- Added `GET /dashboard/primary` for first-paint dashboard data and `GET /dashboard/enrichment` for quote/freshness/FX-enriched dashboard replacement data.
- Added `GET /portfolio/primary` for first-paint holdings/account/instrument data and `GET /portfolio/enrichment` for quote/freshness/dividend-enriched portfolio replacement data.
- Kept compatibility endpoints (`/dashboard/overview`, `/portfolio/page-data`) intact for existing callers, but rewired dashboard, portfolio, and ticker-detail route bootstraps to use explicit primary endpoints for initial data.
- Updated dashboard and portfolio hooks so server-provided primary payloads render immediately, then secondary enrichment refreshes after first paint.
- Split AI connector settings reads into `GET /ai/connectors/summary` and `GET /ai/connectors/logs`; the settings page renders connector summary first and loads recent access separately.
- Changed settings tickers so the primary load calls only `/monitored-tickers`; the full `/instruments` catalog loads when the catalog surface opens, with an explicit error state if catalog load fails.
- Added `Server-Timing` coverage for `/dashboard/primary`, `/dashboard/enrichment`, `/portfolio/primary`, `/portfolio/enrichment`, `/monitored-tickers`, `/instruments`, `/ai/connectors/summary`, and `/ai/connectors/logs`.
- Added focused API and web tests for route contracts, service endpoint paths, initial primary hydration, secondary enrichment behavior, lazy catalog loading, catalog error handling, and AI connector summary/log separation.

Known limitation: `/dashboard/primary` and `/portfolio/primary` still use `loadStore()` to preserve grouped-holdings and accounting semantics while the UI contract is split. They intentionally skip quote resolution, freshness classification, FX/reporting translation, chart data, and dividend enrichment. The next backend performance slice should replace those primary handlers with narrow Postgres read models.

## Round 3 Implementation On 2026-06-02

This round addressed the remaining PR review findings and the latest deployed-dev observations before the next push:

- Restored server-provided initial primary data for `/dashboard` and `/portfolio`, so first-paint rows/cards can render from the primary payload while client enrichment refreshes after hydration.
- Added `GET /transactions/primary` and rewired `/transactions` to seed recent rows, account options, and AppShell portfolio config from one route-primary payload.
- Made AppShell portfolio config seedable from route primary data, avoiding an immediate duplicate `/settings/fee-config` fetch on dashboard, portfolio, and transactions first paint.
- Added a refresh signal to shell instrument-index loading so shared-owner context switches refresh command/search data instead of reusing stale owner data.
- Reworked `/dashboard/primary` summary construction so mixed-currency holdings are not mislabeled as reporting-currency totals when FX translation is intentionally skipped for primary data.
- Preserved `/portfolio/primary` as a quote-light first-paint contract while including fee-profile config and integrity metadata needed by the shell and portfolio client.

Focused verification added in this round:

- `npm run test --prefix apps/api -- smooth-page-read-paths.test.ts` — passed, including `/transactions/primary`, dashboard primary timing, and mixed-currency dashboard-primary coverage.
- `npm run test --prefix apps/web -- usePortfolioPrimaryData.test.tsx useRecentTransactions.test.tsx useDashboardPrimaryData.test.tsx` — passed, including initial recent-transaction hydration coverage.
- `npm exec -- tsc -p apps/web/tsconfig.json --noEmit` — passed after updating portfolio primary test fixtures.

Final local gate verification on 2026-06-02:

- `npx eslint .` — passed.
- `npm run typecheck` — passed.
- `npm run test --prefix apps/web` — passed: 75 files, 470 tests, duration 253.34s.
- `npm run test --prefix apps/api` — passed: 133 files passed, 40 skipped; 1394 tests passed, 408 skipped; duration 79.35s.
- `npm run test:integration:full:host` — passed: 78 files, 755 tests passed, 1 skipped; duration 1745.95s.
- `npm run test:e2e:bypass:mem --prefix apps/web` — passed: 258 tests passed, 9 skipped; duration 12.6m.
- `npm run test:e2e:oauth:mem --prefix apps/web` — passed: 130 tests passed; duration 5.1m.
- `npm run test:http --prefix apps/api` — passed: 274 tests passed, 2 skipped; duration 1.2m.
- Deployed Codex Chrome Extension verification is intentionally pending until these code changes are deployed and the user asks for browser verification.

## Locked Follow-up Scope On 2026-06-02

These decisions were locked after reviewing the latest `dev` branch, the current PR branch, and the deployed dev route timings. They refine the remaining work without changing the original PR scope.

### Primary versus secondary data

- First meaningful content means route title, shared owner/read-only context, and primary rows/cards are visible. It does not mean every quote, FX, chart, dividend, catalog, or log enrichment has completed.
- Quote freshness, FX/reporting-currency translation overlays, chart series, dividend enrichment, full instrument catalogs, and deep AI connector logs are secondary unless the page is not understandable without them.
- Accounting, ownership, and configuration data must be current for primary content. Market, FX, chart, and projection data may be stale temporarily when the UI exposes `asOf`, stale, or refreshing state.

### Route boundaries

- `/dashboard` primary content is owner context, summary cards using cached/latest available values, a grouped-holdings preview sufficient to understand the page, and action-center state. Performance charts, quote freshness, FX refinement, and deeper dividend widgets are secondary.
- `/portfolio` primary content is grouped holdings table/summary, account and instrument labels needed for display, and allocation-basis behavior. Quote freshness badges, dividend sections, and deeper breakdowns are secondary.
- `/tickers/[ticker]` primary content is ticker-scoped transaction history plus primary holding/account context needed for fallback stats. It may reuse `GET /dashboard/primary` for that context, but must not bootstrap from dashboard enrichment.
- `/settings/accounts` primary content is accounts, fee profiles, and bindings from a narrow settings/fee-config read. Live balances and deep integrity checks are secondary.
- `/settings/tickers` primary content is the monitored ticker list only. Full catalog, browse/search data, and repair metadata are secondary or interaction-triggered.
- `/settings/ai-connectors` primary content is connector summary plus policy. Access logs and expanded per-connector scopes/tools are secondary, lazy, or paginated.

### Loading architecture

- Use server-provided initial primary data for the pages that are still visibly slow, especially `/dashboard`, `/portfolio`, and `/settings/accounts`, then hydrate client hooks from that payload.
- Keep secondary/enrichment requests client-side and route-owned.
- Existing same-owner content should stay mounted during refreshes with local pending states. After mutations, refresh authoritative primary accounting data first, then refresh secondary enrichment in the background.
- Do not optimistically update complex holdings or cost-basis projections unless the mutation response already contains the authoritative recalculated projection.

### Backend read rules

- Route-primary reads should treat `loadStore()` as forbidden by default. An exception is allowed only when the endpoint contract truly requires full accounting-domain consistency and there is no narrow projection available.
- Use narrow reads first. Do not use broad response caching as the main fix for `/dashboard/overview` or `/portfolio/page-data`.
- Caching is acceptable for secondary/enrichment data such as quote freshness, FX/reporting overlays, chart points, dividend widgets, and catalog search results, with narrow invalidation by domain.
- Prefer explicit primary endpoints over overloading broad endpoints. Candidate routes include `/dashboard/primary`, `/portfolio/primary`, `/dashboard/enrichment`, `/portfolio/enrichment`, `/ai/connectors/summary`, and paginated `/ai/connectors/logs`.
- Keep existing broad endpoints temporarily for compatibility, but route-primary UI must not depend on them once the split lands.

### AppShell and shared context

- `AppShell` first-paint critical data is limited to session/profile identity, locale/theme/display preferences needed to avoid mismatch, shared owner/read-only state, and minimal nav/sidebar structure.
- Notifications, AI inbox badge, command-palette instrument index, full sharing switcher list, and global transaction account config must not block route primary content. They can load on idle, in the background, or when the related UI opens.
- Shared portfolio owner label and read-only state must render from shell/shared-context data while route primary data is pending.
- Shared-owner switches must invalidate or cancel route primary and secondary requests. Stale data from the previous owner must not remain visible as normal content.
- All route-primary and secondary API reads must follow the active `contextUserId`, not only the session user id, unless the endpoint is explicitly session-owned.

### Budgets and evidence

- Treat deployed dev/QNAP warm authenticated navigation as the first user-facing budget target:
  - shell visible/usable: P95 under 1.0s
  - shared owner/read-only context visible: P95 under 1.0s
  - `/dashboard` primary content: P95 under 2.5s
  - `/portfolio` primary content: P95 under 2.5s
  - `/transactions` primary content: P95 under 2.0s
  - `/cash-ledger` primary content: P95 under 2.5s
  - `/settings/accounts` primary content: P95 under 2.0s
  - `/settings/tickers` monitored-list primary content: P95 under 2.0s
  - `/settings/ai-connectors` connector-summary primary content: P95 under 2.0s
- Keep the existing stricter local/API budgets as aspirational backend targets, but do not confuse them with deployed browser UX evidence.
- Done requires both browser-visible timing and backend/API attribution:
  - Codex Chrome Extension route walk on the authenticated shared portfolio for Wen-Ping Chuang.
  - timings for shell visible, owner context visible, primary content visible, and secondary/enrichment settled.
  - `Server-Timing` or structured logs for each hot primary endpoint.
  - network assertions proving non-dashboard pages do not wait for `/dashboard/overview`, settings tickers does not call full `/instruments` before monitored-list primary render, AI connectors does not load full logs/details before connector-summary primary render, and `AppShell` does not trigger full catalog work before route primary content.

### Implementation sequence

1. Add or refine instrumentation so AppShell, route-primary, and secondary/enrichment work are measured separately.
2. Demote AppShell fetches that are not required for first paint.
3. Add server-provided initial primary data for the still-slow routes.
4. Split dashboard into primary and secondary/enrichment phases.
5. Split portfolio into primary and secondary/enrichment phases.
6. Clean up settings tickers and AI connectors so primary content is small and secondary data is interaction-triggered or paginated.
7. Add code-level naming boundaries, API tests, hook tests, E2E network assertions, and documentation updates so future pages follow the same pattern.

## PR Notes

This work is repo/process/performance improvement without a Linear ticket. Per repo rules, use the waiver path for PR metadata:

- PR label: `waiver:linear-ticket`
- PR body `## Waiver` fields:
  - `Reason: performance baseline and page-load architecture improvement requested directly in Codex thread`
  - `Approved-by: @lume`
  - `Scope: title|commits|both`

PR base branch must be `dev`, assignee must be `@me`, and primary label should include `enhancement`.
