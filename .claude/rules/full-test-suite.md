# Full Test Suite Definition

"Full tests pass" for this project requires ALL seven suites to be clean:

1. `npx eslint .` — full project lint (run from repo root)
2. `npm run typecheck` — typecheck (builds libs, then runs `tsc --noEmit` on both apps)
3. `npm run test --prefix apps/web` — web unit tests (vitest)
4. `npm run test:integration:full:host` — API integration tests (CI/host mode, run from repo root)
5. `npm run test:e2e:bypass:mem --prefix apps/web` — standard E2E (Playwright, mock OAuth, dev_bypass mode)
6. `npm run test:e2e:oauth:mem --prefix apps/web` — OAuth E2E (Playwright, real/mock Google OAuth, AUTH_MODE=oauth)
7. `npm run test:http --prefix apps/api` — API HTTP tests (Playwright, AUTH_MODE=oauth)

Never declare "all tests pass" with a subset — e.g. passing unit+integration is NOT "full tests pass".

**Why typecheck is separate from lint/tests:** Vitest uses esbuild which strips types without checking them. ESLint catches some type issues but not generic constraint mismatches or overload resolution failures. Only `tsc --noEmit` catches the full spectrum of TypeScript errors. This must match CI's `build-and-typecheck` job.

**Integration test command:** Always use `test:integration:full:host`, never `test:integration` — the bare integration command is not the correct target for development work.

**Root `npm run test` warning:** Running `npm run test` at the repo root executes `npm run test --workspaces`, which runs vitest in all workspaces (including web) but does NOT run Playwright E2E, API HTTP, or `test:integration:full:host`. It is NOT equivalent to the full seven-suite definition above.

**Why:** The user explicitly defined this set. Incomplete test verification has caused regressions to slip through.

**How to apply:** When verifying a feature branch is ready, run all seven. When a team agent reports test results, check that all seven suites are covered.
