---
name: project_replay_invariants
description: Four invariants for replayPositionHistory — scoped methods, ORDER BY, allocateSellLots catch, zero-amount guard
type: project
---

Four invariants discovered during KZO-114 implementation that any replay/recompute function must respect:

## 1. Never use saveStore for scoped replay

`saveStore` uses a full-replace strategy: deletes ALL trade events for a user and re-inserts everything. Any async recompute function must use targeted persistence methods (`deleteLotsForAccountSymbol`, `bulkUpsertLots`, etc.) scoped to the affected account+symbol pair.

## 2. ORDER BY trade_date ASC, booking_sequence ASC

The FIFO lot allocation in `orderLots` sorts by `openedAt` (→ `tradeDate`), then `openedSequence` (→ `bookingSequence`), then `id`. The replay must feed trades in the same deterministic order. Never sort by `booked_at` or `trade_timestamp` in replay-path queries. The DB index `idx_trade_events_account_symbol_booking_order` supports this ordering.

## 3. Catch and enrich allocateSellLots errors

`allocateSellLots` throws plain `Error("Insufficient quantity to sell")` with no trade context. The replay must catch this and enrich with trade date, symbol, and shortfall quantity for the `recompute_failed` SSE payload.

## 4. Filter zero-amount cash ledger entries

`cash_ledger_entries` has `CHECK (amount <> 0)`. A BUY at price=0 (e.g., stock transfers) produces zero-amount settlement entries. The replay must filter these out before `bulkInsertCashLedgerEntries` to avoid constraint violations.

**How to apply:** When writing any function that replays or recomputes accounting state. All four are exercised by `replayPositionHistory` in `apps/api/src/services/replayPositionHistory.ts`.
