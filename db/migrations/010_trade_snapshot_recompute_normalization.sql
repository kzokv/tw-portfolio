CREATE TABLE IF NOT EXISTS trade_fee_policy_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  profile_id_at_booking TEXT NOT NULL,
  profile_name_at_booking TEXT NOT NULL,
  board_commission_rate NUMERIC(20, 6) NOT NULL CHECK (board_commission_rate >= 0),
  commission_discount_percent NUMERIC(5, 2) NOT NULL CHECK (
    commission_discount_percent >= 0 AND commission_discount_percent <= 100
  ),
  minimum_commission_amount INTEGER NOT NULL CHECK (minimum_commission_amount >= 0),
  commission_currency TEXT NOT NULL CHECK (commission_currency ~ '^[A-Z]{3}$'),
  commission_rounding_mode TEXT NOT NULL CHECK (commission_rounding_mode IN ('FLOOR', 'ROUND', 'CEIL')),
  tax_rounding_mode TEXT NOT NULL CHECK (tax_rounding_mode IN ('FLOOR', 'ROUND', 'CEIL')),
  stock_sell_tax_rate_bps INTEGER NOT NULL CHECK (stock_sell_tax_rate_bps >= 0),
  stock_day_trade_tax_rate_bps INTEGER NOT NULL CHECK (stock_day_trade_tax_rate_bps >= 0),
  etf_sell_tax_rate_bps INTEGER NOT NULL CHECK (etf_sell_tax_rate_bps >= 0),
  bond_etf_sell_tax_rate_bps INTEGER NOT NULL CHECK (bond_etf_sell_tax_rate_bps >= 0),
  commission_charge_mode TEXT NOT NULL CHECK (
    commission_charge_mode IN ('CHARGED_UPFRONT', 'CHARGED_UPFRONT_REBATED_LATER')
  ),
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trade_fee_policy_snapshots_user_id
  ON trade_fee_policy_snapshots(user_id);

ALTER TABLE trade_events
  ADD COLUMN IF NOT EXISTS fee_policy_snapshot_id TEXT;

INSERT INTO trade_fee_policy_snapshots (
  id,
  user_id,
  profile_id_at_booking,
  profile_name_at_booking,
  board_commission_rate,
  commission_discount_percent,
  minimum_commission_amount,
  commission_currency,
  commission_rounding_mode,
  tax_rounding_mode,
  stock_sell_tax_rate_bps,
  stock_day_trade_tax_rate_bps,
  etf_sell_tax_rate_bps,
  bond_etf_sell_tax_rate_bps,
  commission_charge_mode,
  booked_at
)
SELECT
  'trade-fee-snapshot:' || trade_event.id,
  trade_event.user_id,
  COALESCE((snapshot.payload ->> 'id')::TEXT, 'undefined'),
  COALESCE((snapshot.payload ->> 'name')::TEXT, 'undefined'),
  COALESCE(
    NULLIF(snapshot.payload ->> 'boardCommissionRate', '')::NUMERIC,
    ((COALESCE(NULLIF(snapshot.payload ->> 'commissionRateBps', '')::NUMERIC, 0)) / 10)
  ),
  COALESCE(
    NULLIF(snapshot.payload ->> 'commissionDiscountPercent', '')::NUMERIC,
    ((10000 - COALESCE(NULLIF(snapshot.payload ->> 'commissionDiscountBps', '')::NUMERIC, 10000)) / 100)
  ),
  COALESCE(
    NULLIF(snapshot.payload ->> 'minimumCommissionAmount', '')::INTEGER,
    NULLIF(snapshot.payload ->> 'minCommissionNtd', '')::INTEGER,
    0
  ),
  COALESCE((snapshot.payload ->> 'commissionCurrency')::TEXT, 'TWD'),
  COALESCE((snapshot.payload ->> 'commissionRoundingMode')::TEXT, 'FLOOR'),
  COALESCE((snapshot.payload ->> 'taxRoundingMode')::TEXT, 'FLOOR'),
  COALESCE(NULLIF(snapshot.payload ->> 'stockSellTaxRateBps', '')::INTEGER, 0),
  COALESCE(NULLIF(snapshot.payload ->> 'stockDayTradeTaxRateBps', '')::INTEGER, 0),
  COALESCE(NULLIF(snapshot.payload ->> 'etfSellTaxRateBps', '')::INTEGER, 0),
  COALESCE(NULLIF(snapshot.payload ->> 'bondEtfSellTaxRateBps', '')::INTEGER, 0),
  COALESCE((snapshot.payload ->> 'commissionChargeMode')::TEXT, 'CHARGED_UPFRONT'),
  trade_event.booked_at
FROM trade_events AS trade_event
CROSS JOIN LATERAL (SELECT trade_event.fee_snapshot_json::jsonb AS payload) AS snapshot
ON CONFLICT (id) DO NOTHING;

UPDATE trade_events
SET fee_policy_snapshot_id = 'trade-fee-snapshot:' || id
WHERE fee_policy_snapshot_id IS NULL;

ALTER TABLE trade_events
  ALTER COLUMN fee_policy_snapshot_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'trade_events'
      AND c.conname = 'fk_trade_events_fee_policy_snapshot_id'
  ) THEN
    ALTER TABLE trade_events
      ADD CONSTRAINT fk_trade_events_fee_policy_snapshot_id
      FOREIGN KEY (fee_policy_snapshot_id)
      REFERENCES trade_fee_policy_snapshots(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_events_fee_policy_snapshot_id
  ON trade_events(fee_policy_snapshot_id);

ALTER TABLE recompute_job_items
  ADD COLUMN IF NOT EXISTS trade_event_id TEXT;

UPDATE recompute_job_items
SET trade_event_id = transaction_id
WHERE trade_event_id IS NULL;

ALTER TABLE recompute_job_items
  ALTER COLUMN trade_event_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'recompute_job_items'
      AND c.conname = 'fk_recompute_job_items_trade_event_id'
  ) THEN
    ALTER TABLE recompute_job_items
      ADD CONSTRAINT fk_recompute_job_items_trade_event_id
      FOREIGN KEY (trade_event_id)
      REFERENCES trade_events(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recompute_job_items_trade_event_id
  ON recompute_job_items(trade_event_id);

INSERT INTO cash_ledger_entries (
  id,
  user_id,
  account_id,
  entry_date,
  entry_type,
  amount,
  currency,
  related_trade_event_id,
  related_dividend_ledger_entry_id,
  source_type,
  source_reference,
  note,
  booked_at,
  reversal_of_cash_ledger_entry_id
)
SELECT
  'dividend-receipt-backfill:' || dividend_ledger.id,
  account.user_id,
  dividend_ledger.account_id,
  dividend_event.payment_date,
  'DIVIDEND_RECEIPT',
  dividend_ledger.received_cash_amount,
  dividend_event.cash_dividend_currency,
  NULL,
  dividend_ledger.id,
  'dividend_received_cash_backfill',
  dividend_ledger.id,
  'Backfilled from retired dividend_ledger_entries.received_cash_amount',
  dividend_ledger.booked_at,
  NULL
FROM dividend_ledger_entries AS dividend_ledger
JOIN accounts AS account
  ON account.id = dividend_ledger.account_id
JOIN dividend_events AS dividend_event
  ON dividend_event.id = dividend_ledger.dividend_event_id
WHERE dividend_ledger.received_cash_amount > 0
  AND NOT EXISTS (
    SELECT 1
    FROM cash_ledger_entries AS cash_entry
    WHERE cash_entry.related_dividend_ledger_entry_id = dividend_ledger.id
      AND cash_entry.entry_type = 'DIVIDEND_RECEIPT'
  );

ALTER TABLE trade_events
  DROP COLUMN IF EXISTS fee_snapshot_json;

ALTER TABLE dividend_ledger_entries
  DROP COLUMN IF EXISTS received_cash_amount;

ALTER TABLE recompute_job_items
  DROP COLUMN IF EXISTS transaction_id;

DROP TABLE IF EXISTS transactions;
