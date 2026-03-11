# Canonical Accounting Model for MVP

## Purpose

This document defines the canonical accounting model for the Taiwan investment bookkeeping MVP.

Its job is to set the contract for:

- product terminology
- backend domain boundaries
- database schema direction
- QA example coverage

This is a definition document, not an implementation document. It should guide `KZO-12` through `KZO-16`, `KZO-51`, and the follow-on accounting and settings work that depends on a stable model.

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

The current runtime already persists first-class accounting records beyond the legacy trade simulator model.

Canonical runtime accounting reads come from:

- `trade_events`
- `cash_ledger_entries`
- `dividend_events`
- `dividend_ledger_entries`
- `dividend_deduction_entries`
- `lots`
- `lot_allocations`
- `daily_portfolio_snapshots`

Compatibility or workflow tables still matter:

- `trade_fee_policy_snapshots`
- `corporate_actions`
- `recompute_jobs`
- `reconciliation_records`

This means the MVP is no longer at the stage where cash ledger and dividend ledger are future concepts. Those concepts already exist in runtime and must be reflected as current canonical entities in this document.

## Runtime Drift To Track

The canonical target model intentionally gets ahead of one remaining implementation gap.

### 1. Exact Taiwan Commission Precision

Taiwan listed-securities board commission should default to the exact public baseline `1.425‰`.

Current runtime fee settings still use integer `commissionRateBps`, which cannot represent `1.425‰` exactly. The canonical target therefore replaces integer `commissionRateBps` with a decimal-capable board commission rate field.

### 2. Currency-Normalized Structure

`KZO-55` completed the currency-normalization sweep. The canonical model should treat amount-plus-currency naming as implemented baseline, not pending drift.

## Model Classification

The MVP model is split into four categories.

### 1. Booked Facts

Booked facts are records that represent posted accounting reality. They are append-oriented and must not be silently rewritten.

- `TradeEvent`
- `CashLedgerEntry`
- `DividendLedgerEntry`
- `DividendDeductionEntry`
- `ReconciliationRecord`

### 2. Derived or Materialized State

Derived state is reproducible from booked facts and reference data.

- `Lot`
- `DailyPortfolioSnapshot`
- holdings views
- realized and unrealized P&L views

### 3. Immutable Snapshots

- `TradeFeePolicySnapshot`

### 4. Reference and Configuration Data

Reference or configuration data may suggest values or provide metadata, but it is not itself a booked accounting fact.

- `Account`
- `SymbolDef`
- `FeeProfile`
- `FeeProfileBinding`
- `DividendEvent`

## Core Principles

### Reference Data vs Booked Facts

The system may calculate a suggested or default value from reference or configuration data, but the final booked fact must be stored independently.

Examples:

- fee profile is reference or configuration data
- booked commission on a posted trade is a booked fact
- declared dividend schedule is reference data
- received dividend cash for one account is a booked fact

### Facts vs Derived State

Facts are posted records. Derived state is rebuilt from facts.

Examples:

- lots derive from posted trade events
- holdings derive from lots or from trade-event projections
- daily portfolio snapshots derive from holdings, cash ledger, and end-of-day pricing

### Fee Policy vs Booked Charges

Fee policy and booked charges are different concepts.

- board commission rate, broker discount, minimum commission, and charge mode belong to fee policy
- booked commission amount belongs to the posted trade fact
- later campaign rebate cash belongs to cash ledger, not to silent mutation of the original trade

The user-facing model should not center on manual free-form commission entry. The canonical path is:

1. resolve fee policy
2. derive booked commission and tax
3. persist those booked values on the trade
4. persist the fee policy snapshot used at booking time

### Auditability

Reconciliation and correction workflows must preserve history. The canonical correction model for posted facts is `reversal`. Posted accounting facts must not be silently rewritten in place.

The detailed posted-fact correction contract for `KZO-51` lives in [posted-fact-correction-rules.md](./notes/posted-fact-correction-rules.md). Downstream write, import, and reconciliation work should treat that note as the durable rule set rather than redefining correction behavior ticket by ticket.

### Posted-Fact Correction Contract

For posted `TradeEvent`, `CashLedgerEntry`, and `DividendLedgerEntry` facts:

- material errors are corrected at the parent-fact level through `reversal + replacement`, not by editing child details in place
- the original economic date remains part of business meaning, while the actual correction booking moment is recorded separately in `bookedAt`
- stock-dividend corrections must reverse the prior inventory effect through the stock-position path and separately reverse any related cash effects
- reconciliation status `explained` is not a correction method and must not be used when the booked economic fact is wrong
- the correction chain must complete atomically across the parent fact, generated reversal rows, replacement rows, and any required projection refresh
- external traceability metadata such as `sourceReference` remains separate from internal correction-chain linkage

### Currency Normalization

The canonical model must be structurally currency-aware even while the Taiwan MVP remains operationally TWD-first.

Use these naming patterns in canonical entities:

- money amount fields: `amount` plus `currency`
- unit price fields: `unitPrice` plus `priceCurrency`
- deduction fields: `amount` plus `currencyCode`
- snapshot totals: normalized amount fields plus a snapshot-level `currency`

Do not encode `Ntd` in canonical field names.

### Cross-Market Cost Basis Strategy

The MVP currently targets weighted average cost as the primary bookkeeping experience. That remains acceptable for Taiwan-focused bookkeeping views, but it should not become the only long-term cost basis model if the product plans to support US and Australian equities.

The canonical direction is:

- keep `TradeEvent` as the source fact
- keep parcel or lot-capable inventory state in the implementation model
- allow bookkeeping views to present weighted average cost
- keep tax-lot or parcel selection available for market-specific tax reporting

Therefore:

- `weighted average cost` should be treated as the default bookkeeping and portfolio-view method
- `lot or parcel capable inventory tracking` should remain available in the implementation model
- market-specific tax reporting should remain configurable rather than hard-coded to weighted average

## Canonical Entities

## `FeeProfile`

### Purpose

Represents broker fee policy and regulated sell-tax defaults used to derive booked trade charges.

### MVP Responsibility

- store broker fee assumptions separately from posted trade facts
- provide account-level defaults and symbol-level override targets
- persist regulated sell-tax defaults in the same policy surface for transparent calculation

### Canonical Fields

- `id`
- `userId`
- `name`
- `boardCommissionRate`
- `commissionDiscount`
- `minimumCommissionAmount`
- `commissionCurrency`
- `commissionRoundingMode`
- `taxRoundingMode`
- `stockSellTaxRate`
- `stockDayTradeTaxRate`
- `etfSellTaxRate`
- `bondEtfSellTaxRate`
- `commissionChargeMode`

### Canonical Defaults

- `boardCommissionRate` defaults to exact `1.425‰`
- stock sell tax defaults to `0.3%`
- stock day-trade sell tax defaults to `0.15%`
- ETF sell tax defaults to `0.1%`
- bond ETF sell tax defaults to `0%` for as long as the applicable exemption remains in force

### Invariants

- board commission rate, broker discount, and minimum commission remain separate values
- commission defaults are user-visible for transparency, but sell-tax defaults are regulated settings rather than ordinary broker preferences
- sell-tax values may remain configurable in schema or settings, but normal product behavior should treat them as read-mostly and discourage routine editing
- fee profiles are reference or configuration data, not booked accounting facts

### Current Mapping

- current runtime model stores legacy integer `commissionRateBps`, decimal `boardCommissionRate`, decimal `commissionDiscountPercent` (`% off`), `minimumCommissionAmount`, and `commissionCurrency`
- current runtime precision is still insufficient for exact `1.425‰`
- runtime naming is already currency-normalized for minimum commission

## `FeeProfileBinding`

### Purpose

Represents an account-and-symbol mapping from a tradable instrument to the fee profile that should override the account default.

### MVP Responsibility

- support broker-specific or instrument-specific fee policy overrides
- preserve simple precedence without forcing per-trade manual fee policy entry

### Canonical Fields

- `accountId`
- `symbol`
- `feeProfileId`

### Invariants

- account default fee profile is the fallback
- account and symbol binding wins over the account default
- at most one active binding exists per `(accountId, symbol)`

### Current Mapping

- implemented in runtime as account and symbol fee profile overrides

## `TradeEvent`

### Purpose

Represents an immutable booked security trade fact for one account and one instrument.

### MVP Responsibility

- record what trade was posted
- capture booked fee and tax values used for accounting
- persist the fee policy snapshot that produced those booked values
- act as the source fact for position and realized P&L derivation

### Canonical Fields

- `id`
- `userId`
- `accountId`
- `symbol`
- `instrumentType`
- `tradeType`
- `quantity`
- `unitPrice`
- `priceCurrency`
- `tradeDate`
- `tradeTimestamp`
- `bookingSequence`
- `bookedCommissionAmount`
- `commissionCurrency`
- `bookedTaxAmount`
- `taxCurrency`
- `isDayTrade`
- `feePolicySnapshot`
- `sourceType`
- `sourceReference`
- `bookedAt`
- `reversalOfTradeEventId`

### Lifecycle

- `draft` is optional outside accounting scope
- only `posted` trade events enter the canonical accounting model

### Invariants

- `quantity > 0`
- `unitPrice >= 0`
- `bookedCommissionAmount >= 0`
- `bookedTaxAmount >= 0`
- `tradeType` is `BUY` or `SELL`
- a `SELL` event cannot exceed available quantity for the account and symbol at booking time
- posting resolves fee policy from account default first, then account and symbol override if present
- the user-facing trade flow does not treat raw commission amount as the primary input
- booked trade facts are not silently mutated after posting
- corrections to posted trade facts must follow the posted-fact correction contract and must be represented through reversal rather than in-place overwrite

### Current Mapping

- current code name: `BookedTradeEvent` with a local `Transaction` alias still used in some services
- current canonical storage: `trade_events`
- immutable snapshot storage: `trade_fee_policy_snapshots`
- current runtime stores `unitPrice`, `priceCurrency`, `commissionAmount`, `taxAmount`, and fee snapshots with explicit `commissionCurrency`

## `CashLedgerEntry`

### Purpose

Represents a first-class cash movement.

### MVP Responsibility

- make account cash effects auditable
- support trade settlement, dividend receipt, deductions, broker fee rebates, and future manual adjustments
- support reconciliation against broker cash balances

### Canonical Fields

- `id`
- `userId`
- `accountId`
- `entryDate`
- `entryType`
- `amount`
- `currency`
- `relatedTradeEventId`
- `relatedDividendLedgerEntryId`
- `sourceType`
- `sourceReference`
- `note`
- `bookedAt`
- `reversalOfCashLedgerEntryId`

### Lifecycle

- created as a posted ledger fact
- may be reversed, not silently replaced

### Invariants

- each entry has exactly one accounting meaning
- sign conventions are explicit by `entryType`
- trade settlement entries must link back to the originating trade event when applicable
- dividend cash entries must link back to the related dividend ledger entry when applicable
- broker fee rebates are separate cash ledger entries, not silent reductions of the original trade charge
- orphan ledger entries are invalid unless the entry type explicitly allows it
- corrections to posted cash ledger entries must follow the posted-fact correction contract and must be represented through reversal

### Current Mapping

- implemented in the API store and Postgres persistence
- current runtime stores signed `amount` plus explicit `currency`

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
- `cashDividendCurrency`
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

- canonical runtime storage: `dividend_events`

## `DividendLedgerEntry`

### Purpose

Represents account-level dividend bookkeeping derived from a dividend event and holdings eligibility.

### MVP Responsibility

- store expected and actual dividend values per account
- link to typed deduction rows for supplemental insurance and other adjustments
- provide posted state for dividend workflow UI and reconciliation

### Canonical Fields

- `id`
- `accountId`
- `dividendEventId`
- `eligibleQuantity`
- `expectedCashAmount`
- `receivedCashAmount`
- `cashCurrency`
- `expectedStockQuantity`
- `receivedStockQuantity`
- `postingStatus`
- `reconciliationStatus`
- `bookedAt`
- `reversalOfDividendLedgerEntryId`
- `supersededAt`

### Lifecycle

- `expected`
- `posted`
- `adjusted`

### Invariants

- one dividend event may produce zero or more ledger entries across accounts
- actual received values may differ from expected values
- typed dividend deductions must be represented through child records with explicit currency
- related cash effects must be represented through cash ledger entries, not hidden fields alone
- corrections to posted dividend ledger entries must follow the posted-fact correction contract and must be represented through reversal
- at most one active non-reversal row should exist per `(accountId, dividendEventId)`

### Current Mapping

- implemented in the API store and Postgres persistence
- current runtime stores `expectedCashAmount` on the parent row and derives `receivedCashAmount` from linked `CashLedgerEntry` rows; cash currency is carried by the related `DividendEvent.cashDividendCurrency`

## `DividendDeductionEntry`

### Purpose

Represents one typed deduction or adjustment attached to an account-level dividend posting.

### MVP Responsibility

- preserve deduction detail without flattening all withheld amounts into one summary field
- keep the dividend posting comparison based on net received cash plus explicit at-source deductions
- carry explicit currency on every deduction row

### Canonical Fields

- `id`
- `dividendLedgerEntryId`
- `deductionType`
- `amount`
- `currencyCode`
- `withheldAtSource`
- `sourceType`
- `sourceReference`
- `note`

### Invariants

- one dividend ledger entry may have zero or more deduction rows
- deduction rows are source facts, not derived summaries
- downstream read models may project summary totals, but deduction rows remain the source of truth

### Current Mapping

- implemented in the API store and Postgres persistence
- current runtime stores explicit `currencyCode` and validates deduction currency against the parent dividend event cash currency rather than a global TWD-only rule

## `ReconciliationRecord`

### Purpose

Represents a discrepancy or review record between internal accounting state and broker or imported reality.

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

- `reconciliation_records` exists in schema
- runtime behavior is still limited compared with the target workflow model

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
- `currency`
- `totalMarketValue`
- `totalCost`
- `totalUnrealizedPnl`
- `totalRealizedPnl`
- `totalDividendReceived`
- `totalCashBalance`
- `totalNav`
- `generatedAt`
- `generationRunId`

### Lifecycle

- generated from booked facts and pricing data
- published as immutable output for one date and run

### Invariants

- snapshots are reproducible from prior booked facts and reference pricing
- snapshots are not manually edited source records
- replacing a snapshot means generating a new snapshot run, not mutating an existing row in place

### Current Mapping

- current runtime persists daily portfolio snapshots
- current field naming uses `total*Amount` fields plus a snapshot-level `currency`

## `Lot`

### Purpose

Represents a canonical derived inventory unit used to preserve tax-lot or parcel-level disposal and cost tracking capability.

### MVP Responsibility

- remain a canonical derived accounting projection during migration
- support oversell validation and cost-basis calculations
- preserve future cross-market support for parcel-based or lot-based disposal

### Invariants

- `openQuantity >= 0`
- `totalCost >= 0`
- lots are derived from trade history and qualifying corporate actions

### Current Mapping

- current code name: `Lot`
- current storage: `lots`

### Decision For MVP

`Lot` remains part of the canonical accounting model as a derived inventory construct. It is not the primary product-facing bookkeeping concept, but it must remain available to support cross-market disposal-order and parcel-level cost tracking.

## Relationship Rules

- `FeeProfileBinding` points an account and symbol to a `FeeProfile`
- `TradeEvent` resolves fee policy from account default, then account and symbol binding
- `TradeEvent` persists booked charges plus the fee policy snapshot used at booking time
- `TradeEvent` may create one or more `CashLedgerEntry` records
- `DividendEvent` may create zero or more `DividendLedgerEntry` records
- `DividendLedgerEntry` may create one or more `CashLedgerEntry` records
- `DividendLedgerEntry` may create zero or more `DividendDeductionEntry` records
- `ReconciliationRecord` points to facts or derived outputs under review, but does not rewrite them
- `DailyPortfolioSnapshot` derives from booked facts plus pricing or reference data

## Handoff Rules

The following rules constrain follow-on implementation work:

- no downstream ticket may redefine booked facts, derived state, or reference and configuration categories
- no downstream ticket may replace reversal with silent mutation for posted facts
- no downstream ticket may collapse `DividendEvent` and `DividendLedgerEntry` into a single record type
- no downstream ticket may remove lot-capable inventory support from the implementation model if future cross-market support remains in scope
- weighted-average portfolio views may become the default user-facing behavior, but must not erase future lot or parcel support requirements
- broker commission configuration remains user-facing
- regulated sell-tax defaults remain visible for transparency, but should not be positioned as normal broker settings users are expected to tune frequently

## Terminology Map

| Canonical term | Current term | Notes |
| --- | --- | --- |
| `FeeProfile.boardCommissionRate` | `commissionRateBps` | Canonical target is decimal-capable and exact `1.425‰` aware |
| `FeeProfile.minimumCommissionAmount` | `minimumCommissionAmount` | Runtime naming is now currency-normalized |
| `FeeProfileBinding` | `account_fee_profile_overrides` | Same behavioral role |
| `TradeEvent` | `Transaction` | Keep current implementation name during migration, but use canonical name in new specs |
| `TradeEvent.bookedCommissionAmount` | `commissionAmount` | Runtime naming is now currency-normalized |
| `TradeEvent.bookedTaxAmount` | `taxAmount` | Runtime naming is now currency-normalized |
| `CashLedgerEntry` | `cash_ledger_entries` | Already implemented |
| `DividendEvent` | `dividend_events` | Already implemented |
| `DividendLedgerEntry` | `dividend_ledger_entries` | Already implemented |
| `DividendDeductionEntry` | `dividend_deduction_entries` | Already implemented |
| `DailyPortfolioSnapshot` | `daily_portfolio_snapshots` | Runtime naming now uses `total*Amount` fields plus `currency` |
| `Lot` | `Lot` | Keep as derived state |

## Invariant Matrix

| Entity | Immutable after posting | Derived or source | Key validation |
| --- | --- | --- | --- |
| `FeeProfile` | No, reference config | Reference | exact board rate default, separated broker fee assumptions, regulated tax defaults |
| `FeeProfileBinding` | No, reference config | Reference | one active binding per account and symbol |
| `TradeEvent` | Yes, except reversal flow | Source fact | positive quantity, explicit booking order, non-negative booked charges |
| `CashLedgerEntry` | Yes, except reversal flow | Source fact | valid sign by entry type, no invalid orphan references |
| `DividendEvent` | Reference update allowed | Reference fact | instrument, date, and declared amount validity |
| `DividendLedgerEntry` | Yes, except reversal flow | Source fact | expected vs actual fields valid, audit-safe correction |
| `DividendDeductionEntry` | Yes | Source fact | typed deduction with explicit currency |
| `ReconciliationRecord` | Append-only workflow | Source fact | status transitions valid, source discrepancy preserved |
| `DailyPortfolioSnapshot` | Yes | Derived read model | reproducible for date and run |
| `Lot` | Rebuilt from facts | Derived state | no negative open quantity or total cost |

## Worked Example Pack

The issue is not complete without concrete examples. The following examples define the minimum acceptance pack for the MVP model.

### Example 1. Buy Trade Derived From Account Default Fee Profile

Input facts:

- account default `FeeProfile`
  - boardCommissionRate: exact `1.425‰`
  - commissionDiscount: `100%`
  - minimumCommissionAmount: `20`
  - commissionCurrency: `TWD`
  - commissionRoundingMode: `FLOOR`
- `TradeEvent`
  - account: `broker-a`
  - symbol: `2330`
  - tradeType: `BUY`
  - quantity: `1000`
  - unitPrice: `600`
  - priceCurrency: `TWD`

Derived booked values:

- gross trade value: `600000`
- bookedCommissionAmount: `855`
- bookedTaxAmount: `0`

Expected outcomes:

- one posted `TradeEvent` exists with the derived booked commission and persisted fee policy snapshot
- one `CashLedgerEntry` exists for trade settlement cash outflow
- derived holding quantity becomes `1000`
- derived total cost becomes `600855`
- if lot-capable inventory is enabled, one open `Lot` exists with quantity `1000`

### Example 2. Sell Trade Derived From Default Regulated Tax Settings

Precondition:

- existing holding from Example 1
- same account default `FeeProfile`
- default regulated stock sell tax rate remains `0.3%`

Input facts:

- `TradeEvent`
  - account: `broker-a`
  - symbol: `2330`
  - tradeType: `SELL`
  - quantity: `400`
  - unitPrice: `650`
  - priceCurrency: `TWD`

Derived booked values:

- gross trade value: `260000`
- bookedCommissionAmount: `370`
- bookedTaxAmount: `780`

Expected outcomes:

- one posted `TradeEvent` exists
- one `CashLedgerEntry` exists for trade settlement cash inflow
- derived holding quantity becomes `600`
- realized P&L is derived from disposal cost and net proceeds, not manually entered
- no negative lot or holding quantity appears

### Example 3. Symbol Override Fee Profile Takes Precedence

Input facts:

- account default `FeeProfile`
  - boardCommissionRate: `1.425‰`
  - commissionDiscount: `100%`
  - minimumCommissionAmount: `20`
- `FeeProfileBinding`
  - account: `broker-a`
  - symbol: `2330`
  - override profile uses discount `60%`
- `TradeEvent`
  - buy `1000` shares of `2330` at `600`

Expected outcomes:

- the symbol override fee profile is used instead of the account default
- the posted trade persists the override fee policy snapshot
- the user does not need per-trade manual fee-policy entry to get the correct result

### Example 4. Same-Day Multiple Trades In One Symbol

Input facts:

- `TradeEvent` buy `500` shares of `2330` at `600` on `2026-03-01T09:05:00+08:00`
- `TradeEvent` buy `300` shares of `2330` at `605` on `2026-03-01T11:20:00+08:00`
- `TradeEvent` sell `200` shares of `2330` at `610` on `2026-03-01T13:10:00+08:00`

Expected outcomes:

- ordering is determined by `tradeDate`, `tradeTimestamp`, and `bookingSequence`, not by ambiguous date-only sorting
- derived holdings and cost basis are reproducible from that sequence
- the system does not collapse same-day trades into one fact unless an explicit consolidation rule exists

### Example 5. Broker Campaign Rebate Is A Separate Cash Event

Input facts:

- a trade is posted using a fee profile with `commissionChargeMode = CHARGED_UPFRONT_REBATED_LATER`
- the trade settles with the higher charged commission shown on the broker statement
- the broker later posts a campaign rebate cash credit

Expected outcomes:

- the original trade keeps the booked commission that was actually charged at settlement
- the later rebate is booked as a separate `CashLedgerEntry`
- the original trade is not silently rewritten to look like it was charged at the discounted amount on trade date

### Example 6. Declared Cash Dividend Vs Posted Dividend Receipt

Input facts:

- `DividendEvent`
  - symbol: `0056`
  - exDividendDate: `2026-07-15`
  - paymentDate: `2026-08-10`
  - cashDividendPerShare: `1.2`
  - cashDividendCurrency: `TWD`
  - stockDividendPerShare: `0`
- eligible holding on ex-dividend date: `2000` shares

Expected outcomes:

- the `DividendEvent` exists as reference data only
- one `DividendLedgerEntry` may be created with:
  - eligibleQuantity: `2000`
  - expectedCashAmount: `2400`
  - cashCurrency: `TWD`
- no cash movement is created merely because the dividend was declared
- actual cash is only recognized after posting the receipt

### Example 7. Posted Dividend Receipt With Deductions

Precondition:

- expected dividend ledger exists from Example 6

Input facts:

- update or post `DividendLedgerEntry`
  - receivedCashAmount: `2280`
  - cashCurrency: `TWD`
  - postingStatus: `posted`
- one `DividendDeductionEntry`
  - deductionType: `NHI_SUPPLEMENTAL_PREMIUM`
  - amount: `120`
  - currencyCode: `TWD`

Expected outcomes:

- one posted `DividendLedgerEntry` exists for the account
- one or more `CashLedgerEntry` records exist to represent the actual cash receipt and related deduction effects
- expected and actual values remain separately visible
- the posted receipt does not rewrite the original `DividendEvent`

### Example 8. Correction Through Reversal

Precondition:

- a posted `TradeEvent` or posted `DividendLedgerEntry` exists with an incorrect amount

Input facts:

- a reversal record is created to negate the incorrect posted fact
- a new corrected posted fact is created separately if needed

Expected outcomes:

- the original posted fact remains in history
- correction is represented through reversal, not in-place overwrite
- derived holdings, cash, and snapshots can be recomputed from the full event history

### Example 9. Reconciliation Mismatch Without Destructive Rewrite

Input facts:

- broker import shows cash balance `100000`
- internal derived cash balance is `99500`

Expected outcomes:

- one `ReconciliationRecord` exists with status `open`
- the discrepancy amount and source reference are preserved
- no booked trade, dividend, or cash ledger fact is silently changed
- later resolution updates reconciliation workflow state, not historical facts

### Example 10. Duplicate Import Or Idempotency Case

Input facts:

- the same broker trade row is imported twice with the same external source reference

Expected outcomes:

- only one booked `TradeEvent` is accepted
- the duplicate is rejected or linked to an idempotency outcome
- holdings and cash balances are unchanged by the duplicate attempt

### Example 11. Backfilled Historical Trade

Input facts:

- user posts a missing historical buy dated before already-booked later trades

Expected outcomes:

- the new fact is appended with its historical trade date preserved
- derived holdings, cost basis, and snapshots are recomputed from full chronological facts
- prior posted facts are not rewritten
- any affected reconciliation or snapshot outputs are regenerated rather than manually edited

### Example 12. Invalid Oversell

Precondition:

- account holds `600` shares of `2330`

Input facts:

- user attempts to post a `SELL` for `700` shares

Expected outcomes:

- the `TradeEvent` is rejected
- no `CashLedgerEntry` is created
- holdings remain unchanged
- the validation reason is explicit

### Example 13. Invalid Negative Values

Input facts:

- user attempts to post:
  - `quantity = -100`
  - or `unitPrice = -1`
  - or `bookedCommissionAmount = -5`

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
- explicit migration mapping from current `trade_fee_policy_snapshots/lots/recompute/corporate_actions` to the canonical model

## Ready-For-Handoff Checklist

The spec is ready to hand off into implementation when all answers below are "yes":

- are all canonical entities defined with purpose, fields, lifecycle, and invariants?
- are reference data and booked facts explicitly separated?
- is the posted-fact correction model locked to `reversal`?
- is the `Lot` role explicitly retained for cross-market support?
- are `DividendEvent`, `DividendLedgerEntry`, and `DividendDeductionEntry` minimum MVP fields fixed?
- does the example pack cover trade, dividend, rebate cash mode, reconciliation, reversal, idempotency, and validation cases?
- can `KZO-12` through `KZO-16` start without reopening core terminology questions?

## Migration Guidance

The model should preserve the current implementation path while making future work additive.

### Phase 1

- define canonical names and invariants around the already-implemented ledger model
- keep current runtime read and write paths functional while clarifying canonical terminology

### Phase 2

- upgrade fee-profile precision from integer basis points to an exact decimal-capable board commission rate
- move canonical product and API thinking away from raw free-form commission input

### Phase 3

- completed in current runtime through `KZO-55`: schema, types, API shapes, and web-facing contracts now use currency-neutral amount names with explicit currency fields

### Phase 4

- extend reconciliation and daily snapshot behavior to match the canonical workflow contract fully

## Downstream Ticket Mapping

The intended downstream mapping is:

- `KZO-12`: product settings and shared-type alignment for weighted-average cost as the default bookkeeping view
- `KZO-13`: domain-level weighted-average cost basis and realized P&L behavior
- `KZO-15`: schema foundation and evolution for cash ledger, dividends, reconciliation, snapshots, and fee-policy precision
- `KZO-16`: store and persistence contracts around accounting aggregates
- `KZO-51`: immutable correction contract for posted facts
- `KZO-55`: implemented currency normalization across accounting schema, shared types, settings, API naming, and web form behavior
- `KZO-24`, `KZO-34`, `KZO-36`: first write paths using the canonical model
- `KZO-29`, `KZO-30`, `KZO-31`: import and reconciliation behaviors constrained by this document

## KZO-11 Decisions

The following decisions are locked for the current MVP:

- `Lot` remains canonical as a derived inventory and tax-lot-capable model
- posted-fact correction model: `reversal`
- broker commission configuration remains user-facing through fee profiles
- symbol-level fee override remains the highest-precedence user-configurable fee-policy path
- regulated sell-tax defaults remain configurable in config or schema but are visible read-mostly values, not normal broker settings users are encouraged to tune
- canonical board commission rate defaults to exact `1.425‰`
- canonical field naming is currency-normalized and current runtime naming is now aligned with that structure
- broker rebate campaigns are represented as separate cash ledger events, not trade mutation

## Explicit Non-Goals for This Issue

- no schema migration implementation
- no API route implementation
- no UI implementation
- no full multi-currency feature delivery
- no FX conversion engine
