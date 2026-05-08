# app_config Caching Architecture

> **Added:** KZO-198. Cross-reference: `docs/002-operations/runbook.md §22`, `docs/004-notes/kzo-198/transition-202605081200-tier-a-app-config.md`.

This document describes the `app_config` TTL cache, per-category resolver layer, AES-256-GCM encryption module, and the KZO-121 follow-up for cross-instance cache invalidation.

---

## 1. Overview

Before KZO-198, operational constants (rate-limit windows, retry limits, SSE caps, provider API keys) were hard-coded `Env.*` reads at call sites across 15+ source files. KZO-198 introduces a three-layer configuration stack:

```
┌──────────────────────────────────────────────┐
│  Layer 3 — app_config DB row (live-editable) │
│  (singleton; written by PATCH /admin/settings │
│   or SQL escape hatch for Tier 2 fields)      │
├──────────────────────────────────────────────┤
│  Layer 2 — AppConfigCache (TTL = 8 s)        │
│  (in-process; single instance; pre-warmed    │
│   at startup; env-fallback on miss/failure)   │
├──────────────────────────────────────────────┤
│  Layer 1 — Env.* (env vars / .env.local)     │
│  (always-available baseline; used when        │
│   cache returns null or decryption fails)     │
└──────────────────────────────────────────────┘
```

Call sites read from Layer 2 via synchronous per-category resolver functions. Resolvers fall through to Layer 1 transparently — no error is surfaced to the caller.

---

## 2. AppConfigCache

**File:** `apps/api/src/services/appConfig/cache.ts`

### Behaviour contract

| Condition | `getEntry()` returns | Effect on resolvers |
|---|---|---|
| Cache warm (within TTL) | Cached `app_config` row | Resolvers read DB value |
| Cache expired (> 8 s) | Cached value while background refresh runs | Resolvers read stale-but-safe value; refresh is fire-and-forget |
| Cache pending (first call before pre-warm completes) | `null` | Resolvers fall back to `Env.*` |
| Load failure (DB error) | `null` | Resolvers fall back to `Env.*`; error logged |
| `invalidate()` called | `null` until next DB read (~1–5 ms) | Resolvers fall back to `Env.*` briefly; background refresh starts immediately |

### API

```ts
// Read the cached row (synchronous)
function getAppConfigCacheEntry(): AppConfigRow | null

// Force-expire the cache after a successful PATCH write
function invalidateAppConfigCache(): void

// Pre-warm; called at app.ready() via addHook("onReady")
async function refreshAppConfigCache(): Promise<void>

// Test-only reset (exported for beforeEach usage)
function _resetAppConfigCache(): void
```

### Pre-warm

`app.ts` registers the pre-warm during server initialization:

```ts
app.addHook("onReady", async () => {
  await refreshAppConfigCache().catch((err) => {
    log.error({ err }, "app_config pre-warm failed — falling back to env defaults");
  });
});
```

Failure is logged but **does not block boot**. The env-fallback layer covers the gap until the next cache refresh succeeds (first request triggers a background refresh attempt).

### Invalidate-after-write

The `PATCH /admin/settings` handler calls `invalidateAppConfigCache()` immediately after a successful persistence write, before returning the updated DTO. This ensures the next resolver read on the same instance sees the new value within one DB round-trip.

### TTL expiry and burst protection

When the cache expires, the next `getEntry()` triggers a background `refresh()` (fire-and-forget). If the DB is unavailable during a burst of invalidations, repeated `null` returns cause all resolvers to fall back to `Env.*` until the DB recovers — acceptable degradation, not a cascading failure.

---

## 3. Cross-instance cache invalidation (KZO-121 follow-up)

**Current behavior (single-instance):** `invalidateAppConfigCache()` provides immediate consistency on the local API instance. The 8 s TTL ensures eventual consistency on the same instance even without invalidation.

**Gap (horizontal scaling):** when multiple API instances are running (or will run), a PATCH on Instance A calls `invalidateAppConfigCache()` on Instance A only. Instances B and C will continue to serve the pre-PATCH value until their TTLs expire (≤ 8 s stale window).

**Acceptable for KZO-198:** the tw-portfolio stack currently runs a single API instance. 8 s stale reads across replicas are acceptable under this topology.

**KZO-121 path forward:** when horizontal scaling lands, `invalidateAppConfigCache()` should also publish a Redis pub/sub message. All instances subscribe and call their local `invalidateAppConfigCache()` on receipt. Options:

1. **Redis pub/sub** — low latency; requires an additional Redis channel subscription per instance. Preferred.
2. **`NOTIFY`/`LISTEN` (Postgres)** — uses the existing DB connection; simpler operationally but adds latency vs Redis and couples cache invalidation to DB connection health.

This follow-up is scoped to KZO-121. The architecture is intentionally designed to accommodate it without changing the resolver layer: only `cache.ts` changes.

---

## 4. Per-category resolver layer

**Directory:** `apps/api/src/services/appConfig/`

Each resolver module exports synchronous getter functions that read from `getAppConfigCacheEntry()` and fall back to `Env.*`:

| Module | Exported getters | DB columns read |
|---|---|---|
| `rateLimits.ts` | `getEffectiveMarketDataPriceWindowMs`, `getEffectiveMarketDataPriceLimit`, `getEffectiveMarketDataSearchWindowMs`, `getEffectiveMarketDataSearchRateLimitPerMinute`, `getEffectiveInviteStatusWindowMs`, `getEffectiveInviteStatusLimit` | 5 Tier 1 columns + 1 pre-existing |
| `providerHealth.ts` | `getEffectiveDownNotificationSuppressionMs`, `getEffectiveErrorTrailRetentionDays`, `getEffectiveRerunCooldownMs` | 3 Tier 1 columns |
| `backfill.ts` | `getEffectiveBackfillRetryLimit`, `getEffectiveBackfillRetryDelaySeconds`, `getEffectiveFinmind402RetryMs`, `getEffectiveDailyRefreshLookbackDays`, `getEffectiveDailyRefreshPriority` | 3 Tier 1 + 2 Tier 2 columns |
| `sse.ts` | `getEffectiveSseHeartbeatIntervalMs`, `getEffectiveSseMaxConnectionsPerUser`, `getEffectiveSseBufferDefaultTtlMs` | 3 Tier 2 columns |
| `providerKeys.ts` | `getEffectiveFinmindApiToken`, `getEffectiveTwelveDataApiKey` | 2 Tier 0 encrypted columns |
| `repairCooldown.ts` | `getEffectiveRepairCooldownMinutes` | 1 pre-existing column |
| `metadataEnrichmentMode.ts` | `getEffectiveMetadataEnrichmentMode` | 1 pre-existing column |
| `bounds.ts` | `APP_CONFIG_BOUNDS`, `APP_CONFIG_SECRET_LENGTH` | (constants only — no DB read) |

### Sync API contract

All getters are **synchronous** — no `await` at call sites. The cache is the only async boundary; all async work happens in the background refresh path.

### Eviction sweep — do NOT call resolvers from `setInterval`

Per `fastify-eviction-lifecycle-pattern.md`: rate-limit eviction timers read `Env.*` at registration time. They must **not** call resolver functions inside `setInterval` callbacks. The env value at registration time governs the sweep cadence for the lifetime of the timer.

---

## 5. Encryption module

**File:** `apps/api/src/services/appConfig/encryption.ts`

### Algorithm

- Cipher: AES-256-GCM
- Key: 32 bytes from `Env.APP_CONFIG_ENCRYPTION_KEY` (64 lowercase hex chars)
- Nonce: `crypto.randomBytes(12)` per encrypt call (unique per ciphertext)
- AAD: none (single-key, single-purpose; no domain separation needed at this scale)
- Storage format: `base64(nonce):base64(ciphertext || authTag)` — exactly one `:` separator

### Typed error

`AppConfigDecryptError` is thrown on any decryption failure:

```ts
class AppConfigDecryptError extends Error {
  constructor(
    public readonly reason: "tag_mismatch" | "bad_key" | "malformed_input",
    message: string,
  ) { ... }
}
```

**Important:** per `typed-transient-error-catch-audit.md`, this error is **re-thrown** out of any inner catch in the resolver and cache layers — it is never silently swallowed. Callers (resolvers) catch it, log `app_config_decrypt_failed`, and fall back to `Env.*`.

### Log payload safety

The `app_config_decrypt_failed` log includes only:
- `field` — field name string (`"finmind_api_token"` or `"twelve_data_api_key"`)
- `reason` — enum value from `AppConfigDecryptError.reason`
- `message` — static string from the error constructor

No plaintext, no ciphertext, no key material ever appears in logs. This is asserted by `providerKeys.test.ts`.

---

## 6. Tiering summary

| Tier | Count | Storage | Admin UI | Env fallback |
|---|---|---|---|---|
| 0 — Encrypted secrets | 2 | Encrypted TEXT in `app_config` | Masked input + Rotate modal | `Env.FINMIND_API_TOKEN`, `Env.TWELVE_DATA_API_KEY` |
| 1 — Plain incident levers | 12 | Plain typed in `app_config` | Full form + Reset button | Matching `Env.*` defaults |
| 2 — Plain DB-only escape hatch | 5 | Plain typed in `app_config` | None — SQL only | Matching `Env.*` defaults |
| 3 — Env-only | 7 | Env vars only (3 crons + 4 freshness constants) | None — restart required | N/A — env is the only source |

---

## 7. app_config table — KZO-198 additions

Migration `047_kzo198_app_config_tier_a_constants.sql` extends the `app_config` singleton (id = 1) with:

### Tier 0 columns (encrypted)

| Column | DB type | Resolver | Notes |
|---|---|---|---|
| `finmind_api_token` | `TEXT NULL` | `providerKeys.ts` | Stored as `nonce_b64:ct+tag_b64` |
| `twelve_data_api_key` | `TEXT NULL` | `providerKeys.ts` | Stored as `nonce_b64:ct+tag_b64` |

### Tier 1 columns (admin-editable)

| Column | DB type | Default via | Resolver |
|---|---|---|---|
| `market_data_price_window_ms` | `BIGINT NULL` | `Env.MARKET_DATA_PRICE_WINDOW_MS` | `rateLimits.ts` |
| `market_data_price_limit` | `INT NULL` | `Env.MARKET_DATA_PRICE_LIMIT` | `rateLimits.ts` |
| `market_data_search_window_ms` | `BIGINT NULL` | `Env.MARKET_DATA_SEARCH_WINDOW_MS` | `rateLimits.ts` |
| `invite_status_window_ms` | `BIGINT NULL` | `Env.INVITE_STATUS_WINDOW_MS` | `rateLimits.ts` |
| `invite_status_limit` | `INT NULL` | `Env.INVITE_STATUS_LIMIT` | `rateLimits.ts` |
| `provider_down_notification_suppression_ms` | `BIGINT NULL` | `Env.PROVIDER_DOWN_NOTIFICATION_SUPPRESSION_MS` | `providerHealth.ts` |
| `provider_error_trail_retention_days` | `INT NULL` | `Env.PROVIDER_ERROR_TRAIL_RETENTION_DAYS` | `providerHealth.ts` |
| `provider_rerun_cooldown_ms` | `BIGINT NULL` | `Env.PROVIDER_RERUN_COOLDOWN_MS` | `providerHealth.ts` |
| `backfill_retry_limit` | `INT NULL` | `Env.BACKFILL_RETRY_LIMIT` | `backfill.ts` |
| `backfill_retry_delay_seconds` | `INT NULL` | `Env.BACKFILL_RETRY_DELAY_SECONDS` | `backfill.ts` |
| `backfill_finmind_402_retry_ms` | `BIGINT NULL` | `Env.BACKFILL_FINMIND_402_RETRY_MS` | `backfill.ts` |

_(1 Tier 1 search rate-limit column reads the existing `Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE` as fallback — column name `market_data_search_limit`.)_

### Tier 2 columns (SQL escape hatch only)

| Column | DB type | Default via | Resolver |
|---|---|---|---|
| `daily_refresh_lookback_days` | `INT NULL` | `Env.DAILY_REFRESH_LOOKBACK_DAYS` | `backfill.ts` |
| `daily_refresh_priority` | `INT NULL` | `Env.DAILY_REFRESH_PRIORITY` | `backfill.ts` |
| `sse_heartbeat_interval_ms` | `BIGINT NULL` | `Env.SSE_HEARTBEAT_INTERVAL_MS` | `sse.ts` |
| `sse_max_connections_per_user` | `INT NULL` | `Env.SSE_MAX_CONNECTIONS_PER_USER` | `sse.ts` |
| `sse_buffer_default_ttl_ms` | `BIGINT NULL` | `Env.SSE_BUFFER_DEFAULT_TTL_MS` | `sse.ts` |
