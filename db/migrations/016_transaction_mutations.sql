-- Migration 016: Transaction mutations support
-- Adds ON DELETE CASCADE to trade_events FKs + fees_source column

-- 1. cash_ledger_entries.related_trade_event_id → trade_events(id) ON DELETE CASCADE
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE rel.relname = 'cash_ledger_entries'
    AND a.attname = 'related_trade_event_id'
    AND c.contype = 'f';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cash_ledger_entries DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE cash_ledger_entries
  ADD CONSTRAINT fk_cash_ledger_entries_related_trade_event_id
  FOREIGN KEY (related_trade_event_id)
  REFERENCES trade_events(id)
  ON DELETE CASCADE;

-- 2. lot_allocations.trade_event_id → trade_events(id) ON DELETE CASCADE
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE rel.relname = 'lot_allocations'
    AND a.attname = 'trade_event_id'
    AND c.contype = 'f';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE lot_allocations DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE lot_allocations
  ADD CONSTRAINT fk_lot_allocations_trade_event_id
  FOREIGN KEY (trade_event_id)
  REFERENCES trade_events(id)
  ON DELETE CASCADE;

-- 3. trade_events.reversal_of_trade_event_id → trade_events(id) ON DELETE CASCADE (self-referential)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE rel.relname = 'trade_events'
    AND a.attname = 'reversal_of_trade_event_id'
    AND c.contype = 'f';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE trade_events DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE trade_events
  ADD CONSTRAINT fk_trade_events_reversal_of_trade_event_id
  FOREIGN KEY (reversal_of_trade_event_id)
  REFERENCES trade_events(id)
  ON DELETE CASCADE;

-- 4. recompute_job_items.trade_event_id → trade_events(id) ON DELETE CASCADE
-- Wrapped in DO $$ to handle partial migration scenarios where migration 010
-- (which adds the trade_event_id column) may not have run yet.
DO $$
DECLARE
  col_exists BOOLEAN;
  constraint_name TEXT;
BEGIN
  -- Check if trade_event_id column exists on recompute_job_items
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'recompute_job_items' AND column_name = 'trade_event_id'
  ) INTO col_exists;

  IF NOT col_exists THEN
    RETURN;  -- migration 010 hasn't run, nothing to do
  END IF;

  -- Drop old FK (without CASCADE), then add new one (with CASCADE)
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE rel.relname = 'recompute_job_items'
    AND a.attname = 'trade_event_id'
    AND c.contype = 'f';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE recompute_job_items DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE recompute_job_items
    ADD CONSTRAINT fk_recompute_job_items_trade_event_id
    FOREIGN KEY (trade_event_id)
    REFERENCES trade_events(id)
    ON DELETE CASCADE;
END $$;

-- 5. Add fees_source column to trade_events
ALTER TABLE trade_events
  ADD COLUMN IF NOT EXISTS fees_source TEXT NOT NULL DEFAULT 'CALCULATED'
  CHECK (fees_source IN ('CALCULATED', 'MANUAL'));
