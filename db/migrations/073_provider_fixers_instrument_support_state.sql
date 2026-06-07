-- Provider fixers market-data console: admin support state for catalog rows.
-- This is intentionally separate from provider delisting and absence-detection
-- exclusion so operators can retire or mark unsupported instruments without
-- deleting data or mutating provider evidence.

ALTER TABLE market_data.instruments
  ADD COLUMN IF NOT EXISTS support_state TEXT NOT NULL DEFAULT 'supported'
    CHECK (support_state IN ('supported', 'retired_by_admin', 'unsupported_by_provider'));

COMMENT ON COLUMN market_data.instruments.support_state IS
  'Admin/provider support state independent of delisting and stored data purge.';

CREATE INDEX IF NOT EXISTS idx_instruments_market_support_state
  ON market_data.instruments (market_code, support_state);
