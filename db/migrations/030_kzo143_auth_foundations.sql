DO $$
DECLARE
  duplicate_emails TEXT;
BEGIN
  SELECT string_agg(format('%s (%s)', lower_email, duplicate_count), ', ' ORDER BY lower_email)
    INTO duplicate_emails
  FROM (
    SELECT LOWER(email) AS lower_email, COUNT(*) AS duplicate_count
    FROM users
    WHERE email IS NOT NULL
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_emails IS NOT NULL THEN
    RAISE EXCEPTION
      'KZO-143 migration aborted: duplicate lowercase emails require manual cleanup: %',
      duplicate_emails;
  END IF;
END $$;

UPDATE users
SET email = LOWER(email)
WHERE email IS NOT NULL
  AND email <> LOWER(email);

DROP INDEX IF EXISTS ux_users_email;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower
  ON users(LOWER(email))
  WHERE email IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_users_email_lowercase'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_email_lowercase
      CHECK (email IS NULL OR email = LOWER(email));
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_users_role'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_role
      CHECK (role IN ('admin', 'member', 'viewer'));
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = LOWER(email)),
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  issued_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invites_active_email
  ON invites(email)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invites_active_expires_at
  ON invites(expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL CHECK (
    action IN (
      'admin_promote_cli',
      'admin_promote_startup',
      'admin_promote_first_signin'
    )
  ),
  target_user_id TEXT REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at_desc
  ON audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created_at_desc
  ON audit_log(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_target_created_at_desc
  ON audit_log(target_user_id, created_at DESC);
