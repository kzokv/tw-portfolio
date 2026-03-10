# Latest Handoff

## Completed
- Implemented the repo-side lifecycle/spec gate for `KZO-33`.
- Added `docs/kzo-33-dividend-lifecycle.md` as the explicit contract for dividend declaration, expected entitlement, posting, deductions, reconciliation, and reversal-based correction.
- Updated `docs/kzo-11-implementation-split.md` so Batch 6 now explicitly includes `KZO-33` as the gating lifecycle step ahead of `KZO-34` and `KZO-36`.
- Reconciled Linear with the verified repo state by moving `KZO-33` to `In Progress` and leaving a summary comment on the issue.

## Decisions
- `DividendEvent` is issuer/reference data only; it is symbol-scoped and does not move account cash by itself.
- `DividendLedgerEntry` is the account-level record for expected and actual dividend values, including `eligibleQuantity`, deductions, and lifecycle state.
- `CashLedgerEntry` represents only actual dividend cash effects and must link back to the dividend ledger entry for `DIVIDEND_RECEIPT` and `DIVIDEND_DEDUCTION`.
- For MVP, `eligibleQuantity` means the carry-in position at the start of `exDividendDate`.
- The only allowed in-place lifecycle transition is `expected -> posted`; once a dividend row reaches `posted`, `adjusted`, or `reconciled`, its monetary and quantity fields are immutable.
- Corrections after posting use reversal plus replacement, not silent overwrite.

## Next steps
- Use the `KZO-33` contract to implement `KZO-34` persistence invariants for `DividendEvent` and `DividendLedgerEntry`.
- Define store or persistence enforcement for the active-record rule: at most one non-reversed active dividend ledger entry per `(accountId, dividendEventId)`.
- Implement `KZO-36` posting behavior against the new contract, including expected-vs-actual comparison and linked cash-ledger effects.
- Decide whether `KZO-33` should move to `In Review` once the doc wording is accepted, or remain `In Progress` until downstream invariant enforcement scope is explicitly split into `KZO-34` and `KZO-36`.

## Risks or blockers
- The canonical schema already has dividend tables and enums, but it still does not encode the full active-record predicate directly; downstream enforcement must live in store or persistence invariants first.
- The live API and in-memory model still expose the older account-scoped `CorporateAction` dividend path, so implementation work can drift back to that shortcut if `KZO-34` and `KZO-36` do not follow the new contract closely.
- No tests were run in this session because the delivered work was documentation and workflow alignment only.

## Open questions
- Should `KZO-33` be considered complete with the repo-side contract and Linear note, or should it stay open until the state-transition and active-record invariants are partially enforced in code?
- Should `KZO-34` enforce the active-record rule in store validation only, or also add a dedicated Postgres uniqueness strategy for active dividend rows?
- When `KZO-36` derives expected values during posting, should it persist a placeholder `expected` row ahead of time when one does not yet exist, or materialize the expectation and posting atomically on the same row?

## Relevant files
- `AGENTS.md`
- `.worklog/current-focus.md`
- `.worklog/open-questions.md`
- `docs/kzo-33-dividend-lifecycle.md`
- `docs/kzo-11-implementation-split.md`
- `docs/canonical-accounting-model.md`
- `db/migrations/003_accounting_core_schema.sql`
- `apps/api/src/types/store.ts`
- `apps/api/src/routes/registerRoutes.ts`
- `apps/api/src/services/portfolio.ts`
- `apps/api/src/persistence/postgres.ts`
