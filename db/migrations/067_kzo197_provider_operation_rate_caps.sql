-- KZO-197 Provider Console V2: admin-configurable provider operation budgets.
--
-- Values are UI-editable caps that must stay within the deployment's upstream
-- or defensive provider budget. NULL means use the environment budget. The API enforces the
-- deployment-specific upper bound before writing these fields.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS finmind_provider_rate_limit_per_hour INTEGER,
  ADD COLUMN IF NOT EXISTS twelve_data_provider_rate_limit_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS yahoo_au_provider_rate_limit_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS yahoo_kr_provider_rate_limit_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS frankfurter_provider_rate_limit_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS asx_gics_provider_rate_limit_per_hour INTEGER;

COMMENT ON COLUMN public.app_config.finmind_provider_rate_limit_per_hour IS
  'Provider operations budget cap for the shared FinMind TW/US upstream budget. NULL = use FINMIND_RATE_LIMIT_PER_HOUR. Must be >0 and below the env upstream budget.';
COMMENT ON COLUMN public.app_config.twelve_data_provider_rate_limit_per_minute IS
  'Provider operations budget cap for the shared Twelve Data AU/KR upstream budget. NULL = use TWELVE_DATA_RATE_LIMIT_PER_MINUTE. Must be >0 and below the env upstream budget.';
COMMENT ON COLUMN public.app_config.yahoo_au_provider_rate_limit_per_minute IS
  'Provider operations budget cap for Yahoo Finance AU. NULL = use YAHOO_AU_RATE_LIMIT_PER_MINUTE. Must be >0 and below the env upstream budget.';
COMMENT ON COLUMN public.app_config.yahoo_kr_provider_rate_limit_per_minute IS
  'Provider operations budget cap for Yahoo Finance KR. NULL = use YAHOO_KR_RATE_LIMIT_PER_MINUTE. Must be >0 and below the env upstream budget.';
COMMENT ON COLUMN public.app_config.frankfurter_provider_rate_limit_per_minute IS
  'Provider operations budget cap for Frankfurter FX refreshes. NULL = use FRANKFURTER_RATE_LIMIT_PER_MINUTE. Must be >0 and below the env provider budget.';
COMMENT ON COLUMN public.app_config.asx_gics_provider_rate_limit_per_hour IS
  'Provider operations budget cap for ASX GICS CSV refreshes. NULL = use ASX_GICS_RATE_LIMIT_PER_HOUR. Must be >0 and below the env provider budget.';
