# Implementation TODO — P0 Auth Bug Fixes

> Consolidated from grill-me session on 2026-03-21.
> Scope: P0-1 through P0-7 (excludes P0-8: SESSION_SECRET in docker-compose.local.yml).
> Linear tickets: KZO-98 (wire middleware), KZO-99 (remove AUTH_USER_ID pipeline).
> Branch: `kzo-98`
> **Status: COMPLETE** — all tests green, 1 iteration, no escalations.

---

## Commit Structure

Three commits, ordered by safety dependency:

1. **~~Wire middleware~~** → **auth.ts fallback only** (design corrected: proxy.ts is native middleware in Next.js 16)
2. **Remove AUTH_USER_ID chain** — across all layers (expanded from 6 to 13 files by code review)
3. **Tests** — verifies both

### Design Correction

Original plan assumed `proxy.ts` was dead code requiring `middleware.ts` re-export. **Next.js 16.1.6 uses `proxy.ts` natively** — handler resolution at `next-server.js:1233` checks `middlewareModule.proxy || middlewareModule.middleware`. Creating `middleware.ts` crashes the app with: `Error: Both middleware file "./middleware.ts" and proxy file "./proxy.ts" are detected.`

---

## Commit 1: auth.ts fallback

### ~~1.1 Create `apps/web/middleware.ts`~~
- [x] ~~Create file with one-line re-export~~ **CANCELLED** — proxy.ts is already the active middleware in Next.js 16
- [x] Verify `proxy.ts:33-36` passes through in dev_bypass mode (no enforcement) — confirmed via source analysis
- [x] Verify oauth mode enforces session cookie + HMAC on all routes except `/login`, `/auth/*`, static assets — confirmed

### 1.2 Add default fallback in `apps/web/lib/auth.ts`
- [x] In `resolveSession()` dev_bypass block, after cookie checks, add:
  ```typescript
  return { userId: "user-1" };  // matches API's resolveUserId() fallback
  ```
- [x] Verify: no cookies set in dev_bypass → session resolves to `{ userId: "user-1" }` (not null)
- [x] Verify: `tw_e2e_user` cookie still takes precedence over the default

---

## Commit 2: Remove AUTH_USER_ID chain (13 files — expanded from original 6 by code review)

### 2.1 `apps/web/lib/api.ts` — remove dead vars from `getAuthHeaders()`
- [x] Remove `NEXT_PUBLIC_AUTH_USER_ID` read — root cause of Google login bug
- [x] Remove `NEXT_PUBLIC_DEV_USER_ID` read — dead code, never set anywhere
- [x] Remove `NEXT_PUBLIC_API_PORT` read — dead code, never set anywhere
- [x] Keep: `tw_e2e_user` cookie → `x-user-id` header path (E2E per-test isolation)
- [x] Keep: `getRuntimeDevUserId()` (client→API identity for E2E tests)

### 2.2 `apps/api/src/routes/registerRoutes.ts` — remove header trust in oauth mode
- [x] In `resolveUserId()` oauth mode: remove `x-authenticated-user-id` header check entirely
- [x] Session cookie becomes the **sole identity source** in oauth mode
- [x] No valid session cookie → throw 401 `auth_required`
- [x] Keep: dev_bypass mode unchanged (session cookie → x-user-id header → fallback "user-1")

### 2.3 Docker compose files — remove build args
- [x] `infra/docker/docker-compose.local.yml` — removed `NEXT_PUBLIC_AUTH_USER_ID` build arg
- [x] `infra/docker/docker-compose.dev.yml` — removed `NEXT_PUBLIC_AUTH_USER_ID` build arg
- [x] `infra/docker/docker-compose.prod.yml` — removed `NEXT_PUBLIC_AUTH_USER_ID` build arg

### 2.4 Web Dockerfile — remove ARG
- [x] Removed `ARG NEXT_PUBLIC_AUTH_USER_ID` and `ENV` line from web Dockerfile

### 2.5 Docker env schemas — remove AUTH_USER_ID field
- [x] `libs/config/src/env-docker.ts` — removed `AUTH_USER_ID` from all schemas

### 2.6 `infra/scripts/deploy.sh` — invert validation
- [x] Inverted: hard ERROR + exit 1 when AUTH_USER_ID is set in oauth mode

### 2.7 Additional files found by code review (not in original plan)
- [x] `apps/web/app/api/profile/route.ts` — forwards session cookie instead of `x-authenticated-user-id` header (H1)
- [x] `apps/api/src/app.ts` — rate limiter no longer reads unverified `x-authenticated-user-id` header (H2)
- [x] `libs/config/src/env-metadata.ts` — removed AUTH_USER_ID from env-setup groups (M1)
- [x] `infra/docker/.env.dev.example` + `.env.prod.example` — removed AUTH_USER_ID references (M2)
- [x] `infra/docker/fixtures/env.*.ci` (3 files) — removed AUTH_USER_ID from CI fixtures (L1)

---

## Commit 3: Tests

### 3.1 Identity regression E2E test
- [x] Created `apps/web/tests/e2e/specs-oauth/auth-identity-source.spec.ts`
- [x] Test A: x-authenticated-user-id header is ignored — session cookie is sole identity source
- [x] Test B: unauthenticated request with x-authenticated-user-id header returns 401
- [x] Test C: unauthenticated request without any headers returns 401

### 3.2 deploy.sh validation unit tests (Vitest)
- [x] Created `infra/scripts/__tests__/deploy-validation.test.ts`
- [x] Test case: `AUTH_MODE=oauth` + `AUTH_USER_ID=user-1` → exit 1 + error message on stderr
- [x] Test case: `AUTH_MODE=oauth` + `AUTH_USER_ID` unset → exit 0 (passes validation)
- [x] Test case: `AUTH_MODE=dev_bypass` + `AUTH_USER_ID=user-1` → exit 0 (allowed)

### 3.3 Run existing E2E suites
- [x] `npm run test:e2e` (bypass) — 43/43 passing
- [x] `npm run test:e2e:oauth` — 39/39 passing (excluding pre-existing KZO-78 profile-tab failures)

---

## Post-PR: Linear Updates

- [ ] KZO-98 → mark completed (In Review or Done)
- [ ] KZO-99 → mark completed (shipped in same PR as atomic pair)
- [ ] Verify KZO-99 no longer shows as blocked

---

## Validation Summary

| Suite | Result |
|-------|--------|
| Build | PASS |
| Lint | PASS |
| Typecheck | PASS |
| Unit tests | 16 passed |
| Integration tests | 88 passed |
| Deploy validation | 3 passed |
| E2E bypass | 43 passed |
| E2E oauth | 39 passed |

---

## Out of Scope (tracked for future PRs)

These items are documented in the design docs but excluded from this PR:

| Item | Phase | Tracked In |
|------|-------|-----------|
| P0-8: Add SESSION_SECRET to docker-compose.local.yml web container | P0 | Doc 02 P0-3 |
| P1-1 through P1-10: Core env refactor (unified .env.example, schema consolidation, DEPLOY_ENV) | P1 | Doc 02 Phase 1 |
| P2-1 through P2-6: Dev experience (npm scripts, dev.sh, help-printers) | P2 | Doc 02 Phase 2 |
| P3-1 through P3-7: Test hardening (E2E CI jobs, validation unit tests, CI guards) | P3 | Doc 02 Phase 3 |
| Demo user feature (DEMO_MODE_ENABLED, /auth/demo/start) | P2 | Doc 03 Section 2 |

---

## Key Rules (from .claude/rules/)

When implementing, respect these guardrails:

1. **Do NOT modify `app.ts` or `registerRoutes.ts` to accommodate test setup** — if tests fail due to auth mode, use `vi.mock("@tw-portfolio/config")` at the test-file level. See `.claude/rules/vitest-auth-mode-override.md`.
2. **API route handlers use `getSession()` + manual 401**, never `requireSession()`. See `.claude/rules/api-route-session-guard.md`.
3. **If a fix requires production code changes for test-only reasons**, send `[QUESTION]` to the Architect. See `.claude/rules/fixer-scope-guardrail.md`.
