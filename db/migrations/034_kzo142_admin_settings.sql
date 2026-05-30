-- KZO-142: Admin Settings UI
-- Adds app_config_updated to the audit_log action CHECK constraint.

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
      'session_force_logout',
      'app_config_updated'
    )
  );
END $$;
