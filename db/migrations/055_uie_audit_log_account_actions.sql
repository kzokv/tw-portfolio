-- ui-enhancement: extend audit_log.action CHECK with the 3 new account
-- lifecycle actions. Mirrors `AuditLogAction` in
-- `apps/api/src/persistence/types.ts` exactly. Preserves every existing
-- action from migration 049 (KZO-195) — re-asserting them keeps the
-- constraint internally consistent.
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
      -- ui-enhancement — account lifecycle actions.
      'account_soft_deleted',
      'account_restored',
      'account_hard_purged'
    )
  );
END $$;
