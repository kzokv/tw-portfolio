# Vitest Configuration Patterns

Four Vitest configuration pitfalls discovered during test framework migration and KZO-153 admin CLI integration work.

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

## Mocking Env Methods, Not Just Fields

`Env` exposes both scalar fields (`AUTH_MODE`, `DB_URL`, `REDIS_URL`, ...) and methods (`getDatabaseUrl()`, `getRedisUrl()`). The methods close over the module-level `Env` symbol — so a `vi.mock("@tw-portfolio/config")` that only replaces scalar fields is silently ineffective for any code path that calls the method form.

`createPersistence()` is the canonical case: it calls `Env.getDatabaseUrl()` / `Env.getRedisUrl()`, not the raw fields.

```ts
// ❌ Wrong — createPersistence() still reads the original URLs
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      PERSISTENCE_BACKEND: "postgres" as const,
      DB_URL: process.env.POSTGRES_TEST_DB_URL ?? original.Env.DB_URL,
      REDIS_URL: process.env.POSTGRES_TEST_REDIS_URL ?? original.Env.REDIS_URL,
    },
  };
});

// ✅ Correct — also replace the method closures
vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      PERSISTENCE_BACKEND: "postgres" as const,
      DB_URL: process.env.POSTGRES_TEST_DB_URL ?? original.Env.DB_URL,
      REDIS_URL: process.env.POSTGRES_TEST_REDIS_URL ?? original.Env.REDIS_URL,
      getDatabaseUrl() { return process.env.POSTGRES_TEST_DB_URL ?? original.Env.DB_URL ?? ""; },
      getRedisUrl()    { return process.env.POSTGRES_TEST_REDIS_URL ?? original.Env.REDIS_URL ?? ""; },
    },
  };
});
```

**Why:** Discovered in KZO-153 while wiring `apps/api/test/integration/admin-cli.integration.test.ts`. The CLI's `createPersistence()` call reached through to the real `Env.getDatabaseUrl()` despite a field-level mock, pointing at the dev DB instead of the managed test stack. The pattern generalizes — any `Env.get*()` method call through the mocked module behaves the same way.

**How to apply:** Any time a test mocks `@tw-portfolio/config` AND the code under test calls `Env.getDatabaseUrl()`, `Env.getRedisUrl()`, or any other `Env.get*()` accessor. When in doubt, include the method replacements — they're free insurance against closure-scoped reads.

---

## Env-Proxy Pattern for Per-Test Mutation of Frozen Env Fields

`Env` (in `libs/config/src/env.ts`) parses `process.env` once at module load and returns `Object.freeze({..._parsed, validateEnvConstraints})`. Any code that reads `Env.SOMETHING` captures the value at module-load time. Two consequences for tests:

- `vi.stubEnv("SOMETHING", value)` mutates `process.env.SOMETHING` only — it does NOT change `Env.SOMETHING`.
- A naive `vi.mock("@tw-portfolio/config")` factory that replaces `Env: { SOMETHING: TEST_VALUE, ... }` is static — you can't mutate it per-test.

When a test file needs **per-test** mutation of an Env-read field (e.g., to drive different encryption keys, feature flags, or thresholds across `it()` blocks), wrap the original `Env` in a Proxy that consults a mutable `mockEnv` overlay at access time:

```ts
// At the top of the test file (BEFORE any imports of code-under-test)
const mockEnv: Partial<Record<string, string | undefined>> = {
  APP_CONFIG_ENCRYPTION_KEY: TEST_KEY,
};

vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: new Proxy(
      { ...original.Env },
      {
        get(target, prop) {
          if (prop in mockEnv) {
            return (mockEnv as Record<string, unknown>)[prop as string];
          }
          return (target as Record<string | symbol, unknown>)[prop];
        },
      },
    ),
  };
});

// Code-under-test imported AFTER vi.mock so the mock takes effect:
const { encryptSecret } = await import("../../../src/services/appConfig/encryption.js");

beforeEach(() => {
  mockEnv.APP_CONFIG_ENCRYPTION_KEY = TEST_KEY;  // reset overlay to default
});
```

**Why this beats `vi.stubEnv`:** `vi.stubEnv` only touches `process.env`. A frozen `Env` object that read `process.env` at boot is unaffected. The Proxy reads `mockEnv[prop]` at call time — every consumer sees the current per-test value. Falls through to the original Env for any field NOT in `mockEnv`.

**Why this beats a static `Env: { ...override }` factory:** A static factory captures the override at mock-evaluation time. Per-test mutation would require calling `vi.mock` again, which Vitest does not allow mid-file. The Proxy is a single mock factory; per-test mutations are normal property assignments on `mockEnv`.

**When NOT to use:**
- If the test file only needs a single fixed Env value, a static `Env: { ...original.Env, FIELD: VALUE }` factory is simpler.
- If the code-under-test reads `process.env.X` directly (not `Env.X`), `vi.stubEnv` is the right tool.

**Combine with method overrides:** for tests that need both per-test field mutation AND `Env.getDatabaseUrl()` / `Env.getRedisUrl()` overrides, layer the method replacements onto the Proxy target (or include them in `mockEnv` and route through the `get` trap).

**Worker-pool watch-out:** A `vi.mock("@tw-portfolio/config")` at the top of one file CAN leak into other files sharing a Vitest worker if the runner reuses the module cache (observed once during KZO-198 Phase 1+2 — 53 cross-file failures, vanished on re-run). Mitigation if it recurs: pin `pool: "forks"` for affected files, or add `vi.unmock` / `vi.resetModules()` in `afterAll`. Not seen consistently; revisit only if flake repeats.

**Why:** Discovered during KZO-198 Phase 1+2 while writing `appConfig/encryption.test.ts` and `appConfig/providerKeys.test.ts`. Tests needed to drive `APP_CONFIG_ENCRYPTION_KEY` differently per case (round-trip vs tampered ciphertext vs bad key). Static field overrides couldn't do it; `vi.stubEnv` couldn't reach the frozen `Env`. The Proxy pattern is the canonical solution and was approved for promotion by the Architect during Phase 3 triage.

**Canonical references:** `apps/api/test/unit/appConfig/encryption.test.ts`, `apps/api/test/unit/appConfig/providerKeys.test.ts`.

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
