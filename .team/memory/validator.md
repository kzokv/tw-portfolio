# Validator Memory — KZO-109

## Iteration 1 Validation Results

### Script Discrepancies (AGENTS.md / CLAUDE.md vs actual package.json)
- `npm run test:unit --prefix apps/web` → script `test:unit` does NOT exist. Used `test` (vitest run) instead.
- `npm run test:integration:full:host --prefix apps/api` → script `test:integration:full:host` does NOT exist. Used `test:integration:full` instead. AGENTS.md references this as the Darwin/host mode command but it is absent from apps/api/package.json.

### Suite Results

| Suite | Status | Details |
|---|---|---|
| 1. ESLint | WARN (0 errors) | 1 warning: auth.setup.ts:13:1 — no assertions |
| 2. Web unit tests | PASSED | 10 files, 66 tests |
| 3. API integration | PASSED | 14 files (3 skipped), 94 tests (40 skipped) |
| 4. Bypass E2E | 2 FAILED | 41 passed |
| 5. OAuth E2E | FLAKY (passed on re-run) | 1 fail on run 1, 48 passed on runs 2-3 |

### Bypass E2E Failures (2)
1. `tests/e2e/specs/auth-oauth.spec.ts:221:3`
   - Test: "OAuth callback sets g_auth_session cookie and redirects browser to /dashboard"
   - Error: `expect(received).toBeDefined()` — session cookie was `undefined`

2. `tests/e2e/specs/identity-resolution.spec.ts:75:3`
   - Test: "two users with different emails access isolated settings via their session cookies"
   - Error: Expected `"a7564618-b71f-4b3d-bf5b-738becb2d253"`, received `"user-1"`
   - Note: "user-1" is the dev_bypass fallback — this test expects OAuth session behavior in bypass mode

### OAuth E2E Flakiness
- Run 1: 1 failed, 47 passed (failed test identity not captured before re-run)
- Run 2 & 3: 48 passed (all clean)
