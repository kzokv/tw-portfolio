---
name: phased migration with dual-pair validation
description: The only safe test framework migration strategy — keep old + new specs running in parallel, validate parity, then delete old
type: feedback
---

Phased migration with dual-pair validation is the only safe strategy for test framework migrations.

Keep legacy and new specs running side-by-side until parity is proven. Migration order:
1. Add `*-aaa.spec.ts` alongside the legacy file
2. Validate one pair as a tracer bullet
3. Run the full pair validator (normalized title comparison)
4. Only then delete the legacy spec

**Why:** During the AAA migration (phases 5a-5e), migrated specs could pass in isolation yet diverge from legacy on timing, seed assumptions, or behavioral coverage. Dual-pair validation caught 4 divergences that single-spec green would have missed.

**How to apply:** Any future test framework migration, test runner switch, or large-scale test refactor. Also applies when migrating between assertion libraries or test utilities.
