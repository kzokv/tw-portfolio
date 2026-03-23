# KZO-14 Direct Cutover Strategy

## Purpose

This document replaces the earlier migration-heavy framing for `KZO-14`.

The current application should be treated as scaffolding, not as a live system with meaningful production bookkeeping data. Because of that, the architecture should move by direct cutover to the canonical accounting model instead of maintaining a prolonged coexistence bridge from legacy `transactions`, `lots`, `corporate_actions`, and `recompute_jobs`.

This document is the execution contract for:

- `KZO-14`
- `KZO-16`
- `KZO-24`
- `KZO-26`
- follow-on lot-allocation and sequencing work

## Decision

The system should use a direct cutover plan.

That means:

- stop investing in the legacy bookkeeping path as the long-term source of truth
- make canonical accounting facts authoritative as soon as the new write path is ready
- keep lot-capable inventory in the system design because future US and AU support requires it
- treat weighted-average cost basis as a policy/view layer for Taiwan MVP behavior, not as a replacement for lot structure

## Why The Strategy Changed

The earlier migration framing assumed legacy operational risk. That assumption no longer holds.

Current reality:

- the live application is scaffolding only
- no meaningful production data needs backfill or preservation
- there is no business reason to carry dual-write or long compatibility windows
- future US/AU support still requires lot-capable inventory and deterministic disposal traceability

Because of that, the fastest correct path is:

- canonical facts first
- lot-capable projections second
- weighted-average read models on top

## Canonical Model Direction

### Canonical Booked Facts

- `TradeEvent`
- `CashLedgerEntry`
- `DividendEvent`
- `DividendLedgerEntry`
- `ReconciliationRecord`
- `CorporateActionEvent` for inventory-affecting actions such as split and reverse split

### Canonical Derived State

- `Lot`
- holdings views
- realized and unrealized P&L views
- `DailyPortfolioSnapshot`

### Policy Layer

Cost basis is a policy over lot-capable inventory.

- Taiwan MVP default: weighted average
- future US support: specific identification or FIFO fallback as needed
- future AU support: parcel-aware cost-base tracking

The underlying inventory substrate must remain lot-capable so market-specific reporting can be added later without replacing the accounting core.

## Core Architectural Rules

### 1. Source Facts Are Immutable

Posted accounting facts must be append-only.

- no in-place mutation of posted trades
- no recompute-confirm flow that rewrites booked commission, tax, or realized P&L
- corrections happen through reversal, rebook, or explicit adjustment facts

### 2. Derived State Is Projected

`Lot`, holdings, and P&L are projections from source facts.

- application handlers do not directly mutate lots as the primary source of truth
- projectors may materialize lots or snapshots for performance and traceability
- the same inputs must always reproduce the same derived outputs

### 3. Weighted Average Does Not Replace Lots

Weighted average remains the Taiwan MVP user-facing method, but lots remain required in the implementation model.

- realized P&L is derived using the weighted-average policy over eligible open inventory
- remaining carrying cost is allocated back into open lots deterministically
- future disposal policies must reuse the same lot-capable inventory base

### 4. Deterministic Ordering Is Mandatory

The system must not depend on date-plus-id fallback forever.

Canonical trade ingestion should include:

- `tradeTimestamp`
- `bookingSequence`

Sell allocation and lot projection logic must use explicit ordering inputs rather than arbitrary tie-breaking.

### 5. Disposal Traceability Must Be Preserved

The system should add persistent sell-to-lot traceability.

Recommended direction:

- introduce `lot_allocations` or an equivalent structure
- persist which open inventory units were consumed by each sell
- keep weighted-average reporting compatible with the same trace data

This is necessary for future US/AU support and for auditability.

## Direct Cutover Plan

### Phase 1. Canonical Store Contract

Primary ticket:

- `KZO-16`

Goals:

- redesign the API store and persistence model around canonical facts and projections
- stop treating the legacy whole-store model as the main abstraction
- define clear write-model vs read-model boundaries

Outputs:

- canonical store types
- fact persistence contract
- projection responsibilities

### Phase 2. Canonical Trade Write Path

Primary ticket:

- `KZO-24`

Goals:

- write `TradeEvent`
- write linked settlement `CashLedgerEntry`
- update lot projection from canonical facts

Outputs:

- buy and sell posting uses canonical facts
- no primary dependency on legacy `transactions`
- lot projection remains available for holdings and future disposal rules

### Phase 3. Lot Traceability And Ordering

Follow-on scope:

- explicit booking sequence
- persistent lot allocation linkage

Goals:

- eliminate same-day ordering ambiguity
- preserve future tax-lot and parcel-aware reporting capability

Outputs:

- deterministic sequencing keys
- sell-to-lot trace records

### Phase 4. Dividend And Reconciliation Write Paths

Primary tickets:

- `KZO-34`
- `KZO-36`
- later reconciliation/import tickets

Goals:

- keep all new bookkeeping writes on canonical facts only
- avoid expanding legacy `CorporateAction` or recompute behavior

### Phase 5. Canonical Read Models

Primary scope:

- holdings
- portfolio overview
- snapshots

Goals:

- derive weighted-average holdings and P&L from lot-capable inventory
- keep the user experience simple for Taiwan MVP while preserving the richer accounting substrate

## What To Stop Doing

The following should be treated as legacy scaffolding, not future architecture:

- writing `transactions` as the long-term source of truth
- mutating `recompute_jobs` into booked-state changes
- treating persisted `lots` as the primary accounting record
- designing around long coexistence or dual-write risk
- building more product scope on top of legacy mutable bookkeeping assumptions

## Legacy Table Handling

Because there is no real live data, legacy table handling can be simplified.

Recommended path:

- freeze legacy design expansion now
- keep old tables only while canonical path is under active construction
- use temporary adapters only if required to keep endpoint shapes stable during implementation
- remove or archive legacy write paths once canonical APIs are ready
- retire legacy tables in a later controlled cleanup step

There is no need for:

- prolonged dual-write
- production backfill tooling
- long-lived compatibility projections for historical data preservation

## Testing And Quality Direction

Quality work should move earlier once canonical trade posting exists.

Priority testing focus:

- trade fact posting
- lot projection correctness
- weighted-average realization and remaining cost
- lot allocation traceability
- deterministic same-day ordering
- cash settlement linkage

This means `KZO-26` and `KZO-38` should validate canonical accounting behavior, not legacy compatibility behavior.

## Product Roadmap Implications

Product should continue to present:

- weighted-average holdings and P&L for Taiwan MVP
- simple trade journal and portfolio views

But the roadmap should explicitly state:

- lot-capable inventory is retained internally for future US and AU support
- weighted average is a default accounting/reporting policy, not the only long-term disposal model
- deterministic intraday ordering is a product requirement, even if not directly exposed in the UI

## Exit Criteria

`KZO-14` is complete when the team agrees on all of the following:

- direct cutover is the default plan
- canonical facts are authoritative
- lot-capable inventory remains part of the core system design
- weighted average is treated as a policy/view layer
- explicit sequencing and lot-allocation traceability are planned follow-ons
- legacy tables are considered scaffolding scheduled for later retirement rather than a long-term migration anchor
