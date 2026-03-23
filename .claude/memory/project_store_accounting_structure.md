---
name: Store accounting data structure
description: Trade events live at store.accounting.facts.tradeEvents, not store.transactions. BookedTradeEvent requires userId field.
type: project
---

Trade events are stored at `store.accounting.facts.tradeEvents` (not `store.transactions`).

The `BookedTradeEvent` type requires a `userId` field — this is not shown in some design doc sketches.

**Why:** Multiple design docs and implementation sketches reference `store.transactions` which doesn't exist. This causes confusion during implementation.

**How to apply:** When writing code that reads or seeds trade event data, always use `store.accounting.facts.tradeEvents` and include `userId` in `BookedTradeEvent` objects.
