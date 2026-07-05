# E2E AAA Guardrails

For Playwright E2E in this repo, keep Phase 5d-style parallel execution at 2 workers but avoid same-file `fullyParallel` fan-out. Prefer deterministic route-ready markers, route prewarming, and probe-based waits over fixed sleeps, especially for client-hydrated ticker and auth flows.

**How to apply:** When writing or reviewing E2E test configurations and parallel execution settings.

## Declarative `*-aaa.spec.ts` assertions

AAA E2E specs must keep raw Playwright assertions out of the `test(...)` body. Put assertions behind named helper functions or assistant/assert helpers so the spec remains Arrange → Act → Assert at the scenario level and satisfies the repo's `no-restricted-syntax` lint rule.

Do not move conditional assertion branches into the test body to satisfy a one-off scenario. If a scenario needs optional UI handling, put the conditional locator checks in a helper outside `test(...)`, then call that helper from the Assert phase.

**Why:** KZO-225 Phase 3 added AI connector and AI Inbox E2E specs. Lint correctly rejected direct `expect(...)` calls and conditional checks inside the spec bodies; moving those checks into helpers preserved the AAA shape and kept the rule enforceable.

## Assert Stable UI Contracts, Not Fixture-Dependent Data

For focused browser coverage of configurable dashboard/reporting surfaces, assert stable controls, selected states, URL state, and honest empty/unavailable states before asserting data-dependent charts or populated rows. Memory/OAuth E2E fixtures can have user preferences or sparse snapshot data that legitimately hide optional columns or render no-chart states.

**Why:** Frontend redesign reliability follow-up tests initially forced Dashboard holdings columns and Reports charts to be visible. The product behavior was correct, but OAuth user column preferences and memory snapshot scarcity made those assertions fixture-dependent. The stable checks are timeline selected-state mirroring, Portfolio style switching, Reports chart-or-no-snapshot state, and Ticker custom range URL/error behavior.

## Portfolio Enrichment Route Mocks

Portfolio page E2E that needs to alter holdings, freshness, or quote-state data after navigation must mock `/portfolio/enrichment`, not `/dashboard/enrichment`. `/portfolio` is initially seeded by the server-side `/portfolio/primary` read, then the client hook refreshes enrichment asynchronously. Assertions must wait for the enriched UI text/state instead of reading the first visible primary snapshot.

**Why:** The EODHD fallback chip spec initially mocked `/dashboard/enrichment` and immediately read the portfolio chip, so it saw the server-rendered primary `Unavailable` state. Targeting `/portfolio/enrichment` and waiting for the chip's enriched `EODHD fallback` label made the test deterministic across desktop and mobile.
