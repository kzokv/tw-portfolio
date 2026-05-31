---
slug: kzo-126
source: scope-grill
created: 2026-03-30
tickets: [KZO-126]
required_reading:
  - docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md
  - docs/004-notes/kzo-123/scope-todo-202603290530-monitored-symbols.md
superseded_by: null
---

# Todo: KZO-126 — Backfill Job Queue Infrastructure and Worker

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also fetch FinMind API documentation from `https://finmind.github.io/llms-full.txt` before implementing the FinMind client.

## Implementation Steps

### pg-boss Setup

- [x] Install `pg-boss` as a dependency in `apps/api`
- [x] Create pg-boss Fastify plugin (`apps/api/src/plugins/pgBoss.ts`)
  - Initialize pg-boss with the existing Postgres connection
  - Start on Fastify `onReady`, stop on `onClose`
  - pg-boss creates its own `pgboss` schema automatically
- [x] Register the backfill worker (job handler) during plugin setup

### FinMind API Client

- [x] Add `FINMIND_API_TOKEN` env var to `libs/config/src/env.ts` (`Env` schema)
  - Reference FinMind docs at `https://finmind.github.io/llms-full.txt` for auth details
- [x] Create FinMind client (`apps/api/src/services/market-data/finmindClient.ts`)
  - Real HTTP implementation: `fetchDailyBars(ticker)` → calls `TaiwanStockPrice` dataset
  - Real HTTP implementation: `fetchDividendEvents(ticker)` → calls `TaiwanStockDividend` dataset
  - One request returns full date range per symbol (no pagination)
- [x] Create mock implementation (`apps/api/src/services/market-data/finmindClient.mock.ts`)
  - Returns fixture data for tests
  - Follows existing `MockPrimaryProvider` pattern from `providers/marketData.ts`
- [x] Define `FinMindProvider` interface so real and mock are swappable

### Rate Limiter

- [x] Create in-memory sliding window rate limiter (`apps/api/src/services/market-data/rateLimiter.ts`)
  - 600 requests/hour budget
  - `canConsume(n: number): boolean` — check if budget allows N requests
  - `consume(n: number): void` — decrement budget
  - `msUntilAvailable(n: number): number` — time until N requests are available (for job rescheduling)
  - Resets on server restart (acceptable for phase 1)

### Backfill Worker

- [x] Create backfill worker (`apps/api/src/services/market-data/backfillWorker.ts`)
  - Subscribes to pg-boss queue (e.g. `finmind-backfill`)
  - Sequential processing: one job at a time
  - Per-job flow:
    1. Check rate limiter — if budget exhausted, reschedule via `startAfter` (does NOT count as retry)
    2. Update `instruments.bars_backfill_status` → `backfilling`
    3. Emit `backfill_started` SSE event to triggering user
    4. Fetch daily bars from FinMind (`TaiwanStockPrice`)
    5. Write bars to `market_data.daily_bars` (upsert on `(ticker, bar_date)`)
    6. Fetch dividend events from FinMind (`TaiwanStockDividend`)
    7. Write dividend events to `market_data.dividend_events` (dividend fetch failure → log warning, don't fail job)
    8. Update `instruments.bars_backfill_status` → `ready`, update `last_synced_at`
    9. Emit `backfill_complete` SSE event to triggering user
  - On failure: pg-boss retries with exponential backoff (1m, 5m, 25m), 3 retries max
  - After 3 failures: `bars_backfill_status` → `failed`, emit `backfill_failed` SSE event
- [x] Job deduplication: use pg-boss `singletonKey` on ticker to prevent duplicate jobs

### SSE Event Types

- [x] Add event types to `libs/shared-types/src/events.ts`:
  - `BackfillStartedEvent { type: "backfill_started"; ticker: string; }`
  - `BackfillCompleteEvent { type: "backfill_complete"; ticker: string; barsCount: number; dividendsCount: number; }`
  - `BackfillFailedEvent { type: "backfill_failed"; ticker: string; reason: string; retriesExhausted: boolean; }`
  - Add all three to the `SSEEvent` discriminated union

### Trigger Hooks

- [x] Wire user selection trigger in `replaceManualSelections` (existing TODO at `postgres.ts:2353`)
  - After computing `newTickers`, check `users.is_demo` — skip if demo user
  - For each new ticker: enqueue pg-boss job with `singletonKey: ticker`, `priority: 0`
  - Job payload: `{ ticker, userId, trigger: 'user_selection' }`
- [x] Wire first-trade trigger in the trade creation pipeline
  - After successful trade creation, check if ticker exists in `market_data.instruments`
  - If ticker not in instruments → skip (silent, no backfill — option B)
  - If ticker in instruments and `bars_backfill_status != 'ready'` → check `is_demo`, enqueue backfill
  - Job payload: `{ ticker, userId, trigger: 'first_trade' }`

### Retry Button (Settings UI)

- [x] Add `POST /backfill/retry` Fastify endpoint
  - Body: `{ ticker: string }`
  - Authed via `resolveUserId`, check `is_demo` guard
  - Validate ticker exists in `market_data.instruments` and `bars_backfill_status = 'failed'`
  - Reset `bars_backfill_status` → `pending`
  - Enqueue new pg-boss job (singletonKey prevents duplicates if somehow already queued)
- [x] Add retry button to `MonitoredTickersSection.tsx`
  - Visible only on tickers with `barsBackfillStatus = 'failed'`
  - Calls `POST /backfill/retry`, optimistically updates badge to `pending`

### Frontend SSE Integration

- [x] Add backfill event handlers in settings page (or AppShell)
  - Listen for `backfill_started` → update ticker badge to `backfilling`
  - Listen for `backfill_complete` → update ticker badge to `ready`
  - Listen for `backfill_failed` → update ticker badge to `failed`
  - Follows existing `useEventStream` pattern with `enabled: true` (pre-connect)

### Demo Guard

- [x] All enqueue paths (user selection, first trade, retry button) check `users.is_demo`
  - Demo users: no FinMind calls, no jobs enqueued
  - Seed data should have `bars_backfill_status = 'ready'` for demo instruments

## Explicit Out of Scope

- Daily refresh worker / cron scheduling → KZO-130
- Instrument catalog sync from FinMind → KZO-83
- Instrument catalog as transaction ticker picker → KZO-129
- `lots.ticker` FK to `instruments.ticker`
- Per-bar `verification_status` on `daily_bars`
- Multi-user SSE notifications for shared backfills (phase 1: only triggering user notified)

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Queue technology | pg-boss | Postgres-based, no new infra, built-in priority/retry/cron/SKIP LOCKED |
| Backfill content | Bars + dividends | Same trigger, marginal +1 API call, avoids duplicate pipeline |
| Rate limit vs failure | Separate handling | Rate limit → reschedule (startAfter), failure → retry counter |
| Worker concurrency | Sequential (1 job) | Simple rate limit accounting, 300 symbols/hr capacity is sufficient |
| Job deduplication | singletonKey on ticker | Prevents duplicate FinMind calls from concurrent triggers |
| First trade edge case | Skip if not in catalog | Safe default until KZO-129 constrains tickers to catalog |
| Retry UX | Dedicated button + endpoint | Better than remove-and-re-add; POST /backfill/retry |
| Dividend fetch failure | Log warning, don't fail | Bars are critical path; dividends supplementary |

## Known Limitations (Phase 1)

- Rate limiter resets on server restart (in-memory)
- Only triggering user gets SSE events for shared symbols
- First trade trigger skips tickers not in instrument catalog

## References

- KZO-122 ADR: `docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md`
- KZO-123 scope todo: `docs/004-notes/kzo-123/scope-todo-202603290530-monitored-symbols.md`
- KZO-123 hook point: `apps/api/src/persistence/postgres.ts:2353`
- SSE infrastructure: `apps/api/src/events/buffered.ts`, `apps/api/src/routes/sseRoute.ts`
- Event types: `libs/shared-types/src/events.ts`
- Settings UI: `apps/web/features/settings/components/MonitoredTickersSection.tsx`
- Existing mock providers: `apps/api/src/providers/marketData.ts`
- FinMind API docs: `https://finmind.github.io/llms-full.txt`
- Follow-up tickets: KZO-129 (ticker picker), KZO-130 (daily refresh worker)
