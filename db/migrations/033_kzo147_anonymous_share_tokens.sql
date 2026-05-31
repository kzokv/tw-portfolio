-- KZO-147: anonymous share tokens (public read-only route)
-- Adds per-owner token table with revocation + expiry metadata and audit actions.

CREATE TABLE IF NOT EXISTS anonymous_share_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_anonymous_share_tokens_owner_created_at
  ON anonymous_share_tokens(owner_user_id, created_at DESC);

-- Partial index for active (non-revoked) tokens. Expiry is filtered in the
-- application layer because NOW() is not immutable and cannot be used here.
CREATE INDEX IF NOT EXISTS idx_anonymous_share_tokens_owner_not_revoked
  ON anonymous_share_tokens(owner_user_id)
  WHERE revoked_at IS NULL;

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
      'share_token_created',
      'share_token_revoked',
      'session_force_logout'
    )
  );
END $$;
