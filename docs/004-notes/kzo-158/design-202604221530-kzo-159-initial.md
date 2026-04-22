---
slug: kzo-158
ticket: KZO-159
created: 2026-04-22
source: architect
supersedes: null
companion: docs/004-notes/kzo-158/scope-todo-202604221500-initial.md
---

# KZO-159 (158A) — Technical Design: Shared user-prefs infra + admin timeframe config + range parser

## 0. Intent

Land the data plumbing (user_preferences table, admin config column, range parser library) that KZO-161 (158C) consumes. Ship one user-editable admin section (Dashboard Timeframe Defaults). No user-facing customization UI in this ticket.

Canonical scope: `docs/004-notes/kzo-158/scope-todo-202604221500-initial.md`. 20 decisions pre-captured via `/scope-grill` — this design does not re-open them.

---

## 1. Design table

| # | Slice | Layers | Key Behaviors | E2E Coverage |
|---|---|---|---|---|
| 1 | **Migration 036** — `user_preferences` table + `app_config.dashboard_performance_ranges` column | db | `user_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, preferences JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`. `ALTER TABLE app_config ADD COLUMN dashboard_performance_ranges JSONB NULL` (null = use hardcoded default). Idempotent `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`. **No changes to `audit_log_action_check`** — user-pref changes are not audited. | N/A (db-only — exercised by slice 5 integration tests) |
| 2 | **Range parser library** — `libs/domain/src/performanceRange.ts` + shared zod schema in `libs/shared-types` | libs/domain, libs/shared-types | Pure functions: `parsePerformanceRange(str) → { kind: "month"|"year"|"ytd"|"all", n?: number }` with regex `/^([1-9]\d*)(M\|Y)$\|^YTD$\|^ALL$/` case-sensitive; `resolveRangeBounds(rangeString, asOf, earliestTradeDate?) → { startDate, endDate }` with bounds `M ≤ 240`, `Y ≤ 50`; `ALL` = since `earliestTradeDate`, or equals `endDate` when no trades. Shared `dashboardPerformanceRangesSchema` in `libs/shared-types/src/index.ts` adjacent to `DashboardPerformanceRange`: `z.array(z.string()).min(1).max(12).refine(...)` — min 1, max 12, reject duplicates (case-sensitive), each element parses via `parsePerformanceRange`. Re-export both from `libs/domain/src/index.ts`. | N/A (unit-tested in slice 5; E2E lives on consuming slices) |
| 3 | **`/dashboard/performance` validator refactor** — dynamic per-request z.enum | apps/api | `registerRoutes.ts:2630` replaces static `z.enum(["1M","3M","YTD","1Y"])` with a per-request `z.enum([...effectiveRanges])` built from the resolved `effectiveRanges` for the caller. Out-of-list → `routeError(400, "invalid_range", "range is not in effective list")`. `apps/api/src/services/dashboard.ts:443` `resolveRangeBounds` replaced with a delegating import from `@tw-portfolio/domain`. `DashboardPerformanceRange` in `libs/shared-types/src/index.ts:152` widens from the closed union to `string` (runtime-validated) — keep the alias for call-site clarity. | Existing dashboard E2E regressions (smoke via suite 6/7) |
| 4 | **`GET /user-preferences` + `PATCH /user-preferences`** + `GET /user-preferences/effective-ranges` | apps/api (routes), apps/api (persistence), libs/shared-types | `GET /user-preferences` → `{ preferences: Record<string, unknown> }`. Lazy: returns `{ preferences: {} }` when no row; no insert on read. `PATCH /user-preferences` body: `Record<string, unknown>` — **strict top-level allowlist** `{ "dashboard_performance_ranges" (string[]\|null), "card_order" (object\|null) }` with 400 on any unknown top-level key (code `unknown_preference_key`). 8 KB request cap → `413 payload_too_large` (measured via `req.headers["content-length"]` + raw body length). Per top-level key: `null` → delete key; non-null → replace atomically (arrays/objects assigned whole). Backend must apply the update in a **single `UPDATE`** using chained `jsonb_set(...)` per changed key, wrapped in `INSERT ... ON CONFLICT (user_id) DO UPDATE`. `dashboard_performance_ranges` (if present) validates against the shared `dashboardPerformanceRangesSchema` — invalid → 400 `invalid_range_list`. **No audit log entry.** Auth: all three routes use `requireSessionUserId(req)` — not `contextUserId` (prefs belong to the session owner, not the viewed portfolio). `GET /user-preferences/effective-ranges` → `{ ranges: string[], source: "user" \| "admin" \| "default" }`; resolution: user's `dashboard_performance_ranges` pruned to admin-allowed set → admin `app_config.dashboard_performance_ranges` → hardcoded `DEFAULT_RANGES = ["1M","3M","YTD","1Y"]`. Auto-prune happens at resolve time — never rewrite stored prefs. `source = "user"` when the user's list contributed at least one range; `"admin"` when fallback to admin column; `"default"` when fallback to hardcoded. **Persistence extensions:** new `Persistence.getUserPreferences(userId)` / `setUserPreferencePatch(userId, patch: Record<string, unknown\|null>)` methods; `getAppConfig()` / `setAppConfig(...)` extended to read/write `dashboardPerformanceRanges: string[] \| null`. | N/A — covered by slice 5 integration tests + slice 8 admin E2E read-through |
| 5 | **Test scaffolding** — parser unit tests + user-prefs integration tests (Postgres-direct) | libs/domain/test, apps/api/test/integration | Parser unit tests under `libs/domain/test/performanceRange.test.ts`: regex edge cases (empty, lowercase, `0M`, `241M`, `51Y`, `YTD`, `ALL`, decimals). Bounds tests: `resolveRangeBounds("1M", "2026-03-15", ...)` → `startDate "2026-02-15"`; YTD → Jan 1; ALL with earliest trade → earliestTradeDate; ALL with no trades → endDate. Integration tests under `apps/api/test/integration/user-preferences.integration.test.ts` using `PostgresPersistence` directly (scope-todo references `catalogSync.integration.test.ts` pattern per `.claude/rules/integration-test-persistence-direct.md` — full pattern with `applyNumberedMigrations`). Seed real users via `persistence.resolveOrCreateUser(...)` before calling user-pref methods (audit_log FK rule still applies if any path appends audit; our routes don't, but seed for realism). Cases: GET empty → `{}`; PATCH single key → GET reads back; PATCH with `null` → key deleted; PATCH with 8.1 KB body → 413; PATCH with unknown top-level key → 400; PATCH with invalid range list → 400; effective-ranges resolution across the 3 tiers. Sibling memory-backend `describe` runs the 400/413/resolution cases against `MemoryPersistence` (seed via `persistence.getAppConfig()` + helper). | N/A (integration tests, not E2E) |
| 6 | **Admin PATCH /admin/settings extension** | apps/api (routes) | `adminRoutes.ts:17` `patchAdminSettingsSchema` extends with optional `dashboardPerformanceRanges: z.union([dashboardPerformanceRangesSchema, z.null()]).optional()`. On change, audit_log entry uses existing `app_config_updated` action — add `before/after.dashboardPerformanceRanges` to the metadata diff. Persistence extends `setAppConfig(patch: { repairCooldownMinutes?; dashboardPerformanceRanges? })` OR adds a sibling `setDashboardPerformanceRanges(value)`. Decision: **sibling setter** keeps symmetry with `setRepairCooldownMinutes` and avoids touching 3 call-sites. The route layer sequences: fetch current → diff → call both setters when both change (rare). | Suite 5 integration test in slice 5, plus admin E2E section in slice 8 |
| 7 | **`POST /__e2e/seed-user-preferences`** | apps/api (routes) | Guarded by `assertE2ESeedEnabled()` (seed, not reset — per `.claude/rules/e2e-seed-vs-reset-guards.md`; precedent: `POST /__e2e/seed-notification` at `registerRoutes.ts:1173`). Body: `{ userId?: string, preferences: Record<string, unknown> }`. Defaults `userId` to `resolveUserId(req).userId`. Writes full-replace to memory persistence via a new `_setUserPreferences(userId, prefs)` test helper. | N/A (test infra) |
| 8 | **AdminSettingsClient — "Dashboard Timeframe Defaults" section** | apps/web (React), libs/shared-types | New section rendered **below** the existing "Repair cooldown" Card in `apps/web/components/admin/AdminSettingsClient.tsx`. `admin-new-subpage-checklist.md` does NOT apply (same page). Mirrors the existing Repair-cooldown section style (client-side inline validation blocks Save, server 400 echoed to same error slot). UI: `{1M, 3M, YTD, 1Y, 5Y, 10Y}` pill-toggles (default-on selection source: `config.dashboardPerformanceRanges ?? DEFAULT_RANGES`; rows not in the default set render as additional chips), custom range `<input>` + Add button, "Reset to defaults" link (clears to `null`). **Order:** simple up/down arrow buttons per chip (drag defers to 158C — decision locked here). Save disabled when (a) list empty, (b) any custom chip fails shared zod validation, (c) duplicates. Save = `PATCH /admin/settings { dashboardPerformanceRanges: string[] \| null }`. Testids: `timeframe-defaults-section`, `timeframe-chip-{range}`, `timeframe-add-input`, `timeframe-add-button`, `timeframe-reset-button`, `timeframe-save-button`, `timeframe-validation-error`, `timeframe-chip-up-{range}`, `timeframe-chip-down-{range}`. Helper text: _"Users can override these defaults in their own Display Preferences."_ | **Required** — AAA E2E slice 9 (below) |
| 9 | **AAA E2E — admin timeframe defaults** | apps/web/tests/e2e | Run `/aaa` to produce `specs-oauth/admin-timeframe-defaults-aaa.spec.ts` (admin E2E lives in oauth suite). Scenarios: (a) default render shows the 4 hardcoded chips active; (b) toggle a chip off + Save → reload shows pref persisted; (c) add custom `5Y` chip + Save → reload shows it; (d) Reset to defaults → Save → reload clears admin override; (e) invalid custom input (`0M`, `abc`) → validation error, Save disabled; (f) duplicate range rejected. Admin-role fixture required — mirror `specs-oauth/admin-*.spec.ts` precedent for the role seed. | Covered here |
| 10 | **Cross-slice housekeeping** — type widening, constant export, i18n strings, persistence interface | libs/shared-types, apps/api/src/persistence/types.ts, apps/web i18n | Export `DEFAULT_DASHBOARD_PERFORMANCE_RANGES: readonly string[]` from `libs/shared-types`. Update `AppConfigDto` with `dashboardPerformanceRanges: string[] \| null` and `effectiveDashboardPerformanceRanges: string[]`. Add `Persistence` interface methods: `getUserPreferences(userId): Promise<Record<string, unknown>>`, `setUserPreferencePatch(userId, patch): Promise<Record<string, unknown>>`, `setDashboardPerformanceRanges(value: string[] \| null): Promise<void>`. i18n strings for the new section placed next to existing admin-settings strings (string templates, no functions — `.claude/rules/nextjs-i18n-serialization.md`). | N/A — supporting plumbing |

---

## 2. Locked architectural decisions

### D1 — `user_id` column type is **TEXT**, not UUID

**Problem in scope-todo:** Step 1 specifies `user_id UUID PRIMARY KEY REFERENCES users(id)`. But `users.id` is **TEXT** in the existing schema (`baseline_current_schema.sql:5`, confirmed via grep of every other FK in migrations 030–035 that references `users(id)` — all declare TEXT). FK type must match the referent; a UUID column cannot reference a TEXT PK.

**Decision:** `user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`. The application still inserts UUIDs (`randomUUID()`), just as TEXT — consistent with every other user-scoped table in the schema.

### D2 — Route uses `requireSessionUserId`, not `contextUserId`

User preferences belong to the **session owner**, never the viewed portfolio (when impersonating or viewing a shared portfolio, the caller still edits their own prefs). Pattern precedent: `requireSessionUserId` at `registerRoutes.ts:1779,1788,1794` for identity/profile/notifications routes.

### D3 — Single `UPDATE` with chained `jsonb_set` per changed top-level key

The scope-todo cites `jsonb_set per top-level key in single UPDATE`. No existing `jsonb_set` usage in `postgres.ts` (grepped) — this is a **net-new pattern**. Canonical SQL shape (pinned here so Implementer and QA both target the same):

```sql
INSERT INTO user_preferences (user_id, preferences, updated_at)
VALUES ($1, $2::jsonb, NOW())
ON CONFLICT (user_id) DO UPDATE
SET preferences = (
  SELECT COALESCE(
    -- Chain jsonb_set for each non-null key, jsonb_strip_nulls-less approach:
    -- Build via programmatic concat of jsonb_set calls in TS query builder,
    -- or use COALESCE(user_preferences.preferences, '{}'::jsonb) || EXCLUDED.preferences
    user_preferences.preferences,
    '{}'::jsonb
  ) || EXCLUDED.preferences,
  '{}'::jsonb
),
updated_at = NOW()
RETURNING preferences;
```

**Simpler accepted shape** — since all top-level keys are replaced atomically (no nested patching), the `||` jsonb-concat operator is equivalent to N `jsonb_set` calls at the top level. For `null`-deletes, strip nulls from the patch in TS before sending, and run a second `jsonb - 'key'` for each deleted key in the same UPDATE:

```sql
-- Final accepted shape (Implementer encodes this):
INSERT INTO user_preferences (user_id, preferences, updated_at)
VALUES ($1, $2::jsonb, NOW())
ON CONFLICT (user_id) DO UPDATE
SET preferences = (user_preferences.preferences || EXCLUDED.preferences) - $3::text[],
    updated_at = NOW()
RETURNING preferences;
```

Where `$2` is the JSON of non-null keys and `$3` is the array of keys to delete. This is **one** round trip, one UPDATE, atomic.

### D4 — 8 KB cap is on request body, not JSONB cell

Measure `req.raw` body length (Fastify exposes `req.body` after parse; check pre-parse via `content-length` header + a hard re-check against `JSON.stringify(body).length`). Return `413 payload_too_large` code. `body` already parsed by Fastify's default JSON parser → if too large after the fact, return 413 anyway. Fastify's default bodyLimit is 1 MB which is too permissive — **set a per-route `bodyLimit: 8192`** on the PATCH route.

### D5 — Effective-ranges endpoint scope

Ship as **dedicated endpoint** `GET /user-preferences/effective-ranges` (not folded into `/dashboard/overview`). Reason: (a) dashboard/overview is large and adding prefs there widens the SSR blast radius; (b) the AdminSettingsClient needs to read effective ranges independently of dashboard; (c) the `source` field is more discoverable as a standalone resource. `/dashboard/performance` internally calls the same resolver (pulled into a `libs/domain/`-adjacent resolver helper or a service-layer function in `apps/api`) to build the dynamic `z.enum`.

### D6 — Resolver location: `apps/api/src/services/userPreferences.ts`

The 3-tier effective-range resolver is **API-service layer**, not `libs/domain`. Reason: it reads persistence (user row + app_config). `libs/domain` stays pure. The endpoint handler + the `/dashboard/performance` route both call `resolveEffectiveRanges(app.persistence, userId): Promise<{ ranges: string[], source: "user"|"admin"|"default" }>`.

### D7 — Drag reorder: simple ↑↓ buttons in 158A; dnd-kit deferred to 158C

Drag in admin creates a dnd-kit dependency in 158A that is otherwise isolated to 158C. Up/down arrows are keyboard-accessible and trivially AAA-testable. When 158C lands dnd-kit, an optional future polish pass can upgrade the admin section.

### D8 — Migration 036 does NOT touch `audit_log_action_check`

User-prefs changes are not audited (scope-locked). Admin changes to `dashboardPerformanceRanges` reuse the existing `app_config_updated` action. No constraint change needed.

### D9 — Shared zod schema location + export path

`libs/shared-types/src/index.ts` next to `DashboardPerformanceRange` (line 152). Exports:
- `DEFAULT_DASHBOARD_PERFORMANCE_RANGES = ["1M","3M","YTD","1Y"] as const`
- `parseDashboardPerformanceRange(s: string): ParsedRange` (re-exported from libs/domain via libs/shared-types for client-side use)
- `dashboardPerformanceRangesSchema: z.ZodType<string[]>`

`libs/shared-types` must NOT import from `apps/*`. If zod availability in shared-types is currently absent, add `"zod"` as a direct dependency of `libs/shared-types`. (Verify: `grep "\"zod\"" libs/shared-types/package.json` before implementation — Backend Implementer fixes up if missing.)

### D10 — Auth-mode notes for integration tests

Per `.claude/rules/vitest-config-patterns.md`: `apps/api/vitest.config.ts` sets `AUTH_MODE=dev_bypass`. Integration tests for `/user-preferences` can run with that default — `requireSessionUserId` falls through to the dev-bypass default. QA must inject `x-user-id` headers keyed to seeded users for multi-user resolution tests. **Do NOT** use `buildApp` (per `.claude/rules/integration-test-persistence-direct.md`) — instantiate `PostgresPersistence` directly and test the persistence methods + a minimal route-handler harness, OR spin up a `buildApp({ persistenceBackend: "postgres" })` WITH the redis workarounds — reject: stick to `PostgresPersistence` direct + test the persistence surface; cover route semantics via suite 8 (HTTP tests under `apps/api/test/http/`).

### D11 — Typecheck scope reminder

`apps/api/test/tsconfig.json` currently scopes to `test/http/**` only (per `.claude/rules/full-test-suite.md`). Adding `apps/api/test/integration/user-preferences.integration.test.ts` **will NOT be typechecked by the default script** unless we either (a) expand the test tsconfig include, or (b) add a dedicated tsconfig. Backend Implementer + QA MUST explicitly run `npx tsc --noEmit -p apps/api/test/tsconfig.json` (after temporary include expansion during dev) OR rely on vitest's runtime-only behavior with eslint as the type-safety net. **Decision:** expand `apps/api/test/tsconfig.json` `include` to cover `test/integration/user-preferences.integration.test.ts` (one-file precision — avoids pulling in pre-existing drift from other integration files). Implementer owns the tsconfig edit.

### D12 — Widening `DashboardPerformanceRange` type

Current: `type DashboardPerformanceRange = "1M" | "3M" | "YTD" | "1Y";` (closed union).
Target: `type DashboardPerformanceRange = string;` (runtime-validated).
Rationale: dynamic z.enum + admin-configurable list makes the compile-time union a liability — it would reject `"5Y"` statically. Widening is safe because every call-site already routes through `parsePerformanceRange` or the shared zod schema.

### D13 — Memory persistence no-ops for Postgres-only behavior

`MemoryPersistence.getAppConfig()` already exists — extend it with a `dashboardPerformanceRanges: string[] | null` field (default `null`). `setDashboardPerformanceRanges` is a simple assignment. `getUserPreferences/setUserPreferencePatch` on memory implement the same semantics (top-level merge, `null` deletes). No FK enforcement — MemoryPersistence gap per `.claude/rules/test-placement-persistence-backend.md`. QA places the 3-tier resolution tests in **both** memory (unit) and Postgres (integration) since the logic is deterministic in memory too. FK-enforcement tests (ON DELETE CASCADE of user_preferences) go Postgres-only.

### D14 — No rate limiting on user-prefs endpoints in 158A

Not in scope (158C adds user-facing UI; rate-limit considerations can join there if usage patterns warrant it). Admin `/admin/settings` already has implicit rate limit via admin-role gate.

### D15 — Commit format

All commits `feat(api,web,db): KZO-159: <subject>`, `test(api): KZO-159: ...`, `refactor(domain): KZO-159: ...` per `.claude/rules/commit-format.md`.

---

## 3. Precedent file cross-reference (to be cited in Implementer AND QA briefings)

| Artifact | Precedent | Lines |
|---|---|---|
| Existing range resolver | `apps/api/src/services/dashboard.ts` | 443–462 |
| Dynamic z.enum pattern (new) | Net-new — pin via this doc |  |
| Shared zod location | `libs/shared-types/src/index.ts` | 152 (next to `DashboardPerformanceRange`) |
| JSONB merge SQL | Net-new — pin via D3 above |  |
| Seed guard | `registerRoutes.ts:1173` (`POST /__e2e/seed-notification`) + `assertE2ESeedEnabled` at 933 |  |
| Admin section pattern | `apps/web/components/admin/AdminSettingsClient.tsx` — entire "Repair cooldown" Card (lines 130–202) |  |
| Integration test pattern | `apps/api/test/integration/catalogSync.integration.test.ts` + `admin-management.integration.test.ts` (KZO-149) — `applyNumberedMigrations` pattern |  |
| Persistence app_config methods | `apps/api/src/persistence/postgres.ts:5281–5302` (getAppConfig / setRepairCooldownMinutes) |  |
| Persistence interface | `apps/api/src/persistence/types.ts:620–633` — add user-prefs methods nearby, section-commented |  |
| `adminRoutes.ts` schema extension | `adminRoutes.ts:17–19` + `303–325` (handler diff template) |  |
| AppConfigDto extension | `libs/shared-types/src/index.ts:337` |  |

---

## 4. Test plan acceptance criteria (Senior QA must satisfy all)

1. Parser unit tests: 100% branch coverage on `parsePerformanceRange` + `resolveRangeBounds`, including bound violations, ALL with earliestTradeDate undefined, YTD crossing year boundary.
2. Shared zod tests: min/max length, duplicate rejection, invalid format rejection. One test per rejection reason.
3. Integration tests (Postgres-direct, per rule): GET empty, PATCH create, PATCH update merges existing keys, PATCH with `null` deletes key, PATCH unknown key → 400, PATCH > 8 KB → 413, invalid range list → 400, effective-ranges 3-tier resolution (user > admin > default), ON DELETE CASCADE when user deleted.
4. Memory-backed unit tests (sibling describe — NOT inside `describePostgres`): the deterministic route-logic cases (400/413/resolution tiers) but NOT FK cascade.
5. Admin AAA E2E (slice 9 scenarios a–f) under `specs-oauth/`.
6. All eight full-suite gates green pre-PR.
7. `/dashboard/performance?range=<out-of-list>` → 400 (regression test).

---

## 5. Out-of-scope guardrails (re-stated)

- No user-facing customization UI (158C).
- No dnd-kit (158C).
- No transaction-form changes (158B).
- No rate limiting on user-prefs (future if needed).
- No `user_preferences` audit logging.

---

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Widening `DashboardPerformanceRange` breaks call-sites that pattern-match the closed union | grep for `DashboardPerformanceRange` union members; confirm every use already routes through parser or z.enum |
| Shared zod import cycle (libs/shared-types ↔ libs/domain) | Schema lives in `libs/shared-types` standalone; parser in `libs/domain` re-exports zod schema for server/client symmetry |
| Migration 036 deployed but prefs feature toggled off later | `dashboardPerformanceRanges` column is nullable; zero rows in `user_preferences` is valid. Safe to disable feature without rollback |
| `libs/shared-types` doesn't currently depend on zod | Backend Implementer adds `"zod"` to `libs/shared-types/package.json` dependencies; rebuild libs before API/web consume it |
| Typecheck miss on new integration test file | D11: Implementer expands `apps/api/test/tsconfig.json` include to cover the new file |
| `vi.mock("@tw-portfolio/config")` scope (per `.claude/rules/vitest-config-patterns.md`) | Not needed for this ticket — tests stay in dev_bypass mode with explicit `x-user-id` headers |

---

## 7. Convergence-loop exit checklist

- [ ] Slice 1 migration file present and idempotent
- [ ] Slice 2 parser + schema exported
- [ ] Slice 3 `/dashboard/performance` uses dynamic enum
- [ ] Slice 4 routes implement GET/PATCH/effective-ranges
- [ ] Slice 5 all tests in place (unit + integration + memory sibling)
- [ ] Slice 6 admin settings schema extended + audit metadata diff
- [ ] Slice 7 seed endpoint live
- [ ] Slice 8 admin UI section rendering with validation
- [ ] Slice 9 AAA E2E green
- [ ] Slice 10 types/interfaces consistent + i18n strings
- [ ] `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full` green
- [ ] Code Reviewer `[DONE:CLEAN]`
- [ ] Architect architectural review clean
