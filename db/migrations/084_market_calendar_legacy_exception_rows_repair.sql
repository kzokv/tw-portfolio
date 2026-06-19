DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'market_data'
       AND table_name = 'market_calendar_previews'
       AND column_name = 'exceptions'
  ) THEN
    WITH normalized AS (
      SELECT
        preview_token,
        COALESCE(
          jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
              'date', date_text,
              'status', CASE WHEN is_open THEN 'open' ELSE 'closed' END,
              'name', COALESCE(NULLIF(row_data->>'name', ''), NULLIF(row_data->>'label', ''), NULLIF(row_data->>'holidayName', ''), CASE WHEN is_open THEN 'Weekend trading session' ELSE 'Market holiday' END),
              'evidence', COALESCE(NULLIF(row_data->>'evidence', ''), NULLIF(row_data->>'source', ''), 'Migrated from legacy calendar rows'),
              'overrideReason', COALESCE(NULLIF(row_data->>'overrideReason', ''), NULLIF(row_data->>'reason', ''), 'Migrated from legacy full-year calendar rows'),
              'notes', NULLIF(row_data->>'notes', '')
            ))
            ORDER BY date_text
          ) FILTER (WHERE (is_open = FALSE AND is_weekday = TRUE) OR (is_open = TRUE AND is_weekday = FALSE)),
          '[]'::jsonb
        ) AS exceptions,
        jsonb_build_object(
          'tradingDayCount', COUNT(*) FILTER (WHERE is_open = TRUE),
          'nonTradingDayCount', COUNT(*) FILTER (WHERE is_open = FALSE),
          'weekdayClosedCount', COUNT(*) FILTER (WHERE is_open = FALSE AND is_weekday = TRUE),
          'weekendOpenCount', COUNT(*) FILTER (WHERE is_open = TRUE AND is_weekday = FALSE)
        ) AS annual_counts
      FROM (
        SELECT
          preview_token,
          row_data,
          row_data->>'date' AS date_text,
          EXTRACT(ISODOW FROM (row_data->>'date')::date) < 6 AS is_weekday,
          CASE
            WHEN LOWER(COALESCE(row_data->>'isOpen', row_data->>'is_open', row_data->>'open')) IN ('true', 't', '1', 'yes') THEN TRUE
            WHEN LOWER(COALESCE(row_data->>'isOpen', row_data->>'is_open', row_data->>'open')) IN ('false', 'f', '0', 'no') THEN FALSE
            WHEN LOWER(COALESCE(row_data->>'status', row_data->>'session')) IN ('open', 'trading') THEN TRUE
            WHEN LOWER(COALESCE(row_data->>'status', row_data->>'session')) IN ('closed', 'holiday', 'non_trading') THEN FALSE
            ELSE NULL
          END AS is_open
        FROM market_data.market_calendar_previews
        CROSS JOIN LATERAL jsonb_array_elements(exceptions) AS row_data
        WHERE jsonb_typeof(exceptions) = 'array'
          AND row_data->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
          AND NOT (row_data ? 'status')
      ) legacy_rows
      WHERE is_open IS NOT NULL
      GROUP BY preview_token
    )
    UPDATE market_data.market_calendar_previews target
       SET exceptions = normalized.exceptions,
           annual_counts = normalized.annual_counts
      FROM normalized
     WHERE target.preview_token = normalized.preview_token;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'market_data'
       AND table_name = 'market_calendar_versions'
       AND column_name = 'exceptions'
  ) THEN
    WITH normalized AS (
      SELECT
        version_id,
        COALESCE(
          jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
              'date', date_text,
              'status', CASE WHEN is_open THEN 'open' ELSE 'closed' END,
              'name', COALESCE(NULLIF(row_data->>'name', ''), NULLIF(row_data->>'label', ''), NULLIF(row_data->>'holidayName', ''), CASE WHEN is_open THEN 'Weekend trading session' ELSE 'Market holiday' END),
              'evidence', COALESCE(NULLIF(row_data->>'evidence', ''), NULLIF(row_data->>'source', ''), 'Migrated from legacy calendar rows'),
              'overrideReason', COALESCE(NULLIF(row_data->>'overrideReason', ''), NULLIF(row_data->>'reason', ''), 'Migrated from legacy full-year calendar rows'),
              'notes', NULLIF(row_data->>'notes', '')
            ))
            ORDER BY date_text
          ) FILTER (WHERE (is_open = FALSE AND is_weekday = TRUE) OR (is_open = TRUE AND is_weekday = FALSE)),
          '[]'::jsonb
        ) AS exceptions,
        jsonb_build_object(
          'tradingDayCount', COUNT(*) FILTER (WHERE is_open = TRUE),
          'nonTradingDayCount', COUNT(*) FILTER (WHERE is_open = FALSE),
          'weekdayClosedCount', COUNT(*) FILTER (WHERE is_open = FALSE AND is_weekday = TRUE),
          'weekendOpenCount', COUNT(*) FILTER (WHERE is_open = TRUE AND is_weekday = FALSE)
        ) AS annual_counts
      FROM (
        SELECT
          version_id,
          row_data,
          row_data->>'date' AS date_text,
          EXTRACT(ISODOW FROM (row_data->>'date')::date) < 6 AS is_weekday,
          CASE
            WHEN LOWER(COALESCE(row_data->>'isOpen', row_data->>'is_open', row_data->>'open')) IN ('true', 't', '1', 'yes') THEN TRUE
            WHEN LOWER(COALESCE(row_data->>'isOpen', row_data->>'is_open', row_data->>'open')) IN ('false', 'f', '0', 'no') THEN FALSE
            WHEN LOWER(COALESCE(row_data->>'status', row_data->>'session')) IN ('open', 'trading') THEN TRUE
            WHEN LOWER(COALESCE(row_data->>'status', row_data->>'session')) IN ('closed', 'holiday', 'non_trading') THEN FALSE
            ELSE NULL
          END AS is_open
        FROM market_data.market_calendar_versions
        CROSS JOIN LATERAL jsonb_array_elements(exceptions) AS row_data
        WHERE jsonb_typeof(exceptions) = 'array'
          AND row_data->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
          AND NOT (row_data ? 'status')
      ) legacy_rows
      WHERE is_open IS NOT NULL
      GROUP BY version_id
    )
    UPDATE market_data.market_calendar_versions target
       SET exceptions = normalized.exceptions,
           annual_counts = normalized.annual_counts
      FROM normalized
     WHERE target.version_id = normalized.version_id;
  END IF;
END $$;
