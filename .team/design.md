# Technical Design — KZO-109 + KZO-110

## Summary

Add E2E CI jobs (bypass + oauth) to the GitHub Actions workflow, fix the mock OAuth server lifecycle so the oauth suite is self-contained, and add a compose auth-vars consistency check.

## Change 1: `test:e2e:ci:oauth:mem` script

**File:** `apps/web/package.json`

Add script mirroring the existing `test:e2e:ci:bypass:mem` pattern but targeting the oauth config:

```json
"test:e2e:ci:oauth:mem": "npx playwright test --config=tests/e2e/playwright.oauth.config.ts --reporter=junit"
```

No `npm run build -w @tw-portfolio/config` prefix needed — CI builds libs in a prior step. The local `test:e2e:oauth:mem` script keeps the build prefix for dev use.

## Change 2: Mock OAuth server graceful shutdown

**File:** `apps/web/tests/e2e/helpers/mock-oauth-server.mjs`

Add SIGINT/SIGTERM handlers after `server.listen()`:

```js
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
```

This prevents `ERR_ABORTED` when Playwright tears down the webServer processes.

## Change 3: Add mock server to oauth Playwright config

**File:** `apps/web/tests/e2e/playwright.oauth.config.ts`

Add the mock OAuth server as the **first** entry in the `webServer` array (before the API server), matching the bypass config pattern:

```ts
{
  command: "node tests/e2e/helpers/mock-oauth-server.mjs",
  port: TestEnv.ports.mockOAuth,
  cwd: path.resolve(repoRoot, "apps/web"),
  reuseExistingServer: true,
  stdout: "ignore",
  stderr: "pipe",
},
```

Also import `mockOAuthPort` (or use `TestEnv.ports.mockOAuth` inline) and remove/update the stale comments about mock server dependency on the bypass suite.

## Change 4: Re-enable `test.fixme` in routing.spec.ts

**File:** `apps/web/tests/e2e/specs-oauth/routing.spec.ts`

- Line 112: Change `test.fixme(` to `test(`
- Remove the FIXME comment block (lines 107-111) — the mock server dependency is now resolved
- Remove the comment on line 136-137 about requiring the mock OAuth server from the bypass suite

## Change 5: E2E bypass CI job

**File:** `.github/workflows/ci.yml`

Add `e2e-bypass` job:

```yaml
e2e-bypass:
  needs: [build-and-typecheck]
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_USER: app
        POSTGRES_PASSWORD: app
        POSTGRES_DB: tw_portfolio
      ports:
        - 5432:5432
      options: >-
        --health-cmd "pg_isready -U app"
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
    redis:
      image: redis:7
      ports:
        - 6379:6379
      options: >-
        --health-cmd "redis-cli ping"
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  env:
    DB_URL: postgres://app:app@localhost:5432/tw_portfolio
    REDIS_URL: redis://localhost:6379
    PERSISTENCE_BACKEND: postgres
    AUTH_MODE: dev_bypass
    NODE_ENV: test
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version-file: .node-version
        cache: npm
    - run: npm ci
    - run: npm run build -w @tw-portfolio/config
    - run: npm run build -w @tw-portfolio/domain
    - run: npm run build -w @tw-portfolio/shared-types
    - run: npx playwright install --with-deps
    - run: npm run test:e2e:ci:bypass:mem --prefix apps/web
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: e2e-bypass-results
        path: apps/web/tests/e2e/test-results/
        retention-days: 7
```

## Change 6: E2E oauth CI job

**File:** `.github/workflows/ci.yml`

Add `e2e-oauth` job — same structure as bypass but runs the oauth suite:

```yaml
e2e-oauth:
  needs: [build-and-typecheck]
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_USER: app
        POSTGRES_PASSWORD: app
        POSTGRES_DB: tw_portfolio
      ports:
        - 5432:5432
      options: >-
        --health-cmd "pg_isready -U app"
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
    redis:
      image: redis:7
      ports:
        - 6379:6379
      options: >-
        --health-cmd "redis-cli ping"
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  env:
    DB_URL: postgres://app:app@localhost:5432/tw_portfolio
    REDIS_URL: redis://localhost:6379
    PERSISTENCE_BACKEND: postgres
    AUTH_MODE: dev_bypass
    NODE_ENV: test
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version-file: .node-version
        cache: npm
    - run: npm ci
    - run: npm run build -w @tw-portfolio/config
    - run: npm run build -w @tw-portfolio/domain
    - run: npm run build -w @tw-portfolio/shared-types
    - run: npx playwright install --with-deps
    - run: npm run test:e2e:ci:oauth:mem --prefix apps/web
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: e2e-oauth-results
        path: apps/web/tests/e2e/test-results/
        retention-days: 7
```

**Note:** `AUTH_MODE: dev_bypass` in the job-level env is fine — the oauth Playwright config overrides it to `oauth` in its webServer env blocks. The job-level env just provides defaults for any scripts that might read it.

## Change 7: Compose auth-vars consistency check

**File:** `.github/workflows/ci.yml`

Add a step to the existing `deploy-config-validation` job:

```yaml
- name: Validate compose auth-vars consistency
  run: |
    set -euo pipefail
    missing=""

    # Dev compose — check web service
    dev_config=$(docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/fixtures/env.dev.ci config)
    echo "$dev_config" | grep -q "SESSION_SECRET" || missing="$missing dev:SESSION_SECRET"
    echo "$dev_config" | grep -q "SESSION_COOKIE_NAME" || missing="$missing dev:SESSION_COOKIE_NAME"

    # Prod compose — check web service
    prod_config=$(docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/fixtures/env.prod.ci config)
    echo "$prod_config" | grep -q "SESSION_SECRET" || missing="$missing prod:SESSION_SECRET"
    echo "$prod_config" | grep -q "SESSION_COOKIE_NAME" || missing="$missing prod:SESSION_COOKIE_NAME"

    if [ -n "$missing" ]; then
      echo "::error::Missing auth vars in compose config:$missing"
      exit 1
    fi
    echo "✓ SESSION_SECRET and SESSION_COOKIE_NAME present in dev and prod compose configs"
```

## Task Assignment

### TDD Implementer
- Changes 1-4: package.json script, mock server lifecycle, oauth config update, routing.spec.ts fix
- These are tightly coupled — the script, config, and test changes must be consistent

### Senior QA
- No new test files needed — the existing `routing.spec.ts` test (Change 4) IS the test
- QA verifies the re-enabled test passes with the mock server in the oauth config
- QA reviews that the mock server entry matches the bypass config pattern

### Files in-scope for TDD Implementer
- `apps/web/package.json` (add script only)
- `apps/web/tests/e2e/helpers/mock-oauth-server.mjs` (add shutdown handlers)
- `apps/web/tests/e2e/playwright.oauth.config.ts` (add mock server to webServer)
- `apps/web/tests/e2e/specs-oauth/routing.spec.ts` (convert test.fixme to test)
- `.github/workflows/ci.yml` (add e2e-bypass, e2e-oauth jobs, compose auth-vars step)

### Files NOT in-scope (do NOT modify)
- `apps/web/tests/e2e/playwright.config.ts` — bypass config already correct
- `apps/api/src/**` — no production code changes
- `apps/web/src/**` — no production code changes
