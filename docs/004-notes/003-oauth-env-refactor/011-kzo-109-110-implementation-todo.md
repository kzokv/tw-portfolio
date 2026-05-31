# Implementation TODO — KZO-109 + KZO-110: E2E CI Jobs + Validation Tests

> Consolidated from scope-grill session on 2026-03-23.
> Scope: E2E CI jobs (bypass + oauth), mock OAuth lifecycle fix, compose auth-vars validation.
> Linear tickets: KZO-109, KZO-110 (absorbed)
> Branch: `kzo-109`
> PR: single PR targeting `dev`.

---

## Grill Session Decisions

| # | Question | Resolution |
|---|----------|-----------|
| Q1 | KZO-110 scope items 1–2 (validatePortConflicts + validateCookieDomainRequired tests) | Already completed by KZO-102 (`386b298`). Function renamed to `validateEnvConstraints`, tests exist in `libs/config/test/env.test.ts` and `env-docker.test.ts`. |
| Q2 | KZO-110 scope item 3 (AUTH_USER_ID regression test) | AUTH_USER_ID is obsolete — fully removed from codebase. Regression test already exists at `specs-oauth/auth-identity-source.spec.ts`. Deployment guard in `deploy.sh` prevents re-introduction. |
| Q3 | OAuth E2E in CI | Yes — both bypass and oauth E2E jobs, not just bypass. The `specs-oauth/` suite (session integrity, route protection, HMAC middleware) must run in CI, not just locally. |
| Q4 | Matrix vs separate jobs | Separate jobs — clearer failure signal in GitHub UI over DRY matrix. |
| Q5 | Job dependency | Both E2E jobs depend on `build-and-typecheck`. |
| Q6 | Mock OAuth server lifecycle root cause | Missing graceful shutdown — no SIGINT/SIGTERM handlers, no `server.close()`. Causes ERR_ABORTED when Playwright kills the process between suites. KZO-106's `0.0.0.0` bind is correct but unrelated to lifecycle. |
| Q7 | CI oauth script env vars | `playwright.oauth.config.ts` webServer env block is sufficient. No `.env.local` loading needed — mock server handles token exchange. |
| Q8 | Compose auth-vars check scope | Validate `docker-compose.dev.yml` and `docker-compose.prod.yml` only (not local or ci-integration). |
| Q9 | Compose check branch conditionals | No branch conditionals — validate both dev and prod compose files on every push/PR. Catching a missing var early is better than discovering it on merge. |
| Q10 | KZO-110 remaining scope | Compose auth-vars consistency check (item 4) absorbed into KZO-109. KZO-110 can be closed. |

---

## Implementation Checklist

### 1. Create `test:e2e:ci:oauth:mem` script

- [ ] Add to `apps/web/package.json`:
  ```
  "test:e2e:ci:oauth:mem": "npx playwright test --config=tests/e2e/playwright.oauth.config.ts --reporter=junit"
  ```

### 2. Fix mock OAuth server lifecycle

- [ ] Add SIGINT/SIGTERM handlers to `apps/web/tests/e2e/helpers/mock-oauth-server.mjs`:
  - `process.on("SIGINT", () => server.close(() => process.exit(0)))`
  - `process.on("SIGTERM", () => server.close(() => process.exit(0)))`
- [ ] Add mock server entry to `apps/web/tests/e2e/playwright.oauth.config.ts` webServer array:
  - Command: `node tests/e2e/helpers/mock-oauth-server.mjs`
  - Port: `TestEnv.ports.mockOAuth`
  - `reuseExistingServer: true`
- [ ] Remove `test.fixme` from `apps/web/tests/e2e/specs-oauth/routing.spec.ts:112` — convert to regular `test()`
- [ ] Remove/update comments about mock server dependency on bypass suite

### 3. Add bypass E2E CI job

- [ ] Add `e2e-bypass` job to `.github/workflows/ci.yml`:
  - `needs: [build-and-typecheck]`
  - `runs-on: ubuntu-latest`
  - Postgres service container (same config as `integration-tests`)
  - Redis service container (same config as `integration-tests`)
  - `actions/checkout@v4`
  - `actions/setup-node@v4` with `.node-version` and npm cache
  - `npm ci`
  - Build libs: config, domain, shared-types
  - Install Playwright browsers: `npx playwright install --with-deps`
  - Run: `npm run test:e2e:ci:bypass:mem --prefix apps/web`
  - Upload artifacts on failure: `actions/upload-artifact@v4` with `tests/e2e/test-results/`

### 4. Add oauth E2E CI job

- [ ] Add `e2e-oauth` job to `.github/workflows/ci.yml`:
  - Same structure as bypass job
  - Run: `npm run test:e2e:ci:oauth:mem --prefix apps/web`
  - Upload artifacts on failure

### 5. Compose auth-vars consistency check

- [ ] Add step to `deploy-config-validation` job in `.github/workflows/ci.yml`:
  - Render `docker-compose.dev.yml` with `docker compose config`
  - Assert `SESSION_SECRET` and `SESSION_COOKIE_NAME` present in web service
  - Render `docker-compose.prod.yml` with `docker compose config`
  - Assert same vars present in web service
  - Fail with clear error message if any are missing

---

## Files to Change

| File | Change |
|------|--------|
| `apps/web/package.json` | Add `test:e2e:ci:oauth:mem` script |
| `apps/web/tests/e2e/helpers/mock-oauth-server.mjs` | Add graceful shutdown handlers |
| `apps/web/tests/e2e/playwright.oauth.config.ts` | Add mock server to webServer array |
| `apps/web/tests/e2e/specs-oauth/routing.spec.ts` | Convert `test.fixme` to `test()` at line 112 |
| `.github/workflows/ci.yml` | Add `e2e-bypass` job, `e2e-oauth` job, compose auth-vars step |

## Files NOT to Change

- `apps/web/tests/e2e/playwright.config.ts` — bypass config already correct
- `apps/api/src/**` — no production code changes
- `apps/web/src/**` — no production code changes
- `libs/config/test/**` — validation tests already complete (KZO-102)

---

## Blockers (all resolved)

- KZO-106 — merged as `bfc5e87` (E2E script renames, mock OAuth `0.0.0.0` bind)
- KZO-102 — merged as `386b298` (env schema unification, validateEnvConstraints)
