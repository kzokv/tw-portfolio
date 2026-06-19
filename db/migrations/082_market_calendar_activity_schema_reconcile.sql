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
    EXECUTE '
      WITH normalized AS (
        SELECT
          preview_token,
          COALESCE(
            jsonb_agg(
              jsonb_strip_nulls(jsonb_build_object(
                ''date'', date_text,
                ''status'', CASE WHEN is_open THEN ''open'' ELSE ''closed'' END,
                ''name'', COALESCE(NULLIF(row_data->>''name'', ''''), NULLIF(row_data->>''label'', ''''), NULLIF(row_data->>''holidayName'', ''''), CASE WHEN is_open THEN ''Weekend trading session'' ELSE ''Market holiday'' END),
                ''evidence'', COALESCE(NULLIF(row_data->>''evidence'', ''''), NULLIF(row_data->>''source'', ''''), ''Migrated from legacy calendar rows''),
                ''overrideReason'', COALESCE(NULLIF(row_data->>''overrideReason'', ''''), NULLIF(row_data->>''reason'', ''''), ''Migrated from legacy full-year calendar rows''),
                ''notes'', NULLIF(row_data->>''notes'', '''')
              ))
              ORDER BY date_text
            ) FILTER (WHERE (is_open = FALSE AND is_weekday = TRUE) OR (is_open = TRUE AND is_weekday = FALSE)),
            ''[]''::jsonb
          ) AS exceptions,
          jsonb_build_object(
            ''tradingDayCount'', COUNT(*) FILTER (WHERE is_open = TRUE),
            ''nonTradingDayCount'', COUNT(*) FILTER (WHERE is_open = FALSE),
            ''weekdayClosedCount'', COUNT(*) FILTER (WHERE is_open = FALSE AND is_weekday = TRUE),
            ''weekendOpenCount'', COUNT(*) FILTER (WHERE is_open = TRUE AND is_weekday = FALSE)
          ) AS annual_counts
        FROM (
          SELECT
            preview_token,
            row_data,
            row_data->>''date'' AS date_text,
            EXTRACT(ISODOW FROM (row_data->>''date'')::date) < 6 AS is_weekday,
            CASE
              WHEN LOWER(COALESCE(row_data->>''isOpen'', row_data->>''is_open'', row_data->>''open'')) IN (''true'', ''t'', ''1'', ''yes'') THEN TRUE
              WHEN LOWER(COALESCE(row_data->>''isOpen'', row_data->>''is_open'', row_data->>''open'')) IN (''false'', ''f'', ''0'', ''no'') THEN FALSE
              WHEN LOWER(COALESCE(row_data->>''status'', row_data->>''session'')) IN (''open'', ''trading'') THEN TRUE
              WHEN LOWER(COALESCE(row_data->>''status'', row_data->>''session'')) IN (''closed'', ''holiday'', ''non_trading'') THEN FALSE
              ELSE NULL
            END AS is_open
          FROM market_data.market_calendar_previews
          CROSS JOIN LATERAL jsonb_array_elements(rows) AS row_data
          WHERE jsonb_typeof(rows) = ''array''
            AND row_data->>''date'' ~ ''^\d{4}-\d{2}-\d{2}$''
        ) legacy_rows
        WHERE is_open IS NOT NULL
        GROUP BY preview_token
      )
      UPDATE market_data.market_calendar_previews target
         SET exceptions = normalized.exceptions,
             annual_counts = normalized.annual_counts
        FROM normalized
       WHERE target.preview_token = normalized.preview_token
         AND target.exceptions = ''[]''::jsonb';
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
    EXECUTE '
      WITH normalized AS (
        SELECT
          version_id,
          COALESCE(
            jsonb_agg(
              jsonb_strip_nulls(jsonb_build_object(
                ''date'', date_text,
                ''status'', CASE WHEN is_open THEN ''open'' ELSE ''closed'' END,
                ''name'', COALESCE(NULLIF(row_data->>''name'', ''''), NULLIF(row_data->>''label'', ''''), NULLIF(row_data->>''holidayName'', ''''), CASE WHEN is_open THEN ''Weekend trading session'' ELSE ''Market holiday'' END),
                ''evidence'', COALESCE(NULLIF(row_data->>''evidence'', ''''), NULLIF(row_data->>''source'', ''''), ''Migrated from legacy calendar rows''),
                ''overrideReason'', COALESCE(NULLIF(row_data->>''overrideReason'', ''''), NULLIF(row_data->>''reason'', ''''), ''Migrated from legacy full-year calendar rows''),
                ''notes'', NULLIF(row_data->>''notes'', '''')
              ))
              ORDER BY date_text
            ) FILTER (WHERE (is_open = FALSE AND is_weekday = TRUE) OR (is_open = TRUE AND is_weekday = FALSE)),
            ''[]''::jsonb
          ) AS exceptions,
          jsonb_build_object(
            ''tradingDayCount'', COUNT(*) FILTER (WHERE is_open = TRUE),
            ''nonTradingDayCount'', COUNT(*) FILTER (WHERE is_open = FALSE),
            ''weekdayClosedCount'', COUNT(*) FILTER (WHERE is_open = FALSE AND is_weekday = TRUE),
            ''weekendOpenCount'', COUNT(*) FILTER (WHERE is_open = TRUE AND is_weekday = FALSE)
          ) AS annual_counts
        FROM (
          SELECT
            version_id,
            row_data,
            row_data->>''date'' AS date_text,
            EXTRACT(ISODOW FROM (row_data->>''date'')::date) < 6 AS is_weekday,
            CASE
              WHEN LOWER(COALESCE(row_data->>''isOpen'', row_data->>''is_open'', row_data->>''open'')) IN (''true'', ''t'', ''1'', ''yes'') THEN TRUE
              WHEN LOWER(COALESCE(row_data->>''isOpen'', row_data->>''is_open'', row_data->>''open'')) IN (''false'', ''f'', ''0'', ''no'') THEN FALSE
              WHEN LOWER(COALESCE(row_data->>''status'', row_data->>''session'')) IN (''open'', ''trading'') THEN TRUE
              WHEN LOWER(COALESCE(row_data->>''status'', row_data->>''session'')) IN (''closed'', ''holiday'', ''non_trading'') THEN FALSE
              ELSE NULL
            END AS is_open
          FROM market_data.market_calendar_versions
          CROSS JOIN LATERAL jsonb_array_elements(rows) AS row_data
          WHERE jsonb_typeof(rows) = ''array''
            AND row_data->>''date'' ~ ''^\d{4}-\d{2}-\d{2}$''
        ) legacy_rows
        WHERE is_open IS NOT NULL
        GROUP BY version_id
      )
      UPDATE market_data.market_calendar_versions target
         SET exceptions = normalized.exceptions,
             annual_counts = normalized.annual_counts
        FROM normalized
       WHERE target.version_id = normalized.version_id
         AND target.exceptions = ''[]''::jsonb';
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
