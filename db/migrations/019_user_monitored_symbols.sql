-- Add user_monitored_symbols join table (public schema, user-scoped).
-- Links users to instruments they explicitly want to monitor.
-- The full monitored set = user_monitored_symbols UNION tickers with open positions.

BEGIN;

CREATE TABLE IF NOT EXISTS user_monitored_symbols (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_user_monitored_symbols_user_id
  ON user_monitored_symbols(user_id);

-- Add FK to market_data.instruments only when the schema exists (migration 018).
-- Partial migration runs in integration tests may skip 018; the FK is non-critical
-- for those test scenarios.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'market_data') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_ums_instrument'
        AND table_name = 'user_monitored_symbols'
    ) THEN
      ALTER TABLE user_monitored_symbols
        ADD CONSTRAINT fk_ums_instrument
        FOREIGN KEY (ticker) REFERENCES market_data.instruments(ticker);
    END IF;
  END IF;
END $$;

COMMIT;
