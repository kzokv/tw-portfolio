# AAA Framework Phase 5 — Detailed Breakdown

**Date:** 2026-03-26
**Status:** Frozen snapshot — do not update after merge
**Origin:** Grill session on `automation-refactor` worktree (Phase 5+ scoping)
**Predecessor:** [design-202603260849-aaa-framework.md](design-202603260849-aaa-framework.md) (Phases 1-4 complete)

---

## Context

Phases 1-4 of the AAA framework are implemented and working. This document breaks the original Phase 5 ("Post-POC") into concrete sub-phases based on a grill session that identified infrastructure gaps, parallelization needs, and framework improvements.

### Consolidated from predecessor (unfinished items)

The original design doc's Phase 5 contained:

1. Migrate remaining 15 E2E specs one at a time
2. Add DashboardPage, PortfolioPage POMs + assistants as needed
3. OAuth parallel fixture
4. `libs/test-api/` — API service clients + builders + API AAA triplets
5. Retire `helpers/flows.ts`
6. Promote guidance skill (`automation-aaa`) + hard rules (`aaa-test-structure`)

All items are expanded and re-ordered below.

The post-POC skill/rule promotion table is carried forward to Phase 5f.

---

## New Goals (additive to original)

- Reduce test flakiness via deterministic process cleanup
- Each test run uses explicit env vars — no `.env` file inheritance
- Parallel execution stable at 2 workers; 30-second timeout ground rule applies to all suites
- Orphan processes killed between test phases and via vitest `globalTeardown`
- Short, human-readable `displayName` for test users in reports and `@Step` traces
- OAuth tests parallel-safe via per-test session minting
- Unit tests remain flat vitest style (AAA pattern not applied)

---

## Architecture Decisions

### `displayName` on TestUser

**Format:** `"{acronym}:{workerIndex}:{randomName}"` — e.g., `sa:0:Alice`

| Segment | Source | Example |
|---------|--------|---------|
| Acronym | First letter of each hyphen-separated segment of filename stem | `settings-aaa.spec.ts` → `sa` |
| Worker index | `testInfo.workerIndex` | `0` |
| Random name | Picked from a fixed pool, truly random per run (not seeded) | `Alice` |

- Collision guard: if two files produce the same acronym, append disambiguating digit (e.g., `pt2`)
- `createTestUser` picks next unused name from pool: primary = `sa:0:Alice`, extra = `sa:0:Bob`
- No explicit name needed for multi-user tests — pool handles it
- `@Step` decorator uses `displayName` instead of `userId` for step labels
- Error messages continue using `userId` (long deterministic slug) for tracing

**New property:** `sessionId` on `TestUser` — unique ID per test run (short random hex or UUID) for cross-log correlation.

### OAuth parallelization

**Decision:** Retire shared `auth.setup.ts` + "setup" project. All OAuth tests mint per-test sessions.

**Rationale:** Analysis of all 8 OAuth specs showed:
- 3 specs already mint per-test sessions (`auth-demo`, `demo-symbol-history`, `profile-tab`)
- 3 specs mostly manage their own cookies (clear/replace per test)
- Only 3 specs rely on shared `storageState`, and they just need "any valid authenticated session" — no inter-test coupling

Sessions are HMAC-signed and stateless. Per-test creation via `/__e2e/oauth-session` is safe.

**Migration path:**
1. Create `oauth-base` fixture calling `/__e2e/oauth-session` per-test
2. Specs import from fixture instead of relying on `storageState`
3. Retire `auth.setup.ts` + "setup" project in `playwright.oauth.config.ts`
4. Set `fullyParallel: true`, `workers: 2`

### API integration test classification

13 of 19 integration tests are pure HTTP (Category A) and can migrate to Playwright `APIRequestContext`. 6 tests need in-process access or streaming and stay on vitest.

| Category | Count | Stays where | Runner |
|----------|-------|-------------|--------|
| A — Pure HTTP | 13 | `libs/test-api/` (Playwright) | Playwright AAA |
| B — In-process access | 5 | `apps/api/test/integration/` | vitest + `app.inject()` |
| C — SSE streaming | 1 | `apps/api/test/integration/` | vitest + `app.listen()` + fetch |

**Category A tests (migrate):**
health, accounts, ai, corporate-actions, settings, fee-profiles, dashboard, auth-oauth, demo-session, e2e-oauth-session, oauth-identity-resolution, profile-api, dividends

**Category B tests (keep as-is):**
portfolio (20+ `loadStore()` calls), transaction-mutations (`eventBus.subscribe` + `vi.spyOn`), demo-cleanup (direct DB), postgres-migrations (direct DB), user-identity (direct DB)

**Category C tests (keep as-is):**
sse (requires `app.listen()` + raw HTTP streaming)

### Unit tests — no AAA

**Decision:** Unit tests stay flat vitest style. AAA pattern not applied.

**Rationale:** Current unit tests (pure functions, validation, domain math) are 2-6 lines each. Wrapping them in AAA classes would triple the code for zero clarity gain. The AAA pattern earns its keep in E2E/API tests with navigation, multi-step flows, and cross-concern coordination. Unit tests don't have that complexity.

Lightweight test harness factories may be introduced case-by-case for heavy-setup tests (e.g., `useEventStream.test.ts`, `getSession.test.ts`) but not as a systematic pattern.

### Env var determinism

**Decision:** Remove `TestEnv.loadDotEnvSync()` from `playwright.oauth.config.ts`.

**Rationale:** Every critical env var is either hardcoded in `TestEnv` or explicitly overridden in webServer entries. The only true `.env.local` dependency is `GOOGLE_OAUTH_REFRESH_TOKEN` for local-only real-Google OAuth testing (Path A in `auth.setup.ts`). With `auth.setup.ts` retired, this is no longer needed in the Playwright config.

For any remaining local OAuth testing, require the secret as a shell env var: `GOOGLE_OAUTH_REFRESH_TOKEN=... npm run test:e2e:oauth:mem`.

### Process cleanup strategy

**Orphan sources identified:**

| Source | Port | Current cleanup | Risk |
|--------|------|----------------|------|
| API (integration tests) | random (`port: 0`) | `afterEach(() => app.close())` only | High — survives test timeout/crash |
| Mock OAuth / API / Web (E2E) | 4445 / 4000 / 3333 | `reclaim-e2e-server.sh` | Low — covered |
| Docker CI stack | 15432 / 16379 | `trap EXIT` in shell | Medium — `|| true` swallows failures |

**Fixes:**
1. Process sweep between phases in `test.sh` — kill all orphan Node processes from repo root between integration and E2E phases
2. Vitest `globalTeardown` in `apps/api/vitest.config.ts` — kill orphaned Fastify instances from `port: 0` tests
3. Docker container liveness check — if `compose down` failed silently, log warning + retry

### Framework improvements

Three improvements to the `libs/test-framework/` core before migration at scale:

**1. Generic `TestAAA<TInstance>`**

Current: `_instance: BasePage<unknown>` — type-erased, every assistant re-casts:
```ts
private get el() { return (this._instance as SettingsDrawerPage).elements; }
// Repeated 5 times today, grows with every page
```

Fix: `TestAAA<TInstance extends BasePage<unknown>>` — typed `_instance`, no casts needed.

**2. Typed mixin constraints**

Current: mixins use `as unknown as { page: Page }` — no compile-time guarantee.

Fix: Mixin functions declare `this` constraints. TypeScript enforces at composition time.

**3. `createFixture(PageClass)` helper**

Current: every fixture is identical boilerplate:
```ts
assistant: async ({ testUser }, use) => {
  await use(await testUser.useWebAssistant<TPage, TAssistant>(PageClass));
}
```

Fix: One-line fixture registration per page.

---

## Implementation Plan

### Phase 5a — Framework improvements

1. Generic `TestAAA<TInstance>` — typed `_instance`, eliminate `el` getter boilerplate
2. Typed mixin constraints — compile-time enforcement of mixin requirements
3. `createFixture(PageClass)` helper — one-line fixture registration per page
4. Update existing Settings + AppShell assistants to use improved patterns
5. Verify POC spec still passes

### Phase 5b — Infrastructure hardening

1. Process sweep between phases in `test.sh`
2. Vitest `globalTeardown` in `apps/api/vitest.config.ts` for orphan Fastify cleanup
3. Docker container liveness check after integration phase
4. Remove `TestEnv.loadDotEnvSync()` from `playwright.oauth.config.ts`
5. Add `displayName` to `TestUser` — format `"{acronym}:{workerIndex}:{randomName}"`
6. Add `sessionId` to `TestUser` — unique per test run for debugging
7. `createTestUser` picks next name from pool
8. `@Step` decorator uses `displayName` instead of `userId`

### Phase 5c — OAuth parallelization

1. Create `oauth-base` fixture (per-test session via `/__e2e/oauth-session`)
2. Retire `auth.setup.ts` + "setup" project
3. `playwright.oauth.config.ts` → `fullyParallel: true, workers: 2`
4. Migrate all 8 OAuth specs to per-test session fixture

### Phase 5d — E2E migration (dev-bypass)

1. Migrate remaining 8 dev-bypass specs to AAA pattern one at a time
2. Add POMs as needed (DashboardPage, PortfolioPage, TransactionsPage, etc.)
3. Retire `helpers/flows.ts` after last consumer migrated

### Phase 5e — API integration tests (Playwright)

1. Migrate 13 Category A tests to Playwright AAA with `APIRequestContext`
2. Category B + C (6 tests) stay on vitest + `app.inject()`
3. API AAA triplets + fluent payload builders in `libs/test-api/`

### Phase 5f — Post-migration cleanup

1. Promote `automation-aaa` guidance skill (user-level, cross-project)
2. Add `aaa-test-structure` hard rule (project-level)
3. Add `test-framework-typescript-strict` hard rule (project-level)
4. Consolidate `buildE2EUserId` (remove duplicate in `helpers/flows.ts`)

---

## Not in scope

- AAA pattern for unit tests (flat vitest stays)
- Migrating Category B/C integration tests to Playwright
- `libs/test-api/` service clients for in-process tests (Category B/C keep vitest)
