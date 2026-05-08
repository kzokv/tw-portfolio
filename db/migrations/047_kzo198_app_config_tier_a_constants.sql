-- KZO-198: app_config Tier A operational constants
--
-- Adds 19 nullable columns to the singleton app_config row covering
-- rate limits, provider health levers, backfill knobs, SSE knobs, and
-- two encrypted Tier 0 secrets (FinMind + Twelve Data API tokens).
--
-- Per `.claude/rules/migration-strategy.md`: NO CHECK constraints on these
-- columns — bounds are enforced in the admin route's Zod schema (single
-- source of truth in `apps/api/src/services/appConfig/bounds.ts`). The
-- absence of CHECK constraints preserves the SQL escape hatch for
-- operators handling Tier 2 fields manually.
--
-- Storage shape for Tier 0 secrets:
--   `nonce_b64:ciphertext_with_tag_b64`
-- where the ciphertext+tag is produced by AES-256-GCM with a 12-byte nonce.
-- See `apps/api/src/services/appConfig/encryption.ts`.

ALTER TABLE public.app_config
  -- Tier 0 — encrypted secrets (AES-256-GCM, base64 nonce:ciphertext+tag)
  ADD COLUMN IF NOT EXISTS finmind_api_token            TEXT NULL,
  ADD COLUMN IF NOT EXISTS twelve_data_api_key          TEXT NULL,

  -- Tier 1 / 2 — rate limits (plain typed)
  ADD COLUMN IF NOT EXISTS market_data_price_window_ms          INT NULL,
  ADD COLUMN IF NOT EXISTS market_data_price_limit              INT NULL,
  ADD COLUMN IF NOT EXISTS market_data_search_window_ms         INT NULL,
  ADD COLUMN IF NOT EXISTS market_data_search_limit             INT NULL,
  ADD COLUMN IF NOT EXISTS invite_status_window_ms              INT NULL,
  ADD COLUMN IF NOT EXISTS invite_status_limit                  INT NULL,

  -- Tier 1 / 2 — provider health (plain typed)
  ADD COLUMN IF NOT EXISTS provider_down_notification_suppression_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS provider_error_trail_retention_days       INT    NULL,
  ADD COLUMN IF NOT EXISTS provider_rerun_cooldown_ms                BIGINT NULL,

  -- Tier 1 / 2 — backfill (plain typed)
  ADD COLUMN IF NOT EXISTS backfill_retry_limit                INT    NULL,
  ADD COLUMN IF NOT EXISTS backfill_retry_delay_seconds        INT    NULL,
  ADD COLUMN IF NOT EXISTS backfill_finmind_402_retry_ms       BIGINT NULL,
  ADD COLUMN IF NOT EXISTS daily_refresh_lookback_days         INT    NULL,
  ADD COLUMN IF NOT EXISTS daily_refresh_priority              INT    NULL,

  -- Tier 1 / 2 — SSE (plain typed)
  ADD COLUMN IF NOT EXISTS sse_heartbeat_interval_ms           INT    NULL,
  ADD COLUMN IF NOT EXISTS sse_max_connections_per_user        INT    NULL,
  ADD COLUMN IF NOT EXISTS sse_buffer_default_ttl_ms           BIGINT NULL;

COMMENT ON COLUMN public.app_config.finmind_api_token IS
  'Tier 0 — AES-256-GCM encrypted FinMind API token. Storage: base64(nonce):base64(ciphertext+tag). NULL = use Env.FINMIND_API_TOKEN.';
COMMENT ON COLUMN public.app_config.twelve_data_api_key IS
  'Tier 0 — AES-256-GCM encrypted Twelve Data API key. Storage: base64(nonce):base64(ciphertext+tag). NULL = use Env.TWELVE_DATA_API_KEY.';

COMMENT ON COLUMN public.app_config.market_data_price_window_ms IS
  'Tier 1 — sliding-window length (ms) for /market-data/price per-IP rate limit. NULL = use env default (60_000).';
COMMENT ON COLUMN public.app_config.market_data_price_limit IS
  'Tier 1 — max requests per window for /market-data/price. NULL = use env default (30).';
COMMENT ON COLUMN public.app_config.market_data_search_window_ms IS
  'Tier 1 — sliding-window length (ms) for /market-data/search per-IP rate limit. NULL = derived from MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE.';
COMMENT ON COLUMN public.app_config.market_data_search_limit IS
  'Tier 1 — max requests per window for /market-data/search. NULL = use Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE (default 20/min).';
COMMENT ON COLUMN public.app_config.invite_status_window_ms IS
  'Tier 1 — sliding-window length (ms) for /sharing/invite-status per-IP rate limit. NULL = use env default (60_000).';
COMMENT ON COLUMN public.app_config.invite_status_limit IS
  'Tier 1 — max requests per window for /sharing/invite-status. NULL = use env default (20).';

COMMENT ON COLUMN public.app_config.provider_down_notification_suppression_ms IS
  'Tier 1 — suppression window (ms) before re-emitting a "provider down" notification for the same provider. NULL = use env default (24h).';
COMMENT ON COLUMN public.app_config.provider_error_trail_retention_days IS
  'Tier 1 — retention (days) for provider_error_trail rows. NULL = use env default (30).';
COMMENT ON COLUMN public.app_config.provider_rerun_cooldown_ms IS
  'Tier 1 — minimum cooldown (ms) between admin "Re-run now" presses for the same provider. NULL = use env default.';

COMMENT ON COLUMN public.app_config.backfill_retry_limit IS
  'Tier 1 — pg-boss retryLimit for the finmind-backfill queue. NULL = use env default (3).';
COMMENT ON COLUMN public.app_config.backfill_retry_delay_seconds IS
  'Tier 1 — pg-boss retryDelay (seconds, exponential backoff base) for the finmind-backfill queue. NULL = use env default (60).';
COMMENT ON COLUMN public.app_config.backfill_finmind_402_retry_ms IS
  'Tier 1 — wait window (ms) reported via RateLimitedError when FinMind returns 402. NULL = use env default (60_000).';
COMMENT ON COLUMN public.app_config.daily_refresh_lookback_days IS
  'Tier 2 — number of days back the daily-refresh cron requests bars for. NULL = use env default (7).';
COMMENT ON COLUMN public.app_config.daily_refresh_priority IS
  'Tier 2 — pg-boss priority for daily-refresh enqueues. NULL = use env default (10).';

COMMENT ON COLUMN public.app_config.sse_heartbeat_interval_ms IS
  'Tier 2 — heartbeat interval (ms) on /events SSE connections. NULL = use env default (30_000).';
COMMENT ON COLUMN public.app_config.sse_max_connections_per_user IS
  'Tier 2 — max concurrent SSE connections per user before new connections are rejected. NULL = use env default (20).';
COMMENT ON COLUMN public.app_config.sse_buffer_default_ttl_ms IS
  'Tier 2 — BufferedEventBus per-user buffer TTL (ms). NULL = use env default.';
