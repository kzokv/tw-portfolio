# Latest Handoff

## Completed
- Implemented the remaining persistence contract work for `KZO-46` after `KZO-52`.
- Added `db/migrations/005_booking_order_uniqueness.sql` so persisted booking order and opened-lot order are unique at the database layer.
- Tightened `validateAccountingStoreInvariants` to reject duplicate `(account_id, trade_date, booking_sequence)` and duplicate `(account_id, symbol, opened_at, opened_sequence)` combinations before save.
- Extended Postgres integration coverage to assert the new unique indexes and rejection paths for duplicate booking/opened sequence data.
- Verified with `npm run test -w apps/api -- portfolio.integration.test.ts`, `npm run build -w @tw-portfolio/api`, and `npm run test:integration:ci:host`.

## Decisions
- Treat explicit same-day booking order and lot-opened order as canonical persisted invariants, not just in-memory conventions.
- Enforce deterministic replay at both layers: store invariant validation rejects duplicates before save, and Postgres unique indexes backstop concurrent or malformed writes.
- Keep weighted-average Taiwan reporting on top of the lot-capable substrate; this change hardens the substrate rather than altering disposal math.

## Next steps
- Pick up `KZO-33` as the next ranked Wave 2 ticket; it is now the explicit `Todo` item because it gates the downstream dividend implementation work.
- Keep `KZO-36` and `KZO-34` in `Backlog` with `needs-refinement` until the dividend lifecycle/spec gate is nailed down.
- Decide whether the legacy `transactions` mirror should keep being rewritten during Wave 2 or be frozen/retired once downstream compatibility needs are confirmed.
- Decide whether recompute endpoints remain temporary compatibility shims or should be frozen as canonical write-path contracts solidify.

## Risks or blockers
- The legacy `transactions` table is still written, so the dual-write seam remains even though canonical booking order is now enforced more strictly.
- Existing data must migrate cleanly into the new unique indexes; the current test path starts from fresh schemas and does not validate production duplicate cleanup.

## Open questions
- Should the `trade_events` replay contract treat `booking_sequence` as the sole authoritative same-day order, or should `trade_timestamp` become the primary sort key with `booking_sequence` only as a tie-breaker?
- Is `Todo` intended to hold only the single next pickup, or a short list of execution-ready tickets for near-term batching?
- Should any remaining legacy mirror fields continue to be populated once downstream readers are confirmed off the compatibility table?
- When should recompute-era endpoints be frozen or retired relative to the remaining Wave 2 work?

## Relevant files
- `AGENTS.md`
- `.worklog/current-focus.md`
- `.worklog/open-questions.md`
- `db/migrations/005_booking_order_uniqueness.sql`
- `apps/api/src/services/accountingStore.ts`
- `apps/api/src/services/portfolio.ts`
- `apps/api/src/services/recompute.ts`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/test/integration/portfolio.integration.test.ts`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
