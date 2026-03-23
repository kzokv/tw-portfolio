# Execution Queue Alignment

## Context

Linear currently has two planning artifacts for the `tw-porfolio` project:

- `Taiwan Investment Bookkeeping MVP PRD and Backlog Strategy`
- `Execution Queue and Session Pickup Order`

The newer execution-queue document is the practical source of truth for pickup order and wave sequencing.

## Durable Takeaways

- Treat the Linear execution queue as the live authority for session pickup and ranked implementation order.
- Treat the older PRD/backlog strategy as product scope context, not the latest execution order.
- The current queue intentionally prioritizes canonical write paths before broader read-model and UI expansion.
- `KZO-16` is an umbrella/coordinating ticket, not the next implementation pickup.
- Do not hard-code issue-by-issue pickup order in durable repo notes; that state ages quickly and belongs in Linear or `.worklog`.

## Why This Matters

The PRD/backlog document still presents an earlier wave order where core read APIs appear before core write paths. The execution queue supersedes that ordering and aligns better with the repository's cutover direction:

- canonical facts first
- deterministic disposal and lot traceability next
- correctness gates before broader surface expansion
- read models and workflow contracts after canonical writes stabilize
- UI work after backend contracts are trustworthy

This avoids building user-facing workflow on top of legacy accounting seams.

## Suggested Follow-up

When the next planning pass happens, keep ranked pickup order in Linear rather than duplicating issue-by-issue queue state in repository markdown. Use repository notes for durable sequencing rules and compatibility caveats, not for naming the next ticket.
