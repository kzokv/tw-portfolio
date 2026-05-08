---
slug: kzo-198
source: scope-grill
created: 2026-05-07
tickets: [KZO-198]
required_reading: []
superseded_by: null
---

# Todo: KZO-198 — Hybrid env+app_config for Tier A operational constants

> **For agents starting a fresh session:** read this file plus the Linear ticket KZO-198 description (which has the locked-scope appendix) before starting implementation. No debate note exists for this scope.

## Locked Decisions Summary

**Architecture**
- TTL cache (5–10s) on the singleton `app_config` row in `apps/api/src/services/appConfig/cache.ts`. Pre-warmed at `app.ready()`. Env-fallback on cache-pending or load-failure.
- Per-category resolver files: `rateLimits.ts`, `providerHealth.ts`, `backfill.ts`, `sse.ts`, `providerKeys.ts`. Existing `repairCooldown.ts` and `metadataEnrichmentMode.ts` migrate to read from cache; drop unused `persistence` parameter and update all call sites.
- AES-256-GCM app-level encryption for Tier 0 secrets. Storage: `nonce:ciphertext` base64. New env var `APP_CONFIG_ENCRYPTION_KEY` validated at boot. On runtime decryption failure: log `app_config_decrypt_failed`, fall back to `Env.*`, emit `provider_health` warning.

**Tiering (26 fields touched, 19 app_config columns)**

| Tier | Count | Storage | UI |
|---|---|---|---|
| 0 — Encrypted secrets (FinMind, Twelve Data API tokens) | 2 | encrypted in app_config | masked, rotate-only modal |
| 1 — Plain incident levers | 12 | plain in app_config | full UI with reset-to-default |
| 2 — Plain DB-only escape hatch | 5 | plain in app_config | none (SQL only) |
| 3 — Env-only (3 crons + 4 freshness/calendar constants) | 7 | env vars only | none |

**Validation**
- Zod schema in `adminRoutes.ts` PATCH handler. Bounds defined once in `apps/api/src/services/appConfig/bounds.ts`, exported and consumed by both API schema and UI form `min`/`max`. No DB CHECK constraints (preserve SQL escape hatch).

**Audit log**
- `metadata.type: 'value_change' | 'rotation'` discriminator. Plaintext changes keep `{ before, after }`. Rotations use `{ type: 'rotation', field, actorUserId }` — never logs the value. Backfill: absent `type` → `value_change`. `AdminAuditLogClient.tsx` rendering switches on `type`.

**Migration**
- Single migration file (next sequential number) — 19 nullable columns added to `app_config` with `COMMENT ON COLUMN` per field. No CHECK constraints.

**Out of scope**
- Cron live-edit (env-only with restart).
- Tier B operational constants (separate follow-up ticket).
- Tier C constants (closed).

## Implementation Steps

### Phase 1 — Schema, cache, encryption foundation
- [x] Add `APP_CONFIG_ENCRYPTION_KEY` to `libs/config/src/env-schema.ts` (`z.string().regex(/^[0-9a-f]{64}$/)`); fail-fast at boot if missing
- [x] Add ~12 new env vars (Tier 3 freshness + 3 cron strings + Tier 1/2 defaults that don't already have env vars) with current hardcoded values as defaults
- [x] Migration `{NEXT_NUM}_app_config_tier_a_constants.sql` — 19 nullable columns (2 encrypted TEXT + 17 plain typed) with `COMMENT ON COLUMN` per field
- [x] `apps/api/src/services/appConfig/encryption.ts` — AES-256-GCM encrypt/decrypt with `nonce:ciphertext` base64 shape; deterministic test fixture key in `apps/api/test/fixtures/`
- [x] `apps/api/src/services/appConfig/cache.ts` — TTL cache (5–10s), pre-warm at `app.ready()`, env-fallback on cache-pending and on decryption failure (log `app_config_decrypt_failed`, emit `provider_health` warning)
- [x] `PostgresPersistence` getters/setters for the 19 new columns
- [x] `MemoryPersistence` mirror getters/setters for the 19 new columns

### Phase 2 — Resolvers
- [x] `apps/api/src/services/appConfig/bounds.ts` — bounds constants per Tier 1 field + Tier 0 length bound (20–500)
- [x] `apps/api/src/services/appConfig/rateLimits.ts` — `getEffective{MarketDataPriceWindowMs,Limit,SearchWindowMs,SearchRateLimitPerMinute,InviteStatusWindowMs,Limit}`
- [x] `apps/api/src/services/appConfig/providerHealth.ts` — `getEffective{DownNotificationSuppressionMs,ErrorTrailRetentionDays,RerunCooldownMs}`
- [x] `apps/api/src/services/appConfig/backfill.ts` — `getEffective{BackfillRetryLimit,RetryDelaySeconds,Finmind402RetryMs,DailyRefreshLookbackDays,Priority}`
- [x] `apps/api/src/services/appConfig/sse.ts` — `getEffective{HeartbeatIntervalMs,MaxConnectionsPerUser,SseBufferDefaultTtlMs}`
- [x] `apps/api/src/services/appConfig/providerKeys.ts` — `getEffective{FinmindApiToken,TwelveDataApiKey}` (decryption layer)
- [x] Migrate `repairCooldown.ts` and `metadataEnrichmentMode.ts` to read from cache; drop `persistence` parameter; grep + update all call sites

### Phase 3 — Wire resolvers into source files
- [x] Rate-limit handlers (`marketDataPriceRateLimit.ts`, `marketDataSearchRateLimit.ts`, `inviteStatusRateLimit.ts`): read window/limit at request time via resolver
- [x] Eviction `setInterval` cadence stays at env-default per `fastify-eviction-lifecycle-pattern.md` (do not change)
- [x] `providerHealth.ts:56` — read `DOWN_NOTIFICATION_SUPPRESSION_MS` via resolver
- [x] `providerErrorTrailPurge.ts:9` — read retention via resolver
- [x] `adminRoutes.ts:589` — read provider re-run cooldown via resolver
- [x] `registerBackfillWorker.ts:7-8` — read retry limit/delay via resolver
- [x] `dailyRefreshEnqueue.ts:7-8` — read lookback/priority via resolver
- [x] `finmind.ts:92`, `finmindUsStock.ts:108` — read `REMOTE_402_RETRY_MS` via resolver
- [x] `sseRoute.ts:11-12` — read heartbeat interval / max connections via resolver
- [x] `events/buffered.ts:11` — read SSE buffer TTL via resolver
- [x] `FinMindMarketDataProvider`, `TwelveDataAuCatalogProvider` — re-read API key per fetch via resolver (no client rebuild)
- [x] Tier 3 source files (`tradingCalendar.ts`, `deriveFetchWindow.ts`, `dashboard.ts:183`, 3 cron registrations) — replace literal with `Env.*` reads

### Phase 4 — Admin UI
- [x] `apps/web/app/admin/settings/page.tsx` DTO grows to include all 12 Tier 1 + 2 Tier 0 fields
- [x] `AdminSettingsClient.tsx` — sectioned form (Rate Limits, Provider Health, Backfill); per-Tier-1-field "Reset to default (NULL)" button
- [x] Masked input component for Tier 0 with "Rotate" modal flow (never display existing value, length-only validation 20–500)
- [x] Form `min`/`max` attributes consume bounds from `bounds.ts` via DTO
- [x] Audit log discriminator: update PATCH handler to emit `metadata.type`. `AdminAuditLogClient.tsx` rendering switches on `type`; backfill rule: absent `type` → `value_change`. Update `ACTION_LABELS` / `ACTION_CATEGORIES` if needed

### Phase 5 — Tests
- [x] Unit tests per resolver category (env-only / app_config-set / app_config-NULL paths)
- [x] Encryption module unit tests (round-trip + tampered ciphertext + bad key)
- [x] Postgres integration tests (per `integration-test-persistence-direct.md`): migration apply/rollback/re-apply, GET/PATCH `/admin/settings` for new fields, audit log shape (both `type` variants), API key rotate-then-fetch
- [x] HTTP tests (suite 8) — PATCH `/admin/settings` with each new field, audit-log row inspection (both shapes)
- [x] Regression: confirm existing `repair_cooldown_minutes` + `metadata_enrichment_mode` + `dashboard_performance_ranges` paths unaffected
- [x] Run `/aaa` to add or update E2E tests covering 2–3 representative Tier 1 knobs (rate limit, retention window) + 1 Tier 0 rotation flow

### Phase 6 — Docs + ops
- [x] `.env.example` — add `APP_CONFIG_ENCRYPTION_KEY` + 3 cron env vars + Tier 3 freshness env vars
- [x] `docs/002-operations/runbook.md` — deployment prereq for `APP_CONFIG_ENCRYPTION_KEY`, decryption-fail troubleshooting, manual SQL escape hatch for Tier 2 fields
- [x] `docs/001-architecture/` — app_config caching architecture; KZO-121 follow-up note for cross-instance pub/sub invalidation

### Phase 7 — Follow-up tickets
- [x] Tier B follow-up Linear ticket — created during scope-grill (filed alongside this todo)

## Open Items
- (none — all items folded into above)

## References
- Linear ticket: KZO-198
- Precedent: KZO-133 (`repair_cooldown_minutes`), KZO-189 (`metadata_enrichment_mode`), KZO-158A (`dashboard_performance_ranges`)
- Audit context: KZO-194 follow-up grep / Tier A list
- Codebase rules consulted:
  - `.claude/rules/migration-strategy.md` — single migration, no CHECK constraints
  - `.claude/rules/integration-test-persistence-direct.md` — Postgres integration test pattern
  - `.claude/rules/fastify-eviction-lifecycle-pattern.md` — eviction sweep cadence
  - `.claude/rules/full-test-suite.md` — 8-suite pre-PR gate
  - `.claude/rules/admin-new-subpage-checklist.md` — no new subpage but `AdminSettingsClient` and `AdminAuditLogClient` updates required
