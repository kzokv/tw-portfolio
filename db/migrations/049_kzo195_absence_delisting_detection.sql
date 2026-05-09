-- KZO-195 — Absence-based delisting detection (AU-first; capability-flag enabled).
--
-- Adds three columns to `market_data.instruments` for diff-based delisting:
--   * last_seen_in_catalog_at  — wall-clock timestamp of the most recent catalog
--                                 sync that observed this ticker. NULL means the
--                                 row has never been observed by an absence-feed
--                                 capable provider. AU rows are backfilled to
--                                 `updated_at` at migration time so the first
--                                 post-migration sync starts from a sane baseline
--                                 instead of stamping every row as "never seen".
--   * absence_streak           — consecutive runs the ticker has been ABSENT
--                                 from the catalog. Bumped on each sync when the
--                                 ticker is missing; reset to 0 when present.
--                                 Threshold-driven stamp uses streak+1 against
--                                 `app_config.catalog_absence_threshold`.
--   * delisting_detection_excluded — admin opt-out flag. When TRUE the row is
--                                 NEVER a candidate for absence-based stamping,
--                                 regardless of streak. Used for known-quirky
--                                 instruments (LICs, paused trading, etc.).
--
-- Adds three columns to `public.app_config` (Tier 2 hybrid env+app_config per
-- KZO-198 pattern). NULL means "fall back to env default."
--
-- Per `.claude/rules/migration-strategy.md`: NEW migration file (049) — does
-- not edit prior migrations. Per `.claude/rules/integration-test-persistence-direct.md`:
-- columns live in `market_data.instruments` (schema-qualified everywhere).

ALTER TABLE market_data.instruments
  ADD COLUMN IF NOT EXISTS last_seen_in_catalog_at      TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS absence_streak               INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delisting_detection_excluded BOOLEAN  NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN market_data.instruments.last_seen_in_catalog_at IS
  'KZO-195 — wall-clock timestamp of the most recent catalog sync run that observed this ticker. NULL = never observed by an absence-feed-capable provider (legacy LICs, TW/US rows pre-AU rollout). Set to NOW() on present, untouched on absent.';
COMMENT ON COLUMN market_data.instruments.absence_streak IS
  'KZO-195 — consecutive catalog-sync runs in which the ticker was ABSENT. Reset to 0 on any present row; bumped by 1 on absent rows that are detection candidates. Stamped delisted when streak >= app_config.catalog_absence_threshold.';
COMMENT ON COLUMN market_data.instruments.delisting_detection_excluded IS
  'KZO-195 — admin opt-out flag. TRUE = never a candidate for absence-based delisting, regardless of streak. Toggled via POST /admin/instruments/:ticker/:marketCode/exclude.';

-- One-shot AU backfill so the first post-migration sync has a non-NULL baseline
-- to compare against. TW/US are intentionally NOT backfilled: their providers
-- (FinMind) have a real delisting feed via `fetchDelistingHistory()` and never
-- consult `last_seen_in_catalog_at`. Keeping their rows NULL means absence-feed
-- semantics never accidentally activate for those markets.
UPDATE market_data.instruments
   SET last_seen_in_catalog_at = updated_at
 WHERE market_code = 'AU'
   AND is_provisional = FALSE
   AND last_seen_in_catalog_at IS NULL;

-- Tier 2 hybrid env+app_config knobs. NULL means "fall back to env default."
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS catalog_absence_threshold      INT           NULL,
  ADD COLUMN IF NOT EXISTS catalog_absence_guard_percent  NUMERIC(5,2)  NULL,
  ADD COLUMN IF NOT EXISTS catalog_absence_guard_floor    INT           NULL;

COMMENT ON COLUMN public.app_config.catalog_absence_threshold IS
  'KZO-195 — number of consecutive absences before a ticker is stamped delisted. NULL = use Env.CATALOG_ABSENCE_THRESHOLD (default 3).';
COMMENT ON COLUMN public.app_config.catalog_absence_guard_percent IS
  'KZO-195 — mass-delisting safety guard. If |candidates| > prevCatalogSize * this/100, skip the run (no streak bumps, no stamps). NULL = use Env.CATALOG_ABSENCE_GUARD_PERCENT (default 1.0).';
COMMENT ON COLUMN public.app_config.catalog_absence_guard_floor IS
  'KZO-195 — minimum guard ceiling for small catalogs. Effective ceiling = max(this, prevCatalogSize * percent / 100). NULL = use Env.CATALOG_ABSENCE_GUARD_FLOOR (default 5).';

-- Extend the audit_log CHECK constraint with KZO-195's new action codes.
-- Includes the four codes this ticket adds + `provider_health_rerun` from
-- KZO-177 which was missed in earlier migrations (re-asserting it here keeps
-- the constraint internally consistent with `AuditLogAction` in
-- `apps/api/src/persistence/types.ts`).
DO $$ BEGIN
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
      'impersonation_start',
      'impersonation_end',
      'impersonation_blocked_write',
      'session_force_logout',
      'app_config_updated',
      'admin_fx_rates_refresh',
      'fx_transfer_created',
      'fx_transfer_updated',
      'fx_transfer_reversed',
      'provider_health_rerun',
      'instrument_undelete',
      'instrument_exclusion_toggle',
      'instrument_delisted_via_absence',
      'instrument_absence_streak_bumped',
      'instrument_absence_guard_tripped'
    )
  );
END $$;
