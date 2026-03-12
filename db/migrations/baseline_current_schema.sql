-- Fresh-bootstrap baseline equivalent to the numbered migration chain through
-- 012_market_code_on_symbols_bindings_and_trades.sql.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  cost_basis_method TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
  quote_poll_interval_seconds INTEGER NOT NULL DEFAULT 10,
  CONSTRAINT users_cost_basis_method_check
    CHECK (cost_basis_method = 'WEIGHTED_AVERAGE')
);

CREATE TABLE IF NOT EXISTS fee_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  commission_rate_bps INTEGER NOT NULL,
  commission_discount_bps INTEGER NOT NULL,
  minimum_commission_amount INTEGER NOT NULL,
  commission_rounding_mode TEXT NOT NULL,
  tax_rounding_mode TEXT NOT NULL,
  stock_sell_tax_rate_bps INTEGER NOT NULL,
  stock_day_trade_tax_rate_bps INTEGER NOT NULL,
  etf_sell_tax_rate_bps INTEGER NOT NULL,
  bond_etf_sell_tax_rate_bps INTEGER NOT NULL,
  board_commission_rate NUMERIC(20, 6) NOT NULL DEFAULT 1.425,
  commission_charge_mode TEXT NOT NULL DEFAULT 'CHARGED_UPFRONT',
  commission_discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  commission_currency TEXT NOT NULL DEFAULT 'TWD',
  CONSTRAINT ck_fee_profiles_commission_rate_bps
    CHECK (commission_rate_bps >= 0),
  CONSTRAINT ck_fee_profiles_commission_discount_bps
    CHECK (commission_discount_bps >= 0 AND commission_discount_bps <= 10000),
  CONSTRAINT ck_fee_profiles_minimum_commission_amount
    CHECK (minimum_commission_amount >= 0),
  CONSTRAINT ck_fee_profiles_commission_rounding_mode
    CHECK (commission_rounding_mode IN ('FLOOR', 'ROUND', 'CEIL')),
  CONSTRAINT ck_fee_profiles_tax_rounding_mode
    CHECK (tax_rounding_mode IN ('FLOOR', 'ROUND', 'CEIL')),
  CONSTRAINT ck_fee_profiles_stock_sell_tax_rate_bps
    CHECK (stock_sell_tax_rate_bps >= 0),
  CONSTRAINT ck_fee_profiles_stock_day_trade_tax_rate_bps
    CHECK (stock_day_trade_tax_rate_bps >= 0),
  CONSTRAINT ck_fee_profiles_etf_sell_tax_rate_bps
    CHECK (etf_sell_tax_rate_bps >= 0),
  CONSTRAINT ck_fee_profiles_bond_etf_sell_tax_rate_bps
    CHECK (bond_etf_sell_tax_rate_bps >= 0),
  CONSTRAINT ck_fee_profiles_board_commission_rate
    CHECK (board_commission_rate >= 0),
  CONSTRAINT ck_fee_profiles_commission_charge_mode
    CHECK (commission_charge_mode IN ('CHARGED_UPFRONT', 'CHARGED_UPFRONT_REBATED_LATER')),
  CONSTRAINT ck_fee_profiles_commission_discount_percent
    CHECK (commission_discount_percent >= 0 AND commission_discount_percent <= 100),
  CONSTRAINT ck_fee_profiles_commission_currency
    CHECK (commission_currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS fee_profile_tax_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  fee_profile_id TEXT NOT NULL REFERENCES fee_profiles(id) ON DELETE CASCADE,
  market_code TEXT NOT NULL DEFAULT 'TW' CHECK (market_code ~ '^[A-Z]{2,10}$'),
  trade_side TEXT NOT NULL CHECK (trade_side IN ('SELL')),
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('STOCK', 'ETF', 'BOND_ETF')),
  day_trade_scope TEXT NOT NULL CHECK (day_trade_scope IN ('ANY', 'DAY_TRADE_ONLY', 'NON_DAY_TRADE_ONLY')),
  tax_component_code TEXT NOT NULL,
  calculation_method TEXT NOT NULL CHECK (calculation_method IN ('RATE_BPS')),
  rate_bps INTEGER NOT NULL CHECK (rate_bps >= 0),
  effective_from DATE,
  effective_to DATE,
  sort_order INTEGER NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  fee_profile_id TEXT NOT NULL REFERENCES fee_profiles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_id_user_id
  ON accounts(id, user_id);

CREATE TABLE IF NOT EXISTS account_fee_profile_overrides (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  fee_profile_id TEXT NOT NULL REFERENCES fee_profiles(id),
  market_code TEXT NOT NULL DEFAULT 'TW' CHECK (market_code ~ '^[A-Z]{2,10}$'),
  PRIMARY KEY (account_id, symbol, market_code)
);

CREATE TABLE IF NOT EXISTS symbols (
  ticker TEXT PRIMARY KEY,
  instrument_type TEXT NOT NULL,
  market_code TEXT NOT NULL DEFAULT 'TW' CHECK (market_code ~ '^[A-Z]{2,10}$')
);

CREATE TABLE IF NOT EXISTS corporate_actions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL,
  action_type TEXT NOT NULL,
  numerator INTEGER NOT NULL,
  denominator INTEGER NOT NULL,
  action_date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS recompute_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS dividend_events (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CASH', 'STOCK', 'CASH_AND_STOCK')),
  ex_dividend_date DATE NOT NULL,
  payment_date DATE NOT NULL,
  cash_dividend_per_share NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (cash_dividend_per_share >= 0),
  stock_dividend_per_share NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (stock_dividend_per_share >= 0),
  source_type TEXT NOT NULL,
  source_reference TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cash_dividend_currency TEXT NOT NULL,
  CHECK (payment_date >= ex_dividend_date),
  CHECK (
    (event_type = 'CASH' AND cash_dividend_per_share > 0 AND stock_dividend_per_share = 0)
    OR (event_type = 'STOCK' AND cash_dividend_per_share = 0 AND stock_dividend_per_share > 0)
    OR (event_type = 'CASH_AND_STOCK' AND cash_dividend_per_share > 0 AND stock_dividend_per_share > 0)
  ),
  CONSTRAINT ck_dividend_events_cash_dividend_currency_code
    CHECK (cash_dividend_currency ~ '^[A-Z]{3}$')
);

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

CREATE TABLE IF NOT EXISTS trade_fee_policy_snapshot_tax_components (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES trade_fee_policy_snapshots(id) ON DELETE CASCADE,
  market_code TEXT NOT NULL DEFAULT 'TW' CHECK (market_code ~ '^[A-Z]{2,10}$'),
  trade_side TEXT NOT NULL CHECK (trade_side IN ('SELL')),
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('STOCK', 'ETF', 'BOND_ETF')),
  day_trade_scope TEXT NOT NULL CHECK (day_trade_scope IN ('ANY', 'DAY_TRADE_ONLY', 'NON_DAY_TRADE_ONLY')),
  tax_component_code TEXT NOT NULL,
  calculation_method TEXT NOT NULL CHECK (calculation_method IN ('RATE_BPS')),
  rate_bps INTEGER NOT NULL CHECK (rate_bps >= 0),
  booked_tax_amount INTEGER NOT NULL CHECK (booked_tax_amount >= 0),
  sort_order INTEGER NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL,
  instrument_type TEXT NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('BUY', 'SELL')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  trade_date DATE NOT NULL,
  commission_amount INTEGER NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  is_day_trade BOOLEAN NOT NULL DEFAULT false,
  source_type TEXT NOT NULL,
  source_reference TEXT,
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversal_of_trade_event_id TEXT REFERENCES trade_events(id),
  trade_timestamp TIMESTAMP NOT NULL,
  booking_sequence INTEGER NOT NULL,
  price_currency TEXT NOT NULL DEFAULT 'TWD',
  fee_policy_snapshot_id TEXT NOT NULL REFERENCES trade_fee_policy_snapshots(id),
  market_code TEXT NOT NULL DEFAULT 'TW' CHECK (market_code ~ '^[A-Z]{2,10}$'),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
  CHECK (reversal_of_trade_event_id IS NULL OR reversal_of_trade_event_id <> id),
  CONSTRAINT trade_events_booking_sequence_positive
    CHECK (booking_sequence > 0),
  CONSTRAINT ck_trade_events_price_currency
    CHECK (price_currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL,
  open_quantity INTEGER NOT NULL,
  total_cost_amount INTEGER NOT NULL,
  opened_at DATE NOT NULL,
  opened_sequence INTEGER NOT NULL,
  cost_currency TEXT NOT NULL DEFAULT 'TWD',
  CONSTRAINT lots_opened_sequence_positive
    CHECK (opened_sequence > 0),
  CONSTRAINT ck_lots_cost_currency
    CHECK (cost_currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS lot_allocations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  trade_event_id TEXT NOT NULL REFERENCES trade_events(id),
  symbol TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  lot_opened_at DATE NOT NULL,
  lot_opened_sequence INTEGER NOT NULL CHECK (lot_opened_sequence > 0),
  allocated_quantity INTEGER NOT NULL CHECK (allocated_quantity > 0),
  allocated_cost_amount INTEGER NOT NULL CHECK (allocated_cost_amount >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cost_currency TEXT NOT NULL DEFAULT 'TWD',
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
  CONSTRAINT ck_lot_allocations_cost_currency
    CHECK (cost_currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS dividend_ledger_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  dividend_event_id TEXT NOT NULL REFERENCES dividend_events(id),
  eligible_quantity INTEGER NOT NULL CHECK (eligible_quantity >= 0),
  expected_cash_amount INTEGER NOT NULL DEFAULT 0 CHECK (expected_cash_amount >= 0),
  expected_stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (expected_stock_quantity >= 0),
  received_stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_stock_quantity >= 0),
  posting_status TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL CHECK (
    reconciliation_status IN ('open', 'matched', 'explained', 'resolved')
  ),
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversal_of_dividend_ledger_entry_id TEXT REFERENCES dividend_ledger_entries(id),
  superseded_at TIMESTAMP,
  CHECK (
    reversal_of_dividend_ledger_entry_id IS NULL
    OR reversal_of_dividend_ledger_entry_id <> id
  ),
  CONSTRAINT ck_dividend_ledger_entries_posting_status
    CHECK (posting_status IN ('expected', 'posted', 'adjusted'))
);

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
  currency_code TEXT NOT NULL DEFAULT 'TWD',
  withheld_at_source BOOLEAN NOT NULL DEFAULT true,
  source_type TEXT NOT NULL,
  source_reference TEXT,
  note TEXT,
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_dividend_deduction_entries_currency_code
    CHECK (currency_code ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS cash_ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  entry_date DATE NOT NULL,
  entry_type TEXT NOT NULL CHECK (
    entry_type IN (
      'TRADE_SETTLEMENT_IN',
      'TRADE_SETTLEMENT_OUT',
      'DIVIDEND_RECEIPT',
      'DIVIDEND_DEDUCTION',
      'MANUAL_ADJUSTMENT',
      'REVERSAL'
    )
  ),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  currency TEXT NOT NULL,
  related_trade_event_id TEXT REFERENCES trade_events(id),
  related_dividend_ledger_entry_id TEXT REFERENCES dividend_ledger_entries(id),
  source_type TEXT NOT NULL,
  source_reference TEXT,
  note TEXT,
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversal_of_cash_ledger_entry_id TEXT REFERENCES cash_ledger_entries(id),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
  CHECK (
    reversal_of_cash_ledger_entry_id IS NULL
    OR reversal_of_cash_ledger_entry_id <> id
  ),
  CHECK (
    (entry_type = 'REVERSAL' AND reversal_of_cash_ledger_entry_id IS NOT NULL)
    OR (entry_type <> 'REVERSAL' AND reversal_of_cash_ledger_entry_id IS NULL)
  ),
  CHECK (
    (entry_type = 'TRADE_SETTLEMENT_IN' AND amount > 0)
    OR (entry_type = 'TRADE_SETTLEMENT_OUT' AND amount < 0)
    OR (entry_type = 'DIVIDEND_RECEIPT' AND amount > 0)
    OR (entry_type = 'DIVIDEND_DEDUCTION' AND amount < 0)
    OR entry_type IN ('MANUAL_ADJUSTMENT', 'REVERSAL')
  ),
  CHECK (
    (entry_type IN ('TRADE_SETTLEMENT_IN', 'TRADE_SETTLEMENT_OUT')
      AND related_trade_event_id IS NOT NULL
      AND related_dividend_ledger_entry_id IS NULL)
    OR (entry_type IN ('DIVIDEND_RECEIPT', 'DIVIDEND_DEDUCTION')
      AND related_trade_event_id IS NULL
      AND related_dividend_ledger_entry_id IS NOT NULL)
    OR entry_type IN ('MANUAL_ADJUSTMENT', 'REVERSAL')
  ),
  CONSTRAINT ck_cash_ledger_entries_currency_code
    CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS reconciliation_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  source_type TEXT NOT NULL,
  source_reference TEXT,
  source_file_name TEXT,
  source_row_key TEXT,
  target_entity_type TEXT NOT NULL CHECK (
    target_entity_type IN (
      'trade_event',
      'cash_ledger_entry',
      'dividend_event',
      'dividend_ledger_entry',
      'daily_portfolio_snapshot',
      'lot'
    )
  ),
  target_entity_id TEXT,
  reconciliation_status TEXT NOT NULL CHECK (
    reconciliation_status IN ('open', 'matched', 'explained', 'resolved')
  ),
  difference_reason TEXT NOT NULL,
  reviewed_at TIMESTAMP,
  reviewer_id TEXT REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
  CHECK ((reviewed_at IS NULL) = (reviewer_id IS NULL))
);

CREATE TABLE IF NOT EXISTS daily_portfolio_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  snapshot_date DATE NOT NULL,
  total_market_value_amount INTEGER NOT NULL,
  total_cost_amount INTEGER NOT NULL,
  total_unrealized_pnl_amount INTEGER NOT NULL,
  total_realized_pnl_amount INTEGER NOT NULL,
  total_dividend_received_amount INTEGER NOT NULL,
  total_cash_balance_amount INTEGER NOT NULL,
  total_nav_amount INTEGER NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generation_run_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TWD',
  CONSTRAINT ck_daily_portfolio_snapshots_currency
    CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS recompute_job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES recompute_jobs(id),
  previous_commission_amount INTEGER NOT NULL,
  previous_tax_amount INTEGER NOT NULL,
  next_commission_amount INTEGER NOT NULL,
  next_tax_amount INTEGER NOT NULL,
  trade_event_id TEXT NOT NULL REFERENCES trade_events(id)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_fee_profiles_user_id ON fee_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_fee_profile_tax_rules_user_id
  ON fee_profile_tax_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_fee_profile_tax_rules_fee_profile_id
  ON fee_profile_tax_rules(fee_profile_id, market_code, instrument_type, day_trade_scope, sort_order);
CREATE INDEX IF NOT EXISTS idx_account_fee_profile_overrides_account_id
  ON account_fee_profile_overrides(account_id);
CREATE INDEX IF NOT EXISTS idx_account_fee_profile_overrides_account_market_symbol
  ON account_fee_profile_overrides(account_id, market_code, symbol);
CREATE INDEX IF NOT EXISTS idx_lots_account_symbol ON lots(account_id, symbol);
CREATE INDEX IF NOT EXISTS idx_recompute_jobs_user_id ON recompute_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_dividend_events_symbol_ex_dividend_date
  ON dividend_events(symbol, ex_dividend_date);
CREATE INDEX IF NOT EXISTS idx_dividend_events_payment_date
  ON dividend_events(payment_date);
CREATE INDEX IF NOT EXISTS idx_trade_fee_policy_snapshots_user_id
  ON trade_fee_policy_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_fee_policy_snapshot_tax_components_snapshot_id
  ON trade_fee_policy_snapshot_tax_components(snapshot_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_trade_events_user_id
  ON trade_events(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_events_account_symbol_trade_date
  ON trade_events(account_id, symbol, trade_date, booked_at);
CREATE INDEX IF NOT EXISTS idx_trade_events_account_market_symbol_trade_date
  ON trade_events(account_id, market_code, symbol, trade_date, booked_at);
CREATE INDEX IF NOT EXISTS idx_trade_events_account_symbol_booking_order
  ON trade_events(account_id, symbol, trade_date, booking_sequence, trade_timestamp, id);
CREATE INDEX IF NOT EXISTS idx_symbols_market_code_ticker
  ON symbols(market_code, ticker);
CREATE INDEX IF NOT EXISTS idx_lots_account_symbol_opened_order
  ON lots(account_id, symbol, opened_at, opened_sequence, id);
CREATE INDEX IF NOT EXISTS idx_lot_allocations_trade_event_id
  ON lot_allocations(trade_event_id);
CREATE INDEX IF NOT EXISTS idx_lot_allocations_account_symbol
  ON lot_allocations(account_id, symbol, lot_opened_at, lot_opened_sequence, lot_id);
CREATE INDEX IF NOT EXISTS idx_dividend_ledger_entries_account_id
  ON dividend_ledger_entries(account_id, booked_at);
CREATE INDEX IF NOT EXISTS idx_dividend_ledger_entries_dividend_event_id
  ON dividend_ledger_entries(dividend_event_id);
CREATE INDEX IF NOT EXISTS idx_dividend_ledger_entries_reconciliation_status
  ON dividend_ledger_entries(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_dividend_deduction_entries_dividend_ledger_entry_id
  ON dividend_deduction_entries(dividend_ledger_entry_id, booked_at);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_user_id
  ON cash_ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_account_entry_date
  ON cash_ledger_entries(account_id, entry_date, booked_at);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_related_trade_event_id
  ON cash_ledger_entries(related_trade_event_id);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_related_dividend_ledger_entry_id
  ON cash_ledger_entries(related_dividend_ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_records_user_account_status
  ON reconciliation_records(user_id, account_id, reconciliation_status, created_at);
CREATE INDEX IF NOT EXISTS idx_reconciliation_records_target_entity
  ON reconciliation_records(target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_records_source
  ON reconciliation_records(source_type, source_reference, source_row_key);
CREATE INDEX IF NOT EXISTS idx_daily_portfolio_snapshots_user_snapshot_date
  ON daily_portfolio_snapshots(user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_portfolio_snapshots_generation_run_id
  ON daily_portfolio_snapshots(generation_run_id);
CREATE INDEX IF NOT EXISTS idx_recompute_job_items_trade_event_id
  ON recompute_job_items(trade_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_events_account_source_reference
  ON trade_events(account_id, source_type, source_reference)
  WHERE source_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fee_profile_tax_rules_identity
  ON fee_profile_tax_rules(
    fee_profile_id,
    market_code,
    trade_side,
    instrument_type,
    day_trade_scope,
    tax_component_code,
    sort_order
  );
CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_events_reversal_of_trade_event_id
  ON trade_events(reversal_of_trade_event_id)
  WHERE reversal_of_trade_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_events_account_trade_date_booking_sequence
  ON trade_events(account_id, trade_date, booking_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_events_fee_policy_snapshot_id
  ON trade_events(fee_policy_snapshot_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_fee_policy_snapshot_tax_components_snapshot_order
  ON trade_fee_policy_snapshot_tax_components(snapshot_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lots_account_symbol_opened_order
  ON lots(account_id, symbol, opened_at, opened_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lot_allocations_trade_event_lot
  ON lot_allocations(trade_event_id, lot_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_events_symbol_source_reference
  ON dividend_events(symbol, source_type, source_reference)
  WHERE source_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_ledger_entries_reversal_of_dividend_ledger_entry_id
  ON dividend_ledger_entries(reversal_of_dividend_ledger_entry_id)
  WHERE reversal_of_dividend_ledger_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_ledger_entries_active_account_event
  ON dividend_ledger_entries(account_id, dividend_event_id)
  WHERE reversal_of_dividend_ledger_entry_id IS NULL
    AND superseded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_ledger_entries_account_source_reference
  ON cash_ledger_entries(account_id, source_type, source_reference)
  WHERE source_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_ledger_entries_reversal_of_cash_ledger_entry_id
  ON cash_ledger_entries(reversal_of_cash_ledger_entry_id)
  WHERE reversal_of_cash_ledger_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_portfolio_snapshots_user_date_run
  ON daily_portfolio_snapshots(user_id, snapshot_date, generation_run_id);
