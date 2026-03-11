# Current Focus

## Active goal
- Keep Wave 2 backend pickup aligned with the live Linear queue, with immediate attention on clarifying the remaining implementation scope behind `KZO-51`.

## Constraints
- Follow the Linear execution queue rather than stale local pickup text when they diverge.
- Do not pull Wave 3 or Wave 4 work forward until Wave 2 canonical write-path contracts and quality gates are in place.
- Preserve lot-capable inventory and deterministic disposal behavior even though Taiwan MVP reporting stays weighted-average.
- Keep booked commission and tax as immutable posted facts once a trade is recorded.
- Expect transitional legacy seams in Postgres loading, transaction mirrors, and recompute routes until canonical cutover work is completed.

## Immediate next check
- Confirm whether `KZO-51` should stay as a definition ticket plus follow-on implementation work, then choose the next ranked Wave 2 ticket from Linear rather than stale local pickup notes. Keep `KZO-55` backlog-only unless the queue explicitly pulls currency normalization forward.
