-- KZO-216 — Valuation-health thresholds + route-cache policy scalars.
-- Flat nullable columns only; NULL means "use code default".

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS valuation_health_relative_bps INTEGER NULL,
  ADD COLUMN IF NOT EXISTS valuation_health_absolute_aud NUMERIC(18,2) NULL,
  ADD COLUMN IF NOT EXISTS valuation_health_absolute_usd NUMERIC(18,2) NULL,
  ADD COLUMN IF NOT EXISTS valuation_health_absolute_twd NUMERIC(18,2) NULL,
  ADD COLUMN IF NOT EXISTS valuation_health_absolute_krw NUMERIC(18,2) NULL,
  ADD COLUMN IF NOT EXISTS route_cache_policy_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS route_cache_dashboard_primary_ttl_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS route_cache_dashboard_enrichment_ttl_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS route_cache_dashboard_performance_ttl_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS route_cache_portfolio_ttl_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS route_cache_reports_ttl_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS route_cache_stale_usable_ttl_ms BIGINT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'app_config_route_cache_policy_mode_check'
       AND conrelid = 'public.app_config'::regclass
  ) THEN
    ALTER TABLE public.app_config DROP CONSTRAINT app_config_route_cache_policy_mode_check;
  END IF;
  ALTER TABLE public.app_config
    ADD CONSTRAINT app_config_route_cache_policy_mode_check
    CHECK (
      route_cache_policy_mode IS NULL
      OR route_cache_policy_mode IN ('fresh', 'balanced', 'low_load', 'custom')
    );
END $$;

COMMENT ON COLUMN public.app_config.valuation_health_relative_bps IS
  'Valuation mismatch materiality threshold in basis points. NULL uses code default.';
COMMENT ON COLUMN public.app_config.valuation_health_absolute_aud IS
  'Valuation mismatch absolute threshold in AUD. NULL uses code default.';
COMMENT ON COLUMN public.app_config.valuation_health_absolute_usd IS
  'Valuation mismatch absolute threshold in USD. NULL uses code default.';
COMMENT ON COLUMN public.app_config.valuation_health_absolute_twd IS
  'Valuation mismatch absolute threshold in TWD. NULL uses code default.';
COMMENT ON COLUMN public.app_config.valuation_health_absolute_krw IS
  'Valuation mismatch absolute threshold in KRW. NULL uses code default.';
COMMENT ON COLUMN public.app_config.route_cache_policy_mode IS
  'Route DTO cache policy preset. NULL uses the code default preset.';
COMMENT ON COLUMN public.app_config.route_cache_dashboard_primary_ttl_ms IS
  'Custom dashboard primary DTO TTL in ms. Used when route_cache_policy_mode = custom.';
COMMENT ON COLUMN public.app_config.route_cache_dashboard_enrichment_ttl_ms IS
  'Custom dashboard enrichment DTO TTL in ms. Used when route_cache_policy_mode = custom.';
COMMENT ON COLUMN public.app_config.route_cache_dashboard_performance_ttl_ms IS
  'Custom dashboard performance DTO TTL in ms. Used when route_cache_policy_mode = custom.';
COMMENT ON COLUMN public.app_config.route_cache_portfolio_ttl_ms IS
  'Custom portfolio DTO TTL in ms. Used when route_cache_policy_mode = custom.';
COMMENT ON COLUMN public.app_config.route_cache_reports_ttl_ms IS
  'Custom reports DTO TTL in ms. Used when route_cache_policy_mode = custom.';
COMMENT ON COLUMN public.app_config.route_cache_stale_usable_ttl_ms IS
  'Custom stale-usable DTO window in ms. Used when route_cache_policy_mode = custom.';
