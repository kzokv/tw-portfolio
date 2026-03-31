---
name: AAA migration methodology
description: Two-part methodology for safe batch test migrations — dual-pair validation and A/B/C upfront classification
type: feedback
---

## Dual-pair validation (the only safe migration strategy)

Keep legacy and new specs running side-by-side until parity is proven. Migration order:
1. Add `*-aaa.spec.ts` alongside the legacy file
2. Validate one pair as a tracer bullet
3. Run the full pair validator (normalized title comparison)
4. Only then delete the legacy spec

**Why:** During the AAA migration (phases 5a-5e), migrated specs could pass in isolation yet diverge from legacy on timing, seed assumptions, or behavioral coverage. Dual-pair validation caught 4 divergences that single-spec green would have missed.

**How to apply:** Any future test framework migration, test runner switch, or large-scale test refactor. Also applies when migrating between assertion libraries or test utilities.

## Category A/B/C classification before implementation

Classify tests into categories before starting migration to prevent mid-implementation scope surprises:

- **Category A:** Clean migration candidates — HTTP-contract assertions provable from real HTTP responses
- **Category B:** Partial migration — some assertions migrate, others must stay in the original runner
- **Category C:** No migration — `vi.mock()`, `vi.stubGlobal(fetch)`, persistence inspection, event-bus inspection, or DB-schema assertions that require unit test runner capabilities

Litmus test: "Can this assertion be proven only from real HTTP responses plus follow-up HTTP reads?" If not, it's not a clean Playwright HTTP candidate.

**Why:** Phase 5e initially scoped all 5 API specs for migration. Classification revealed that mixed Vitest files needed splitting by test purpose, and some assertions fundamentally could not leave Vitest. Without upfront classification, this would have been discovered mid-implementation.

**How to apply:** Before any batch test migration, classify every test file using the A/B/C criteria. For Category B files, document which assertions migrate and which stay. This classification becomes the implementation checklist.
