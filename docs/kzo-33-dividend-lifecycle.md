# KZO-33 Dividend Event And Posting Lifecycle

## Purpose

This document is the implementation contract for `KZO-33`.

Its job is to define the lifecycle boundary between:

- issuer/reference dividend data
- account-level expected entitlement
- account-level posted receipt and deductions
- downstream reconciliation and correction flows

It should unblock `KZO-34` and `KZO-36` without turning `KZO-33` into the execution ticket for persistence or API delivery.

## Scope

This ticket defines:

- `DividendEvent` vs `DividendLedgerEntry`
- eligible quantity semantics
- expected vs actual field meaning
- posting and reconciliation status meaning
- cash-ledger linkage for actual cash effects
- correction behavior for dividend posting

This ticket does not define:

- broker-specific deduction formulas
- broker-specific rounding formulas beyond the need for deterministic booked values
- final API shape
- final read-model or UI behavior

## Canonical Boundary

### `DividendEvent`

`DividendEvent` is issuer-level reference data.

- it is symbol-scoped, not account-scoped
- it carries declaration data such as `exDividendDate`, `paymentDate`, and per-share values
- it does not post account cash by itself
- it may be created or updated from feeds or manual reference entry without rewriting booked account history

### `DividendLedgerEntry`

`DividendLedgerEntry` is the account-level bookkeeping record for one account's participation in one dividend event.

- it is derived from one `DividendEvent` plus one account's eligible holdings
- it stores both expected and actual values side by side
- it links to typed deduction records separately from the net cash receipt
- it is the source record for dividend posting status and downstream reconciliation

### `DividendDeductionEntry`

`DividendDeductionEntry` is the typed child record for one withheld or adjusted amount attached to one `DividendLedgerEntry`.

- it preserves deduction detail without flattening all withheld amounts into one summary field
- it stores `amount` plus explicit `currencyCode`
- for Wave 2 Taiwan MVP, `currencyCode` is fixed to `TWD`
- downstream summary totals may be projected from these rows, but the child rows are the source of truth

### `CashLedgerEntry`

`CashLedgerEntry` records only the actual cash effects of dividend posting.

- declaration alone does not create cash movement
- posted cash dividends create a `DIVIDEND_RECEIPT` entry
- posted deductions create one or more `DIVIDEND_DEDUCTION` entries
- every dividend-related cash entry must link to `relatedDividendLedgerEntryId`

Stock quantities are recorded on `DividendLedgerEntry`. They do not create cash-ledger entries merely because stock was issued.

On payment date, stock-dividend posting must update downstream holdings or inventory bookkeeping through the non-cash stock path. Only actual cash side effects such as cash in lieu, fees, or withheld deductions belong in `CashLedgerEntry`.

## Lifecycle

### 1. Declare The Dividend Event

The first step is to record the reference event.

Required meaning:

- `DividendEvent` exists independently from any account
- `eventType` determines whether the event has cash, stock, or both components
- no account-level posted fact is created merely because the event is declared

This is the persistence seam for `KZO-34`.

### 2. Materialize Expected Entitlement

Expected entitlement is the account-level expectation derived from the reference event and the account's eligible holdings.

Required meaning:

- a dividend event may produce zero or more account-level ledger entries
- no active ledger entry is required when an account has zero eligible quantity
- when an account has non-zero eligible quantity, an active expected entry should be materialized before payment posting
- posting must load and update the existing expected entry rather than creating first-time entitlement state atomically

For MVP, `eligibleQuantity` means the carry-in position for the account and symbol at the start of `exDividendDate`.

That means:

- include quantity produced by posted trade facts strictly before `exDividendDate`
- exclude buys first booked on `exDividendDate` or later
- exclude quantity already closed before `exDividendDate`
- use canonical trade ordering and projections when historical replay is needed

This keeps the eligibility rule aligned with the accounting model without depending on the legacy `CorporateAction` shortcut.

### 3. Post The Actual Receipt

Posting records what the account actually received for that event.

Required meaning:

- the only allowed in-place lifecycle transition is `expected -> posted` on the same active row
- that in-place transition is allowed because `expected` is a pre-posted placeholder, not a final posted fact
- once a row reaches `posted` or `adjusted`, its monetary and quantity fields are immutable
- actual booked values may differ from expected values
- deductions are stored explicitly and are not folded invisibly into the reference event
- cash effects are represented through linked cash-ledger entries, not inferred from dividend fields alone

For cash dividends:

- `expectedCashAmountNtd` is the gross expected cash entitlement before deductions
- `receivedCashAmountNtd` is the net cash actually credited to the account
- deductions such as supplemental premium, withholding tax, or rounding adjustments are booked as typed `DividendDeductionEntry` rows linked to the dividend ledger entry

For this contract, the ledger amount field names still use `Ntd` because that is the current MVP naming. The lifecycle semantics are currency-agnostic. Wave 2 implementation should persist explicit `currencyCode = TWD` on typed deduction rows so later normalization can remain additive rather than implicit.

For stock dividends:

- `expectedStockQuantity` is the expected stock entitlement
- `receivedStockQuantity` is the actually credited stock quantity
- posting the actual stock receipt must also drive downstream holdings or inventory effects through the stock-position path rather than through cash-ledger inference

Current implementation bridge:

- until a dedicated non-cash position-event model exists, Wave 2 may materialize the stock effect as a zero-cost lot insertion on payment date
- treat that bridge as temporary implementation scaffolding, not as the long-term canonical representation of stock-position events
- future correction work must still reverse the stock effect through the inventory path rather than treating it as cash-only activity

If both cash and stock exist, both components live on the same `DividendLedgerEntry`.

### 4. Adjust Or Correct The Posting

Corrections must preserve history.

Required meaning:

- posted dividend facts are never silently overwritten in place
- if a posted dividend is wrong, reverse the prior active `DividendLedgerEntry`
- reverse the related cash-ledger entries that were produced by the incorrect posting
- create a replacement dividend ledger record for the corrected values if needed
- reversal rows must remain explicitly linked to the prior row through `reversalOfDividendLedgerEntryId`
- reversal rows exist to negate the prior posted economic effect, while the replacement row carries the corrected active values

The replacement active record should use `postingStatus = adjusted` when it supersedes a prior posted record.

### 5. Reconcile And Close

Reconciliation closes the loop between internal booking and broker or import evidence.

Required meaning:

- reconciliation state is tracked independently from the reference event
- discrepancies are handled through reconciliation workflow and, when needed, reversal plus replacement
- the active dividend record may move to a closed state after review is complete

## Field Semantics

### Expected vs Actual

Expected and actual values must remain separately visible at all times.

- expected values answer "what the account should receive from the declared event"
- actual values answer "what the account was actually credited or withheld when posted"
- comparison should use the full actual economic result, not only the net receipt

For cash dividends, the comparable actual cash result is:

- `receivedCashAmountNtd + sum(at-source DividendDeductionEntry.amount)`

That preserves a clean distinction between gross expectation, net credited cash, and explicit withheld deductions.

The comparable actual result should include only direct at-source effects of the same dividend posting. It should not absorb unrelated monthly fees, later manual cash adjustments, or other account-level cash activity that is not part of the dividend event itself.

### Status Meaning

`postingStatus` and `reconciliationStatus` serve different purposes.

`postingStatus` is the dividend lifecycle stage:

- `expected`: entitlement exists, but no actual posting has been booked yet
- `posted`: actual values have been booked and related cash effects have been created where applicable
- `adjusted`: the active record is a corrected replacement for an earlier posted record

`reconciliationStatus` is the exception-review state:

- `open`: not yet confirmed or currently mismatched
- `matched`: external evidence matches the active booked record
- `explained`: a difference remains visible, but the difference is documented and accepted without corrective reversal
- `resolved`: the review workflow is complete, whether by confirmation or by correction

The statuses should move together with these constraints:

- `postingStatus = expected` implies `reconciliationStatus = open`
- `reconciliationStatus = matched`, `explained`, or `resolved` requires `postingStatus` to be `posted` or `adjusted`
- `reconciliationStatus = explained` should only be used when a variance remains visible without a corrective reversal and without changing the booked dividend facts
- `reconciliationStatus = matched` or `resolved` does not require the record to have originated as `posted`; an `adjusted` replacement may also become reconciled

Illustrative examples:

- `posted + matched`: broker evidence agrees with the booked receipt and deductions
- `posted + explained`: the broker statement groups the same economic result differently, or the statement cut-off date differs, but no booked fact is wrong
- `adjusted + open`: a prior posted row was reversed and replaced, and the replacement is awaiting fresh confirmation
- `adjusted + resolved`: the corrected replacement row has completed the review workflow

### Active-Record Rule

At most one non-reversed active `DividendLedgerEntry` should exist for a given `(accountId, dividendEventId)` pair at a time.

For this contract, `active` means:

- the row is not itself a reversal row
- no other row references it through `reversalOfDividendLedgerEntryId`
- the row has not been superseded by a corrective replacement

This gives downstream implementation a stable contract:

- one active expectation or posting record per account per event
- reversal plus replacement for corrections
- no parallel active records that force the API or read model to guess which one is authoritative

`KZO-54` should encode this rule in schema, and `KZO-34` should enforce the same rule in store or persistence invariants.

That enforcement should live in persistence, not only service logic. The downstream store should use an explicit active-row predicate, such as an equivalent of "not a reversal and not superseded", and guarantee uniqueness for `(accountId, dividendEventId)` under that predicate.

## Downstream Handoff

### `KZO-34`

`KZO-34` should implement persistence for:

- `DividendEvent`
- active `DividendLedgerEntry` records with expected and actual fields
- typed `DividendDeductionEntry` rows with explicit `currencyCode = TWD`
- the active-record rule for `(accountId, dividendEventId)`
- explicit reversal linkage and persistence-level enforcement of the active-row predicate

It should not redefine lifecycle meaning from this document.

### `KZO-36`

`KZO-36` should implement posting behavior for:

- deriving and materializing the active expected entry before payment posting
- loading the active expected entry for posting
- booking actual cash and stock values
- recording typed dividend deduction rows with explicit `currencyCode = TWD`
- creating linked `CashLedgerEntry` records for cash receipt and deductions
- driving stock-dividend holdings or inventory effects through the non-cash stock path
- comparing expected vs actual results without mutating reference data

It should not collapse declaration, entitlement, and posting into the old `CorporateAction` shape.

## Test Guidance

The minimum fixture coverage for this contract is already implied by the repo fixture plan:

- declaration without cash movement
- posting with deductions
- expected vs actual remaining separately visible
- reversal-based correction

`KZO-34` and `KZO-36` should convert those cases into API and persistence tests rather than redefining the lifecycle in code comments or ticket notes.
