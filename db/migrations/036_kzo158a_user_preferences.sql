-- KZO-159 (158A): user_preferences table + admin dashboard_performance_ranges column
--
-- Adds a per-user JSONB preferences row (lazy-insert on first PATCH) and an
-- admin-facing override column for the default dashboard timeframe list.
-- Idempotent (safe to re-apply) via IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--
-- user_id is TEXT to match the existing users.id TEXT PK (see design D1).
-- No audit_log_action_check changes — user-pref edits are not audited
-- (admin changes to dashboard_performance_ranges reuse the existing
-- app_config_updated action).

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS dashboard_performance_ranges JSONB NULL;
