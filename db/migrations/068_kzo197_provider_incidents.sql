-- KZO-197 provider console v2: durable provider incidents.
-- Incidents summarize repeated provider error-trail rows into a lifecycle row
-- that the admin provider console can render separately from raw logs.

CREATE TABLE IF NOT EXISTS market_data.provider_incidents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider_id TEXT NOT NULL,
  market_code TEXT NULL CHECK (market_code IS NULL OR market_code IN ('TW', 'US', 'AU', 'KR')),
  incident_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'ignored')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  summary TEXT NULL,
  error_class TEXT NOT NULL CHECK (error_class IN ('rate_limit', 'http_4xx', 'http_5xx', 'network', 'parse', 'other')),
  error_code TEXT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_trail_id BIGINT NULL REFERENCES market_data.provider_error_trail(id) ON DELETE SET NULL,
  linked_operation_id TEXT NULL REFERENCES market_data.provider_operations(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ NULL,
  acknowledged_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  ignored_at TIMESTAMPTZ NULL,
  ignored_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_provider_incidents_provider_key UNIQUE (provider_id, incident_key)
);

CREATE INDEX IF NOT EXISTS idx_provider_incidents_provider_status_seen
  ON market_data.provider_incidents (provider_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_incidents_provider_market_seen
  ON market_data.provider_incidents (provider_id, market_code, last_seen_at DESC);
