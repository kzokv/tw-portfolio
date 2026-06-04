-- KZO-197 Provider Console V2: seed durable incidents from historical provider
-- error-trail rows.
--
-- Runtime writes already normalize new provider_error_trail rows into
-- provider_incidents. This idempotent backfill gives the v2 console useful
-- incident rows for errors that existed before that runtime normalization.

WITH normalized_errors AS (
  SELECT
    e.id,
    e.provider_id,
    e.occurred_at,
    e.error_class,
    e.error_message,
    e.context,
    CASE
      WHEN UPPER(NULLIF(e.context->>'marketCode', '')) IN ('TW', 'US', 'AU', 'KR')
        THEN UPPER(e.context->>'marketCode')
      WHEN e.provider_id LIKE '%-tw' THEN 'TW'
      WHEN e.provider_id LIKE '%-us' THEN 'US'
      WHEN e.provider_id LIKE '%-kr' THEN 'KR'
      WHEN e.provider_id LIKE '%-au' OR e.provider_id = 'asx-gics-csv' THEN 'AU'
      ELSE NULL
    END AS market_code,
    CASE
      WHEN COALESCE(e.error_message, '') ILIKE '%yahoo_finance_kr_symbol_unresolved%' THEN 'yahoo_finance_kr_symbol_unresolved'
      WHEN COALESCE(e.error_message, '') ILIKE '%provider_symbol_unresolved%' THEN 'provider_symbol_unresolved'
      ELSE e.error_class
    END AS error_code,
    UPPER(TRIM(COALESCE(
      NULLIF(e.context->>'ticker', ''),
      NULLIF(e.context->>'symbol', ''),
      NULLIF(e.context->>'providerSymbol', ''),
      substring(COALESCE(e.error_message, '') from ':\s*([A-Za-z0-9][A-Za-z0-9.-]{1,20})\s*$')
    ))) AS source_symbol
  FROM market_data.provider_error_trail e
),
grouped_incidents AS (
  SELECT
    provider_id,
    market_code,
    error_class,
    error_code,
    NULLIF(source_symbol, '') AS source_symbol,
    concat_ws(':', error_class, error_code, COALESCE(market_code, 'GLOBAL'), COALESCE(NULLIF(source_symbol, ''), 'provider')) AS incident_key,
    CASE WHEN error_class = 'rate_limit' THEN 'warning' ELSE 'critical' END AS severity,
    count(*)::integer AS occurrence_count,
    min(occurred_at) AS first_seen_at,
    max(occurred_at) AS last_seen_at,
    max(id) AS last_error_trail_id,
    (array_agg(error_message ORDER BY occurred_at DESC, id DESC))[1] AS summary,
    (array_agg(context ORDER BY occurred_at DESC, id DESC))[1] AS latest_context
  FROM normalized_errors
  GROUP BY provider_id, market_code, error_class, error_code, NULLIF(source_symbol, '')
)
INSERT INTO market_data.provider_incidents (
  provider_id,
  market_code,
  incident_key,
  status,
  severity,
  title,
  summary,
  error_class,
  error_code,
  occurrence_count,
  first_seen_at,
  last_seen_at,
  last_error_trail_id,
  metadata
)
SELECT
  provider_id,
  market_code,
  incident_key,
  'open',
  severity,
  CASE
    WHEN source_symbol IS NOT NULL THEN provider_id || ' unresolved ' || source_symbol
    ELSE provider_id || ' ' || replace(error_code, '_', ' ')
  END AS title,
  summary,
  error_class,
  error_code,
  occurrence_count,
  first_seen_at,
  last_seen_at,
  last_error_trail_id,
  jsonb_build_object(
    'seededFrom', 'provider_error_trail_incident_backfill',
    'latestContext', latest_context,
    'sourceSymbol', source_symbol
  ) AS metadata
FROM grouped_incidents
ON CONFLICT (provider_id, incident_key) DO UPDATE
SET occurrence_count = GREATEST(market_data.provider_incidents.occurrence_count, EXCLUDED.occurrence_count),
    first_seen_at = LEAST(market_data.provider_incidents.first_seen_at, EXCLUDED.first_seen_at),
    last_seen_at = GREATEST(market_data.provider_incidents.last_seen_at, EXCLUDED.last_seen_at),
    last_error_trail_id = CASE
      WHEN EXCLUDED.last_seen_at >= market_data.provider_incidents.last_seen_at THEN EXCLUDED.last_error_trail_id
      ELSE market_data.provider_incidents.last_error_trail_id
    END,
    metadata = COALESCE(market_data.provider_incidents.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    updated_at = NOW();
