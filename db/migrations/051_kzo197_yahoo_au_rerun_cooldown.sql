-- KZO-197: per-provider rerun cooldown override for yahoo-finance-au.
-- Default (NULL) falls back to env Env.YAHOO_AU_RERUN_COOLDOWN_MS (30 min).
-- Other providers continue to use Env.PROVIDER_RERUN_COOLDOWN_MS (60 s).
--
-- Per `.claude/rules/migration-strategy.md`: NEW migration file (never amend a
-- merged migration). Per the same rule's guidance for `app_config`: no CHECK
-- constraint — bounds live in `apps/api/src/services/appConfig/bounds.ts`
-- (single source of truth). The new column is plain BIGINT NULL, mirroring
-- the KZO-198 sibling additions (e.g. `provider_rerun_cooldown_ms`).
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS yahoo_au_rerun_cooldown_ms BIGINT NULL;

COMMENT ON COLUMN public.app_config.yahoo_au_rerun_cooldown_ms IS
  'Tier 1 — minimum cooldown (ms) between admin "Re-run now" presses for yahoo-finance-au specifically. NULL = use Env.YAHOO_AU_RERUN_COOLDOWN_MS (30 min default). Other providers continue to use Env.PROVIDER_RERUN_COOLDOWN_MS (60 s).';
