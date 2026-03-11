ALTER TABLE fee_profiles
  RENAME COLUMN min_commission_ntd TO minimum_commission_amount;

ALTER TABLE fee_profiles
  ADD COLUMN commission_currency TEXT;

UPDATE fee_profiles
SET commission_currency = 'TWD'
WHERE commission_currency IS NULL;

ALTER TABLE fee_profiles
  ALTER COLUMN commission_currency SET NOT NULL,
  ALTER COLUMN commission_currency SET DEFAULT 'TWD';

ALTER TABLE transactions
  RENAME COLUMN price_ntd TO unit_price;

ALTER TABLE transactions
  RENAME COLUMN commission_ntd TO commission_amount;

ALTER TABLE transactions
  RENAME COLUMN tax_ntd TO tax_amount;

ALTER TABLE transactions
  RENAME COLUMN realized_pnl_ntd TO realized_pnl_amount;

ALTER TABLE transactions
  ADD COLUMN price_currency TEXT;

UPDATE transactions
SET price_currency = 'TWD'
WHERE price_currency IS NULL;

ALTER TABLE transactions
  ALTER COLUMN price_currency SET NOT NULL,
  ALTER COLUMN price_currency SET DEFAULT 'TWD';

ALTER TABLE trade_events
  RENAME COLUMN price_ntd TO unit_price;

ALTER TABLE trade_events
  RENAME COLUMN commission_ntd TO commission_amount;

ALTER TABLE trade_events
  RENAME COLUMN tax_ntd TO tax_amount;

ALTER TABLE trade_events
  ADD COLUMN price_currency TEXT;

UPDATE trade_events
SET price_currency = 'TWD'
WHERE price_currency IS NULL;

ALTER TABLE trade_events
  ALTER COLUMN price_currency SET NOT NULL,
  ALTER COLUMN price_currency SET DEFAULT 'TWD';

ALTER TABLE lots
  RENAME COLUMN total_cost_ntd TO total_cost_amount;

ALTER TABLE lots
  ADD COLUMN cost_currency TEXT;

UPDATE lots
SET cost_currency = 'TWD'
WHERE cost_currency IS NULL;

ALTER TABLE lots
  ALTER COLUMN cost_currency SET NOT NULL,
  ALTER COLUMN cost_currency SET DEFAULT 'TWD';

ALTER TABLE lot_allocations
  RENAME COLUMN allocated_cost_ntd TO allocated_cost_amount;

ALTER TABLE lot_allocations
  ADD COLUMN cost_currency TEXT;

UPDATE lot_allocations
SET cost_currency = 'TWD'
WHERE cost_currency IS NULL;

ALTER TABLE lot_allocations
  ALTER COLUMN cost_currency SET NOT NULL,
  ALTER COLUMN cost_currency SET DEFAULT 'TWD';

ALTER TABLE dividend_ledger_entries
  RENAME COLUMN expected_cash_amount_ntd TO expected_cash_amount;

ALTER TABLE dividend_ledger_entries
  RENAME COLUMN received_cash_amount_ntd TO received_cash_amount;

ALTER TABLE cash_ledger_entries
  RENAME COLUMN amount_ntd TO amount;

ALTER TABLE daily_portfolio_snapshots
  RENAME COLUMN total_market_value_ntd TO total_market_value_amount;

ALTER TABLE daily_portfolio_snapshots
  RENAME COLUMN total_cost_ntd TO total_cost_amount;

ALTER TABLE daily_portfolio_snapshots
  RENAME COLUMN total_unrealized_pnl_ntd TO total_unrealized_pnl_amount;

ALTER TABLE daily_portfolio_snapshots
  RENAME COLUMN total_realized_pnl_ntd TO total_realized_pnl_amount;

ALTER TABLE daily_portfolio_snapshots
  RENAME COLUMN total_dividend_received_ntd TO total_dividend_received_amount;

ALTER TABLE daily_portfolio_snapshots
  RENAME COLUMN total_cash_balance_ntd TO total_cash_balance_amount;

ALTER TABLE daily_portfolio_snapshots
  RENAME COLUMN total_nav_ntd TO total_nav_amount;

ALTER TABLE daily_portfolio_snapshots
  ADD COLUMN currency TEXT;

UPDATE daily_portfolio_snapshots
SET currency = 'TWD'
WHERE currency IS NULL;

ALTER TABLE daily_portfolio_snapshots
  ALTER COLUMN currency SET NOT NULL,
  ALTER COLUMN currency SET DEFAULT 'TWD';

ALTER TABLE recompute_job_items
  RENAME COLUMN previous_commission_ntd TO previous_commission_amount;

ALTER TABLE recompute_job_items
  RENAME COLUMN previous_tax_ntd TO previous_tax_amount;

ALTER TABLE recompute_job_items
  RENAME COLUMN next_commission_ntd TO next_commission_amount;

ALTER TABLE recompute_job_items
  RENAME COLUMN next_tax_ntd TO next_tax_amount;

ALTER TABLE cash_ledger_entries
  ALTER COLUMN currency DROP DEFAULT;

ALTER TABLE dividend_events
  ALTER COLUMN cash_dividend_currency DROP DEFAULT;

DO $$
DECLARE
  deduction_currency_constraint TEXT;
BEGIN
  SELECT c.conname
  INTO deduction_currency_constraint
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public'
    AND rel.relname = 'dividend_deduction_entries'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%currency_code = ''TWD''%';

  IF deduction_currency_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE dividend_deduction_entries DROP CONSTRAINT %I',
      deduction_currency_constraint
    );
  END IF;
END $$;

ALTER TABLE dividend_events
  DROP CONSTRAINT IF EXISTS ck_dividend_events_cash_dividend_currency;

ALTER TABLE fee_profiles
  DROP CONSTRAINT IF EXISTS ck_fee_profiles_commission_currency,
  ADD CONSTRAINT ck_fee_profiles_commission_currency
    CHECK (commission_currency ~ '^[A-Z]{3}$');

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS ck_transactions_price_currency,
  ADD CONSTRAINT ck_transactions_price_currency
    CHECK (price_currency ~ '^[A-Z]{3}$');

ALTER TABLE trade_events
  DROP CONSTRAINT IF EXISTS ck_trade_events_price_currency,
  ADD CONSTRAINT ck_trade_events_price_currency
    CHECK (price_currency ~ '^[A-Z]{3}$');

ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS ck_lots_cost_currency,
  ADD CONSTRAINT ck_lots_cost_currency
    CHECK (cost_currency ~ '^[A-Z]{3}$');

ALTER TABLE lot_allocations
  DROP CONSTRAINT IF EXISTS ck_lot_allocations_cost_currency,
  ADD CONSTRAINT ck_lot_allocations_cost_currency
    CHECK (cost_currency ~ '^[A-Z]{3}$');

ALTER TABLE cash_ledger_entries
  DROP CONSTRAINT IF EXISTS ck_cash_ledger_entries_currency_code,
  ADD CONSTRAINT ck_cash_ledger_entries_currency_code
    CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE dividend_events
  DROP CONSTRAINT IF EXISTS ck_dividend_events_cash_dividend_currency_code,
  ADD CONSTRAINT ck_dividend_events_cash_dividend_currency_code
    CHECK (cash_dividend_currency ~ '^[A-Z]{3}$');

ALTER TABLE dividend_deduction_entries
  DROP CONSTRAINT IF EXISTS ck_dividend_deduction_entries_currency_code,
  ADD CONSTRAINT ck_dividend_deduction_entries_currency_code
    CHECK (currency_code ~ '^[A-Z]{3}$');

ALTER TABLE daily_portfolio_snapshots
  DROP CONSTRAINT IF EXISTS ck_daily_portfolio_snapshots_currency,
  ADD CONSTRAINT ck_daily_portfolio_snapshots_currency
    CHECK (currency ~ '^[A-Z]{3}$');
