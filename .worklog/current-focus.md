# Current Focus

## Active goal
- Execute `KZO-33` as the next ranked Wave 2 pickup: define the dividend lifecycle and posting contract that gates the downstream dividend implementation tickets.

## Constraints
- Follow the Linear execution queue rather than stale local pickup text when they diverge.
- Do not pull Wave 3 or Wave 4 work forward until Wave 2 canonical write-path contracts and quality gates are in place.
- Preserve lot-capable inventory and deterministic disposal behavior even though Taiwan MVP reporting stays weighted-average.
- Keep booked commission and tax as immutable posted facts once a trade is recorded.
- Expect transitional legacy seams in Postgres loading, transaction mirrors, and recompute routes until canonical cutover work is completed.

## Immediate next check
- Inspect `KZO-33` against the existing dividend tables and canonical cash ledger model, then pin down event-vs-posting semantics, expected-vs-actual modeling, and deduction/status rules before promoting `KZO-36`.
