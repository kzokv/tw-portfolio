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

## Audit constructed objects inside `as never`-cast registries, not just the registry parameter

The `*Deps`-cast pattern above generalizes to ANY interface implemented at a test-mock construction site — including catalog providers, market-data providers, and other `*Provider` implementations stored in a registry-like map that itself is `as never`-cast. TypeScript stops checking the constructed objects' shapes once the *outer* container is cast away, so a missing required readonly field on the inner provider object produces no compile-time error.

```ts
// ❌ Wrong — `supportsMetadataEnrichment` missing on each provider, but TS is silent
const catalogRegistry = {
  TW: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn() },
  US: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn() },
} as never;

// ✅ Correct — each constructed provider object satisfies the full interface
const catalogRegistry = {
  TW: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn(), supportsMetadataEnrichment: false },
  US: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn(), supportsMetadataEnrichment: false },
} as never;
```

**Audit recipe extension** — when adding a required readonly field to a `*Provider`-class interface, the grep covers BOTH the registry parameter cast and the inline objects:

```bash
# Cover both *Deps-style and *Provider-style cast sites
grep -rln "as never\|as unknown as InstrumentCatalogProvider\|as InstrumentCatalogProvider" apps/api/test/
# For each match: inspect both the cast itself AND every object literal stored inside the cast container.
```

**Default rule:** declare the new field on every mock-provider object literal, even when the handler under test doesn't read it at runtime. The next reader of the file shouldn't have to recompute "was this an oversight or intentional?" — the interface contract is the source of truth.

**Distinguishing safe vs unsafe casts:** `as unknown as InstrumentCatalogProvider` applied to a *real class instance* (e.g. `new MockYahooFinanceAuMarketDataProvider(...) as unknown as InstrumentCatalogProvider`) is safe — the class already implements the full interface, the cast only narrows for parameter-type satisfaction. The unsafe pattern is `as never` / `as unknown as` applied to *inline object literals* inside a registry — those bypass shape checking entirely.

**Why:** KZO-190 — adding `readonly supportsMetadataEnrichment: boolean` to `InstrumentCatalogProvider` passed `tsc --noEmit` cleanly. The Implementer's Step 7 audit caught 2 of 7 candidate files (`backfill-handler-branching.test.ts` had a typed factory; AU/US integration tests used safe class-instance casts). Code Reviewer caught the remaining 2 (`catalog-sync-worker.test.ts:20-24`, `catalogSyncReschedule.test.ts:33-38`) — both used `as never`-cast registries with inline object-literal providers that silently dropped the new field. No runtime failure (catalog-sync paths don't read the field) but interface contract was incomplete. Cost a Phase 4 cycle.

**How to apply:** Whenever a required field is added to any interface that test files implement via inline object literals stored in `as never` / `as unknown as <Container>` casts. The audit must inspect *what's inside the cast*, not just the cast itself.
