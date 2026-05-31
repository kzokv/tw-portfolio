# E2E AAA Guardrails

For Playwright E2E in this repo, keep Phase 5d-style parallel execution at 2 workers but avoid same-file `fullyParallel` fan-out. Prefer deterministic route-ready markers, route prewarming, and probe-based waits over fixed sleeps, especially for client-hydrated ticker and auth flows.

**How to apply:** When writing or reviewing E2E test configurations and parallel execution settings.

## Declarative `*-aaa.spec.ts` assertions

AAA E2E specs must keep raw Playwright assertions out of the `test(...)` body. Put assertions behind named helper functions or assistant/assert helpers so the spec remains Arrange → Act → Assert at the scenario level and satisfies the repo's `no-restricted-syntax` lint rule.

Do not move conditional assertion branches into the test body to satisfy a one-off scenario. If a scenario needs optional UI handling, put the conditional locator checks in a helper outside `test(...)`, then call that helper from the Assert phase.

**Why:** KZO-225 Phase 3 added AI connector and AI Inbox E2E specs. Lint correctly rejected direct `expect(...)` calls and conditional checks inside the spec bodies; moving those checks into helpers preserved the AAA shape and kept the rule enforceable.
