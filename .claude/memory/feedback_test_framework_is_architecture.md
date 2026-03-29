---
name: test framework work is architecture work
description: Test framework migration is 3-5x more scope than "just rewrite tests" — surfaces readiness contracts, hydration races, fixture isolation, auth mode semantics
type: feedback
---

Test framework work is architecture work. Scoping it as "just rewrite tests" underestimates effort by 3-5x.

The AAA migration surfaced issues that had nothing to do with test syntax:
- Readiness contracts (route-ready markers for client-hydrated pages)
- Hydration races (Playwright polling vs SSE event timing)
- Fixture isolation (per-test sessions, parallel contention)
- Auth mode semantics (dev_bypass vs oauth, 4 distinct auth patterns)
- Parallel execution constraints (2-worker, parallel-by-file, no same-file fullyParallel)

**Why:** The "rewrite tests" framing led to initial scope estimates that didn't account for infrastructure hardening. Each phase (5a-5e) required solving at least one infrastructure problem that wasn't visible until tests were running under the new framework.

**How to apply:** When scoping test framework changes, budget for infrastructure discovery. Use `/scope-grill` to surface these risks before implementation. Expect at least one code review cycle to catch architectural drift.
