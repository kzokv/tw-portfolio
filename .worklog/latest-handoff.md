# Latest Handoff

## Completed
- Implemented the repo-side `KZO-36` slice on top of the merged `KZO-34` dividend persistence contract.
- Added dividend declaration and posting routes so the API now persists expected-vs-actual dividend values, typed deductions with explicit `currencyCode = 'TWD'`, and linked `CashLedgerEntry` rows for `DIVIDEND_RECEIPT` and `DIVIDEND_DEDUCTION`.
- Added a Postgres `savePostedDividend` path plus managed integration coverage for posted-dividend persistence and stock-dividend holdings effects.
- Validated the dividend implementation with `npm run build -w @tw-portfolio/api`, focused API integration coverage, and `npm run test:integration:ci:host` on March 10, 2026.
- Added a small `KZO-51` guardrail in the current worktree so posted dividend ledger rows cannot be overwritten in place by reusing the same id.

## Decisions
- `DividendEvent` is issuer/reference data only; it is symbol-scoped and does not move account cash by itself.
- `DividendLedgerEntry` is the account-level record for expected and actual dividend values, including `eligibleQuantity` and lifecycle state.
- Typed `DividendDeductionEntry` rows remain first-class top-level accounting facts in the store contract; `KZO-36` writes against that merged `KZO-34` model rather than redefining the base shape.
- `CashLedgerEntry` represents only actual dividend cash effects and must link back to the dividend ledger entry for `DIVIDEND_RECEIPT` and `DIVIDEND_DEDUCTION`.
- For MVP, `eligibleQuantity` means the carry-in position at the start of `exDividendDate`.
- The only allowed in-place lifecycle transition is `expected -> posted`; once a dividend row reaches `posted` or `adjusted`, its monetary and quantity fields are immutable.
- Corrections after posting use reversal plus replacement, not silent overwrite.
- Wave 2 dividend work remains TWD-scoped, but typed deduction rows must persist explicit `currencyCode = 'TWD'` so later normalization stays additive.
- The temporary stock-dividend bridge is documented in `docs/kzo-33-dividend-lifecycle.md`.
- The Postgres `DATE` normalization gotcha is documented in `docs/notes/postgres-date-normalization.md`.
- Global currency normalization remains important, but it is tracked separately in `KZO-55` and does not block the current Wave 2 dividend delivery.

## Next steps
- Decide whether the remaining `KZO-51` gap should stay under the existing ticket or be split into a dedicated correction-write-path implementation ticket.
- Decide the next ranked Wave 2 pickup from the live Linear execution queue rather than stale local notes.
- Keep `KZO-55` in backlog for later currency normalization across schema, types, settings, and UI labels.

## Risks or blockers
- The legacy `POST /corporate-actions` dividend path still exists alongside the new first-class dividend routes, so clients could continue writing dividend-like data through the older shortcut unless that endpoint is constrained or retired.
- Full currency normalization still spans schema, types, settings, and UI; `KZO-55` must remain visible so the explicit TWD hook does not become permanent accidental design.
- Dividend correction flow is still incomplete: reversal plus supersession behavior is documented, but no dedicated API path exists yet for posted-dividend adjustments.

## Open questions
- See `.worklog/open-questions.md`.

## Relevant files
- `AGENTS.md`
- `.worklog/current-focus.md`
- `.worklog/open-questions.md`
- `apps/api/src/services/dividends.ts`
- `apps/api/src/routes/registerRoutes.ts`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/src/types/store.ts`
- `apps/api/test/integration/dividends.integration.test.ts`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
- `docs/kzo-33-dividend-lifecycle.md`
- `docs/notes/postgres-date-normalization.md`
