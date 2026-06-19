ALTER TABLE market_data.market_calendar_sources
  DROP CONSTRAINT IF EXISTS market_calendar_sources_source_type_check;

ALTER TABLE market_data.market_calendar_sources
  ADD COLUMN IF NOT EXISTS suggested_source_url TEXT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'market_data'
       AND table_name = 'market_calendar_sources'
       AND column_name = 'url'
  ) THEN
    EXECUTE 'UPDATE market_data.market_calendar_sources
                SET suggested_source_url = COALESCE(suggested_source_url, url)
              WHERE suggested_source_url IS NULL';
  END IF;
END $$;

UPDATE market_data.market_calendar_sources
   SET source_type = 'official_source'
 WHERE source_type = 'official_parser';

INSERT INTO market_data.market_calendar_sources
  (id, market_code, label, source_type, suggested_source_url, enabled, is_default)
VALUES
  ('official-tw', 'TW', 'TW official calendar', 'official_source', 'https://www.twse.com.tw/en/trading/holiday.html', TRUE, TRUE),
  ('official-us', 'US', 'US official calendar', 'official_source', 'https://www.nasdaqtrader.com/trader.aspx?id=Calendar', TRUE, TRUE),
  ('official-au', 'AU', 'AU official calendar', 'official_source', 'https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar', TRUE, TRUE),
  ('official-kr', 'KR', 'KR official calendar', 'official_source', 'https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp', TRUE, TRUE)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label,
      source_type = EXCLUDED.source_type,
      suggested_source_url = EXCLUDED.suggested_source_url,
      enabled = EXCLUDED.enabled,
      is_default = EXCLUDED.is_default,
      updated_at = NOW();

ALTER TABLE market_data.market_calendar_sources
  ADD CONSTRAINT market_calendar_sources_source_type_check
  CHECK (source_type IN ('official_source', 'manual_ai_assisted'));

ALTER TABLE market_data.market_calendar_previews
  DROP CONSTRAINT IF EXISTS market_calendar_previews_source_type_check;

ALTER TABLE market_data.market_calendar_previews
  ADD COLUMN IF NOT EXISTS source_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS coverage JSONB NOT NULL DEFAULT '{"scope":"full_year","evidence":""}'::jsonb,
  ADD COLUMN IF NOT EXISTS annual_counts JSONB NOT NULL DEFAULT '{"tradingDayCount":0,"nonTradingDayCount":0,"weekdayClosedCount":0,"weekendOpenCount":0}'::jsonb,
  ADD COLUMN IF NOT EXISTS exceptions JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE market_data.market_calendar_previews
   SET source_type = 'official_source'
 WHERE source_type = 'official_parser';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'market_data'
       AND table_name = 'market_calendar_previews'
       AND column_name = 'rows'
  ) THEN
    EXECUTE 'UPDATE market_data.market_calendar_previews
                SET exceptions = rows
              WHERE exceptions = ''[]''::jsonb';
  END IF;
END $$;

ALTER TABLE market_data.market_calendar_previews
  ADD CONSTRAINT market_calendar_previews_source_type_check
  CHECK (source_type IN ('official_source', 'manual_ai_assisted'));

ALTER TABLE market_data.market_calendar_versions
  DROP CONSTRAINT IF EXISTS market_calendar_versions_source_type_check;

ALTER TABLE market_data.market_calendar_versions
  ADD COLUMN IF NOT EXISTS source_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS coverage JSONB NOT NULL DEFAULT '{"scope":"full_year","evidence":""}'::jsonb,
  ADD COLUMN IF NOT EXISTS annual_counts JSONB NOT NULL DEFAULT '{"tradingDayCount":0,"nonTradingDayCount":0,"weekdayClosedCount":0,"weekendOpenCount":0}'::jsonb,
  ADD COLUMN IF NOT EXISTS exceptions JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE market_data.market_calendar_versions
   SET source_type = 'official_source'
 WHERE source_type = 'official_parser';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'market_data'
       AND table_name = 'market_calendar_versions'
       AND column_name = 'rows'
  ) THEN
    EXECUTE 'UPDATE market_data.market_calendar_versions
                SET exceptions = rows
              WHERE exceptions = ''[]''::jsonb';
  END IF;
END $$;

ALTER TABLE market_data.market_calendar_versions
  ADD CONSTRAINT market_calendar_versions_source_type_check
  CHECK (source_type IN ('official_source', 'manual_ai_assisted'));

ALTER TABLE market_data.market_calendar_activity
  DROP CONSTRAINT IF EXISTS market_calendar_activity_category_check,
  DROP CONSTRAINT IF EXISTS market_calendar_activity_source_check,
  DROP CONSTRAINT IF EXISTS market_calendar_activity_source_kind_check;

ALTER TABLE market_data.market_calendar_activity
  ADD COLUMN IF NOT EXISTS source_kind TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'market_data'
       AND table_name = 'market_calendar_activity'
       AND column_name = 'source'
  ) THEN
    EXECUTE 'UPDATE market_data.market_calendar_activity
                SET source_kind = COALESCE(source_kind, source)
              WHERE source_kind IS NULL';
  END IF;
END $$;

UPDATE market_data.market_calendar_activity
   SET source_kind = COALESCE(source_kind, 'system');

ALTER TABLE market_data.market_calendar_activity
  ALTER COLUMN source_kind SET NOT NULL;

ALTER TABLE market_data.market_calendar_activity
  ADD CONSTRAINT market_calendar_activity_category_check
  CHECK (category IN ('intraday_price', 'daily_close', 'calendar', 'provider_operation', 'provider_error', 'instrument', 'system')),
  ADD CONSTRAINT market_calendar_activity_source_kind_check
  CHECK (source_kind IN ('yahoo_chart', 'official_calendar', 'twse_close', 'finmind', 'provider', 'system'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_market_calendar_activity_market_dedupe
  ON market_data.market_calendar_activity (market_code, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
