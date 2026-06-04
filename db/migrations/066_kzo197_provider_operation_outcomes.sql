-- KZO-197 Provider Console V2: durable per-item provider operation outcomes.
--
-- Provider operation summaries stay in `provider_operations`; this table is
-- the item ledger that powers progress bars and lets admins inspect which
-- tokens were processed, skipped, failed, rate-limited, or cancelled.

CREATE TABLE IF NOT EXISTS market_data.provider_operation_outcomes (
  operation_id TEXT NOT NULL REFERENCES market_data.provider_operations(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES market_data.provider_health_status(provider_id),
  market_code TEXT NOT NULL CHECK (market_code IN ('TW', 'US', 'AU', 'KR')),
  source_symbol TEXT NOT NULL,
  provider_symbol TEXT,
  action TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'rate_limited', 'cancelled')
  ),
  message TEXT,
  error_code TEXT,
  job_id TEXT,
  evidence JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (operation_id, action, source_symbol)
);

CREATE INDEX IF NOT EXISTS idx_provider_operation_outcomes_operation_state
  ON market_data.provider_operation_outcomes (operation_id, state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_operation_outcomes_provider_state
  ON market_data.provider_operation_outcomes (provider_id, market_code, state, updated_at DESC);
