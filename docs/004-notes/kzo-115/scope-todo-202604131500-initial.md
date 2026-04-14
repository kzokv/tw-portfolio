---
slug: kzo-115
source: scope-grill
created: 2026-04-13
tickets: [KZO-115]
required_reading:
  - docs/004-notes/kzo-115/scope-todo-202604131500-initial.md
  - docs/004-notes/kzo-114/scope-todo-202603241600-transaction-mutations.md
superseded_by: null
---

# Todo: KZO-115 — Portfolio Snapshots: Generation & Mutation-Triggered Recompute

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. The KZO-114 scope todo contains critical context on the `replayPositionHistory` infrastructure that this ticket builds on.

## Key Design Decisions

- **Per-holding granularity** — new `daily_holding_snapshots` table with `(user_id, account_id, ticker, snapshot_date)` natural key. Portfolio-level aggregates derived at query time via `GROUP BY`.
- **Existing `daily_portfolio_snapshots` table** — left empty, dead code paths cleaned up.
- **Trading days only** — rows written only for dates where `daily_bars` exist. No calendar-day gap filling.
- **Scoped mutation recompute** — only the mutated ticker from affected `trade_date` → today. Other holdings untouched.
- **Execution model** — snapshot recompute runs inside `scheduleReplayWithRetry()`, after `replayPositionHistory()` completes, before `recompute_complete` SSE fires.
- **Fresh position-at-date implementation** — not extracted from `buildSyntheticPerformance`. Independent walker over trade events + `daily_bars`.
- **Zero-quantity positions** — continue writing rows with `quantity=0`, carry forward `cumulative_realized_pnl` and `cumulative_dividends` for accurate portfolio total return aggregation.
- **Missing `daily_bars`** — write provisional rows (`market_value=NULL`, `is_provisional=true`), trigger backfill via `app.boss.send(BACKFILL_QUEUE, ...)`. Auto-fix deferred to follow-up nightly job.
- **On-demand generation** — `POST /portfolio/snapshots/generate` with 202 + SSE (`snapshots_generated` event). Nightly pg-boss job deferred to follow-up.
- **Two chart cards** — (1) amounts chart: cost basis, market value, total return TWD; (2) return % chart: total return percentage. Both share the same API response.
- **NUMERIC precision** — `close_price`, `market_value`, `cost_basis`, `unrealized_pnl`, `cumulative_realized_pnl`, `cumulative_dividends` all use NUMERIC, not INTEGER.

## Implementation Steps

### PR 1: Backend Infrastructure

#### Database

- [ ] Create migration for `daily_holding_snapshots` table:
  - `id TEXT PRIMARY KEY`
  - `user_id TEXT NOT NULL REFERENCES users(id)`
  - `account_id TEXT NOT NULL`
  - `ticker TEXT NOT NULL`
  - `snapshot_date DATE NOT NULL`
  - `quantity NUMERIC NOT NULL`
  - `close_price NUMERIC` (NULL if provisional)
  - `market_value NUMERIC` (NULL if provisional)
  - `cost_basis NUMERIC NOT NULL`
  - `unrealized_pnl NUMERIC` (NULL if provisional)
  - `cumulative_realized_pnl NUMERIC NOT NULL DEFAULT 0`
  - `cumulative_dividends NUMERIC NOT NULL DEFAULT 0`
  - `is_provisional BOOLEAN NOT NULL DEFAULT false`
  - `currency TEXT NOT NULL DEFAULT 'TWD'`
  - `generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
  - `generation_run_id TEXT NOT NULL`
  - Unique constraint: `(user_id, account_id, ticker, snapshot_date)`
  - Indexes: `(user_id, snapshot_date DESC)`, `(user_id, account_id, ticker, snapshot_date)`, `(generation_run_id)`

#### Persistence Layer

- [ ] Add persistence interface methods:
  - `bulkUpsertHoldingSnapshots(userId, snapshots[])` — batch write with ON CONFLICT DO UPDATE
  - `deleteHoldingSnapshotsForTicker(userId, accountId, ticker, fromDate)` — scoped delete for mutation recompute
  - `deleteAllHoldingSnapshots(userId)` — for full regeneration
  - `getAggregatedSnapshots(userId, startDate, endDate)` — `GROUP BY snapshot_date` returning portfolio-level points with total return fields
  - `countHoldingSnapshotsAfterDate(userId, accountId, ticker, fromDate)` — for preview impact
  - `getHoldingSnapshotsForTicker(userId, accountId, ticker, startDate, endDate)` — for per-holding queries
- [ ] Implement in PostgresPersistence
- [ ] Implement in MemoryPersistence (for tests)

#### Snapshot Generation Service

- [ ] Create `apps/api/src/services/snapshotGeneration.ts`:
  - `generateHoldingSnapshots(userId, persistence, options)` — full generation for all (account, ticker) pairs
    - Walk trade events chronologically per (account, ticker)
    - For each trading day (from `daily_bars`), record: quantity, cost_basis, close_price, market_value, unrealized_pnl, cumulative_realized_pnl, cumulative_dividends
    - Handle sells: accumulate realized PnL from cost basis proportional reduction
    - Handle zero-quantity: continue writing rows with cumulative values carried forward
    - Mark provisional when `daily_bars` close price missing; trigger backfill
    - Use `generation_run_id` (one `randomUUID()` per batch)
  - `recomputeSnapshotsForTicker(userId, accountId, ticker, fromDate, persistence)` — scoped recompute after mutation
    - Delete existing rows for (userId, accountId, ticker) from `fromDate` → today
    - Regenerate using same position walker logic
    - Called by `scheduleReplayWithRetry` after `replayPositionHistory` completes

#### Route Integration

- [ ] Wire `recomputeSnapshotsForTicker` into `scheduleReplayWithRetry` — call after `replayPositionHistory()`, before emitting `recompute_complete`
- [ ] Add `POST /portfolio/snapshots/generate` endpoint:
  - 202 response with `{ generationRunId }`
  - `setImmediate` → `generateHoldingSnapshots` → SSE `snapshots_generated` event
  - Detect missing `daily_bars` → trigger backfill via `app.boss.send(BACKFILL_QUEUE, { ticker, trigger: "first_trade", includeBars: true })`
- [ ] Add `snapshots_generated` SSE event type to `libs/shared-types/src/events.ts`:
  - `{ type: "snapshots_generated", totalRows, provisionalRows, dateRange: { from, to }, generationRunId }`
- [ ] Extend preview-impact endpoint response with `affectedRows.holdingSnapshots: number` (count from `countHoldingSnapshotsAfterDate`)

#### Dashboard Performance Refactor

- [ ] Refactor `buildPerformanceFromSnapshots()` in `dashboard.ts`:
  - Replace store-based filtering with call to `persistence.getAggregatedSnapshots(userId, startDate, endDate)`
  - Return points with new fields: `cumulativeRealizedPnlAmount`, `cumulativeDividendsAmount`, `totalReturnAmount`, `totalReturnPercent`
- [ ] Extend `DashboardPerformancePointDto` in `libs/shared-types/src/index.ts`:
  - Add: `cumulativeRealizedPnlAmount?: number`, `cumulativeDividendsAmount?: number`, `totalReturnAmount?: number`, `totalReturnPercent?: number`
- [ ] Update `GET /portfolio/dashboard/performance` route handler to pass persistence to the refactored function

#### Dead Code Cleanup

- [ ] Remove `daily_portfolio_snapshots` loading from `loadStore()` in `postgres.ts`
- [ ] Remove `daily_portfolio_snapshots` saving from `saveAccountingStore()` in `postgres.ts`
- [ ] Remove `DailyPortfolioSnapshot` from `AccountingProjections` interface in `store.ts` (or deprecate)
- [ ] Update `demoCleanup.ts` — replace `daily_portfolio_snapshots` DELETE with `daily_holding_snapshots` DELETE
- [ ] Update MemoryPersistence store shape if needed

#### Tests (Backend)

- [ ] Domain unit tests — snapshot generation logic:
  - Position walker: buy → hold → sell → zero quantity carry-forward
  - Cumulative realized PnL accumulation across sells
  - Cumulative dividends accumulation
  - Provisional row generation when `daily_bars` missing
  - Trading-days-only (no weekend/holiday rows)
- [ ] Integration tests (Postgres-backed):
  - Full generation: multiple tickers, multiple accounts
  - Scoped recompute: edit trade → only affected ticker's snapshots regenerated
  - Aggregate query: `GROUP BY` returns correct portfolio-level sums
  - Zero-quantity rows included in aggregates
  - Idempotent generation (re-run produces same rows)
  - Preview impact includes snapshot count

---

### PR 2: Frontend

#### Generate Snapshots Button

- [ ] Add "Generate Snapshots" button in `ActionCenterSection.tsx` alongside existing recompute button
- [ ] Wire to `POST /portfolio/snapshots/generate` endpoint
- [ ] Handle SSE `snapshots_generated` event — clear loading state, show success toast with summary
- [ ] Loading state: button disabled + spinner while generating

#### Two Chart Cards

- [ ] **Amounts chart card** — extend or create alongside `PortfolioTrendCard`:
  - Three lines: cost basis (gray), market value (indigo), total return amount (new color)
  - Total return = market value + cumulative realized PnL + cumulative dividends - cost basis... actually: `totalReturnAmount` from DTO
  - Handle provisional data points (amber warning, consistent with existing patterns)
- [ ] **Return % chart card** — new component:
  - Single line: total return percentage over time
  - Y-axis: percentage
  - Share range selector state with amounts chart
  - Handle provisional/missing data with amber warning

#### Delete/Edit Preview Update

- [ ] Extend `PreviewImpactResponse` type with `holdingSnapshots: number`
- [ ] Update `DeleteConfirmationDialog.tsx` to show snapshot impact:
  - "N snapshot rows for {ticker} from {date} → today will be recomputed"
- [ ] Update edit confirmation flow similarly

#### SSE Event Handling

- [ ] Add `snapshots_generated` to event type subscriptions
- [ ] On `snapshots_generated` → refetch performance chart data
- [ ] Existing `recompute_complete` handler already triggers `performance.refresh()` — verify it picks up snapshot changes

#### E2E Tests

- [ ] Generate snapshots: click button → loading state → SSE → chart populates with data
- [ ] Transaction edit: edit trade → chart updates with historically-accurate prices
- [ ] Transaction delete: delete trade → chart updates, affected date range changes
- [ ] Provisional data: generate with missing `daily_bars` → amber warning displayed
- [ ] Two chart cards: both render with correct data series
- [ ] Delete preview: snapshot impact count shown in confirmation dialog

---

## Open Items

- [ ] **Follow-up: Nightly pg-boss snapshot job** — scan for provisional snapshots, auto-fix when `daily_bars` available, incremental daily generation. Linked to KZO-133 admin UI.
- [ ] **Follow-up: Dividend posting → snapshot recompute** — wire dividend posting/edit path to trigger snapshot regeneration for affected tickers/dates.
- [ ] **Verify during implementation:** Does `POST /portfolio/corporate-actions` call `scheduleReplayWithRetry`? If yes, snapshots auto-update. If no, note as future gap.

## References

- KZO-114 scope todo: `docs/004-notes/kzo-114/scope-todo-202603241600-transaction-mutations.md`
- Replay service: `apps/api/src/services/replayPositionHistory.ts`
- Dashboard consumer: `apps/api/src/services/dashboard.ts` (`buildPerformanceFromSnapshots`, `buildSyntheticPerformance`)
- Existing snapshot schema: `db/migrations/003_accounting_core_schema.sql` (lines 195-215)
- Daily bars table: `db/migrations/baseline_current_schema.sql` (market_data.daily_bars)
- Backfill interface: `apps/api/src/services/market-data/backfillWorker.ts` (`BackfillJobData`)
- Frontend chart: `apps/web/components/dashboard/PortfolioTrendCard.tsx`
- Frontend preview dialog: `apps/web/components/portfolio/DeleteConfirmationDialog.tsx`
- Frontend SSE handling: `apps/web/features/portfolio/hooks/useTransactionMutations.ts`
