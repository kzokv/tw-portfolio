---
name: Playwright request-fixture cookie jar leak in E2E seeds
description: Playwright's test-scoped `request` shares its cookie jar with `page.context()`. Any Set-Cookie from seed endpoints (notably `/__e2e/oauth-session`) leaks into subsequent HTTP calls and overrides explicit x-user-id headers via the API's hydrateAuthContext.
type: feedback
---

Playwright's test-scoped `request` fixture shares its cookie jar with `page.context()`. Endpoints that return `Set-Cookie` — `/__e2e/oauth-session` and anything else that mints a session — persist the cookie in the jar. Subsequent `request.post(apiBaseUrl, ...)` calls carry that cookie.

On the API side, `hydrateAuthContext` runs **before** the dev_bypass header fallback. It parses the session cookie and sets `req.authContext.role` from the DB row of the cookie's user — **overriding** any explicit `x-user-id` header on the request. If the seeded user was `role = viewer`, admin-scoped endpoints like `POST /shares` reject with `403 share_grant_forbidden`.

**Fix:** run seed helpers in an isolated `APIRequestContext`:

```ts
import { request as apiRequest } from "@playwright/test";

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try { return await fn(ctx); }
  finally { await ctx.dispose(); }
}
```

**Why:** Discovered in KZO-145 E2E. Three specs failed with 403 when calling `seedResolvedShareFromAdmin` after `seedUser` — the seeded grantee's viewer-role session cookie leaked. Symptom is always the same: explicit `x-user-id` header set, API still sees a different user/role. Signal to reach for this pattern: any E2E that makes direct HTTP calls *after* a seed endpoint that sets cookies.

**How to apply:** When writing E2E seed helpers in `apps/web/tests/e2e/specs/helpers/*.ts` that talk directly to the API via Playwright's `request`, always use a fresh context per logical seed. Do not pass the test's shared `request` through to the helper — create one internally and dispose on exit.

Canonical reference: `withFreshContext` helper in `apps/web/tests/e2e/specs/helpers/sharing.ts`.
