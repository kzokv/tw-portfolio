CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_id_user_id ON accounts(id, user_id);

CREATE TABLE IF NOT EXISTS trade_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
  symbol TEXT NOT NULL,
  instrument_type TEXT NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('BUY', 'SELL')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_ntd INTEGER NOT NULL CHECK (price_ntd >= 0),
  trade_date DATE NOT NULL,
  commission_ntd INTEGER NOT NULL DEFAULT 0 CHECK (commission_ntd >= 0),
  tax_ntd INTEGER NOT NULL DEFAULT 0 CHECK (tax_ntd >= 0),
  is_day_trade BOOLEAN NOT NULL DEFAULT false,
  fee_snapshot_json TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_reference TEXT,
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversal_of_trade_event_id TEXT REFERENCES trade_events(id),
  CHECK (reversal_of_trade_event_id IS NULL OR reversal_of_trade_event_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_trade_events_user_id ON trade_events(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_events_account_symbol_trade_date
  ON trade_events(account_id, symbol, trade_date, booked_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_events_account_source_reference
  ON trade_events(account_id, source_type, source_reference)
  WHERE source_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_events_reversal_of_trade_event_id
  ON trade_events(reversal_of_trade_event_id)
  WHERE reversal_of_trade_event_id IS NOT NULL;

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
  CHECK (payment_date >= ex_dividend_date),
  CHECK (
    (event_type = 'CASH' AND cash_dividend_per_share > 0 AND stock_dividend_per_share = 0)
    OR (event_type = 'STOCK' AND cash_dividend_per_share = 0 AND stock_dividend_per_share > 0)
    OR (event_type = 'CASH_AND_STOCK' AND cash_dividend_per_share > 0 AND stock_dividend_per_share > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_dividend_events_symbol_ex_dividend_date
  ON dividend_events(symbol, ex_dividend_date);
CREATE INDEX IF NOT EXISTS idx_dividend_events_payment_date
  ON dividend_events(payment_date);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_events_symbol_source_reference
  ON dividend_events(symbol, source_type, source_reference)
  WHERE source_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS dividend_ledger_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  dividend_event_id TEXT NOT NULL REFERENCES dividend_events(id),
  eligible_quantity INTEGER NOT NULL CHECK (eligible_quantity >= 0),
  expected_cash_amount_ntd INTEGER NOT NULL DEFAULT 0 CHECK (expected_cash_amount_ntd >= 0),
  expected_stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (expected_stock_quantity >= 0),
  received_cash_amount_ntd INTEGER NOT NULL DEFAULT 0 CHECK (received_cash_amount_ntd >= 0),
  received_stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_stock_quantity >= 0),
  supplemental_insurance_ntd INTEGER NOT NULL DEFAULT 0 CHECK (supplemental_insurance_ntd >= 0),
  other_deduction_ntd INTEGER NOT NULL DEFAULT 0 CHECK (other_deduction_ntd >= 0),
  posting_status TEXT NOT NULL CHECK (posting_status IN ('expected', 'posted', 'adjusted', 'reconciled')),
  reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('open', 'matched', 'explained', 'resolved')),
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversal_of_dividend_ledger_entry_id TEXT REFERENCES dividend_ledger_entries(id),
  CHECK (
    reversal_of_dividend_ledger_entry_id IS NULL
    OR reversal_of_dividend_ledger_entry_id <> id
  )
);

CREATE INDEX IF NOT EXISTS idx_dividend_ledger_entries_account_id
  ON dividend_ledger_entries(account_id, booked_at);
CREATE INDEX IF NOT EXISTS idx_dividend_ledger_entries_dividend_event_id
  ON dividend_ledger_entries(dividend_event_id);
CREATE INDEX IF NOT EXISTS idx_dividend_ledger_entries_reconciliation_status
  ON dividend_ledger_entries(reconciliation_status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dividend_ledger_entries_reversal_of_dividend_ledger_entry_id
  ON dividend_ledger_entries(reversal_of_dividend_ledger_entry_id)
  WHERE reversal_of_dividend_ledger_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
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
  amount_ntd INTEGER NOT NULL CHECK (amount_ntd <> 0),
  currency TEXT NOT NULL DEFAULT 'TWD',
  related_trade_event_id TEXT REFERENCES trade_events(id),
  related_dividend_ledger_entry_id TEXT REFERENCES dividend_ledger_entries(id),
  source_type TEXT NOT NULL,
  source_reference TEXT,
  note TEXT,
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversal_of_cash_ledger_entry_id TEXT REFERENCES cash_ledger_entries(id),
  CHECK (
    reversal_of_cash_ledger_entry_id IS NULL
    OR reversal_of_cash_ledger_entry_id <> id
  ),
  CHECK (
    (entry_type = 'REVERSAL' AND reversal_of_cash_ledger_entry_id IS NOT NULL)
    OR (entry_type <> 'REVERSAL' AND reversal_of_cash_ledger_entry_id IS NULL)
  ),
  CHECK (
    (entry_type = 'TRADE_SETTLEMENT_IN' AND amount_ntd > 0)
    OR (entry_type = 'TRADE_SETTLEMENT_OUT' AND amount_ntd < 0)
    OR (entry_type = 'DIVIDEND_RECEIPT' AND amount_ntd > 0)
    OR (entry_type = 'DIVIDEND_DEDUCTION' AND amount_ntd < 0)
    OR entry_type IN ('MANUAL_ADJUSTMENT', 'REVERSAL')
  ),
  CHECK (
    (entry_type IN ('TRADE_SETTLEMENT_IN', 'TRADE_SETTLEMENT_OUT')
      AND related_trade_event_id IS NOT NULL
      AND related_dividend_ledger_entry_id IS NULL)
    OR (entry_type IN ('DIVIDEND_RECEIPT', 'DIVIDEND_DEDUCTION')
      AND related_trade_event_id IS NULL
      AND related_dividend_ledger_entry_id IS NOT NULL)
    OR (entry_type IN ('MANUAL_ADJUSTMENT', 'REVERSAL'))
  )
);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_user_id
  ON cash_ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_account_entry_date
  ON cash_ledger_entries(account_id, entry_date, booked_at);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_related_trade_event_id
  ON cash_ledger_entries(related_trade_event_id);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_related_dividend_ledger_entry_id
  ON cash_ledger_entries(related_dividend_ledger_entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_ledger_entries_account_source_reference
  ON cash_ledger_entries(account_id, source_type, source_reference)
  WHERE source_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_ledger_entries_reversal_of_cash_ledger_entry_id
  ON cash_ledger_entries(reversal_of_cash_ledger_entry_id)
  WHERE reversal_of_cash_ledger_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reconciliation_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
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
  reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('open', 'matched', 'explained', 'resolved')),
  difference_reason TEXT NOT NULL,
  reviewed_at TIMESTAMP,
  reviewer_id TEXT REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((reviewed_at IS NULL) = (reviewer_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_records_user_account_status
  ON reconciliation_records(user_id, account_id, reconciliation_status, created_at);
CREATE INDEX IF NOT EXISTS idx_reconciliation_records_target_entity
  ON reconciliation_records(target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_records_source
  ON reconciliation_records(source_type, source_reference, source_row_key);

CREATE TABLE IF NOT EXISTS daily_portfolio_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  snapshot_date DATE NOT NULL,
  total_market_value_ntd INTEGER NOT NULL,
  total_cost_ntd INTEGER NOT NULL,
  total_unrealized_pnl_ntd INTEGER NOT NULL,
  total_realized_pnl_ntd INTEGER NOT NULL,
  total_dividend_received_ntd INTEGER NOT NULL,
  total_cash_balance_ntd INTEGER NOT NULL,
  total_nav_ntd INTEGER NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generation_run_id TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_portfolio_snapshots_user_date_run
  ON daily_portfolio_snapshots(user_id, snapshot_date, generation_run_id);
CREATE INDEX IF NOT EXISTS idx_daily_portfolio_snapshots_user_snapshot_date
  ON daily_portfolio_snapshots(user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_portfolio_snapshots_generation_run_id
  ON daily_portfolio_snapshots(generation_run_id);
