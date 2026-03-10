# Latest Handoff

## Completed
- Implemented the repo-side `KZO-54` changes: append-only dividend schema alignment migration, migration tests, and doc updates.
- Added `KZO-55` to track broader currency normalization work as explicit backlog rather than hidden debt.
- Locked the execution direction to typed dividend deductions with explicit `currencyCode = 'TWD'` for the Taiwan MVP Wave 2 path.
- Updated repo docs and worklog focus so the Wave 2 dividend chain now runs `KZO-54 -> KZO-34 -> KZO-36`.

## Decisions
- `DividendEvent` is issuer/reference data only; it is symbol-scoped and does not move account cash by itself.
- `DividendLedgerEntry` is the account-level record for expected and actual dividend values, including `eligibleQuantity` and lifecycle state, but deduction detail now lives in typed child rows.
- `CashLedgerEntry` represents only actual dividend cash effects and must link back to the dividend ledger entry for `DIVIDEND_RECEIPT` and `DIVIDEND_DEDUCTION`.
- For MVP, `eligibleQuantity` means the carry-in position at the start of `exDividendDate`.
- The only allowed in-place lifecycle transition is `expected -> posted`; once a dividend row reaches `posted` or `adjusted`, its monetary and quantity fields are immutable.
- Corrections after posting use reversal plus replacement, not silent overwrite.
- Pre-production schema work may directly remove the legacy dividend deduction summary columns.
- Wave 2 dividend work remains TWD-scoped, but typed deduction rows must persist explicit `currencyCode = 'TWD'` so later normalization stays additive.
- Global currency normalization remains important, but it is tracked separately in `KZO-55` and does not block `KZO-54`, `KZO-34`, or `KZO-36`.

## Next steps
- Validate `KZO-54` under the managed Postgres integration environment and land the repo-side schema alignment changes.
- Move `KZO-34` onto the normalized dividend schema so persistence loads and saves typed deduction rows.
- Implement `KZO-36` posting behavior against the normalized schema, including expected-vs-actual comparison and linked cash-ledger effects.
- Keep `KZO-55` in backlog for later currency normalization across schema, types, settings, and UI labels.

## Risks or blockers
- `KZO-54` is implemented in the workspace, but it still needs managed Postgres validation and merge before `KZO-34` and `KZO-36` can rely on it as landed schema.
- The live API and in-memory model still expose the older account-scoped `CorporateAction` dividend path, so implementation work can drift back to that shortcut if `KZO-34` and `KZO-36` do not follow the new contract closely.
- Full currency normalization still spans schema, types, settings, and UI; `KZO-55` must remain visible so the explicit TWD hook does not become permanent accidental design.

## Open questions
- Should `KZO-34` expose read-side summary totals for deductions directly, or leave all summaries as projections above the typed child rows?
- When `KZO-36` drives stock dividend inventory effects, should it book through a dedicated non-cash position event immediately, or only through the later holdings cutover path?

## Relevant files
- `AGENTS.md`
- `.worklog/current-focus.md`
- `.worklog/open-questions.md`
- `docs/kzo-33-dividend-lifecycle.md`
- `docs/kzo-11-implementation-split.md`
- `docs/canonical-accounting-model.md`
- `db/migrations/003_accounting_core_schema.sql`
- `db/migrations/006_dividend_schema_alignment.sql`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
