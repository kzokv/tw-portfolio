# Current Focus

## Active goal
- Finish `KZO-33` as the dividend lifecycle/spec gate and hand the locked contract to `KZO-34` and `KZO-36`.

## Constraints
- Follow the Linear execution queue rather than stale local pickup text when they diverge.
- Do not pull Wave 3 or Wave 4 work forward until Wave 2 canonical write-path contracts and quality gates are in place.
- Preserve lot-capable inventory and deterministic disposal behavior even though Taiwan MVP reporting stays weighted-average.
- Keep booked commission and tax as immutable posted facts once a trade is recorded.
- Expect transitional legacy seams in Postgres loading, transaction mirrors, and recompute routes until canonical cutover work is completed.

## Immediate next check
- Verify that downstream dividend implementation work uses `docs/kzo-33-dividend-lifecycle.md` as the contract, then apply the active-record and state-transition invariants in `KZO-34`/`KZO-36` instead of re-deciding lifecycle semantics in code.
