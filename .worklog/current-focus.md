# Current Focus

## Active goal
- Start `KZO-36` now that `KZO-34` is implemented, verified, and submitted for review in PR `#45`.

## Constraints
- Follow the Linear execution queue rather than stale local pickup text when they diverge.
- Do not pull Wave 3 or Wave 4 work forward until Wave 2 canonical write-path contracts and quality gates are in place.
- Preserve lot-capable inventory and deterministic disposal behavior even though Taiwan MVP reporting stays weighted-average.
- Keep booked commission and tax as immutable posted facts once a trade is recorded.
- Expect transitional legacy seams in Postgres loading, transaction mirrors, and recompute routes until canonical cutover work is completed.

## Immediate next check
- Implement the dividend posting path on top of the normalized persistence layer from `KZO-34`, including expected-vs-actual comparison, typed deductions, and linked cash-ledger effects, while keeping `KZO-55` as backlog-only currency follow-up.
