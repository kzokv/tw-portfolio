# Fixer Red-Green Verification Loop

The Fixer must follow a **red-green verification loop** for every fix. Full TDD (writing new failing tests first) belongs with the Implementer.

**Required 4-step loop for every fix:**
1. RED — reproduce the exact failure: run the specific failing test, confirm it fails with the reported error
2. FIX — apply the change
3. GREEN — run the specific test, confirm it passes
4. SWEEP — run the **full suite the test belongs to**: for E2E/config changes → run ALL E2E suites; for unit/config changes → run full unit suite. Report the suite result explicitly before sending `[DONE]`.

Do NOT write a new test unless the fix reveals a coverage gap that would cause a silent regression. This is situational, not default.

**Do not modify production auth code for test-only issues:**
If a test fails because of auth mode semantics (e.g. 401 not firing in dev_bypass mode), the fix belongs in the test setup, not in `app.ts` or `registerRoutes.ts`. Changing production auth plumbing to satisfy a test will cause E2E regressions.

**Why:** In KZO-74, the Fixer introduced regressions twice by confirming only the target test passed — never running the broader suite the config change affected. Both regressions were infrastructure/config-level side effects invisible to single-test verification. Reinforced in KZO-114 (7-iteration convergence partially due to incomplete sweep).

**How to apply:** Any time the Fixer role is assigned work in a `/team` session, or when fixing test failures outside of a team context.
