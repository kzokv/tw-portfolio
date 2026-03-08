# Latest Handoff

## Completed
- Verified the execution queue and picked up `KZO-24` as the active ticket.
- Implemented a dedicated `savePostedTrade` persistence path and wired `POST /portfolio/transactions` to use it instead of the broad `saveAccountingStore` rewrite path.
- Updated Postgres loading to derive sell `realizedPnlNtd` from canonical `lot_allocations` when available, removing canonical read dependence on `transactions.realized_pnl_ntd` for the covered path.
- Added Postgres integration coverage for canonical posted-buy persistence and posted-sell persistence with reloadable holdings and realized P&L.
- Opened PR `#38` (`feat(api): add KZO-24 posted trade persistence path`) from `feat/kzo-24-posted-trade-persistence` into `dev`.

## Decisions
- Treat the Linear `Execution Queue and Session Pickup Order` document as the live source of truth for pickup order.
- Treat the older PRD/backlog strategy as product-scope context, not the latest execution sequence.
- Keep write-path cutover ahead of read-model and UI expansion.
- Keep the legacy `transactions` table as a temporary compatibility mirror for now, but treat canonical trade facts and linked cash facts as the authoritative posted-trade path.
- Keep new Postgres coverage at the persistence seam for `KZO-24`; broad route-level Postgres app harness changes are separate work.

## Next steps
- Monitor PR `#38` checks and address any CI failures on `feat/kzo-24-posted-trade-persistence`.
- If the PR lands cleanly, move to the next ranked ticket in the execution queue unless `KZO-24` review feedback changes the cutover boundary.
- Follow up in `KZO-52` if the team decides to remove the legacy realized-P&L compatibility mirror entirely.

## Risks or blockers
- Legacy recompute endpoints still exist and may conflict with the intended immutable accounting direction.
- Correction semantics are still a contract gap before reconciliation/import work can safely expand.
- The legacy `transactions` mirror is still written during posted-trade persistence, so full legacy table retirement remains follow-on work.

## Open questions
- Should `KZO-52` preserve a temporary realized-P&L fallback for historical migrated Postgres data that lacks `lot_allocations`, or can all pre-cutover data be treated as disposable scaffolding?
- Should recompute endpoints be frozen during Wave 2 or maintained temporarily as compatibility shims?
- What read-model freshness or replay guarantees need to be documented once canonical write paths become authoritative?

## Relevant files
- `AGENTS.md`
- `.worklog/current-focus.md`
- `.worklog/open-questions.md`
- `docs/notes/execution-queue-alignment.md`
- `docs/kzo-14-migration-strategy.md`
- `docs/kzo-11-implementation-split.md`
- `apps/api/src/routes/registerRoutes.ts`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
