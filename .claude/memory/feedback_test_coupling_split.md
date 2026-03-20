---
name: feedback_test_coupling_split
description: Task descriptions must distinguish implementation-coupled tests (implementer owns) from behavioral tests (QA owns)
type: feedback
---

When writing task descriptions for an Implementer + QA split, explicitly distinguish two categories of test changes:

- **Implementation-coupled tests** — existing unit/integration tests that break due to source code changes (type changes, import renames, API shape changes). The Implementer owns these because they must change together with source code for TypeScript compilation or basic correctness.
- **Behavioral tests** — new E2E tests, new assertions, new test files. QA owns these.

**Why:** In KZO-74, the Implementer updated `getSession.test.ts`, `auth-oauth.integration.test.ts`, and `login.test.tsx` alongside implementation, even though the task said "Do NOT touch test files". The test updates were necessary for TypeScript compilation. This created confusion about ownership and potential duplicate work with QA. The blanket "don't touch tests" instruction was wrong in context.

**How to apply:**
- Implementer task: "You may update existing unit/integration tests that break due to your source code changes. Do NOT write new test files or new E2E assertions."
- QA task: "Write new E2E tests and new behavioral assertions. Check what the implementer already changed before duplicating work."
- The line is: existing test compiles/passes → implementer; new test behavior/coverage → QA
