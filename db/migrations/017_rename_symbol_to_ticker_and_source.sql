-- KZO-82 Step 01: Rename symbol -> ticker and source_type -> source
-- Mechanical column renames + index drop/recreate (Postgres renames column OIDs
-- but NOT index names, so stale index names cause confusion).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trade_events' AND column_name = 'symbol'
  ) THEN
    ALTER TABLE trade_events RENAME COLUMN symbol TO ticker;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lots' AND column_name = 'symbol'
  ) THEN
    ALTER TABLE lots RENAME COLUMN symbol TO ticker;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'corporate_actions' AND column_name = 'symbol'
  ) THEN
    ALTER TABLE corporate_actions RENAME COLUMN symbol TO ticker;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'account_fee_profile_overrides' AND column_name = 'symbol'
  ) THEN
    ALTER TABLE account_fee_profile_overrides RENAME COLUMN symbol TO ticker;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lot_allocations' AND column_name = 'symbol'
  ) THEN
    ALTER TABLE lot_allocations RENAME COLUMN symbol TO ticker;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dividend_events' AND column_name = 'symbol'
  ) THEN
    ALTER TABLE dividend_events RENAME COLUMN symbol TO ticker;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trade_events' AND column_name = 'source_type'
  ) THEN
    ALTER TABLE trade_events RENAME COLUMN source_type TO source;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dividend_events' AND column_name = 'source_type'
  ) THEN
    ALTER TABLE dividend_events RENAME COLUMN source_type TO source;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_ledger_entries' AND column_name = 'source_type'
  ) THEN
    ALTER TABLE cash_ledger_entries RENAME COLUMN source_type TO source;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dividend_deduction_entries' AND column_name = 'source_type'
  ) THEN
    ALTER TABLE dividend_deduction_entries RENAME COLUMN source_type TO source;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reconciliation_records' AND column_name = 'source_type'
  ) THEN
    ALTER TABLE reconciliation_records RENAME COLUMN source_type TO source;
  END IF;
END $$;

-- ============================================================
-- 3. Index drop + recreate (rename-safe)
-- ============================================================

-- lots
DROP INDEX IF EXISTS idx_lots_account_symbol;
CREATE INDEX IF NOT EXISTS idx_lots_account_ticker ON lots(account_id, ticker);

DROP INDEX IF EXISTS ux_lots_account_symbol_opened_order;
CREATE UNIQUE INDEX IF NOT EXISTS ux_lots_account_ticker_opened_order ON lots(account_id, ticker, opened_at, opened_sequence);

-- Recreate the non-unique covering index with new name
DROP INDEX IF EXISTS idx_lots_account_symbol_opened_order;
CREATE INDEX IF NOT EXISTS idx_lots_account_ticker_opened_order ON lots(account_id, ticker, opened_at, opened_sequence, id);

-- trade_events
DROP INDEX IF EXISTS idx_trade_events_account_symbol_trade_date;
CREATE INDEX IF NOT EXISTS idx_trade_events_account_ticker_trade_date ON trade_events(account_id, ticker, trade_date, booked_at);

DROP INDEX IF EXISTS idx_trade_events_account_market_symbol_trade_date;
CREATE INDEX IF NOT EXISTS idx_trade_events_account_market_ticker_trade_date ON trade_events(account_id, market_code, ticker, trade_date, booked_at);

DROP INDEX IF EXISTS idx_trade_events_account_symbol_booking_order;
CREATE INDEX IF NOT EXISTS idx_trade_events_account_ticker_booking_order ON trade_events(account_id, ticker, trade_date, booking_sequence, trade_timestamp, id);

-- lot_allocations
DROP INDEX IF EXISTS idx_lot_allocations_account_symbol;
CREATE INDEX IF NOT EXISTS idx_lot_allocations_account_ticker ON lot_allocations(account_id, ticker, lot_opened_at, lot_opened_sequence, lot_id);

-- dividend_events
DROP INDEX IF EXISTS idx_dividend_events_symbol_ex_dividend_date;
CREATE INDEX IF NOT EXISTS idx_dividend_events_ticker_ex_dividend_date ON dividend_events(ticker, ex_dividend_date);

DROP INDEX IF EXISTS ux_dividend_events_symbol_source_reference;
CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_events_ticker_source_reference ON dividend_events(ticker, source, source_reference)
  WHERE source_reference IS NOT NULL;

-- account_fee_profile_overrides
DROP INDEX IF EXISTS idx_account_fee_profile_overrides_account_market_symbol;
CREATE INDEX IF NOT EXISTS idx_account_fee_profile_overrides_account_market_ticker ON account_fee_profile_overrides(account_id, market_code, ticker);

-- Update PK on account_fee_profile_overrides (references renamed column)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'account_fee_profile_overrides'
      AND c.conname = 'account_fee_profile_overrides_pkey'
      AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (account_id, ticker)'
  ) THEN
    ALTER TABLE account_fee_profile_overrides DROP CONSTRAINT account_fee_profile_overrides_pkey;
    ALTER TABLE account_fee_profile_overrides ADD PRIMARY KEY (account_id, ticker, market_code);
  END IF;
END $$;

-- Note: idx_symbols_market_code_ticker is left as-is — will be dropped with
-- the public.symbols table in Step 03.

COMMIT;
