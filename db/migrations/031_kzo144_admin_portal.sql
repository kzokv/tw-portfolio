-- KZO-144: Admin Management Portal
-- Extends audit_log CHECK constraint with 8 new action types.
-- Changes FK policies on audit_log and invites to ON DELETE SET NULL
-- so audit entries survive hard-purge of the referenced user.

-- 1. Expand audit_log action CHECK constraint
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
      'session_force_logout'
    )
  );
END $$;

-- 2. ALTER audit_log.actor_user_id FK to ON DELETE SET NULL
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'audit_log'::regclass
    AND confrelid = 'users'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'audit_log'::regclass AND attname = 'actor_user_id'
    )];

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE audit_log DROP CONSTRAINT %I', fk_name);
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_actor_user_id_fkey
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. ALTER audit_log.target_user_id FK to ON DELETE SET NULL
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'audit_log'::regclass
    AND confrelid = 'users'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'audit_log'::regclass AND attname = 'target_user_id'
    )];

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE audit_log DROP CONSTRAINT %I', fk_name);
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_target_user_id_fkey
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. ALTER invites.issued_by_user_id FK to ON DELETE SET NULL
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'invites'::regclass
    AND confrelid = 'users'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'invites'::regclass AND attname = 'issued_by_user_id'
    )];

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE invites DROP CONSTRAINT %I', fk_name);
    ALTER TABLE invites
      ADD CONSTRAINT invites_issued_by_user_id_fkey
      FOREIGN KEY (issued_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
