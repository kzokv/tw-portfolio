# Replay / Recompute Position History Invariants

Any function that replays or recomputes accounting state (like `replayPositionHistory`) must satisfy all four invariants below. All are exercised by `apps/api/src/services/replayPositionHistory.ts`.

## 1. Never use saveStore for scoped replay

`saveStore` uses a full-replace strategy: it deletes ALL trade events for a user and re-inserts everything. Any async recompute function must use targeted persistence methods (`deleteLotsForAccountSymbol`, `bulkUpsertLots`, etc.) scoped to the affected `account_id + symbol` pair.

## 2. ORDER BY trade_date ASC, booking_sequence ASC

The FIFO lot allocation in `orderLots` sorts by `openedAt` (→ `tradeDate`), then `openedSequence` (→ `bookingSequence`), then `id`. The replay must feed trades in the same deterministic order. **Never sort by `booked_at` or `trade_timestamp` in replay-path queries.** The DB index `idx_trade_events_account_symbol_booking_order` supports this ordering.

## 3. Catch and enrich allocateSellLots errors

`allocateSellLots` throws a plain `Error("Insufficient quantity to sell")` with no trade context. The replay must catch this and enrich the error with trade date, symbol, and shortfall quantity for the `recompute_failed` SSE payload.

## 4. Filter zero-amount cash ledger entries

`cash_ledger_entries` has a `CHECK (amount <> 0)` constraint. A BUY at `price=0` (e.g., stock transfers) produces zero-amount settlement entries. The replay must filter these out before calling `bulkInsertCashLedgerEntries` to avoid constraint violations.

**Why:** Discovered during KZO-114 implementation. Violations of invariants 1–4 produce silent data corruption, constraint errors, or incorrect lot allocation — all hard to debug post-facto.

**How to apply:** When writing any new replay or recompute function. Checklist before submitting PR: all four invariants explicitly handled?
