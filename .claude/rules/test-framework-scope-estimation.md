# Test Framework Work Is Architecture Work

Scoping a test framework change as "just rewrite tests" underestimates effort by **3-5x**. Test framework migrations surface — and require solutions to — infrastructure problems that weren't visible under the old framework.

## What's actually in scope

Any of these can surface mid-migration and blow the estimate:

- **Readiness contracts** — route-ready markers for client-hydrated pages, shell-ready vs. app-ready distinction
- **Hydration races** — test-runner polling vs. SSE event timing, RSC boundaries
- **Fixture isolation** — per-test session/cookie state, parallel contention, shared-server test pollution
- **Auth mode semantics** — dev_bypass vs. oauth, mock OAuth servers, multiple distinct auth patterns per suite
- **Parallel execution constraints** — worker count, parallel-by-file vs. fullyParallel, same-file fan-out limits

**Why:** The AAA migration (phases 5a-5e) was initially scoped as "rewrite tests in AAA style." Every phase required solving at least one infrastructure problem invisible under the legacy framework. The 3-5x multiplier is observed, not theoretical.

## How to apply

When scoping test framework changes — or large-scale test refactors adjacent to framework behavior:

1. **Use `/scope-grill`** to surface infrastructure risks before writing code. The grill should explicitly probe each of the five categories above.
2. **Budget for infrastructure discovery** — assume at least one readiness/isolation/auth/parallel problem will surface, and plan a buffer.
3. **Expect at least one code-review cycle** focused on architectural drift (not style). Test framework refactors pull concerns from routing, auth, and runtime behavior into the test layer; the review catches the bleed-through.
4. **Reject estimates that treat it as a pure rewrite.** If an estimate doesn't account for readiness contracts or fixture isolation, the scope is wrong — push back before committing a timeline.

Companion rule: `test-migration-methodology.md` covers how to execute the migration itself (dual-pair validation, A/B/C classification) once the scope is right.
