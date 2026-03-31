-- Two reconciliation fixes for the QNAP dev database:
--
-- 1. market_data.instruments: KZO-83 modified migration 018 in-place after it
--    was already applied, adding type_raw/industry_category_raw/finmind_date and
--    relaxing instrument_type NOT NULL.
--
-- 2. cash_ledger_entries.amount: KZO-124 migration 020 converted trade_events,
--    lots, and lot_allocations price columns to NUMERIC(20,2) but missed
--    cash_ledger_entries.amount (still INTEGER). Demo seed with ETF decimal
--    prices (e.g. 185.50) produces fractional settlements that fail on INSERT.

BEGIN;

-- === Fix 1: instruments catalog columns ===
-- Only applies when market_data schema exists (migration 018 creates it).
-- On fresh databases where 018 hasn't run yet, this entire block is a no-op.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'market_data') THEN
    ALTER TABLE market_data.instruments ADD COLUMN IF NOT EXISTS type_raw TEXT;
    ALTER TABLE market_data.instruments ADD COLUMN IF NOT EXISTS industry_category_raw TEXT;
    ALTER TABLE market_data.instruments ADD COLUMN IF NOT EXISTS finmind_date TEXT;
    ALTER TABLE market_data.instruments DROP COLUMN IF EXISTS listed_date;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'market_data'
        AND table_name = 'instruments'
        AND column_name = 'instrument_type'
        AND is_nullable = 'NO'
    ) THEN
      ALTER TABLE market_data.instruments ALTER COLUMN instrument_type DROP NOT NULL;
    END IF;
  END IF;
END $$;

-- === Fix 2: cash_ledger_entries.amount INTEGER → NUMERIC(20,2) ===

ALTER TABLE cash_ledger_entries
  ALTER COLUMN amount TYPE NUMERIC(20, 2);

COMMIT;
