CREATE TABLE IF NOT EXISTS market_data.market_calendar_sources (
  id TEXT PRIMARY KEY,
  market_code TEXT NOT NULL,
  label TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('official_source', 'manual_ai_assisted')),
  suggested_source_url TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_calendar_sources_market
  ON market_data.market_calendar_sources (market_code, is_default DESC);

INSERT INTO market_data.market_calendar_sources
  (id, market_code, label, source_type, suggested_source_url, enabled, is_default)
VALUES
  ('official-tw', 'TW', 'TW official calendar', 'official_source', 'https://www.twse.com.tw/en/trading/holiday.html', TRUE, TRUE),
  ('official-us', 'US', 'US official calendar', 'official_source', 'https://www.nasdaqtrader.com/trader.aspx?id=Calendar', TRUE, TRUE),
  ('official-au', 'AU', 'AU official calendar', 'official_source', 'https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar', TRUE, TRUE),
  ('official-kr', 'KR', 'KR official calendar', 'official_source', 'https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS market_data.market_calendar_previews (
  preview_token TEXT PRIMARY KEY,
  import_operation_id TEXT NOT NULL,
  market_code TEXT NOT NULL,
  calendar_year INTEGER NOT NULL,
  source_id TEXT NULL REFERENCES market_data.market_calendar_sources (id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('official_source', 'manual_ai_assisted')),
  label TEXT NULL,
  source_url TEXT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  coverage JSONB NOT NULL DEFAULT '{"scope":"full_year","evidence":""}'::jsonb,
  replace_confirmed_required BOOLEAN NOT NULL DEFAULT FALSE,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  diff JSONB NOT NULL DEFAULT '{"addedExceptions":[],"removedExceptions":[],"changedExceptions":[]}'::jsonb,
  annual_counts JSONB NOT NULL DEFAULT '{"tradingDayCount":0,"nonTradingDayCount":0,"weekdayClosedCount":0,"weekendOpenCount":0}'::jsonb,
  exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
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
  source_type TEXT NOT NULL CHECK (source_type IN ('official_source', 'manual_ai_assisted')),
  source_url TEXT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  coverage JSONB NOT NULL DEFAULT '{"scope":"full_year","evidence":""}'::jsonb,
  confirmed_at TIMESTAMPTZ NULL,
  invalidated_at TIMESTAMPTZ NULL,
  invalidation_reason TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'invalidated')),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  annual_counts JSONB NOT NULL DEFAULT '{"tradingDayCount":0,"nonTradingDayCount":0,"weekdayClosedCount":0,"weekendOpenCount":0}'::jsonb,
  exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
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
  category TEXT NOT NULL CHECK (category IN ('intraday_price', 'daily_close', 'calendar', 'provider_operation', 'provider_error', 'instrument', 'system')),
  result TEXT NOT NULL CHECK (result IN ('success', 'warning', 'error', 'skipped', 'rate_limited')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('yahoo_chart', 'official_calendar', 'twse_close', 'finmind', 'provider', 'system')),
  source_id TEXT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  ticker TEXT NULL,
  provider_symbol TEXT NULL,
  operation_id TEXT NULL,
  job_id TEXT NULL,
  calendar_year INTEGER NULL,
  dedupe_key TEXT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_market_calendar_activity_market_dedupe
  ON market_data.market_calendar_activity (market_code, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_market_calendar_activity_market_occurred
  ON market_data.market_calendar_activity (market_code, occurred_at DESC);
