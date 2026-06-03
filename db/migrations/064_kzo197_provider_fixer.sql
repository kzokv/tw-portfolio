-- KZO-197: Provider Fixer durable operations, guardrails, KR catalog evidence,
-- and verified provider-symbol mappings.
--
-- Adds:
--   * Provider Fixer app_config guardrail thresholds
--   * KR catalog evidence columns on market_data.instruments
--   * `market_data.provider_operations`
--   * `market_data.provider_operation_logs`
--   * `market_data.provider_resolution_mappings`
--
-- Scope of this migration is additive only. It creates the storage contract
-- needed for guarded provider-fixer execution and KR Yahoo suffix bindings
-- such as `005930 -> yahoo-finance-kr:005930.KS`.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS provider_fixer_dangerous_match_threshold INTEGER,
  ADD COLUMN IF NOT EXISTS provider_fixer_preview_sample_limit INTEGER,
  ADD COLUMN IF NOT EXISTS provider_fixer_ui_page_size INTEGER,
  ADD COLUMN IF NOT EXISTS provider_fixer_auto_pause_failures_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS provider_fixer_preview_token_ttl_minutes INTEGER;

COMMENT ON COLUMN public.app_config.provider_fixer_dangerous_match_threshold IS
  'Provider Fixer guardrail: match count at or above this threshold requires dangerous typed confirmation. NULL means use source-code default.';
COMMENT ON COLUMN public.app_config.provider_fixer_preview_sample_limit IS
  'Provider Fixer guardrail: maximum number of sample rows stored/displayed in previews. NULL means use source-code default.';
COMMENT ON COLUMN public.app_config.provider_fixer_ui_page_size IS
  'Provider Fixer guardrail: default UI page size for diagnostics/log/result tables. NULL means use source-code default.';
COMMENT ON COLUMN public.app_config.provider_fixer_auto_pause_failures_per_minute IS
  'Provider Fixer guardrail: failures per minute threshold for auto-pausing operation-backed jobs. NULL means use source-code default.';
COMMENT ON COLUMN public.app_config.provider_fixer_preview_token_ttl_minutes IS
  'Provider Fixer guardrail: preview token time-to-live in minutes. NULL means use source-code default.';

ALTER TABLE market_data.instruments
  ADD COLUMN IF NOT EXISTS catalog_exchange_raw TEXT,
  ADD COLUMN IF NOT EXISTS catalog_mic_code TEXT;

COMMENT ON COLUMN market_data.instruments.catalog_exchange_raw IS
  'Provider catalog exchange evidence, e.g. Twelve Data KRX/KOSDAQ. Used by Provider Fixer to derive provider-specific symbol candidates.';
COMMENT ON COLUMN market_data.instruments.catalog_mic_code IS
  'Provider catalog MIC evidence, e.g. XKRX/XKOS. Used by Provider Fixer to derive provider-specific symbol candidates.';

CREATE TABLE IF NOT EXISTS market_data.provider_operations (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES market_data.provider_health_status(provider_id),
  market_code TEXT NOT NULL CHECK (market_code IN ('TW', 'US', 'AU', 'KR')),
  operation_type TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'dangerous')),
  phase TEXT NOT NULL CHECK (
    phase IN (
      'diagnose',
      'preview',
      'staged',
      'running',
      'paused',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  error_code TEXT,
  resolver_mode TEXT CHECK (resolver_mode IS NULL OR resolver_mode IN ('chart_probe_v1', 'quote_first', 'catalog_hint')),
  scope_query TEXT,
  snapshot_hash TEXT,
  preview_token_hash TEXT,
  preview_expires_at TIMESTAMPTZ,
  match_count INT,
  sample JSONB,
  metadata JSONB,
  legacy_batch_id TEXT,
  active_batch_id TEXT,
  confirmed_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  staged_at TIMESTAMPTZ,
  actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_operations_provider_market_created
  ON market_data.provider_operations (provider_id, market_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_operations_active_execution
  ON market_data.provider_operations (provider_id, market_code, phase, created_at DESC)
  WHERE phase IN ('staged', 'running', 'paused');

CREATE TABLE IF NOT EXISTS market_data.provider_operation_logs (
  id BIGSERIAL PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES market_data.provider_operations(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (
    phase IN (
      'diagnose',
      'preview',
      'staged',
      'running',
      'paused',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  action TEXT NOT NULL DEFAULT 'operation_log',
  actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  provider_id TEXT,
  market_code TEXT,
  resolver_mode TEXT,
  error_code TEXT,
  batch_id TEXT,
  job_id TEXT,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT NOT NULL,
  context JSONB,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_operation_logs_operation_created
  ON market_data.provider_operation_logs (operation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_data.provider_resolution_mappings (
  provider_id TEXT NOT NULL REFERENCES market_data.provider_health_status(provider_id),
  market_code TEXT NOT NULL CHECK (market_code IN ('TW', 'US', 'AU', 'KR')),
  source_symbol TEXT NOT NULL,
  resolved_symbol TEXT NOT NULL,
  binding_scope TEXT NOT NULL DEFAULT 'ticker_market' CHECK (binding_scope IN ('ticker_market')),
  resolver_mode TEXT CHECK (resolver_mode IS NULL OR resolver_mode IN ('chart_probe_v1', 'quote_first', 'catalog_hint')),
  evidence JSONB,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider_id, market_code, source_symbol)
);

CREATE INDEX IF NOT EXISTS idx_provider_resolution_mappings_provider_market_resolved
  ON market_data.provider_resolution_mappings (provider_id, market_code, resolved_symbol);

DO $$
BEGIN
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
      'account_soft_deleted',
      'account_restored',
      'account_hard_purged'
    )
  );
END $$;
