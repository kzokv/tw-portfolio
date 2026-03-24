---
name: project_fk_cascade_alter_pattern
description: PostgreSQL unnamed FKs require dynamic constraint name lookup via pg_constraint to add ON DELETE CASCADE
type: project
---

PostgreSQL does not support `ALTER CONSTRAINT ... ADD CASCADE`. The only way to add CASCADE to an existing FK is DROP + re-ADD with the new definition. For unnamed FKs (created with inline `REFERENCES` syntax), the constraint name must be discovered dynamically via `pg_constraint` using a DO $$ block. Named constraints can be dropped directly.

**Why:** KZO-114 implementation. The FKs on `cash_ledger_entries.related_trade_event_id`, `lot_allocations.trade_event_id`, and `trade_events.reversal_of_trade_event_id` were all created without explicit names.

**How to apply:** When writing future migrations that need to alter FK constraints on tables with unnamed FKs, use the DO $$ block pattern from `db/migrations/016_transaction_mutations.sql` to discover the constraint name before dropping.
