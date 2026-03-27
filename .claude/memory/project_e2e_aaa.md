---
name: e2e aaa migration lessons and guardrails
description: Durable lessons from the Phase 5d AAA migration, including structure rules, parallel execution constraints, and API-vs-web AAA differences
type: feedback
---

## Phase 5d Outcome
- Phase 5d AAA UI migration is complete and green.
- Stable full-suite runs:
  - `npm run test:e2e:bypass:mem -w @tw-portfolio/web`
  - `npm run test:e2e:oauth:mem -w @tw-portfolio/web`
- The five API-only specs named in the Phase 5d design remain outside the UI AAA migration by design and move to Phase 5e. They still need stability, but not web-style page-object migration.

## What The Refactor Actually Taught
- Most hard failures were not "syntax of AAA" problems. They were readiness, hydration, routing, and parallel-execution problems exposed by the migration.
- Dual-pair validation is necessary. A migrated AAA spec can pass in isolation yet still diverge from the legacy spec on timing, seed assumptions, or behavioral coverage.
- Shared fixture duplication causes drift fast. The duplicated logic across `base.ts`, `noAuthBase.ts`, and `oauthBase.ts` was a correctness risk, not just a style issue.
- Fixed sleeps hide root causes. Converting them to deterministic probes or route-ready signals was the key to making the suite both faster and less flaky.
- "Parallel-safe" is an execution-model property, not a raw worker-count property. In this repo, 2 workers with parallel-by-file is stable; same-file `fullyParallel` fan-out was not.

## Web AAA Rules
- Keep spec files declarative. The spec should orchestrate behavior, not contain direct `expect(...)` calls or raw page-driving logic.
- Use explicit Arrange, Act, and Assert helpers. Each helper method should represent a business-reasonable behavior, not a single DOM primitive unless that primitive is the actual reusable behavior boundary.
- Annotate helper methods with Playwright `test.step(...)` so traces, reports, and failures preserve the AAA story.
- Put navigation, form entry, and clicks in Actions helpers. Put user-visible or system-visible verification in Assert helpers.
- Prefer page/component objects plus assistants over spec-local selectors. This keeps selectors centralized and reduces pair-drift between legacy and migrated tests.
- Keep one dominant behavior per test. When a spec mixes navigation, tooltip checks, settings mutation, and auth/session verification in one flow, it becomes harder to stabilize and harder to understand.
- Add deterministic route-ready signals for client-hydrated pages. Shell readiness was not enough for ticker detail routes; a page-specific client-ready marker was required.
- Prewarm slow routes in fixtures when repeated cold starts dominate failures or runtime. This is especially useful for auth redirects and heavy client routes.
- Avoid `page.waitForTimeout()`. Replace it with a UI-ready marker, network-level probe, or domain-level polling helper.
- Preserve parity with the legacy scenario before "cleaning up" data shapes. Seed or flow simplifications can accidentally break dual-pair validation.

## TDD Rules For AAA Work
- Start with the failing legacy or pair-validation behavior, then migrate one scenario at a time.
- Do not introduce new helper abstractions before a concrete failing scenario justifies them.
- After each migrated scenario, run the narrow pair first, then the affected file, then the relevant suite.
- Treat a flaky green as still red. If it only passes under `--workers=1`, it is not done.

## API AAA Vs Web AAA
- Web AAA is interaction-driven:
  - Arrange: auth/session/seed/setup plus route navigation.
  - Act: UI interactions through assistants and page objects.
  - Assert: rendered state, visibility, navigation outcome, and user-visible data.
- API AAA is request-driven:
  - Arrange: auth headers, seed data, request payload builders, mock or probe setup.
  - Act: HTTP request, SSE subscription, or background trigger.
  - Assert: status, body contract, persistence side effects, emitted events, and idempotency behavior.
- API AAA does not need page objects or client-ready markers. It benefits more from request builders, response assertions, polling/probe helpers, and persistence verifiers.
- API AAA can be more direct than web AAA because the transport boundary is already explicit. The web variant needs stricter separation to avoid page-driving logic leaking back into specs.

## Hardest Part
- The hardest part was separating migration defects from app/runtime defects. The failing symptom often appeared inside the new AAA spec, but the real cause was a cold-start route, a hydration race, a redirect wait mismatch, or parallel contention.
- The second hardest part was preserving exact behavioral parity while refactoring structure. Cleaner helpers are easy to write; helpers that preserve the old spec's timing, seed expectations, and verification depth are much harder.

## Durable Repo Guardrails
- Keep the canonical E2E execution target at 2 workers without same-file `fullyParallel`.
- For client-hydrated routes, add an explicit readiness contract in the UI before building retries around the test.
- Centralize shared fixture behavior once auth variants start copying the same setup logic.
- Keep pair validation as a mandatory migration exit criterion for future refactors.
- Treat API-only specs as a separate migration track when the design does not require page-level AAA structure.

## Recommended Follow-Ups
- Add an ESLint rule or custom check that forbids direct `expect(...)` in `*-aaa.spec.ts`.
- Add a small AAA spec template and assistant template so future migrations start from the correct shape.
- Keep a single shared route-prewarm utility and document when a route qualifies for it.
- Add a CI lane that runs old/new pair batches under the real 2-worker configuration before merge.
- Consider adding a lightweight "ready contract" checklist for interactive routes: shell ready, client ready, first data ready, and mutation settled.
