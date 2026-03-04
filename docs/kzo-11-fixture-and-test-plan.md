# KZO-11 Fixture and Test Plan

## Purpose

This document converts the canonical accounting model example pack into concrete test-planning outputs for follow-on implementation tickets.

It is intended to guide:

- domain unit tests
- API integration tests
- persistence fixtures
- future end-to-end scenario coverage

## Fixture Principles

- fixtures should be fact-first
- expected derived state should be asserted separately from input facts
- correction scenarios must preserve the original fact and add reversal records
- dividend scenarios must keep reference data separate from booked account facts
- reconciliation scenarios must never assume destructive mutation of posted facts

## Core Seed Fixtures

### Fixture A. Single Buy

Facts:

- one account
- one symbol
- one `TradeEvent` buy with booked commission

Assertions:

- holding quantity
- total cost
- cash settlement outflow
- one open `Lot`

Planned test layers:

- domain unit
- API integration

### Fixture B. Buy Then Sell

Facts:

- buy event
- sell event with booked commission and tax

Assertions:

- holding quantity after sell
- realized P&L derived, not user-entered
- cash settlement inflow
- no negative inventory

Planned test layers:

- domain unit
- API integration

### Fixture C. Multiple Buys Then Partial Sell

Facts:

- two buys
- one partial sell

Assertions:

- remaining quantity
- derived average-cost portfolio view
- tax-lot-capable inventory still available

Planned test layers:

- domain unit
- API integration

### Fixture D. Same-Day Ordering

Facts:

- multiple same-day trades with timestamps or deterministic sequence

Assertions:

- posting order is deterministic
- derived outputs are reproducible from event sequence

Planned test layers:

- domain unit
- API integration

### Fixture E. Dividend Declaration

Facts:

- one `DividendEvent`
- eligible holding on ex-dividend date

Assertions:

- expected dividend ledger entry can be derived
- no cash movement on declaration alone

Planned test layers:

- API integration
- persistence fixture

### Fixture F. Dividend Posting With Deductions

Facts:

- expected dividend ledger entry
- posted received cash
- supplemental insurance deduction

Assertions:

- expected vs actual values remain distinct
- related cash ledger effects exist
- reference event remains unchanged

Planned test layers:

- API integration
- persistence fixture

### Fixture G. Reversal Correction

Facts:

- one incorrect posted fact
- one reversal fact
- one corrected replacement fact if applicable

Assertions:

- original fact remains in history
- no in-place overwrite
- recomputed holdings and cash reconcile to the corrected result

Planned test layers:

- API integration
- persistence fixture

### Fixture H. Reconciliation Mismatch

Facts:

- derived internal balance
- imported broker balance with mismatch

Assertions:

- `ReconciliationRecord` created
- discrepancy retained
- no posted fact mutation

Planned test layers:

- API integration

### Fixture I. Duplicate Import

Facts:

- same external source reference submitted twice

Assertions:

- one accepted booked fact
- duplicate rejected or no-op idempotency response

Planned test layers:

- API integration

### Fixture J. Historical Backfill

Facts:

- existing later trades
- newly posted older trade

Assertions:

- full derived state recomputes from ordered facts
- snapshots and reconciliation outputs regenerate

Planned test layers:

- API integration
- persistence fixture

### Fixture K. Invalid Oversell

Facts:

- sell quantity greater than available quantity

Assertions:

- request rejected
- no side effects on lots, cash, or holdings

Planned test layers:

- domain unit
- API integration

### Fixture L. Invalid Negative Values

Facts:

- negative quantity or negative amount inputs

Assertions:

- validation rejects before posting
- no side effects

Planned test layers:

- API integration

## Suggested Follow-On Test Mapping

| Fixture | Primary follow-on ticket |
| --- | --- |
| A, B, C, K | `KZO-13` |
| E, F | `KZO-34`, `KZO-35`, `KZO-36` |
| G | correction flow follow-on after `KZO-24` / dividend posting |
| H, I, J | `KZO-29`, `KZO-30`, `KZO-31` |
| snapshot assertions from B, J | future snapshot implementation after `KZO-15` and read-model work |

## Immediate QA Deliverables

- convert Fixtures A, B, C, K into domain and API red-green tests once `KZO-13` starts
- convert Fixtures E and F into dividend fixture tables once `KZO-34` starts
- reserve Fixture G as the acceptance baseline for reversal behavior
- use Fixtures H and I as the basis for reconciliation and import idempotency contracts
