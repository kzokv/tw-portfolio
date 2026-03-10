# Current Focus

## Active goal
- Execute `KZO-54` so the dividend schema matches the locked `KZO-33` lifecycle contract before `KZO-34` and `KZO-36` expand implementation scope.

## Constraints
- Follow the Linear execution queue rather than stale local pickup text when they diverge.
- Do not pull Wave 3 or Wave 4 work forward until Wave 2 canonical write-path contracts and quality gates are in place.
- Preserve lot-capable inventory and deterministic disposal behavior even though Taiwan MVP reporting stays weighted-average.
- Keep booked commission and tax as immutable posted facts once a trade is recorded.
- Expect transitional legacy seams in Postgres loading, transaction mirrors, and recompute routes until canonical cutover work is completed.

## Immediate next check
- Implement the `KZO-54` migration and schema tests, then move `KZO-34` onto typed dividend deductions with explicit `currencyCode = 'TWD'` and keep `KZO-55` tracked in backlog for later currency normalization.
