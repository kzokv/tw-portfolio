---
name: full-test-suite-definition
description: "Full tests pass" means all five suites clean: unit, integration:full:host, test:e2e:bypass:mem, test:e2e:oauth:mem, and lint
type: feedback
---

"Full tests pass" for this project requires ALL of the following to be clean:

1. `npx eslint .` — full project lint (run from repo root)
2. `npm run test:unit --prefix apps/web` — web unit tests (vitest)
3. `npm run test:integration:full:host --prefix apps/api` — API integration tests (CI/host mode)
4. `npm run test:e2e:bypass:mem --prefix apps/web` — standard E2E (Playwright, mock OAuth, dev_bypass mode)
5. `npm run test:e2e:oauth:mem --prefix apps/web` — OAuth E2E (Playwright, real/mock Google OAuth, AUTH_MODE=oauth)

**Why:** The user explicitly defined this set. Never declare "all tests pass" with a subset — e.g. passing unit+integration is NOT "full tests pass".

**How to apply:** When verifying a feature branch is ready, run all five. When a team agent reports test results, check that all five suites are covered.

**Integration test command:** Always use `test:integration:full:host`, never `test:integration` — the bare integration command is not the correct target for development work.

**Root `npm run test` warning:** Running `npm run test` at the repo root executes `npm run test --workspaces`, which runs vitest in all workspaces (including web) but does NOT run Playwright E2E or `test:integration:full:host`. It is NOT equivalent to the full five-suite definition above — do not rely on it as a substitute.
