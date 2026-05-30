# KZO-189 Transition Note — Metadata Enrichment Gate

## Problem

Prior to KZO-189, AU metadata enrichment in `backfillWorker.ts` fired unconditionally on every backfill trigger, including `daily_refresh`. The daily refresh cron's purpose is to update price bars for already-known instruments — instruments whose metadata (name, type, industry category) was already fetched at first-backfill time. Calling `fetchInstrumentMetadata()` (one additional Yahoo Finance `quote()` call per instrument per day) on every daily refresh wasted Yahoo Finance API budget without producing new information.

With a 7-ticker AU catalog and one daily refresh per market day, this meant up to 7 unnecessary `quote()` calls per day compounded across the shared per-minute rate limit.

## Solution

A `shouldEnrich` predicate in `backfillWorker.ts` gates the metadata enrichment block. The gate is controlled by:

- `METADATA_ENRICHMENT_MODE` env var (default: `conditional`)
- `app_config.metadata_enrichment_mode` DB column (nullable; `null` falls back to env)
- Admin UI three-option select at `/admin/settings` → "Metadata Enrichment Mode"

The predicate and capacity reservation formula:

```ts
const shouldEnrich = (mode === "unconditional") || (trigger !== "daily_refresh");
const capacity = reserveCapacity(2 + (shouldEnrich ? 1 : 0));
```

**Truth table:**

| `mode` | `trigger` | `shouldEnrich` | `reserveCapacity` |
|---|---|---|---|
| `unconditional` | any | `true` | 3 |
| `conditional` | `user_selection`/`first_trade`/`retry`/`repair` | `true` | 3 |
| `conditional` | `daily_refresh` | **`false`** | **`2`** |

The implementation mirrors the `repairCooldownMinutes` pattern exactly: env var default → nullable DB column override → admin UI surface. No new persistence pattern was introduced.

**Files changed:**
- `db/migrations/045_kzo189_metadata_enrichment_mode.sql` — adds `metadata_enrichment_mode TEXT NULL CHECK (metadata_enrichment_mode IN ('unconditional', 'conditional'))` column to `app_config`
- `libs/config/src/env-schema.ts` — `METADATA_ENRICHMENT_MODE` env var (default `conditional`)
- `apps/api/src/persistence/types.ts` + `memory.ts` + `postgres.ts` — `getAppConfig` / `updateAppConfig` extended
- `apps/api/src/services/market-data/metadataEnrichmentMode.ts` — new service (resolves effective mode from DB + env)
- `libs/shared-types/src/index.ts` — `AppConfigDto.metadataEnrichmentMode` added
- `apps/api/src/routes/adminRoutes.ts` — `PATCH /admin/settings` accepts `metadataEnrichmentMode`
- `apps/api/src/services/market-data/backfillWorker.ts` — `shouldEnrich` predicate + conditional enrichment block
- `apps/api/src/plugins/pgBoss.ts` — passes effective mode into backfill worker
- `apps/web/components/admin/AdminSettingsClient.tsx` — three-option select in Settings UI

**Audit signal:** Mode changes are recorded via the existing `app_config_updated` audit action. Filter with:

```
GET /admin/audit-log?action=app_config_updated
```

Inspect `metadata.before.metadataEnrichmentMode` and `metadata.after.metadataEnrichmentMode` to trace operator changes.

## Testing

Evidence:
- Suite 1 (lint): 0 errors
- Suite 2 (typecheck): 0 errors
- Suite 3 (web unit): 352 passed
- Suite 4 (api unit + memory integration): 943 passed, 313 skipped
- Suite 5 (postgres integration): 600 passed, 1 skipped
- Suite 6 (E2E bypass): 196 passed
- Suite 7 (E2E oauth): 90 passed
- Suite 8 (api HTTP): 207 passed, 2 skipped

Code Review: CLEAN — 0 Critical / 0 High / 0 Medium / 1 LOW deferred.

## Risk/Rollback

**Rollback:** Set `METADATA_ENRICHMENT_MODE=unconditional` in the environment (or set `app_config.metadata_enrichment_mode = 'unconditional'` via the admin UI) to restore pre-KZO-189 behavior exactly. The change is passive — mode changes apply to future jobs only, no replay or recompute needed.

**DB column:** `metadata_enrichment_mode` is nullable. `null` means "use env var fallback." Rollback by removing the env var also restores the default `conditional` behavior without any DB change.

**No behavioral change for non-daily-refresh triggers.** Backfills triggered by `user_selection`, `first_trade`, `retry`, or `repair` continue to enrich metadata unconditionally under `conditional` mode — the gate only suppresses enrichment on `daily_refresh`.

**Escalation path (not KZO-189 scope):** If Yahoo budget pressure resurfaces under `conditional` mode (e.g., high-frequency user-triggered backfills saturate the shared bucket), the correct escalation is to revisit the `reserveCapacity` math in KZO-190. KZO-189 only addresses the daily_refresh over-consumption; per-trigger budget optimization is a separate concern.
