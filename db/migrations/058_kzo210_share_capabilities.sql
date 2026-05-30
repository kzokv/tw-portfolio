-- KZO-210 / KZO-213 — explicit AI/MCP share capabilities.
--
-- Rollback notes:
-- - Forward-only. Existing and new shares remain AI-disabled by default because
--   capability rows are opt-in; operational rollback should stop writing new
--   rows rather than dropping these tables.

CREATE TABLE IF NOT EXISTS portfolio_share_capabilities (
  share_id TEXT NOT NULL REFERENCES portfolio_shares(id) ON DELETE CASCADE,
  capability TEXT NOT NULL CHECK (
    capability IN (
      'portfolio:mcp_read',
      'transaction_draft:create',
      'transaction_draft:edit',
      'transaction_draft:archive',
      'transaction_draft:delete',
      'transaction:write'
    )
  ),
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (share_id, capability)
);

CREATE TABLE IF NOT EXISTS pending_share_invite_capabilities (
  invite_code TEXT NOT NULL REFERENCES invites(code) ON DELETE CASCADE,
  capability TEXT NOT NULL CHECK (
    capability IN (
      'portfolio:mcp_read',
      'transaction_draft:create',
      'transaction_draft:edit',
      'transaction_draft:archive',
      'transaction_draft:delete',
      'transaction:write'
    )
  ),
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invite_code, capability)
);

DO $$ BEGIN
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
