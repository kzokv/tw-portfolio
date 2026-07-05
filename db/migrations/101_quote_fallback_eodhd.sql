-- EODHD quote fallback policies and snapshots.
-- Generic policy model; v1 implementation validates AU + EODHD EOD only.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS eodhd_api_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS eodhd_daily_call_limit INTEGER NULL;

ALTER TABLE public.app_config
  DROP CONSTRAINT IF EXISTS app_config_eodhd_daily_call_limit_check;

ALTER TABLE public.app_config
  ADD CONSTRAINT app_config_eodhd_daily_call_limit_check
  CHECK (eodhd_daily_call_limit IS NULL OR (eodhd_daily_call_limit >= 1 AND eodhd_daily_call_limit <= 1000));

COMMENT ON COLUMN public.app_config.eodhd_api_key IS
  'Encrypted EODHD API key override. NULL = fall back to Env.EODHD_API_KEY.';
COMMENT ON COLUMN public.app_config.eodhd_daily_call_limit IS
  'Strict local daily outbound EODHD call budget. NULL = fall back to Env.EODHD_DAILY_CALL_LIMIT.';

CREATE TABLE IF NOT EXISTS market_data.quote_fallback_policies (
  id TEXT PRIMARY KEY,
  market_code TEXT NOT NULL CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'JP')),
  ticker TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('eodhd')),
  price_type TEXT NOT NULL CHECK (price_type IN ('eod_close')),
  provider_symbol TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ NULL,
  last_refresh_status TEXT NULL CHECK (
    last_refresh_status IS NULL OR last_refresh_status IN ('success', 'warning', 'error', 'skipped', 'rate_limited')
  ),
  last_refresh_at TIMESTAMPTZ NULL,
  last_refresh_error TEXT NULL,
  last_refresh_error_code TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_quote_fallback_policy_identity
  ON market_data.quote_fallback_policies (market_code, ticker, provider, price_type);

CREATE INDEX IF NOT EXISTS idx_quote_fallback_policies_active_market
  ON market_data.quote_fallback_policies (market_code, active, ticker);

CREATE TABLE IF NOT EXISTS market_data.quote_fallback_snapshots (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES market_data.quote_fallback_policies(id) ON DELETE CASCADE,
  market_code TEXT NOT NULL CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'JP')),
  ticker TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('eodhd')),
  price_type TEXT NOT NULL CHECK (price_type IN ('eod_close')),
  provider_symbol TEXT NOT NULL,
  market_date DATE NOT NULL,
  close NUMERIC(24, 8) NOT NULL,
  previous_close NUMERIC(24, 8) NULL,
  currency TEXT NOT NULL,
  currency_source TEXT NOT NULL CHECK (currency_source IN ('provider', 'market_default')),
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  provider_payload_hash TEXT NULL,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_quote_fallback_snapshots_policy_date
  ON market_data.quote_fallback_snapshots (policy_id, market_date);

CREATE INDEX IF NOT EXISTS idx_quote_fallback_snapshots_market_ticker_date
  ON market_data.quote_fallback_snapshots (market_code, ticker, market_date DESC);

CREATE TABLE IF NOT EXISTS market_data.eodhd_call_budget_usage (
  budget_date DATE PRIMARY KEY,
  call_count INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (
  action IN (
    'admin_promote_cli',
    'admin_promote_startup',
    'admin_promote_first_signin',
    'admin_role_change',
    'admin_disable_user',
    'admin_enable_user',
    'admin_delete_user',
    'admin_hard_purge_user',
    'admin_invite_issued',
    'admin_invite_revoked',
    'share_granted',
    'share_revoked',
    'share_capabilities_updated',
    'ai_connector_connected',
    'ai_connector_revoked',
    'ai_connector_expired',
    'share_token_created',
    'share_token_revoked',
    'impersonation_start',
    'impersonation_end',
    'impersonation_blocked_write',
    'session_force_logout',
    'app_config_updated',
    'admin_fx_rates_refresh',
    'fx_transfer_created',
    'fx_transfer_updated',
    'fx_transfer_reversed',
    'provider_health_rerun',
    'provider_fixer_operation',
    'instrument_undelete',
    'instrument_exclusion_toggle',
    'instrument_delisted_via_absence',
    'instrument_absence_streak_bumped',
    'instrument_absence_guard_tripped',
    'delegated_portfolio_write',
    'market_calendar_previewed',
    'market_calendar_confirmed',
    'market_calendar_invalidated',
    'market_calendar_source_updated',
    'account_soft_deleted',
    'account_restored',
    'account_hard_purged',
    'quote_fallback_policy_created',
    'quote_fallback_policy_updated',
    'quote_fallback_policy_deactivated',
    'quote_fallback_manual_refresh_requested'
  )
);
