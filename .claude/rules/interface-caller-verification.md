# Interface Caller Verification

When designing persistence interfaces or service layer interfaces with many methods upfront, verify all methods have callers before shipping.

```bash
# Before submitting a PR that introduces or extends an interface:
grep -r "methodName" --include="*.ts" .
```

**Why:** KZO-114 code review caught an unused `updateTradeEventDerivedFields` method on the persistence interface. It was designed for separate fee updates but the PATCH route inlined fees into `updateTradeEvent`. Dead interface methods create maintenance burden and confusion about intended data flow.

**How to apply:** Before submitting a PR that introduces or extends a persistence/service interface, grep for all method names and verify each has at least one caller outside the interface definition. This complements the `process-refactor-rename-verification` rule (which covers renames of existing methods).

## Adding a required field to a `*Deps` factory — audit `as never` / `as unknown as` casts

When adding a required field to `BackfillWorkerDeps` (or any `*Deps` type), TypeScript casts like `as never` or `as unknown as BackfillWorkerDeps` in test factories silently suppress the missing-property error at compile time. The bug only surfaces at runtime when the handler calls the injected function and finds `undefined`.

**Audit recipe (mandatory before Phase 3):**

```bash
# Find every test that constructs the deps type with a suppressing cast
grep -rln "as never\|as unknown as BackfillWorkerDeps" apps/api/test/
# Each match must have the new field added explicitly
```

For each file returned: open it, find the `createDeps()` / `createAuDeps()` (or equivalent) factory, and add the new field with a `vi.fn().mockResolvedValue(...)` stub matching the field's return type.

**Why:** KZO-189 iter 1 — adding `getEffectiveMetadataEnrichmentMode` to `BackfillWorkerDeps` passed `tsc --noEmit` cleanly (test factories used `as never` / `as unknown as` casts). Five integration test factories across 3 files were silently missing the field; all 5 failed at runtime with `TypeError: deps.getEffectiveMetadataEnrichmentMode is not a function`. Routed to the Implementer as impl-coupled; fixed in Phase 4. Cost one full convergence iteration.

**How to apply:** Any time a new required method or field is added to a `*Deps` type (or any interface that tests construct via cast). Run the grep above before Phase 3 begins — finding these in Phase 4 costs a full validation cycle.
