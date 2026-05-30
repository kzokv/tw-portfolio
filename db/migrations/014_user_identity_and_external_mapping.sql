-- Migration 014: Add user identity fields (display_name, timestamps, lifecycle
-- markers) and external identity mapping table for OAuth provider resolution.

-- 1a. Alter users table -------------------------------------------------------

-- Make email nullable (mutable profile data, not durable identity)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Email is the identity-resolution key (KZO-77); enforce uniqueness.
-- Partial index: only non-NULL emails must be unique (dev_bypass users may have NULL email).
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email
  ON users(email) WHERE email IS NOT NULL;

-- Add display name
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Add timestamps
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add lifecycle placeholders (enforced by KZO-80/81)
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- 1b. Create user_external_identities table -----------------------------------

CREATE TABLE IF NOT EXISTS user_external_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  provider_email TEXT,
  provider_display_name TEXT,
  provider_picture_url TEXT,
  linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_uei_provider CHECK (provider ~ '^[a-z][a-z0-9_]{0,49}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_uei_provider_subject
  ON user_external_identities(provider, provider_subject);

CREATE INDEX IF NOT EXISTS idx_uei_user_id
  ON user_external_identities(user_id);
