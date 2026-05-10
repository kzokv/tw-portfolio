-- KZO-199: app_config Tier B operational constants
--
-- Adds 5 nullable columns. No CHECK constraints (bounds enforced in
-- adminRoutes Zod schema; preserves SQL escape hatch for Tier 2 fields).
-- Mirrors the KZO-198 pattern exactly (migration 047).

ALTER TABLE public.app_config
  -- Tier 1 — sharing knobs (in PATCH schema, in UI)
  ADD COLUMN IF NOT EXISTS anonymous_share_token_cap            INT    NULL,
  ADD COLUMN IF NOT EXISTS anonymous_share_rate_limit_max       INT    NULL,
  ADD COLUMN IF NOT EXISTS anonymous_share_rate_limit_window_ms INT    NULL,
  -- Tier 2 — DB/SQL only (NOT in PATCH schema, NOT in UI)
  ADD COLUMN IF NOT EXISTS anonymous_share_token_retention_ms   BIGINT NULL,
  ADD COLUMN IF NOT EXISTS user_preferences_max_bytes           INT    NULL;

COMMENT ON COLUMN public.app_config.anonymous_share_token_cap IS
  'Tier 1 — max active anonymous share tokens per owner. NULL = use Env.ANONYMOUS_SHARE_TOKEN_CAP (default 20). Bounds: [1, 1000].';
COMMENT ON COLUMN public.app_config.anonymous_share_rate_limit_max IS
  'Tier 1 — max requests per window for anonymous-share endpoints (per IP). NULL = use Env.ANONYMOUS_SHARE_RATE_LIMIT_MAX (default 30). Bounds: [1, 10000].';
COMMENT ON COLUMN public.app_config.anonymous_share_rate_limit_window_ms IS
  'Tier 1 — sliding-window length (ms) for anonymous-share rate limiter. NULL = use Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS (default 300000 / 5 min). Bounds: [1000, 600000].';
COMMENT ON COLUMN public.app_config.anonymous_share_token_retention_ms IS
  'Tier 2 — how long a revoked/expired anonymous share token remains visible/listable. NULL = use Env.ANONYMOUS_SHARE_TOKEN_RETENTION_MS (default 30 days = 2592000000 ms). Bounds: [86400000 (1d), 31536000000 (365d)]. RETENTION COUPLING: must stay <= ANONYMOUS_SHARE_TOKEN_PURGE_DAYS * 86400000 to preserve UI visibility guarantee — purge cron deletes rows the UI would otherwise still surface. SQL/DB-only — not exposed in /admin/settings or PATCH schema.';
COMMENT ON COLUMN public.app_config.user_preferences_max_bytes IS
  'Tier 2 — max body size (bytes) accepted by PATCH /user-preferences. NULL = use Env.USER_PREFERENCES_MAX_BYTES (default 8192). Bounds: [256, 1048576]. Fastify route bodyLimit is fixed at the bound max (1 MiB); this column is the runtime-tunable inner check (mirrors KZO-198 fastify-eviction-lifecycle-pattern: schedule static, parameter live). SQL/DB-only — not exposed in /admin/settings or PATCH schema.';
