-- daily_holding_snapshots: per-holding daily position snapshots (KZO-115)
CREATE TABLE IF NOT EXISTS daily_holding_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  quantity NUMERIC NOT NULL,
  close_price NUMERIC,
  market_value NUMERIC,
  cost_basis NUMERIC NOT NULL,
  unrealized_pnl NUMERIC,
  cumulative_realized_pnl NUMERIC NOT NULL DEFAULT 0,
  cumulative_dividends NUMERIC NOT NULL DEFAULT 0,
  is_provisional BOOLEAN NOT NULL DEFAULT false,
  currency TEXT NOT NULL DEFAULT 'TWD',
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generation_run_id TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_holding_snapshots_natural_key
  ON daily_holding_snapshots(user_id, account_id, ticker, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_daily_holding_snapshots_user_date
  ON daily_holding_snapshots(user_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_holding_snapshots_generation_run
  ON daily_holding_snapshots(generation_run_id);
