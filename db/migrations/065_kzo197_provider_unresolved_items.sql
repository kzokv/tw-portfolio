-- KZO-197 Provider Console V2: durable unresolved provider items.
--
-- Raw `provider_error_trail` remains the occurrence history. This table is the
-- provider-scoped worklist used by the admin console for active/resolved state.

CREATE TABLE IF NOT EXISTS market_data.provider_unresolved_items (
  provider_id TEXT NOT NULL REFERENCES market_data.provider_health_status(provider_id),
  market_code TEXT NOT NULL CHECK (market_code IN ('TW', 'US', 'AU', 'KR')),
  error_code TEXT NOT NULL,
  source_symbol TEXT NOT NULL,
  provider_symbol TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'resolved', 'unsupported', 'ignored')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('ok', 'warning', 'critical')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_trail_id BIGINT NULL REFERENCES market_data.provider_error_trail(id) ON DELETE SET NULL,
  evidence JSONB,
  resolved_at TIMESTAMPTZ,
  resolved_by_operation_id TEXT NULL REFERENCES market_data.provider_operations(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider_id, market_code, error_code, source_symbol)
);

CREATE INDEX IF NOT EXISTS idx_provider_unresolved_items_provider_state_seen
  ON market_data.provider_unresolved_items (provider_id, state, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_unresolved_items_market_state_seen
  ON market_data.provider_unresolved_items (market_code, state, last_seen_at DESC);

WITH normalized_errors AS (
  SELECT
    e.id,
    e.provider_id,
    e.occurred_at,
    COALESCE(NULLIF(e.context->>'marketCode', ''), 'KR') AS market_code,
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
    ))) AS source_symbol,
    UPPER(TRIM(COALESCE(
      NULLIF(e.context->>'providerSymbol', ''),
      NULLIF(e.context->>'ticker', ''),
      NULLIF(e.context->>'symbol', ''),
      substring(COALESCE(e.error_message, '') from ':\s*([A-Za-z0-9][A-Za-z0-9.-]{1,20})\s*$')
    ))) AS provider_symbol
  FROM market_data.provider_error_trail e
  WHERE e.error_class <> 'rate_limit'
)
INSERT INTO market_data.provider_unresolved_items (
  provider_id,
  market_code,
  error_code,
  source_symbol,
  provider_symbol,
  state,
  severity,
  occurrence_count,
  first_seen_at,
  last_seen_at,
  last_error_trail_id,
  evidence
)
SELECT
  provider_id,
  market_code,
  error_code,
  source_symbol,
  provider_symbol,
  'active' AS state,
  'warning' AS severity,
  count(*)::integer AS occurrence_count,
  min(occurred_at) AS first_seen_at,
  max(occurred_at) AS last_seen_at,
  max(id) AS last_error_trail_id,
  jsonb_build_object('seededFrom', 'provider_error_trail_backfill') AS evidence
FROM normalized_errors
WHERE source_symbol <> ''
GROUP BY
  provider_id,
  market_code,
  error_code,
  source_symbol,
  provider_symbol
ON CONFLICT (provider_id, market_code, error_code, source_symbol) DO UPDATE
SET provider_symbol = EXCLUDED.provider_symbol,
    state = 'active',
    occurrence_count = market_data.provider_unresolved_items.occurrence_count + EXCLUDED.occurrence_count,
    first_seen_at = LEAST(market_data.provider_unresolved_items.first_seen_at, EXCLUDED.first_seen_at),
    last_seen_at = GREATEST(market_data.provider_unresolved_items.last_seen_at, EXCLUDED.last_seen_at),
    last_error_trail_id = EXCLUDED.last_error_trail_id,
    evidence = COALESCE(market_data.provider_unresolved_items.evidence, '{}'::jsonb) || EXCLUDED.evidence,
    updated_at = NOW();
