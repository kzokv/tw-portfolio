# Acceptance Criteria to Tests Mapping

## Functional Acceptance

1. Fee profile math (rounding/min fee/day trade)
- Unit: `libs/domain/test/fee.test.ts`
- API coverage: `apps/api/test/http/` and `apps/api/test/integration/`

2. Weighted-average lot matching
- Unit: `libs/domain/test/lot.test.ts`

3. Historical immutability + recompute preview/confirm
- Integration: `apps/api/test/integration/`
- E2E: `apps/web/tests/e2e/specs/critical-flows.spec.ts`

4. Critical user journey
- E2E: `apps/web/tests/e2e/specs/critical-flows.spec.ts`

5. Service health and readiness
- API endpoints: `/health/live`, `/health/ready`
- Integration: `apps/api/test/integration/` (contract: status shape and dependencies)

6. Web locale switch and full Traditional Chinese translation
- E2E: `apps/web/tests/e2e/specs/critical-flows.spec.ts`

7. Settings unsaved-change discard flow
- E2E: `apps/web/tests/e2e/specs/critical-flows.spec.ts`

8. Settings/domain tooltips visibility and accessibility (including weighted-average details)
- E2E: `apps/web/tests/e2e/specs/critical-flows.spec.ts`

9. Fee profile settings UX v2 (drawer tabs, account fallback, per-security overrides)
- API coverage: `apps/api/test/http/` and `apps/api/test/integration/`
- E2E: `apps/web/tests/e2e/specs/critical-flows.spec.ts`

10. System-generated profile IDs and temp-ID resolution in full settings save flow
- API coverage: `apps/api/test/http/`

11. Security baseline (strict validation + tenant-safe persistence upserts)
- API coverage: `apps/api/test/http/` and `apps/api/test/integration/`

## API route coverage (HTTP vs integration vs E2E)

Playwright HTTP specs (`apps/api/test/http/*.http.spec.ts`) cover browser-free API contracts that only need HTTP requests plus AAA fixtures:

- **Settings:** GET `/settings`, PATCH `/settings`, PUT `/settings/full`, GET `/settings/fee-config`, PUT `/settings/fee-config`.
- **Accounts:** GET `/accounts`, PATCH `/accounts/:id`.
- **Fee profiles:** GET/POST/PATCH/DELETE `/fee-profiles`.
- **Profile API:** GET/PUT `/profile`.
- **Identity/session auth helpers:** GET `/settings` under cookie-vs-header resolution, POST `/__e2e/oauth-session`, and the mixed HTTP portions of OAuth identity resolution.

Vitest integration tests (`apps/api/test/integration/*.integration.test.ts`) cover routes or flows that still need in-process setup, module mocking, persistence orchestration, or streaming helpers:

- **Health:** GET `/health/live`, GET `/health/ready` (status and dependencies shape).
- **Portfolio:** POST/GET `/portfolio/transactions`, GET `/portfolio/holdings`, POST `/portfolio/recompute/preview`, POST `/portfolio/recompute/confirm`.
- **Corporate actions:** GET `/corporate-actions`, POST `/corporate-actions` (success and failure paths).
- **AI:** POST `/ai/transactions/confirm`.
- **Auth/demo/session internals:** OAuth callback handling, demo session orchestration, SSE, user identity persistence, and the non-HTTP-only portions of mixed auth/session tests.

Routes covered only by E2E or out of scope for API-only contract suites (until implemented): GET `/auth/google/start`, GET `/auth/google/callback`; GET/PUT `/fee-profile-bindings` (bindings exercised via settings/full and settings/fee-config); GET `/quotes/latest`; POST `/ai/transactions/parse`.

E2E test layout and coverage are described in [apps/web/tests/e2e/README.md](../apps/web/tests/e2e/README.md).
