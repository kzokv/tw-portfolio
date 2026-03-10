# Current Focus

## Active goal
- Execute `KZO-52` as the next ranked pickup: derive sell `realizedPnlNtd` strictly from canonical trade facts plus disposal projections and reduce the remaining dependence on the legacy transaction mirror.

## Constraints
- Follow the Linear execution queue rather than stale local pickup text when they diverge.
- Do not pull Wave 3 or Wave 4 work forward until Wave 2 canonical write-path contracts and quality gates are in place.
- Preserve lot-capable inventory and deterministic disposal behavior even though Taiwan MVP reporting stays weighted-average.
- Keep booked commission and tax as immutable posted facts once a trade is recorded.
- Expect transitional legacy seams in Postgres loading and recompute routes until canonical cutover work is completed.

## Immediate next check
- Inspect `KZO-52` scope against `apps/api/src/persistence/postgres.ts`, the current canonical `lot_allocations` loading path, and the remaining `transactions.realized_pnl_ntd` compatibility reads before changing the read model.
