---
slug: kzo-114-pr1
type: implementation-notes
created: 2026-03-24T18:00:00
tickets: [KZO-114]
wave: 1
pr: 1
status: merged
---

# Implementation Notes: KZO-114 PR 1 — Backend Infrastructure

> **Frozen snapshot.** Records what was built and why. Do not update after merge.
>
> Related artifacts:
> - Scope todo: `docs/004-notes/kzo-114/scope-todo-202603241600-transaction-mutations.md`
> - Technical design: `.worklog/team/technical-design.md`
> - Debate result: `.worklog/scopes/kzo-114/debate-result.md`

---

## 1. What Was Built

PR 1 delivers the complete backend infrastructure for transaction mutations. No frontend changes are included.

### 1a. Database Migration (`db/migrations/016_transaction_mutations.sql`)

**ON DELETE CASCADE on 4 FKs referencing `trade_events(id)`:**

| Table | Column | Change |
|---|---|---|
| `cash_ledger_entries` | `related_trade_event_id` | Added `ON DELETE CASCADE` |
| `lot_allocations` | `trade_event_id` | Added `ON DELETE CASCADE` |
| `trade_events` | `reversal_of_trade_event_id` | Added `ON DELETE CASCADE` (self-referential) |
| `recompute_job_items` | `trade_event_id` | Added `ON DELETE CASCADE` |

All four FKs were created without explicit constraint names (inline `REFERENCES` syntax). The migration uses a `DO $$ ... pg_constraint` dynamic lookup to find the constraint name before dropping. PostgreSQL does not support `ALTER CONSTRAINT ... ADD CASCADE` — the only path is DROP + re-ADD.

The `recompute_job_items` FK block is additionally guarded with a column-existence check (`trade_event_id` is added by migration `010`) to handle partial migration scenarios on legacy databases.

**`fees_source` column added to `trade_events`:**

```sql
ALTER TABLE trade_events
  ADD COLUMN IF NOT EXISTS fees_source TEXT NOT NULL DEFAULT 'CALCULATED'
  CHECK (fees_source IN ('CALCULATED', 'MANUAL'));
```

`CALCULATED` is the default; backfills all existing rows automatically. `MANUAL` is set when a user explicitly supplies commission/tax values and expects them to be preserved across edits.

**`db/migrations/baseline_current_schema.sql` also updated** to include `fees_source` in the `CREATE TABLE trade_events` statement for fresh-database installs.

---

### 1b. SSE Event Types (`libs/shared-types/src/events.ts`)

**`RecomputeCompleteEvent`** — enriched with a holdings summary:

```ts
interface RecomputeCompleteEvent {
  type: "recompute_complete";
  accountId: string;
  symbol: string;
  updatedHoldings: {
    openQuantity: number;
    averageCost: number;
    totalRealizedPnl: number;
    totalCommission: number;
    totalTax: number;
  };
  cashBalanceChange: number;
  lotsRecalculated: number;
  affectedTradeCount: number;
}
```

**`RecomputeFailedEvent`** — new event type:

```ts
interface RecomputeFailedEvent {
  type: "recompute_failed";
  accountId: string;
  symbol: string;
  reason: string;
  retriesExhausted: boolean;
}
```

`SSEEvent` discriminated union and `SSEDomainEventType` updated accordingly.

---

### 1c. Persistence Interface Expansion (`apps/api/src/persistence/types.ts`)

11 new scoped methods added to `Persistence`, `PostgresPersistence`, and `MemoryPersistence`:

| Method | Purpose |
|---|---|
| `getTradeEvent(userId, tradeEventId)` | Single-row load for route ownership checks |
| `deleteTradeEvent(userId, tradeEventId)` | Hard delete with child-row count return |
| `updateTradeEvent(userId, tradeEventId, patch)` | Field patch, includes booking-sequence compaction |
| `getTradeEventsForAccountSymbol(userId, accountId, symbol)` | Ordered load for replay |
| `deleteLotsForAccountSymbol(userId, accountId, symbol)` | Replay cleanup phase |
| `deleteLotAllocationsForAccountSymbol(userId, accountId, symbol)` | Replay cleanup phase |
| `deleteTradeCashEntriesForAccountSymbol(userId, accountId, symbol)` | Replay cleanup (TRADE_SETTLEMENT_IN/OUT only) |
| `bulkUpsertLots(userId, lots[])` | Replay write phase |
| `bulkInsertLotAllocations(userId, allocations[])` | Replay write phase |
| `bulkInsertCashLedgerEntries(userId, entries[])` | Replay write phase |
| `updateTradeEventDerivedFields(tradeEventId, fields)` | Not used in final implementation (dead code removed — see §4) |

**`TradeEventPatch` and `DeleteTradeEventResult` types** added.

The critical design constraint: these methods are all **scoped to account+symbol** and do NOT touch other account+symbol pairs. `saveStore` (the existing full-replace path) is explicitly not used by the mutation paths — see §2.1.

---

### 1d. Cascade Recompute Service (`apps/api/src/services/replayPositionHistory.ts`)

**New file.** Two exports:

**`replayPositionHistory(persistence, userId, accountId, symbol)`**

7-phase operation:
1. Load all trade events for account+symbol: `ORDER BY trade_date ASC, booking_sequence ASC`
2. Delete lots for account+symbol
3. Delete lot allocations for account+symbol
4. Delete `TRADE_SETTLEMENT_IN/OUT` cash entries for account+symbol
5. Replay each trade in order:
   - BUY: call `applyBuyToLots`, build cash entry
   - SELL: call `allocateSellLots` (FIFO), derive realized PnL from allocations, build cash entry; catch `ReplayError` for negative-lots failures
   - Skip zero-amount cash entries (CHECK constraint guard)
6. Persist: `bulkUpsertLots`, `bulkInsertLotAllocations`, `bulkInsertCashLedgerEntries`
7. Return `ReplaySummary` (aggregated holdings, PnL, counts)

**Replay does NOT recalculate fees.** It uses whatever `commissionAmount` and `taxAmount` are stored on the trade event. Fee recalculation is the responsibility of the PATCH handler when quantity or price changes.

**`scheduleReplayWithRetry(persistence, eventBus, userId, accountId, symbol)`**

Wraps replay in `setImmediate` with one automatic retry:
- First attempt success → publish `recompute_complete`
- First attempt failure → publish `recompute_failed` with `retriesExhausted: false`, schedule retry via second `setImmediate`
- Retry success → publish `recompute_complete`
- Retry failure → publish `recompute_failed` with `retriesExhausted: true`

**`ReplayError`** — custom error class carrying `failedTradeEventId`. Thrown by `replayPositionHistory` when `allocateSellLots` raises "Insufficient quantity to sell" (e.g., user deleted a BUY that preceded SELLs). Wraps the raw lot error with trade context (ID, date, type, quantity, symbol).

---

### 1e. API Routes (added to `apps/api/src/routes/registerRoutes.ts`)

Three new routes in the `// --- Transaction Mutation Routes (KZO-114) ---` block:

**`DELETE /portfolio/transactions/:tradeEventId`**
- Validates path param
- Calls `getTradeEvent` for ownership check (→ 404 if not found)
- Logs pre-delete audit context (accountId, symbol, type, quantity)
- Calls `deleteTradeEvent` (DB CASCADE removes child rows)
- Fires `scheduleReplayWithRetry` in setImmediate
- Returns `202 { accountId, symbol, deletedTradeEventId, deletedChildRows: { cashLedgerEntries, lotAllocations } }`

Note: `trade_fee_policy_snapshots` is orphaned by the delete (the FK direction is trade_events → snapshots; CASCADE doesn't apply in this direction). The snapshot is not deleted. This is an accepted trade-off for PR 1.

**`PATCH /portfolio/transactions/:tradeEventId`**
- Validates body with `patchTransactionSchema` (at least one of: `date`, `quantity`, `price`, `side`)
- Calls `getTradeEvent` for ownership check
- Builds diff-only patch (only includes fields that actually changed)
- If `quantity` or `price` changed and `fees_source === 'CALCULATED'`: recalculates commission/tax using the **stored fee snapshot** from original booking time
- If `fees_source === 'MANUAL'` and no `confirmFeeRecalculation` or `keepManualFees` flag: returns `200 { requiresFeeConfirmation: true, tradeEventId }` (two-step flow for frontend)
- Calls `updateTradeEvent` (includes booking-sequence compaction if date changed)
- Fires `scheduleReplayWithRetry`
- Returns `202 { accountId, symbol, updatedTradeEventId, changedFields }`

**`GET /portfolio/transactions/:tradeEventId/preview-impact`**
- Query params: `action=delete|patch`, optional `quantity`, `price`, `side`, `date`
- Side-effect free: loads store, counts affected rows, simulates the post-mutation quantity sequence
- Returns `{ affectedRows: { cashLedgerEntries, lotAllocations, feePolicySnapshots: 1 }, negativeLots: { wouldOccur, resultingQuantity, symbol } }`
- `negativeLots.wouldOccur` is determined by walking the sorted trade list and tracking net quantity, removing (delete) or substituting (patch) the target trade

---

### 1f. Integration Tests (`apps/api/test/integration/transaction-mutations.integration.test.ts`)

New file. Uses memory persistence (`PERSISTENCE_BACKEND=memory`) and in-memory EventBus. Test helpers:
- `createTrade(app, overrides)` — POST via app.inject with auto-generated idempotency key
- `getStore(app)` — direct persistence.loadStore for assertions
- `collectBusEvents(app, userId)` — subscribes to EventBus and returns events + `waitFor(type, timeoutMs)` helper

Test coverage:
- DELETE golden path: book 3 trades, delete middle, verify replay equivalence to fresh-booking of remaining 2 (quantities, costs, cash entries — not IDs)
- PATCH quantity: change quantity, verify fee recalculation and replay
- PATCH date reorder: move trade before/after a SELL, verify correct FIFO replay
- Booking sequence compaction: verify gap-free sequences after date change
- Delete-all trades: zero position result
- Negative lots: delete BUY preceding SELL → `recompute_failed` event
- Side flip BUY→SELL with sufficient lots: correct replay
- Side flip BUY→SELL with insufficient lots: `recompute_failed`
- Preview endpoint: affected-row counts, negative-lots detection
- Retry path: `vi.spyOn` fault injection on first call → `recompute_failed` (retriesExhausted: false) → retry success → `recompute_complete`

---

### 1g. E2E Stabilization (`apps/web/tests/e2e/`)

Four E2E files modified for E2E stability (tracked as KZO-116, merged together with KZO-114 PR 1):
- `helpers/flows.ts` — `waitForAppReady()` now uses soft-wait pattern: `page.waitForLoadState("load", { timeout: 5000 }).catch(() => {})`
- `specs/auth-oauth.spec.ts`, `specs/portfolio-transactions.spec.ts`, `specs/shell-navigation.spec.ts` — test-stabilization adjustments

These changes do not add new E2E tests for the mutation routes. KZO-114 E2E tests (delete/edit UI flows) are in scope for PR 2.

---

## 2. Key Architectural Decisions

### 2.1. `saveStore` Full-Replace Problem

**Decision:** All replay/mutation persistence uses new scoped methods, not `saveStore`.

The existing `saveStore` deletes ALL trade events, lots, cash entries, and fee snapshots for the entire user, then re-inserts everything from the in-memory store. Any async recompute function cannot call `saveStore` because:
1. It would destroy accounting data for ALL symbols of the user, not just the affected account+symbol
2. The load-mutate-save cycle has a TOCTOU race: a concurrent request could modify the store between the async load and save
3. The 202 response has already returned — the async replay runs outside any request context that would hold the store

**Resolved by:** 11 new targeted persistence methods that only touch the affected (accountId, symbol) pair.

---

### 2.2. Realized PnL is Derived, Not Stored

**Decision:** `replayPositionHistory` does NOT persist realized PnL per trade. The `recompute_complete` SSE payload includes a `totalRealizedPnl` summary value but this is not written back to `trade_events`.

`realized_pnl_amount` does not exist as a column on `trade_events`. It is derived at read-time by `syncTradeEventRealizedPnl()` in `loadStore`, which reads lot allocations and calls `deriveRealizedPnlForTrade()`. After replay regenerates lot allocations, the next `loadStore` call will automatically derive correct realized PnL values. No extra write step is needed.

The `updateTradeEventDerivedFields` method was added to the interface during design but was not used in the final implementation (see §4, dead code).

---

### 2.3. Fee Recalculation: PATCH Handler vs Replay

**Decision:** Fee recalculation only happens in the PATCH route handler. The replay uses the trade event's stored `commissionAmount` and `taxAmount` as-is.

When `quantity` or `price` changes in a PATCH:
- Fees are recalculated using the **stored fee snapshot** (`trade.feeSnapshot`) from the original booking time — the same profile values that were used when the trade was first posted
- The computed `commissionAmount` and `taxAmount` are written to the trade event row before replay starts
- This ensures the replay produces financially correct cash entries (settlement = quantity × price ± commission ± tax)

The fee policy snapshot row (`trade_fee_policy_snapshots`) is NOT modified — it records the profile state at booking time and is kept as an audit record regardless of edits.

The `fees_source` column tracks this: `CALCULATED` means fees were auto-derived and will be recalculated on any quantity/price PATCH; `MANUAL` means the user explicitly set fees and the PATCH handler requires a confirmation flag before recalculating.

---

### 2.4. Replay Ordering Invariant

**Decision:** `getTradeEventsForAccountSymbol` orders by `trade_date ASC, booking_sequence ASC` — not by `booked_at` or `trade_timestamp`.

The FIFO lot allocation (`allocateSellLots` via `orderLots` in `lot.ts`) sorts lots by `openedAt` (mapped from `tradeDate`), then `openedSequence` (mapped from `bookingSequence`), then `id`. The replay must process trades in this same order for the results to match the original booking.

The database index `idx_trade_events_account_symbol_booking_order` covers `(account_id, symbol, trade_date, booking_sequence, ...)` which supports this query ordering efficiently.

---

### 2.5. Booking Sequence Compaction Atomicity

**Decision:** When a PATCH changes `trade_date`, both the old date's sequence compaction and the new date's sequence assignment happen inside a single `BEGIN...COMMIT` block within `updateTradeEvent` in `postgres.ts`.

If the compaction ran outside the PATCH transaction, a concurrent `createTransaction` call could allocate a sequence number on the old date before the gap was filled, causing booking sequence collisions or incorrect ordering on the affected date.

The `compactBookingSequence` SQL uses a window function (`ROW_NUMBER() OVER (ORDER BY booking_sequence)`) to assign gap-free sequences in a single UPDATE. Only rows where the new sequence differs from the old one are updated.

---

### 2.6. Replay Must Also Delete Lots (Blocker from Debate)

**Decision:** `replayPositionHistory` deletes lots for account+symbol before replaying, not just lot_allocations and cash entries.

The original scope pseudocode only specified deleting lot_allocations and TRADE_SETTLEMENT_IN/OUT cash entries. The lots table is the position state. Without clearing it first, BUY trades in the replay apply on top of the existing lots, producing incorrect weighted-average costs.

This was the critical blocker surfaced during the KZO-114 debate by the Data Integrity Specialist and confirmed by the Backend Architect.

---

### 2.7. Zero-Amount Cash Entry Guard

**Decision:** `replayPositionHistory` skips inserting cash ledger entries where `amount === 0`.

`cash_ledger_entries` has a `CHECK (amount <> 0)` constraint (from migration `009`). A BUY at `price = 0` produces a zero-amount settlement entry (`-(0 × quantity + commission + tax)` = 0 if commission and tax are also 0). Attempting to insert would violate the constraint. The replay loop checks `if (settlementAmount !== 0)` before adding to `allCashEntries`.

---

### 2.8. `allocateSellLots` Error Wrapping

**Decision:** `replayPositionHistory` catches `allocateSellLots` errors and re-throws as `ReplayError` with trade context.

`allocateSellLots` throws `new Error("Insufficient quantity to sell")` — a plain Error with no trade ID, date, or shortfall quantity. This raw message is not actionable in a `recompute_failed` SSE payload. The replay wraps it:

```
Replay failed at trade {id} ({type} {quantity}x{symbol} on {date}): {original message}
```

The `ReplayError` class carries `failedTradeEventId` for targeted error display in the frontend (PR 2).

---

### 2.9. Cascade Deletion of Reversal Chain

**Observation (not a blocker for PR 1):** Adding `ON DELETE CASCADE` to `trade_events.reversal_of_trade_event_id` (self-referential) means that deleting a trade event also deletes any trade event that reverses it. The CASCADE then extends to that reversal's own child rows (cash entries, lot allocations). This is correct behavior — deleting the original trade should delete the entire correction chain.

However, if a reversal trade event has its own downstream effects that should be preserved, this could cause unintended data loss. In the current system, no reversals exist in production and the `KZO-51` reversal service code has not been implemented. This is low risk for PR 1 but should be revisited when reversal support is added.

---

## 3. Files Changed (14 Total)

| File | Status | Scope |
|---|---|---|
| `db/migrations/016_transaction_mutations.sql` | New | Migration: CASCADE FKs + fees_source column |
| `db/migrations/baseline_current_schema.sql` | Modified | Fresh-install schema: fees_source column |
| `libs/shared-types/src/events.ts` | Modified | RecomputeCompleteEvent enrichment + RecomputeFailedEvent |
| `apps/api/src/types/store.ts` | Modified | feesSource field on BookedTradeEvent |
| `apps/api/src/persistence/types.ts` | Modified | Persistence interface + TradeEventPatch + DeleteTradeEventResult |
| `apps/api/src/persistence/postgres.ts` | Modified | 11 new persistence method implementations |
| `apps/api/src/persistence/memory.ts` | Modified | 11 new persistence method implementations |
| `apps/api/src/services/replayPositionHistory.ts` | New | replayPositionHistory + scheduleReplayWithRetry + ReplayError |
| `apps/api/src/routes/registerRoutes.ts` | Modified | DELETE + PATCH + GET preview-impact routes |
| `apps/api/test/integration/transaction-mutations.integration.test.ts` | New | Full integration test suite |
| `apps/web/tests/e2e/helpers/flows.ts` | Modified | KZO-116: soft-wait for waitForLoadState |
| `apps/web/tests/e2e/specs/auth-oauth.spec.ts` | Modified | KZO-116: E2E stabilization |
| `apps/web/tests/e2e/specs/portfolio-transactions.spec.ts` | Modified | KZO-116: E2E stabilization |
| `apps/web/tests/e2e/specs/shell-navigation.spec.ts` | Modified | KZO-116: E2E stabilization |

---

## 4. Convergence History

**7 iterations total** before full test suite passed.

### Root Cause Summary

| Iteration | Root Cause | Fix |
|---|---|---|
| 1–2 | FK existence check: migration failed on partial databases where `recompute_job_items.trade_event_id` column didn't exist yet (migration `010` not run) | Wrapped recompute_job_items FK block in `DO $$ IF col_exists THEN` guard |
| 3 | Baseline column ordering: `baseline_current_schema.sql` CREATE TABLE column order for `fees_source` conflicted with migration 016 expectations on fresh-install databases | Added `fees_source` to baseline schema's CREATE TABLE in correct position |
| 4–5 | Golden fixture fee isolation: integration test golden values (exact commission/tax amounts) were sensitive to the default fee profile in test fixtures | Test fixtures decoupled from global state; fee amounts asserted relative to booked values |
| 6 | Dead code removal: `updateTradeEventDerivedFields` was added to the persistence interface during design but never called in the final route implementation | Method removed from interface and all implementations |
| 7 | E2E `waitForLoadState` soft-wait: `waitForAppReady()` in E2E helpers used `waitForLoadState("load")` without timeout, causing non-deterministic test timeouts across the suite when image/font resources were slow to load | Changed to soft-wait pattern: `page.waitForLoadState("load", { timeout: 5000 }).catch(() => {})` |

### Key Discovery: Scope Delta from Design

The technical design initially included `deleteFeePolicySnapshot` as a separate persistence method and route step. In the final implementation:
- `trade_fee_policy_snapshots` rows are **not deleted** when a trade event is deleted
- The FK direction (trade_events → snapshots) means CASCADE cannot help
- Snapshot deletion was deferred: the orphaned snapshot is harmless (never re-read after the trade is gone) and adding the extra delete step was dropped to keep PR 1 scope tight

---

## 5. Scope Items Deferred to PR 2

The following items from `scope-todo-202603241600-transaction-mutations.md` are NOT in PR 1:

- Frontend: `useEventStream` multi-event extension
- Frontend: Transaction list delete flow (icon, confirmation dialog, toast, scoped loading skeleton)
- Frontend: Transaction list inline edit flow (6-state row component, `EditableTransactionRow`)
- Frontend: SSE event handling + loading state for `recompute_complete` / `recompute_failed`
- E2E tests for delete and edit UI flows
- Follow-up ticket: Portfolio snapshots recompute (out of scope entirely)

---

## 6. Open Questions at Merge Time

1. **`trade_fee_policy_snapshots` orphan cleanup** — orphaned snapshot rows accumulate when trades are deleted. No cleanup is implemented in PR 1. Low urgency (rows are small, never queried), but a background cleanup task or FK-direction change could address this in a future ticket.

2. **Reversal chain behavior** — the CASCADE delete on `reversal_of_trade_event_id` will also delete reversal trades. No reversals exist in production now, but `KZO-51` reversal service should revisit this behavior when implemented.

3. **`daily_portfolio_snapshots` stale after recompute** — `replayPositionHistory` does not regenerate daily portfolio snapshots. These are not actively generated by current flows anyway (see `backend-db-api.md` dormant table finding), but they will become stale after transaction mutations when snapshot generation is eventually added.
