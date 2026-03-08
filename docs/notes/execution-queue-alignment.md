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
- `KZO-24` was the current pickup and has now been implemented as the first dedicated posted-trade persistence slice.
- After `KZO-24`, the next ranked follow-up in the queue is `KZO-46`.

## Why This Matters

The PRD/backlog document still presents an earlier wave order where core read APIs appear before core write paths. The execution queue supersedes that ordering and aligns better with the repository's cutover direction:

- canonical facts first
- deterministic disposal and lot traceability next
- correctness gates before broader surface expansion
- read models and workflow contracts after canonical writes stabilize
- UI work after backend contracts are trustworthy

This avoids building user-facing workflow on top of legacy accounting seams.

## Repo-State Notes

The repository now reflects a larger portion of this cutover:

- canonical schema exists for `trade_events`, `cash_ledger_entries`, dividend entities, reconciliation, snapshots, and `lot_allocations`
- booking sequence and lot-allocation persistence have migration support
- `POST /portfolio/transactions` now persists through a dedicated `savePostedTrade` path
- Postgres-backed tests now cover canonical posted-buy and posted-sell persistence at the persistence seam

Important transitional seams still exist:

- the legacy `transactions` table is still written as a temporary compatibility mirror
- legacy recompute endpoints still exist in the API surface
- full legacy realized-P&L compatibility cleanup remains follow-on work

These seams keep `KZO-46`, `KZO-52`, `KZO-51`, `KZO-26`, and `KZO-38` as the highest-leverage path after `KZO-24`.

## Suggested Follow-up

When the next planning pass happens, keep ranked pickup order in Linear rather than duplicating issue-by-issue queue state in repository markdown. If `KZO-24` is accepted without re-planning, the next implementation pickup should be `KZO-46`.
