# Vitest Auth Mode Override

`apps/api/vitest.config.ts` sets `AUTH_MODE=dev_bypass` for ALL api test files. This means `resolveUserId` never enforces session cookies — missing auth always falls through to the `"user-1"` default.

**When a test needs OAuth enforcement semantics** (e.g. 401 on unauthenticated request), use one of two approaches — or both together:

**Option A — separate describe block with oauthConfig:**
Build the Fastify app with `oauthConfig: { sessionSecret, clientId, clientSecret, redirectUri }` configured. `resolveUserId` will enforce session cookies in oauth mode.

**Option B — mock Env at the test-file level:**

```ts
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "oauth" as const },
  };
});
```

`resolveUserId` reads `Env.AUTH_MODE` at call time, so this mock propagates through the entire Fastify app for that test worker. The `/__e2e/oauth-session` cookie-seeding endpoint is guarded by `NODE_ENV !== "production"`, not `AUTH_MODE`, so it stays available.

**Do NOT:**
- Change `vitest.config.ts` (affects all api tests globally)
- Modify `app.ts` or `registerRoutes.ts` to accommodate test-only auth logic

**Why:** In KZO-78 iteration 1, the Fixer changed `app.ts` and `registerRoutes.ts` to fix 401 test failures. This caused 24 E2E regressions — OAuth routes began returning 503 instead of 302, cascading across all `auth-oauth.spec.ts` tests. Production auth code must not be changed to fix test setup problems. Reverted in iteration 2 in favor of the `vi.mock()` approach.

**How to apply:** When writing api tests that assert on 401 behavior, use the `vi.mock("@tw-portfolio/config")` pattern at the top of the test file.
