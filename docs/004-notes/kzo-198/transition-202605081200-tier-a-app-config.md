---
slug: kzo-198
type: transition
created: 2026-05-08T12:00
frozen: true
ticket: KZO-198
---

# KZO-198 — Hybrid env+app_config for Tier A Operational Constants: Transition Guide

> **Frozen snapshot.** Do not edit after merge. Pre-merge corrections are permitted per `doc-management.md`.

This guide covers behavioral changes, migration steps, env-var additions, rollback plan, and audit-log semantics shipped in KZO-198.

---

## 1. What changed

### 1.1 Per-category resolver layer (`apps/api/src/services/appConfig/`)

A new resolver layer replaces direct `Env.*` reads at the following call sites. Each resolver reads from a TTL cache (8 s) backed by the `app_config` singleton row, falling back to `Env.*` when the cache is pending, loading, or when the DB value is NULL.

| Call site | Resolver module | Replaced constant(s) |
|---|---|---|
| `marketDataPriceRateLimit.ts` | `rateLimits.ts` | `Env.MARKET_DATA_PRICE_WINDOW_MS`, `Env.MARKET_DATA_PRICE_LIMIT` |
| `marketDataSearchRateLimit.ts` | `rateLimits.ts` | `Env.MARKET_DATA_SEARCH_WINDOW_MS`, `Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE` |
| `inviteStatusRateLimit.ts` | `rateLimits.ts` | `Env.INVITE_STATUS_WINDOW_MS`, `Env.INVITE_STATUS_LIMIT` |
| `providerHealth.ts` | `providerHealth.ts` | `Env.PROVIDER_DOWN_NOTIFICATION_SUPPRESSION_MS` |
| `providerErrorTrailPurge.ts` | `providerHealth.ts` | `Env.PROVIDER_ERROR_TRAIL_RETENTION_DAYS` |
| `adminRoutes.ts` (rerun cooldown) | `providerHealth.ts` | `Env.PROVIDER_RERUN_COOLDOWN_MS` |
| `registerBackfillWorker.ts` | `backfill.ts` | `Env.BACKFILL_RETRY_LIMIT`, `Env.BACKFILL_RETRY_DELAY_SECONDS` |
| `dailyRefreshEnqueue.ts` | `backfill.ts` | `Env.DAILY_REFRESH_LOOKBACK_DAYS`, `Env.DAILY_REFRESH_PRIORITY` |
| `finmind.ts` | `backfill.ts` | `Env.BACKFILL_FINMIND_402_RETRY_MS` |
| `finmindUsStock.ts` | `backfill.ts` | `Env.BACKFILL_FINMIND_402_RETRY_MS` |
| `twelveDataAu.ts` | `providerKeys.ts` | `Env.TWELVE_DATA_API_KEY` (decrypted from `app_config`) |
| `sseRoute.ts` | `sse.ts` | `Env.SSE_HEARTBEAT_INTERVAL_MS`, `Env.SSE_MAX_CONNECTIONS_PER_USER` |
| `events/buffered.ts` | `sse.ts` | `Env.SSE_BUFFER_DEFAULT_TTL_MS` |
| `FinMindMarketDataProvider` | `providerKeys.ts` | `Env.FINMIND_API_TOKEN` (decrypted from `app_config`) |
| `TwelveDataAuCatalogProvider` | `providerKeys.ts` | `Env.TWELVE_DATA_API_KEY` (decrypted from `app_config`) |

**Behavioral note:** all resolver reads are synchronous via `cache.getEntry()`. A NULL `app_config` DB value or a cache miss is **not** an error — the resolver silently falls back to `Env.*`. Existing behavior is fully preserved for new deploys with no `app_config` values set.

`repairCooldown.ts` and `metadataEnrichmentMode.ts` were migrated to read from the cache layer in the same diff. Their `persistence` parameter was dropped and all call sites updated in the same PR.

### 1.2 Admin PATCH `/admin/settings` — Tier schema change

The PATCH endpoint now accepts **12 Tier 1 + 2 Tier 0 fields** using `.strict()` on the Zod schema. Sending any of the 5 Tier 2 fields returns **400**.

**Tier 2 fields rejected by PATCH (SQL escape hatch only):**

| Field name (camelCase) | DB column | Reason |
|---|---|---|
| `dailyRefreshLookbackDays` | `daily_refresh_lookback_days` | Tier 2 — DB-only escape hatch |
| `dailyRefreshPriority` | `daily_refresh_priority` | Tier 2 — DB-only escape hatch |
| `sseHeartbeatIntervalMs` | `sse_heartbeat_interval_ms` | Tier 2 — DB-only escape hatch |
| `sseMaxConnectionsPerUser` | `sse_max_connections_per_user` | Tier 2 — DB-only escape hatch |
| `sseBufferDefaultTtlMs` | `sse_buffer_default_ttl_ms` | Tier 2 — DB-only escape hatch |

**Intentional, not a regression.** Any automation that was previously sending these fields via PATCH will receive 400 after this deploy. Use the SQL escape hatch (see runbook §22 for examples).

### 1.3 Audit log `metadata.type` discriminator

`app_config_updated` audit entries now carry a `metadata.type` field:

| `metadata.type` | When stamped | `metadata` shape |
|---|---|---|
| `value_change` | Any Tier 1 plain field changed | `{ type: "value_change", before: {...}, after: {...} }` |
| `rotation` | Tier 0 secret rotated via Rotate modal | `{ type: "rotation", field: "finmind_api_token" \| "twelve_data_api_key", actorUserId }` — **never the value** |
| _(absent)_ | Legacy rows written before KZO-198 | `AdminAuditLogClient.tsx` defaults to `value_change` rendering |

**Backfill rule:** legacy audit rows without a `type` field are rendered as `value_change` in the admin audit log UI. No data migration is required — the absence-default is enforced in both the UI render path and the route's read logic.

### 1.4 `app.ts` pre-warm hook reordering

The `app_config` cache pre-warm call was moved from `app.ready(callback)` to `addHook("onReady", ...)` to resolve `FST_ERR_INSTANCE_ALREADY_LISTENING` (registering a lifecycle hook after the server started listening). This is a startup-sequencing fix — no behavior change in normal operation.

### 1.5 New env var: `APP_CONFIG_ENCRYPTION_KEY`

| Property | Value |
|---|---|
| Required in | Non-test runtimes (`NODE_ENV !== "test"`) |
| Format | 64 lowercase hex chars (raw 32-byte AES-256-GCM key) |
| Validation | `Env.validateEnvConstraints()` at boot; fails fast with clear error message |
| Generate | `openssl rand -hex 32` |
| Test exemption | `NODE_ENV=test` skips the gate; test workers use `PERSISTENCE_BACKEND=memory` and never call the encryption path |
| Key rotation | Requires a re-encrypt migration (out of scope for KZO-198; future ticket) |

### 1.6 Migration 047

`db/migrations/047_kzo198_app_config_tier_a_constants.sql` adds 19 nullable columns to `app_config`:

| Category | Count | Column type | Notes |
|---|---|---|---|
| Tier 0 — encrypted secrets | 2 | `TEXT NULL` | `finmind_api_token`, `twelve_data_api_key` — stored as `nonce_b64:ct+tag_b64` |
| Tier 1 — plain incident levers | 12 | `INT` / `BIGINT NULL` | Admin UI forms; reset-to-default available |
| Tier 2 — DB-only escape hatch | 5 | `INT` / `BIGINT NULL` | No UI; SQL writes only; not audited via PATCH |

Every column has a `COMMENT ON COLUMN` label. No CHECK constraints were added (SQL escape hatch preserved). All columns are nullable — NULL means "use `Env.*` fallback".

Per `migration-strategy.md`: once applied to any environment this migration is immutable. Post-merge corrections require a new numbered migration.

---

## 2. New env vars added (all KZO-198)

**Required:**

| Env var | Default | Notes |
|---|---|---|
| `APP_CONFIG_ENCRYPTION_KEY` | — | 64 hex chars; fail-fast at boot in non-test runtimes |

**Tier 1 fallback defaults (override via admin UI or directly):**

| Env var | Default | Purpose |
|---|---|---|
| `MARKET_DATA_PRICE_WINDOW_MS` | `60000` | Per-IP price rate-limit window |
| `MARKET_DATA_PRICE_LIMIT` | `30` | Per-IP price rate-limit request cap |
| `MARKET_DATA_SEARCH_WINDOW_MS` | `60000` | Per-IP search rate-limit window |
| `INVITE_STATUS_WINDOW_MS` | `60000` | Per-IP invite-status rate-limit window |
| `INVITE_STATUS_LIMIT` | `20` | Per-IP invite-status rate-limit cap |
| `PROVIDER_DOWN_NOTIFICATION_SUPPRESSION_MS` | `86400000` (24 h) | Suppression window for down-provider admin notifications |
| `PROVIDER_ERROR_TRAIL_RETENTION_DAYS` | `30` | Error trail purge retention |
| `PROVIDER_RERUN_COOLDOWN_MS` | `60000` | Minimum interval between provider re-run requests |
| `BACKFILL_RETRY_LIMIT` | `3` | pg-boss job retry limit |
| `BACKFILL_RETRY_DELAY_SECONDS` | `60` | pg-boss retry delay |
| `BACKFILL_FINMIND_402_RETRY_MS` | `60000` | Delay before re-enqueueing after FinMind 402 |

**Tier 2 fallback defaults (SQL escape hatch only — not in admin UI):**

| Env var | Default | Purpose |
|---|---|---|
| `DAILY_REFRESH_LOOKBACK_DAYS` | `7` | Daily-refresh bar lookback window |
| `DAILY_REFRESH_PRIORITY` | `10` | pg-boss daily-refresh job priority |
| `SSE_HEARTBEAT_INTERVAL_MS` | `30000` | SSE keepalive heartbeat interval |
| `SSE_MAX_CONNECTIONS_PER_USER` | `20` | Max concurrent SSE connections per user |
| `SSE_BUFFER_DEFAULT_TTL_MS` | `60000` | BufferedEventBus per-user TTL |

**Tier 3 cron schedules (restart-required to change):**

| Env var | Default (cron expr) | Fires | Wired to |
|---|---|---|---|
| `CATALOG_SYNC_CRON` | `"30 17 * * 1-5"` | Weekdays 17:30 UTC | `registerCatalogSyncWorker.ts` |
| `FX_REFRESH_CRON` | `"0 22 * * *"` | Daily 22:00 UTC | `fxRefreshWorker.ts` |
| `ANONYMOUS_SHARE_TOKEN_PURGE_CRON` | `"0 4 * * *"` | Daily 04:00 UTC | `registerAnonymousShareTokenPurgeWorker.ts` |

These env vars are live-wired: overriding any of them in the deployment environment changes the effective cron schedule on the next deploy/restart.

---

## 3. Renamed / new types and classes

| Symbol | Location | Kind | Notes |
|---|---|---|---|
| `AppConfigDecryptError` | `apps/api/src/services/appConfig/encryption.ts` | New class | Typed error for AES-256-GCM failures. `reason: "tag_mismatch" \| "bad_key" \| "malformed_input"`. Re-thrown out of inner catches; never swallowed. |
| `AppConfigPatch` | `libs/shared-types/src/admin.ts` | New type | Partial update shape accepted by `PATCH /admin/settings`. Tier 2 fields excluded. |
| `setAppConfigPatch(partial)` | `apps/api/src/persistence/types.ts` | New method on `Persistence` | Replaces multiple point-setter calls with a single atomic partial-update method. |
| `AppConfigDto` | `libs/shared-types/src/admin.ts` | Extended interface | Gains 12 Tier 1 plain fields, 2 Tier 0 masked sentinel fields, `bounds: APP_CONFIG_BOUNDS`, and `secretLengthBounds: { min, max }`. |
| `AppConfigCache` | `apps/api/src/services/appConfig/cache.ts` | New class | 8 s TTL cache for the `app_config` singleton. `getEntry()` / `invalidate()` / `_resetAppConfigCache()` (test-only). |

---

## 4. Open follow-ups (do not block on these)

1. **Structured `provider_health` SSE event on decrypt failure** — Current implementation logs `app_config_decrypt_failed` via `console.warn` and falls back to `Env.*`. Wiring a real SSE `provider_health` event requires injecting the event-bus sink into the resolver layer. Deferred per Architect and Code Reviewer consensus (Informational I1 in Phase 4 review).

2. **KZO-121 cross-instance cache invalidation** — After a PATCH on one API instance, peer instances see stale data for up to 8 s (the cache TTL). Acceptable for the current single-instance deployment. Cross-instance pub/sub invalidation via Redis is the KZO-121 follow-up. See `docs/001-architecture/app-config.md` §3.

3. **Deferred tests — structural enforcement makes coverage implicit** — Three test scenarios were flagged by the Backend Implementer as optional follow-ups rather than missing coverage:
   - Eviction window adversarial test (rate-limit bucket sweep timing)
   - Postgres integration test for PATCH DTO bypass guard
   - Postgres integration test for eager pre-warm sequencing
   These are structural guarantees enforced by the schema and Fastify lifecycle; explicit integration coverage is desirable but not load-bearing for correctness.

---

## 5. Rollback plan

1. **Revert the API image** to the prior release. Old API images are unaware of the 19 new nullable `app_config` columns — they are ignored cleanly.
2. **Drop migration 047 columns** via `ALTER TABLE app_config DROP COLUMN ...` for all 19 columns. This step is only required if the old image has compatibility issues (unlikely — all columns are nullable, no FK constraints added).
3. **Remove `APP_CONFIG_ENCRYPTION_KEY`** from the deployment environment after the old image is running — old code does not validate or use it.
4. **Encryption key rotation** is explicitly out of scope and requires a future re-encrypt migration before the encryption key can be changed.
