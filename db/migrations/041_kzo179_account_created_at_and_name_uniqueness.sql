-- KZO-179: account creation forensic floor + per-user name uniqueness.
--
-- This migration supports the new POST /accounts route in two ways:
--   1. created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() — forensic floor for
--      account-creation events. Per KZO-179 D2, no audit_log entry is written
--      on POST /accounts; created_at is the recoverability replacement.
--      Existing rows backfill to migration-run time (accepted floor).
--      created_at is intentionally NOT exposed on AccountDto in this ticket.
--   2. CREATE UNIQUE INDEX ux_accounts_user_id_name — enforces per-user
--      account-name uniqueness (case-sensitive). The route layer also does an
--      explicit pre-check via routeError(409, "account_name_in_use", ...) for
--      clean UX; this index is the TOCTOU safety net (caught via
--      isUniqueViolation).
--
-- Idempotent. No DO $$ guards needed — both ADD COLUMN IF NOT EXISTS and
-- CREATE UNIQUE INDEX IF NOT EXISTS are natively idempotent in the Postgres
-- versions we target.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_user_id_name
  ON accounts (user_id, name);
