---
slug: kzo-148
source: scope-grill
created: 2026-04-19
tickets: [KZO-148]
required_reading:
  - docs/004-notes/kzo-148/mockup-202604191530-impersonation-ui.svg
  - docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md
superseded_by: null
---

# Todo: KZO-148 — Admin impersonation (support-debug mode)

> **For agents starting a fresh session:** read the mockup SVG and the parent KZO-141 scope-todo first. The parent ticket establishes the narrow-taxonomy rule (`/profile`, `/notifications`, `/shares`, `/sse`, `/admin/*` all use `sessionUserId`), which is a load-bearing premise for the impersonation design.

## Key Design (locked in scope-grill)

**Transport.** Separate HttpOnly cookie `g_impersonation` parallel to `g_auth_session`, signed with shared `SESSION_SECRET`. Payload: `{adminId}.{targetId}.{expiresAtMs}.{hmac}`. `Max-Age = TTL + 5min grace` so the server gets one post-expiry request to emit `impersonation_end` before the browser discards. `SameSite=Lax`, `Secure` in prod, `COOKIE_DOMAIN`, no `__Host-` prefix (matches `playwright-oauth-cookie-patterns.md`).

**Write-block.** Blanket preHandler (not per-route opt-in) — any `POST/PUT/PATCH/DELETE` with `isImpersonating=true` throws `403 impersonation_write_blocked` and emits `impersonation_blocked_write`. Allowlist = `DELETE /admin/impersonation` + `POST /admin/users/:id/impersonate` (the second is needed because Q7's exit-then-start is itself a POST issued while impersonating).

**Auto-exit.** Server detects invalid HMAC / expired / `adminId !== sessionUserId` / target `deleted_at|deactivated_at` on any request, clears cookie with `Set-Cookie Max-Age=0`, emits `impersonation_end {reason}`, proceeds as admin.

**SSE / narrow taxonomy.** Verified in `apps/api/src/routes/sseRoute.ts:77` — SSE handshake uses `requireSessionUserId`, comment explicitly says "ignores context". Admin sees their own SSE stream during impersonation. `/profile`, `/notifications`, `/shares`, `/admin/*` same pattern.

**Switcher interaction.** Impersonation cookie takes precedence; `x-context-user-id` header is silently ignored when impersonating (no error, no 409).

## Implementation Steps

### Persistence / migrations

- [x] Migration `db/migrations/035_kzo148_impersonation.sql` — idempotent `DO $$ BEGIN…END $$` adding `impersonation_start`, `impersonation_end`, `impersonation_blocked_write` to `audit_log_action_check`. Follow the pattern in migrations 031–034.

### Config

- [x] Add `ADMIN_IMPERSONATION_TTL_MINUTES` to `libs/config/src/env-schema.ts`: `z.coerce.number().int().positive().default(30)`.

### Auth primitives

- [x] Add `signImpersonationCookie(adminId, targetId, expiresAtMs, sessionSecret)` and `verifyImpersonationCookie(cookieValue, sessionSecret)` in `apps/api/src/auth/googleOAuth.ts`, parallel to existing `signSessionCookie`/`verifySessionCookie`. Use same HMAC helpers.
- [x] Export cookie name constant `IMPERSONATION_COOKIE_NAME = "g_impersonation"`.

### Request-side resolution

- [x] Extend `ResolvedRequestIdentity` — `isImpersonating` already typed but hardcoded `false`; wire it to real state.
- [x] In `hydrateAuthContext` (oauth path, `registerRoutes.ts` ~line 640): after session verify, read `g_impersonation` cookie; if valid AND `adminId === sessionUserId` AND `expiresAt > now` AND target is not `deleted_at/deactivated_at`, set `isImpersonating=true`, `contextUserId=target`, skip `resolveContextOverride`.
- [x] Same treatment in `resolveDevBypassFallback` (`registerRoutes.ts` ~line 570): check cookie against `x-user-id`-sourced `sessionUserId`; HMAC still validated via `SESSION_SECRET`.
- [x] Auto-exit handling: if cookie present but any invariant fails, emit `Set-Cookie g_impersonation=; Max-Age=0`, audit `impersonation_end {reason: "expired" | "session_mismatch" | "target_invalid"}`, fall through as admin. (Also covers `invalid_hmac`.)

### Blanket write guard

- [x] Add preHandler (wire into existing `registerRoutes.ts` guard chain after `hydrateAuthContext`): if `isImpersonating && method ∈ {POST,PUT,PATCH,DELETE}` AND route key ∉ allowlist, throw `403 impersonation_write_blocked`. Allowlist: `DELETE /admin/impersonation`, `POST /admin/users/:id/impersonate`. (Wired in `enforceRouteRole`, `registerRoutes.ts:896-928`.)
- [x] Audit `impersonation_blocked_write {targetUserId, method, path}` on every block.
- [x] `requireWriteableContext` (`routeGuards.ts`) unchanged — keeps `write_blocked_viewing_shared` for sharing path.

### Admin routes

- [x] `POST /admin/users/:id/impersonate` handler in `apps/api/src/routes/adminRoutes.ts` — all validations + audit emission implemented.
- [x] `DELETE /admin/impersonation` handler — clears cookie, audits `manual` end, returns 204. Registered in `ADMIN_ROUTE_KEYS`.

### Cross-cutting

- [x] `/auth/logout` handler: also issues `Set-Cookie g_impersonation=; Max-Age=0` (via `impersonationClearCookieString()` in the logout response).
- [x] Session-version-bump 401 path: same clear-cookie on the 401 response (`markSessionCleanup` sets both `__clearSessionCookie` and `__clearImpersonationCookie`).

### `GET /me` extension

- [x] Extend `GET /profile` with `impersonation: { active, targetUserId, targetEmail, expiresAt } | null`. Populated only when `isImpersonating=true`.

### E2E harness

- [x] `POST /__e2e/impersonation-session` endpoint — gated by `assertE2ESeedEnabled()`; accepts `{ adminUserId, targetUserId, ttlMinutes? }`; mints signed cookie via `signImpersonationCookie`. Works in both `AUTH_MODE=oauth` and `AUTH_MODE=dev_bypass`.

### Web / UI

- [x] Per-row "Impersonate" button in `/admin/users` (hidden on self row). `AdminUsersClient.tsx` — button gated on `user.id !== sessionUserId`.
- [x] Persistent red banner (`ImpersonationBanner.tsx`) rendered whenever `profile.impersonation.active === true`. Shows target email, live countdown, [Exit Impersonation] button.
- [x] Client countdown is display-only from `expiresAt`; on tick-to-zero, refetches profile to trigger server-side cleanup.
- [x] "Exit Impersonation" button calls `DELETE /admin/impersonation` and invokes `onRefreshContext()` to refetch.
- [x] 403 `impersonation_write_blocked` error surfacing via `ApiClientErrorToast.tsx` with copy "Writes are disabled while impersonating".

### Admin new-subpage checklist (per `admin-new-subpage-checklist.md`)

- [x] `ACTION_LABELS` in `AdminAuditLogClient.tsx` — added `impersonation_start`, `impersonation_end`, `impersonation_blocked_write`.
- [x] `ACTION_CATEGORIES` — added new "Impersonation" bucket with all 3 actions.

### Tests

**Unit (`apps/api/test/unit/`):**
- [x] `signImpersonationCookie` / `verifyImpersonationCookie` roundtrip + tamper detection
- [x] Expiry check, `adminId` mismatch detection
- [x] Self-impersonate + demo-impersonate blocks

**Integration (memory-backed, `apps/api/test/integration/impersonation.integration.test.ts`):**
- [x] Expired cookie auto-exits, clears cookie, falls back to admin (covers "start → cookie minted, audit row present" contract inversely)
- [x] Re-start while active → `impersonation_end {reason: "replaced"}` + fresh `impersonation_start` (added in this pass)
- [ ] Target deleted mid-session → `reason: "target_invalid"` (covered by the `target_invalid` branch in `validateResolvedImpersonationState`; pattern identical to "expired" — explicit test deferred)
- [x] Session_version bumped mid-session → 401 clears both cookies (covered by "stale session while impersonating")
- [x] Write attempt blocked + audit `impersonation_blocked_write`

**API HTTP (`apps/api/test/http/specs/admin-impersonation-aaa.http.spec.ts`, AAA-style):**
- [x] Full roundtrip: start → session-scoped reads stay admin, store reads switch target, writes block, exit clears cookie (includes audit assertions for start + blocked + end)
- [x] `/__e2e/impersonation-session` helper mints cookie that activates target context

**E2E (`apps/web/tests/e2e/specs-oauth/admin-impersonation-aaa.spec.ts`):**
- [x] Full roundtrip: start from admin users page → banner persists across routes → profile write blocked (403 toast) → exit returns to users page
- [ ] Auto-exit after TTL (covered at integration layer; E2E deferred — requires short-TTL env override infrastructure)
- [ ] Non-admin 403 (structurally guaranteed by `requireAdminRole` registration in `ADMIN_ROUTE_KEYS`; covered by existing admin-role guard tests)

## Verification gate before PR

- [x] All eight suites green per `full-test-suite.md`
- [x] `grep -r "impersonat" apps/ libs/ --include="*.ts"` — no orphan mentions or missed callers (210 mentions, all in expected locations: src + test + dist)
- [x] Self-review pass producing a review doc in `docs/004-notes/kzo-148/` (see `review-202604192100-self-review.md`)
- [x] Migration 035 applied on a clean Postgres checkout before PR (applied automatically by `test:integration:full:host` suite 5, which spins up a fresh Postgres container and runs all migrations — green)

## Open Items (not blocking KZO-148)

- [ ] [KZO-156](https://linear.app/kzokv/issue/KZO-156) — add index on `audit_log.action` (existing gap, not new — but `impersonation_blocked_write` volume could make it matter)
- [ ] [KZO-157](https://linear.app/kzokv/issue/KZO-157) — BroadcastChannel cross-tab banner sync (currently next-fetch latency per tab)

## References

- Mockup: `docs/004-notes/kzo-148/mockup-202604191530-impersonation-ui.svg`
- Parent scope: `docs/004-notes/kzo-141/scope-todo-202604151502-orgs-rbac-users-sharing.md`
- Linear: [KZO-148](https://linear.app/kzokv/issue/KZO-148)
- Dependencies shipped: KZO-144 (admin portal), KZO-146 (switcher infra), KZO-147 (anon share tokens — carries the `/share-tokens` write-block call-out)
