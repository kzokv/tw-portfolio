CREATE TABLE IF NOT EXISTS market_data.ticker_fundamentals (
  ticker TEXT NOT NULL,
  market_code TEXT NOT NULL CHECK (market_code IN ('TW', 'US', 'AU')),
  provider_id TEXT,
  fundamentals JSONB NOT NULL DEFAULT '{}'::jsonb,
  refreshed_at TIMESTAMPTZ,
  next_refresh_at TIMESTAMPTZ,
  last_attempted_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker, market_code)
);

CREATE INDEX IF NOT EXISTS idx_ticker_fundamentals_next_refresh
  ON market_data.ticker_fundamentals (next_refresh_at)
  WHERE next_refresh_at IS NOT NULL;
