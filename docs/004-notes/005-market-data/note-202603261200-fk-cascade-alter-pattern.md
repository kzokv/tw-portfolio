# PostgreSQL Unnamed FK Cascade Pattern

PostgreSQL does not support `ALTER CONSTRAINT ... ADD CASCADE`. The only way to add CASCADE to an existing FK is DROP + re-ADD with the new definition.

For **unnamed FKs** (created with inline `REFERENCES` syntax), the constraint name must be discovered dynamically via `pg_constraint` using a `DO $$` block. Named constraints can be dropped directly.

## Pattern

```sql
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'your_table'::regclass
    AND confrelid = 'referenced_table'::regclass
    AND contype = 'f';

  EXECUTE format(
    'ALTER TABLE your_table DROP CONSTRAINT %I',
    constraint_name
  );
END;
$$;

ALTER TABLE your_table
  ADD CONSTRAINT your_table_col_fkey
  FOREIGN KEY (col) REFERENCES referenced_table(id)
  ON DELETE CASCADE;
```

## Context

KZO-114: The FKs on `cash_ledger_entries.related_trade_event_id`, `lot_allocations.trade_event_id`, and `trade_events.reversal_of_trade_event_id` were all created without explicit names, requiring this approach.

**Canonical reference:** `db/migrations/016_transaction_mutations.sql`

## How to apply

When writing future migrations that need to add CASCADE to existing unnamed FK constraints, use the `DO $$` block to discover the constraint name before dropping.
