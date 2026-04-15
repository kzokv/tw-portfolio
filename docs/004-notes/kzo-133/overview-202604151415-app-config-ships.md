---
slug: kzo-133
type: overview
created: 2026-04-15T14:15:00Z
tickets: [KZO-133]
superseded_by: null
---

# KZO-133 — `app_config` ships: runtime repair cooldown + DTO `repairAvailableAt`

## What shipped

Migration 029 introduces `public.app_config`, a typed single-row configuration table. The first (and currently only) column is `repair_cooldown_minutes INT NULL`. The table replaces exclusive reliance on the `REPAIR_COOLDOWN_MINUTES` environment variable for the FinMind bar-repair cooldown window.

Both `InstrumentCatalogItemDto` and `MonitoredTickerDto` now expose `repairAvailableAt: string | null` — an ISO timestamp derived at request time from `lastRepairAt + effectiveCooldown`. Clients can use this field directly to gate repair UI affordances without local clock math.

This is a read-only feature. No write endpoint, no admin UI, no RBAC. The DB value can only be changed via direct SQL until KZO-141 and KZO-142 land.

## DB schema summary

```sql
CREATE TABLE public.app_config (
  id                      INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  repair_cooldown_minutes INT NULL
    CHECK (repair_cooldown_minutes IS NULL OR repair_cooldown_minutes > 0),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Seeded: INSERT (1, NULL) ON CONFLICT DO NOTHING
```

Constraints enforced:
- `CHECK (id = 1)` — singleton row; insert of a second row is rejected at the DB level.
- `CHECK (repair_cooldown_minutes IS NULL OR repair_cooldown_minutes > 0)` — zero is rejected; NULL means "unset, use env fallback".

## DTO shape additions

Both DTOs in `libs/shared-types/src/index.ts` received:

```ts
/** KZO-133: earliest ISO time the ticker/instrument can be repaired; null when no prior repair. */
repairAvailableAt: string | null;
```

`null` semantics: no prior repair has occurred — the ticker is immediately repairable. A non-null value is the earliest wall-clock time at which the next repair may begin.

## Env var: `REPAIR_COOLDOWN_MINUTES`

Defined in `libs/config/src/env-schema.ts`. Role changed by this ticket:

- **Before KZO-133:** sole source of truth for cooldown duration.
- **After KZO-133:** fallback default. The DB value (`app_config.repair_cooldown_minutes`) is authoritative when non-null. The env var applies when the DB value is NULL or the `app_config` row is missing.

The accessor is `getEffectiveRepairCooldownMinutes(persistence)` in `apps/api/src/services/market-data/repairCooldown.ts`. All call sites (repair route, catalog mapper, monitored-tickers mapper) call this once per request — never per-ticker.

## Key files

| File | Role |
|---|---|
| `db/migrations/029_app_config.sql` | Migration — creates table and seeds row |
| `apps/api/src/services/market-data/repairCooldown.ts` | Service module — accessor, derive helper, remaining helper |
| `libs/shared-types/src/index.ts` | DTO additions (`InstrumentCatalogItemDto`, `MonitoredTickerDto`) |
| `apps/api/test/unit/repair-cooldown.test.ts` | 18 unit tests |
| `apps/api/test/integration/app-config.integration.test.ts` | 8 integration tests (Postgres-backed) |

## Follow-up items — flagged for future implementer

The following were explicitly deferred. Do not implement without the prerequisites listed.

### KZO-141 — Organizations + membership + RBAC (PREREQUISITE for all below)
Multi-ticket epic. Introduces org-level multi-tenancy, membership model, and admin role concept. Without this, any write endpoint on `app_config` would allow any authenticated user to modify a global deployment setting. Needs its own scope-grill before breaking into child tickets.

### KZO-142 — Admin settings UI (BLOCKED on KZO-141)
`GET /settings` + `PATCH /settings` API endpoints, admin drawer in the web UI, audit log for setting changes. Full design depends on the RBAC model from KZO-141.

### `updated_at` ON UPDATE trigger (low priority)
The `updated_at` column exists in the schema but is not automatically bumped on UPDATE. A migration adding a trigger (or application-level `updated_at = NOW()` in the PATCH handler) should accompany KZO-142.

### `_setRepairCooldownMinutes` rename (cosmetic, low priority)
The `MemoryPersistence` test-setter should be renamed (e.g. `_resetRepairCooldownMinutes`) for prefix consistency with other test-only helpers. Safe to do in any future PR that touches `MemoryPersistence`.
