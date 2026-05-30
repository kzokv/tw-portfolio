# Playwright Seed Helpers: Isolate the `request` Cookie Jar

Playwright's test-scoped `request` fixture shares its cookie jar with `page.context()`. Any endpoint that returns `Set-Cookie` — most notably `/__e2e/oauth-session`, and anything else that mints a session — persists the cookie in the jar. Subsequent `request.post(apiBaseUrl, ...)` calls carry that cookie.

On the API side, `hydrateAuthContext` runs **before** the dev_bypass header fallback. It parses the session cookie and sets `req.authContext.role` from the DB row of the cookie's user — **overriding** any explicit `x-user-id` header on the request. If the seeded user is `role = viewer`, admin-scoped endpoints like `POST /shares` reject with `403 share_grant_forbidden`. The bug is invisible in the helper's code — it appears as a "wrong role" failure several layers down.

**Fix:** run seed helpers in an isolated `APIRequestContext`:

```ts
import { request as apiRequest, type APIRequestContext } from "@playwright/test";

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

export async function seedResolvedShareFromAdmin(
  granteeEmail: string,
  ownerUserId: string,
): Promise<{ shareId: string }> {
  return withFreshContext(async (ctx) => {
    // helper body uses ctx.post / ctx.get — the test's shared `request` is never touched
  });
}
```

**Why:** Discovered in KZO-145 E2E. Three specs failed with 403 when `seedResolvedShareFromAdmin` ran after `seedUser` — the seeded grantee's viewer-role session cookie leaked into the admin seed call. KZO-146 inherited the pattern and applies it to every HTTP seed helper; the symptom signal is always the same — explicit `x-user-id` header set, API still sees a different user/role.

**Canonical reference:** `withFreshContext` helper in `apps/web/tests/e2e/specs/helpers/sharing.ts`.

**How to apply:** When writing E2E seed helpers in `apps/web/tests/e2e/specs/helpers/*.ts` that talk directly to the API via Playwright's `request`, always use a fresh context per logical seed. Do not thread the test's shared `request` through to the helper — create one internally and dispose on exit. Pair with `e2e-seed-testuser-userid.md` to avoid the related "wrong owner" class of bug.
