-- Add source-line detail, optimistic locking, and reconciliation note support
-- for dividend postings. Payment date becomes nullable to support
-- issuer-declared dividends without a confirmed payout date.

CREATE TABLE IF NOT EXISTS dividend_source_lines (
  id TEXT PRIMARY KEY,
  dividend_ledger_entry_id TEXT NOT NULL REFERENCES dividend_ledger_entries(id) ON DELETE CASCADE,
  source_bucket TEXT NOT NULL CHECK (
    source_bucket IN (
      'DIVIDEND_INCOME',
      'INTEREST_INCOME',
      'SECURITIES_GAIN_INCOME',
      'REVENUE_EQUALIZATION',
      'CAPITAL_EQUALIZATION',
      'CAPITAL_RETURN',
      'OTHER'
    )
  ),
  amount NUMERIC(20, 4) NOT NULL,
  currency_code TEXT NOT NULL CHECK (currency_code = 'TWD'),
  source TEXT NOT NULL,
  source_reference TEXT,
  note TEXT,
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dividend_source_lines_ledger_entry
  ON dividend_source_lines(dividend_ledger_entry_id, booked_at);

ALTER TABLE dividend_ledger_entries
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_composition_status TEXT NOT NULL DEFAULT 'unknown_pending_disclosure',
  ADD COLUMN IF NOT EXISTS reconciliation_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_dividend_ledger_entries_source_composition_status'
  ) THEN
    ALTER TABLE dividend_ledger_entries
      ADD CONSTRAINT ck_dividend_ledger_entries_source_composition_status
      CHECK (source_composition_status IN ('provided', 'unknown_pending_disclosure'));
  END IF;
END $$;

ALTER TABLE market_data.dividend_events
  ALTER COLUMN payment_date DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dividend_events_payment_date
  ON market_data.dividend_events(payment_date);
