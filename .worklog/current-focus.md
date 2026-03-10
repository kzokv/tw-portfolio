# Current Focus

## Active goal
- Start `KZO-34` now that `KZO-54` is validated on the managed Postgres integration path and landed on `dev`.

## Constraints
- Follow the Linear execution queue rather than stale local pickup text when they diverge.
- Do not pull Wave 3 or Wave 4 work forward until Wave 2 canonical write-path contracts and quality gates are in place.
- Preserve lot-capable inventory and deterministic disposal behavior even though Taiwan MVP reporting stays weighted-average.
- Keep booked commission and tax as immutable posted facts once a trade is recorded.
- Expect transitional legacy seams in Postgres loading, transaction mirrors, and recompute routes until canonical cutover work is completed.

## Immediate next check
- Move `KZO-34` onto the normalized dividend schema so persistence loads and saves typed dividend deductions with explicit `currencyCode = 'TWD'`, then keep `KZO-36` sequenced behind it and `KZO-55` tracked in backlog for later currency normalization.
