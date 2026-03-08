# Latest Handoff

## Completed
- Reviewed the Linear project backlog, the execution-queue document, the PRD/backlog strategy, and the current repository cutover state.
- Verified that the execution queue is the current planning authority for pickup order and that `KZO-24` is the next implementation ticket.
- Identified that the repo already has canonical schema support but still carries legacy seams in Postgres trade loading and recompute endpoints.

## Decisions
- Treat the Linear `Execution Queue and Session Pickup Order` document as the live source of truth for pickup order.
- Treat the older PRD/backlog strategy as product-scope context, not the latest execution sequence.
- Keep write-path cutover ahead of read-model and UI expansion.

## Next steps
- Start `KZO-24` by tracing the POST `/portfolio/transactions` path through canonical persistence and identifying where legacy transaction mirrors are still required.
- Define the minimal cutover slice that keeps endpoint behavior stable while shifting authority to canonical trade and cash facts.
- Re-check how `KZO-46`, `KZO-52`, and `KZO-51` constrain the implementation boundary for realized P&L, ordering, and correction handling.

## Risks or blockers
- Postgres loading still reads legacy `transactions.realized_pnl_ntd`, so canonical trade facts are not yet the sole authority for realized sell P&L.
- Legacy recompute endpoints still exist and may conflict with the intended immutable accounting direction.
- Correction semantics are still a contract gap before reconciliation/import work can safely expand.

## Open questions
- What is the exact cutover boundary for `KZO-24` versus the follow-on `KZO-52` realized P&L cleanup?
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
