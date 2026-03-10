# Latest Handoff

## Completed
- Implemented `KZO-34` in the API store and Postgres persistence layers.
- Added first-class `DividendEvent`, `DividendLedgerEntry`, and `DividendDeductionEntry` shapes to the accounting store contract.
- Wired Postgres load/save for normalized dividend events, ledger rows, typed deductions, and linked dividend cash entries.
- Added persistence invariants for the active dividend-row rule and explicit `currencyCode = 'TWD'` deduction enforcement.
- Added integration coverage for dividend persistence round-trips and duplicate active-ledger rejection.
- Opened PR `#45` for `KZO-34`: `feat(api): KZO-34: implement dividend event and ledger persistence`.
- Verified `KZO-34` with `npm run build -w @tw-portfolio/api` and `npm run test:integration:ci:host` on March 10, 2026.

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
- Postgres-backed `DATE` fields must be normalized with local calendar components rather than `toISOString().slice(0, 10)` to avoid off-by-one-day shifts on non-UTC hosts.

## Next steps
- Implement `KZO-36` posting behavior against the normalized schema, including expected-vs-actual comparison and linked cash-ledger effects.
- Decide whether `KZO-36` should expose deduction summary totals directly in its write/read path or keep summaries fully projected above typed rows.
- Keep `KZO-55` in backlog for later currency normalization across schema, types, settings, and UI labels.

## Risks or blockers
- The live API still exposes the older account-scoped `CorporateAction` dividend path, so `KZO-36` must avoid drifting back to that shortcut now that persistence is aligned.
- Full currency normalization still spans schema, types, settings, and UI; `KZO-55` must remain visible so the explicit TWD hook does not become permanent accidental design.

## Open questions
- When `KZO-36` drives stock dividend inventory effects, should it book through a dedicated non-cash position event immediately, or only through the later holdings cutover path?
- Should `KZO-36` expose read-side deduction summary totals directly, or leave all summaries as projections above the typed child rows?

## Relevant files
- `AGENTS.md`
- `.worklog/current-focus.md`
- `.worklog/open-questions.md`
- `apps/api/src/types/store.ts`
- `apps/api/src/services/store.ts`
- `apps/api/src/services/accountingStore.ts`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
