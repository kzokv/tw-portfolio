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
- With no issue in `In Progress` and only `KZO-24` in `Todo`, the next pickup is currently `KZO-24`.

## Why This Matters

The PRD/backlog document still presents an earlier wave order where core read APIs appear before core write paths. The execution queue supersedes that ordering and aligns better with the repository's cutover direction:

- canonical facts first
- deterministic disposal and lot traceability next
- correctness gates before broader surface expansion
- read models and workflow contracts after canonical writes stabilize
- UI work after backend contracts are trustworthy

This avoids building user-facing workflow on top of legacy accounting seams.

## Repo-State Notes

The repository already reflects part of this cutover:

- canonical schema exists for `trade_events`, `cash_ledger_entries`, dividend entities, reconciliation, snapshots, and `lot_allocations`
- booking sequence and lot-allocation persistence have migration support

Important transitional seams still exist:

- Postgres loading still reads legacy `transactions.realized_pnl_ntd`
- legacy recompute endpoints still exist in the API surface

These seams make `KZO-24`, `KZO-46`, `KZO-52`, `KZO-51`, `KZO-26`, and `KZO-38` the highest-leverage path to complete the cutover.

## Suggested Follow-up

When the next planning pass happens, update any repo roadmap doc that still implies read-model work should lead write-path cutover. Keep ranked pickup order in Linear rather than duplicating issue-by-issue queue state in repository markdown.
