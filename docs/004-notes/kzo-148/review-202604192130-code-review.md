---
slug: kzo-148
source: code-review (adversarial pass)
created: 2026-04-19
tickets: [KZO-148]
reviewer: claude (code-reviewer, Opus 4.7)
predecessor: docs/004-notes/kzo-148/review-202604192100-self-review.md
scope_todo: docs/004-notes/kzo-148/scope-todo-202604191530-impersonation.md
verdict: approve_with_changes
---

# Code Review: KZO-148 — Admin Impersonation

## Verdict

**Approve with changes.** The implementation is correct end-to-end and all 8 test suites pass. However, the adversarial pass found **1 HIGH**, **3 MEDIUM**, and **7 LOW** findings. The HIGH finding (test coverage gap on security-critical auto-exit paths) should be addressed before PR. MEDIUMs and LOWs can be fixed in this PR or tracked as follow-ups.

## Scope of review

- 40 files total (35 modified + 5 new) across API, web, test, shared-types, migration.
- Focus areas: cookie signing/verification, request-side resolution, blanket write-block preHandler, admin impersonate/exit routes, UI banner, `/__e2e/impersonation-session` test harness.
- Adversarial pass: found gaps in the self-review's "Low risk / Ready for PR" assessment.

---

## HIGH

### H-1 · Security-critical auto-exit paths have zero test coverage

**Files:** `apps/api/src/routes/registerRoutes.ts:573-645`, `apps/api/test/integration/impersonation.integration.test.ts`

`validateResolvedImpersonationState` has four auto-exit branches, each with distinct security implications:
1. `invalid_hmac` (line 591) — tampered or forged cookie
2. `session_mismatch` (line 604-612) — cookie adminId ≠ session userId (stolen-cookie defense)
3. `expired` (line 614-622) — past TTL
4. `target_invalid` (line 625-634) — target deleted or deactivated mid-session

Only **`expired`** is tested (`impersonation.integration.test.ts:79-113`). The other three branches — all documented in the scope-grill as load-bearing safety properties — have **no direct assertions** that the audit emits and the cookie clears.

The code is correct (I read each branch carefully), but the lack of tests means a future refactor could silently regress any of these without a test failure. The `session_mismatch` check in particular is THE protection against a leaked/stolen impersonation cookie being paired with a different admin's session — exactly the scenario KZO-148 was designed to defend.

**Fix:** Add three integration tests in the same file, each following the "expired" pattern:
- Cookie with `adminId` not matching `sessionUserId` → 200 admin context, `impersonation_end{session_mismatch}` audit, cookie cleared.
- Cookie with valid HMAC + unexpired but `targetUser.deletedAt` set → same shape, `target_invalid` reason.
- Cookie with tampered HMAC → same shape, `invalid_hmac` reason.

Each test is ~30 lines following the pattern already in the file. Estimated effort: 20 minutes.

---

## MEDIUM

### M-1 · Duplicate Impersonation DTO types

**Files:** `libs/shared-types/src/index.ts:253-258`, `apps/web/features/profile/hooks/useProfile.ts:7-12`

Two structurally identical types are defined in separate places:

```ts
// libs/shared-types/src/index.ts (the canonical location)
export interface ImpersonationDto {
  active: boolean;
  targetUserId: string;
  targetEmail: string | null;
  expiresAt: string;
}

// apps/web/features/profile/hooks/useProfile.ts (the shadow type)
export interface ProfileImpersonationDto {
  active: boolean;
  targetUserId: string;
  targetEmail: string | null;
  expiresAt: string;
}
```

`useProfile.ts` already imports from `@tw-portfolio/shared-types` (it pulls `ProfileDto` on line 4). Importing `ImpersonationDto` instead of redefining it would eliminate the drift risk.

**Fix:** Replace `ProfileImpersonationDto` with an import:
```ts
import type { ImpersonationDto, ProfileDto } from "@tw-portfolio/shared-types";
export type ProfileImpersonationDto = ImpersonationDto;  // keep re-export for existing callers
```
Then in a follow-up, sweep consumers to use `ImpersonationDto` directly.

### M-2 · `impersonation` field on ProfileDto mixes persistence and request-scoped state

**Files:** `libs/shared-types/src/index.ts:269`, `apps/api/src/persistence/memory.ts:1383`, `apps/api/src/persistence/postgres.ts:2671`, `apps/api/src/routes/registerRoutes.ts:1843`

The persistence layer's `getProfile()` returns `ProfileDto` which includes `impersonation: ImpersonationDto | null`. But at the persistence layer, the field is **always `null`** — the actual value is populated in the route handler by overriding from `req.authContext`:

```ts
// registerRoutes.ts:1838-1845
app.get("/profile", async (req) => {
  const userId = requireSessionUserId(req);
  const profile = await app.persistence.getProfile(userId);
  return {
    ...profile,
    impersonation: req.authContext?.impersonation ?? null,  // overrides persistence's null
  };
});
```

This couples the persistence DTO to request-scoped state, signaling the wrong lifecycle. A future developer reading `ProfileDto` will assume `impersonation` is persisted; it isn't.

**Fix (cleaner):** Remove `impersonation` from `ProfileDto`. Define a route-response type in registerRoutes.ts or shared-types:
```ts
export interface ProfileResponse extends ProfileDto {
  impersonation: ImpersonationDto | null;
}
```
Remove the `impersonation: null` stubs from `memory.ts` and `postgres.ts` (both explicit stub lines).

**Fix (minimal):** Leave as-is but add a JSDoc on `ProfileDto.impersonation` noting it is request-scoped and populated only on the `GET /profile` response.

### M-3 · Write-block taxonomy under-tested

**Files:** `apps/api/test/http/specs/admin-impersonation-aaa.http.spec.ts:76-84`, `apps/api/test/integration/impersonation.integration.test.ts:158-166`

The blanket write-block covers any `POST/PUT/PATCH/DELETE` that isn't in `IMPERSONATION_WRITE_ALLOWLIST`. The scope-todo called for "Write-block taxonomy — sample a handful of `WRITE_CONTEXT_GUARD_ROUTE_KEYS` + narrow-taxonomy writes". Current coverage hits **only one route**: `PATCH /profile`.

This means if someone accidentally removes `POST` from `IMPERSONATION_BLOCKED_METHODS`, or adds an unintended route to the allowlist, no test catches it. The scope-grill's KZO-147 motivation (`POST /share-tokens` + `DELETE /share-tokens/:id`) is structurally covered but not explicitly asserted.

**Fix:** Add 2–3 assertions in the existing HTTP spec exercising different HTTP methods against different route families (e.g. `POST /share-tokens`, `POST /portfolio/transactions`, `DELETE /accounts/:id`). ~15 minutes.

---

## LOW

### L-1 · `userScopedIdSchema` permits `.`, which would corrupt cookie parsing for IDs containing periods

**Files:** `apps/api/src/routes/registerRoutes.ts:76-81`, `apps/api/src/auth/googleOAuth.ts:125-153`

`userScopedIdSchema` regex: `/^[A-Za-z0-9._:-]+$/` — allows period.
`signImpersonationCookie` builds payload: `${adminId}.${targetUserId}.${expiresAtMs}`.
`verifyImpersonationCookie` rejects anything that doesn't split into exactly 4 parts.

If an admin has an ID containing `.` (legal per schema, though production uses UUIDs which don't contain periods), their impersonation cookie is **unparseable** — silent auth failure.

This is a dev_bypass-only concern (production uses UUIDs). But since the `/__e2e/impersonation-session` endpoint doesn't validate that IDs lack periods, a test hand-rolling a user ID like `alice.dev` would silently fail.

**Fix:** Either (a) restrict the cookie payload format to disallow periods in IDs, or (b) use a separator that can't appear in IDs (e.g. `:` is ALSO in the regex, so `|` would be better). Option (c): tighten `userScopedIdSchema` to disallow periods, which is a larger blast-radius change.

Cheapest fix: verify at sign-time that neither ID contains the separator, throw if so. Belt-and-suspenders documentation.

### L-2 · `ImpersonationDto.active: boolean` is structurally redundant

**Files:** `libs/shared-types/src/index.ts:253-258`, `apps/web/components/layout/AppShell.tsx:129-132`

Server only emits `impersonation: { active: true, ... } | null`. The `active` flag is always `true` when the object is present. Client code hedges:
```ts
const impersonation = profileData.profile?.impersonation
  && profileData.profile.impersonation.active !== false
  ? profileData.profile.impersonation
  : null;
```

This is defensive against a future "inactive/paused impersonation" state that doesn't exist. Either commit to that design (and document when `active: false` is emitted), or drop the field.

**Fix (pick one):**
- Drop the field; callers just check `profile.impersonation !== null`.
- Change type to `active: true` (literal) to codify "always true when present".

### L-3 · `invalid_hmac` auto-exit emits audit for every bad cookie — spammable

**Files:** `apps/api/src/routes/registerRoutes.ts:589-593`

Every request arriving with a cookie that fails HMAC verification emits an `impersonation_end{invalid_hmac}` audit row. An attacker who knows the impersonation cookie name can spray garbage cookies and pollute the audit log (O(requests) audit rows). Low impact (admins can filter), but worth noting.

**Fix (optional):** Rate-limit `invalid_hmac` audits per-IP, or drop the audit entirely for HMAC failures (they're already guaranteed-unauthenticated; the cleanup flag is sufficient).

### L-4 · Concurrent `start` requests from two tabs produce inconsistent audit sequence

**Files:** `apps/api/src/routes/adminRoutes.ts:184-244`

If an admin opens two tabs and hits "Impersonate" on user A in tab 1 + user B in tab 2 simultaneously, both requests run `hydrateAuthContext` before either cookie is set. Neither sees the other's state. Result:
- Audit: two `impersonation_start` rows (for A and B), no `impersonation_end{replaced}` rows.
- Browser: whichever Set-Cookie arrives last wins.

The audit trail misleads an investigator: it looks like the admin started two parallel impersonation sessions without exiting.

**Fix (optional):** Atomic compare-and-swap on a server-side impersonation state store. Significant complexity for an edge case. Suggest leaving and documenting.

### L-5 · `ProfileDto.impersonation` is required but `ProfileWithImpersonationDto.impersonation` is optional

**Files:** `libs/shared-types/src/index.ts:269`, `apps/web/features/profile/hooks/useProfile.ts:14-16`

```ts
// shared-types
interface ProfileDto { ...; impersonation: ImpersonationDto | null; }  // required

// useProfile.ts
type ProfileWithImpersonationDto = ProfileDto & { impersonation?: ProfileImpersonationDto | null };  // optional
```

Widening to optional in the client-side extension is incoherent. The server always emits the field. Ties into M-1 and M-2.

**Fix:** After M-2 (remove from ProfileDto), define only in the response wrapper with required type.

### L-6 · `handleImpersonate` doesn't navigate — admin stays on `/admin/users` after clicking

**Files:** `apps/web/components/admin/AdminUsersClient.tsx:233-247`

After a successful impersonation start, the admin sees the banner but stays on the admin users page. Their next click is typically to navigate somewhere to observe the target's data. The E2E test explicitly navigates to `/portfolio` after the click.

Minor UX: consider auto-navigating to `/dashboard` or `/portfolio` on success, or at least show a toast prompting them to navigate.

**Fix (optional):** `router.push("/dashboard")` after the PROFILE_REFRESH_EVENT dispatch.

### L-7 · `router.push` + `router.refresh` not awaited in `handleExit`

**Files:** `apps/web/components/layout/ImpersonationBanner.tsx:94-104`

```ts
async function handleExit(): Promise<void> {
  setIsExiting(true);
  try {
    await deleteJson<void>("/admin/impersonation");
    await onRefreshContext();
    router.push("/admin/users");
    router.refresh();
  } finally {
    setIsExiting(false);
  }
}
```

`router.push` and `router.refresh` are fire-and-forget. If `router.refresh` triggers before the navigation settles, there's a brief window where the old context renders. Not a bug but potential flicker.

**Fix (optional):** `await router.push(...)` (Next.js 14+ returns a promise).

---

## INFORMATIONAL

### I-1 · Demo users as impersonation TARGETS not explicitly blocked

The handler blocks `isDemo` on the CALLER (admin) but not on the TARGET. An admin can impersonate a demo user. Possibly useful for debugging demo flow; possibly a policy decision not made.

**Recommend:** Either explicit allow (comment in code) or explicit block (`if (targetUser.isDemo) throw 400`).

### I-2 · CSRF protection relies on CORS allowlist + SameSite=Lax

The state-changing POST/DELETE endpoints don't have CSRF tokens. Same-site cookie policy + CORS configuration provide the protection. Not KZO-148-specific — same model as every other mutating endpoint in the app. Noted for completeness.

### I-3 · Public routes bypass `enforceRouteRole`

The preHandler short-circuits when `isPublicRoute(method, routeUrl)` returns true. Among public routes are `POST /auth/demo/start` and `POST /auth/token/refresh`. Admin hitting these while impersonating bypasses the blanket write-block. However, the `adminId` check in `validateResolvedImpersonationState` is self-healing: if the session cookie changes (demo login replaces it), the old impersonation cookie fails `session_mismatch` on the next auth'd request and gets auto-exited. Not a real bypass.

---

## Test coverage summary

| Path | Tested? | Location |
|---|---|---|
| Happy start | ✅ | HTTP spec (line 44-58) |
| Happy exit | ✅ | HTTP spec (line 100-106) |
| Self-impersonate 400 | ✅ | integration test (line 181-199) |
| Demo admin 403 | ✅ | integration test (line 201-226) |
| Expired auto-exit | ✅ | integration test (line 79-113) |
| `session_mismatch` auto-exit | ❌ | **gap** |
| `target_invalid` auto-exit | ❌ | **gap** |
| `invalid_hmac` auto-exit | ❌ | **gap** |
| Session_version bump clears both cookies | ✅ | integration test (line 115-143) |
| PATCH /profile write block | ✅ | both HTTP + integration |
| POST/DELETE method coverage for write block | ❌ | **gap — M-3** |
| Re-impersonate replaced | ✅ | integration test (added this pass, line 228-268) |
| `/__e2e/impersonation-session` mints working cookie | ✅ | HTTP spec (line 125-160) |
| Non-admin 403 on POST impersonate | ❌ | deferred — relies on `ADMIN_ROUTE_KEYS` structural guarantee |
| E2E banner + write-block toast | ✅ | E2E spec (line 10-61) |

**Before PR, address H-1 (test three missing auto-exit branches) and M-3 (add POST/DELETE write-block assertions).** Both together are ~35–40 minutes of work following existing patterns.

---

## What the self-review missed

Cross-referencing against `docs/004-notes/kzo-148/review-202604192100-self-review.md`:

- Self-review noted "auto-exit is defense-in-depth: four independent branches" but didn't flag that only one of four has a test.
- Self-review noted "code passes quality review" but missed the duplicate DTOs (M-1) and the persistence/request lifecycle mixing (M-2).
- Self-review classified risk as "Low" — with the test coverage gap for `session_mismatch` (the cookie-theft defense), I'd call this **Medium** until tests are added.
- Self-review said "one nit, not fixed" about `admin_bootstrap_missing` warnings — fair, that's pre-existing.

## Recommended action

1. **Before PR:** Address H-1 (add 3 auto-exit tests), M-3 (sample POST/DELETE write-block).
2. **Either this PR or follow-up:** M-1 (dedupe DTO), M-2 (remove impersonation from ProfileDto).
3. **Track as follow-ups:** L-1 through L-7 as GitHub issues or Linear backlog. Low priority.
4. **Consider:** File a Linear ticket for I-1 (explicit demo-target policy) so the decision is made and documented.

Full test suite remains green; no regressions introduced. Migration 035 applied cleanly on the Postgres integration suite. Ready to iterate on the findings above.
