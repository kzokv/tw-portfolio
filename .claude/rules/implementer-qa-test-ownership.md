# Implementer vs QA Test Ownership

When splitting work between an Implementer and QA, task descriptions must explicitly distinguish two categories of test changes:

- **Implementation-coupled tests** (Implementer owns) — existing unit/integration tests that break due to source code changes (type changes, import renames, API shape changes). These must change together with source code for TypeScript compilation or basic correctness.
- **Behavioral tests** (QA owns) — new E2E tests, new assertions, new test files that verify feature behavior.

**Task description template:**
- Implementer: "You may update existing unit/integration tests that break due to your source code changes. Do NOT write new test files or new E2E assertions."
- QA: "Write new E2E tests and new behavioral assertions. Check what the implementer already changed before duplicating work."

**The line is:** existing test compiles/passes → Implementer; new test behavior/coverage → QA.

**Why:** In KZO-74, the Implementer updated test files alongside implementation even though the task said "Do NOT touch test files." The test updates were necessary for TypeScript compilation. The blanket "don't touch tests" instruction was wrong in context and created confusion about ownership.

**How to apply:** When writing `/team` task descriptions that involve both an Implementer and a QA role.
