BEGIN;

ALTER TABLE market_data.instruments
  ADD COLUMN IF NOT EXISTS last_repair_at TIMESTAMPTZ;

COMMIT;
