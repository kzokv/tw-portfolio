---
name: e2e aaa Phase 5e migration notes
description: Phase 5e HTTP AAA migration specifics — fixture roles, mixed Vitest splitting, dual-pair validation, and Playwright type algebra gotchas
type: feedback
---

## Phase 5e Reality Check (2026-03-28)
- The Phase 5e design note is directionally right about the framework shape, but the current branch's test inventory has drifted. Migration decisions must be made from the *current behavior of each test*, not from historical filenames alone.
- For API-only Playwright runs with `AUTH_MODE=oauth`, fixtures must mint a session cookie. Reusing the dev-bypass reset fixture fails because `POST /__e2e/reset` is intentionally disabled outside `AUTH_MODE=dev_bypass`.
- Keep two fixture roles separate:
  - API session fixtures for API-only OAuth-mode HTTP suites.
  - Reset/x-user-id fixtures for web E2E extension or any dev-bypass runner.
- Mixed Vitest files should be split by test purpose instead of force-migrated wholesale:
  - HTTP-contract assertions can move to Playwright HTTP.
  - `vi.mock()`, `vi.stubGlobal(fetch)`, persistence inspection, event-bus inspection, or DB-schema assertions must stay in Vitest.
- A good migration litmus test in this repo is: "Can this assertion be proven only from real HTTP responses plus follow-up HTTP reads?" If not, it is not a clean Playwright HTTP candidate.

## Phase 5e Follow-Through (2026-03-28)
- When wrapping Playwright `TestType.extend(...)` in shared helpers, prefer the concrete base fixture contract over a broad generic base unless the generic is genuinely required. Broad generic fixture keys make Playwright's `Fixtures<T, W, PT, PW>` type algebra reject valid test fixtures.
- For "no worker fixtures", use `Record<never, never>` instead of `Record<string, never>`. The latter gives the worker-fixture key space a `string` index and makes every new test fixture look like an invalid worker fixture.
- In this repo, `npm run test:all:full` is necessary but not sufficient when touching `@tw-portfolio/test-framework` or `@tw-portfolio/test-e2e`. Run their package tests separately because the full driver only exercises app-level unit/integration/E2E/API suites.
- Run `lint` and `typecheck` before the broad Playwright sweep when adding shared fixture helpers. The fastest failures were type-level contract issues in `withApiEndpoints`, not runtime HTTP behavior.

## Phase 5e HTTP AAA Migration Notes (2026-03-28)
- During dual-pair migration, keep assistant/assert helper contracts backward-compatible until the legacy file is deleted. Tightening `ProfileApiAssert.hasShape(...)` to body-only usage broke the parity runner because the old spec still passed `APIResponse`.
- Pair validators for legacy-vs-AAA specs should compare normalized test titles, not raw reporter title paths. The first title segment differs (`settings.http.spec.ts` vs `settings-aaa.http.spec.ts`) even when the real scenario titles match exactly.
- Migration order that worked:
  1. add `*-aaa.http.spec.ts`
  2. validate one pair as a tracer bullet
  3. run the full pair validator
  4. only then delete the legacy `.http.spec.ts`
- Keep `*-aaa.http.spec.ts` declarative:
  - no direct `expect(...)` in the spec body
  - status/body checks go through assistant assert helpers
  - body extraction goes through arrange helpers
  - public AAA helper methods should carry `@Step()`
- For HTTP AAA in this repo, the useful reusable seams were endpoint-focused assistants plus shared fixture composition in `apps/api/test/http/fixtures.ts`. Avoid spec-local cookie parsing, raw request plumbing, or repeated JSON/body assertions.
