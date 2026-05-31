-- KZO-177: provider health status + error trail.
--
-- Surfaces per-provider health for the four data providers
-- (finmind-tw, finmind-us, yahoo-finance-au, frankfurter) in the admin UI.
--
-- Counters (error_count_24h, rate_limit_count_24h) are NOT persisted as columns
-- — they are computed on read from `provider_error_trail`. The aggregator only
-- writes timestamp + last-error fields here; trail rows are the authoritative
-- error record. See `apps/api/src/services/market-data/providerHealth.ts`.

CREATE TABLE IF NOT EXISTS market_data.provider_health_status (
  provider_id TEXT PRIMARY KEY,
  last_successful_run TIMESTAMPTZ,
  last_failed_run TIMESTAMPTZ,
  last_error_message TEXT,
  last_down_notification_at TIMESTAMPTZ,
  last_manual_rerun_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'down',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_provider_health_status CHECK (status IN ('healthy','degraded','down'))
);

CREATE TABLE IF NOT EXISTS market_data.provider_error_trail (
  id BIGSERIAL PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES market_data.provider_health_status(provider_id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_class TEXT NOT NULL,
  error_message TEXT,
  context JSONB,
  CONSTRAINT chk_provider_error_class CHECK (
    error_class IN ('rate_limit','http_4xx','http_5xx','network','parse','other')
  )
);

CREATE INDEX IF NOT EXISTS idx_provider_error_trail_provider_occurred
  ON market_data.provider_error_trail (provider_id, occurred_at DESC);

INSERT INTO market_data.provider_health_status (provider_id, status)
VALUES
  ('finmind-tw',       'down'),
  ('finmind-us',       'down'),
  ('yahoo-finance-au', 'down'),
  ('frankfurter',      'down')
ON CONFLICT (provider_id) DO NOTHING;
