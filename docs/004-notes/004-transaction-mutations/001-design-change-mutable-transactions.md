# Design Change: Mutable Transactions for Phase 1

Date: 2026-03-23

## Decision

Phase 1 transactions are **mutable** (editable + deletable) rather than append-only with reversal-based corrections.

## Previous model (KZO-51)

Posted facts are append-oriented. Corrections use `reversal + replacement` — never in-place edits. The reversal model was implemented as part of KZO-51.

## New model (phase 1)

Transactions support:

- **Hard DELETE** — row removed from database, associated downstream rows (CashLedgerEntry, TradeFeePolicySnapshot) cascade-deleted, full history replay for affected account+symbol
- **PATCH edit** — partial update of any trade field (date, symbol, quantity, price, side), full history replay for affected account+symbol

Negative lots are **allowed** — the UI warns the user but does not block the operation.

## Motivation

Two primary use cases drove this change:

1. **Test data cleanup** — remove test/garbage transactions cleanly without residual reversal entries
2. **Correcting input mistakes** — user entered wrong values and wants to fix (edit) or remove (delete) like an undo

The reversal model adds complexity (reversal chain, correction linkage, `originalTradeId` / `reversalOf` foreign keys, UI filtering of reversed entries) that is not justified for a personal bookkeeping tool in phase 1.

## Cascade recompute

Both edit and delete trigger a **full history replay** from the earliest affected trade date forward for the account+symbol:

- Recalculate weighted-average lot cost
- Recalculate fee/tax amounts
- Rebuild cash ledger entries
- Recalculate realized PnL on sells
- Rebuild portfolio snapshots

Recompute runs **asynchronously** — the API returns 202 immediately and publishes a `recompute_complete` event via SSE (Server-Sent Events) when done.

## UX

- **Delete**: Confirmation dialog per transaction. Warns if deletion would produce negative lots.
- **Edit**: Full inline edit of all trade fields in transaction list/detail view.
- **Feedback**: Toast on action trigger ("Transaction deleted. Recomputing portfolio...") + loading skeleton on holdings/portfolio until SSE event fires.

## KZO-51 disposition

The existing reversal-based correction code from KZO-51 is **deferred, not cancelled**. The disposition of that code (keep intact alongside edit/delete, or remove) will be decided during KZO-114 implementation.

## Related tickets

- [KZO-113](https://linear.app/kzokv/issue/KZO-113) — SSE infrastructure (prerequisite)
- [KZO-114](https://linear.app/kzokv/issue/KZO-114) — Transaction edit/delete implementation

## Related docs

- SSE infrastructure debate: `docs/004-notes/sse-infrastructure-debate.md`
- Original correction spec (KZO-51): `docs/004-notes/002-accounting/`
