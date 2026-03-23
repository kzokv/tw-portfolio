# QA Backend — Demo User Feature Test Plan (KZO-107)

**Phase 1 complete — plan only, no files written**
**Date:** 2026-03-22

---

## Test Update Inventory

### 1. `apps/api/test/unit/session-cookie.test.ts`

**2 assertions change** (not 9 total — 7 of the 9 listed are `.toBeNull()` and unchanged):

| Line | Old | New |
|------|-----|-----|
| 38 | `expect(verifySessionCookie(signed, SECRET)).toBe("google-sub-123")` | `.toEqual({ userId: "google-sub-123", isDemo: false })` |
| 75 | `expect(verifySessionCookie(signed, SECRET)).toBe(sub)` | `.toEqual({ userId: sub, isDemo: false })` |

Lines 44, 48, 51, 56, 61, 65, 69 → all `.toBeNull()` — **unchanged**.

**3 new test cases** (new `describe("demo cookie prefix")` block):
1. `signSessionCookie` with `isDemo=true` prepends `demo:` to payload (`signed.startsWith("demo:user-123.")`)
2. `verifySessionCookie` returns `{ userId, isDemo: true }` for demo-prefixed cookie
3. Round-trip: sign demo + verify → `{ userId, isDemo: true }`; sign non-demo → `{ userId, isDemo: false }`

### 2. `apps/api/test/integration/e2e-oauth-session.integration.test.ts`

**4 assertion lines change** across 2 tests (the `verifiedUserId` variable becomes `SessionIdentity | null`):

| Lines | Old | New |
|-------|-----|-----|
| 57 | `expect(verifiedUserId).toBe(body.userId)` | `expect(verifiedUserId?.userId).toBe(body.userId)` |
| 58 | `expect(verifiedUserId).toMatch(/uuid-regex/)` | `expect(verifiedUserId?.userId).toMatch(/uuid-regex/)` |
| 86 | `expect(verifiedUserId).toBe(body.userId)` | `expect(verifiedUserId?.userId).toBe(body.userId)` |
| 87 | `expect(verifiedUserId).toMatch(/uuid-regex/)` | `expect(verifiedUserId?.userId).toMatch(/uuid-regex/)` |

### 3. `apps/api/test/integration/oauth-identity-resolution.integration.test.ts`

**1 helper line changes** — absorbs all 10 downstream assertion changes:

```ts
// Line 63: was
return verifySessionCookie(match[1], sessionSecret);
// becomes:
return verifySessionCookie(match[1], sessionSecret)?.userId ?? null;
```

10 assertions using `extractCookieUserId(...)` downstream are **unchanged** — helper still returns `string | null`.

### 4. `apps/api/test/integration/auth-oauth.integration.test.ts`

**2 assertions change** (lines 213-214):

| Line | Old | New |
|------|-----|-----|
| 213 | `expect(verifiedUserId).toBeTruthy()` | `expect(verifiedUserId?.userId).toBeTruthy()` |
| 214 | `expect(verifiedUserId).toMatch(/uuid-regex/)` | `expect(verifiedUserId?.userId).toMatch(/uuid-regex/)` |

---

## New Integration Test Files

### `apps/api/test/integration/demo-session.integration.test.ts` — 6 scenarios

**Setup requirement (CRITICAL):** Must use `vi.mock("@tw-portfolio/config")` per `vitest-auth-mode-override.md`:
```ts
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: { ...original.Env, DEMO_MODE_ENABLED: "true" as const, DEMO_SESSION_TTL_SECONDS: 1800 },
  };
});
```
App must also be built with `oauthConfig: testOAuthConfig` (oauth mode required to stash `__sessionType`).

**6 scenarios:**
1. Demo endpoint creates user and returns signed cookie — POST /auth/demo/start → 200, `set-cookie` header present, body has `{ userId, expiresAt, sessionType: "demo" }`
2. Demo user can access `/settings` with the cookie — 200, `store.userId` matches
3. `X-Session-Type: demo` header present on authenticated responses to demo users
4. Endpoint returns 404 when `DEMO_MODE_ENABLED=false` (requires a separate test with mock returning `"false"`)
5. Rate limit enforced — 6th request returns 429 with `{ error: "rate_limit_exceeded" }`
6. Demo data is seeded — store has `transactions.length > 0` after demo start

### `apps/api/test/integration/demo-cleanup.integration.test.ts` — 3 scenarios

**Postgres-only** — only runs in `test:integration:full:host`. Insert rows directly via `pool.query`.

**3 scenarios:**
1. Expired demo user deleted — insert user with `is_demo=true, demo_expires_at = NOW() - INTERVAL '2 hours'`, call `cleanupExpiredDemoUsers(pool)`, assert returns 1, query `users` returns 0 rows for that ID
2. Non-expired demo user NOT deleted — insert with `demo_expires_at = NOW() + INTERVAL '1 hour'`, cleanup returns 0
3. Real user (is_demo=false) NOT deleted — insert with `is_demo=false`, cleanup returns 0

---

## Coverage Gaps to Watch

1. **`signSessionCookie` format for demo** — The existing format test (line 8-13) checks `parts[0] === "google-sub-123"` for non-demo, but not for demo. The new test case #1 covers this.

2. **HMAC tamper-resistance for demo prefix** — Not explicitly tested: stripping `demo:` from a demo cookie invalidates the HMAC. Should be covered in the round-trip test (test case #3 in the new describe block).

3. **`X-Session-Type: oauth` header for non-demo sessions** — Not in spec but good defense-in-depth. Accept if absent from implementation scope.

4. **Rate limit window reset** — Testing the 6th request is achievable, but testing window reset after 60s requires timer mocks. Accept if not tested.

5. **`SESSION_SECRET` missing in demo endpoint** — The 500 path (`if (!sessionSecret)`) has no test case. Accept if not tested in MVP.

6. **Demo endpoint with no `oauthConfig`** — Route requires `sessionSecret` from `oauthConfig?.sessionSecret`. Behavior when both `oauthConfig` and `SESSION_SECRET` are absent is the 500 path. Accept if not tested.

7. **Idempotency of `seedDemoTransactions`** — Calling demo start twice for the same user should not double-seed. Accept if covered by calling demo twice and verifying transaction count stays at 12.

---

## Auth Mode Override Compliance Checklist

- `demo-session.integration.test.ts` MUST use `vi.mock("@tw-portfolio/config")` ✓
- `demo-cleanup.integration.test.ts` does NOT need auth mode mock (cleanup function takes `Pool` directly, no auth) ✓
- Existing tests must NOT add `vi.mock("@tw-portfolio/config")` — they cover oauth mode already via `oauthConfig` param ✓

---

## Run Commands

After TDD Implementer completes:
```
npm run lint
npm run test:unit
npm run test:integration:full:host
```
