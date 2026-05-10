---
slug: kzo-199
type: transition
created: 2026-05-10T18:30
frozen: true
ticket: KZO-199
---

# KZO-199 — Hybrid env+app_config for Tier B Operational Constants: Transition Guide

> **Frozen snapshot.** Do not edit after merge. Pre-merge corrections are permitted per `doc-management.md`.

This guide covers behavioral changes, migration steps, env-var additions, rollback plan, and UI changes shipped in KZO-199. It extends the [KZO-198 Tier A transition guide](../kzo-198/transition-202605081200-tier-a-app-config.md) using the verbatim same pattern.

---

## 1. What changed

### 1.1 Summary

KZO-199 completes the Tier B pass of the hybrid env+app_config pattern established in KZO-198 (identified in the KZO-194 audit). Seven hardcoded constants are promoted to the resolver layer. Five are backed by new `app_config` columns (three Tier 1 admin-editable, two Tier 2 DB-only escape hatch); two are Tier 3 env-var-only with restart-required semantics.

The `/admin/settings` page is restructured into **five tabs** to accommodate the growing set of Tier 1 knobs across all tickets (KZO-198, KZO-195, KZO-189, KZO-197, KZO-199). Responsive text-wrap fixes are applied to `AdminInstrumentsClient.tsx` and `AdminProvidersClient.tsx` as a starter example for a planned project-wide convention (separate ticket).

### 1.2 New resolver layer — per-feature files

Two new resolver files mirror the per-category pattern from KZO-198:

| Resolver file | Resolver functions | Replaced call site(s) |
|---|---|---|
| `apps/api/src/services/appConfig/sharing.ts` | `getEffectiveAnonymousShareTokenCap()` | Hardcoded `ANONYMOUS_SHARE_TOKEN_CAP = 20` in `anonymousShareToken.ts:26` |
| `apps/api/src/services/appConfig/sharing.ts` | `getEffectiveAnonymousShareTokenRetentionMs()` | Hardcoded `ANONYMOUS_SHARE_TOKEN_RETENTION_MS` in `anonymousShareToken.ts:27` |
| `apps/api/src/services/appConfig/sharing.ts` | `getEffectiveAnonymousShareRateLimitMax()` | `Env.ANONYMOUS_SHARE_RATE_LIMIT_MAX` (env-only, no override before KZO-199) |
| `apps/api/src/services/appConfig/sharing.ts` | `getEffectiveAnonymousShareRateLimitWindowMs()` | `Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` (env-only, no override before KZO-199) |
| `apps/api/src/services/appConfig/requestLimits.ts` | `getEffectiveUserPreferencesMaxBytes()` | Hardcoded `USER_PREFERENCES_MAX_BYTES = 8192` in `registerRoutes.ts:2262` |

All resolvers follow the pattern: `getAppConfigCacheEntry()?.<col> ?? Env.<VAR>`. A NULL DB value or cache miss silently falls back to the env default — fully backward compatible with deployments that have no `app_config` values set.

### 1.3 Migration 052

`db/migrations/052_kzo199_app_config_tier_b_constants.sql` adds **5 nullable columns** to the `app_config` singleton row:

| Column | Type | Tier | Notes |
|---|---|---|---|
| `anonymous_share_token_cap` | `INT NULL` | 1 | Admin-editable via `/admin/settings → Sharing`; bounds [1, 1000] |
| `anonymous_share_rate_limit_max` | `INT NULL` | 1 | Admin-editable; bounds [1, 10000] |
| `anonymous_share_rate_limit_window_ms` | `INT NULL` | 1 | Admin-editable; bounds [1000 ms, 600000 ms] |
| `anonymous_share_token_retention_ms` | `BIGINT NULL` | 2 | DB/SQL-only escape hatch; bounds [1d, 365d]; **retention coupling** — see §3.2 |
| `user_preferences_max_bytes` | `INT NULL` | 2 | DB/SQL-only escape hatch; bounds [256, 1 MiB] |

No CHECK constraints were added (SQL escape hatch preserved). All columns are nullable — backward compatible with old API images.

Per `migration-strategy.md`: once applied to any environment this migration is immutable. Post-merge corrections require a new numbered migration.

### 1.4 Admin PATCH `/admin/settings` — new Tier 1 fields

The PATCH endpoint Zod schema gains **3 new Tier 1 fields** (camelCase):

| Field | DB column | Bounds |
|---|---|---|
| `anonymousShareTokenCap` | `anonymous_share_token_cap` | [1, 1000] |
| `anonymousShareRateLimitMax` | `anonymous_share_rate_limit_max` | [1, 10000] |
| `anonymousShareRateLimitWindowMs` | `anonymous_share_rate_limit_window_ms` | [1000, 600000] |

The **2 Tier 2 fields** (`anonymous_share_token_retention_ms`, `user_preferences_max_bytes`) are **not** in the PATCH schema — SQL escape hatch only. Sending them returns 400 from the strict Zod schema.

`AppConfigDto` gains corresponding `effectiveX` (resolver-derived) and `rawX` (raw DB or null) pairs for all 3 Tier 1 fields. Bound metadata is sourced from `bounds.ts`.

### 1.5 Behavioral changes

| Behavior | Before KZO-199 | After KZO-199 | Intentional? |
|---|---|---|---|
| Anonymous share token cap | Hardcoded `20` (no runtime override) | Resolver-derived; default 20; admin can tune via Settings → Sharing tab | ✅ Yes — adds runtime leverage |
| Anonymous share rate-limit max | `Env.ANONYMOUS_SHARE_RATE_LIMIT_MAX` (env-only) | Resolver-derived; same env default; admin can override via UI | ✅ Yes |
| Anonymous share rate-limit window | `Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` (env-only) | Resolver-derived; same env default; admin can override via UI | ✅ Yes |
| `PATCH /user-preferences` body limit | `bodyLimit` and inner check both read hardcoded `8192` | `bodyLimit` = static 1 MiB ceiling (schedule-static); inner check reads `getEffectiveUserPreferencesMaxBytes()` live (parameter-live) | ✅ Yes — `bodyLimit` is now at the bound max (1 MiB); inner limit still enforces 8 KiB by default |
| Postgres connection pool size | Hardcoded `max: 20` in `postgres.ts` | Reads `Env.POSTGRES_POOL_MAX` (default 20) | ✅ Yes — restart-required to change |
| pg-boss connection pool size | Hardcoded `max: 2` in `pgBoss.ts` | Reads `Env.BACKFILL_POSTGRES_POOL_MAX` (default 2) | ✅ Yes — restart-required to change |
| `/admin/settings` page layout | Flat single-section form (~20 fields) | 5-tab layout (`?tab=<slug>`) with URL sync; default tab = `rate-limits` | ✅ Yes — usability |

**Important — `bodyLimit` ceiling change:** The Fastify route's static `bodyLimit` for `PATCH /user-preferences` is now set to `APP_CONFIG_BOUNDS.userPreferencesMaxBytes.max` = **1,048,576 bytes (1 MiB)**, up from the previous 8,192. The effective runtime limit (enforced by the inner resolver check) remains 8 KiB until an operator raises it via SQL. Clients that send large bodies that were previously rejected by Fastify before reaching route logic will now reach the inner check. The inner check enforces the same 8 KiB default — behavior is unchanged for the default case.

### 1.6 `/admin/settings` tab restructure

`AdminSettingsClient.tsx` is restructured around `@radix-ui/react-tabs`. Tab selection is persisted to the URL as `?tab=<slug>` via `useSearchParams` + `router.replace`. Default tab when `?tab` is absent or unrecognized = `rate-limits`.

| Tab slug | Tab label | Fields |
|---|---|---|
| `rate-limits` | Rate limits | Market-data price (window, cap), market-data search (window), invite-status (window, cap) — from KZO-198 |
| `sharing` | Sharing | Anonymous-share token cap, rate-limit max, rate-limit window — **KZO-199 new fields** |
| `provider-health` | Provider health | Down-notification suppression, error trail retention, generic rerun cooldown, yahoo-AU rerun cooldown — from KZO-198 + KZO-197 |
| `backfill-repair` | Backfill & repair | Backfill retry limit, retry delay, FinMind 402 retry, repair cooldown — from KZO-198 + KZO-133 |
| `catalog-metadata` | Catalog & metadata | Catalog absence threshold, guard percent, guard floor, metadata enrichment mode — from KZO-195 + KZO-189 |

Locked testids: `admin-settings-tabs`, `admin-settings-tab-{slug}`, `admin-settings-panel-{slug}`. Per-field testids are unchanged.

### 1.7 Responsive text-wrap fix

Two admin client components had cells that caused horizontal overflow at narrow viewports:

- `AdminInstrumentsClient.tsx` — Descriptive cells (instrument name, status descriptions) now wrap. Opaque identifier cells (ticker, market_code, instrument UUID, timestamps) retain `truncate + title` truncation.
- `AdminProvidersClient.tsx` (and `ProviderCard` mobile variant) — Same treatment. Provider IDs and last-success timestamps stay non-wrapping; error trail messages and status descriptions wrap.

No testid changes from the wrap fix. Project-wide text-wrap convention = **separate follow-up ticket** (scoped at KZO-199 lock; these two pages are the canonical examples).

---

## 2. New env vars added (all KZO-199)

### Tier 1 — admin-editable fallback defaults

| Env var | Default | Purpose |
|---|---|---|
| `ANONYMOUS_SHARE_TOKEN_CAP` | `20` | Max active tokens per owner; DB override wins when non-null |
| `ANONYMOUS_SHARE_TOKEN_RETENTION_MS` | `2592000000` (30 d) | Retention window for revoked/expired tokens before UI hides them; DB override wins |

`ANONYMOUS_SHARE_RATE_LIMIT_MAX` and `ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` existed before KZO-199 as env vars. They now gain DB resolver backing — schema entries unchanged.

### Tier 2 — DB escape hatch fallback defaults

| Env var | Default | Purpose |
|---|---|---|
| `USER_PREFERENCES_MAX_BYTES` | `8192` | Inner body-size check for `PATCH /user-preferences` |

### Tier 3 — restart-required env vars (env-only, no DB column)

| Env var | Default | Purpose | Notes |
|---|---|---|---|
| `POSTGRES_POOL_MAX` | `20` | Main Postgres connection pool size | Restart-required; was hardcoded |
| `BACKFILL_POSTGRES_POOL_MAX` | `2` | pg-boss backfill Postgres pool size | Restart-required; was hardcoded |

All 5 env vars have `.default(...)` in the Zod schema → `validateEnvConstraints` does not throw when absent. No wizard auto-generation required (per `env-setup-autogen-required-secrets.md` strict-scope clause). They appear in `envGroups` (Application section) for optional wizard surfacing.

---

## 3. Coupling notes

### 3.1 Rate-limit sweep cadence vs. parameter-live value

`anonymousShareRateLimitMax` and `anonymousShareRateLimitWindowMs` are admin-tunable. The `setInterval` eviction sweep cadence in `anonymousShareRateLimit.ts` stays at the env-default (schedule-static, captured once at registration). The sweep's window argument is read live per-tick via `getEffectiveAnonymousShareRateLimitWindowMs()` (parameter-live). This matches the pattern established for `marketDataPriceRateLimit.ts` in KZO-198 (`.claude/rules/fastify-eviction-lifecycle-pattern.md`).

### 3.2 `anonymous_share_token_retention_ms` ↔ `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS` coupling

The `anonymous_share_token_retention_ms` column controls how long a revoked/expired token remains listable by its owner. The `ANONYMOUS_SHARE_TOKEN_PURGE_CRON` (daily 04:00 UTC) physically deletes rows older than `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS` (default 90 d) past their terminality date.

**Invariant:** `anonymous_share_token_retention_ms` MUST stay ≤ `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS × 86,400,000 ms`. If retention is set longer than the purge window, the UI would promise to show tokens that the purge cron has already deleted. The column comment documents this coupling verbatim.

---

## 4. Renamed / new types and classes

No types or classes were renamed in KZO-199. New additions:

| Symbol | Location | Kind | Notes |
|---|---|---|---|
| `getEffectiveAnonymousShareTokenCap` | `apps/api/src/services/appConfig/sharing.ts` | New function | Resolver; falls back to `Env.ANONYMOUS_SHARE_TOKEN_CAP` |
| `getEffectiveAnonymousShareTokenRetentionMs` | `apps/api/src/services/appConfig/sharing.ts` | New function | Resolver; falls back to `Env.ANONYMOUS_SHARE_TOKEN_RETENTION_MS` |
| `getEffectiveAnonymousShareRateLimitMax` | `apps/api/src/services/appConfig/sharing.ts` | New function | Resolver; falls back to `Env.ANONYMOUS_SHARE_RATE_LIMIT_MAX` |
| `getEffectiveAnonymousShareRateLimitWindowMs` | `apps/api/src/services/appConfig/sharing.ts` | New function | Resolver; falls back to `Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` |
| `getEffectiveUserPreferencesMaxBytes` | `apps/api/src/services/appConfig/requestLimits.ts` | New function | Resolver; falls back to `Env.USER_PREFERENCES_MAX_BYTES` |

---

## 5. Modified file list

**New files:**
- `db/migrations/052_kzo199_app_config_tier_b_constants.sql`
- `apps/api/src/services/appConfig/sharing.ts`
- `apps/api/src/services/appConfig/requestLimits.ts`
- `apps/api/test/unit/appConfig/sharing.test.ts`
- `apps/api/test/unit/appConfig/requestLimits.test.ts`
- `apps/api/test/unit/persistence-pool-size.test.ts`
- `apps/api/test/integration/anonymous-share-token-retention-app-config.integration.test.ts`
- `apps/api/test/http/specs/admin-settings-tier-b-aaa.http.spec.ts`
- `apps/web/components/ui/Tabs.tsx`
- `apps/web/tests/e2e/specs-oauth/admin-settings-tier-b-aaa.spec.ts`

**Modified files:**
- `libs/config/src/env-schema.ts` — 5 new env entries with defaults
- `libs/config/src/env-metadata.ts` — 5 entries added to `envGroups` Application section
- `libs/shared-types/src/index.ts` — `AppConfigDto` extended with 3 Tier-1 sharing fields
- `libs/test-api/src/endpoints/AdminEndpoint.ts` — new Tier-B field coverage
- `libs/test-e2e/src/assistants/layout/AppShellActions.ts` — tab navigation helper
- `apps/api/src/lib/anonymousShareToken.ts` — hardcoded constants removed; resolvers wired
- `apps/api/src/lib/anonymousShareRateLimit.ts` — per-request checks wired to resolver (parameter-live); sweep cadence unchanged (schedule-static)
- `apps/api/src/persistence/memory.ts` — `getAppConfig()` row shape extended; resolver call-sites updated
- `apps/api/src/persistence/postgres.ts` — `getAppConfig()` SELECT extended; pool `max` reads `Env.POSTGRES_POOL_MAX`; resolver call-sites updated
- `apps/api/src/persistence/types.ts` — `AppConfigRow` gains 5 new nullable fields
- `apps/api/src/plugins/pgBoss.ts` — pool `max` reads `Env.BACKFILL_POSTGRES_POOL_MAX`
- `apps/api/src/routes/adminRoutes.ts` — PATCH Zod schema + DTO + audit log extended for 3 Tier-1 fields
- `apps/api/src/routes/registerRoutes.ts` — `bodyLimit` → 1 MiB static; inner check → `getEffectiveUserPreferencesMaxBytes()`
- `apps/api/src/services/appConfig/bounds.ts` — 5 new bounds entries
- `apps/api/src/services/appConfig/cache.ts` — `AppConfigRow` shape extended (minimal change)
- `apps/api/test/unit/anonymous-share-token-persistence.test.ts` — updated for resolver swap
- `apps/api/test/unit/appConfig/_helpers.ts` — test helper extended
- `apps/web/components/admin/AdminSettingsClient.tsx` — Tabs restructure; 3 new Sharing fields
- `apps/web/components/admin/AdminInstrumentsClient.tsx` — responsive wrap fix
- `apps/web/components/admin/AdminProvidersClient.tsx` — responsive wrap fix
- `apps/web/components/admin/NumericOverrideRow.tsx` — minor UI support change
- `apps/web/package.json` — `@radix-ui/react-tabs` added
- `apps/web/test/fixtures/appConfigDto.ts` — fixture extended for Tier-B fields
- `apps/web/tests/e2e/specs-oauth/admin-settings-tier-a-aaa.spec.ts` — tab-navigate arrange added
- `apps/web/tests/e2e/specs-oauth/admin-metadata-enrichment-mode-aaa.spec.ts` — tab-navigate arrange added
- `apps/web/tests/e2e/specs/admin-settings-aaa.spec.ts` — tab-navigate arrange added

---

## 6. Out of scope (ratified at KZO-199 lock)

The following were evaluated and closed during scope-grill:

- **"Max grants per owner" cap** — does not exist in the codebase today; new feature, not a constant promotion.
- **FX rate-age staleness threshold** — does not exist; new feature.
- **FX freshness alerting thresholds** — does not exist; new feature.
- **Tier C constants** — already-overridable defaults, timezone offsets. Closed per KZO-198 lock.
- **Provider API keys** — handled in KZO-198 (Tier 0).
- **Project-wide responsive text-wrap convention** — KZO-199 fixes two pages as examples; full audit pass = separate follow-up ticket.

---

## 7. Rollback plan

1. **Revert the API image** to the prior release. Old API images are unaware of the 5 new nullable `app_config` columns — they are ignored cleanly.
2. **Per-column rollback** (optional): `UPDATE app_config SET anonymous_share_token_cap = NULL, anonymous_share_rate_limit_max = NULL, anonymous_share_rate_limit_window_ms = NULL, anonymous_share_token_retention_ms = NULL, user_preferences_max_bytes = NULL WHERE id = 1;` reverts all 5 columns to env-only behavior without removing the columns.
3. **Full schema rollback**: `ALTER TABLE app_config DROP COLUMN IF EXISTS anonymous_share_token_cap, DROP COLUMN IF EXISTS anonymous_share_rate_limit_max, DROP COLUMN IF EXISTS anonymous_share_rate_limit_window_ms, DROP COLUMN IF EXISTS anonymous_share_token_retention_ms, DROP COLUMN IF EXISTS user_preferences_max_bytes;`
4. **UI rollback**: reverting `AdminSettingsClient.tsx` restores the flat-section layout; no data loss.
5. **Pool-size rollback**: `POSTGRES_POOL_MAX` and `BACKFILL_POSTGRES_POOL_MAX` default to their previous hardcoded values (20 and 2 respectively). Removing them from the deployment env file restores prior behavior after a restart.

---

## 8. Open follow-ups (do not block on these)

1. **Project-wide responsive text-wrap convention + audit** — filed as a separate follow-up ticket. KZO-199's `AdminInstrumentsClient` and `AdminProvidersClient` fixes are the canonical examples.
2. **KZO-121 cross-instance cache invalidation** — after a PATCH on one API instance, peer instances see stale data for up to 8 s (the cache TTL). Acceptable for current single-instance deployment. Inherited from KZO-198; see `docs/001-architecture/app-config.md` §3.
3. **`anonymous_share_token_retention_ms` UI surfacing** — currently a Tier 2 SQL-only escape hatch. If operator demand warrants it, promoting to Tier 1 (admin UI) is additive.
