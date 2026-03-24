---
slug: kzo-114
source: scope-grill
created: 2026-03-24
tickets: [KZO-114]
required_reading:
  - docs/004-notes/kzo-114/scope-todo-202603241600-transaction-mutations.md
  - .worklog/scopes/kzo-114/debate-brief.md
  - .worklog/scopes/kzo-114/debate-result.md
  - docs/004-notes/004-transaction-mutations/001-design-change-mutable-transactions.md
  - docs/004-notes/004-transaction-mutations/002-sse-infrastructure-decisions.md
superseded_by: null
---

# Todo: KZO-114 — Transaction Hard Delete + Inline Edit with Async Cascade Recompute

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. The debate brief and result contain critical architectural context (persistence interface gap, lot deletion blocker, fee recalculation requirement) that is not fully captured in the steps below.

## PR 1: Backend Infrastructure

### Database Migration

- [x] Create new migration file adding `ON DELETE CASCADE` to:
  - `cash_ledger_entries.related_trade_event_id` FK
  - `lot_allocations.trade_event_id` FK
  - `trade_events.reversal_of_trade_event_id` FK (self-referential)
- [x] Add `fees_source` column to `trade_events` (`CALCULATED` | `MANUAL`, NOT NULL, default `CALCULATED`)
- [x] Backfill existing rows with `CALCULATED`

### SSE Event Types

- [x] Add `RecomputeFailedEvent` to `libs/shared-types/src/events.ts`:
  - `{ type: "recompute_failed", accountId, symbol, reason, retriesExhausted }`
- [x] Extend `RecomputeCompleteEvent` payload with rich summary:
  - `{ type: "recompute_complete", accountId, symbol, updatedHoldings: { openQuantity, averageCost, totalRealizedPnl, totalCommission, totalTax }, cashBalanceChange, lotsRecalculated, affectedTradeCount }`
- [x] Update `SSEEvent` discriminated union

### Persistence Interface Expansion

- [x] Add scoped methods to `Persistence` interface and `PostgresPersistence`:
  - `deleteTradeEvent(userId, tradeEventId)` → returns `{ accountId, symbol, deletedChildRows }`
  - `updateTradeEvent(userId, tradeEventId, patch)` → returns `{ accountId, symbol }`
  - `deleteLotsForAccountSymbol(userId, accountId, symbol)`
  - `deleteLotAllocationsForAccountSymbol(userId, accountId, symbol)`
  - `deleteTradeCashEntriesForAccountSymbol(userId, accountId, symbol)`
  - `bulkUpsertLots(userId, lots[])`
  - `bulkInsertLotAllocations(userId, allocations[])`
  - `bulkInsertCashLedgerEntries(userId, entries[])`
  - `updateTradeEventDerivedFields(tradeEventId, { commissionAmount, taxAmount, realizedPnlAmount })`
  - `compactBookingSequence(accountId, tradeDate)` — atomic gap-fill
  - `deleteFeePolicySnapshot(snapshotId)`
- [x] Implement corresponding methods in memory persistence (for integration tests)

### Cascade Recompute Function

- [x] Implement `replayPositionHistory(accountId, symbol)` as a new service function (separate from `recompute.ts`):
  1. SELECT all trade_events for account+symbol, ORDER BY `trade_date ASC, booking_sequence ASC` (critical: must match original booking order for FIFO correctness)
  2. DELETE lots for account+symbol
  3. DELETE lot_allocations for account+symbol
  4. DELETE `TRADE_SETTLEMENT_IN/OUT` cash_ledger_entries for account+symbol
  5. Replay each trade in order:
     - Recalculate fees via bound fee profile (update trade if fees changed)
     - BUY: `applyBuyToLots()` → update weighted-average cost
     - SELL: `allocateSellLots()` → derive realized PnL. **Catch "Insufficient quantity" errors, wrap with trade-level context for `recompute_failed` payload**
     - Generate cash_ledger_entry (settlement)
     - Insert lot_allocations
  6. Persist replayed lots, allocations, cash entries, derived fields
  7. Build summary payload for SSE event
- [x] Implement `setImmediate` wrapper with retry logic:
  - First attempt → on failure, publish `recompute_failed` with `retriesExhausted: false`
  - Automatic retry → on success, publish `recompute_complete`; on failure, publish `recompute_failed` with `retriesExhausted: true`

### API Routes

- [x] `DELETE /portfolio/transactions/:tradeEventId`:
  - Authenticate via `resolveUserId`
  - Log child rows before delete (audit)
  - Delete trade event (DB cascade handles cash_ledger, lot_allocations)
  - Explicit delete of orphaned `trade_fee_policy_snapshots` row
  - Return 202 `{ accountId, symbol, deletedTradeEventId, deletedChildRows: { cashLedgerEntries, lotAllocations } }`
  - `setImmediate`: `replayPositionHistory(accountId, symbol)`
- [x] `PATCH /portfolio/transactions/:tradeEventId`:
  - Authenticate via `resolveUserId`
  - Zod validate input (optional fields: `date`, `quantity`, `price`, `side`)
  - If `quantity` or `price` changed AND `fees_source = CALCULATED`: recalculate commission/tax from bound fee profile
  - If `quantity` or `price` changed AND `fees_source = MANUAL`: return `{ requiresFeeConfirmation: true }` — frontend must re-submit with `confirmFeeRecalculation: true` or `keepManualFees: true`
  - Update trade event row
  - If `date` changed: compact old date booking_sequence + assign new sequence (atomic transaction)
  - Return 202 `{ accountId, symbol, updatedTradeEventId, changedFields }`
  - `setImmediate`: `replayPositionHistory(accountId, symbol)`
- [x] `GET /portfolio/transactions/:tradeEventId/preview-impact`:
  - Accept query param `action=delete` or `action=patch&quantity=X&price=X&...`
  - Return `{ affectedRows: { cashLedgerEntries, lotAllocations, feePolicySnapshots }, negativeLots: { wouldOccur, resultingQuantity, symbol } }`
- [x] Use `routeError()` for all error responses (404 not found, 400 validation, 409 conflict)

### Integration Tests (Layer 1 + Layer 2)

- [x] **Domain unit tests** (Layer 1) — golden-path fixtures with hand-calculated expected values:
  - Weighted-average cost after delete (3 buys, delete middle, verify exact average)
  - Realized PnL after delete (buys + sells, delete a buy, verify PnL)
  - Quantity edit — average cost recalculation
  - Price edit — PnL shift on downstream sells
- [x] **Integration tests** (Layer 2) — replay equivalence through database:
  - Book [A, B, C, D, E], delete C, replay → compare to fresh booking of [A, B, D, E] (financial quantities only, not IDs)
  - Book trades, PATCH quantity, replay → compare to fresh booking with modified trade
  - Date reorder: PATCH date so trade moves before/after a sell → verify correct replay
  - Booking sequence compaction: verify gap-free sequences after date change
- [x] **Edge case tests:**
  - Delete-all trades for a symbol → zero lots, zero cash entries, no holding
  - Negative lots: delete a BUY consumed by sells → `recompute_failed` with context
  - BUY→SELL side flip with sufficient lots → correct state
  - BUY→SELL side flip with insufficient lots → `recompute_failed`
  - SELL→BUY side flip → lots increase
  - Zero-amount edge: price=0 BUY → verify cash entry CHECK constraint handling
- [x] **Retry path tests** (integration only, vi.spyOn fault injection):
  - First attempt fails → `recompute_failed` with `retriesExhausted: false`
  - Retry succeeds → `recompute_complete`
  - Both attempts fail → `recompute_failed` with `retriesExhausted: true`
- [x] **Preview endpoint tests:**
  - Delete preview with/without negative lots
  - Patch preview with quantity/price changes

---

## PR 2: Frontend

### useEventStream Hook Extension

- [ ] Extend `useEventStream` to accept `eventTypes: string[]` (array of event types)
- [ ] Register multiple `addEventListener` calls on single EventSource connection
- [ ] Stabilize dependency array (use `JSON.stringify(eventTypes)` or `useMemo`) to avoid reconnection on every render
- [ ] Maintain backward compatibility or update all existing consumers

### Transaction List — Delete Flow

- [ ] Add delete icon button per row in `TransactionHistoryTable`
- [ ] On click: call preview endpoint → show confirmation dialog
- [ ] Confirmation dialog contents:
  - Trade summary (date, symbol, side, quantity, price)
  - Negative lots warning (conditional, from preview)
  - Downstream impact counts (from preview: N cash entries, N lot allocations)
  - Confirm (destructive styling) / Cancel buttons
- [ ] On confirm: call DELETE endpoint → show info toast ("Transaction deleted. Recomputing portfolio...")
- [ ] Scoped loading skeleton on affected symbol's holdings row

### Transaction List — Inline Edit Flow

- [ ] Add edit icon button per row
- [ ] On click: row enters edit mode — all 4 fields (date, quantity, price, side) become editable inputs
- [ ] Explicit Save / Cancel buttons at end of row
- [ ] Extract `EditableTransactionRow` component for per-row state management (6 states: viewing, editing, validating, submitting, recompute-pending, recompute-complete)
- [ ] On save: call preview endpoint for negative lots check → if warning, show confirmation dialog → call PATCH endpoint
- [ ] If `fees_source = MANUAL` and quantity/price changed: show fee recalculation prompt before submitting
- [ ] Show UI hint: "To change symbol or account, delete and re-create the transaction"
- [ ] Handle mobile card view (share state logic with desktop table via extracted component)

### SSE Event Handling + Loading State

- [ ] Subscribe to `recompute_complete` + `recompute_failed` via extended `useEventStream`
- [ ] On `recompute_complete`: clear scoped skeleton, show success toast with summary data (avg cost, PnL), trigger holdings/transactions refetch
- [ ] On `recompute_failed` with `retriesExhausted: false`: show warning toast "Recompute failed, retrying..."
- [ ] On `recompute_failed` with `retriesExhausted: true`: show error toast with guidance "Recompute failed. Try editing/deleting again, or refresh the page."
- [ ] On timeout (`NEXT_PUBLIC_RECOMPUTE_TIMEOUT_MS`, default 30s): show warning toast "Recompute is taking longer than expected. Refresh to check status."

### E2E Tests (Layer 3)

- [ ] **Delete flow**: click delete → preview dialog → confirm → toast → scoped loading → skeleton clears on SSE → verify updated holdings numbers
- [ ] **Edit flow**: click edit → modify fields → save → toast → scoped loading → skeleton clears → verify updated numbers
- [ ] **Negative lots warning**: set up trades where delete produces negative lots → verify warning appears in dialog
- [ ] **BUY→SELL side flip**: verify correct/error state displayed
- [ ] **Weighted-average cost correctness**: book known trades, delete one, verify displayed average cost matches hand-calculated value
- [ ] Use DOM-based assertions for SSE waiting (wait for toast appearance / skeleton disappearance)
- [ ] Use configurable timeout (`NEXT_PUBLIC_RECOMPUTE_TIMEOUT_MS=3000`) for timeout tests

---

## Open Items

- [x] Create follow-up ticket: Portfolio snapshots recompute (deferred from KZO-114) → **KZO-115**

## References

- Scope debate brief: `.worklog/scopes/kzo-114/debate-brief.md`
- Scope debate result: `.worklog/scopes/kzo-114/debate-result.md`
- Design doc: `docs/004-notes/004-transaction-mutations/001-design-change-mutable-transactions.md`
- SSE decisions: `docs/004-notes/004-transaction-mutations/002-sse-infrastructure-decisions.md`
- Linear ticket: [KZO-114](https://linear.app/kzokv/issue/KZO-114)
