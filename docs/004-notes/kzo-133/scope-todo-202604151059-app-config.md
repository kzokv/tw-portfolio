---
slug: kzo-133
source: scope-grill
created: 2026-04-15
tickets: [KZO-133]
required_reading: []
superseded_by: null
---

# Todo: KZO-133 — `app_config` table + DTO-exposed repair availability

> **For agents starting a fresh session:** read the KZO-133 ticket description (Locked Scope section) and this file before starting implementation. Also read the AGENTS.md nearest to each file you touch. Companion context: `docs/004-notes/kzo-86/scope-todo-202604021630-repair-backfill.md` (the KZO-86 implementation this ticket builds on).

## Decision Background

Original ticket proposed a generic JSONB key-value `system_settings` table + `GET`/`PATCH /settings` endpoints + admin UI. Scope-grill (2026-04-15) narrowed this dramatically:

- **Org / admin / RBAC concept** was introduced mid-grill → split into its own epic (follow-up ticket).
- **No UI, no write endpoint**: without an admin role concept, any-authenticated-user writes are unsafe on a global setting.
- **Generic JSONB KV** replaced by a typed single-row table. "No code changes to add a new setting" was a false promise — validation + typing + UI still require code.
- **`REPAIR_COOLDOWN_MINUTES` is global-to-the-deployment** (shared FinMind quota, shared `market_data.instruments` catalog) — not org-scopeable. Confirmed with the user.
- **Read-path robustness (Robust option in G2)**: missing row OR NULL → env fallback. Strict failure was rejected because the env var is already a safe default.

## Implementation Steps

### Migration

- [ ] Create `db/migrations/029_app_config.sql` (highest current is `028`). Schema: `public`.
- [ ] Table definition:
  ```sql
  CREATE TABLE public.app_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    repair_cooldown_minutes INT NULL
      CHECK (repair_cooldown_minutes IS NULL OR repair_cooldown_minutes > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO public.app_config (id, repair_cooldown_minutes) VALUES (1, NULL);
  ```
- [ ] Add migration to `apps/api/src/persistence/migrationManifest.ts` registry.

### Persistence Interface

- [ ] Add `getRepairCooldownMinutes(): Promise<number | null>` to the persistence interface (returns the DB value or `null` for "unset").
- [ ] `PostgresPersistence` implementation: `SELECT repair_cooldown_minutes FROM app_config WHERE id = 1`. Handle row-missing (return `null`) and NULL column (return `null`) identically. Log a `warn` on the row-missing branch ("app_config row missing — falling back to env").
- [ ] `MemoryPersistence` implementation: in-memory field (default `null`). Expose a test setter (`_setRepairCooldownMinutes(n: number | null)`) so unit tests can override. No persistence between test workers — module-level reset in `beforeEach` per `vitest-config-patterns.md`.

### Service Layer — effective-cooldown accessor

- [ ] Add a service-layer function (e.g. `getEffectiveRepairCooldownMinutes()`) that: calls `persistence.getRepairCooldownMinutes()`; returns the DB value if non-null; else returns `Env.REPAIR_COOLDOWN_MINUTES`. Single source of truth — route and DTO mapper both call this.
- [ ] Helper refactor: `remainingCooldownMinutes()` at `registerRoutes.ts:249-255` accepts the effective cooldown as a parameter (no longer reads `Env` directly).

### Repair Route

- [ ] At `registerRoutes.ts:2150` (inside `POST /backfill/repair`): resolve `effectiveCooldown = await getEffectiveRepairCooldownMinutes()` **once at the top of the request**, before the per-ticker loop.
- [ ] Pass `effectiveCooldown` into every `remainingCooldownMinutes()` call within the loop. Do NOT read per-ticker.

### DTO Mapper

- [ ] Find the service call site that builds `InstrumentCatalogItemDto[]` and `MonitoredTickerDto[]` (likely in `apps/api/src/services/market-data/...`).
- [ ] Resolve `effectiveCooldown` **once per request**, before mapping the list. Thread it into the mapper.
- [ ] Mapper computes `repair_available_at`:
  - `last_repair_at IS NULL` → `repair_available_at = null` (no cooldown in force; immediately repairable)
  - Otherwise → `repair_available_at = last_repair_at + effectiveCooldown minutes` as ISO string
- [ ] Do NOT expose `repair_cooldown_minutes` itself to the client. Only the derived timestamp.

### Shared Types

- [ ] Add `repair_available_at: string | null` to `InstrumentCatalogItemDto` in `libs/shared-types` (ISO datetime).
- [ ] Add `repair_available_at: string | null` to `MonitoredTickerDto` in `libs/shared-types`.

### Tests

- [ ] **Migration test**: new migration applies cleanly against a fresh DB.
- [ ] **Unit tests** (vitest, memory backend):
  - `getEffectiveRepairCooldownMinutes()` returns env value when persistence returns null.
  - `getEffectiveRepairCooldownMinutes()` returns DB value when persistence returns a number.
  - `remainingCooldownMinutes()` with parameterized cooldown returns correct remaining minutes.
- [ ] **Integration tests** (`apps/api/test/integration/`, Postgres-backed per `test-placement-persistence-backend.md`):
  - Repair route honors DB value when `app_config.repair_cooldown_minutes` is set.
  - Repair route falls back to env when `app_config.repair_cooldown_minutes` is NULL.
  - Repair route falls back to env when the `app_config` row is missing (DELETE for setup). Warning log emitted.
  - `repair_available_at` present and correct in instrument catalog and monitored tickers responses.
  - `repair_available_at = null` when `last_repair_at IS NULL`.
- [ ] **No new E2E tests required** — existing KZO-86 repair E2E flow continues to pass unchanged. The new DTO field is additive.

### Docs / Cleanup

- [ ] Env schema comment near `REPAIR_COOLDOWN_MINUTES` in `libs/config/src/env-schema.ts`: note that it is the **fallback default** when `app_config.repair_cooldown_minutes` is null/missing; the DB value is authoritative when set.
- [ ] No README changes required.

## Open Items

- [ ] **KZO-141** — Organizations + membership + RBAC epic. Multi-ticket epic introducing org-level multi-tenancy, membership, and admin role. Required before any admin UI or `PATCH /settings`. Needs its own scope-grill before breaking into child tickets.
- [ ] **KZO-142** — Admin settings UI (`GET`/`PATCH /settings` + drawer admin section + audit log). Blocked by KZO-141.

## References

- Linear ticket: [KZO-133](https://linear.app/kzokv/issue/KZO-133)
- Follow-up (spawned): [KZO-141](https://linear.app/kzokv/issue/KZO-141) — Org + RBAC epic
- Follow-up (spawned): [KZO-142](https://linear.app/kzokv/issue/KZO-142) — Admin settings UI (blocked by KZO-141)
- Related ticket: [KZO-86](https://linear.app/kzokv/issue/KZO-86) (repair/backfill — introduced the env var being migrated)
- Related ticket: [KZO-139](https://linear.app/kzokv/issue/KZO-139) (orthogonal — nightly snapshot job)
- KZO-86 scope-todo: `docs/004-notes/kzo-86/scope-todo-202604021630-repair-backfill.md`
- Repair route: `apps/api/src/routes/registerRoutes.ts:2098-2174`
- Cooldown helper: `apps/api/src/routes/registerRoutes.ts:249-255`
- Env schema: `libs/config/src/env-schema.ts:17`
- Migration runner: `apps/api/src/persistence/migrationManifest.ts`
- Latest migration (predecessor): `db/migrations/028_daily_holding_snapshots.sql`
- JSONB pattern reference (not used here): `apps/api/src/persistence/postgres.ts:4068-4130`
- Memory-vs-Postgres test placement rule: `.claude/rules/test-placement-persistence-backend.md`
- Migration immutability rule: `.claude/rules/migration-strategy.md`
