CREATE TABLE IF NOT EXISTS dividend_deduction_entries (
  id TEXT PRIMARY KEY,
  dividend_ledger_entry_id TEXT NOT NULL REFERENCES dividend_ledger_entries(id),
  deduction_type TEXT NOT NULL CHECK (
    deduction_type IN (
      'NHI_SUPPLEMENTAL_PREMIUM',
      'WITHHOLDING_TAX',
      'BROKER_FEE',
      'BANK_FEE',
      'TRANSFER_FEE',
      'CASH_IN_LIEU_ADJUSTMENT',
      'ROUNDING_ADJUSTMENT',
      'OTHER'
    )
  ),
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency_code TEXT NOT NULL DEFAULT 'TWD' CHECK (currency_code = 'TWD'),
  withheld_at_source BOOLEAN NOT NULL DEFAULT true,
  source_type TEXT NOT NULL,
  source_reference TEXT,
  note TEXT,
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dividend_deduction_entries_dividend_ledger_entry_id
  ON dividend_deduction_entries(dividend_ledger_entry_id, booked_at);

ALTER TABLE dividend_ledger_entries
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMP;

UPDATE dividend_ledger_entries
SET posting_status = 'adjusted'
WHERE posting_status = 'reconciled';

DO $$
DECLARE
  posting_status_constraint TEXT;
BEGIN
  SELECT c.conname
  INTO posting_status_constraint
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public'
    AND rel.relname = 'dividend_ledger_entries'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%posting_status = ANY%';

  IF posting_status_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE dividend_ledger_entries DROP CONSTRAINT %I',
      posting_status_constraint
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'dividend_ledger_entries'
      AND c.conname = 'ck_dividend_ledger_entries_posting_status'
  ) THEN
    ALTER TABLE dividend_ledger_entries
      ADD CONSTRAINT ck_dividend_ledger_entries_posting_status
      CHECK (posting_status IN ('expected', 'posted', 'adjusted'));
  END IF;
END $$;

UPDATE dividend_ledger_entries original
SET superseded_at = COALESCE(original.superseded_at, CURRENT_TIMESTAMP)
WHERE EXISTS (
  SELECT 1
  FROM dividend_ledger_entries reversal
  WHERE reversal.reversal_of_dividend_ledger_entry_id = original.id
);

ALTER TABLE dividend_ledger_entries
  DROP COLUMN IF EXISTS supplemental_insurance_ntd,
  DROP COLUMN IF EXISTS other_deduction_ntd;

CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_ledger_entries_active_account_event
  ON dividend_ledger_entries(account_id, dividend_event_id)
  WHERE reversal_of_dividend_ledger_entry_id IS NULL
    AND superseded_at IS NULL;
