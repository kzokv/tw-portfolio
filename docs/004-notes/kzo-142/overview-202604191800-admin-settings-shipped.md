---
slug: kzo-142
type: overview
created: 2026-04-19T18:00:00Z
tickets: [KZO-142]
superseded_by: null
---

# KZO-142 — Admin Settings UI ships: GET/PATCH /admin/settings + settings tab

## What shipped

KZO-142 wires the `app_config` table introduced in KZO-133 to a full admin UI. Admins can now override the repair cooldown directly from the admin portal instead of via direct SQL. Fourteen deliverables shipped in a single iteration with zero Critical/High/Medium findings.

### Deliverables

| # | Item |
|---|---|
| 1 | `getAppConfig()` + `setRepairCooldownMinutes()` on `MemoryPersistence` and `PostgresPersistence` |
| 2 | `app_config_updated` added to `AuditLogAction` union in `persistence/types.ts` |
| 3 | `AppConfigDto` added to `libs/shared-types/src/index.ts` |
| 4 | Route guard extraction → `apps/api/src/lib/routeGuards.ts` (4 guards moved from `registerRoutes.ts`) |
| 5 | Admin routes extraction → `apps/api/src/routes/adminRoutes.ts` (all `/admin/*` routes, registered under prefix) |
| 6 | `GET /admin/settings` endpoint (admin-only, returns `AppConfigDto`) |
| 7 | `PATCH /admin/settings` endpoint (admin-only, Zod-validated body, no-op guard, audit log write) |
| 8 | `POST /__e2e/reset-app-config` reset endpoint (gated by `assertE2EResetEnabled`) |
| 9 | Audit log UI: `app_config_updated` label + Settings category in `AdminAuditLogClient.tsx` |
| 10 | Admin sidebar: Settings nav item in `AdminSidebar.tsx` |
| 11 | Web settings page: `apps/web/app/admin/settings/page.tsx` + `AdminSettingsClient.tsx` |
| 12 | Test-API library: extended `AdminEndpoint`, `AdminApiActions`, `AdminApiArrange`, `AdminApiAssert` |
| 13 | HTTP spec: `admin-settings-aaa.http.spec.ts` — 10 cases |
| 14 | E2E spec: `admin-settings-aaa.spec.ts` — 6 cases; unit tests: `app-config-setter.test.ts` + `admin-settings-schema.test.ts` — 4 cases |

## Key files

| File | Role |
|---|---|
| `apps/api/src/lib/routeGuards.ts` | **New** — extracted route guards (`requireAdminRole`, `requireWriterRole`, `requireShareGrantorRole`, `requireWriteableContext`) |
| `apps/api/src/routes/adminRoutes.ts` | **New** — all `/admin/*` routes, registered as Fastify plugin under `/admin` prefix |
| `apps/api/src/persistence/types.ts` | Added `getAppConfig`, `setRepairCooldownMinutes` to interface; `app_config_updated` to union |
| `apps/api/src/persistence/memory.ts` | `getAppConfig`, `setRepairCooldownMinutes` with monotonic timestamp guard |
| `apps/api/src/persistence/postgres.ts` | `getAppConfig` (SELECT), `setRepairCooldownMinutes` (UPDATE with NOW()) |
| `libs/shared-types/src/index.ts` | `AppConfigDto { repairCooldownMinutes, effectiveRepairCooldownMinutes, updatedAt }` |
| `apps/api/src/routes/registerRoutes.ts` | Imports from `routeGuards.ts`; registers `adminRoutes` plugin; `ADMIN_ROUTE_KEYS` extended |
| `apps/web/app/admin/settings/page.tsx` | **New** — server component; fetches DTO server-side |
| `apps/web/components/admin/AdminSettingsClient.tsx` | **New** — interactive toggle + input + save + audit footer |
| `apps/web/components/admin/AdminSidebar.tsx` | Settings nav item added |
| `apps/web/components/admin/AdminShell.tsx` | `/admin/settings` → "Settings" in `ADMIN_TITLES` |
| `apps/web/components/admin/AdminAuditLogClient.tsx` | `app_config_updated` label + Settings category |
| `apps/api/test/http/specs/admin-settings-aaa.http.spec.ts` | **New** — 10 HTTP spec cases |
| `apps/web/tests/e2e/specs/admin-settings-aaa.spec.ts` | **New** — 6 E2E cases |
| `apps/api/test/unit/app-config-setter.test.ts` | **New** — MemoryPersistence setter unit tests |
| `apps/api/test/unit/admin-settings-schema.test.ts` | **New** — Zod body schema validation unit tests |
| `libs/test-api/src/endpoints/AdminEndpoint.ts` | `getAdminSettings` + `patchAdminSettings` added |
| `libs/test-api/src/assistants/admin/Admin{Actions,Arrange,Assert}.ts` | Settings-specific helpers added |
| `libs/test-e2e/src/assistants/layout/AppShell{Actions,Assert}.ts` | Settings test-ID helpers added |

## Architecture notes

### `routeGuards.ts` extraction

`registerRoutes.ts` had grown to ~3,000+ lines. KZO-142 extracted four guard functions into `apps/api/src/lib/routeGuards.ts`. All callers in `registerRoutes.ts` now import from `../lib/routeGuards.js`. The `resolveAdminContext` helper and `assertNotSelf` are co-located in `adminRoutes.ts` (admin-only concerns).

### `adminRoutes.ts` plugin

All `/admin/*` routes are now a Fastify plugin registered at:

```ts
// registerRoutes.ts
fastify.register(adminRoutes, { prefix: "/admin" });
```

`req.routeOptions.url` returns the full path (e.g. `/admin/settings`), so `ADMIN_ROUTE_KEYS` matching in the `preHandler` hook continues to work unchanged.

### PATCH no-op guard

```typescript
if (body.repairCooldownMinutes === current.repairCooldownMinutes) {
  return loadAppConfigDto(app);
}
```

Strict equality covers `null === null` and `number === number`. No DB write and no audit log entry on a no-op save. The HTTP spec exercises this with a dedicated test case.

### `ADMIN_TITLES` gotcha (caught as LOW-3 in Code Review)

`AdminSidebar.tsx` and `AdminShell.tsx` are independent files. Adding the sidebar nav item without adding the corresponding `ADMIN_TITLES` entry causes the page title to render blank. This was caught by the Code Reviewer on the first pass. A checklist memory candidate is staged at `.worklog/team/memory/technical-writer.md` → Candidate A.

### MemoryPersistence monotonic timestamp

`setRepairCooldownMinutes` in `memory.ts` guards against same-millisecond calls:

```typescript
const prevMs = Date.parse(this._appConfigUpdatedAt);
const nextMs = Math.max(Date.now(), Number.isFinite(prevMs) ? prevMs + 1 : Date.now());
this._appConfigUpdatedAt = new Date(nextMs).toISOString();
```

Unit test `app-config-setter.test.ts` (consecutive-call case) validates the strict advancement guarantee.

## Test coverage summary

**1582 tests pass across all 8 suites** (lint, typecheck, web unit, API unit+memory, API Postgres integration, E2E bypass, E2E oauth, API HTTP specs).

| Layer | New cases | Description |
|---|---|---|
| HTTP spec (Playwright, oauth mode) | 10 | GET/PATCH shape, validation, 403 role enforcement, no-op |
| E2E (Playwright, dev_bypass) | 6 | Page load, toggle on/off, save flow, validation |
| Unit (Vitest) | 4 | MemoryPersistence setter + Zod schema boundary values |

No regressions. Code Review verdict: **CLEAN** (0 Critical / 0 High / 0 Medium / 2 Low / 2 Informational). Both Low items are non-blocking (test helper cast, missing `undefined` unit test proxy).

## Follow-up items

- **INFO-2 (pre-existing):** `user_login` / `user_linked_identity` appear in `ACTION_LABELS` but not in the `AuditLogAction` union. Not introduced by KZO-142. Worth a follow-up ticket to tighten the type.
- **INFO-1 (by design):** Double `requireAdminRole` call on settings handlers vs. sibling admin routes — intentional defense-in-depth, per design spec. Consider a code comment if a future reader asks why.
- **`_setRepairCooldownMinutes` rename** deferred from KZO-133: still open; safe to fix in any future PR touching `MemoryPersistence`.

## References

- Scope-todo: `docs/004-notes/kzo-142/scope-todo-202604191332-admin-settings.md`
- Code review: `docs/004-notes/kzo-142/review-202604190730-admin-settings.md`
- KZO-133 overview (app_config foundation): `docs/004-notes/kzo-133/overview-202604151415-app-config-ships.md`
- Rules consulted: `admin-new-subpage-checklist` (memory candidate A), `integration-test-persistence-direct.md`, `service-error-pattern.md`, `e2e-seed-vs-reset-guards.md`, `code-review-before-pr.md`
- Linear: https://linear.app/kzokv/issue/KZO-142
