-- ui-enhancement: soft-delete column on accounts.
-- - Nullable; NULL means "active".
-- - Set by DELETE /accounts/:id (soft delete).
-- - Cleared by POST /accounts/:id/restore.
-- - Selected by the daily hard-purge cron after grace period.
--
-- KZO-179 ux_accounts_user_id_name (unique by (user_id, name)) is REPLACED
-- by a partial unique index that only considers active rows. Soft-deleted
-- rows can therefore retain their `name` without blocking a fresh create
-- with the same name; the restore path then auto-renames on collision.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Partial index supports the cron's "select for purge" query and read-path
-- filters (`WHERE deleted_at IS NULL`).
CREATE INDEX IF NOT EXISTS idx_accounts_deleted_at
  ON accounts (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Replace the unique index with an active-only partial unique index.
-- (DROP first; CREATE second — the new index has a different name so a
-- transient single-index-window is acceptable.)
DROP INDEX IF EXISTS ux_accounts_user_id_name;
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_user_id_name_active
  ON accounts (user_id, name)
  WHERE deleted_at IS NULL;
