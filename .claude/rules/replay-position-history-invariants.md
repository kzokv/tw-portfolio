# Replay / Recompute Position History Invariants

Any function that replays or recomputes accounting state (like `replayPositionHistory`) must satisfy all five invariants below. All are exercised by `apps/api/src/services/replayPositionHistory.ts`.

## 1. Never use saveStore for scoped replay

`saveStore` uses a full-replace strategy: it deletes ALL trade events for a user and re-inserts everything. Any async recompute function must use targeted persistence methods (`deleteLotsForAccountSymbol`, `bulkUpsertLots`, etc.) scoped to the affected `account_id + symbol` pair.

## 2. ORDER BY trade_date ASC, booking_sequence ASC

The FIFO lot allocation in `orderLots` sorts by `openedAt` (→ `tradeDate`), then `openedSequence` (→ `bookingSequence`), then `id`. The replay must feed trades in the same deterministic order. **Never sort by `booked_at` or `trade_timestamp` in replay-path queries.** The DB index `idx_trade_events_account_symbol_booking_order` supports this ordering.

## 3. Catch and enrich allocateSellLots errors

`allocateSellLots` throws a plain `Error("Insufficient quantity to sell")` with no trade context. The replay must catch this and enrich the error with trade date, symbol, and shortfall quantity for the `recompute_failed` SSE payload.

## 4. Filter zero-amount cash ledger entries

`cash_ledger_entries` has a `CHECK (amount <> 0)` constraint. A BUY at `price=0` (e.g., stock transfers) produces zero-amount settlement entries. The replay must filter these out before calling `bulkInsertCashLedgerEntries` to avoid constraint violations.

## 5. Recompute dividend ledger entries for the affected (account, ticker)

After rebuilding lots / allocations / cash entries, the replay must recompute every non-superseded, non-reversed `dividend_ledger_entries` row for the affected `(account_id, ticker)` pair. The authoritative stored values must match `deriveEligibleQuantity` at each entry's `ex_dividend_date`.

**Rule B (auto-reopen)**: When `expected_cash_amount`, `expected_stock_quantity`, or `eligible_quantity` actually change:
- Bump `version`
- If current `reconciliation_status` is `matched` or `explained`, reset to `open`
- **Preserve `reconciliation_note`** even across `explained` → `open` transitions (the user can reuse it when re-reconciling)
- Emit `dividend_reconciliation_changed` SSE when reconciliation was reset; otherwise emit `dividend_updated`

**No-op guard**: If recompute produces the *exact same* expected values, skip the UPDATE entirely — do not bump version, do not touch reconciliation. Protects matched rows from spurious re-review prompts.

**Startup backfill exception**: `recomputeAllDividendLedgerEntries()` called on app startup runs with `resetReconciliation: false` to avoid silently flipping previously-matched rows to pending-review on every deploy. Only runtime trade mutations reset.

Canonical reference: `planDividendLedgerRecompute` and `applyDividendLedgerRecompute` in `apps/api/src/services/dividends.ts` + `apps/api/src/persistence/{memory,postgres}.ts`.

**Why:** Discovered during KZO-114 implementation (invariants 1–4). Invariant 5 added in KZO-37: users who retroactively enter a forgotten trade were seeing stale `expected_cash_amount` on posted dividend rows — the variance calculation was meaningless until a manual edit triggered replay. Violating invariant 5 reintroduces this class of bug.

**How to apply:** When writing any new replay or recompute function. Checklist before submitting PR: all five invariants explicitly handled?

---

## Companion: wallet generator inherits invariants 3 + 4 by analogy (KZO-166)

`apps/api/src/services/currencyWalletSnapshotGeneration.ts` is **not** a replay function — it is a per-user wallet snapshot writer that consumes pre-stamped cash-ledger entries and emits one `currency_wallet_snapshots` row per `(account_id, currency, date-with-activity)`. Per scope-todo D15, it inherits two of the five invariants by analogy:

- **Invariant 3 (typed-error enrichment):** `applyEntryToWalletState` throws `InsufficientWalletBalanceError` and `MissingFxRateError` (both extend `WalletAccountingError`) with structured `details` fields (`accountId, currency, available, requested, entryDate, fxRateToUsd` / `base, quote, asOfDate`). Generator does not wrap these in a generic try/catch — they propagate unwrapped to the caller. Per `.claude/rules/typed-transient-error-catch-audit.md`, any future inner try/catch added to the generator MUST re-throw `WalletAccountingError` first.

- **Invariant 4 (zero-amount filter):** Already enforced at the schema layer by `cash_ledger_entries.amount <> 0` CHECK constraint. The wallet generator does not need to filter zero-amount entries inline because the constraint guarantees their absence.

Invariants 1 (no `saveStore`), 2 (`ORDER BY trade_date ASC, booking_sequence ASC`), and 5 (dividend ledger recompute) are **not applicable** — there is no replay function added; aggregation is order-independent for `balance_native` (REVERSAL pairs sum to zero) and the WAC walker sorts by `(entry_date ASC, booked_at ASC, id ASC)` which is the load-bearing axis for determinism.

**How to apply:** Do NOT promote this file to a generic "replay invariants" doc. The five invariants are still about position-history replay. The wallet generator is a distinct write path that mirrors only invariants 3 + 4. If a future ticket adds a new replay-class function, that function inherits all five invariants — the wallet-generator note should NOT be its template.

Reference: `apps/api/src/services/currencyWalletAccounting.ts` and `apps/api/src/services/currencyWalletSnapshotGeneration.ts`.
