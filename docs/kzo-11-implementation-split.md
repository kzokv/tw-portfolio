# KZO-11 Implementation Split

## Purpose

This document translates the `KZO-11` canonical accounting model into the next implementation batches.

It is not a replacement for the Linear backlog. Its job is to make execution order and ownership boundaries explicit.

## Split Strategy

Execution should move in this order:

1. surface alignment
2. domain behavior
3. schema foundation
4. direct cutover contract
5. canonical store and persistence cutover
6. canonical write paths and lot traceability
7. gating correctness coverage
8. read models and reconciliation
9. cleanup and hardening

This order preserves forward progress while minimizing rework.

## Batch 1. Product Surface Alignment

Primary ticket:

- `KZO-12` Replace FIFO/LIFO with weighted average cost across product settings and shared types

Goal:

- align product-facing types, settings, defaults, and wording with the canonical model

Must not do:

- full domain cost-basis rewrite
- removal of lot-capable implementation support

Outputs:

- product settings contract updated
- user-facing copy aligned
- compatibility notes documented where internals are still transitional

## Batch 2. Domain Cost Basis Behavior

Primary ticket:

- `KZO-13` Refactor domain cost-basis calculations to weighted average

Goal:

- make holdings, remaining cost, and realized P&L align with weighted-average rules

Dependencies:

- `KZO-11`

Should use fixtures:

- Fixture A
- Fixture B
- Fixture C
- Fixture K

Outputs:

- weighted-average buy/sell behavior
- oversell validation preserved
- tests for odd lots and partial sells

## Batch 3. Schema Foundation

Primary ticket:

- `KZO-15` Add schema for cash ledger, dividend ledger, reconciliation, and daily snapshots

Goal:

- create the database foundation for the canonical accounting entities

Dependencies:

- `KZO-11`

Outputs:

- additive tables for new accounting entities
- keys and foreign keys aligned with canonical relationships
- enough schema foundation for direct cutover to canonical facts

## Batch 4. Direct Cutover Contract

Primary ticket:

- `KZO-14` Define direct cutover architecture and legacy deprecation plan for the accounting model

Goal:

- lock the direct-cutover direction before more execution tickets are expanded

Outputs:

- canonical facts are identified as the long-term source of truth
- lot-capable inventory is explicitly preserved
- weighted-average is positioned as a policy/view layer
- legacy scaffolding retirement assumptions are documented

## Batch 5. Store And Persistence Contract Refactor

Primary ticket:

- `KZO-16` Refactor API store and persistence contracts around accounting aggregates

Migration design reference:

- `docs/kzo-14-migration-strategy.md`

Goal:

- make canonical facts and projections the primary persistence model

Dependencies:

- `KZO-15`

Outputs:

- store types for trade, cash, dividend, reconciliation, snapshot aggregates
- clear write-model vs read-model boundaries
- load/save behavior aligned with canonical facts and lot-capable projections

## Batch 6. First Accounting Write Paths And Lot Traceability

Primary tickets:

- `KZO-33` Define dividend event and dividend posting lifecycle
- `KZO-24` Implement trade event write path with linked cash ledger generation
- `KZO-46` Add explicit booking sequence and lot allocation traceability for canonical trade disposal
- `KZO-54` Align dividend schema with lifecycle contract and normalize deduction modeling
- `KZO-34` Implement dividend event and dividend ledger persistence
- `KZO-36` Implement dividend posting API with received cash, stock, and deductions

Goal:

- move from canonical spec to first authoritative canonical writes

Dependencies:

- `KZO-15`
- `KZO-16`
- `KZO-51`

Outputs:

- posted trades produce explicit cash effects
- lot-capable inventory remains available as a projection substrate
- same-day ordering and sell allocation traceability are explicit
- dividend lifecycle is locked before dividend persistence and posting work expand
- dividend schema is aligned with typed deductions and explicit currency matching before persistence and posting work expand
- dividend declaration and posting are separated
- actual dividend receipts and deductions are bookable
- posted-fact correction behavior for trade, cash, and dividend writes follows the `KZO-51` reversal-plus-replacement contract

## Batch 7. Gating Correctness Coverage

Primary tickets:

- `KZO-26`
- `KZO-38`

Goal:

- catch canonical cutover regressions before the product surface expands further

Outputs:

- canonical trade posting invariants are covered
- integration tests target canonical accounting-first APIs
- lot-capable projection behavior is validated alongside weighted-average views

## Batch 8. Reconciliation And Import Behaviors

Primary tickets:

- `KZO-29` Define CSV import contract for broker statements
- `KZO-30` Implement CSV import staging and review pipeline
- `KZO-31` Implement reconciliation status model and review workflow

Goal:

- add import, discrepancy tracking, and review-state behavior without mutating posted facts

Dependencies:

- `KZO-15`
- `KZO-16`
- `KZO-51`

Should use fixtures:

- Fixture G
- Fixture H
- Fixture I
- Fixture J

Outputs:

- import staging contract
- explicit reconciliation records
- non-destructive review workflow
- reconciliation uses `explained` only for accepted visible differences and uses `reversal + replacement` when booked economic facts are wrong, per `KZO-51`

## Batch 9. Snapshot And Read-Model Completion

Primary follow-on scope:

- portfolio overview aggregation
- holdings projections
- snapshot generation

Related tickets:

- `KZO-7` and `KZO-8` read-model tickets

Goal:

- surface the accounting model through portfolio overview, holdings, cash, and dividend views

Outputs:

- reproducible derived read models
- traceability back to source facts

## Batch 10. Cleanup And Hardening

Primary tickets:

- `KZO-26`
- `KZO-38`
- `KZO-39`
- `KZO-40`

Goal:

- prove the canonical model survives real workflows and rollout pressure

Outputs:

- canonical domain and integration coverage
- updated end-to-end coverage
- rollout, legacy cleanup, and deprecation documentation

## Ownership Guidance

- product/architecture owns canonical vocabulary and boundary decisions
- backend owns event, ledger, reconciliation, and snapshot behavior
- database owns additive schema and migration safety
- QA owns fixture translation into executable test coverage

## Definition Of Ready For Each Follow-On Ticket

Each downstream ticket is ready only when:

- it references the canonical entity names from `KZO-11`
- it does not reopen closed model decisions without explicit follow-up approval
- it identifies which example fixtures and invariants it must satisfy
- it states whether it changes source facts, derived state, or reference/config data
