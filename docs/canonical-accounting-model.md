# Canonical Accounting Model for MVP

## Purpose

This document defines the canonical accounting model for the Taiwan investment bookkeeping MVP.

Its job is to set the contract for:

- product terminology
- backend domain boundaries
- database schema direction
- QA example coverage

This is a definition document, not an implementation document. It should guide `KZO-12` through `KZO-16`.

## KZO-11 Output Contract

This document is the primary output artifact for `KZO-11`.

`KZO-11` is considered ready for handoff only when this document provides all of the following:

- canonical entity definitions
- terminology alignment across product, backend, and database
- invariant and lifecycle rules
- worked examples with expected outcomes
- migration mapping from the current model to the target model
- explicit downstream handoff guidance for implementation tickets

This issue does not require schema, API, or UI implementation. It does require enough precision that follow-on implementation work can proceed without redefining core accounting concepts.

## Current Baseline

The current system persists these first-class records:

- `Transaction`
- `Lot`
- `CorporateAction`
- `RecomputeJob`

This is enough for a trade simulator and holdings calculator, but not enough for an accounting-first product. The MVP also needs first-class support for:

- cash movement tracking
- dividend bookkeeping
- reconciliation workflow
- end-of-day portfolio snapshots

## Model Classification

The MVP model is split into three categories.

### 1. Booked Facts

Booked facts are records that represent posted accounting reality. They are append-oriented and must not be silently rewritten.

- `TradeEvent`
- `CashLedgerEntry`
- `DividendEvent`
- `DividendLedgerEntry`
- `ReconciliationRecord`

### 2. Derived or Materialized State

Derived state is reproducible from booked facts and reference data.

- `Lot`
- `DailyPortfolioSnapshot`
- holdings views
- realized and unrealized P&L views

### 3. Reference and Configuration Data

Reference/config data may suggest values or provide metadata, but it is not itself a booked accounting fact.

- `Account`
- `SymbolDef`
- `FeeProfile`
- `FeeProfileBinding`

## Core Principles

### Reference Data vs Booked Facts

The system may calculate a suggested value from reference/config data, but the final booked fact must be stored independently.

Examples:

- fee profile is reference/config data
- booked commission on a posted trade is a booked fact
- declared dividend schedule is reference data
- received dividend cash for one account is a booked fact

### Facts vs Derived State

Facts are posted records. Derived state is rebuilt from facts.

Examples:

- lots derive from posted trade events
- holdings derive from lots or from trade-event projections
- daily portfolio snapshots derive from holdings, cash ledger, and end-of-day pricing

### Auditability

Reconciliation and correction workflows must preserve history. The canonical correction model for posted facts is `reversal`. Posted accounting facts must not be silently rewritten in place.

### Cross-Market Cost Basis Strategy

The MVP currently targets weighted average cost as the primary bookkeeping experience. That remains acceptable for Taiwan-focused bookkeeping views, but it should not become the only long-term cost basis model if the product plans to support US and Australian equities.

The canonical direction is:

- keep `TradeEvent` as the source fact
- keep parcel or lot-capable inventory state in the implementation model
- allow bookkeeping views to present weighted average cost
- keep tax-lot or parcel selection available for market-specific tax reporting

Rationale:

- US tax reporting for ordinary stock generally relies on specific identification, with FIFO as the fallback if shares sold are not adequately identified
- average basis in the US is generally limited to certain mutual fund or DRIP contexts rather than ordinary stock as a universal default
- Australian CGT recordkeeping is parcel-oriented, with cost base tracked at share or parcel level

Therefore:

- `weighted average cost` should be treated as the default bookkeeping and portfolio-view method
- `lot or parcel capable inventory tracking` should remain available in the implementation model
- market-specific tax reporting should remain configurable rather than hard-coded to weighted average

## Canonical Entities

## `TradeEvent`

### Purpose

Represents an immutable booked security trade fact for one account and one instrument.

### MVP Responsibility

- record what trade was posted
- capture booked fee and tax values used for accounting
- act as the source fact for position and realized P&L derivation

### Canonical Fields

- `id`
- `userId`
- `accountId`
- `symbol`
- `instrumentType`
- `tradeType`
- `quantity`
- `priceNtd`
- `tradeDate`
- `commissionNtd`
- `taxNtd`
- `isDayTrade`
- `feeSnapshot`
- `sourceType`
- `sourceReference`
- `bookedAt`

### Lifecycle

- `draft` is optional outside accounting scope
- only `posted` trade events enter the canonical accounting model

### Invariants

- `quantity > 0`
- `priceNtd >= 0`
- `commissionNtd >= 0`
- `taxNtd >= 0`
- `tradeType` is `BUY` or `SELL`
- a `SELL` event cannot exceed available quantity for the account and symbol at booking time
- booked trade facts are not silently mutated after posting
- corrections to posted trade facts must be represented through reversal rather than in-place overwrite

### Current Mapping

- current code name: `Transaction`
- current storage: `transactions`

## `CashLedgerEntry`

### Purpose

Represents a first-class cash movement.

### MVP Responsibility

- make account cash effects auditable
- support trade settlement, dividend receipt, deductions, and future manual adjustments
- support reconciliation against broker cash balances

### Canonical Fields

- `id`
- `userId`
- `accountId`
- `entryDate`
- `entryType`
- `amountNtd`
- `currency`
- `relatedTradeEventId`
- `relatedDividendLedgerEntryId`
- `sourceType`
- `sourceReference`
- `note`

### Lifecycle

- created as a posted ledger fact
- may be reversed, not silently replaced

### Invariants

- each entry has exactly one accounting meaning
- sign conventions are explicit by `entryType`
- trade settlement entries must link back to the originating trade event when applicable
- dividend cash entries must link back to the related dividend ledger entry when applicable
- orphan ledger entries are invalid unless the entry type explicitly allows it
- corrections to posted cash ledger entries must be represented through reversal

### Current Mapping

- not yet implemented

## `DividendEvent`

### Purpose

Represents issuer-declared dividend reference data.

### MVP Responsibility

- represent the declared event independently from account-level receipt
- serve as the basis for expected entitlement calculations

### Canonical Fields

- `id`
- `symbol`
- `eventType`
- `exDividendDate`
- `paymentDate`
- `cashDividendPerShare`
- `stockDividendPerShare`
- `sourceType`
- `sourceReference`

### Lifecycle

- created or updated from reference data feeds or manual reference entry
- does not itself move account cash

### Invariants

- belongs to one instrument
- reference updates must not rewrite booked account-level receipt history
- event amounts are reference values, not posted cash facts

### Current Mapping

- currently approximated by `CorporateAction` with `DIVIDEND`
- current structure is too thin for the target bookkeeping flow

## `DividendLedgerEntry`

### Purpose

Represents account-level dividend bookkeeping derived from a dividend event and holdings eligibility.

### MVP Responsibility

- store expected and actual dividend values per account
- store deductions such as supplemental insurance or other adjustments
- provide posted state for dividend workflow UI and reconciliation

### Canonical Fields

- `id`
- `accountId`
- `dividendEventId`
- `eligibleQuantity`
- `expectedCashAmountNtd`
- `expectedStockQuantity`
- `receivedCashAmountNtd`
- `receivedStockQuantity`
- `supplementalInsuranceNtd`
- `otherDeductionNtd`
- `postingStatus`
- `reconciliationStatus`

### Lifecycle

- `expected`
- `posted`
- `adjusted`
- `reconciled`

### Invariants

- one dividend event may produce zero or more ledger entries across accounts
- actual received values may differ from expected values
- related cash effects must be represented through cash ledger entries, not hidden fields alone
- corrections to posted dividend ledger entries must be represented through reversal

### Current Mapping

- not yet implemented

## `ReconciliationRecord`

### Purpose

Represents a discrepancy or review record between internal accounting state and broker/imported reality.

### MVP Responsibility

- track mismatches
- preserve exception context
- support review, explanation, and resolution workflow

### Canonical Fields

- `id`
- `userId`
- `accountId`
- `sourceType`
- `sourceReference`
- `sourceFileName`
- `sourceRowKey`
- `targetEntityType`
- `targetEntityId`
- `reconciliationStatus`
- `differenceReason`
- `reviewedAt`
- `reviewerId`
- `note`

### Lifecycle

- `open`
- `matched`
- `explained`
- `resolved`

### Invariants

- reconciliation records are append-only workflow records
- reconciliation does not directly mutate booked facts
- the original discrepancy must remain visible even after resolution

### Current Mapping

- not yet implemented
- `RecomputeJob` is not a reconciliation record

## `DailyPortfolioSnapshot`

### Purpose

Represents an immutable end-of-day portfolio summary.

### MVP Responsibility

- support overview UI and historical daily reporting
- provide a reproducible read model for end-of-day totals

### Canonical Fields

- `id`
- `userId`
- `snapshotDate`
- `totalMarketValueNtd`
- `totalCostNtd`
- `totalUnrealizedPnlNtd`
- `totalRealizedPnlNtd`
- `totalDividendReceivedNtd`
- `totalCashBalanceNtd`
- `totalNavNtd`
- `generatedAt`
- `generationRunId`

### Lifecycle

- generated from booked facts and pricing data
- published as immutable output for one date/run

### Invariants

- snapshots are reproducible from prior booked facts and reference pricing
- snapshots are not manually edited source records
- replacing a snapshot means generating a new snapshot run, not mutating an existing row in place

### Current Mapping

- not yet implemented

## `Lot`

### Purpose

Represents a canonical derived inventory unit used to preserve tax-lot or parcel-level disposal and cost tracking capability.

### MVP Responsibility

- remain a canonical derived accounting projection during migration
- support oversell validation and cost-basis calculations
- preserve future cross-market support for US tax-lot handling and Australian parcel-based cost tracking

### Invariants

- `openQuantity >= 0`
- `totalCostNtd >= 0`
- lots are derived from trade history and qualifying corporate actions

### Current Mapping

- current code name: `Lot`
- current storage: `lots`

### Decision For MVP

`Lot` remains part of the canonical accounting model as a derived inventory construct. It is not the primary product-facing bookkeeping concept, but it must remain available to support cross-market disposal-order and parcel-level cost tracking. The canonical product/accounting language should still prefer `TradeEvent`, holdings, cash ledger, dividend ledger, and average-cost portfolio views for day-to-day user experience.

## Relationship Rules

- `TradeEvent` creates or consumes `Lot` state
- `TradeEvent` may create one or more `CashLedgerEntry` records
- `DividendEvent` may create zero or more `DividendLedgerEntry` records
- `DividendLedgerEntry` may create one or more `CashLedgerEntry` records
- `ReconciliationRecord` points to facts or derived outputs under review, but does not rewrite them
- `DailyPortfolioSnapshot` derives from booked facts plus pricing/reference data

## Handoff Rules

The following rules constrain follow-on implementation work:

- no downstream ticket may redefine `booked facts`, `derived state`, or `reference/config` categories
- no downstream ticket may replace `reversal` with silent mutation for posted facts
- no downstream ticket may collapse `DividendEvent` and `DividendLedgerEntry` into a single record type
- no downstream ticket may remove `Lot` support from the implementation model if future US or Australian market support remains in scope
- weighted-average portfolio views may become the default user-facing behavior, but must not erase future lot or parcel support requirements

## Terminology Map

| Canonical term | Current term | Notes |
| --- | --- | --- |
| `TradeEvent` | `Transaction` | Keep current implementation name during migration, but use canonical name in new specs |
| `CashLedgerEntry` | none | New first-class entity |
| `DividendEvent` | `CorporateAction` with `DIVIDEND` | Current model is insufficiently expressive |
| `DividendLedgerEntry` | none | New first-class entity |
| `ReconciliationRecord` | none | Distinct from recompute jobs |
| `DailyPortfolioSnapshot` | none | New derived read model |
| `Lot` | `Lot` | Keep as derived state |

## Invariant Matrix

| Entity | Immutable after posting | Derived or source | Key validation |
| --- | --- | --- | --- |
| `TradeEvent` | Yes, except reversal flow | Source fact | positive quantity, oversell rejection, non-negative money fields |
| `CashLedgerEntry` | Yes, except reversal flow | Source fact | valid sign by entry type, no invalid orphan references |
| `DividendEvent` | Reference update allowed | Reference fact | instrument/date/value validity |
| `DividendLedgerEntry` | Yes, except reversal flow | Source fact | expected vs actual fields valid, audit-safe correction |
| `ReconciliationRecord` | Append-only workflow | Source fact | status transitions valid, source discrepancy preserved |
| `DailyPortfolioSnapshot` | Yes | Derived read model | reproducible for date/run |
| `Lot` | Rebuilt from facts | Derived state | no negative open quantity or total cost |

## Worked Example Pack

The issue is not complete without concrete examples. The following examples define the minimum acceptance pack for the MVP model.

### Example 1. Buy Trade With Commission

Input facts:

- `TradeEvent`
  - account: `broker-a`
  - symbol: `2330`
  - tradeType: `BUY`
  - quantity: `1000`
  - priceNtd: `600`
  - commissionNtd: `855`
  - taxNtd: `0`

Expected outcomes:

- one posted `TradeEvent` exists
- one `CashLedgerEntry` exists for trade settlement cash outflow
- derived holding quantity becomes `1000`
- derived total cost becomes `600855`
- if lot-capable inventory is enabled, one open `Lot` exists with quantity `1000`

### Example 2. Sell Trade With Commission And Tax

Precondition:

- existing holding from Example 1

Input facts:

- `TradeEvent`
  - account: `broker-a`
  - symbol: `2330`
  - tradeType: `SELL`
  - quantity: `400`
  - priceNtd: `650`
  - commissionNtd: `370`
  - taxNtd: `780`

Expected outcomes:

- one posted `TradeEvent` exists
- one `CashLedgerEntry` exists for trade settlement cash inflow
- derived holding quantity becomes `600`
- realized P&L is derived from disposal cost and net proceeds, not manually entered
- no negative lot or holding quantity appears

### Example 3. Partial Sell After Multiple Buys

Input facts:

- `TradeEvent` buy `1000` shares of `2330` at `600`
- `TradeEvent` buy `1000` shares of `2330` at `640`
- `TradeEvent` sell `1200` shares of `2330` at `650`

Expected outcomes:

- remaining holding quantity becomes `800`
- weighted-average portfolio view uses average cost across eligible inventory before disposal
- lot-capable inventory remains able to represent which inventory units remain for future cross-market tax reporting
- realized P&L is reproducible from the posted facts and disposal rule

### Example 4. Same-Day Multiple Trades In One Symbol

Input facts:

- `TradeEvent` buy `500` shares of `2330` at `600` on `2026-03-01T09:05:00+08:00`
- `TradeEvent` buy `300` shares of `2330` at `605` on `2026-03-01T11:20:00+08:00`
- `TradeEvent` sell `200` shares of `2330` at `610` on `2026-03-01T13:10:00+08:00`

Expected outcomes:

- ordering is determined by booked event sequence, not by ambiguous date-only sorting
- derived holdings and cost basis are reproducible from that sequence
- the system does not collapse same-day trades into one fact unless an explicit consolidation rule exists

### Example 5. Declared Cash Dividend Vs Posted Dividend Receipt

Input facts:

- `DividendEvent`
  - symbol: `0056`
  - exDividendDate: `2026-07-15`
  - paymentDate: `2026-08-10`
  - cashDividendPerShare: `1.2`
  - stockDividendPerShare: `0`
- eligible holding on ex-dividend date: `2000` shares

Expected outcomes:

- the `DividendEvent` exists as reference data only
- one `DividendLedgerEntry` may be created with:
  - eligibleQuantity: `2000`
  - expectedCashAmountNtd: `2400`
- no cash movement is created merely because the dividend was declared
- actual cash is only recognized after posting the receipt

### Example 6. Posted Dividend Receipt With Deductions

Precondition:

- expected dividend ledger exists from Example 5

Input facts:

- update or post `DividendLedgerEntry`
  - receivedCashAmountNtd: `2280`
  - supplementalInsuranceNtd: `120`
  - otherDeductionNtd: `0`
  - postingStatus: `posted`

Expected outcomes:

- one posted `DividendLedgerEntry` exists for the account
- one or more `CashLedgerEntry` records exist to represent the actual cash receipt and related deduction effects
- expected and actual values remain separately visible
- the posted receipt does not rewrite the original `DividendEvent`

### Example 7. Correction Through Reversal

Precondition:

- a posted `TradeEvent` or posted `DividendLedgerEntry` exists with an incorrect amount

Input facts:

- a reversal record is created to negate the incorrect posted fact
- a new corrected posted fact is created separately if needed

Expected outcomes:

- the original posted fact remains in history
- correction is represented through reversal, not in-place overwrite
- derived holdings, cash, and snapshots can be recomputed from the full event history

### Example 8. Reconciliation Mismatch Without Destructive Rewrite

Input facts:

- broker import shows cash balance `100000`
- internal derived cash balance is `99500`

Expected outcomes:

- one `ReconciliationRecord` exists with status `open`
- the discrepancy amount and source reference are preserved
- no booked trade, dividend, or cash ledger fact is silently changed
- later resolution updates reconciliation workflow state, not historical facts

### Example 9. Duplicate Import Or Idempotency Case

Input facts:

- the same broker trade row is imported twice with the same external source reference

Expected outcomes:

- only one booked `TradeEvent` is accepted
- the duplicate is rejected or linked to an idempotency outcome
- holdings and cash balances are unchanged by the duplicate attempt

### Example 10. Backfilled Historical Trade

Input facts:

- user posts a missing historical buy dated before already-booked later trades

Expected outcomes:

- the new fact is appended with its historical trade date preserved
- derived holdings, cost basis, and snapshots are recomputed from full chronological facts
- prior posted facts are not rewritten
- any affected reconciliation or snapshot outputs are regenerated rather than manually edited

### Example 11. Invalid Oversell

Precondition:

- account holds `600` shares of `2330`

Input facts:

- user attempts to post a `SELL` for `700` shares

Expected outcomes:

- the `TradeEvent` is rejected
- no `CashLedgerEntry` is created
- holdings remain unchanged
- the validation reason is explicit

### Example 12. Invalid Negative Values

Input facts:

- user attempts to post:
  - `quantity = -100`
  - or `priceNtd = -1`
  - or `commissionNtd = -5`

Expected outcomes:

- the record is rejected before posting
- no downstream lot, cash ledger, dividend ledger, or snapshot side effect occurs
- the validation rule is explicit and testable

## Acceptance Criteria for `KZO-11`

`KZO-11` is complete only when all of the following exist:

- one approved canonical accounting model document
- one terminology and classification table
- one relationship and invariant matrix
- one worked example pack with expected outcomes
- explicit migration mapping from current `transactions/lots/recompute/corporate_actions` to the canonical model

## Ready-For-Handoff Checklist

The spec is ready to hand off into implementation when all answers below are "yes":

- are all canonical entities defined with purpose, fields, lifecycle, and invariants?
- are reference data and booked facts explicitly separated?
- is the posted-fact correction model locked to `reversal`?
- is the `Lot` role explicitly retained for cross-market support?
- are `DividendEvent` and `DividendLedgerEntry` minimum MVP fields fixed?
- does the example pack cover trade, dividend, reconciliation, reversal, idempotency, and validation cases?
- can `KZO-12` through `KZO-16` start without reopening core terminology questions?

## Migration Guidance

The model should preserve the current implementation path while making future work additive.

### Phase 1

- define canonical names and invariants
- keep current `Transaction` and `Lot` write/read path

### Phase 2

- add `CashLedgerEntry`
- connect trade posting to cash settlement effects

### Phase 3

- add `DividendEvent` and `DividendLedgerEntry`
- separate dividend reference data from account-level booked dividend facts

### Phase 4

- add reconciliation and daily snapshot read models

## Downstream Ticket Mapping

The intended downstream mapping is:

- `KZO-12`: product settings and shared-type alignment for weighted-average cost as the default bookkeeping view
- `KZO-13`: domain-level weighted-average cost basis and realized P&L behavior
- `KZO-15`: schema foundation for cash ledger, dividends, reconciliation, and snapshots
- `KZO-16`: store and persistence contracts around accounting aggregates
- `KZO-24`, `KZO-34`, `KZO-36`: first write paths using the canonical model
- `KZO-29`, `KZO-30`, `KZO-31`: import and reconciliation behaviors constrained by this document

## KZO-11 Decisions

The following decisions are locked for the current MVP:

- `Lot` remains canonical as a derived inventory and tax-lot-capable model, not merely implementation-only
- posted-fact correction model: `reversal`
- minimum `DividendEvent` fields:
  - `id`
  - `symbol`
  - `exDividendDate`
  - `paymentDate`
  - `cashDividendPerShare`
  - `stockDividendPerShare`
  - `sourceType`
  - `sourceReference`
- minimum `DividendLedgerEntry` fields:
  - `id`
  - `accountId`
  - `dividendEventId`
  - `eligibleQuantity`
  - `expectedCashAmountNtd`
  - `expectedStockQuantity`
  - `receivedCashAmountNtd`
  - `receivedStockQuantity`
  - `supplementalInsuranceNtd`
  - `otherDeductionNtd`
  - `postingStatus`
  - `reconciliationStatus`

## Explicit Non-Goals for This Issue

- no schema migration implementation
- no API route implementation
- no UI implementation
- no full rename of current code symbols
- no final weighted-average implementation details beyond dependency on this model
