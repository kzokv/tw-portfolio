/**
 * KZO-198 — TTL cache over the singleton `app_config` row.
 *
 * Per design.md §1 / §5:
 *   - TTL = 8s (within the locked 5–10s window).
 *   - Pre-warmed via `app.ready()` in `app.ts`.
 *   - Cache miss / pending / load-failure → `getEntry()` returns `null` and
 *     resolvers fall back to `Env.*`.
 *   - PATCH writes call `invalidate()` so the next read pulls fresh from DB.
 *   - Tier 0 secrets are stored ENCRYPTED in the cache; resolvers decrypt on
 *     read. Decryption failures don't poison the cache; they bubble as
 *     `AppConfigDecryptError`, the resolver catches + falls back.
 *
 * Cross-instance invalidation is out of scope (KZO-121 follow-up). Other
 * instances will see stale values up to TTL.
 */
import type { Persistence } from "../../persistence/types.js";

/**
 * The full app_config row shape exposed to resolvers. NULL means "no DB
 * override; fall back to env." All Tier 0 secrets are stored as their raw
 * encrypted storage shape (`nonce_b64:ct+tag_b64`); resolvers decrypt them.
 */
export interface AppConfigCacheEntry {
  // Existing fields (KZO-133 / KZO-159 / KZO-189)
  repairCooldownMinutes: number | null;
  dashboardPerformanceRanges: string[] | null;
  metadataEnrichmentMode: "unconditional" | "conditional" | null;

  // Tier 0 — encrypted secrets
  finmindApiTokenEncrypted: string | null;
  twelveDataApiKeyEncrypted: string | null;
  mcpOauthTokenSecretEncrypted: string | null;

  // Tier 1 / 2 — rate limits
  marketDataPriceWindowMs: number | null;
  marketDataPriceLimit: number | null;
  marketDataSearchWindowMs: number | null;
  marketDataSearchLimit: number | null;
  inviteStatusWindowMs: number | null;
  inviteStatusLimit: number | null;

  // Tier 1 / 2 — provider health
  providerDownNotificationSuppressionMs: number | null;
  providerErrorTrailRetentionDays: number | null;
  providerRerunCooldownMs: number | null;
  // KZO-197 — yahoo-finance-au rerun cooldown override (Tier 1).
  yahooAuRerunCooldownMs: number | null;

  // Tier 1 / 2 — backfill
  backfillRetryLimit: number | null;
  backfillRetryDelaySeconds: number | null;
  backfillFinmind402RetryMs: number | null;
  dailyRefreshLookbackDays: number | null;
  dailyRefreshPriority: number | null;

  // Tier 1 / 2 — SSE
  sseHeartbeatIntervalMs: number | null;
  sseMaxConnectionsPerUser: number | null;
  sseBufferDefaultTtlMs: number | null;

  // KZO-195 — absence-based delisting detection (Tier 2 hybrid).
  catalogAbsenceThreshold: number | null;
  catalogAbsenceGuardPercent: number | null;
  catalogAbsenceGuardFloor: number | null;

  // KZO-196 — AU GICS sync cron schedule (Tier A; restart-required).
  // NULL means "fall back to Env.ASX_GICS_REFRESH_CRON".
  asxGicsRefreshCron: string | null;

  // KZO-199 — Tier 1 sharing knobs (in PATCH schema, in UI).
  anonymousShareTokenCap: number | null;
  anonymousShareRateLimitMax: number | null;
  anonymousShareRateLimitWindowMs: number | null;
  // KZO-199 — Tier 2 (DB+SQL only; NOT in PATCH or UI).
  anonymousShareTokenRetentionMs: number | null;
  userPreferencesMaxBytes: number | null;

  // ui-enhancement — account soft-delete grace period (Tier B; in PATCH + UI).
  accountHardPurgeDays: number | null;

  /** ISO timestamp of the row's `updated_at`. */
  updatedAt: string;
}

/** TTL window — design-locked to 5–10s. */
export const APP_CONFIG_CACHE_TTL_MS = 8_000;

interface CacheState {
  /** The cached row, or null if the row was missing/never loaded. */
  entry: AppConfigCacheEntry | null;
  /** Monotonic ms timestamp at which `entry` was loaded. */
  loadedAt: number;
  /** True if a refresh is currently in flight. Other readers must NOT block. */
  pending: Promise<void> | null;
  /**
   * KZO-198 Fix 3 — generation counter incremented on every `invalidate()`.
   * In-flight refreshes capture the generation at start; if `invalidate()`
   * fires after they begin, their result is discarded so an older row never
   * overwrites a fresher one. Race-safe ordering between concurrent writes
   * and the post-write background refresh.
   */
  generation: number;
}

const _state: CacheState = {
  entry: null,
  loadedAt: 0,
  pending: null,
  generation: 0,
};

/**
 * Module-level persistence binding. `app.ts` calls `setAppConfigCachePersistence`
 * once after `persistence.init()` succeeds. `null` when running in a context
 * without persistence (e.g. unit tests of pure helpers).
 */
let _persistence: Persistence | null = null;

export function setAppConfigCachePersistence(persistence: Persistence | null): void {
  _persistence = persistence;
}

/**
 * Return the cached row, or `null` when:
 *   - cache is empty and no warm-up has run
 *   - persistence is not registered (test runtimes)
 *   - last load failed
 *
 * NEVER blocks on a refresh. If the entry is stale (older than TTL),
 * `getEntry()` schedules a background refresh and returns the stale value
 * (or `null` if there is none yet) so the request path is not blocked.
 *
 * Resolvers MUST treat `null` (or any individual NULL field) as "fall back
 * to env."
 */
export function getAppConfigCacheEntry(): AppConfigCacheEntry | null {
  const now = Date.now();
  if (_state.entry !== null && now - _state.loadedAt < APP_CONFIG_CACHE_TTL_MS) {
    return _state.entry;
  }
  // Stale or empty — kick off a refresh but DO NOT block.
  void refresh().catch(() => {
    // Errors are logged inside refresh(); resolver-side env-fallback handles
    // the read path. We never throw out of this function.
  });
  return _state.entry;
}

/**
 * Force-refresh the cache (used at boot via `app.ready()` and immediately
 * after `PATCH /admin/settings` writes via `invalidate()`).
 *
 * Coalesces concurrent refreshes via the `pending` promise — only one DB
 * read fires per refresh window.
 */
export async function refresh(): Promise<void> {
  if (_state.pending) {
    await _state.pending;
    return;
  }
  if (_persistence === null) {
    // No persistence registered — leave entry as-is (null on first call).
    return;
  }
  const persistence = _persistence;
  // Capture the generation at start; if invalidate() bumps it before we
  // finish, discard our result so a slow read doesn't clobber a fresher one.
  const startGeneration = _state.generation;
  const job = (async () => {
    try {
      const row = await persistence.getAppConfig();
      if (_state.generation !== startGeneration) {
        // A newer invalidate() landed during this fetch — drop the stale row.
        return;
      }
      _state.entry = row;
      _state.loadedAt = Date.now();
    } catch (err) {
      // Log once via console.warn; we don't poison the existing entry — keep
      // the last-good value so the resolver layer's env-fallback only kicks
      // in when we genuinely have nothing.
      console.warn(
        "[app_config] cache refresh failed; resolvers will fall back to env",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      _state.pending = null;
    }
  })();
  _state.pending = job;
  await job;
}

/**
 * Invalidate the cache. Called by the PATCH `/admin/settings` handler after a
 * successful write. Bumps the generation counter so any in-flight refresh
 * started before this call discards its result on completion (older rows
 * never overwrite fresher ones — see `refresh()` generation check).
 *
 * The PATCH handler does NOT need to `await` the post-invalidate refresh —
 * it derives the response DTO directly from the post-write row to bypass
 * the cache entirely (`adminRoutes.ts` `loadAppConfigDtoFromRow`). This
 * fire-and-forget pattern keeps PATCH latency low; the next read by an
 * unrelated request sees the post-write row within a TTL of being scheduled.
 */
export function invalidate(): void {
  _state.entry = null;
  _state.loadedAt = 0;
  _state.pending = null;
  _state.generation += 1;
  void refresh().catch(() => {
    /* swallow — see getEntry() comment */
  });
}

/**
 * Test-only — reset all module-level state. Vitest workers persist state
 * across tests within a worker (`.claude/rules/vitest-config-patterns.md` §
 * Module-Level State Isolation). Tests must call `_resetAppConfigCache()` in
 * `beforeEach` to avoid cross-test pollution.
 */
export function _resetAppConfigCache(): void {
  _state.entry = null;
  _state.loadedAt = 0;
  _state.pending = null;
  _state.generation += 1;
  _persistence = null;
}
