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

## Adding a new export to a `vi.mock`-ed service module: Implementer audits the mock factory

Adding a new export (`fetchAccounts`) to a service module (`apps/web/features/cash-ledger/services/cashLedgerService.ts`) and importing it from a component breaks every existing test that `vi.mock(...)`-s that module. The mock factory must explicitly enumerate every export the consumer reads — Vitest does NOT pass missing exports through. Symptom: `[vitest] No "fetchAccounts" export is defined on the mock`. The failure attributes to the test file but the trigger is the source-side export.

This is **implementation-coupled** under the rule above — Implementer owns the fix. The fix is one line per mock factory:

```ts
vi.mock("../../../features/cash-ledger/services/cashLedgerService", () => ({
  fetchCashLedgerEntries: vi.fn(...),
  fetchAccounts: vi.fn().mockResolvedValue([]),  // ← add when source gains the export
}));
```

**Audit step (mandatory whenever a service module gains a new export):**

```bash
# Find every test file that mocks the module — each needs the new export added
grep -rn "vi\.mock.*<module-path>" apps/web/test apps/api/test
```

Each match is a 1-line edit by the Implementer in the same PR. QA does not own this — these are pre-existing tests that need to keep compiling/passing through a source-side change.

**Why:** KZO-167 iter 1 — adding `fetchAccounts` to `cashLedgerService.ts` broke 9 tests in `CashLedgerClient.test.tsx`. The 9 failures looked like a QA test-fixture bug at first triage; the Architect correctly routed it to the Implementer per this rule, but only after spending a triage cycle.

**How to apply:** Whenever an Implementer adds a new export to a module that any test file mocks, run the grep above and patch every mock factory in the same diff. Companion check belongs in the Code Reviewer's checklist for any PR that adds an export to a service-layer module under `apps/web/features/*/services/` or `apps/api/src/services/`.
