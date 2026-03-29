---
name: Category A/B/C classification before implementation
description: Classify tests by migration eligibility upfront to prevent mid-implementation scope surprises
type: feedback
---

Classify tests into categories before starting migration to prevent mid-implementation scope surprises.

Categories used in the AAA migration:
- **Category A:** Clean migration candidates — HTTP-contract assertions provable from real HTTP responses
- **Category B:** Partial migration — some assertions migrate, others must stay in the original runner
- **Category C:** No migration — `vi.mock()`, `vi.stubGlobal(fetch)`, persistence inspection, event-bus inspection, or DB-schema assertions that require unit test runner capabilities

Litmus test: "Can this assertion be proven only from real HTTP responses plus follow-up HTTP reads?" If not, it's not a clean Playwright HTTP candidate.

**Why:** Phase 5e initially scoped all 5 API specs for migration. Classification revealed that mixed Vitest files needed splitting by test purpose, and some assertions fundamentally could not leave Vitest. Without upfront classification, this would have been discovered mid-implementation.

**How to apply:** Before any batch test migration, classify every test file using the A/B/C criteria. For Category B files, document which assertions migrate and which stay. This classification becomes the implementation checklist.
