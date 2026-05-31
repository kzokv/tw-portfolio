-- ui-enhancement: admin-tunable grace period (days) before soft-deleted
-- accounts are hard-purged by the daily cron. NULL → use
-- Env.ACCOUNT_HARD_PURGE_DAYS (default 30).
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS account_hard_purge_days INT NULL;

COMMENT ON COLUMN public.app_config.account_hard_purge_days IS
  'ui-enhancement — Tier-B operational constant. Grace period (days) between account_soft_deleted and cron-driven account_hard_purged. NULL = use Env.ACCOUNT_HARD_PURGE_DAYS (default 30). Bounds: [1, 365].';
