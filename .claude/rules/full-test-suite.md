# Full Test Suite Definition

"Full tests pass" for this project requires ALL eight suites to be clean:

1. `npx eslint .` — full project lint (run from repo root)
2. `npm run typecheck` — typecheck (builds libs, then runs `tsc --noEmit` on `apps/api`, `apps/api/test`, and `apps/web`)
3. `npm run test --prefix apps/web` — web unit tests (vitest)
4. `npm run test --prefix apps/api` — API unit + memory-backed integration tests (vitest)
5. `npm run test:integration:full:host` — API integration tests (CI/host mode, Postgres-backed, run from repo root)
6. `npm run test:e2e:bypass:mem --prefix apps/web` — standard E2E (Playwright, mock OAuth, dev_bypass mode)
7. `npm run test:e2e:oauth:mem --prefix apps/web` — OAuth E2E (Playwright, real/mock Google OAuth, AUTH_MODE=oauth)
8. `npm run test:http --prefix apps/api` — API HTTP tests (Playwright, AUTH_MODE=oauth)

Never declare "all tests pass" with a subset — e.g. passing unit+integration is NOT "full tests pass".

## Canonical one-shot command

**Before `git push`** (especially before opening or updating a PR) run:

```bash
npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
```

- `npm run test:all:full` = `bash scripts/test.sh --all --full --e2e-oauth --http-api`. It runs suites 3–8 in one invocation and is the canonical pre-push gate.
- It does **not** run lint (1) or typecheck (2). Chain them explicitly as shown above, or run them first.
- Total runtime is ~8–12 minutes on macOS host; the E2E suites dominate.
- On CI, each suite runs as a separate job — a single-suite failure does not block the others from reporting, so reading `gh pr checks` still requires checking every job.

**Why this matters:** pushing a commit that only passes a subset of suites triggers CI failures that waste cycles and block the PR. KZO-147's unit-tests CI job failed because `apps/api` vitest tests were verified locally (with a `.env.local` that set `PERSISTENCE_BACKEND=memory`) but the CI runner had no `.env.local`, so `Env.PERSISTENCE_BACKEND` defaulted to `postgres` and `assertE2ESeedEnabled` returned 404. A clean-env pre-push run via `test:all:full` would have caught this.

**Why typecheck is separate from lint/tests:** Vitest uses esbuild which strips types without checking them. ESLint catches some type issues but not generic constraint mismatches or overload resolution failures. Only `tsc --noEmit` catches the full spectrum of TypeScript errors. This must match CI's `build-and-typecheck` job.

**Typecheck scope — spec files are not automatic:** `apps/api/tsconfig.json` includes only `src/**/*.ts` (because `rootDir: src`). HTTP spec files under `apps/api/test/http/**` are covered by the separate `apps/api/test/tsconfig.json` that the root `typecheck` script chains in. When adding a new test directory outside `src/`, either add it to that test tsconfig's `include` or create an adjacent tsconfig and append it to the root `typecheck` script — otherwise type errors in specs are silently invisible. (Pre-existing drift under `test/integration/` and `test/unit/` is why the test tsconfig currently scopes to `http/**` only; expand once those are clean.)

**Integration test command:** Always use `test:integration:full:host`, never `test:integration` — the bare integration command is not the correct target for development work.

**Root `npm run test` warning:** Running `npm run test` at the repo root executes `npm run test --workspaces`, which runs vitest in all workspaces (including web) but does NOT run Playwright E2E, API HTTP, or `test:integration:full:host`. It is NOT equivalent to the full seven-suite definition above.

**Why:** The user explicitly defined this set. Incomplete test verification has caused regressions to slip through.

**How to apply:** When verifying a feature branch is ready, run all seven. When a team agent reports test results, check that all seven suites are covered.
