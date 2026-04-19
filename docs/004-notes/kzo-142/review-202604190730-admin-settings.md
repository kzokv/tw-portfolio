# Code Review — KZO-142 Admin Settings (Iteration 1)

**Reviewer:** Code Reviewer (Sonnet)
**Date:** 2026-04-19
**Scope:** All KZO-142 slices (1–10): persistence, route-guard extraction, admin-routes extraction, GET/PATCH /admin/settings, E2E reset endpoint, audit-log UI + sidebar, HTTP spec, web settings page + client component, E2E spec, unit tests.

---

## Verdict: CLEAN (conditional on LOW items)

No critical, high, or medium findings. Two low-severity and two informational items below.

---

## Focus Area Results

### (A) Route-extraction correctness — PASS

`routeGuards.ts` correctly extracts all four guards (`requireWriterRole`, `requireAdminRole`, `requireShareGrantorRole`, `requireWriteableContext`). `registerRoutes.ts` imports them from `routeGuards.js`. `adminRoutes.ts` imports `requireAdminRole` from `routeGuards.js`. The `resolveAdminContext` + `assertNotSelf` helpers are correctly co-located in `adminRoutes.ts`. The plugin prefix `/admin` is set at registration (`registerRoutes.ts:3174`), and `req.routeOptions.url` reports the full path, so `ADMIN_ROUTE_KEYS` matching continues to work correctly.

### (B) No-op guard correctness — PASS

```typescript
// adminRoutes.ts:220
if (body.repairCooldownMinutes === current.repairCooldownMinutes) {
  return loadAppConfigDto(app);
}
```

Strict equality (`===`) correctly handles all cases: `null === null` → skip (no write, no audit), `60 === 60` → skip, `null !== 60` → proceed. The Postgres driver returns JS `null` for SQL NULL so the comparison is safe cross-backend.

### (C) Admin-only guard — PASS (with INFORMATIONAL note)

Both `GET /admin/settings` and `PATCH /admin/settings` are in `ADMIN_ROUTE_KEYS` (registerRoutes.ts:369–370) and the `preHandler` hook calls `enforceRouteRole → requireAdminRole`. The 403 member-role test cases in the HTTP spec (`admin-settings-aaa.http.spec.ts:217–252`) exercise this path correctly. See INFO-1 re: double-call pattern.

### (D) Audit log shape — PASS

```typescript
// adminRoutes.ts:225–233
await app.persistence.appendAuditLog({
  actorUserId: sessionUserId,  // from requireSessionUserId via resolveAdminContext
  action: "app_config_updated",
  metadata: {
    before: { repairCooldownMinutes: current.repairCooldownMinutes },
    after:  { repairCooldownMinutes: body.repairCooldownMinutes },
  },
  ipAddress,                   // req.ip
});
```

Matches design spec exactly. No `targetUserId` is correct — this is a global config change with no target user. `"app_config_updated"` is in the `AuditLogAction` union (types.ts:109).

### (E) Web DTO prop flow — PASS

`AppConfigDto` contains only `number | null`, `number`, `string` (shared-types/src/index.ts:329–333). `page.tsx` passes it as `<AdminSettingsClient initial={initial} />`. No functions cross the server→client boundary. Compliant with `nextjs-i18n-serialization.md`.

### (F) Test-id stability — PASS

All seven design-specified test IDs are consistent between `AdminSettingsClient.tsx` and `AppShellAssert.ts`/`AppShellActions.ts`:

| Test ID | Frontend | AppShell assistant |
|---|---|---|
| `admin-settings-override-toggle` | AdminSettingsClient.tsx:147 | AppShellActions.ts:198 ✓ |
| `admin-settings-minutes-input` | AdminSettingsClient.tsx:166 | AppShellActions.ts:208 ✓ |
| `admin-settings-env-default-badge` | AdminSettingsClient.tsx:184 | AppShellAssert.ts:287 ✓ |
| `admin-settings-save-button` | AdminSettingsClient.tsx:195 | AppShellActions.ts:213 ✓ |
| `admin-settings-last-updated` | AdminSettingsClient.tsx:203 | AppShellAssert.ts:319 ✓ |
| `admin-settings-validation-error` | AdminSettingsClient.tsx:174 | AppShellAssert.ts:324 ✓ |
| `admin-sidebar-link-settings` | AdminSidebar.tsx:53 (template) | AppShellAssert.ts:269 ✓ |
| `admin-settings-save-success` | AdminSettingsClient.tsx:125 | AppShellAssert.ts:314 ✓ |
| `admin-settings-page` | AdminSettingsClient.tsx:95 | AppShellAssert.ts:264 ✓ |

### Security — PASS

- `repairCooldownMinutes` from request body: Zod `patchAdminSettingsSchema.parse(req.body)` runs before any DB access (adminRoutes.ts:217). ✓
- Postgres parameterized query: `UPDATE public.app_config SET ... = $1 WHERE id = 1` (postgres.ts:5271). No SQL injection surface. ✓
- No `dangerouslySetInnerHTML` in `AdminSettingsClient.tsx`. `formatTimestamp(config.updatedAt)` uses `Date.toLocaleString()` — no raw HTML. ✓

### Route-key registry — PASS

`"GET /admin/settings"` and `"PATCH /admin/settings"` added to `ADMIN_ROUTE_KEYS` (registerRoutes.ts:369–370). ✓

### Monotonic timestamp — PASS

```typescript
// memory.ts:1812–1814
const prevMs = Date.parse(this._appConfigUpdatedAt);
const nextMs = Math.max(Date.now(), Number.isFinite(prevMs) ? prevMs + 1 : Date.now());
this._appConfigUpdatedAt = new Date(nextMs).toISOString();
```

Correctly implements the monotonic guarantee. `prevMs + 1` ensures strict advancement even in same-ms calls. Unit test `app-config-setter.test.ts:35–44` (two consecutive calls) validates this. ✓

### Zod schema export — PASS

`export const patchAdminSettingsSchema` (adminRoutes.ts:13). Imported directly by the unit test (admin-settings-schema.test.ts:2). ✓

### Migration strategy compliance — PASS

No new migration file introduced. The `app_config` table (repair_cooldown_minutes, updated_at) was created by `029_app_config.sql` in KZO-133. KZO-142 changes are purely application-layer. ✓

### Interface caller verification — PASS

- `getAppConfig()` — callers: adminRoutes.ts:34, adminRoutes.ts:219. ✓
- `setRepairCooldownMinutes()` — callers: adminRoutes.ts:224, registerRoutes.ts:1111. ✓

---

## LOW

### LOW-1: `readAppConfig` E2E helper uses structural cast without runtime validation

**File:** `apps/web/tests/e2e/specs/helpers/adminSettings.ts:54–58`

```typescript
return (await response.json()) as {
  repairCooldownMinutes: number | null;
  effectiveRepairCooldownMinutes: number;
  updatedAt: string;
};
```

The `as` cast provides compile-time type safety but no runtime validation. If the API shape changes (e.g., a field is renamed), E2E tests calling this helper will silently receive `undefined` for missing fields and pass anyway (until the assertion on the value fails downstream).

**Recommendation:** Acceptable for a test helper where the API shape is owned by the same repo. Flag for awareness. Low blast radius — only affects this helper's callers, and the downstream assertions (`mxAssertEqual`) will surface the failure quickly.

### LOW-2: Design spec lists `undefined` as a separate rejection case; unit test covers it only via the `missing field` proxy

**File:** `apps/api/test/unit/admin-settings-schema.test.ts`

The design (slice 10) lists both `undefined` and `missing field` as rejection cases. The test covers `{}` (missing field, line 53–55) but has no explicit `{ repairCooldownMinutes: undefined }` test. In Zod, a missing key and `undefined` are equivalent for `.parse()`, so coverage is functionally complete. The absence is a documentation gap in the test file rather than a coverage gap.

**Recommendation:** Optionally add a one-liner `it` for `undefined` to document the intent explicitly. Not a blocker.

---

## INFORMATIONAL

### INFO-1: Double `requireAdminRole` call on GET/PATCH /admin/settings — inconsistent with sibling routes

**Files:** `apps/api/src/routes/adminRoutes.ts:210, 215`

Both settings handlers explicitly call `requireAdminRole(req)` inside the handler body. Because both routes are in `ADMIN_ROUTE_KEYS`, `enforceRouteRole` in the `preHandler` hook (app.ts:248) already calls `requireAdminRole` before the handler runs. The second call is redundant.

This is per-design (the design spec says "GET /settings → requireAdminRole") and provides defense-in-depth. However, all other admin routes in `adminRoutes.ts` (`GET /users`, `PATCH /users/:id/role`, etc.) do NOT have explicit inner calls — they rely solely on the ADMIN_ROUTE_KEYS mechanism. The inconsistency could confuse a future maintainer who reads the handler and wonders why only settings handlers need the explicit guard.

**Recommendation:** Acceptable as-is (defense-in-depth, per design). If alignment is desired, add a code comment explaining the intentional double-check.

### INFO-2: Pre-existing gap — `user_login` / `user_linked_identity` in ACTION_LABELS but absent from AuditLogAction union

**File:** `apps/web/components/admin/AdminAuditLogClient.tsx:28–29`

`ACTION_LABELS` includes `user_login` and `user_linked_identity` but neither appears in the `AuditLogAction` union (`apps/api/src/persistence/types.ts:93–109`). `ACTION_LABELS` is typed `Record<string, string>` rather than `Record<AuditLogAction, string>`, so the discrepancy is invisible to TypeScript.

This is not introduced by KZO-142 (KZO-142 correctly adds `"app_config_updated"` to both the union and `ACTION_LABELS`). Flagged for awareness.

**Recommendation:** Pre-existing issue. Out of scope for KZO-142 fix, but worth tracking in a follow-up ticket.

---

## Summary

| Tier | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 |
| Informational | 2 |

The implementation is correct and complete against the design. LOW-1 and LOW-2 are non-blocking and do not require changes before PR creation. The reviewer recommends proceeding to PR.
