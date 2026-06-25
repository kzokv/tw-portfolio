-- JP market support: widen market/currency checks and seed JP provider/calendar rows.

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS ck_accounts_default_currency;

ALTER TABLE accounts
  ADD CONSTRAINT ck_accounts_default_currency
  CHECK (default_currency IN ('TWD', 'USD', 'AUD', 'KRW', 'JPY'));

CREATE OR REPLACE FUNCTION currency_to_market(currency TEXT)
RETURNS TEXT
IMMUTABLE
LANGUAGE plpgsql
AS $$
BEGIN
  IF currency = 'TWD' THEN RETURN 'TW'; END IF;
  IF currency = 'USD' THEN RETURN 'US'; END IF;
  IF currency = 'AUD' THEN RETURN 'AU'; END IF;
  IF currency = 'KRW' THEN RETURN 'KR'; END IF;
  IF currency = 'JPY' THEN RETURN 'JP'; END IF;
  RAISE EXCEPTION 'invalid_currency_for_market: %', currency
    USING ERRCODE = '23514';
END $$;

DO $$
DECLARE
  existing_constraint TEXT;
BEGIN
  SELECT conname
    INTO existing_constraint
    FROM pg_constraint
   WHERE conrelid = 'market_data.ticker_fundamentals'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%market_code%'
   LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE market_data.ticker_fundamentals DROP CONSTRAINT %I',
      existing_constraint
    );
  END IF;

  ALTER TABLE market_data.ticker_fundamentals
    ADD CONSTRAINT ck_ticker_fundamentals_market_code
    CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'JP'));
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

ALTER TABLE market_data.provider_operations
  DROP CONSTRAINT IF EXISTS provider_operations_market_code_check;

ALTER TABLE market_data.provider_operations
  ADD CONSTRAINT provider_operations_market_code_check
  CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'JP', 'FX'));

ALTER TABLE market_data.provider_operation_outcomes
  DROP CONSTRAINT IF EXISTS provider_operation_outcomes_market_code_check;

ALTER TABLE market_data.provider_operation_outcomes
  ADD CONSTRAINT provider_operation_outcomes_market_code_check
  CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'JP', 'FX'));

ALTER TABLE market_data.provider_operation_logs
  DROP CONSTRAINT IF EXISTS provider_operation_logs_market_code_check;

ALTER TABLE market_data.provider_operation_logs
  ADD CONSTRAINT provider_operation_logs_market_code_check
  CHECK (market_code IS NULL OR market_code IN ('TW', 'US', 'AU', 'KR', 'JP', 'FX'));

ALTER TABLE market_data.provider_unresolved_items
  DROP CONSTRAINT IF EXISTS provider_unresolved_items_market_code_check;

ALTER TABLE market_data.provider_unresolved_items
  ADD CONSTRAINT provider_unresolved_items_market_code_check
  CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'JP'));

ALTER TABLE market_data.provider_resolution_mappings
  DROP CONSTRAINT IF EXISTS provider_resolution_mappings_market_code_check;

ALTER TABLE market_data.provider_resolution_mappings
  ADD CONSTRAINT provider_resolution_mappings_market_code_check
  CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'JP'));

ALTER TABLE market_data.provider_incidents
  DROP CONSTRAINT IF EXISTS provider_incidents_market_code_check;

ALTER TABLE market_data.provider_incidents
  ADD CONSTRAINT provider_incidents_market_code_check
  CHECK (market_code IS NULL OR market_code IN ('TW', 'US', 'AU', 'KR', 'JP'));

ALTER TABLE public.app_config
  DROP CONSTRAINT IF EXISTS app_config_ticker_price_supported_markets_check;

ALTER TABLE public.app_config
  ADD CONSTRAINT app_config_ticker_price_supported_markets_check
  CHECK (
    ticker_price_supported_markets IS NULL
    OR ticker_price_supported_markets <@ ARRAY['TW', 'US', 'AU', 'KR', 'JP']::text[]
  );

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS yahoo_jp_provider_rate_limit_per_minute INT NULL,
  ADD COLUMN IF NOT EXISTS yahoo_jp_provider_min_request_interval_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS jp_catalog_allowed_stock_types TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS jp_catalog_include_depositary_receipts BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS jp_catalog_include_at_symbols BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS valuation_health_absolute_jpy NUMERIC(18,2) NULL;

ALTER TABLE public.app_config
  DROP CONSTRAINT IF EXISTS app_config_yahoo_jp_provider_rate_limit_per_minute_check,
  DROP CONSTRAINT IF EXISTS app_config_yahoo_jp_provider_min_request_interval_ms_check,
  DROP CONSTRAINT IF EXISTS app_config_jp_catalog_allowed_stock_types_check,
  DROP CONSTRAINT IF EXISTS app_config_valuation_health_absolute_jpy_check;

ALTER TABLE public.app_config
  ADD CONSTRAINT app_config_yahoo_jp_provider_rate_limit_per_minute_check
    CHECK (
      yahoo_jp_provider_rate_limit_per_minute IS NULL
      OR yahoo_jp_provider_rate_limit_per_minute BETWEEN 1 AND 10000
    ),
  ADD CONSTRAINT app_config_yahoo_jp_provider_min_request_interval_ms_check
    CHECK (
      yahoo_jp_provider_min_request_interval_ms IS NULL
      OR (yahoo_jp_provider_min_request_interval_ms >= 0 AND yahoo_jp_provider_min_request_interval_ms <= 60000)
    ),
  ADD CONSTRAINT app_config_jp_catalog_allowed_stock_types_check
    CHECK (
      jp_catalog_allowed_stock_types IS NULL
      OR jp_catalog_allowed_stock_types <@ ARRAY['Common Stock', 'Preferred Stock', 'REIT', 'Depositary Receipt']::text[]
    ),
  ADD CONSTRAINT app_config_valuation_health_absolute_jpy_check
    CHECK (
      valuation_health_absolute_jpy IS NULL
      OR (valuation_health_absolute_jpy >= 0 AND valuation_health_absolute_jpy <= 1000000000)
    );

COMMENT ON COLUMN public.app_config.yahoo_jp_provider_rate_limit_per_minute IS
  'Yahoo Finance JP provider request budget per minute. NULL = env/default.';
COMMENT ON COLUMN public.app_config.yahoo_jp_provider_min_request_interval_ms IS
  'Minimum spacing between Yahoo JP requests in ms. NULL = internal default, 0 = disabled.';
COMMENT ON COLUMN public.app_config.jp_catalog_allowed_stock_types IS
  'JP Twelve Data catalog import stock types. NULL = strict default: Common Stock, Preferred Stock, REIT.';
COMMENT ON COLUMN public.app_config.jp_catalog_include_depositary_receipts IS
  'JP Twelve Data catalog import override for Depositary Receipt stock rows. NULL/false = strict exclusion.';
COMMENT ON COLUMN public.app_config.jp_catalog_include_at_symbols IS
  'JP Twelve Data catalog import override for symbols containing @. NULL/false = strict exclusion.';
COMMENT ON COLUMN public.app_config.valuation_health_absolute_jpy IS
  'Absolute valuation-health materiality threshold for JPY reporting currency. NULL = code default.';

INSERT INTO market_data.provider_health_status (provider_id, status)
VALUES
  ('yahoo-finance-jp', 'down'),
  ('twelve-data-jp', 'down')
ON CONFLICT (provider_id) DO NOTHING;

INSERT INTO market_data.market_calendar_sources
  (id, market_code, label, source_type, suggested_source_url, enabled, is_default)
VALUES
  ('official-jp', 'JP', 'JP official calendar', 'official_source', 'https://www.jpx.co.jp/english/corporate/about-jpx/calendar/', TRUE, TRUE)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label,
      source_type = EXCLUDED.source_type,
      suggested_source_url = EXCLUDED.suggested_source_url,
      enabled = EXCLUDED.enabled,
      is_default = EXCLUDED.is_default,
      updated_at = NOW();
