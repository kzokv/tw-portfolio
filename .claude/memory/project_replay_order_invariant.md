---
name: replayPositionHistory ORDER BY invariant
description: replayPositionHistory must ORDER BY trade_date ASC, booking_sequence ASC — not booked_at or trade_timestamp
type: project
---

The FIFO lot allocation in `orderLots` sorts by `openedAt` (mapped from `tradeDate`), then `openedSequence` (mapped from `bookingSequence`), then `id`. The replay must feed trades in the same deterministic order or weighted-average costs and FIFO allocations will diverge from the original booking.

**Why:** Discovered in KZO-114 debate. Using `booked_at` or `trade_timestamp` would produce a different order and break the replay equivalence invariant. The DB index `idx_trade_events_account_symbol_booking_order` supports this ordering.

**How to apply:** Any `SELECT` in `getTradeEventsForAccountSymbol` must include `ORDER BY trade_date ASC, booking_sequence ASC`. Never sort by `booked_at` or `trade_timestamp` in replay-path queries.
