# Open Questions

## Outstanding questions
- Should `KZO-52` preserve a temporary realized-P&L fallback for historical migrated Postgres rows that lack `lot_allocations`, or can those rows be treated as disposable scaffolding?
- When should recompute-era endpoints be frozen or retired relative to `KZO-50`, `KZO-52`, and `KZO-49`?
- Should any remaining legacy trade mirror fields continue to be populated once canonical sell realized P&L derivation is complete?
- When `KZO-36` books stock dividend inventory effects, should it create a dedicated non-cash position event immediately, or wait for the later holdings cutover path?
- Should `KZO-36` expose deduction summary totals directly, or leave them as projections above typed deduction rows?

## Needed context
- Inspect `apps/api/src/persistence/postgres.ts` and the `KZO-52` issue scope to pin down the realized P&L cutover boundary.
- Inspect recompute routes and their interaction with booked commission/tax facts to decide whether compatibility behavior is still acceptable during Wave 2.
- Inspect the canonical accounting and migration strategy docs, then resolve whether reversal-only correction is already strict enough for Wave 2 consumers.
- Inspect `docs/kzo-33-dividend-lifecycle.md`, `apps/api/src/persistence/postgres.ts`, and the `KZO-36` issue scope to pin down the stock-dividend booking path and whether deduction summaries belong in the write path or only in projections.
