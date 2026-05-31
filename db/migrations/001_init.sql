CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  cost_basis_method TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
  quote_poll_interval_seconds INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS fee_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  commission_rate_bps INTEGER NOT NULL,
  commission_discount_bps INTEGER NOT NULL,
  min_commission_ntd INTEGER NOT NULL,
  commission_rounding_mode TEXT NOT NULL,
  tax_rounding_mode TEXT NOT NULL,
  stock_sell_tax_rate_bps INTEGER NOT NULL,
  stock_day_trade_tax_rate_bps INTEGER NOT NULL,
  etf_sell_tax_rate_bps INTEGER NOT NULL,
  bond_etf_sell_tax_rate_bps INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  fee_profile_id TEXT NOT NULL REFERENCES fee_profiles(id)
);

CREATE TABLE IF NOT EXISTS account_fee_profile_overrides (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  fee_profile_id TEXT NOT NULL REFERENCES fee_profiles(id),
  PRIMARY KEY (account_id, symbol)
);

CREATE TABLE IF NOT EXISTS symbols (
  ticker TEXT PRIMARY KEY,
  instrument_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL,
  instrument_type TEXT NOT NULL,
  tx_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_ntd INTEGER NOT NULL,
  trade_date DATE NOT NULL,
  commission_ntd INTEGER NOT NULL,
  tax_ntd INTEGER NOT NULL,
  is_day_trade BOOLEAN NOT NULL DEFAULT false,
  fee_profile_id TEXT NOT NULL REFERENCES fee_profiles(id),
  fee_snapshot_json TEXT NOT NULL,
  realized_pnl_ntd INTEGER
);

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL,
  open_quantity INTEGER NOT NULL,
  total_cost_ntd INTEGER NOT NULL,
  opened_at DATE NOT NULL
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

CREATE TABLE IF NOT EXISTS recompute_job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES recompute_jobs(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  previous_commission_ntd INTEGER NOT NULL,
  previous_tax_ntd INTEGER NOT NULL,
  next_commission_ntd INTEGER NOT NULL,
  next_tax_ntd INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_fee_profiles_user_id ON fee_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_account_fee_profile_overrides_account_id
  ON account_fee_profile_overrides(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_lots_account_symbol ON lots(account_id, symbol);
CREATE INDEX IF NOT EXISTS idx_recompute_jobs_user_id ON recompute_jobs(user_id);
