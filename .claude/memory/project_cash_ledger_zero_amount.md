---
name: cash_ledger_entries CHECK (amount <> 0) — replay must skip zero-amount entries
description: cash_ledger_entries has CHECK constraint rejecting zero amounts — replay must filter out zero-amount settlement entries
type: project
---

`cash_ledger_entries` has `CHECK (amount_ntd <> 0)` (renamed to `amount` in migration 009). A BUY at `price = 0` would produce a zero-amount settlement entry during replay. The replay must skip inserting zero-amount entries to avoid CHECK violations.

**Why:** KZO-114 architect analysis. Price 0 is possible for stock transfers. Without this guard, the bulk insert of regenerated cash entries will fail with a constraint violation on edge-case data.

**How to apply:** In `bulkInsertCashLedgerEntries` or in the replay loop before calling it, filter out entries where `amount === 0`.
