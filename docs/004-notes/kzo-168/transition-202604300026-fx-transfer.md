---
slug: kzo-168
created: 2026-04-30
ticket: KZO-168
---

# Transition: FX Transfer Producer Activation

KZO-168 activates the producer side of currency-wallet WAC accounting.

## What Changed

- `cash_ledger_entries` now supports `FX_TRANSFER_OUT` and `FX_TRANSFER_IN`.
- Each FX transfer is represented by two cash ledger rows linked by `fx_transfer_id`.
- FX reversal rows are normal `REVERSAL` rows, but inherit the same `fx_transfer_id`.
- FX transfer create/edit/reverse writes an audit row and regenerates currency-wallet snapshots.
- The frontend cash ledger shows paired FX legs, exposes an FX Transfer filter chip, and opens the FX transfer modal for create/edit/reverse flows.

## WAC Semantic Change

Before KZO-168, an FX-stamped outflow from a wallet with `wacFxToUsd === null` always threw unless the wallet was already seeded.

KZO-168 changes that branch:

- if the outflow would make the balance negative, it still throws `InsufficientWalletBalanceError`;
- if the wallet remains positive, the outflow seeds WAC at the entry's `fx_rate_to_usd` and realizes `0` P&L.

This covers the common first-FX-outflow case where a funded wallet has cash history but no prior FX cost basis.

## API Surface

- `POST /fx-transfers/estimate`
- `POST /fx-transfers`
- `PATCH /fx-transfers/:id`
- `POST /fx-transfers/:id/reverse`

All mutation routes emit existing `recompute_complete` SSE events after wallet snapshot regeneration. The payload carries `holdings: []` and two `cashBalanceChanges` rows.

## Verification Added

- Unit coverage for FX transfer validation, create/update/reverse, and the WAC seed-on-null branch.
- HTTP/AAA coverage for estimate/create, rate hard-block, edit, reverse, and ledger-paired rows.
- Migration coverage for entry-type extension, `fx_transfer_id`, unique original leg invariant, and audit action checks.
