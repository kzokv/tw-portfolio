# E2E Tests

Playwright-based end-to-end tests for critical user journeys. Run against the web app and API (memory or postgres).

## Why E2E lives under `apps/web`

E2E tests are owned by the web app and run against the full stack (web + API). Colocating them under `apps/web/tests/e2e/` keeps tests with the app they exercise and simplifies the monorepo layout.

## Structure

- **`specs/`** – Dev-bypass mode specs: AAA-migrated UI specs plus browser-mediated API checks (`sse-events`, `identity-resolution`).
- **`specs-oauth/`** – OAuth mode specs: AAA-migrated UI/auth specs (`auth-demo-aaa`, `auth-session-aaa`, `profile-tab-aaa`, `routing-aaa`, `demo-symbol-history-aaa`) plus the browser-mediated SSE auth check (`sse-auth`).
- **`apps/api/test/http/`** – Browser-free API HTTP contract specs that used to live in E2E or vitest integration when they only needed HTTP requests plus AAA assistants.
- **`@vakwen/test-e2e/fixtures/*`** – Shared package fixtures for dev-bypass, OAuth, demo, and composed page-assistant flows.
- **`@vakwen/test-e2e/utils`** – Shared URL and cookie helpers used by both UI and API-style E2E specs.
- **`playwright.config.ts` / `playwright.oauth.config.ts`** – Configure Playwright to start API and the prebuilt standalone web server via `webServer`, keep suite-specific per-test timeouts, allow up to `120_000` ms for server startup/build readiness, and run the local E2E suites with one worker.

## Requirements

- **Playwright**: Installed as project devDependency (root and `apps/web`). Run `npm run onboard` or `npm run install:full` from repo root once per machine.
- **System libs** (Linux): If Chromium fails with missing shared libraries (e.g. `libglib-2.0.so.0`), run `npx playwright install-deps` (may need `sudo`). E2E requires Playwright system dependencies; failures may indicate missing libraries.
- **Ports**: E2E uses `WEB_PORT` (default `3333`) and `API_PORT` (default `4000`). Startup now terminates repo-owned `apps/web`, `apps/api`, and mock OAuth dev watchers before each run so Playwright always gets a fresh stack. If an unrelated process owns one of those ports, the run fails with the owning PID, cwd, and command instead of killing it.
- **Build**: E2E npm scripts build the shared test packages and `@vakwen/web` before Playwright starts. If you run `npx playwright test` directly against these configs, build `@vakwen/web` first so the standalone server exists.
- **Dev-bypass reset hook**: The suite expects the API to expose `POST /__e2e/reset` in `development + dev_bypass + memory` mode so each test can start from a seeded user store.
- **OAuth session hook**: The oauth suite uses `POST /__e2e/oauth-session` (guarded by `NODE_ENV !== "production"`) to seed authenticated sessions without going through real Google OAuth.
- **Demo session hook**: The demo fixture uses `POST /__e2e/demo-session` (same guard) to create demo users with seeded data, bypassing the rate limiter on `/auth/demo/start`.

## Coverage (vs integration)

E2E covers **user-visible behavior** and full-stack flows. Browser-free API contracts now live primarily in `apps/api/test/http/`, while `apps/api/test/integration/` is reserved for in-process, mocked, or persistence-heavy cases that need more than plain HTTP. See `docs/002-operations/acceptance-test-mapping.md` for the current split.

## Running

From **repo root** (scripts live in root package.json):

- `npm run test:e2e:bypass:mem` – Builds the web app, then runs `specs/` (dev-bypass mode). `webServer` starts a fresh API and standalone web stack automatically and fails fast on unrelated port conflicts. Generates an HTML report; opens automatically on failure.
- `npm run test:e2e:oauth:mem` – Builds the web app, then runs `specs-oauth/` (OAuth mode, `AUTH_MODE=oauth`) against a fresh mock OAuth, API, and standalone web stack. Includes demo session, auth session, profile, routing, and SSE auth tests.
- `npm run test:http:api` – Runs the browser-free API HTTP suite in `apps/api/test/http/` against an API-only Playwright stack.
- `npm run test:e2e:ci:bypass:mem` – Same as bypass, with `--reporter=junit` for CI integration.
- `npm run test:e2e:show-report` – View the last generated HTML report (run from repo root or `apps/web`).
- `npm run install:full` – Install npm deps + Playwright browsers + system deps (Linux; prompts for sudo if needed).

## HTML report

An HTML report is generated on every E2E run and saved to `apps/web/playwright-report/`. It opens automatically when tests fail. To view it manually, run `npm run test:e2e:show-report` from repo root or `apps/web`.

Selectors use `data-testid` for stability; avoid layout- or text-dependent selectors where possible.

## Isolation model

### Dev-bypass mode (`specs/`)
- Each test gets its own deterministic `x-user-id` via the `tw_e2e_user` browser cookie.
- The packaged dev-bypass fixtures reset that seeded user through `POST /__e2e/reset` before the test starts.
- Because the suite keeps a strict 30-second per-test timeout, the dev-bypass command uses one worker to avoid local web/API contention while preserving per-test isolation.
- Use `test.describe.configure({ mode: "serial" })` only when a spec intentionally chains dependent user actions.

### OAuth mode (`specs-oauth/`)
- Tests use real session cookies signed by the API (via `/__e2e/oauth-session` or `/__e2e/demo-session`).
- The packaged demo fixtures create a fresh demo user per test, bypassing the rate limiter entirely. This avoids 429 errors when multiple specs hit `/auth/demo/start`.
- AAA auth specs still exercise the real sign-in UI and only stub network responses when a case explicitly needs a controlled non-OK response.
- The OAuth command also uses one worker because its auth-heavy specs share the same local API and web stack and are sensitive to startup and CPU contention.
