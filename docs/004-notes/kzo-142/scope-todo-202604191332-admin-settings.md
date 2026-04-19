---
slug: kzo-142
source: scope-grill
created: 2026-04-19
tickets: [KZO-142]
required_reading:
  - docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md
  - docs/004-notes/kzo-133/overview-202604151415-app-config-ships.md
superseded_by: null
---

# Todo: KZO-142 — Admin Settings UI (GET/PATCH /admin/settings + /admin/settings tab)

> **For agents starting a fresh session:** read all files in `required_reading` above before implementing. KZO-133 overview describes the existing `app_config` schema and why `updated_at` has no trigger. The KZO-141 scope-todo explains the admin portal shell (KZO-144) that this ticket extends.

## Implementation Steps

### 1. Persistence interface + implementations

- [ ] Add `getAppConfig(): Promise<{ repairCooldownMinutes: number | null, updatedAt: string }>` to `apps/api/src/persistence/types.ts`
- [ ] Add `setRepairCooldownMinutes(value: number | null): Promise<void>` to `apps/api/src/persistence/types.ts` — stamps `updated_at = NOW()` internally
- [ ] Add `app_config_updated` to `AuditLogAction` union in `apps/api/src/persistence/types.ts`
- [ ] Implement `getAppConfig()` in `apps/api/src/persistence/postgres.ts` — `SELECT repair_cooldown_minutes, updated_at FROM public.app_config WHERE id = 1`
- [ ] Implement `setRepairCooldownMinutes()` in `apps/api/src/persistence/postgres.ts` — `UPDATE public.app_config SET repair_cooldown_minutes = $1, updated_at = NOW() WHERE id = 1`
- [ ] Implement `getAppConfig()` in `apps/api/src/persistence/memory.ts` — add `_appConfigUpdatedAt: string` field, initialized to `new Date().toISOString()` at construction
- [ ] Implement `setRepairCooldownMinutes()` in `apps/api/src/persistence/memory.ts` — updates value + stamps `_appConfigUpdatedAt = new Date().toISOString()`

### 2. Shared types

- [ ] Add `AppConfigDto` to `libs/shared-types/src/index.ts`:
  ```ts
  export interface AppConfigDto {
    repairCooldownMinutes: number | null;
    effectiveRepairCooldownMinutes: number;
    updatedAt: string;
  }
  ```

### 3. Route guard extraction

- [ ] Create `apps/api/src/lib/routeGuards.ts` and move these exported functions from `registerRoutes.ts`:
  - `requireAdminRole`
  - `requireWriterRole`
  - `requireShareGrantorRole`
  - `requireWriteableContext`
- [ ] Update all callers in `registerRoutes.ts` to import from `../lib/routeGuards.js`

### 4. Admin routes extraction

- [ ] Create `apps/api/src/routes/adminRoutes.ts`
- [ ] Identify and move all admin-prefixed route handlers from `registerRoutes.ts` to `adminRoutes.ts` (users, invites, audit-log endpoints from KZO-144)
- [ ] Move shared imports needed only by admin routes into `adminRoutes.ts`
- [ ] Replace inline admin route handlers in `registerRoutes.ts` with `fastify.register(adminRoutes, { prefix: "/admin" })`
- [ ] Verify all existing admin HTTP specs still pass after extraction

### 5. API route — GET /admin/settings

- [ ] Add `GET /admin/settings` to `adminRoutes.ts`
- [ ] Guard: `requireAdminRole(req)`
- [ ] Call `persistence.getAppConfig()` for the row values
- [ ] Call `getEffectiveRepairCooldownMinutes(persistence)` from `repairCooldown.ts` for `effectiveRepairCooldownMinutes`
- [ ] Return `AppConfigDto`

### 6. API route — PATCH /admin/settings

- [ ] Add `PATCH /admin/settings` to `adminRoutes.ts`
- [ ] Guard: `requireAdminRole(req)`
- [ ] Zod body schema: `z.object({ repairCooldownMinutes: z.union([z.number().int().min(1).max(10080), z.null()]) })`
- [ ] Read current value via `persistence.getAppConfig()` for no-op guard + audit "before" value
- [ ] **No-op guard**: if incoming value === current value, return current `AppConfigDto` immediately (skip write + audit)
- [ ] Call `persistence.setRepairCooldownMinutes(value)` (stamps `updated_at` internally)
- [ ] Call `persistence.appendAuditLog({ actorUserId, action: "app_config_updated", metadata: { before: { repairCooldownMinutes: prev }, after: { repairCooldownMinutes: value } } })`
- [ ] Return updated `AppConfigDto` (re-read or construct from written values)

### 7. E2E test reset endpoint

- [ ] Add `POST /__e2e/reset-app-config` to `adminRoutes.ts` (or `registerRoutes.ts` alongside other `/__e2e/` endpoints)
- [ ] Gate with `assertE2EResetEnabled()`
- [ ] Calls `persistence.setRepairCooldownMinutes(null)` to restore clean state

### 8. Audit log UI updates

- [ ] Add `app_config_updated: "Updated settings"` to `ACTION_LABELS` in `apps/web/components/admin/AdminAuditLogClient.tsx`
- [ ] Add `{ label: "Settings", actions: ["app_config_updated"] }` to `ACTION_CATEGORIES`

### 9. Admin sidebar

- [ ] Add Settings nav item to `adminNavItems` in `apps/web/components/admin/AdminSidebar.tsx`:
  ```ts
  { id: "settings", href: "/admin/settings", label: "Settings", icon: Settings }
  ```
  (import `Settings` from `lucide-react`)

### 10. Web app — settings page + client

- [ ] Create `apps/web/app/admin/settings/page.tsx` (server component)
  - Calls `getJson<AppConfigDto>("/admin/settings")` server-side
  - Passes DTO as prop to `AdminSettingsClient`
- [ ] Create `apps/web/components/admin/AdminSettingsClient.tsx` (client component)
  - Toggle "Override repair cooldown" (off = null / env default; on = number input)
  - When toggle OFF: green badge "Using env default · {effectiveRepairCooldownMinutes} min"
  - When toggle ON: number input (1–10080), validation feedback, `updatedAt` footer
  - Save button calls `patchJson<AppConfigDto>("/admin/settings", { repairCooldownMinutes })`
  - Footer: "Last updated {updatedAt} · Change will be recorded in the audit log"

### 11. Test-API library — AdminEndpoint + AdminApiAssistant

- [ ] Add `getAdminSettings(headers?: Record<string, string>): Promise<APIResponse>` to `libs/test-api/src/endpoints/AdminEndpoint.ts`
- [ ] Add `patchAdminSettings(body: { repairCooldownMinutes: number | null }, headers?: Record<string, string>): Promise<APIResponse>` to `AdminEndpoint`
- [ ] Extend `AdminApiActions.ts`, `AdminApiArrange.ts`, `AdminApiAssert.ts` with settings-specific helpers

### 12. HTTP spec (AAA)

- [ ] Create `apps/api/test/http/specs/admin-settings-aaa.http.spec.ts`
- [ ] Tests:
  - `GET /admin/settings` returns 200 + `AppConfigDto` shape (all three fields present)
  - `PATCH` with valid integer → 200, `repairCooldownMinutes` updated, `updatedAt` bumped, audit log entry written
  - `PATCH` with `null` → 200, `repairCooldownMinutes` null, `effectiveRepairCooldownMinutes` still a number
  - `PATCH` with same value (no-op) → 200, no new audit log entry
  - `PATCH` with `0` → 400
  - `PATCH` with negative value → 400
  - `PATCH` with `10081` → 400
  - `PATCH` with non-integer → 400
  - `GET` as member role → 403
  - `PATCH` as member role → 403

### 13. E2E spec

- [ ] Create `apps/web/tests/e2e/specs/admin-settings-aaa.spec.ts`
- [ ] Uses `POST /__e2e/reset-app-config` in `beforeEach`
- [ ] Tests:
  - Page loads, Settings sidebar link is active
  - Default state: toggle OFF, env badge visible with text "Using env default"
  - Toggle ON: number input appears, env badge hidden
  - Enter value, save → success toast or page reflects new value, `updatedAt` footer updated
  - Toggle OFF after having a value set → save → reverts to env default badge
  - Validation: saving 0 or empty when toggle ON shows inline error

### 14. Unit tests

- [ ] `apps/api/test/unit/` — `getAppConfig` + `setRepairCooldownMinutes` on MemoryPersistence (no-op guard, `updatedAt` stamping)
- [ ] Zod schema validation (valid values, boundary values 1 and 10080, invalid: 0, negative, 10081, null accepted)

## Open Items

- None — all design decisions resolved in scope-grill.

## References

- Linear: https://linear.app/kzokv/issue/KZO-142
- Mockup: generated during scope-grill (2026-04-19), see session context
- KZO-133 overview: `docs/004-notes/kzo-133/overview-202604151415-app-config-ships.md`
- KZO-141 scope: `docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md`
