# Vitest Configuration Patterns

Three Vitest configuration pitfalls discovered during test framework migration.

---

## Auth Mode Override

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

`resolveUserId` reads `Env.AUTH_MODE` at call time, so this mock propagates through the entire Fastify app for that test worker.

**Do NOT:**
- Change `vitest.config.ts` (affects all api tests globally)
- Modify `app.ts` or `registerRoutes.ts` to accommodate test-only auth logic

**Why:** In KZO-78, changing production auth plumbing caused 24 E2E regressions. Production auth code must not be changed to fix test setup problems.

### Route Protection E2E Test Placement

Route protection tests (clear cookies → visit / → expect redirect to /login) only work when `NEXT_PUBLIC_AUTH_MODE=oauth`. The standard E2E suite (`specs/`) runs in `dev_bypass` mode.

Place route protection tests in `specs-oauth/` (e.g. `auth-session.spec.ts`), not `specs/`. The `proxy.ts` guard makes auth enforcement conditional — tests in `specs/` will silently pass in CI but fail to exercise the auth path.

---

## Module-Level State Isolation

Module-level stateful objects (e.g., Maps, Sets, timers) persist across `buildApp()` calls within the same Vitest test worker. Tests must explicitly reset this state in `beforeEach`.

```ts
import { _resetDemoRateBuckets } from "path/to/registerRoutes.js";

describe("demo auth rate limiter", () => {
  beforeEach(() => {
    _resetDemoRateBuckets(); // Reset module-level state
  });
});
```

**Pattern for future module state:**
Whenever a module defines persistent state (rate buckets, caches, pools, etc.), export a `_reset*` helper function and document its use in tests.

**Why:** Discovered in KZO-114. Demo rate limiter state persisted between tests, causing unexpected 429 responses.

---

## Alias Resolution Order

Vitest alias resolution is ordered — more specific package aliases must precede less specific ones. The first matching alias wins, so prefix clobbering occurs if a short alias appears before a longer one.

```ts
// ❌ Wrong order — "config" matches "config/web" and "config/test"
alias: {
  "@tw-portfolio/config": "libs/config/src/index.ts",
  "@tw-portfolio/config/web": "libs/config/src/env-web.ts",
  "@tw-portfolio/config/test": "libs/config/src/test.ts",
}

// ✅ Correct — specific aliases before general
alias: {
  "@tw-portfolio/config/test": "libs/config/src/test.ts",
  "@tw-portfolio/config/web": "libs/config/src/env-web.ts",
  "@tw-portfolio/config": "libs/config/src/index.ts",
}
```

**Why:** Vite processes string aliases in object insertion order. First match wins.

**How to apply:** In `apps/web/vitest.config.ts`, always list longer subpath aliases before the bare alias. Same rule applies to any package with subpath exports that share a prefix.
