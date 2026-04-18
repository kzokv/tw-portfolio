-- KZO-145 / KZO-146: user-to-user portfolio sharing
-- Adds share grants, share-coupled pending invites, and audit action support.

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS share_owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invites_share_pending
  ON invites(share_owner_user_id)
  WHERE share_owner_user_id IS NOT NULL
    AND used_at IS NULL
    AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS portfolio_shares (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grantee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_portfolio_shares_owner_grantee_active
  ON portfolio_shares(owner_user_id, grantee_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_shares_owner_created_at
  ON portfolio_shares(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_shares_grantee_created_at
  ON portfolio_shares(grantee_user_id, created_at DESC);

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
      'session_force_logout'
    )
  );
END $$;
