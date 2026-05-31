# Test Migration Methodology

Any batch test migration (framework switch, runner change, large-scale refactor of existing tests) must use **dual-pair validation** and **upfront A/B/C classification**. Skipping either step turns the migration into a drift-hunting exercise mid-implementation.

## Dual-pair validation

Keep the legacy and migrated specs running side-by-side until parity is proven:

1. Add the new spec (e.g., `*-aaa.spec.ts`) alongside the legacy file
2. Validate one pair as a tracer bullet (compare both spec outcomes on the same flow)
3. Run the full pair validator — normalized title comparison across the whole suite — to catch divergence at scale
4. Only after parity is confirmed, delete the legacy spec

**Never delete the legacy spec based on migrated-spec-green alone.** A migrated spec can pass in isolation while diverging from the legacy on timing, seed assumptions, or behavioral coverage — AAA Phase 5 caught 4 such divergences that single-spec green would have missed.

## Category A/B/C classification (before writing code)

Classify every affected test file before starting migration:

- **Category A** — Clean migration candidates. Assertions are provable from real HTTP responses (or the migrated runner's native capabilities).
- **Category B** — Partial migration. Some assertions migrate, others must stay in the original runner.
- **Category C** — No migration. `vi.mock()`, `vi.stubGlobal(fetch)`, persistence inspection, event-bus inspection, or DB-schema assertions that require the unit-test runner's capabilities.

**Litmus test:** "Can this assertion be proven only from real HTTP responses plus follow-up HTTP reads?" If not, it's not a clean Playwright HTTP candidate.

For Category B files, document in the scope-todo which assertions migrate and which stay — that classification becomes the implementation checklist.

**Why:** Phase 5e initially scoped all 5 API specs for migration. Upfront classification revealed that mixed Vitest files needed splitting by test purpose and that some assertions fundamentally couldn't leave Vitest. Without classification, this would have been discovered mid-implementation, invalidating the scope.

**How to apply:** Any time the scope includes the word "migrate" and a test file, run both steps before writing code. Also applies to migrations between assertion libraries, between test utilities, or between runners (Jest → Vitest, Vitest → Playwright, etc.).
