-- Reconcile market_data.instruments for databases that applied 018 before
-- KZO-83 added catalog sync columns (type_raw, industry_category_raw, finmind_date)
-- and relaxed the instrument_type NOT NULL constraint.

BEGIN;

-- Add columns that KZO-83 introduced (IF NOT EXISTS for idempotency)
ALTER TABLE market_data.instruments ADD COLUMN IF NOT EXISTS type_raw TEXT;
ALTER TABLE market_data.instruments ADD COLUMN IF NOT EXISTS industry_category_raw TEXT;
ALTER TABLE market_data.instruments ADD COLUMN IF NOT EXISTS finmind_date TEXT;

-- Drop the old listed_date column if it still exists (replaced by finmind_date)
ALTER TABLE market_data.instruments DROP COLUMN IF EXISTS listed_date;

-- Relax instrument_type NOT NULL → nullable (catalog sync inserts with NULL type
-- for unmappable instruments). Only alter if the column is currently NOT NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'market_data'
      AND table_name = 'instruments'
      AND column_name = 'instrument_type'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE market_data.instruments ALTER COLUMN instrument_type DROP NOT NULL;
  END IF;
END $$;

COMMIT;
