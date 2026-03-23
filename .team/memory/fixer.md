# Fixer Memory — KZO-109 + KZO-110

## Implementation Status (verified)

All 7 changes from the technical design are implemented and on disk (not committed):

| Change | File | Status |
|--------|------|--------|
| 1 | `apps/web/package.json` — `test:e2e:ci:oauth:mem` script | ✓ done |
| 2 | `apps/web/tests/e2e/helpers/mock-oauth-server.mjs` — SIGINT/SIGTERM handlers | ✓ done |
| 3 | `apps/web/tests/e2e/playwright.oauth.config.ts` — mock server as first webServer entry | ✓ done |
| 4 | `apps/web/tests/e2e/specs-oauth/routing.spec.ts` — `test.fixme` → `test`, stale comments removed | ✓ done |
| 5 | `.github/workflows/ci.yml` — `e2e-bypass` CI job | ✓ done |
| 6 | `.github/workflows/ci.yml` — `e2e-oauth` CI job | ✓ done |
| 7 | `.github/workflows/ci.yml` — compose auth-vars consistency check step | ✓ done |

## Key Observations

- `routing.spec.ts`: the `test.fixme` was converted and the comment about requiring mock OAuth server from the bypass suite was removed. No `dev_bypass` references remain.
- `playwright.oauth.config.ts`: mock server is first webServer entry at `TestEnv.ports.mockOAuth`, matching bypass config pattern.
- CI jobs (`e2e-bypass`, `e2e-oauth`): both `needs: [build-and-typecheck]`, use postgres+redis services, lib build steps, then Playwright.
- `deploy-config-validation` job: compose auth-vars step added inline after local compose rendering.

## Fixer Protocol

- No failures reported yet (validator task #4 pending, code review task #5 in_progress as of initial spawn).
- If findings arrive: reproduce → fix → green → sweep suite → report.
- Out-of-scope files: `apps/api/src/**`, `apps/web/src/**`, `apps/web/tests/e2e/playwright.config.ts`.

---

## Iteration 2 — Post-Validator Investigation

### Bypass E2E Failures: PRE-EXISTING

Both failures confirmed pre-existing (not caused by KZO-109):
- `auth-oauth.spec.ts` and `identity-resolution.spec.ts` last modified 2026-03-20 (KZO-74, KZO-77)
- KZO-109 commit (`15ce7c2`, 2026-03-23) only touched docs files
- `.team/state.json` from prior run already documented these as pre-existing

**auth-oauth.spec.ts:221** — "OAuth callback sets g_auth_session cookie redirects browser to /dashboard"
- Root cause: browser-navigated OAuth callback (localhost:4000 → localhost:3333 redirect), `page.context().cookies()` returns no `g_auth_session` cookie after cross-port redirect. Cookie scoping or timing issue in Playwright.
- Not fixed — pre-existing, not in scope.

**identity-resolution.spec.ts:75** — "two users...settings via session cookies"
- Root cause: In bypass mode, `resolveUserId` should honor session cookies when `sessionSecret` is available (lines 193-201 in registerRoutes.ts). But test receives "user-1" (bypass fallback). Possible causes: `app.oauthConfig` null, HMAC secret mismatch, or Playwright request context cookie header conflict.
- Not fixed — pre-existing, not in scope.

### Script Discrepancies: FIXED

`.claude/rules/full-test-suite.md` had `--prefix` commands that don't exist at workspace level:
- `npm run test:unit --prefix apps/web` → fixed to `npm run test --prefix apps/web`
- `npm run test:integration:full:host --prefix apps/api` → fixed to `npm run test:integration:full:host` (root-level script)
