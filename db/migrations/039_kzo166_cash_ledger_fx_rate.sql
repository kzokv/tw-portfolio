-- KZO-166: cash ledger FX rate column (consumer side; KZO-168 is producer).
-- Adds fx_rate_to_usd to cash_ledger_entries with positive-or-null CHECK.
-- Idempotent. NULL is the correct value for all non-FX entry types and for
-- existing rows (no FX conversion happened pre-migration).

ALTER TABLE cash_ledger_entries
  ADD COLUMN IF NOT EXISTS fx_rate_to_usd NUMERIC(20, 8);

-- Postgres versions in scope do not support `ADD CONSTRAINT IF NOT EXISTS`.
-- Mirror the precedent in 038_kzo165_snapshot_multi_currency.sql §5 (the
-- `ck_daily_holding_snapshots_currency_iso` block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_cash_ledger_fx_rate_positive'
      AND conrelid = 'cash_ledger_entries'::regclass
  ) THEN
    ALTER TABLE cash_ledger_entries
      ADD CONSTRAINT ck_cash_ledger_fx_rate_positive
      CHECK (fx_rate_to_usd IS NULL OR fx_rate_to_usd > 0);
  END IF;
END $$;
