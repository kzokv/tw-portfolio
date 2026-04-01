---
slug: kzo-130
source: scope-grill
created: 2026-03-31
tickets: [KZO-130]
required_reading:
  - docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md
  - docs/004-notes/kzo-126/scope-todo-202603301300-backfill-infrastructure.md
superseded_by: null
---

# Todo: KZO-130 — Add Daily Refresh Worker for Monitored Symbols

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read the existing backfill worker at `apps/api/src/services/market-data/backfillWorker.ts` and the pg-boss plugin at `apps/api/src/plugins/pgBoss.ts` — the daily refresh worker builds directly on these.

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Queue strategy | Reuse `finmind-backfill` queue at `priority: 10` | Per-ticker work is identical to backfill; no new handler needed. pg-boss dequeues highest priority first. |
| Trigger model | pg-boss cron → catalog-sync queue → chain to daily refresh enqueue | Catalog sync runs first (fresh instrument data), daily refresh follows. Two queues, completion-triggered. |
| Chain behavior | Soft chain — daily refresh fires on catalog sync success OR failure | Stale catalog doesn't invalidate existing instrument data. Catalog failure shouldn't block bar updates. |
| Cron schedule | `30 17 * * 1-5` (weekdays only, 17:30 TST) | FinMind updates at 17:30 TST. Weekdays only; rare Saturday sessions caught by next Monday. |
| Monitored set query | New `getAllMonitoredTickers()` persistence method | Distinct union across all non-demo users, filtered: `ready` status, non-delisted. |
| userId in job data | Optional — absent for daily refresh | System-initiated, no single triggering user. |
| SSE notification | Per-ticker fan-out (Option D) | As each ticker completes, query monitoring users and publish SSE to each. Real-time, no batch tracking. |
| SSE event types | New `daily_refresh_complete` / `daily_refresh_failed` | Different UX semantics from backfill (quiet "data fresh" vs prominent progress badge). |
| Failure behavior | Daily refresh failures do NOT change `bars_backfill_status` | Transient FinMind outage shouldn't flip a `ready` ticker to `failed` and remove it from future refreshes. |
| FinMind fetch window | Optional `startDate` param, 7-day lookback for daily refresh | Full history fetch is wasteful for one new bar. 7-day window covers weekends/holidays. Backfill still uses `HISTORY_START`. |
| Catalog sync as pg-boss job | Wrap existing `runCatalogSync()` in a pg-boss handler | Enables cron scheduling and chaining. Reuses existing orchestrator logic. |
| Code organization | Per-worker registration modules, `pgBoss.ts` becomes thin orchestrator | Two queues + cron + chain logic is too much for one file. |
| Shared upsert functions | Extract `upsertDailyBars` / `upsertDividendEvents` into shared module | Both handlers (backfill + daily refresh) use the same SQL upsert logic. |
| Demo user filtering | `getAllMonitoredTickers` excludes tickers monitored only by demo users | ADR: "No real FinMind API calls triggered by demo sessions." |
| Frontend SSE handling | Out of scope | Event types added to `shared-types`; web app handler is a follow-up. |

## Implementation Steps

### 1. FinMind Client — Optional `startDate`

- [x] Add optional `startDate?: string` param to `FinMindProvider` interface methods: `fetchDailyBars(ticker, startDate?)` and `fetchDividendEvents(ticker, startDate?)`
- [x] Update `fetchDataset<T>(dataset, ticker, startDate?)` in `finmindClient.ts` — defaults to `HISTORY_START` when absent
- [x] Update `FinMindClient` to pass `startDate` through
- [x] Update `MockFinMindClient` to accept `startDate` (can ignore it for fixture generation)
- [x] Update existing mock test if signature assertion breaks

### 2. SSE Event Types

- [x] Add to `libs/shared-types/src/events.ts`:
  - `DailyRefreshCompleteEvent { type: "daily_refresh_complete"; ticker: string; barsCount: number; dividendsCount: number; }`
  - `DailyRefreshFailedEvent { type: "daily_refresh_failed"; ticker: string; reason: string; }`
- [x] Add both to `SSEEvent` discriminated union and `SSEDomainEventType`

### 3. Persistence Methods

- [x] Add `getAllMonitoredTickers(): Promise<string[]>` to `Persistence` interface
  - SQL: distinct union of `user_monitored_tickers` + `lots` (open positions), joined to `instruments` for filtering
  - Filters: `bars_backfill_status = 'ready'`, `delisted_at IS NULL`, excludes tickers monitored only by `users.is_demo = true` users
- [x] Add `getUsersMonitoringTicker(ticker: string): Promise<string[]>` to `Persistence` interface
  - SQL: non-demo users who have this ticker in manual selections OR open positions
  - Returns distinct user IDs
- [x] Implement both in `PostgresPersistence`
- [x] Add stub implementations in `MemoryPersistence` (return empty arrays)

### 4. Extract Shared Upsert Functions

- [x] Create `apps/api/src/services/market-data/upserts.ts`
- [x] Move `upsertDailyBars` and `upsertDividendEvents` from `backfillWorker.ts` to the new module
- [x] Move `deriveDividendKey` helper as well (used by `upsertDividendEvents`)
- [x] Update `backfillWorker.ts` to import from `upserts.ts`

### 5. Backfill Handler — Trigger Branching

- [x] Extend `BackfillJobData`: `userId` becomes optional, add `startDate?: string`, add `"daily_refresh"` to `trigger` union
- [x] Update handler to pass `startDate ?? HISTORY_START` to `finmind.fetchDailyBars(ticker, startDate)` and `finmind.fetchDividendEvents(ticker, startDate)`
- [x] Add trigger branching in success path:
  - `trigger === "daily_refresh"`: call `getUsersMonitoringTicker(ticker)`, publish `daily_refresh_complete` to each user
  - Other triggers: publish `backfill_complete` to `userId` (existing behavior)
- [x] Add trigger branching in failure path:
  - `trigger === "daily_refresh"`: do NOT call `updateBackfillStatus("failed")`; publish `daily_refresh_failed` to monitoring users
  - Other triggers: existing behavior (update status, publish `backfill_failed`)
- [x] Add `getUsersMonitoringTicker` to `BackfillWorkerDeps` (or a query function)

### 6. Worker Module Split

- [x] Create `apps/api/src/services/market-data/registerBackfillWorker.ts`
  - Extract backfill queue creation + worker registration from `pgBoss.ts`
  - Export `registerBackfillWorker(app, boss, deps)` function
- [x] Create `apps/api/src/services/market-data/registerCatalogSyncWorker.ts`
  - New `catalog-sync` queue (singleton policy, same retry config as backfill)
  - Handler wraps `runCatalogSync(deps)`, then enqueues daily refresh jobs on success or failure
  - Export `registerCatalogSyncWorker(app, boss, deps)` function
- [x] Create `apps/api/src/services/market-data/dailyRefreshEnqueue.ts`
  - `enqueueDailyRefresh(boss, persistence, log)`: calls `getAllMonitoredTickers()`, enqueues one job per ticker on `finmind-backfill` with `{ priority: 10, trigger: "daily_refresh", startDate: <7-day-ago>, singletonKey: ticker }`
  - Named constant: `DAILY_REFRESH_LOOKBACK_DAYS = 7`
  - Named constant: `DAILY_REFRESH_PRIORITY = 10`
- [x] Refactor `pgBoss.ts` into thin orchestrator:
  - Create shared deps (pool, rateLimiter, finmind client)
  - Call `registerBackfillWorker(app, boss, deps)`
  - Call `registerCatalogSyncWorker(app, boss, deps)`
  - Register cron: `boss.schedule("catalog-sync", "30 17 * * 1-5", {})`

### 7. Catalog Sync Worker Handler

- [x] Handler receives `runCatalogSync` deps + `boss` + `persistence` (for `getAllMonitoredTickers`)
- [x] Rate limit check → reschedule (same pattern as backfill: `startAfter`, not a retry)
- [x] Call `runCatalogSync(deps)`
- [x] In `finally` block (success or failure): call `enqueueDailyRefresh(boss, persistence, log)`
- [x] Log catalog sync result on success, log error on failure (before triggering refresh)

### 8. Unit Tests

- [x] `apps/api/test/unit/daily-refresh-enqueue.test.ts`
  - Given mocked `getAllMonitoredTickers` returning N tickers, verify N jobs enqueued with correct priority (10), trigger (`"daily_refresh"`), startDate (7-day lookback), singletonKey
  - Given empty monitored set, verify no jobs enqueued
  - Verify `DAILY_REFRESH_LOOKBACK_DAYS` produces correct date string
- [x] `apps/api/test/unit/catalog-sync-worker.test.ts`
  - Verify `runCatalogSync` called with correct deps
  - Verify `enqueueDailyRefresh` called on catalog sync success
  - Verify `enqueueDailyRefresh` called on catalog sync failure (soft chain)
  - Verify rate-limit reschedule path (budget exhausted → job rescheduled, `runCatalogSync` not called)
- [x] `apps/api/test/unit/backfill-handler-branching.test.ts`
  - `trigger: "daily_refresh"` success → `getUsersMonitoringTicker` called, `daily_refresh_complete` published to each returned user, `updateBackfillStatus("ready")` still called (for `last_synced_at`)
  - `trigger: "daily_refresh"` failure (last retry) → `updateBackfillStatus("failed")` NOT called, `daily_refresh_failed` published to monitoring users
  - `trigger: "user_selection"` → existing behavior unchanged (single-user SSE, status update on failure)
  - `startDate` passed through to `finmind.fetchDailyBars` and `finmind.fetchDividendEvents`

### 9. Integration Tests

- [x] `apps/api/test/integration/daily-refresh-persistence.integration.test.ts`
  - `getAllMonitoredTickers`:
    - Returns distinct tickers from manual selections + open positions across multiple users
    - Filters out `bars_backfill_status != 'ready'` (test with pending, backfilling, failed)
    - Filters out `delisted_at IS NOT NULL`
    - Excludes tickers monitored ONLY by demo users
    - Includes tickers monitored by both demo AND real users
  - `getUsersMonitoringTicker`:
    - Returns user from manual selection
    - Returns user from open position
    - Excludes demo users
    - Deduplicates (user has both manual + position for same ticker)
    - Returns empty for unmonitored ticker

## Explicit Out of Scope

- Snapshot materialization (ADR Job 3)
- Post-ingest backup automation (ADR Job 4)
- Weekend/holiday smart calendar (TWSE trading calendar)
- Batch completion tracking / aggregate notifications
- `daily_refresh_started` SSE event
- Redis-backed rate limiter (stays in-memory)
- Frontend SSE handling for `daily_refresh_complete/failed` (follow-up ticket)
- Backfilling existing test debt for `createBackfillHandler` baseline logic
- E2E tests (cron-triggered, memory backend in E2E means `boss = null`)

## Known Limitations (Phase 1)

- Rate limiter resets on server restart (in-memory) — daily refresh re-consumes budget
- Large monitored sets (300+ tickers) consume entire hourly API budget, starving backfill jobs
- No monitoring/alerting for silent daily refresh failures (only server logs + SSE to online users)
- Race condition: ticker status can change between enqueue query and execution (acceptable)

## References

- KZO-122 ADR: `docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md`
- KZO-126 scope todo: `docs/004-notes/kzo-126/scope-todo-202603301300-backfill-infrastructure.md`
- Backfill worker: `apps/api/src/services/market-data/backfillWorker.ts`
- pg-boss plugin: `apps/api/src/plugins/pgBoss.ts`
- Catalog sync: `apps/api/src/services/market-data/runCatalogSync.ts`
- Rate limiter: `apps/api/src/services/market-data/rateLimiter.ts`
- FinMind client: `apps/api/src/services/market-data/finmindClient.ts`
- FinMind provider interface: `apps/api/src/services/market-data/types.ts`
- Persistence types: `apps/api/src/persistence/types.ts`
- SSE event types: `libs/shared-types/src/events.ts`
- Monitored set query: `apps/api/src/persistence/postgres.ts:2407`
- Follow-up: frontend SSE handling for daily refresh events
