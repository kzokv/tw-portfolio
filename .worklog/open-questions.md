# Open Questions

## Outstanding questions
- What is the intended temporary behavior of `/portfolio/transactions` while realized sell P&L still depends on legacy mirrored fields?
- When should recompute-era endpoints be frozen or retired relative to `KZO-24`, `KZO-52`, and `KZO-49`?
- What correction contract should downstream reconciliation and import work assume before `KZO-51` is implemented?

## Needed context
- Inspect `apps/api/src/persistence/postgres.ts` and the `KZO-52` issue scope to pin down the realized P&L cutover boundary.
- Inspect `apps/api/src/routes/registerRoutes.ts` and the migration/cutover docs to decide whether recompute remains a temporary compatibility path.
- Inspect the canonical accounting and migration strategy docs, then resolve whether reversal-only correction is already strict enough for Wave 2 consumers.
