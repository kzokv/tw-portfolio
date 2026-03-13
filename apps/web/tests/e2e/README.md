# E2E Tests

Playwright-based end-to-end tests for critical user journeys. Run against the web app and API (memory or postgres).

## Why E2E lives under `apps/web`

E2E tests are owned by the web app and run against the full stack (web + API). Colocating them under `apps/web/tests/e2e/` keeps tests with the app they exercise and simplifies the monorepo layout.

## Structure

- **`specs/`** – Behavior-based specs: `shell-navigation`, `settings`, `portfolio-transactions`, and `tooltips-a11y`.
- **`fixtures/test.ts`** – Shared Playwright fixture that resets a seeded user and assigns a deterministic dev-bypass identity per test.
- **`helpers/flows.ts`** – Route helpers, shell-ready wait logic, and E2E reset/user-selection helpers.
- **`playwright.config.ts`** – Configures Playwright to start API and web via `webServer`, keep the per-test `45_000` ms timeout, and run parallel by default.

## Requirements

- **Playwright**: Installed as project devDependency (root and `apps/web`). Run `npm run onboard` or `npm run install:full` from repo root once per machine.
- **System libs** (Linux): If Chromium fails with missing shared libraries (e.g. `libglib-2.0.so.0`), run `npx playwright install-deps` (may need `sudo`). E2E requires Playwright system dependencies; failures may indicate missing libraries.
- **Ports**: E2E uses `WEB_PORT` (default `3333`) and `API_PORT` (default `4000`). Startup only reclaims stale repo-owned `apps/web` / `apps/api` dev servers on those ports. If another process owns a port, the run fails with the owning PID, cwd, and command instead of killing it.
- **Build**: `npm run onboard` already builds the workspace libs, so rerun `npm run build -w libs/domain -w libs/shared-types` only if you skipped onboarding or edited those packages since the last build. Running `npm run build` from the repo root is still helpful if you want a full rebuild before the E2E suite.
- **Dev-bypass reset hook**: The suite expects the API to expose `POST /__e2e/reset` in `development + dev_bypass + memory` mode so each test can start from a seeded user store.

## Coverage (vs integration)

E2E covers **user-visible behavior** and full-stack flows. It does not re-test API contracts (those live in `apps/api/test/integration/`). See `docs/acceptance-test-mapping.md` for which acceptance criteria are covered by E2E vs integration.

## Running

From **repo root** (scripts live in root package.json):

- `npm run test:e2e` – Runs Playwright with config at `apps/web/tests/e2e/`. `webServer` starts API and web automatically, reuses healthy existing repo servers, and fails fast on unrelated port conflicts. Generates an HTML report; opens automatically on failure.
- `npm run test:e2e:ci` – Same, with `--reporter=junit` for CI integration.
- `npm run test:e2e:show-report` – View the last generated HTML report (run from repo root or `apps/web`).
- `npm run install:full` – Install npm deps + Playwright browsers + system deps (Linux; prompts for sudo if needed).

## HTML report

An HTML report is generated on every E2E run and saved to `apps/web/playwright-report/`. It opens automatically when tests fail. To view it manually, run `npm run test:e2e:show-report` from repo root or `apps/web`.

Selectors use `data-testid` for stability; avoid layout- or text-dependent selectors where possible.

## Isolation model

- Each test gets its own deterministic `x-user-id` via the `tw_e2e_user` browser cookie.
- The fixture resets that seeded user through `POST /__e2e/reset` before the test starts.
- Because stateful tests no longer share one in-memory user, the suite can run in parallel by default.
- Use `test.describe.configure({ mode: "serial" })` only when a spec intentionally chains dependent user actions.
