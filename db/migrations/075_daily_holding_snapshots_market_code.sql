-- Add market identity to holding snapshots so same-ticker holdings in different
-- markets do not collide or mix price/dividend history.

BEGIN;

ALTER TABLE daily_holding_snapshots
  ADD COLUMN IF NOT EXISTS market_code TEXT NOT NULL DEFAULT 'TW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_daily_holding_snapshots_market_code'
      AND conrelid = 'daily_holding_snapshots'::regclass
  ) THEN
    ALTER TABLE daily_holding_snapshots
      ADD CONSTRAINT ck_daily_holding_snapshots_market_code
      CHECK (market_code ~ '^[A-Z]{2,10}$');
  END IF;
END $$;

UPDATE daily_holding_snapshots AS snapshot
SET market_code = trade_scope.market_code
FROM (
  SELECT
    user_id,
    account_id,
    ticker,
    MIN(market_code) AS market_code,
    COUNT(DISTINCT market_code) AS market_count
  FROM trade_events
  GROUP BY user_id, account_id, ticker
) AS trade_scope
WHERE snapshot.user_id = trade_scope.user_id
  AND snapshot.account_id = trade_scope.account_id
  AND snapshot.ticker = trade_scope.ticker
  AND snapshot.market_code = 'TW'
  AND trade_scope.market_count = 1
  AND trade_scope.market_code <> 'TW';

DELETE FROM daily_holding_snapshots AS snapshot
USING (
  SELECT user_id, account_id, ticker
  FROM trade_events
  GROUP BY user_id, account_id, ticker
  HAVING COUNT(DISTINCT market_code) > 1
) AS ambiguous_scope
WHERE snapshot.user_id = ambiguous_scope.user_id
  AND snapshot.account_id = ambiguous_scope.account_id
  AND snapshot.ticker = ambiguous_scope.ticker;

DROP INDEX IF EXISTS ux_daily_holding_snapshots_natural_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_holding_snapshots_natural_key
  ON daily_holding_snapshots(user_id, account_id, ticker, market_code, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_daily_holding_snapshots_user_market_date
  ON daily_holding_snapshots(user_id, market_code, snapshot_date DESC);

ALTER TABLE daily_holding_snapshots
  ALTER COLUMN market_code DROP DEFAULT;

COMMIT;
