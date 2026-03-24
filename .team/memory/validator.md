# Validator Memory — KZO-113 (SSE Infrastructure)

## Iteration 2 Validation Results (KZO-113) — ALL CLEAN

| Suite | Status | Details |
|---|---|---|
| 1. ESLint | CLEAN | 0 errors, 5 warnings (no-wait-for-timeout + pre-existing conditionals) |
| 2. Web unit tests | PASSED | 10 files, 66 tests |
| 3. API integration | PASSED | 18 files, 151 passed, 2 skipped |
| 4. Bypass E2E | PASSED | 45/45 passed (SSE + shell-nav all green) |
| 5. OAuth E2E | PASSED | 50/50 passed (SSE auth all green) |

All iteration 1 failures resolved. No new regressions introduced.

---

## Iteration 1 Validation Results (KZO-113)

### Suite Results

| Suite | Status | Details |
|---|---|---|
| 1. ESLint | FAIL (2 errors) | 2 errors in new SSE test files; 5 warnings |
| 2. Web unit tests | PASSED | 10 files, 66 tests |
| 3. API integration | PASSED | 18 files, 151 passed, 2 skipped |
| 4. Bypass E2E | 3 FAILED | 42 passed |
| 5. OAuth E2E | 2 FAILED | 48 passed |

### ESLint Failures (2 errors)
1. `apps/web/tests/e2e/specs-oauth/sse-auth.spec.ts:2:18` — `'TestEnv' is defined but never used` (@typescript-eslint/no-unused-vars)
2. `apps/web/tests/e2e/specs/sse-events.spec.ts:14:21` — `'userId' is defined but never used` (@typescript-eslint/no-unused-vars)

ESLint warnings (5, not blocking):
- `specs-oauth/sse-auth.spec.ts:77:11` — `playwright/no-wait-for-timeout`
- `specs/sse-events.spec.ts:34:11` — `playwright/no-wait-for-timeout`
- `specs/auth-oauth.spec.ts:261:5,262:7,264:7` — `playwright/no-conditional-in-test`, `playwright/no-conditional-expect` (pre-existing)

### E2E Bypass Failures (3)
1. `tests/e2e/specs/shell-navigation.spec.ts:22:32` — `toHaveAttribute("data-collapsed", "true")` — Expected "true" received "" — 30s timeout exceeded. May be pre-existing flaky test unrelated to SSE.
2. `tests/e2e/specs/sse-events.spec.ts:51:29` — `expect(result.received).toBe(true)` — Expected true, Received false — SSE event never received
3. `tests/e2e/specs/sse-events.spec.ts:82:26` — `expect(result.event).toBe("heartbeat")` — Expected "heartbeat", Received "timeout" — SSE heartbeat not received

### E2E OAuth Failures (2)
1. `tests/e2e/specs-oauth/sse-auth.spec.ts:44:30` — `expect(result.connected).toBe(true)` — Expected true, Received false — EventSource failed to connect with OAuth session
2. `tests/e2e/specs-oauth/sse-auth.spec.ts:90:29` — `expect(result.received).toBe(true)` — Expected true, Received false — SSE event not delivered via OAuth session

### Pattern
- All SSE test failures (4 across bypass+oauth) indicate the SSE endpoint itself is not functioning — EventSource connections fail and no events are received.
- The shell-navigation failure appears unrelated to SSE work (sidebar collapse persistence timeout).

---

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
