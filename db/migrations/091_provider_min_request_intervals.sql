ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS finmind_provider_min_request_interval_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS twelve_data_provider_min_request_interval_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS yahoo_au_provider_min_request_interval_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS yahoo_kr_provider_min_request_interval_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS frankfurter_provider_min_request_interval_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS asx_gics_provider_min_request_interval_ms BIGINT NULL;

ALTER TABLE public.app_config
  DROP CONSTRAINT IF EXISTS app_config_finmind_provider_min_request_interval_ms_check,
  DROP CONSTRAINT IF EXISTS app_config_twelve_data_provider_min_request_interval_ms_check,
  DROP CONSTRAINT IF EXISTS app_config_yahoo_au_provider_min_request_interval_ms_check,
  DROP CONSTRAINT IF EXISTS app_config_yahoo_kr_provider_min_request_interval_ms_check,
  DROP CONSTRAINT IF EXISTS app_config_frankfurter_provider_min_request_interval_ms_check,
  DROP CONSTRAINT IF EXISTS app_config_asx_gics_provider_min_request_interval_ms_check;

ALTER TABLE public.app_config
  ADD CONSTRAINT app_config_finmind_provider_min_request_interval_ms_check
    CHECK (
      finmind_provider_min_request_interval_ms IS NULL
      OR (finmind_provider_min_request_interval_ms >= 0 AND finmind_provider_min_request_interval_ms <= 60000)
    ),
  ADD CONSTRAINT app_config_twelve_data_provider_min_request_interval_ms_check
    CHECK (
      twelve_data_provider_min_request_interval_ms IS NULL
      OR (twelve_data_provider_min_request_interval_ms >= 0 AND twelve_data_provider_min_request_interval_ms <= 60000)
    ),
  ADD CONSTRAINT app_config_yahoo_au_provider_min_request_interval_ms_check
    CHECK (
      yahoo_au_provider_min_request_interval_ms IS NULL
      OR (yahoo_au_provider_min_request_interval_ms >= 0 AND yahoo_au_provider_min_request_interval_ms <= 60000)
    ),
  ADD CONSTRAINT app_config_yahoo_kr_provider_min_request_interval_ms_check
    CHECK (
      yahoo_kr_provider_min_request_interval_ms IS NULL
      OR (yahoo_kr_provider_min_request_interval_ms >= 0 AND yahoo_kr_provider_min_request_interval_ms <= 60000)
    ),
  ADD CONSTRAINT app_config_frankfurter_provider_min_request_interval_ms_check
    CHECK (
      frankfurter_provider_min_request_interval_ms IS NULL
      OR (frankfurter_provider_min_request_interval_ms >= 0 AND frankfurter_provider_min_request_interval_ms <= 60000)
    ),
  ADD CONSTRAINT app_config_asx_gics_provider_min_request_interval_ms_check
    CHECK (
      asx_gics_provider_min_request_interval_ms IS NULL
      OR (asx_gics_provider_min_request_interval_ms >= 0 AND asx_gics_provider_min_request_interval_ms <= 60000)
    );

COMMENT ON COLUMN public.app_config.finmind_provider_min_request_interval_ms IS
  'Minimum spacing between FinMind requests in ms. NULL = internal default, 0 = disabled.';
COMMENT ON COLUMN public.app_config.twelve_data_provider_min_request_interval_ms IS
  'Minimum spacing between Twelve Data requests in ms. NULL = internal default, 0 = disabled.';
COMMENT ON COLUMN public.app_config.yahoo_au_provider_min_request_interval_ms IS
  'Minimum spacing between Yahoo AU requests in ms. NULL = internal default, 0 = disabled.';
COMMENT ON COLUMN public.app_config.yahoo_kr_provider_min_request_interval_ms IS
  'Minimum spacing between Yahoo KR requests in ms. NULL = internal default, 0 = disabled.';
COMMENT ON COLUMN public.app_config.frankfurter_provider_min_request_interval_ms IS
  'Minimum spacing between Frankfurter requests in ms. NULL = internal default, 0 = disabled.';
COMMENT ON COLUMN public.app_config.asx_gics_provider_min_request_interval_ms IS
  'Minimum spacing between ASX GICS requests in ms. NULL = internal default, 0 = disabled.';
