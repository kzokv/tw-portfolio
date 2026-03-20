# Current Focus

## Active goal
- Keep Wave 2 backend pickup aligned with the live Linear queue after `KZO-59` moved to review.

## Constraints
- Follow the Linear execution queue rather than stale local pickup text when they diverge.
- Do not pull Wave 3 or Wave 4 work forward until Wave 2 canonical write-path contracts and quality gates are in place.
- Preserve lot-capable inventory and deterministic disposal behavior even though Taiwan MVP reporting stays weighted-average.
- Keep booked commission and tax as immutable posted facts once a trade is recorded.
- Expect transitional legacy seams in Postgres loading, transaction mirrors, and recompute routes until canonical cutover work is completed.

## Immediate next check
- Use Linear as the source of truth for the next ranked Wave 2 pickup after `KZO-59` review feedback lands.
- Prefer follow-up work that closes remaining canonical accounting seams rather than pulling broader UI or later-wave scope forward.
