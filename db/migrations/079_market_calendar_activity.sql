CREATE TABLE IF NOT EXISTS market_data.market_calendar_sources (
  id TEXT PRIMARY KEY,
  market_code TEXT NOT NULL,
  label TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('official_parser', 'manual_ai_assisted')),
  url TEXT NULL,
  host TEXT NULL,
  allowed_hosts TEXT[] NOT NULL DEFAULT '{}',
  parser_id TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_calendar_sources_market
  ON market_data.market_calendar_sources (market_code, is_default DESC);

CREATE TABLE IF NOT EXISTS market_data.market_calendar_previews (
  preview_token TEXT PRIMARY KEY,
  import_operation_id TEXT NOT NULL,
  market_code TEXT NOT NULL,
  calendar_year INTEGER NOT NULL,
  source_id TEXT NULL REFERENCES market_data.market_calendar_sources (id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('official_parser', 'manual_ai_assisted')),
  label TEXT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  replace_confirmed_required BOOLEAN NOT NULL DEFAULT FALSE,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE market_data.market_calendar_previews
  ADD COLUMN IF NOT EXISTS import_operation_id TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);

CREATE TABLE IF NOT EXISTS market_data.market_calendar_versions (
  version_id TEXT PRIMARY KEY,
  import_operation_id TEXT NOT NULL,
  market_code TEXT NOT NULL,
  calendar_year INTEGER NOT NULL,
  source_id TEXT NULL REFERENCES market_data.market_calendar_sources (id) ON DELETE SET NULL,
  source_label TEXT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('official_parser', 'manual_ai_assisted')),
  retrieved_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NULL,
  invalidated_at TIMESTAMPTZ NULL,
  invalidation_reason TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'invalidated')),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE market_data.market_calendar_versions
  ADD COLUMN IF NOT EXISTS import_operation_id TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);

CREATE UNIQUE INDEX IF NOT EXISTS ux_market_calendar_versions_active_year
  ON market_data.market_calendar_versions (market_code, calendar_year)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_market_calendar_versions_market_year
  ON market_data.market_calendar_versions (market_code, calendar_year, updated_at DESC);

CREATE TABLE IF NOT EXISTS market_data.market_calendar_activity (
  id TEXT PRIMARY KEY,
  market_code TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category TEXT NOT NULL CHECK (category IN ('intraday_price', 'daily_close', 'calendar', 'provider_operation', 'system')),
  result TEXT NOT NULL CHECK (result IN ('success', 'warning', 'error', 'skipped', 'rate_limited')),
  source TEXT NOT NULL CHECK (source IN ('yahoo_chart', 'official_calendar', 'twse_close', 'finmind', 'system')),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  ticker TEXT NULL,
  provider_symbol TEXT NULL,
  operation_id TEXT NULL,
  job_id TEXT NULL,
  calendar_year INTEGER NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_market_calendar_activity_market_occurred
  ON market_data.market_calendar_activity (market_code, occurred_at DESC);
