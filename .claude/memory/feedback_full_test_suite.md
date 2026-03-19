---
name: full-test-suite-definition
description: "Full tests pass" means all five suites clean: unit, integration:ci:host, test:e2e, test:e2e:oauth, and lint
type: feedback
---

"Full tests pass" for this project requires ALL of the following to be clean:

1. `npx eslint .` — full project lint (run from repo root)
2. `npm run test:unit --prefix apps/web` — web unit tests (vitest)
3. `npm run test:integration:ci:host --prefix apps/api` — API integration tests (CI/host mode)
4. `npm run test:e2e --prefix apps/web` — standard E2E (Playwright, mock OAuth, dev_bypass mode)
5. `npm run test:e2e:oauth --prefix apps/web` — OAuth E2E (Playwright, real/mock Google OAuth, AUTH_MODE=oauth)

**Why:** The user explicitly defined this set. Never declare "all tests pass" with a subset — e.g. passing unit+integration is NOT "full tests pass".

**How to apply:** When verifying a feature branch is ready, run all five. When a team agent reports test results, check that all five suites are covered.
