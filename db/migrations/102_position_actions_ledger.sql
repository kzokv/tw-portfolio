CREATE TABLE IF NOT EXISTS position_actions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  ticker TEXT NOT NULL,
  market_code TEXT NOT NULL CHECK (market_code ~ '^[A-Z]{2,8}$'),
  action_type TEXT NOT NULL CHECK (action_type IN ('STOCK_DIVIDEND', 'SPLIT', 'REVERSE_SPLIT')),
  action_date DATE NOT NULL,
  action_timestamp TIMESTAMP,
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  quantity NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  ratio_numerator NUMERIC(20, 6),
  ratio_denominator NUMERIC(20, 6),
  cash_in_lieu_quantity NUMERIC(20, 6),
  cash_in_lieu_amount NUMERIC(20, 6),
  cash_in_lieu_currency TEXT CHECK (cash_in_lieu_currency IS NULL OR cash_in_lieu_currency ~ '^[A-Z]{3}$'),
  par_value_per_share NUMERIC(20, 6),
  premium_base_amount NUMERIC(20, 6),
  nhi_premium_base_amount NUMERIC(20, 6),
  related_dividend_ledger_entry_id TEXT REFERENCES dividend_ledger_entries(id),
  source TEXT NOT NULL,
  source_reference TEXT,
  reversal_of_position_action_id TEXT REFERENCES position_actions(id),
  superseded_at TIMESTAMP,
  CHECK (
    reversal_of_position_action_id IS NULL
    OR reversal_of_position_action_id <> id
  ),
  CHECK (
    (action_type = 'STOCK_DIVIDEND' AND quantity > 0)
    OR (action_type IN ('SPLIT', 'REVERSE_SPLIT') AND ratio_numerator IS NOT NULL AND ratio_denominator IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_position_actions_account_ticker_date
  ON position_actions(account_id, ticker, action_date, action_timestamp, id);

CREATE INDEX IF NOT EXISTS idx_position_actions_dividend_ledger
  ON position_actions(related_dividend_ledger_entry_id)
  WHERE related_dividend_ledger_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_position_actions_reversal
  ON position_actions(reversal_of_position_action_id)
  WHERE reversal_of_position_action_id IS NOT NULL;

INSERT INTO position_actions (
  id,
  account_id,
  ticker,
  market_code,
  action_type,
  action_date,
  booked_at,
  quantity,
  ratio_numerator,
  ratio_denominator,
  source,
  source_reference
)
SELECT
  ca.id,
  ca.account_id,
  ca.ticker,
  market_code_for_account.market_code,
  CASE ca.action_type
    WHEN 'DIVIDEND' THEN 'STOCK_DIVIDEND'
    ELSE ca.action_type
  END,
  ca.action_date,
  CURRENT_TIMESTAMP,
  CASE
    WHEN ca.action_type = 'DIVIDEND' THEN ca.numerator::NUMERIC / NULLIF(ca.denominator::NUMERIC, 0)
    ELSE 0
  END,
  ca.numerator,
  ca.denominator,
  'legacy_corporate_action_backfill',
  ca.id
FROM corporate_actions ca
JOIN (
  SELECT id AS account_id,
         CASE default_currency
           WHEN 'TWD' THEN 'TW'
           WHEN 'USD' THEN 'US'
           WHEN 'AUD' THEN 'AU'
           WHEN 'KRW' THEN 'KR'
           WHEN 'JPY' THEN 'JP'
         END AS market_code
  FROM accounts
) AS market_code_for_account
  ON market_code_for_account.account_id = ca.account_id
WHERE ca.action_type IN ('DIVIDEND', 'SPLIT', 'REVERSE_SPLIT')
ON CONFLICT (id) DO NOTHING;

INSERT INTO position_actions (
  id,
  account_id,
  ticker,
  market_code,
  action_type,
  action_date,
  action_timestamp,
  booked_at,
  quantity,
  cash_in_lieu_amount,
  cash_in_lieu_currency,
  par_value_per_share,
  premium_base_amount,
  nhi_premium_base_amount,
  related_dividend_ledger_entry_id,
  source,
  source_reference
)
SELECT
  'position-action-' || dle.id,
  dle.account_id,
  de.ticker,
  de.market_code,
  'STOCK_DIVIDEND',
  COALESCE(de.payment_date, dle.booked_at::date),
  NULL,
  COALESCE(dle.booked_at, CURRENT_TIMESTAMP),
  dle.received_stock_quantity,
  0,
  de.cash_dividend_currency,
  10,
  GREATEST(0, dle.expected_cash_amount),
  (dle.received_stock_quantity * 10) + GREATEST(0, dle.expected_cash_amount),
  dle.id,
  'dividend_posting_backfill',
  dle.id
FROM dividend_ledger_entries dle
JOIN market_data.dividend_events de ON de.id = dle.dividend_event_id
WHERE dle.posting_status IN ('posted', 'adjusted')
  AND dle.received_stock_quantity > 0
  AND de.event_type IN ('STOCK', 'CASH_AND_STOCK')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS position_action_migration_audit (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  ticker TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  opened_at DATE NOT NULL,
  open_quantity NUMERIC(20, 6) NOT NULL,
  total_cost_amount NUMERIC(20, 6) NOT NULL,
  reason TEXT NOT NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_position_action_migration_audit_account_ticker
  ON position_action_migration_audit(account_id, ticker, opened_at, lot_id);

INSERT INTO position_action_migration_audit (
  id,
  account_id,
  ticker,
  lot_id,
  opened_at,
  open_quantity,
  total_cost_amount,
  reason
)
SELECT
  'orphan-zero-cost-lot-' || lot.id,
  lot.account_id,
  lot.ticker,
  lot.id,
  lot.opened_at,
  lot.open_quantity,
  lot.total_cost_amount,
  'zero_cost_positive_lot_without_position_action_projection'
FROM lots lot
LEFT JOIN position_actions pa
  ON pa.account_id = lot.account_id
 AND pa.ticker = lot.ticker
 AND pa.action_type = 'STOCK_DIVIDEND'
 AND ('lot-pa-' || pa.id) = lot.id
WHERE lot.open_quantity > 0
  AND lot.total_cost_amount = 0
  AND pa.id IS NULL
ON CONFLICT (id) DO NOTHING;

WITH replacement_lots AS (
  SELECT
    'lot-pa-' || pa.id AS id,
    legacy_lot.account_id,
    legacy_lot.ticker,
    legacy_lot.open_quantity,
    legacy_lot.total_cost_amount,
    pa.action_date AS opened_at,
    legacy_lot.cost_currency,
    COALESCE(sequence_floor.max_opened_sequence, 0)
      + ROW_NUMBER() OVER (
        PARTITION BY legacy_lot.account_id, legacy_lot.ticker, pa.action_date
        ORDER BY pa.id
      ) AS opened_sequence
  FROM position_actions pa
  JOIN lots legacy_lot
    ON legacy_lot.account_id = pa.account_id
   AND legacy_lot.ticker = pa.ticker
   AND legacy_lot.id = 'lot-' || pa.related_dividend_ledger_entry_id
  LEFT JOIN LATERAL (
    SELECT MAX(existing_lot.opened_sequence) AS max_opened_sequence
    FROM lots existing_lot
    WHERE existing_lot.account_id = legacy_lot.account_id
      AND existing_lot.ticker = legacy_lot.ticker
      AND existing_lot.opened_at = pa.action_date
  ) sequence_floor ON TRUE
  WHERE pa.action_type = 'STOCK_DIVIDEND'
    AND pa.related_dividend_ledger_entry_id IS NOT NULL
)
INSERT INTO lots (
  id,
  account_id,
  ticker,
  open_quantity,
  total_cost_amount,
  opened_at,
  opened_sequence,
  cost_currency
)
SELECT
  id,
  account_id,
  ticker,
  open_quantity,
  total_cost_amount,
  opened_at,
  opened_sequence,
  cost_currency
FROM replacement_lots
ON CONFLICT (id) DO NOTHING;

DELETE FROM lot_allocations la
USING position_actions pa
WHERE pa.action_type = 'STOCK_DIVIDEND'
  AND pa.related_dividend_ledger_entry_id IS NOT NULL
  AND la.account_id = pa.account_id
  AND la.ticker = pa.ticker
  AND la.lot_id = 'lot-' || pa.related_dividend_ledger_entry_id;

DELETE FROM lots lot
USING position_actions pa
WHERE pa.action_type = 'STOCK_DIVIDEND'
  AND pa.related_dividend_ledger_entry_id IS NOT NULL
  AND lot.account_id = pa.account_id
  AND lot.ticker = pa.ticker
  AND lot.id = 'lot-' || pa.related_dividend_ledger_entry_id;
